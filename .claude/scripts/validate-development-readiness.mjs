#!/usr/bin/env node
// validate-development-readiness.mjs — Phase 3 **진입 관문**.
//
// 왜 이것이 필요한가(2026-08-30 실측): 하네스에는 `planning-readiness`(Phase 1 진입)와
// `design-readiness`(Phase 2 진입)가 있는데 **개발 진입에는 관문이 없었다.** 대신 Gate A·B·C가
// 개발 *도중에* 터졌다. 그래서 기획·디자인을 다 승인한 사용자가 개발을 시작한 뒤에도 계속
// 막혔고, 막힐 때마다 하네스 내부 사정(스팩 digest·계획 잠금·소유권 root)을 알아야 풀리는
// 질문을 받았다.
//
// **원칙**: 개발 단계에서 사용자에게 가는 질문은 없다. 문서에서 도출되면 도출해서 진행하고,
// 도출되지 않으면 선택지가 아니라 "상류 산출물의 이 부분이 비어 있다"는 BLOCKED다. 그리고
// 그 BLOCKED는 **첫 줄을 쓰기 전에** 나야 한다 — 그것이 이 파일의 존재 이유다.
//
// **자기 개선 규칙**: 개발 중 BLOCKED 중 **착수 전에 알 수 있었던 원인**으로 막힌 것은 이
// 관문의 **버그 리포트**다. 그 항목을 여기에 추가한다. 다만 Gate A·B·C에는 적용되지 않는다 —
// 방금 쓴 코드가 typecheck·lint를 깨서 막히는 것은 정당한 차단이고, 그것까지 "관문 버그"로
// 부르면 통과율을 위해 검증을 무르게 하는 압력이 된다(I2의 정반대).
// 판정 기준: **그 원인이 첫 줄을 쓰기 전에 존재했는가.**
//
// 하나라도 미해결이면 **한 번에 모아** 보고한다 — 하나씩 터뜨려 왕복을 만들지 않는다.
//
// 사용법:
//   node .claude/scripts/validate-development-readiness.mjs --project <root> [--json] [--fix]
// 종료 코드: 0 = 착수 가능, 1 = 미해결 항목 있음, 2 = 사용법/입력 오류.
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {pathToFileURL, fileURLToPath} from 'node:url'
import {execFileSync} from 'node:child_process'
import {digestInputs, inspectSpecLedger, isSpecStale} from './spec.mjs'
import {analyzeEnvironmentClosure, REQUIRED_SCRIPTS, WEB_APP_SCRIPTS} from './validate-environment-closure.mjs'
import {checkPlanAgainstSpec, readSpecAt, withinScope} from './validate-spawn-plan.mjs'
import {inspectPlanSpecBinding} from './resume-manifest.mjs'
import {TICKET_CLOSE_ASSETS, installTicketCloseAssets, planTicketCloseInstall} from './ticket/cli.mjs'

const OWNERSHIP_HOOK = fileURLToPath(new URL('./enforce-agent-ownership.mjs', import.meta.url))

// 판정 하나의 형태. `state`는 셋뿐이다 — 통과 · 미해결 · 검사하지 않음.
// **"검사하지 않음"을 통과로 세지 않는다**(축이 없으면 통과가 아니다).
const pass = (id, detail) => ({id, state: 'PASS', detail})
const fail = (id, detail, remedy, {fixable = false} = {}) => ({id, state: 'FAIL', detail, remedy, fixable})
const skip = (id, detail) => ({id, state: 'SKIPPED', detail})

// 스팩이 기록한 입력과 지금을 대조해 **무엇이 어떻게** 달라졌는지 낸다.
// `isSpecStale`은 참·거짓만 주는데, 그것만으로는 처방을 낼 수 없다.
export function diffSpecInputs(spec, root, {digest = null} = {}) {
  const now = digest ?? digestInputs(resolve(root))
  const before = new Map((spec?.sourceDigest?.inputs ?? []).map(item => [item.path, item]))
  const delta = []
  for (const record of now.inputs) {
    const prior = before.get(record.path)
    if (!prior) continue
    if (!prior.present && record.present) delta.push({path: record.path, kind: 'appeared'})
    else if (prior.present && !record.present) delta.push({path: record.path, kind: 'vanished'})
    else if (prior.present && record.present && prior.sha256 !== record.sha256) delta.push({path: record.path, kind: 'changed'})
  }
  return delta
}

