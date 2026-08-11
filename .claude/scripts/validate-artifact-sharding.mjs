#!/usr/bin/env node
// artifact-sharding-contract.md의 §검증 4항목을 기계화한다.
//
// 배경: 계약은 모든 예산을 KB로 명시하는데 **KB를 측정하는 것이 하나도 없었다.** 유일한 강제는
// validate-modularity의 300줄 상한이고 그 대상은 `.claude/skills/**`라서 `_workspace/**` 산출물을
// 한 번도 보지 않았다. 강제는 SKILL.md의 산문("예산을 넘었는데 분할되지 않았으면 designer를 다시
// 실행한다")에 위임돼 있었는데, 바이트를 측정할 수단이 없는 판단은 지켜질 수 없다.
// 하니스가 자기 카탈로그 2개에는 결정론적 분할기를 갖추고, 최대 18개 에이전트가 읽는 산출물에는
// 산문만 둔 상태였다 — 이 스크립트가 그 비대칭을 해소한다.
//
// 사용법:
//   node .claude/scripts/validate-artifact-sharding.mjs --project <dir> [--json]
// 종료코드: 0 = 계약 충족, 1 = 위반(fail-closed), 2 = 사용법·경로 오류

import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs'
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'

const SECTION_MAX_BYTES = 15 * 1024
const INDEX_MAX_BYTES = 5 * 1024
const SINGLE_FILE_MAX_BYTES = 20 * 1024
const SECTION_COUNT_TRIGGER = 8

const argv = process.argv.slice(2)
const jsonOutput = argv.includes('--json')
const options = argv.filter(value => value !== '--json')
if (options.length !== 2 || options[0] !== '--project') {
  process.stderr.write('Usage: validate-artifact-sharding.mjs --project <directory> [--json]\n')
  process.exit(2)
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
let projectRoot
try {
  projectRoot = resolve(options[1])
  if (!statSync(projectRoot).isDirectory()) throw new Error('not a directory')
} catch {
  process.stderr.write('Artifact sharding project must be an existing directory.\n')
  process.exit(2)
}
// 하니스 저장소 내부 또는 현재 세션 프로젝트(CLAUDE_PROJECT_DIR — 플러그인 모드) 내부만 허용한다.
// run-package-operation과 달리 최상위 세그먼트 블랙리스트(.claude/.git/_workspace)는 두지 않는다 —
// 이 validator는 고정된 _workspace 하위 .md만 읽는 read-only 스캐너로 write/exec 표면이 없다.
const escapesRoot = root => {
  if (!root) return true
  const offset = relative(resolve(root), projectRoot)
  return offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)
}
if (escapesRoot(repositoryRoot) && escapesRoot(process.env.CLAUDE_PROJECT_DIR)) {
  process.stderr.write('Artifact sharding validation must stay inside the harness repository or the current session project.\n')
  process.exit(2)
}

const knownAgents = new Set(
  existsSync(join(repositoryRoot, '.claude/agents'))
    ? readdirSync(join(repositoryRoot, '.claude/agents'))
        .filter(name => name.endsWith('.md'))
        .map(name => name.replace(/\.md$/, ''))
    : [],
)

const errors = []
const warnings = []
const inspected = []
const kb = bytes => `${(bytes / 1024).toFixed(1)}KB`

