# Selective OpenAPI Adoption Contract

기존 프로젝트에서 전체 OpenAPI를 한 번에 생성·이관하지 않는다. 현재 요청에 필요한 endpoint만 선택하고 기존 수동 client와 public type을 보존한다.

## 흐름

1. OpenAPI source와 version/fingerprint를 기록한다.
   - remote source는 분석 시점에 읽되 사용자가 요청하지 않으면 전체 snapshot을 repository에 commit하지 않는다.
2. 요청 키워드, tag, path, summary, operationId로 후보를 찾는다.
3. 최대 15개 후보를 method/path/summary와 함께 보여주고 필요한 endpoint를 multi-select한다.
4. 선택 operation이 참조하는 request/response/error schema closure를 계산한다.
5. 기존 generator를 우선하고 없으면 `orval | openapi-typescript | manual-types` 중 선택한다.
6. 생성 위치를 별도 namespace로 두고 기존 fetch/query/type을 자동 교체하지 않는다.
   - 선택 endpoint는 stable adapter/public API 뒤에 격리하고 예상 생성 파일·줄 수를 diff budget으로 기록한다.
7. 선택 endpoint의 client, runtime schema, MSW, error envelope만 계약 비교한다.
8. typecheck와 API contract fixture가 통과한 뒤 integration point를 전환한다.

## 금지

- 전체 spec 생성으로 기존 API 수십 개를 동시에 바꾸기
- operationId 없이 path 이름을 추측해 연결하기
- generated type만 믿고 외부 응답 runtime validation 생략하기
- 기존 filter/schema 항목 제거하기
- Mock handler를 실제 계약과 다른 편의 schema로 유지하기
- 선택하지 않은 operation이나 schema closure 밖의 파일을 생성·수정하기

## 산출물

`_workspace/02_design/openapi-selection.md`에 source fingerprint, selected operations, schema closure, generator, stable adapter, diff budget, preserved contracts, migration/non-goals를 기록한다.
