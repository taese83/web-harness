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
// 계약 §분할 축: project-brief는 요약·연결 문서라 분할 금지 — 예산 초과 시 시정은
// "분할"이 아니라 "본문 축소"다. 섹션 수 트리거는 적용하지 않고(시정 불가능한 지시가 됨
// — ownership도 flat-only로 잠겨 있다), KB 예산은 축소 지시 메시지로 그대로 강제한다.
// search-portal 파일럿 실측: 11섹션 project-brief에 "split required"가 나와 기계끼리 모순.
// 경로 앵커 매칭 — basename 전역 매칭이면 토픽 폴더 내 동명 파일에 새는 이론적 스코프 누수가
// 있다(리뷰 지적). 소유권 레지스트리가 이중 방어하지만 구조적으로도 좁힌다.
// solution-design.md도 분할 금지다 — spec.mjs가 `_workspace/02_design/solution-design.md`를
// 단일 경로로 하드코딩해(spec.mjs의 SOURCE 목록·확정 경로 둘 다) 분할하면 스팩 확정이 깨진다.
// 종전에는 예산 초과 시 "split required"가 나왔는데 **분할이 금지된 문서에 분할을 지시**하는
// 기계끼리의 모순이었다(project-brief에서 이미 한 번 고친 것과 같은 유형).
const SHRINK_ONLY_PATHS = new Set([
  join('_workspace', '01_plan', 'project-brief.md'),
  join('_workspace', '02_design', 'solution-design.md'),
])

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
      if (SHRINK_ONLY_PATHS.has(entryPath)) {
        if (bytes > SINGLE_FILE_MAX_BYTES) {
          // 시정 지시는 문서마다 다르다. project-brief는 원본 샤드를 가리키면 되지만
          // solution-design은 요약 문서가 아니고 가리킬 샤드도 없다 — 같은 문구를 주면
          // 설계 내용을 지우거나 없는 샤드를 가리키게 된다.
          const remedy = entryPath.endsWith(join('02_design', 'solution-design.md'))
            ? 'shrink the prose (rationale·alternatives) — the machine block stays; split is forbidden because lockSpec requires a flat path'
            : 'shrink the body and point to source shards (split is forbidden by contract)'
          errors.push(`${entryPath}: ${kb(bytes)} exceeds the single-file budget ${kb(SINGLE_FILE_MAX_BYTES)} — ${remedy}`)
        }
      } else if (bytes > SINGLE_FILE_MAX_BYTES) {
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
    // 소비자 열(4열)이 실제 에이전트 이름인가 — 언어 중립 구조 식별 + FAIL 승격 (M1 ③)
    //
    // 이전 구현의 두 결함(marker-delock-plan.md §5-3, 12개 파일럿 실측으로 확정):
    //   1. 헤더 행을 한국어 문자열(`cell === '주 소비자'`)로 식별 → 영어 헤더 INDEX에서 헤더가
    //      값으로 읽혀 "unknown agent" 경고(telemetry-viewer의 `Primary consumer`가 실사례).
    //      번역이 검사를 조용히 열화시키는 마커 락인 그 자체였다.
    //   2. warning-only(exit 0) → 소비자 열이 통째로 깨져도 게이트는 green.
    //
    // 새 식별: **절 행 = 2열에 백틱 절 파일(`x.md`)이 있는 행**. 헤더(2열이 '파일'/'File' 산문)·
    // 구분선·INDEX 안의 다른 4열 표(값에 백틱 .md 없음)가 언어와 무관하게 자동 제외된다.
    // 정규화 2종(실측 지배 패턴): (a) 괄호 한정어 제거 — `developer (shared layer)`,
    // `developer(해당 시)` (b) 다중 값은 괄호 밖 구분자(,·)로만 분리 —
    // `component-builder(widgets/*, pages/*)`의 괄호 안 쉼표는 분리하지 않는다.
    // sentinel은 언어 중립 확장: `전체` | `*` | `all`(대소문자 무관).
    const splitTopLevel = cell => {
      const parts = []
      let depth = 0
      let current = ''
      for (const ch of cell) {
        if (ch === '(') depth += 1
        else if (ch === ')') depth = Math.max(0, depth - 1)
        if ((ch === ',' || ch === '·') && depth === 0) {
          parts.push(current)
          current = ''
        } else current += ch
      }
      parts.push(current)
      return parts.map(value => value.trim().replace(/`/g, '')).filter(Boolean)
    }
    // 행 끝(| 후 공백만)을 앵커한다 — 5열 이상 표가 앞 4열 형태로 오매칭되지 않게. 4열 형식을
    // 벗어난 절 행은 아래 rowFiles 커버리지 검사가 형식 이탈로 loud하게 잡는다.
    let sectionRows = 0
    const rowFiles = new Set()
    for (const match of indexSource.matchAll(/^\|[^|\n]*\|([^|\n]*)\|[^|\n]*\|([^|\n]+)\|\s*$/gm)) {
      // `~`는 계약이 명시한 decision-log ID 구간 파일명(`PC-001~050.md`)에 쓰인다 —
      // 문자셋에서 빠지면 계약이 시킨 이름을 절 행으로 인식 못 한다(search-portal 실측, 6호와 동일 클래스)
      const fileRefs = [...match[1].matchAll(/`([\w.~-]+\.md)`/g)].map(value => value[1])
      if (fileRefs.length === 0) continue // 절 행이 아니다(헤더·구분선·타 표)
      sectionRows += 1
      for (const fileRef of fileRefs) rowFiles.add(fileRef)
      const cell = match[2].trim()
      if (!cell) {
        errors.push(`${indexRelative}: a section row has an empty consumer column — the contract requires it filled`)
        continue
      }
      for (const raw of splitTopLevel(cell)) {
        const name = raw.replace(/\s*\([^)]*\)\s*$/, '').trim()
        if (/^(전체|\*|all)$/i.test(name)) continue
        if (knownAgents.size > 0 && !knownAgents.has(name)) {
          errors.push(`${indexRelative}: consumer "${name}" is not a known agent name — downstream agents cannot self-select on it`)
        }
      }
    }
    // 절 행 커버리지 — 디스크의 모든 절 파일은 **백틱 절 행**으로 커버되어야 한다. 위의
    // INDEX↔파일 검사는 평문 substring이라, 한 행만 백틱을 빼면(또는 5열 표로 적으면) 그 행이
    // 절 행 인식을 벗어나 빈 칸·미상 에이전트 검사를 조용히 건너뛸 수 있었다(리뷰 HIGH 지적 —
    // 부분 이탈 우회). 등재 검사와 절 행 인식을 같은 판정 기준으로 통합해 그 우회를 닫는다.
    // 표 전체 이탈(절 행 0건)도 같은 검사가 파일별로 잡으므로 별도 가드가 필요 없다.
    for (const name of readdirSync(join(projectRoot, entryPath)).filter(value => value.endsWith('.md') && value !== 'INDEX.md')) {
      if (!rowFiles.has(name)) {
        errors.push(`${join(entryPath, name)}: not covered by a 4-column section row (file column must carry \`${name}\`) — the consumer check cannot run for it`)
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
