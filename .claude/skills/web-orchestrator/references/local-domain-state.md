# Local Domain State Contract

브라우저가 도메인 데이터의 authoritative store가 되는 웹 앱에 공통 적용한다.

## Detection

다음 중 하나면 `LOCAL_DOMAIN_STATE_MODE: true`다.

- localStorage, IndexedDB, OPFS 등에 CRUD 도메인 데이터를 영속한다.
- 서버 없이 보드, 에디터, 장바구니, 워크플로우, 초안, 오프라인 데이터를 관리한다.
- 정렬, 이동, 다중 선택, undo, 참조 관계처럼 둘 이상의 상태 불변식이 있다.
- 필터·검색·가상화된 view에서 원본 데이터를 변경한다.

단순 theme, language, density처럼 독립적인 소량 환경설정만 저장하면 이 모드를 켜지 않고 `developer`의 설정 persistence 계약을 사용한다.

## Required Design Artifact

`state-contract-designer`가 `_workspace/02_design/state-contract.md`에 다음을 기록한다.

1. authoritative state와 derived view 경계
2. aggregate, ID, 참조, 정렬 불변식
3. command별 precondition, postcondition, 실패 결과
4. 구조 필드와 일반 편집 필드의 분리
5. 삭제·cascade·confirm·undo·recovery 정책
6. storage schema, version, migration, invalid-state recovery, quota/size/count 상한
7. cross-tab, refresh, import/export가 있으면 충돌·동기화 정책
8. normal/max fixture와 interaction budget
9. 요구사항 ID별 unit/integration/browser evidence 계획

## Non-Negotiable Invariants

- `Partial<Entity>`로 ID, parent/reference ID, order, version, createdAt 같은 구조 필드를 수정하지 않는다.
- 이동·정렬·삭제는 명시적 command로만 수행하고 store/domain 계층에서 precondition을 재검증한다.
- UI의 숨김·필터·정렬 결과 개수로 destructive action 가능 여부를 판단하지 않는다.
- filtered/virtualized index를 canonical collection index로 직접 사용하지 않는다. ID 기반 변환을 정의하거나 해당 모드에서 reorder를 비활성화한다.
- mutation 완료 후 dangling reference, duplicate ID, duplicate/gapped order, stale selection이 없어야 한다.
- persisted JSON은 외부 입력이다. TypeScript type assertion만으로 rehydrate하지 않는다.
- parse/migration/quota 실패는 무한 crash loop가 아니라 복구 UI, reset 또는 export 경로로 연결한다.
- destructive bulk action은 도메인 정책에 따라 confirm, undo 또는 명시적 cascade를 제공한다.

## Required Verification Matrix

해당 기능이 존재하면 최소 다음 조합을 검증한다.

| View state | Mutation | Required assertion |
|---|---|---|
| filter/search active | delete | 숨겨진 데이터가 정책 없이 삭제되지 않음 |
| filter/search active | move/reorder | 화면 대상과 실제 mutation 대상이 동일함 |
| multi-selection | delete/move | stale ID와 중복 처리가 없음 |
| detail edit active | external/domain update | 미저장 draft가 예고 없이 사라지지 않음 |
| persisted old/invalid state | rehydrate | migrate 또는 안전 복구 |
| max fixture | frequent reorder/update | 정해진 interaction budget 충족 |

## Release Rule

`LOCAL_DOMAIN_STATE_MODE`에서는 `state-invariant-verifier`의 `qa-state.md`가 필수다. 불변식 위반, 데이터 손실 가능성, 검증되지 않은 migration, 필수 상태 시나리오 누락은 release hard stop이다.