// ── 1. 스팩 ─────────────────────────────────────────────────────────────────
// developer는 기본 소유권이 비어 있어 스팩이 없으면 디스크 변경 0건으로 반려된다.
export function checkSpec(root) {
  const specPath = join(root, '_workspace/03_dev/spec.json')
  if (!existsSync(specPath)) {
    return fail('spec', '_workspace/03_dev/spec.json이 없다',
      '설계(system-architect) 후 spec.mjs로 스팩을 확정한다 — developer 소유권의 유일한 공급원이다')
  }
  let spec
  try {
    spec = JSON.parse(readFileSync(specPath, 'utf8'))
  } catch (error) {
    return fail('spec', `spec.json을 읽을 수 없다: ${error.message}`, '스팩을 재확정한다 — 깨진 스팩을 부재로 강등하지 않는다')
  }
  if (isSpecStale(spec, root)) {
    // "입력이 바뀌었다"만으로는 무엇을 해야 할지 알 수 없다. **무엇이 어떻게** 바뀌었는지
    // 말한다 — 없던 파일이 생긴 것과 내용이 바뀐 것은 처방이 다르다.
    const delta = diffSpecInputs(spec, root)
    if (delta.length === 0) {
      // 입력 **목록 자체**가 바뀌었다(하네스 업그레이드). 파일이 바뀐 게 아니다 —
      // "없다가 생겼다"는 처방을 내면 원인을 반대로 가리킨다.
      return fail('spec', '입력 목록이 스팩 확정 당시와 다르다 — 하네스가 보는 입력 집합이 바뀌었다',
        'spec.mjs로 재확정한다. 문서가 바뀐 것이 아니라 하네스 쪽 변경이므로 결정을 다시 볼 필요는 없다')
    }
    const appeared = delta.filter(item => item.kind === 'appeared').map(item => item.path)
    const detail = delta.map(item => `${item.path}(${{appeared: '새로 생김', vanished: '사라짐', changed: '내용 바뀜'}[item.kind]})`).join(' · ')
    return fail('spec', `스팩 확정 뒤 입력이 바뀌었다: ${detail}`,
      appeared.length === delta.length
        ? '전부 "없다가 생긴" 경우다 — 결정이 달라진 것이 아니라 순서 문제이므로 spec.mjs 재확정으로 닫힌다'
        : 'spec.mjs로 재확정한다. 확정 이후 바뀐 문서 위에서 개발하면 스팩이 정본 노릇을 못 한다')
  }
  const ledger = inspectSpecLedger(root, spec)
  if (ledger.state === 'TAMPERED') {
    return fail('spec', '스팩이 원장 기록과 다르다 — 확정 뒤 수정됐다', '원장에 남은 확정으로 되돌리거나 정식으로 재확정한다')
  }
  return pass('spec', `확정됨 · ${spec.specTier ?? 'tier 미상'} · layerMap ${Object.keys(spec.layerMap ?? {}).length}개`)
}

// ── 2. 소유권 예행 ──────────────────────────────────────────────────────────
// **실제 훅을 돌려본다.** 스팩이 있어도 훅이 막으면 개발은 0줄이다 — 2026-08-30에 중첩
// 프로젝트에서 정확히 그랬고, 스폰을 띄우고 나서야 알았다. 여기서 먼저 안다.
//
// 무엇을 찔러보는가: **실효 범위**다. 훅은 developer 판정에서 layerMap을 change-scope의
// ALLOWED_PATHS로 다시 좁힌다. layerMap 전체를 찌르면 티켓 픽업 뒤에는 범위 밖 레이어가
// 전부 차단으로 나와 **정당한 티켓 개발이 진입 봉쇄된다**(적대 리뷰 2026-08-30이 잡은 오탐).
// 범위가 발급돼 있으면 그 범위를, 없으면 layerMap을 예행한다.
export function effectiveProbePaths(root, spec, {allowedPaths = null} = {}) {
  const layers = [...Object.values(spec?.layerMap ?? {}), ...Object.values(spec?.testLayers ?? {})]
    .filter(value => typeof value === 'string' && value.trim())
  const scope = allowedPaths ?? readAllowedPathsFromScope(root)
  if (!scope || scope.length === 0) return {paths: layers, narrowed: false}
  // 범위는 소유권을 넓히지 못한다 — 교집합만 예행한다(훅의 intersectWithScope와 같은 뜻).
  const inside = scope.filter(entry => layers.some(layer => withinScope(entry.replace(/\/+\*+$/, '').replace(/\/+$/, ''), layer)
    || withinScope(layer, entry)))
  return {paths: inside.length > 0 ? inside : layers, narrowed: inside.length > 0}
}

