---
name: web-console
description: Starts, checks, restarts, or stops the repository-local Web Harness Console and its isolated preview server. Use when the user asks to open, run, restart, stop, or diagnose the Console, pnpm console, ports 4310/4311, project indexing, or local Codex CLI connection status.
argument-hint: "[start|status|restart|stop]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash, AskUserQuestion
metadata:
  version: 1.0.0
  maturity: contract-only
  updated: 2026-08-07
  changelog: Web Harness Console의 중복 실행 방지, 소유 세션 재시작, 상태 검증과 안전한 종료 절차를 추가.
---

# Web Console

Web Harness Console과 isolated preview origin을 로컬에서 안전하게 운영한다. 기본 action은 인자 또는 사용자 요청에서 `start|status|restart|stop`으로 결정하고, 인자 없이 호출하면 `status`를 먼저 확인한 뒤 실행 여부를 안내한다.

## Execution mode

두 실행 모드를 순서대로 판별한다.

1. **저장소 모드**: 현재 디렉터리의 Git root에 `package.json`의 `scripts.console`과 `packages/web-harness-console/server.mjs`가 있으면, 확인된 root를 cwd로 `pnpm console`을 사용한다.
2. **플러그인 모드**: 저장소 모드가 아니고 `web-harness-console` 실행 파일이 PATH에 있으면(플러그인 bin 디스패처) 그것으로 서버를 시작한다. `--root`는 디스패처가 현재 세션 프로젝트로 지정하므로 덧붙이지 않는다.
3. 둘 다 아니면 임의 명령을 만들지 말고 올바른 web-harness root 또는 플러그인 설치를 요청한다. 다른 프로젝트의 dev server를 Console로 간주하지 않는다.

## Status

다음 read-only 상태를 함께 확인한다.

- Console: `http://127.0.0.1:4310/`
- isolated preview: `http://127.0.0.1:4311/`
- `GET /api/projects`: Console identity와 indexed project count
- `GET /api/codex/status`: installed, authenticated, connected, version, reason

4310이 응답해도 Console API 계약이 아니면 `PORT_CONFLICT`로 보고한다. 상태 확인만 요청받았을 때 process를 시작·종료하지 않는다.

## Start

1. `status`가 정상이면 두 번째 서버를 시작하지 않고 `ALREADY_RUNNING`으로 보고한다.
2. 저장소의 고정 Node/pnpm 도구체인을 우선한다. pinned Node bin을 사용해야 하면 기존 `PATH` 앞에만 추가하고 전체 `PATH`를 교체하지 않는다. Codex CLI 경로를 보존한다.
3. long-lived PTY에서 `pnpm console`을 실행하고 session ID를 보존한다. shell backgrounding, `nohup`, 임의 PID file은 사용하지 않는다.
4. stdout에서 Console/preview URL, indexed project count, Codex connection 결과를 확인한다.
5. 두 HTTP status endpoint를 다시 조회한 뒤에만 성공으로 보고한다. Codex 미연결은 서버 시작 실패와 구분하고 복구 원인을 표시한다.

## Restart

1. 현재 작업이 시작해 session ID를 소유한 서버면 PTY에 `Ctrl+C`를 보내 정상 종료하고 같은 root에서 다시 시작한다.
2. session ownership이 없으면 listener PID, command line, cwd가 확인된 Web Harness Console인지 read-only로 판별한다.
3. 외부 작업이 소유한 process는 사용자 확인 없이 종료하지 않는다. `pkill`, `killall`, broad process pattern을 사용하지 않는다.
4. 종료 후 4310/4311이 해제됐는지 확인하고 `Start` 절차를 수행한다.

## Stop

- 현재 작업이 소유한 session만 `Ctrl+C`로 종료한다.
- 소유하지 않은 process는 exact PID·command·cwd를 보여주고 명시적 확인 후 graceful termination만 수행한다.
- 강제 종료는 graceful 종료가 실패하고 사용자가 다시 승인한 경우에만 exact PID를 대상으로 한다.
- 종료 후 두 port 상태를 확인한다.

## Failure handling

- `EADDRINUSE`: listener를 자동 종료하지 않고 Console identity 또는 port conflict를 보고한다.
- toolchain mismatch: pinned version과 현재 version을 표시한다. install이나 package mutation을 자동 실행하지 않는다.
- `Codex not connected`: 서버는 유지하고 `codex login` 필요 여부와 `/api/codex/status` reason을 보고한다.
- server crash: bounded terminal output을 제시하고 자동 retry는 한 번도 수행하지 않는다.

## Completion report

다음을 간결하게 반환한다.

- action과 결과: `RUNNING|ALREADY_RUNNING|STOPPED|PORT_CONFLICT|FAILED`
- Console/preview URL
- indexed project count — 0이면 서버 오류가 아니라 이 루트에 `_workspace` 프로젝트가 없다는 뜻이다. `/web-plan`(기획만) 또는 `/web-orchestrator`(전체 파이프라인, 기존 기획·디자인 문서는 `_workspace/00_source`로 정규화)로 시작하면 나타난다고 안내한다
- Codex connection/version 또는 reason
- 현재 작업이 소유한 실행 session ID가 있으면 해당 ID

브라우저 열기나 특정 project/tab 이동은 사용자가 함께 요청한 경우에만 수행한다.
