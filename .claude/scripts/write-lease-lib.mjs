// write-lease-lib.mjs — **같은 체크아웃에서 developer write 스폰을 기계로 직렬화한다.**
//
// 계기(감사 FINDING-003): Phase 3는 `moduleBoundaries`마다 developer를 스폰하고 "경계가 겹치지
// 않으니 병렬이 안전하다"고 했는데, 범위를 집행하는 훅은 모든 스폰이 공유하는 `change-scope.md`
// **하나**를 읽는다 — 같은 체크아웃에서 병렬로 쓰면 마지막에 기록된 범위가 다른 스폰에도 적용된다.
// 첫 시도(U5b, 2026-09-10)는 스폰별 범위를 env로 넣으려 했으나 **넣는 생산자가 0건**이었고 보안
// 민감 경로만 늘어 걷어냈다. 그 뒤로는 「병렬로 돌리지 않는다」가 산문뿐이었다.
//
// **이번에는 생산자가 런타임이다(2026-09-11 실측).** 임시 프로젝트에서 서브에이전트 둘을 병렬로
// 띄워 훅 입력을 기록했더니 `PreToolUse`에 **서로 다른 `agent_id`**가 실렸고, `SubagentStart`·
// `SubagentStop`도 같은 id를 실었으며, 메인 스레드의 쓰기에는 `agent_id`가 없었다. 공식 hooks
// 문서와 일치한다. 그래서 스폰별 범위를 **넣는** 대신, 스폰별 신원으로 **한 번에 하나만 쓰게** 한다.
//
// ── 범위 ────────────────────────────────────────────────────────────────────
// - **developer만.** `change-scope.md`의 공유 문제는 developer 범위에서 난다. 디자인 wave 같은 다른
//   writer는 소유가 서로소인 `_workspace` 산출물을 병렬로 쓰도록 설계됐다 — 막으면 그 설계를 깬다.
// - **메인 스레드는 대상이 아니다.** `agent_id`가 없는 쓰기는 서브에이전트가 아니다(실측).
// - **체크아웃 단위.** 임대는 `.git/`(디렉터리일 때)에 둔다. worktree의 `.git`은 파일이라 임시
//   디렉터리로 떨어지고 경로는 체크아웃의 **실경로 해시**로 짓는다 — worktree마다 임대가 따로다.
//   이것이 병렬을 원할 때의 정답(체크아웃을 나눈다)을 기계가 그대로 허용하는 방식이다.
//
// ── 자동 회수를 하지 않는다 ─────────────────────────────────────────────────────
// 반증 러너 락과 같은 이유다: 「죽었는지 본다 → 치운다 → 만든다」는 원자로 만들 수 없고, 관찰한
// 임대와 치우는 임대가 같다는 보장이 없다. 홀더가 `SubagentStop` 없이 죽으면(세션 강제 종료 등)
// 임대가 남고 다음 developer 쓰기가 **막힌다** — 메시지가 홀더·경과 시간·경로를 대고 사람이 지운다.
// **조용한 동시 쓰기보다 시끄러운 막힘이 낫다.**
import {existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {dirname, join} from 'node:path'

const LEASE_NAME = 'web-harness-write-lease.json'

/** 임대 후보 경로. 모든 에이전트가 **같은 순서**로 보므로 같은 체크아웃에서는 같은 파일에 모인다. */
export function leasePathsFor(projectRoot) {
  let real = projectRoot
  try { real = realpathSync(projectRoot) } catch { /* 없는 경로면 그대로 해시한다 */ }
  const fallback = join(tmpdir(), `web-harness-write-lease-${createHash('sha256').update(real).digest('hex').slice(0, 16)}.json`)
  const gitPath = join(real, '.git')
  let gitIsDirectory = false
  try { gitIsDirectory = existsSync(gitPath) && statSync(gitPath).isDirectory() } catch { /* 판정 불가 — 임시 경로 */ }
  return gitIsDirectory ? [join(gitPath, LEASE_NAME), fallback] : [fallback]
}

const readHolder = path => {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

/**
 * 임대를 잡는다. 이미 **내 것**이면 그대로 통과한다.
 * @returns {{ok: true, path: string, fresh: boolean}|{held: object, path: string}|{unavailable: string[]}}
 */
export function acquireLease({projectRoot, agentId, agentType, sessionId = null, now = () => new Date(), paths = null}) {
  if (typeof agentId !== 'string' || agentId === '') throw new Error('acquireLease: agentId가 필요하다')
  const record = {agentId, agentType, sessionId, acquiredAt: now().toISOString()}
  const reasons = []
  for (const path of paths ?? leasePathsFor(projectRoot)) {
    try {
      mkdirSync(dirname(path), {recursive: true})
      // `wx`는 원자적이다 — 동시에 첫 쓰기를 한 둘 중 정확히 하나만 만든다.
      writeFileSync(path, `${JSON.stringify(record)}\n`, {flag: 'wx'})
      return {ok: true, path, fresh: true}
    } catch (error) {
      if (error?.code === 'EEXIST') {
        const holder = readHolder(path)
        if (holder?.agentId === agentId) return {ok: true, path, fresh: false}
        // 읽을 수 없는 임대도 **남의 것**으로 본다 — 판정할 수 없는 것을 통과로 세지 않는다.
        return {held: holder ?? {agentId: null, unreadable: true}, path}
      }
      // 권한·파일시스템 오류는 「보유 중」이 아니다 — 다음 후보로(반증 러너의 `pid NaN` 교훈).
      reasons.push(`${path}: ${error?.code ?? error?.message}`)
    }
  }
  return {unavailable: reasons}
}

/** 임대를 놓는다 — **내 것일 때만.** 남의 임대를 지우면 그 스폰이 쓰는 도중 다른 스폰이 들어온다. */
export function releaseLease({projectRoot, agentId, paths = null}) {
  for (const path of paths ?? leasePathsFor(projectRoot)) {
    const holder = readHolder(path)
    if (holder?.agentId && holder.agentId === agentId) {
      rmSync(path, {force: true})
      return {released: true, path}
    }
  }
  return {released: false}
}

/** 막을 때의 메시지(순수) — 홀더·경과·경로와 해제 방법을 댄다. */
export function leaseBlockMessage({held, path, agentType, now = () => new Date()}) {
  const since = held?.acquiredAt ? Math.round((now() - new Date(held.acquiredAt)) / 1000) : null
  const who = held?.unreadable ? '(읽을 수 없는 임대)' : `${held?.agentType ?? '?'} ${held?.agentId ?? '?'}`
  return `Blocked: ${agentType} — 같은 체크아웃에서 다른 developer 스폰(${who})이 쓰는 중이다`
    + `${since === null ? '' : `(${since}s 전 시작)`}. 범위 파일(change-scope.md)을 공유하므로 병렬 쓰기는 직렬화한다 — `
    + '그 스폰이 끝나면 풀린다. 병렬이 필요하면 체크아웃(worktree)을 나눠라. '
    + `홀더가 이미 죽었는데 풀리지 않으면(세션 강제 종료) 다른 스폰이 없는지 확인한 뒤 ${path}를 지워라 — 자동 회수는 원자로 만들 수 없어 하지 않는다.`
}