// change-scope의 기계 정본(```json change-scope 펜스)에서 ALLOWED_PATHS를 읽는다.
// 훅과 같은 자리를 본다 — 다른 자리를 보면 예행과 실제가 갈린다.
export function readAllowedPathsFromScope(root) {
  const path = join(root, '_workspace/03_dev/change-scope.md')
  if (!existsSync(path)) return null
  let source
  try { source = readFileSync(path, 'utf8') } catch { return null }
  const fence = source.match(/```json\s+change-scope\s*\n([\s\S]*?)\n```/)
  if (!fence) return null
  try {
    const parsed = JSON.parse(fence[1])
    const paths = parsed?.ALLOWED_PATHS
    return Array.isArray(paths) ? paths.filter(value => typeof value === 'string' && value.trim()) : null
  } catch { return null }
}

// 반드시 **차단돼야** 하는 경로. 이것이 허용으로 나오면 예행 배선이 죽은 것이다 —
// 훅은 tool_name·agent_type이 어긋나면 조용히 exit 0(허용)이므로, 음성 컨트롤 없이는
// "전부 허용"과 "배선 사망"을 구분할 수 없다(적대 리뷰 2026-08-30: fail-open).
const NEGATIVE_CONTROL = '_workspace/03_dev/spec.json'

export function checkOwnership(root, spec, {run = null, allowedPaths = null} = {}) {
  const {paths, narrowed} = effectiveProbePaths(root, spec, {allowedPaths})
  if (paths.length === 0) return skip('ownership', '스팩에 layerMap·testLayers가 없어 예행할 경로가 없다')
  const exec = run ?? ((agentType, filePath) => {
    const payload = JSON.stringify({tool_name: 'Write', agent_type: agentType, cwd: root, tool_input: {file_path: filePath}})
    try {
      execFileSync(process.execPath, [OWNERSHIP_HOOK], {input: payload, cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']})
      return {allowed: true, message: ''}
    } catch (error) {
      return {allowed: false, message: String(error.stderr ?? '').trim()}
    }
  })
  const control = exec('developer', resolve(root, NEGATIVE_CONTROL))
  if (control.allowed) {
    return fail('ownership', `예행 배선이 죽었다 — 반드시 차단돼야 할 ${NEGATIVE_CONTROL}이 허용으로 나온다`,
      '훅 입력 스키마가 어긋났을 가능성이 높다. 이 상태의 "쓰기 가능"은 근거가 없으므로 통과로 세지 않는다')
  }
  // 각 경로의 대표 하나씩 — 디렉터리면 그 안의 probe 파일, 파일 항목이면 그 파일.
  const blocked = []
  for (const layer of paths) {
    const clean = layer.replace(/\/+\*+$/, '').replace(/\/+$/, '')
    const probe = /\.[^./]+$/.test(clean) ? clean : `${clean}/__readiness_probe__.ts`
    const result = exec('developer', resolve(root, probe))
    if (!result.allowed) blocked.push({path: probe, message: result.message.replace(/^Blocked:\s*/, '')})
  }
  const what = narrowed ? '스폰 범위' : '스팩이 선언한'
  if (blocked.length === 0) return pass('ownership', `${what} ${paths.length}개 경로 전부 쓰기 가능`)
  return fail('ownership',
    `${what} ${blocked.length}/${paths.length}개 경로에 쓰지 못한다: ${blocked.map(b => b.path).join(', ')}`,
    `첫 차단 사유: ${blocked[0].message}`)
}

// ── 3. 계획 ↔ 스팩 ──────────────────────────────────────────────────────────
export function checkPlans(root, spec) {
  const dir = join(root, '_workspace/03_dev/build-manifest')
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return skip('plans', '스폰 계획이 아직 없다 — 계획 단계에서 validate-spawn-plan이 대조한다')
  }
  const manifests = readdirSync(dir).filter(name => name.endsWith('.json')).sort()
  if (manifests.length === 0) return skip('plans', '스폰 계획이 아직 없다')
  const problems = []
  for (const name of manifests) {
    const path = join(dir, name)
    let manifest
    try { manifest = JSON.parse(readFileSync(path, 'utf8')) } catch { problems.push(`${name}: 파싱 불가`); continue }
    const binding = inspectPlanSpecBinding(root, manifest.planLock, path, spec)
    if (binding.state === 'STALE') problems.push(`${name}: 다른 스팩 위에서 잠겼다(PLAN_LOCK_SPEC_STALE)`)
    if (binding.state === 'SPEC_GONE') problems.push(`${name}: 결속된 스팩이 사라졌다`)
    const check = checkPlanAgainstSpec(manifest, spec)
    if (check.state === 'CHECKED') {
      if (check.outsideOwnership.length > 0) problems.push(`${name}: 아무도 소유하지 않는 경로 ${check.outsideOwnership.join(', ')}`)
      if (check.outsideBoundary?.length > 0) problems.push(`${name}: 모듈 경계 밖 ${check.outsideBoundary.join(', ')}`)
    }
  }
  if (problems.length === 0) return pass('plans', `계획 ${manifests.length}개 전부 스팩과 정합`)
  return fail('plans', problems.join(' · '),
    '정본은 스팩이다 — 계획을 스팩에 맞춰 새 task 이름으로 재계획한다(사용자에게 어느 쪽인지 묻지 않는다)')
}

// ── 4. 환경 폐곡선 ──────────────────────────────────────────────────────────
export function checkEnvironment(root, spec) {
  const packagePath = join(root, 'package.json')
  if (!existsSync(packagePath)) {
    // greenfield는 `package.json`을 Phase 3의 environment-scaffolder가 만든다. 진입 시점에
    // 없는 것이 정상이며, 이때 FAIL을 내면 "아직 돈 적 없는 단계로 되돌리라"는 처방이 된다
    // (적대 리뷰 2026-08-30). **통과로 세지도 않는다** — scaffold 후 이 관문을 다시 밟는다.
    return skip('environment', 'package.json이 아직 없다(greenfield) — environment-scaffolder가 만든 뒤 이 관문을 다시 밟는다')
  }
  let packageJson
  try { packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) } catch (error) {
    return fail('environment', `package.json 파싱 실패: ${error.message}`, '매니페스트를 고친다')
  }
  const webApp = (spec?.targetShapes ?? []).includes('web-app')
  const entries = existsSync(root) ? readdirSync(root) : []
  // analyzeEnvironmentClosure는 **누락 목록**을 돌려준다(빈 배열 = 폐곡선 성립).
  const missing = analyzeEnvironmentClosure({packageJson, entries, webApp})
  if (missing.length === 0) {
    return pass('environment', `필수 script ${REQUIRED_SCRIPTS.length + (webApp ? WEB_APP_SCRIPTS.length : 0)}개·lint 도구·설정 존재`)
  }
  return fail('environment', missing.map(item => item.detail).join(' · '),
    'environment-scaffolder로 되돌린다 — 도구가 없으면 Gate A·B·C의 lint·typecheck 축이 "미구성"으로 조용히 사라진다')
}

