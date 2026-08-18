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

try {
  const projectDir = resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd())
  const workspaceDir = join(projectDir, '_workspace')
  if (existsSync(workspaceDir) && statSync(workspaceDir).isDirectory()) {
    const scriptDir = dirname(fileURLToPath(import.meta.url))
    const reentryMap = join(scriptDir, '..', 'skills', 'web-orchestrator', 'references', 'reentry-map.md')
    if (existsSync(reentryMap)) {
      process.stdout.write(
        `[web-harness] Harness-managed project detected (_workspace/ at project root).\n` +
        `Re-entry guidance: for follow-up work on this project, do NOT reload the full web-orchestrator skill. ` +
        `Read the situation-matched minimal contract set from: ${resolve(reentryMap)} ` +
        `(A iterate round · B approval-surface change · C release promotion). ` +
        `Fall back to full /web-orchestrator entry only for a new service or when the situation is unclear.\n`,
      )
    } else {
      process.stdout.write(
        `[web-harness] Harness-managed project detected (_workspace/ at project root). ` +
        `Re-enter via the /web-orchestrator skill for follow-up work.\n`,
      )
    }
  }
} catch {
  // 안내 층 — 어떤 오류도 세션을 막지 않는다.
}
process.exit(0)
