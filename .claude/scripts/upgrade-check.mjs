#!/usr/bin/env node
// upgrade-check.mjs — 하네스를 올린 뒤, 이전 버전이 만든 `_workspace` 산출물이 지금 규칙과 어디서 부딪히는지 한 번에 본다.
//
// 읽기 전용이다 — 아무것도 고치지 않는다. 항목마다 원인·지금 막는지·고치는 명령·커밋할 사람을 낸다. 레거시 문서는
// 팀 소유라 하네스가 조용히 고쳐 쓰지 않는다: 고칠 수 있는 것은 기존 명령(`--fix`·재확정·마이그레이션)을 알려 줄 뿐이다.
// 판정은 기존 검사를 그대로 부른다(Gate 0 검사·스팩 확정·프로필 잠금 대조) — 여기서 규칙을 새로 만들지 않는다.
//
// 구분:
//   blocks  지금 개발을 막는다(Gate 0 FAIL·러너가 멈추는 잠금)
//   on-touch 그 문서를 건드릴 때 적용된다(재확정하면 바뀌는 필드 등)
//   info    동작이 바뀌었을 뿐 고칠 것은 없다(레인 판정 등)
//
// 사용법: node .claude/scripts/upgrade-check.mjs --project-root <path> [--json] [--fast]
//   --fast  SessionStart 요약용 — 훅을 띄우는 소유권 예행을 건너뛴다(그 사실을 결과에 적는다).
import {existsSync, readFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {answerHelp} from './cli-help-lib.mjs'
import {harnessVersion, inspectSpecLedger, LockError, LOCK_ERROR_FIXES, lockSpec} from './spec.mjs'
import {analyzeDevelopmentReadiness, checkDecisionsApplied, checkEnvironment, checkPlans, checkSpec, checkTeamSharing, checkTicketAssets} from './validate-development-readiness.mjs'
import {readLockedProjectProfile, validateLockedProfileProjectState} from './web-core/profile-policy-lib.mjs'
import {diagnoseRootLock} from './migrate-profile-lock.mjs'

answerHelp(import.meta.url)

const SPEC_PATH = '_workspace/03_dev/spec.json'
// 안내하는 명령은 설치 형태에 맞춘다 — 플러그인이면 디스패처, 소스 checkout이면 스크립트 경로.
const PLUGIN = existsSync(new URL('../../.claude-plugin/plugin.json', import.meta.url))
const command = (name, args) => (PLUGIN ? `web-harness-script ${name} ${args}` : `node .claude/scripts/${name}.mjs ${args}`)
const PROFILE_PATH = '_workspace/01_plan/project-profile.json'
const SPEC_LEDGER_PATH = '_workspace/03_dev/spec-ledger.jsonl'
const readJson = path => { try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null } }

const item = (id, kind, detail, extra = {}) => ({id, kind, detail, ...extra})

// 재확정하면 무엇이 바뀌는가 — 입력이 그대로여도 새 규칙이 스팩 모양을 바꿀 수 있다(새 필드·새 기본값).
function specDrift(root, spec) {
  let fresh
  try {
    fresh = lockSpec(root)
  } catch (error) {
    if (error instanceof LockError) {
      return item('spec-relock', 'blocks', `지금 규칙으로는 스팩을 다시 확정할 수 없다: ${error.code} — ${error.message}`,
        {fix: LOCK_ERROR_FIXES[error.code] ?? null, commits: '설계 소유자(solution-design.md)'})
    }
    return item('spec-relock', 'info', `재확정을 시험하지 못했다(${error instanceof Error ? error.message : String(error)}) — 통과가 아니다`)
  }
  const changed = [...new Set([...Object.keys(spec), ...Object.keys(fresh)])]
    .filter(key => JSON.stringify(spec[key] ?? null) !== JSON.stringify(fresh[key] ?? null))
  if (changed.length === 0) return null
  return item('spec-relock', 'on-touch', `다시 확정하면 바뀌는 필드: ${changed.join(', ')} — 지금 잠금은 유효하고, 다음 확정(④) 때 반영된다`,
    {fix: `${command('spec', '--project-root .')} > _workspace/03_dev/spec.json (원장에 남는다)`, commits: 'spec.json·spec-ledger.jsonl — 브랜치 소유자'})
}

function profileLock(root) {
  const path = join(root, PROFILE_PATH)
  if (!existsSync(path)) return null
  try {
    validateLockedProfileProjectState(readLockedProjectProfile(path), root)
    return null
  } catch (error) {
    const rootLock = diagnoseRootLock(root, readJson(path))
    const detail = `${PROFILE_PATH}가 지금 프로젝트와 맞지 않아 품질 러너가 멈춘다: ${error?.code ?? 'INVALID'} — ${error instanceof Error ? error.message : String(error)}`
    // 마이그레이션은 루트 잠금만 옮긴다 — 그 밖의 무효 잠금에 그 명령을 가리키면 실행해도 거부된다.
    return rootLock
      ? item('profile-lock', 'blocks', `${detail} (패키지는 워크스페이스 멤버 ${rootLock.members.join(', ')}에 있다 — 루트에서 잠근 옛 프로필)`,
        {fix: `${command('migrate-profile-lock', '--project-root .')}로 미리보기 → 사람이 --apply(어댑터 검사가 빠지고 기본 검사로 돈다)`,
          commits: 'project-profile.json 삭제·spec.json·원장 — 브랜치 소유자'})
      : item('profile-lock', 'blocks', detail,
        {fix: `프로필을 다시 해석한다(${command('web-core/resolve-profile', '--project-root <앱 루트>')}) — 무엇으로 잠글지는 사람이 정한다`,
          commits: 'project-profile.json·spec.json·원장 — 브랜치 소유자'})
  }
}