// ── 5. 확정 결정이 실물에 반영됐는가 ────────────────────────────────────────
// 스팩이 `confirmed`로 잠근 라이브러리가 매니페스트에 없으면, 그것을 쓰는 첫 티켓에서
// 막힌다. 확정과 설치 사이의 간극은 **개발 전에** 닫는다(2026-08-30: cva·prettier 실측).
// 패키지가 아니라 **의식적 부재**를 뜻하는 값들. 이것을 패키지명으로 읽으면
// "안 쓰기로 확정했다"가 곧바로 실패가 된다(자체 실측 2026-08-30).
const NO_PACKAGE = new Set(['none', 'na', 'n/a', '없음', '미채택', '미사용'])

export function checkDecisionsApplied(root, spec) {
  const packagePath = join(root, 'package.json')
  if (!existsSync(packagePath)) return skip('decisions', 'package.json이 없어 대조할 수 없다')
  let deps
  try {
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
    deps = new Set(Object.keys({...packageJson.dependencies, ...packageJson.devDependencies}))
  } catch { return skip('decisions', 'package.json 파싱 불가') }

  const missing = []
  for (const [role, entry] of Object.entries(spec?.libraries ?? {})) {
    if (!['confirmed', 'declared'].includes(entry?.source)) continue
    // choice는 "a + b + c"처럼 여러 패키지를 담을 수 있다. 패키지명처럼 보이는 토큰만 본다.
    // 명시 탈출구. 런타임 내장(`fetch`)이나 도구 번들에 포함된 선택은 패키지가 없다 —
    // 없는 패키지를 요구하면 게이트를 위해 안 쓸 것을 설치하게 만든다(실물 왜곡).
    // 자기진술이므로 스팩에 남아 사람이 볼 수 있다.
    if (entry?.provided === 'built-in') continue
    for (const token of String(entry.choice ?? '').split(/[+,·]/).map(v => v.trim()).filter(Boolean)) {
      if (!/^[@a-z0-9][\w./-]*$/i.test(token)) continue
      // 의식적 부재는 결함이 아니다 — `none`을 패키지로 요구하면 "안 쓰기로 했다"가 실패가 된다.
      if (NO_PACKAGE.has(token.toLowerCase())) continue
      if (!deps.has(token)) missing.push(`${role}: ${token}`)
    }
  }
  for (const key of ['lint', 'formatter']) {
    const entry = spec?.constitution?.substrate?.[key]
    const tool = entry?.value
    if (!tool || NO_PACKAGE.has(String(tool).toLowerCase())) continue
    if (!deps.has(tool)) missing.push(`substrate.${key}: ${tool}`)
  }
  if (missing.length === 0) return pass('decisions', '확정된 라이브러리·도구가 매니페스트에 전부 있다')
  return fail('decisions', `스팩이 확정했는데 설치되지 않았다: ${missing.join(', ')}`,
    'environment-scaffolder로 의존성을 추가한 뒤 개발을 시작한다 — 이것을 쓰는 첫 티켓에서 막히는 것보다 낫다')
}

