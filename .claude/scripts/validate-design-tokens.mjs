#!/usr/bin/env node
// 디자인 토큰 선언-상태 일치 검사 (validate-ui-lane의 형제).
//
// 배경: 하네스는 Figma를 **인제스트**할 수 있다(source-artifacts.md §Figma MCP). 그러나 인제스트는
// 1회 스냅샷이고, "선언한 디자인 원본이 지금 읽히는가 · 그 값이 코드에 실제로 채워졌는가"를
// 대조하는 기계가 없었다. 산문(design-system-architect 규칙 7 "…매핑을 명세한다")뿐이었다.
//
// 이 검사는 **원본을 다시 읽지 않는다.** 로컬 파일만 본다 — ingestor는 Bash가 없어 해시를
// 계산하지 못하고(같은 문서 「이 경로가 남기지 못하는 것」), 스크립트는 Bash를 갖지만 MCP를
// 부르지 못한다. 그 사이에서 **지금 할 수 있는 것**이 선언과 로컬 토큰 파일의 대조다.
// 원본 값과의 대조는 REST API 경로가 열릴 때 붙는다 — 여기서 흉내 내지 않는다.
//
// 사용법:
//   node .claude/scripts/validate-design-tokens.mjs --project <dir> [--json]
// 종료코드: 0 = 일치 또는 UNDECLARED/SKIPPED(명시 보고), 1 = 위반, 2 = 사용법·경로 오류

import {existsSync, readFileSync, statSync} from 'node:fs'
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'

// 토큰 값이 아직 채워지지 않았음을 나타내는 표기. `unset`은 CSS-wide 키워드라 var()가 참조하면
// 초기값으로 떨어진다 — "값이 없다"를 문법으로 강제하는 관용구이지 실제 토큰 값이 아니다.
// 실토큰이 `unset`을 값으로 갖는 경우는 사실상 없으므로 미해결로 판정한다.
const UNRESOLVED_VALUES = /^(?:unset|tbd|todo)$/i
// `--name: value;` 한 줄. 여러 줄 값(그라디언트 등)은 첫 줄만 보므로 미해결 판정에 영향이 없다.
const CUSTOM_PROPERTY = /^\s*(--[A-Za-z0-9_-]+)\s*:\s*([^;]*);/gm
// CSS 주석 제거. 실측(2026-09-02): 토큰 파일 주석에 `html[data-font="large"]`가 설명으로 적혀
// 있어, 그 모드가 **구현되지 않았는데도** selector 부분 문자열 검사가 통과했다. 주석은 설명이지
// 정의가 아니다 — 주석이 게이트를 통과시키면 이 검사는 있으나 마나다.
const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '')

const argv = process.argv.slice(2)
const jsonOutput = argv.includes('--json')
const options = argv.filter(value => value !== '--json')
if (options.length !== 2 || options[0] !== '--project') {
  process.stderr.write('Usage: validate-design-tokens.mjs --project <directory> [--json]\n')
  process.exit(2)
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
let projectRoot
try {
  projectRoot = resolve(options[1])
  if (!statSync(projectRoot).isDirectory()) throw new Error('not a directory')
} catch {
  process.stderr.write('Design token project must be an existing directory.\n')
  process.exit(2)
}
// validate-ui-lane·validate-artifact-sharding과 동일한 경계.
const escapesRoot = root => {
  if (!root) return true
  const offset = relative(resolve(root), projectRoot)
  return offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)
}
if (escapesRoot(repositoryRoot) && escapesRoot(process.env.CLAUDE_PROJECT_DIR)) {
  process.stderr.write('Design token validation must stay inside the harness repository or the current session project.\n')
  process.exit(2)
}

const emit = payload => {
  if (jsonOutput) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
  else {
    for (const violation of payload.violations ?? []) process.stderr.write(`- ${violation}\n`)
    for (const note of payload.notes ?? []) process.stdout.write(`· ${note}\n`)
    process.stdout.write(`${payload.summary}\n`)
  }
}

