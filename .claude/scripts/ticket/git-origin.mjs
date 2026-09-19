// 팀 워크플로우 통합 — git origin/브랜치/working-tree 실행부(side-effect 경계).
// claim-guard(점 1)·sync-guard(점 2·3·4)의 순수 판정에 필요한 git 사실을 읽는다. 순수 argv
// 빌더를 노출해 실 git 없이 회귀 검증하고, exec 주입으로 side-effect 없이 테스트한다.
// 읽기 전용 — pull·머지·컨플릭 해결은 여기서 하지 않는다(개발자 git 작업).
import {spawn} from 'node:child_process'

function git(args, {cwd, timeoutMs = 15000} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {cwd, stdio: ['ignore', 'pipe', 'pipe']})
    let out = ''
    let err = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`git timeout: ${args[0]}`)) }, timeoutMs)
    child.stdout.on('data', c => { out += c })
    child.stderr.on('data', c => { err += c })
    child.once('error', e => { clearTimeout(timer); reject(e) })
    child.once('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve({code, out})
      else reject(Object.assign(new Error(`git exit ${code}: ${err.trim() || out.trim()}`), {code}))
    })
  })
}

export const currentBranchArgs = () => ['rev-parse', '--abbrev-ref', 'HEAD']

export const worktreeStatusArgs = () => ['status', '--porcelain']
// remote-tracking 갱신. `--prune`으로 서버에서 삭제된 브랜치의 유령 참조를 지운다.
export const fetchArgs = (remote = 'origin') => ['fetch', '--prune', '--quiet', remote]

/**
 * `git status --porcelain` 출력 → 라우팅 판정 입력(순수). XY 코드 기준:
 * 컨플릭(U 포함·AA·DD), 추적 변경(?? 아닌 나머지), untracked-only 구분.
 * @param {string} porcelain
 * @returns {{dirty: boolean, conflicted: boolean, untrackedOnly: boolean}}
 */
export function parseWorktreeStatus(porcelain) {
  const lines = String(porcelain ?? '').split(/\r?\n/).filter(line => line.trim())
  const conflicted = lines.some(line => {
    const xy = line.slice(0, 2)
    return xy.includes('U') || xy === 'AA' || xy === 'DD'
  })
  const tracked = lines.filter(line => !line.startsWith('??'))
  return {
    dirty: tracked.length > 0,
    conflicted,
    untrackedOnly: tracked.length === 0 && lines.length > 0,
  }
}

/**
 * 청구 전제(점 1): 로컬 feature-plan이 origin에 푸시돼 있고 일치하는지 읽는다.
 * base 미지정 시 현재 브랜치의 upstream(@{upstream})을 쓴다. exec 주입 가능(테스트).
 * @param {{repoRoot: string, planPath: string, base?: string|null, exec?: (a:string[])=>Promise<{code:number,out:string}>}} config
 * @returns {Promise<{originExists: boolean, planMatchesOrigin: boolean, base: string|null, reason?: string}>}
 */
/**
 * remote-tracking 참조를 갱신한다(읽기 전용 — 워킹 트리를 건드리지 않는다).
 *
 * **왜 필요한가**: `origin/<br>` 판정은 실서버가 아니라 **마지막 fetch 시점의 스냅샷**이다.
 * 이 파일이 그 사실을 경고하면서 "소비자는 판정 전 fetch를 선행하거나 스냅샷 기준임을
 * 표기해야 한다 — 배선 커밋에서 결정"이라고 미뤄뒀는데, 실제로는 claim·pickup·board 어디에도
 * fetch가 없었다(실측). 그래서 청구 게이트가 낡은 스냅샷 위에서 "origin과 같다"를 판정했다.
 *
 * 실패해도 던지지 않는다 — 네트워크 없는 환경에서 판정 자체를 막지 않기 위해서다. 대신
 * `{ok:false}`를 돌려 **소비자가 "스냅샷 기준"임을 표기**할 수 있게 한다(둘 중 하나는 해야
 * 한다는 경고의 나머지 절반).
 * @param {{repoRoot: string, remote?: string, exec?: (a:string[])=>Promise<{code:number,out:string}>}} config
 * @returns {Promise<{ok: boolean, reason: string|null}>}
 */
export async function refreshRemoteRefs({repoRoot, remote = 'origin', exec = null}) {
  const run = exec ?? (args => git(args, {cwd: repoRoot}))
  try {
    await run(fetchArgs(remote))
    return {ok: true, reason: null}
  } catch (error) {
    return {ok: false, reason: error?.message?.split('\n')[0] ?? 'fetch failed'}
  }
}