// ── 6. 티켓 자산 ────────────────────────────────────────────────────────────
// 팀 흐름을 쓰는 프로젝트에서만 본다. 청구 원장이 있으면 팀 흐름이다.
export function checkTicketAssets(root, {install = false} = {}) {
  if (!existsSync(join(root, '_workspace/03_dev/identity-ledger.jsonl'))) {
    return skip('ticket-assets', '팀 흐름(청구 원장)을 쓰지 않는 프로젝트다')
  }
  const plan = planTicketCloseInstall(root)
  if (plan.missingAssets.length > 0) return skip('ticket-assets', `배포본에 자산이 없다: ${plan.missingAssets.join(', ')}`)
  if (plan.install.length === 0) return pass('ticket-assets', `자동 닫기 자산 ${plan.present.length}개 설치됨`)
  if (install) {
    const written = installTicketCloseAssets(root, plan)
    return pass('ticket-assets', `설치함: ${written.join(', ')} — 커밋·push는 브랜치 소유자 몫이다`)
  }
  return fail('ticket-assets', `이슈 자동 닫기 자산 미설치: ${plan.install.map(e => e.target).join(', ')}`,
    '--fix로 설치한다. 없으면 청구 브랜치 머지에도 이슈가 열린 채 남아 보드와 어긋난다', {fixable: true})
}

export const CHECKS = ['spec', 'ownership', 'plans', 'environment', 'decisions', 'ticket-assets']

export function analyzeDevelopmentReadiness(root, {install = false, hookRun = null} = {}) {
  const specResult = checkSpec(root)
  const spec = specResult.state === 'PASS' ? readSpecAt(root) : null
  const results = [specResult]
  // 스팩이 없으면 스팩에 의존하는 검사는 **검사 미수행**이다 — 통과로 세지 않는다.
  results.push(spec ? checkOwnership(root, spec, {run: hookRun}) : skip('ownership', '스팩이 없어 예행할 수 없다'))
  results.push(spec ? checkPlans(root, spec) : skip('plans', '스팩이 없어 대조할 수 없다'))
  results.push(checkEnvironment(root, spec))
  results.push(spec ? checkDecisionsApplied(root, spec) : skip('decisions', '스팩이 없어 대조할 수 없다'))
  results.push(checkTicketAssets(root, {install}))
  const failures = results.filter(r => r.state === 'FAIL')
  return {
    schemaVersion: 1,
    verdict: failures.length === 0 ? 'READY' : 'BLOCKED',
    results,
    failures,
    skipped: results.filter(r => r.state === 'SKIPPED'),
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  const projectIndex = argv.indexOf('--project')
  const projectRoot = projectIndex >= 0 ? argv[projectIndex + 1] : undefined
  if (!projectRoot) {
    process.stderr.write('사용법: node .claude/scripts/validate-development-readiness.mjs --project <root> [--json] [--fix]\n')
    process.exit(2)
  }
  const root = resolve(projectRoot)
  const report = analyzeDevelopmentReadiness(root, {install: argv.includes('--fix')})
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    process.stdout.write('개발 착수 준비 점검\n')
    for (const result of report.results) {
      const mark = result.state === 'PASS' ? '✅' : result.state === 'FAIL' ? '❌' : '· '
      process.stdout.write(`  ${mark} ${result.id}: ${result.detail}\n`)
      if (result.state === 'FAIL') process.stdout.write(`      → ${result.remedy}\n`)
    }
    if (report.verdict === 'READY') {
      process.stdout.write('\nREADY ✅ — 개발을 시작한다. 이 뒤로는 묻지 않는다.\n')
    } else {
      process.stdout.write(`\nBLOCKED ⛔ — 미해결 ${report.failures.length}건. 첫 줄을 쓰기 전에 여기서 닫는다.\n`)
      if (report.failures.some(f => f.fixable)) process.stdout.write('  일부는 --fix로 해소된다.\n')
    }
  }
  process.exit(report.verdict === 'READY' ? 0 : 1)
}
