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

// --- 순수 argv 빌더(회귀 대상) ---
export const upstreamArgs = () => ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']
export const currentBranchArgs = () => ['rev-parse', '--abbrev-ref', 'HEAD']
export const originExistsArgs = (base, planPath) => ['cat-file', '-e', `${base}:${planPath}`]
export const originDiffArgs = (base, planPath) => ['diff', '--quiet', base, '--', planPath]
export const conflictArgs = () => ['diff', '--name-only', '--diff-filter=U']

/**
 * 청구 전제(점 1): 로컬 feature-plan이 origin에 푸시돼 있고 일치하는지 읽는다.
 * base 미지정 시 현재 브랜치의 upstream(@{upstream})을 쓴다. exec 주입 가능(테스트).
 * @param {{repoRoot: string, planPath: string, base?: string|null, exec?: (a:string[])=>Promise<{code:number,out:string}>}} config
 * @returns {Promise<{originExists: boolean, planMatchesOrigin: boolean, base: string|null, reason?: string}>}
 */
export async function resolveOriginPlanSync({repoRoot, planPath, base = null, exec = null}) {
  const run = exec ?? (args => git(args, {cwd: repoRoot}))
  let resolvedBase = base
  if (!resolvedBase) {
    try { resolvedBase = (await run(upstreamArgs())).out.trim() }
    catch { return {originExists: false, planMatchesOrigin: false, base: null, reason: 'no-upstream'} }
  }
  let originExists = true
  try { await run(originExistsArgs(resolvedBase, planPath)) } catch { originExists = false }
  if (!originExists) return {originExists: false, planMatchesOrigin: false, base: resolvedBase}
  // git diff --quiet: exit 0=동일, 비0=차이(working-tree를 base와 비교 → 미커밋·미푸시 모두 포착).
  let planMatchesOrigin = true
  try { await run(originDiffArgs(resolvedBase, planPath)) } catch { planMatchesOrigin = false }
  return {originExists, planMatchesOrigin, base: resolvedBase}
}

/** 현재 브랜치명(점 2). 실패 시 null(detached 등). */
export async function resolveCurrentBranch({repoRoot, exec = null}) {
  const run = exec ?? (args => git(args, {cwd: repoRoot}))
  try {
    const name = (await run(currentBranchArgs())).out.trim()
    return name && name !== 'HEAD' ? name : null
  } catch { return null }
}

/** working-tree에 미해결 컨플릭(점 4)이 있는지. --diff-filter=U 결과가 있으면 conflicted. */
export async function resolveWorkingState({repoRoot, exec = null}) {
  const run = exec ?? (args => git(args, {cwd: repoRoot}))
  try {
    const conflicts = (await run(conflictArgs())).out.split(/\r?\n/).filter(Boolean)
    return {conflicted: conflicts.length > 0, conflicts}
  } catch {
    return {conflicted: false, conflicts: []} // 조회 실패는 컨플릭 없음으로(보수적 아님 — caller가 별도 판단)
  }
}
