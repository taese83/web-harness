#!/usr/bin/env node
// SessionStart 훅 — 하네스 관리 프로젝트 감지 + 재진입 안내 주입 (안내 층, 강제 아님).
//
// 판별 신호는 요청 텍스트가 아니라 프로젝트 상태다: 프로젝트 루트에 `_workspace/`
// 디렉터리가 있으면 하네스 관할이다(reentry-map.md의 신호 정의와 동일). 감지되면
// 재진입 최소 로드 안내와 reentry-map 절대 경로를 stdout으로 주입하고, 아니면
// 침묵한다. v1은 루트 `_workspace/`만 본다 — phase 추정·상태 파일 신설 없음.
//
// 훅 실패는 세션을 깨지 않아야 하므로 어떤 경로에서도 exit 0이다(안내 층의
// fail-safe는 침묵이다 — 강제 층 훅과 반대 방향).

import {existsSync, statSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const REENTRY_MAP = join('skills', 'web-orchestrator', 'references', 'reentry-map.md')
// 하네스 스킬은 모델이 스스로 부르지 못한다(disable-model-invocation) — 사용자가 슬래시 명령으로 들어와야 한다.
// 플러그인이면 `web-harness:` 네임스페이스가 붙는다(빌드 산출물에만 매니페스트가 있다).
const PLUGIN = existsSync(new URL('../../.claude-plugin/plugin.json', import.meta.url))
const entry = name => (PLUGIN ? `/web-harness:${name}` : `/${name}`)
const ENTRY_GUIDANCE = `Entry: development and ticket work (create/pickup/link) start with ${entry('wh')} <request> ` +
  `(${entry('team-flow')} also works for tickets). Once started, the session is in harness mode and later plain-text requests ` +
  `are routed by it until ${entry('wh')} off. If harness mode is not on and the user asks for ticket or development work in plain text, ` +
  `do not imitate the harness flow — ask them to start with ${entry('wh')}.\n`

try {
  const projectDir = resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd())
  const workspaceDir = join(projectDir, '_workspace')
  if (existsSync(workspaceDir) && statSync(workspaceDir).isDirectory()) {
    // 플러그인이면 계약 사본을 먼저 맞춘다 — 서브에이전트가 읽는 참조가 그 사본을 가리킨다.
    // 동적 import다 — 정적 import가 실패하면 try 밖에서 죽어 세션을 깬다.
    const CONTRACTS_DIR = '_workspace/.contracts'
    let sync
    try {
      const {syncContracts} = await import('./sync-plugin-contracts.mjs')
      sync = syncContracts({projectRoot: projectDir})
    } catch (error) {
      sync = {state: 'failed'}
      process.stdout.write(`[web-harness] Could not refresh ${CONTRACTS_DIR}/ (${error instanceof Error ? error.message : String(error)}) — ` +
        `subagents may read stale or missing contracts. Run: web-harness-script sync-plugin-contracts --project-root .\n`)
    }
    const reentryMap = sync.state === 'not-plugin'
      ? join(dirname(fileURLToPath(import.meta.url)), '..', REENTRY_MAP)
      : join(projectDir, CONTRACTS_DIR, REENTRY_MAP)
    if (existsSync(reentryMap)) {
      process.stdout.write(
        `[web-harness] Harness-managed project detected (_workspace/ at project root).\n` +
        `Re-entry guidance: for follow-up work on this project, do NOT reload the full web-orchestrator skill. ` +
        `Read the situation-matched minimal contract set from: ${resolve(reentryMap)} ` +
        `(A iterate round · B approval-surface change · C release promotion). ` +
        `Fall back to ${entry('wh')} new only for a new service or when the situation is unclear.\n` + ENTRY_GUIDANCE,
      )
    } else {
      process.stdout.write(
        `[web-harness] Harness-managed project detected (_workspace/ at project root). ` +
        ENTRY_GUIDANCE,
      )
    }
  }
} catch {
  // 안내 층 — 어떤 오류도 세션을 막지 않는다.
}
process.exit(0)
