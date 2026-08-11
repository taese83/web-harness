# Metric Set Contract

런타임에 **활성 measure 조합을 스왑**하는 컨트롤. 행을 필터하지 않고(그건 필터 계약), 뷰가
렌더하는 measure 집합을 바꾼다. 대시보드/뷰 레벨의 컨트롤이 대상 차트들의 활성 set을 전환한다.

## 모델

```ts
type MetricSet = {
  id: string
  name: string
  options: MetricSetOption[]
  defaultOptionId: string
}
type MetricSetOption = {
  id: string
  label: string
  targets: { viewId: string; metricSetId: string }[] // 어느 뷰에 어느 set을 적용할지
}
```

각 차트/뷰는 자신의 measure set 목록을 이미 가진다(semantic query의 metricSets). metric-set 컨트롤은
그중 하나를 **선택**할 뿐, 새 measure를 정의하지 않는다.

## 규칙

- **적용 자격**: measure set을 **2개 이상** 가진 뷰만 대상(1개면 스왑 의미 없음).
- **충돌 시 first-wins**: 한 뷰를 여러 option target이 가리키면 정의 순서상 먼저가 이긴다(필터의
  last-wins와 반대 — 이 비대칭은 명시 계약이며 주석이 아니라 문서로 고정).
- **브로드캐스트**: 선택된 option의 target에서 각 뷰의 활성 set id를 파생하고, 사전 계산된
  결과(예: hashed query 변형)에서 해당 set에 맞는 것을 고른다. 없으면 primary로 폴백.
- **파생은 fetch-free**: 이미 로드된 뷰 상태에서 set 목록을 읽고 재요청하지 않는다(N+1 금지).
- **저작**: option 이름 중복 금지(브로드캐스트 모호). target 자동 매핑은 동명 set 기준 제안 가능.

## 검증

- 2-set 미만 뷰가 대상에서 제외되는가.
- 동일 뷰 다중 target 시 first-wins가 결정적인가.
- option 이름 중복이 저장 전 거절되는가.
- 활성 set 전환이 올바른 사전계산 결과를 선택하고, 없으면 primary 폴백하는가.

## 일반화 근거

서로 다른 서비스 형태에 같은 계약이 성립함 — **명명 수준**(fixture 검증 전, 이 계약도 특정 사내
BI에서 역설계된 이력이 있어 2번째 형태 fixture 검증이 특히 필요):

- BI 대시보드 — 하나의 대시보드 컨트롤이 여러 차트의 활성 지표 세트(예: 매출/이익/건수)를 일괄 전환.
- SaaS 어드민 KPI 화면 — "일간/주간/월간" 지표 보기 전환이 여러 KPI 카드에 브로드캐스트.

두 형태 모두 `MetricSet`/`MetricSetOption` 모델·2-set 자격·first-wins·fetch-free 파생을 소비한다.