// `##` 절 개수 — fenced code block 안의 heading은 세지 않는다
const countSections = source => {
  let fence = null
  let count = 0
  for (const line of source.split(/\r?\n/)) {
    const fenceMatch = line.match(/^(```+|~~~+)/)
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1]
      else if (line.startsWith(fence)) fence = null
      continue
    }
    if (fence === null && /^##\s+\S/.test(line)) count += 1
  }
  return count
}

// 검사 대상 디렉터리 목록. 토픽 폴더(기능별로 독립 산출물을 묶은 디렉터리 — INDEX.md가 없다)는
// 분할 산출물이 아니므로 그 안의 파일을 독립 산출물로 재귀 검사한다.
// INDEX.md가 있는 디렉터리만 분할 산출물로 판정한다 — 이 구분이 없으면 토픽 폴더가
// "INDEX 누락"으로 오탐된다(실제 생성물의 `race-ai/`가 그 사례였다).
const pendingDirectories = ['_workspace/01_plan', '_workspace/02_design']
for (const relativeDirectory of pendingDirectories) {
  const absoluteDirectory = join(projectRoot, relativeDirectory)
  if (!existsSync(absoluteDirectory)) continue

  for (const entry of readdirSync(absoluteDirectory, {withFileTypes: true})) {
    const entryPath = join(relativeDirectory, entry.name)

    // ── 단일 파일 산출물: 20KB 초과 또는 절 8개 초과면 분할 필수
    if (entry.isFile() && entry.name.endsWith('.md')) {
      const absolutePath = join(projectRoot, entryPath)
      const bytes = statSync(absolutePath).size
      const sections = countSections(readFileSync(absolutePath, 'utf8'))
      inspected.push({path: entryPath, kind: 'single-file', bytes, sections})
      // 디렉토리와 동명 .md 공존 금지 (계약 §디렉토리 레이아웃)
      const twinDirectory = join(projectRoot, relativeDirectory, entry.name.replace(/\.md$/, ''))
      if (existsSync(twinDirectory) && statSync(twinDirectory).isDirectory()) {
        errors.push(`${entryPath}: a directory of the same name also exists — consumers cannot tell which is authoritative`)
      }
      if (bytes > SINGLE_FILE_MAX_BYTES) {
        errors.push(`${entryPath}: unsharded artifact is ${kb(bytes)} (budget ${kb(SINGLE_FILE_MAX_BYTES)}) — split required`)
      } else if (sections > SECTION_COUNT_TRIGGER) {
        errors.push(`${entryPath}: has ${sections} sections (trigger ${SECTION_COUNT_TRIGGER}) — split required`)
      }
      continue
    }

    // ── 분할 산출물: INDEX 존재·예산, 절 파일 예산, INDEX↔파일 양방향, 주 소비자 실존
    if (!entry.isDirectory()) continue
    const indexRelative = join(entryPath, 'INDEX.md')
    const indexAbsolute = join(projectRoot, indexRelative)
    if (!existsSync(indexAbsolute)) {
      // 토픽 폴더 — 안의 파일들을 독립 산출물로 검사한다
      pendingDirectories.push(entryPath)
      continue
    }
    const indexBytes = statSync(indexAbsolute).size
    if (indexBytes > INDEX_MAX_BYTES) {
      errors.push(`${indexRelative}: ${kb(indexBytes)} exceeds the index budget ${kb(INDEX_MAX_BYTES)} — keep the table, drop prose`)
    }
    const indexSource = readFileSync(indexAbsolute, 'utf8')
    inspected.push({path: `${entryPath}/`, kind: 'sharded', bytes: indexBytes})

    for (const name of readdirSync(join(projectRoot, entryPath)).filter(value => value.endsWith('.md') && value !== 'INDEX.md')) {
      const sectionRelative = join(entryPath, name)
      const sectionBytes = statSync(join(projectRoot, sectionRelative)).size
      if (sectionBytes > SECTION_MAX_BYTES) {
        errors.push(`${sectionRelative}: ${kb(sectionBytes)} exceeds the section budget ${kb(SECTION_MAX_BYTES)} — re-split on a smaller axis`)
      }
      if (!indexSource.includes(name)) {
        errors.push(`${sectionRelative}: section file is not listed in INDEX.md`)
      }
    }
    // INDEX가 가리키는 파일이 실존하는가 (역방향)
    for (const referenced of new Set([...indexSource.matchAll(/`([\w.-]+\.(?:md|code\.\w+))`/g)].map(match => match[1]))) {
      if (referenced === 'INDEX.md') continue
      if (!existsSync(join(projectRoot, entryPath, referenced))) {
        errors.push(`${indexRelative}: references a missing section file ${referenced}`)
      }
    }
    // 주 소비자 열이 실제 에이전트 이름인가 (4열 표의 마지막 열)
    for (const match of indexSource.matchAll(/^\|[^|\n]*\|[^|\n]*\|[^|\n]*\|([^|\n]+)\|/gm)) {
      const cell = match[1].trim()
      if (!cell || /^-+$/.test(cell) || cell === '주 소비자') continue
      for (const name of cell.split(/[,·]/).map(value => value.trim().replace(/`/g, '')).filter(Boolean)) {
        if (name === '전체') continue
        if (knownAgents.size > 0 && !knownAgents.has(name)) {
          warnings.push(`${indexRelative}: 주 소비자 "${name}" is not a known agent name`)
        }
      }
    }
  }
}

if (jsonOutput) {
  process.stdout.write(`${JSON.stringify({inspected, errors, warnings}, null, 2)}\n`)
} else {
  for (const warning of warnings) process.stdout.write(`warn: ${warning}\n`)
  if (errors.length > 0) {
    process.stderr.write(`Artifact sharding contract violations (${errors.length}):\n`)
    for (const error of errors) process.stderr.write(`- ${error}\n`)
  } else {
    process.stdout.write(`Artifact sharding contract satisfied (${inspected.length} artifacts inspected).\n`)
  }
}
process.exit(errors.length > 0 ? 1 : 0)