// ── 선언 해석
const specPath = join(projectRoot, '_workspace/03_dev/spec.json')
if (!existsSync(specPath)) {
  emit({
    status: 'UNDECLARED',
    violations: [],
    summary: 'design tokens UNDECLARED — _workspace/03_dev/spec.json이 없어 검사를 수행하지 못했다(통과가 아님).',
  })
  process.exit(0)
}
let designSource
try {
  designSource = JSON.parse(readFileSync(specPath, 'utf8'))?.designSource
} catch (error) {
  process.stderr.write(`spec.json을 읽지 못했다: ${error.message}\n`)
  process.exit(2)
}
if (!designSource) {
  emit({
    status: 'UNDECLARED',
    violations: [],
    summary:
      'design tokens UNDECLARED — spec.json에 designSource가 없어 검사를 수행하지 못했다(통과가 아님). 디자인 값이 있는 산출물이면 재확정 때 선언한다.',
  })
  process.exit(0)
}
if (designSource.kind === 'none') {
  emit({
    status: 'SKIPPED',
    violations: [],
    summary: "design tokens SKIPPED — designSource.kind='none'(디자인 값이 없는 산출물).",
  })
  process.exit(0)
}

// ── 토큰 파일
const violations = []
const notes = []
const tokenRelative = designSource.tokenPath
const tokenAbsolute = join(projectRoot, tokenRelative)
if (!existsSync(tokenAbsolute)) {
  emit({
    status: 'FAIL',
    violations: [`${tokenRelative}: designSource.tokenPath가 가리키는 파일이 없다`],
    summary: 'design tokens FAIL (1) — 선언한 토큰 파일이 존재하지 않는다.',
  })
  process.exit(1)
}
const source = stripComments(readFileSync(tokenAbsolute, 'utf8'))

// ── 미해결 토큰
const unresolved = []
let declaredCount = 0
for (const match of source.matchAll(CUSTOM_PROPERTY)) {
  declaredCount += 1
  if (UNRESOLVED_VALUES.test(match[2].trim())) unresolved.push(match[1])
}
notes.push(`토큰 ${declaredCount}개 선언 · 미해결 ${unresolved.length}개 (${tokenRelative})`)

// ── 모드 커버리지. selector는 부분 문자열 존재 검사다 — CSS를 파싱하지 않는다.
const missingModes = (designSource.modes ?? []).filter(mode => !source.includes(mode.selector))
for (const mode of missingModes) {
  violations.push(
    `${tokenRelative}: 선언한 모드 '${mode.name}'의 selector \`${mode.selector}\`가 토큰 파일에 없다 — 그 모드의 값이 어디에도 정의되지 않았다`,
  )
}

// ── 교차 검사: 읽을 수 없는 원본 + 미해결 토큰 = 채울 경로가 없다.
// 이 조합이 이 검사의 존재 이유다. 각각은 정상일 수 있다(아직 안 채웠거나, 채워졌는데 원본이
// 잠깐 안 읽히거나). 둘이 동시면 **막힌 것**이고, 그 사실은 사람이 알아야 한다.
if (designSource.readable === false && unresolved.length > 0) {
  violations.push(
    `designSource.readable=false 인데 미해결 토큰이 ${unresolved.length}개다 — 원본을 읽을 수 없어 채울 경로가 없다. ` +
      `원본을 읽을 수 있게 만들거나(kind='${designSource.kind}'), 값을 다른 경로로 확정해야 한다. 예: ${unresolved.slice(0, 4).join(', ')}`,
  )
}
if (designSource.readable === undefined) {
  notes.push(
    'designSource.readable이 선언되지 않았다 — 「감지는 선언이 아니라 실측이다」(source-artifacts.md). 다음 재확정 때 실측값을 적는다.',
  )
}

if (violations.length > 0) {
  emit({
    status: 'FAIL',
    kind: designSource.kind,
    tokenPath: tokenRelative,
    declaredTokens: declaredCount,
    unresolvedTokens: unresolved,
    missingModes: missingModes.map(mode => mode.name),
    violations,
    notes,
    summary: `design tokens FAIL (${violations.length}) — 선언과 토큰 파일이 어긋난다.`,
  })
  process.exit(1)
}

emit({
  status: 'PASS',
  kind: designSource.kind,
  tokenPath: tokenRelative,
  declaredTokens: declaredCount,
  unresolvedTokens: unresolved,
  missingModes: [],
  violations: [],
  notes,
  summary: `design tokens PASS — 선언한 모드 ${(designSource.modes ?? []).length}종이 모두 정의돼 있다.`,
})
