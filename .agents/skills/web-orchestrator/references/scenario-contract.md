# Scenario Derivation Contract

고정 기능 목록이 아니라 요청의 특성에 맞는 관점만 선택해 구체적인 시나리오를 생성한다. 미결 시나리오는 `❓`로 표시하고 다음 Phase의 구조를 바꾸면 진행 전에 확인한다.

## 범용 카테고리

| 신호 | 카테고리 | 핵심 질문 |
|---|---|---|
| 선택·다중 선택 | A. 선택 상태 | 범위, 유지, 해제, stale selection |
| 라우팅·페이지·탭 | B. 화면 전환 | URL 복원, 이동 중 상태, 경계 페이지 |
| 생성·수정·삭제 | C. 데이터 변경 | 사전 검증, 중복 요청, 부분 실패, undo |
| query·mutation | D. 비동기/에러 | loading, timeout, retry, cancellation, stale response |
| 목록·검색·필터 | E. 빈 상태/경계 | empty 구분, 긴 값, 최대 데이터 |
| modal·toast | F. 피드백 | 닫힘 조건, 실패 시 유지, focus 복구 |
| 역할·소유권 | G. 권한 | 서버 권한, 혼합 목록, 권한 변경 |
| form·입력 | H. 폼 | 검증 시점, 중복, 제출 중 재요청, draft |
| polling·stream | I. 동시성/실시간 | 외부 변경, 탭 동기화, ordering, recovery |

## 분석·시각화 카테고리

| 신호 | 카테고리 | 핵심 질문 |
|---|---|---|
| aggregation·resolution | J. 데이터 의미 | range와 resolution, timezone, null, 단위, 집계 정확성 |
| chart type 변경 | K. 시각화 호환성 | 현재 query shape가 chart 요구를 만족하는지 |
| dashboard/chart 편집 | L. 편집·저장 | draft, dirty state, save conflict, undo, version |
| historical+stream | M. 데이터 정확성 | snapshot 경계, duplicate, gap, out-of-order, clock skew |

## 출력

```markdown
## Scenario Review
| ID | Scenario | Expected Behavior | Evidence | Status |
|---|---|---|---|---|
| D-1 | 필터 변경 직후 이전 요청이 늦게 완료됨 | 이전 응답을 취소하거나 무시 | browser test | ✅/❓/⚠️ |

## Open Decisions
- [ID] 선택 A / 선택 B와 trade-off
```

성공 흐름만 있는 계획은 완료로 보지 않는다. Must requirement마다 최소 정상·실패·경계 또는 해당 없음 근거가 있어야 한다.

