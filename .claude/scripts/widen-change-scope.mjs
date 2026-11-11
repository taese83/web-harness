#!/usr/bin/env node
// widen-change-scope.mjs — 이번 라운드의 쓰기 범위(change-scope ALLOWED_PATHS)에 경로를 더한다.
//
// developer는 스팩 layerMap ∩ 범위만 쓴다. 범위 밖이지만 layerMap 안인 파일(예: 토큰 파일 한 줄)을 고쳐야 할 때 범위 문서를
// 손으로 고치면 소유권을 스스로 넓히는 모양이라 막히거나(자동 모드) 흔적이 흐려진다. 이 명령이 그 넓히기의 유일한 길이다:
//   - layerMap 밖 경로는 검사 정의 표면(패키지·도구 설정·CI·훅)·설계 문서가 아닐 때만 넓힌다(승인 범위가 상한) — 그 표면은 스팩 변경이다
//   - 계획 패스(`PHASE: plan`)에서는 넓히지 않는다 — source는 ✋ 뒤 구현 범위에서만 쓴다
//   - 기본은 미리보기(쓰기 0), `--apply`만 새 범위 항목을 끝에 덧붙인다(사람 승인 훅이 사용자 확인으로 묻는다)
//
// 사용법: node .claude/scripts/widen-change-scope.mjs --project-root <path> --add <path> [--add <path> …] --reason <한 줄> [--apply]
// 종료 코드: 0 = 미리보기·적용 완료 또는 넓힐 것 없음, 1 = 넓힐 수 없다(layerMap 밖·계획 패스·범위 없음), 2 = 사용법 오류.
import {appendFileSync, existsSync, readFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {answerHelp} from './cli-help-lib.mjs'
import {parseChangeScopeAllowedPaths} from './change-scope-lib.mjs'
import {isScopeGrantable, resolveDeveloperOwnership} from './agent-registry.mjs'

export const SCOPE_PATH = '_workspace/03_dev/change-scope.md'
const SPEC_PATH = '_workspace/03_dev/spec.json'
const normalize = path => String(path).trim().replace(/^\.\//, '')

/** 넓히기 계획(순수 판정 + 파일 읽기). */
export function planScopeWidening({root, add, reason}) {
  const scopePath = join(root, SCOPE_PATH)
  if (!existsSync(scopePath)) return {ok: false, code: 'NO_SCOPE', guidance: `${SCOPE_PATH}가 없다 — 범위는 pickup·change 레인이 발급한다`}
  const scope = parseChangeScopeAllowedPaths(readFileSync(scopePath, 'utf8'))
  if (scope.error) return {ok: false, code: 'SCOPE_UNREADABLE', guidance: `현재 범위를 읽지 못했다: ${scope.error}`}
  if (!scope.paths || scope.paths.length === 0) return {ok: false, code: 'NO_SCOPE', guidance: '현재 범위 항목이 없다 — 넓힐 기준이 없다'}
  if (scope.phase === 'plan') {
    return {ok: false, code: 'PLAN_PHASE', guidance: '계획 패스 범위다 — source는 ✋ 승인 뒤 구현 범위에서 쓴다. 넓히지 않는다'}
  }
  let spec = null
  try { spec = JSON.parse(readFileSync(join(root, SPEC_PATH), 'utf8')) } catch { /* 아래에서 막는다 */ }
  const owned = resolveDeveloperOwnership(spec)
  if (!owned) return {ok: false, code: 'NO_SPEC_OWNERSHIP', guidance: `${SPEC_PATH}의 layerMap이 없다 — 스팩을 먼저 확정한다`}
  const requested = [...new Set(add.map(normalize).filter(Boolean))]
  // layerMap 밖이어도 검사 정의 표면이 아니면 사용자 확인으로 범위에 넣는다(승인 범위가 상한 — agent-registry isScopeGrantable).
  const outside = requested.filter(path => !owned.some(pattern => pattern.test(path)) && !isScopeGrantable(path))
  if (outside.length > 0) {
    return {ok: false, code: 'GATE_SURFACE', outside,
      guidance: `검사를 정의하는 파일(패키지·도구 설정·CI·훅)·비밀 이름 파일·설계 문서다: ${outside.join(', ')} — 범위로 열지 않는다(environment-scaffolder·담당 설계자, 또는 system-architect가 레이어로 더한 뒤 재확정)`}
  }
  // 범위가 산문 한 줄 표기면 layerMap 밖을 열지 못한다 — 요청 경로를 펜스로 다시 적는다(이미 적혀 있어도).
  const added = scope.fenced ? requested.filter(path => !scope.paths.includes(path)) : requested
  if (!String(reason ?? '').trim()) return {ok: false, code: 'REASON_REQUIRED', guidance: '--reason <한 줄>로 왜 넓히는지 남긴다 — 리뷰가 범위 이탈과 구분한다'}
  // 사유는 범위 문서(파서가 읽는 마크다운)에 덧붙는다 — 줄바꿈·백틱이 섞이면 새 펜스·범위 줄을 흉내 낼 수 있다.
  if (/[\r\n`]/.test(String(reason)) || String(reason).length > 200) {
    return {ok: false, code: 'REASON_INVALID', guidance: '--reason은 200자 이내 한 줄, 백틱 없이 쓴다'}
  }
  return {ok: true, current: scope.paths, added, next: [...new Set([...scope.paths, ...added])], reason: String(reason).trim()}
}

export function applyScopeWidening({root, plan, now = new Date()}) {
  const entry = `\n\n## 범위 확장 (${now.toISOString().slice(0, 10)})\n\n사유: ${plan.reason}\n\n` +
    '```json change-scope\n' + `${JSON.stringify({ALLOWED_PATHS: plan.next, WIDENED: plan.added})}\n` + '```\n'
  appendFileSync(join(root, SCOPE_PATH), entry)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  answerHelp(import.meta.url)
  const argv = process.argv.slice(2)
  const add = []
  let root = null
  let reason = null
  let apply = false
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]
    if (option === '--apply') { apply = true; continue }
    const value = argv[index + 1]
    if (value === undefined || !['--project-root', '--add', '--reason'].includes(option)) {
      process.stderr.write('사용법: node .claude/scripts/widen-change-scope.mjs --project-root <path> --add <path> [--add <path> …] --reason <한 줄> [--apply]\n')
      process.exit(2)
    }
    if (option === '--project-root') root = resolve(value)
    else if (option === '--add') add.push(value)
    else reason = value
    index += 1
  }
  if (!root || add.length === 0) {
    process.stderr.write('사용법: node .claude/scripts/widen-change-scope.mjs --project-root <path> --add <path> [--add <path> …] --reason <한 줄> [--apply]\n')
    process.exit(2)
  }
  const plan = planScopeWidening({root, add, reason})
  if (!plan.ok) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
    process.exit(1)
  }
  if (plan.added.length === 0) {
    process.stdout.write(`${JSON.stringify({...plan, action: 'none', guidance: '이미 범위 안이다'}, null, 2)}\n`)
    process.exit(0)
  }
  if (!apply) {
    process.stdout.write(`${JSON.stringify({...plan, action: 'preview',
      guidance: '사용자가 확인하면 --apply로 다시 부른다 — 새 범위 항목을 change-scope 끝에 덧붙인다(이전 범위는 그대로 남는다)'}, null, 2)}\n`)
    process.exit(0)
  }
  applyScopeWidening({root, plan})
  process.stdout.write(`${JSON.stringify({...plan, action: 'applied'}, null, 2)}\n`)
}
