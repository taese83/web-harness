#!/usr/bin/env node
// UI 레인 방출-선택 일치 검사 (M4 tier b — §4 "UI_LANE 산문 결정" 행의 기계 해소).
//
// 배경: UI_LANE은 tech-stack.md 기록 + 빌더 산문 준수뿐이라, "선택은 tailwind-shadcn인데
// 빌더가 MUI를 방출"하는 침묵 불일치를 아무 기계도 잡지 못했다(정찰 R1, HIGH). 이 검사가
// 선언된 레인과 src/의 실제 import를 대조한다.
//
// 선언 소스(우선순위): ① _workspace/02_design/integration-overlay.json의 uiLibrary.uiLane
// (브라운필드 실측 — tech-advisor 규칙과 동일하게 우선) ② _workspace/01_plan/tech-stack.md의
// `UI_LANE: <lane>` 라인. 둘 다 없으면 통과가 아니라 **UNDECLARED(검사 미수행)**로 보고한다
// (validate-output-language 관용구 — 조용한 통과 차단).
//
// 사용법:
//   node .claude/scripts/validate-ui-lane.mjs --project <dir> [--json]
// 종료코드: 0 = 일치 또는 UNDECLARED(명시 보고), 1 = 교차-레인 위반, 2 = 사용법·경로 오류

import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs'
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'

// 레인별 교차-금지 import 접두어. 각 레인의 정의적 시그널만 잡는다 — Radix는 mui 레인에서도
// 헤드리스 개별 조합(lib-catalog §헤드리스)으로 정당할 수 있어 대상에서 제외한다.
const CROSS_LANE_IMPORTS = {
  mui: ['tailwindcss', '@tailwindcss/', 'class-variance-authority', 'tailwind-merge'],
  'tailwind-shadcn': ['@mui/', '@emotion/'],
}
const KNOWN_LANES = new Set(Object.keys(CROSS_LANE_IMPORTS))
// 브라운필드 앱은 .js/.jsx가 흔하므로 4확장자 전부 스캔한다(리뷰 지적 — overlay가 의미 있는
// 곳이 정확히 브라운필드다).
const SCANNABLE = /\.(?:ts|tsx|js|jsx)$/
// 정적 import/재수출(export … from)·side-effect import·dynamic import()·require() 전부 매칭.
// 리뷰 실측: 초기 정규식은 barrel 재수출(export {X} from '@mui/material')과 dynamic
// import('@mui/material')를 놓쳤다 — 이 validator가 잡도록 설계된 R1 시나리오의 우회 경로였다.
const IMPORT_SOURCE =
  /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]|(?:import|require)\(\s*['"]([^'"]+)['"]\s*\)/g

const argv = process.argv.slice(2)
const jsonOutput = argv.includes('--json')
const options = argv.filter(value => value !== '--json')
if (options.length !== 2 || options[0] !== '--project') {
  process.stderr.write('Usage: validate-ui-lane.mjs --project <directory> [--json]\n')
  process.exit(2)
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
let projectRoot
try {
  projectRoot = resolve(options[1])
  if (!statSync(projectRoot).isDirectory()) throw new Error('not a directory')
} catch {
  process.stderr.write('UI lane project must be an existing directory.\n')
  process.exit(2)
}
// validate-artifact-sharding과 동일한 경계 — 하네스 저장소 또는 현재 세션 프로젝트 내부만.
const escapesRoot = root => {
  if (!root) return true
  const offset = relative(resolve(root), projectRoot)
  return offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)
}
if (escapesRoot(repositoryRoot) && escapesRoot(process.env.CLAUDE_PROJECT_DIR)) {
  process.stderr.write('UI lane validation must stay inside the harness repository or the current session project.\n')
  process.exit(2)
}

// ── 선언 레인 해석
const readIfExists = path => (existsSync(path) ? readFileSync(path, 'utf8') : null)
let declaredLane = null
let declarationSource = null

