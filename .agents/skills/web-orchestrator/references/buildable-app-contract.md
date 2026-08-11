# Buildable Web Application Contract

Phase 3을 시작하기 전에 읽는다.

## Minimum runtime files

생성 앱에는 최소한 다음이 있어야 한다.

- dependency와 script가 실제 source import에 맞는 `package.json`
- `index.html`, `src/main.tsx`, `src/app/App.tsx`
- route table과 concrete page 하나 이상
- API를 사용하면 typed API client와 Query client
- component가 직접 env를 읽지 않도록 typed shared config
- design spec에서 추출한 app theme
- Mock API를 사용하면 browser와 Node MSW bootstrap, 공식 worker 생성
- 선택한 rendering/deployment 환경에서 실행 가능한 entrypoint

## Environment and API errors

env 파일을 만들기 전에 `env-management.md`, API client를 만들기 전에 `error-handling-patterns.md`를 읽는다.

- client bundle에는 공개 가능한 값만 넣는다.
- local secret override는 ignore한다.
- 401, 403, 404, 5xx, offline, cancellation을 typed error contract로 구분한다.
- 4xx를 무조건 retry하지 않는다.
- Query reset boundary와 top-level error fallback을 연결한다.
- cancellation을 사용자 오류 toast로 표시하지 않는다.

## Mode-specific implementation

- timeseries면 architecture, bounded buffer, deterministic stream fake, recovery contract를 구현한다.
- local domain state면 command/invariant/persistence owner를 분리하고 UI가 store 구조를 직접 patch하지 않는다.
- external ingestion이면 source adapter, schema validation, quality gate, atomic promotion을 UI와 분리한다.
- AI mode면 model gateway, tool adapter, approval, trace, eval boundary를 서비스 UI와 분리한다.

각 mode의 필드와 SLO는 해당 canonical reference에서 읽고 여기서 추측하지 않는다.

## Test-ready development

Phase 3 완료 시 다음 QA가 실행 가능해야 한다.

- deterministic unit/component test environment
- API Mock lifecycle
- critical browser flow용 deterministic web server
- console error와 failed request 수집 helper
- active mode의 정상·경계·실패 fixture

product source를 테스트 fixture에 의존시키거나 production failure를 development fallback으로 숨기지 않는다.

`development-gates-contract.md`의 Gate A/B/C를 통과하지 않은 source는 Phase 3 완료가 아니다. 중간 receipt는 source 변경 시 stale이며 Phase 4에서 다시 생성한다.

## Completion check

- fresh install과 선택된 root cwd에서 build 가능
- route가 concrete page를 렌더링
- Mock와 실제 adapter가 같은 public contract를 구현
- generated code의 import가 package metadata와 일치
- deployment target에서 지원하지 않는 runtime/cron/filesystem 가정 없음