/** 현재 브랜치명(점 2). 실패 시 null(detached 등). */
export async function resolveCurrentBranch({repoRoot, exec = null}) {
  const run = exec ?? (args => git(args, {cwd: repoRoot}))
  try {
    const name = (await run(currentBranchArgs())).out.trim()
    return name && name !== 'HEAD' ? name : null
  } catch { return null }
}


/** 라우팅 판정용 worktree 상태(§4-3) — status --porcelain 실측을 parseWorktreeStatus로. */
export async function resolveWorktreeStatus({repoRoot, exec = null}) {
  const run = exec ?? (args => git(args, {cwd: repoRoot}))
  try {
    return parseWorktreeStatus((await run(worktreeStatusArgs())).out)
  } catch {
    // 조회 실패 = 상태 **미상** — dirty로 단정하지 않고 statusUnknown으로 정직 표기(라우팅은
    // 이를 보수적으로 차단하되 "미커밋 변경 있음"이라는 잘못된 처방을 내지 않는다 — 리뷰 지적).
    return {dirty: true, conflicted: false, untrackedOnly: false, statusUnknown: true}
  }
}



export const planOnRemoteArgs = (ref, planPath) => ['log', '--format=%h', `HEAD..${ref}`, '--', planPath]

/**
 * 원격 기준 브랜치에 **로컬 HEAD가 모르는 계획 개정**이 있는가. 로컬 계획으로 판정하면 개정을 받지 않은 개발자가
 * 대체된 작업을 집거나 끝낸다. 기준은 `base`(PR base·계획의 baseBranch)가 원격에 있으면 그것, 없으면 원격 HEAD다.
 * 못 재면 `checked: false`와 이유 — 막지 않는다(git이 아닌 곳·원격 없음).
 */
export async function planRevisionsOnRemote({repoRoot, base = null, planPath = '_workspace/03_dev/work-plan.json', remote = 'origin', exec = null}) {
  const run = exec ?? (args => git(args, {cwd: repoRoot}))
  for (const ref of [base ? `${remote}/${base}` : null, `${remote}/HEAD`].filter(Boolean)) {
    try {
      await run(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
    } catch { continue }
    try {
      const commits = (await run(planOnRemoteArgs(ref, planPath))).out.split('\n').map(line => line.trim()).filter(Boolean)
      return {checked: true, ref, commits}
    } catch (error) {
      return {checked: false, ref, reason: error?.message?.split('\n')[0] ?? 'git log failed'}
    }
  }
  return {checked: false, ref: null, reason: '원격 기준 브랜치를 찾지 못했습니다'}
}

/**
 * 머지 근거를 대조할 저장소 문맥 — origin의 저장소 이름과 기대 base 브랜치. base는 주어진 것(PR base·계획의 baseBranch)이
 * 원격에 있으면 그것, 없으면 원격 HEAD가 가리키는 기본 브랜치다. git이 아니거나 원격이 없으면 `null`.
 */
export async function resolveRepoContext({repoRoot, base = null, remote = 'origin', exec = null}) {
  const run = exec ?? (args => git(args, {cwd: repoRoot}))
  try {
    const url = (await run(['remote', 'get-url', remote])).out.trim()
    const repoName = url.replace(/\/+$/, '').split(/[/:]/).pop().replace(/\.git$/, '')
    let baseBranch = null
    if (base) {
      try { await run(['rev-parse', '--verify', '--quiet', `${remote}/${base}^{commit}`]); baseBranch = base } catch { /* 원격에 없다 — 기본 브랜치로 */ }
    }
    if (!baseBranch) baseBranch = (await run(['symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`])).out.trim().replace(`${remote}/`, '') || null
    return repoName && baseBranch ? {repoName, baseBranch, ...parseRemoteUrl(url)} : null
  } catch { return null }
}

/** origin URL → PR 호스트와 `owner/name`(순수). ssh(`git@host:o/r.git`)·https만 안다 — 로컬 경로 등은 `{host: null, slug: null}`. */
export function parseRemoteUrl(url) {
  const text = String(url ?? '').trim()
  const match = text.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/) ?? text.match(/^https?:\/\/(?:[^@/]+@)?([^/]+)\/([^/]+\/[^/]+?)(?:\.git)?\/?$/)
  return match ? {host: match[1], slug: match[2]} : {host: null, slug: null}
}