const overlayRaw = readIfExists(join(projectRoot, '_workspace/02_design/integration-overlay.json'))
if (overlayRaw !== null) {
  try {
    const lane = JSON.parse(overlayRaw)?.uiLibrary?.uiLane
    if (typeof lane === 'string' && KNOWN_LANES.has(lane)) {
      declaredLane = lane
      declarationSource = 'integration-overlay.json (brownfield 실측 — 우선)'
    } else if (typeof lane === 'string') {
      // 리뷰 지적: 우선 신호(overlay 실측)가 깨진 값이면 조용한 폴백이 아니라 loud 실패다 —
      // 오타·미지원 레인이 tech-stack의 다른 선언으로 조용히 대체되면 우선순위 계약이 무너진다.
      process.stdout.write(
        `${JSON.stringify({status: 'UNKNOWN_LANE_DECLARATION', declared: lane, summary: `integration-overlay.json의 uiLibrary.uiLane='${lane}'은 알려진 레인(${[...KNOWN_LANES].join(', ')})이 아니다`}, null, 2)}\n`,
      )
      process.exit(1)
    }
  } catch {
    // 파싱 실패는 overlay 스키마 검증의 몫 — 여기서는 tech-stack 폴백으로 진행
  }
}
if (declaredLane === null) {
  const techStack = readIfExists(join(projectRoot, '_workspace/01_plan/tech-stack.md'))
  const match = techStack?.match(/UI_LANE:\s*([a-z-]+)/)
  if (match && KNOWN_LANES.has(match[1])) {
    declaredLane = match[1]
    declarationSource = 'tech-stack.md'
  }
}

const emit = payload => {
  if (jsonOutput) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
  else {
    for (const violation of payload.violations ?? []) process.stderr.write(`- ${violation}\n`)
    process.stdout.write(`${payload.summary}\n`)
  }
}

if (declaredLane === null) {
  emit({
    status: 'UNDECLARED',
    violations: [],
    summary:
      'UI lane UNDECLARED — tech-stack.md의 `UI_LANE:` 또는 integration-overlay.json의 uiLibrary.uiLane이 없어 검사를 수행하지 못했다(통과가 아님).',
  })
  process.exit(0)
}

// ── src/ import 스캔
const forbidden = CROSS_LANE_IMPORTS[declaredLane]
const violations = []
let scannedFiles = 0
const walk = current => {
  if (!existsSync(current)) return
  for (const entry of readdirSync(current, {withFileTypes: true})) {
    const path = join(current, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      walk(path)
      continue
    }
    if (!SCANNABLE.test(entry.name)) continue
    scannedFiles += 1
    const source = readFileSync(path, 'utf8')
    for (const match of source.matchAll(IMPORT_SOURCE)) {
      const specifier = match[1] ?? match[2] ?? match[3]
      if (!specifier) continue
      for (const prefix of forbidden) {
        if (specifier === prefix || specifier.startsWith(prefix)) {
          violations.push(
            `${relative(projectRoot, path)}: '${specifier}' import는 선언 레인 '${declaredLane}'(${declarationSource})과 교차한다 — 한 앱에 두 레인 금지`,
          )
        }
      }
    }
  }
}
walk(join(projectRoot, 'src'))

if (violations.length > 0) {
  const shown = violations.slice(0, 50)
  if (violations.length > 50) shown.push(`외 ${violations.length - 50}건`)
  emit({
    status: 'CROSS_LANE',
    declaredLane,
    declarationSource,
    scannedFiles,
    violations: shown,
    summary: `UI lane 교차 위반 ${violations.length}건 (선언: ${declaredLane}, 스캔 ${scannedFiles}파일)`,
  })
  process.exit(1)
}
emit({
  status: 'PASS',
  declaredLane,
  declarationSource,
  scannedFiles,
  violations: [],
  summary: `UI lane 일치 (선언: ${declaredLane} · ${declarationSource}, 스캔 ${scannedFiles}파일)`,
})
process.exit(0)
