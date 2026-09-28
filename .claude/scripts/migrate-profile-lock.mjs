#!/usr/bin/env node
// migrate-profile-lock.mjs — 워크스페이스 루트에서 잠근 옛 프로필(`_workspace/01_plan/project-profile.json`)을 걷어낸다.
//
// 옛 판본은 모노레포 루트에서도 프로필을 잠갔다. 패키지가 워크스페이스 멤버에만 있으면 그 잠금은 루트에서 영영 충족되지
// 않아 품질 러너가 매번 멈춘다(PROJECT_PROFILE_PACKAGE_MISSING). 지금 판본은 그런 잠금을 만들지 않는다(PROFILE_AT_WORKSPACE_ROOT).
// 이 명령은 **그 경우에만** 잠금을 지우고, 프로필이 스팩의 잠금 입력이므로 스팩을 다시 확정한다(원장에 남는다).
// 러너는 그 뒤 기본 검사(build·typecheck·lint·test…)로 돈다 — 어댑터 검사는 앱 루트에서 프로필을 잠글 때 돌아온다.
//
// 사람이 실행하는 명령이다 — 기본은 미리보기(쓰기 0)이고 `--apply`만 쓴다(승인 훅이 `--apply`를 사용자 확인으로 묻는다).
// 커밋은 브랜치 소유자 몫이다. 적용 중 강제 종료되면 `project-profile.json.migrating-<pid>`가 남을 수 있다 — 미리보기가 알린다.
//
// 사용법: node .claude/scripts/migrate-profile-lock.mjs --project-root <path> [--apply]
// 종료 코드: 0 = 미리보기·적용 완료 또는 옮길 것 없음, 1 = 이 명령의 대상이 아니거나 적용 실패(아무것도 바꾸지 않았다), 2 = 사용법 오류.
import {existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {answerHelp} from './cli-help-lib.mjs'
import {LOCK_ERROR_FIXES, LockError, lockSpec, recordSpec} from './spec.mjs'
import {readLockedProjectProfile, validateLockedProfileProjectState} from './web-core/profile-policy-lib.mjs'
import {workspaceMembersDeclaring} from './web-core/profile-lib.mjs'
import {loadBuiltinAdapters} from './web-core/adapter-lib.mjs'

answerHelp(import.meta.url)

export const PROFILE_PATH = '_workspace/01_plan/project-profile.json'
const SPEC_PATH = '_workspace/03_dev/spec.json'

const readJson = path => { try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null } }
const declaredNames = manifest => new Set(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
  .flatMap(field => Object.keys(manifest?.[field] ?? {})))

/**
 * 루트 잠금 진단(순수) — 잠근 어댑터가 요구하는 패키지 전부가 루트 매니페스트에는 없고 워크스페이스 멤버에 있는가.
 * 오류 코드와 무관하게 원문 프로필의 어댑터 id로 본다 — 어댑터 판본이 바뀌어 다른 오류가 먼저 나도 원인은 같다.
 */
export function diagnoseRootLock(projectRoot, rawProfile) {
  const root = resolve(projectRoot)
  const id = rawProfile?.adapter?.id ?? rawProfile?.profileId
  let adapter
  try { adapter = loadBuiltinAdapters().find(candidate => candidate.id === id) } catch { adapter = null }
  const required = adapter?.detection?.allPackages ?? []
  if (required.length === 0) return null
  const atRoot = declaredNames(readJson(join(root, 'package.json')))
  const missingAtRoot = required.filter(name => !atRoot.has(name))
  if (missingAtRoot.length === 0) return null
  const members = workspaceMembersDeclaring(root, required)
  return members.length > 0 ? {adapterId: id, missingAtRoot, members} : null
}

/** 적용이 강제 종료돼 남은 파킹 파일 — 미리보기가 알린다(되돌리기는 사람이 한다). */
const parkedLeftovers = root => {
  const dir = join(root, '_workspace/01_plan')
  return existsSync(dir) ? readdirSync(dir).filter(name => name.startsWith('project-profile.json.migrating-')) : []
}

