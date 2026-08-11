# Segment / Reusable Filter Contract

재사용 가능한 이름 붙은 필터 정의. 값 리스트를 wire로 보내지 않고 **쿼리 시점에 집합 멤버십
조인**(`col IN (select …)`)으로 해석한다. 코호트(segment)와 값-리스트 두 종류를 모두 다룬다.

## 모델

```ts
type ReusableFilter = {
  id: string          // 안정 참조 id (uuid)
  label: string
  baseColumn: string  // 조인 대상 컬럼
  kind: 'segment' | 'value-list' // segment=코호트(사용자/엔티티 집합), value-list=열거값
  definition: FilterConditionGroups // OR-of-AND (기존 ChartFilter 재사용)
  executionTargetTag?: string       // 실행 타깃 식별(아래 제약)
}
```

AST에서는 참조로만 실린다: `{ column, ref: filterId, cast? }`. **resolved 값은 클라이언트가 보내지 않는다.**

## 실행 타깃 제약 (플러그러블)

set-membership 조인은 필터 정의와 소비 쿼리가 **같은 실행 타깃**일 때만 가능하다(엔진 간 조인 불가).
타깃 판별은 **주입 가능한 classifier**로 둔다 — 특정 엔진 이름(예: 어떤 SQL/OLAP 엔진)을 계약에
박지 않고 `executionTargetTag`로 비교한다. 타깃이 다르면 선택지에서 배제하고 이유를 표시한다.

## 참조 보존 불변식 (일반 규칙)

참조형 필터는 operand가 없다. **operand가 비어도 조용히 제거하지 않는다** — 참조 id가 매핑·직렬화·
저장 경로 어디서든 유실되면 필터가 무음으로 사라진다. 모든 linked-filter 경로가 참조 id를 보존해야
하며, 이 불변식은 verifier 게이트 대상이다.

## 검증

- 타깃 호환(같은 executionTargetTag) — 불일치 시 disabled 이유.
- 타입 호환: baseColumn↔소비 컬럼 type 일치 또는 명시 cast. 필요 시 실행-계획 기반 사전 검증(가능한 경우).
- cost/cardinality 상한(segment 크기)·취소.
- 참조 id 보존(위 불변식)의 round-trip 테스트(생성→저장→재로드).
- 권한·semantic correctness는 server도 검증(클라이언트 검증만 신뢰하지 않는다).

## 일반화 근거

서로 다른 서비스 형태에 같은 계약이 성립함 — **명명 수준**(fixture 검증 전, 이 계약은 특정 사내
BI에서 역설계된 이력이 있어 2번째 형태 fixture 검증이 특히 필요):

- 데이터 웨어하우스 BI — 분석가가 사용자 코호트(segment)를 정의하고 여러 차트/대시보드가 재사용. 실행 타깃 제약(웨어하우스 엔진별)이 관건.
- 이커머스 어드민 — "재구매 고객"·"휴면 고객" 같은 저장된 고객 세그먼트를 주문/매출 화면 필터로 재사용. 단일 실행 타깃, 참조 보존 불변식이 관건.
- 로그 탐색 도구 — 저장된 쿼리 조각(값-리스트 필터)을 여러 뷰에서 참조. 값 미전송·집합 멤버십 해석이 관건.

세 형태 모두 `ReusableFilter` 모델·참조 보존 불변식·타깃 classifier를 소비한다.