export function upgradeCheck(projectRoot, {fast = false} = {}) {
  const root = resolve(projectRoot)
  if (!existsSync(join(root, '_workspace'))) return {schemaVersion: 1, harnessVersion: harnessVersion(), managed: false, items: []}
  const spec = readJson(join(root, SPEC_PATH))
  const ledger = spec ? inspectSpecLedger(root, spec) : null
  const items = []

  // Gate 0 — 지금 개발을 막는 것. 스팩·원장이 없으면 아직 개발 단계가 아니라 Gate 0 FAIL은 업그레이드 충돌이 아니다.
  // --fast는 훅 프로세스를 띄우는 소유권 예행만 건너뛴다(나머지는 파일만 읽는다).
  const developing = spec !== null || existsSync(join(root, SPEC_LEDGER_PATH))
  const readiness = !developing ? {results: []}
    : fast ? {results: [checkSpec(root), checkEnvironment(root, spec), ...(spec ? [checkPlans(root, spec), checkDecisionsApplied(root, spec)] : []),
      checkTicketAssets(root), checkTeamSharing(root)]}
      : analyzeDevelopmentReadiness(root)
  // FAIL만 막는다. WARN(저장소 위생)은 참고로 싣는다 — 고치는 명령은 그대로 알린다.
  for (const result of readiness.results.filter(r => r.state === 'FAIL' || r.state === 'WARN')) {
    items.push(item(`gate0:${result.id}`, result.state === 'FAIL' ? 'blocks' : 'info', result.detail, {
      fix: result.fixable ? command('validate-development-readiness', '--project . --fix') : (result.remedy ?? null),
      commits: result.fixable ? '덧붙인 설정 파일 — 브랜치 소유자' : null,
    }))
  }
  const profile = profileLock(root)
  if (profile) items.push(profile)
  if (spec) {
    const drift = specDrift(root, spec)
    if (drift) items.push(drift)
    if (spec.acceptanceSource !== 'feature-plan') {
      items.push(item('change-lane', 'info',
        '스팩이 기획(feature-plan)을 결박하지 않는다 — change 라운드의 레인 판정은 change-lane-checkpoint 「light 경로」가 정한다'))
    }
  }
  const order = {blocks: 0, 'on-touch': 1, info: 2}
  items.sort((left, right) => order[left.kind] - order[right.kind])
  return {
    schemaVersion: 1,
    harnessVersion: harnessVersion(),
    lockedWith: ledger?.harnessVersion ?? null,
    managed: true,
    ...(fast && developing ? {partial: {skipped: ['ownership'], why: '훅 프로세스를 띄우는 예행이라 --fast에서 건너뛴다'}} : {}),
    items,
  }
}

/** SessionStart용 요약(순수) — 막는 것만 한 줄씩, 나머지는 개수만. 깨끗하면 빈 문자열. */
export function summarize(report, {from = null} = {}) {
  if (!report.managed || report.items.length === 0) return ''
  const blocks = report.items.filter(entry => entry.kind === 'blocks')
  const rest = report.items.length - blocks.length
  const partial = report.partial ? ` (partial — ${report.partial.skipped.join(', ')} not run)` : ''
  const head = `[web-harness] Upgraded${from ? ` ${from} →` : ''} ${report.harnessVersion ?? '?'}: existing _workspace conflicts with current rules — `
    + `${blocks.length} blocking, ${rest} other${partial}.`
  const lines = blocks.slice(0, 3).map(entry => `  - ${entry.id}: ${entry.detail.slice(0, 160)}`)
  return `${head}\n${lines.join('\n')}${lines.length ? '\n' : ''}  Full report: ${command('upgrade-check', '--project-root .')}\n`
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  const index = argv.indexOf('--project-root')
  const projectRoot = index >= 0 ? argv[index + 1] : undefined
  if (!projectRoot) {
    process.stderr.write('사용법: node .claude/scripts/upgrade-check.mjs --project-root <path> [--json] [--fast]\n')
    process.exit(2)
  }
  const report = upgradeCheck(projectRoot, {fast: argv.includes('--fast')})
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else if (!report.managed) {
    process.stdout.write('하네스 관할 프로젝트가 아니다(_workspace 없음).\n')
  } else {
    const label = {blocks: '⛔ 지금 막음', 'on-touch': '△ 건드릴 때', info: '· 참고'}
    process.stdout.write(`업그레이드 점검 — 하네스 ${report.harnessVersion ?? '?'}${report.lockedWith ? ` (스팩은 ${report.lockedWith}에서 확정)` : ''}\n`)
    if (report.items.length === 0) process.stdout.write('  부딪히는 곳이 없다.\n')
    for (const entry of report.items) {
      process.stdout.write(`${label[entry.kind]} ${entry.id}: ${entry.detail}\n`)
      if (entry.fix) process.stdout.write(`    고치기: ${entry.fix}\n`)
      if (entry.commits) process.stdout.write(`    커밋: ${entry.commits}\n`)
    }
  }
  process.exit(report.items.some(entry => entry.kind === 'blocks') ? 1 : 0)
}