/** 무엇을 할지(순수 판정) — 대상은 「루트 잠금 + 패키지가 멤버에만」 하나뿐이다. 그 밖의 무효 잠금은 사람이 판단한다. */
export function planProfileMigration(projectRoot) {
  const root = resolve(projectRoot)
  const path = join(root, PROFILE_PATH)
  const leftovers = parkedLeftovers(root)
  const withLeftovers = result => (leftovers.length > 0
    ? {...result, leftovers: leftovers.map(name => `_workspace/01_plan/${name}`), leftoverNote: '앞선 적용이 중간에 끊긴 흔적이다 — 되돌릴지 지울지 사람이 정한다'}
    : result)
  if (!existsSync(path)) return withLeftovers({action: 'none', reason: `${PROFILE_PATH}가 없다`})
  let error = null
  try {
    validateLockedProfileProjectState(readLockedProjectProfile(path), root)
  } catch (caught) {
    error = caught
  }
  if (error === null) return withLeftovers({action: 'none', reason: '프로필 잠금이 지금 프로젝트와 맞는다'})
  const diagnosis = diagnoseRootLock(root, readJson(path))
  const missing = diagnosis?.missingAtRoot ?? []
  const members = diagnosis?.members ?? []
  if (members.length === 0) {
    return {action: 'refuse', reason: `이 명령의 대상이 아니다(${error?.code ?? 'INVALID'}: ${error instanceof Error ? error.message : String(error)}) — `
      + '패키지가 워크스페이스 멤버에 있는 루트 잠금만 옮긴다. 프로필을 다시 해석할지 사람이 정한다'}
  }
  return withLeftovers({action: 'migrate', lockError: error?.code ?? 'INVALID', missingPackages: missing, members, specLocked: existsSync(join(root, SPEC_PATH)),
    effect: `${PROFILE_PATH}를 지운다 → 러너는 기본 검사로 돈다(어댑터 검사는 앱 루트 ${members.join(', ')}에서 프로필을 잠글 때 돌아온다)`
      + (existsSync(join(root, SPEC_PATH)) ? ` → 프로필이 잠금 입력이라 ${SPEC_PATH}를 다시 확정한다(원장에 남는다)` : '')})
}

/** 적용 — 스팩 재확정이 실패하면 프로필을 되돌린다(반쯤 옮긴 상태를 남기지 않는다). */
export function applyProfileMigration(projectRoot) {
  const root = resolve(projectRoot)
  const plan = planProfileMigration(root)
  if (plan.action !== 'migrate') return plan
  const path = join(root, PROFILE_PATH)
  const parked = `${path}.migrating-${process.pid}`
  renameSync(path, parked)
  try {
    if (plan.specLocked) {
      const spec = lockSpec(root)
      recordSpec(root, spec)
      writeFileSync(join(root, SPEC_PATH), `${JSON.stringify(spec, null, 2)}\n`)
    }
  } catch (error) {
    renameSync(parked, path)
    const code = error instanceof LockError ? error.code : 'LOCK_FAILED'
    return {action: 'failed', reason: `스팩을 다시 확정하지 못해 프로필을 되돌렸다: ${code} — ${error instanceof Error ? error.message : String(error)}`,
      fix: LOCK_ERROR_FIXES[code] ?? null}
  }
  rmSync(parked, {force: true})
  return {...plan, action: 'migrated', commit: [PROFILE_PATH, ...(plan.specLocked ? [SPEC_PATH, '_workspace/03_dev/spec-ledger.jsonl'] : [])]}
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  const index = argv.indexOf('--project-root')
  const projectRoot = index >= 0 ? argv[index + 1] : undefined
  const unknown = argv.filter((arg, position) => arg.startsWith('--') && !['--project-root', '--apply'].includes(arg) && position !== index + 1)
  if (!projectRoot || unknown.length > 0) {
    process.stderr.write('사용법: node .claude/scripts/migrate-profile-lock.mjs --project-root <path> [--apply]\n')
    process.exit(2)
  }
  const result = argv.includes('--apply') ? applyProfileMigration(projectRoot) : planProfileMigration(projectRoot)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (result.action === 'migrate') process.stdout.write('미리보기다 — 바꾼 것 없음. 적용하려면 --apply를 붙인다.\n')
  if (result.action === 'migrated') process.stdout.write(`커밋할 파일(브랜치 소유자): ${result.commit.join(' · ')}\n`)
  process.exit(['refuse', 'failed'].includes(result.action) ? 1 : 0)
}
