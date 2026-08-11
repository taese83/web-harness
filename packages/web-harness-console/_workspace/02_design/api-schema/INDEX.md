# Local API Schema — Web Harness Console

## 절 목록

| 절 | 파일 | 담당 범위 | 주 소비자 |
|---|---|---|---|
| 공통 조회·오류 | `common-read.md` | project catalog/detail/document, 공통 오류 | entity-query-builder, api-contract-verifier |
| Change Request | `change-requests.md` | append-only request 생성 | feature-mutation-builder, api-contract-verifier |
| Codex·검토 | `codex-review.md` | connection, impact/apply, review decisions | agent-runtime-scaffolder, human-approval-builder, api-contract-verifier |
| Preview origin | `preview.md` | 격리 preview read-only serving | browser-verifier, security-reviewer |

## 전역 결정

모든 endpoint는 `127.0.0.1`에 bind한다. Mutation은 same-loopback Origin, explicit intent, JSON body와 UUID idempotency를 검증한다.

## Assumptions and Blockers

- remote multi-user authentication/authorization은 MVP 범위 밖이다.
