# Background Jobs Contract

응답 주기 밖에서 실행되는 작업(스케줄 작업·후처리·재시도 큐)의 계약이다. serverless 중심 profile(`vite-serverless-hybrid`, `next-app-fullstack`)에는 상주 워커가 없으므로, **"함수는 enqueue만, 실행은 스케줄러가"**를 기본 구조로 삼는다. scheduled ingestion(`external-data-ingestion.md`)은 이 계약의 특수 사례이며 그 계약이 우선한다.

## 적용 판별

다음이 있으면 이 계약을 읽는다: 예약 발송·주기적 집계·만료 처리·재시도가 필요한 후처리(웹훅 발송·이메일)·응답 후 완료가 보장되어야 하는 작업. 단순 응답 후 로그·통지(실패해도 무해)는 `after()`/`waitUntil`로 충분하며 이 계약 대상이 아니다.

## 구조 — Outbox + Scheduled Runner

1. **Enqueue**: 사용자 요청 트랜잭션 안에서 작업 레코드를 함께 커밋한다 (outbox 패턴 — "저장됐는데 작업이 안 생김" 방지). 레코드: `id, kind, payload, status(pending|running|done|failed), attempts, run_after, created_at`.
2. **Run**: 스케줄 트리거가 pending 작업을 가져가 실행한다. 트리거는 provider 순서로 선택: Vercel cron(`vercel.json` crons) → GitHub Actions schedule(이미 ingestion CI 패턴 존재) → 외부 cron 호출. 트리거 endpoint는 **인증 필수**(cron secret 헤더 검증) — 공개 GET으로 두지 않는다.
3. **Claim**: 다중 인스턴스 중복 실행을 조건부 UPDATE로 방지한다: `UPDATE ... SET status='running' WHERE id=? AND status='pending'` — 0행이면 다른 인스턴스가 선점한 것. 별도 lock 테이블·advisory lock은 이걸로 부족할 때만.
4. **Idempotent 실행**: 모든 job은 재실행 안전해야 한다 — 같은 job이 두 번 돌아도 결과가 한 번과 같게 (외부 발송은 idempotency key 전달).
5. **재시도·포기**: 실패 시 `attempts+1, run_after=지수 백오프`. 상한(기본 5회) 도달 시 `failed`로 남기고 **조용히 버리지 않는다** — failed 잔량은 관측 대상이다.
6. **Manual recovery**: scheduled 실행에는 수동 복구 경로가 필수다 (ingestion 계약과 동일 원칙) — failed 재큐잉 명령·runbook 한 줄을 산출물에 남긴다.

## 시간 제한

- job 하나는 함수 타임아웃 안에 끝나야 한다 — 큰 작업은 페이지 단위로 쪼개고(`run_after`로 이어달리기), 함수 타임아웃을 늘려 버티는 설계 금지.
- 분 단위 정밀도만 보장한다고 가정한다 (provider cron 최소 단위). 초 단위 스케줄 요구는 이 profile 범위 밖 — 전용 워커로 안내.

## QA·release 요구

- job 실행 경로(enqueue → claim → 실행 → 재시도 → 포기)는 unit test 대상이다 (fake clock).
- cron 트리거 endpoint는 endpoint 가드 5종(§7/backend-patterns)의 인증·rate limit을 적용한다.
- `vercel.json` crons 또는 workflow 파일은 source fingerprint 대상이므로 Phase 4 quality runner 전에 완성한다.
