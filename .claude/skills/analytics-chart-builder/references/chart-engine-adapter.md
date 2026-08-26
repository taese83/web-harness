# Chart Engine Adapter Contract

차트 렌더링을 **엔진-무관 경계**로 격리한다. semantic한 `ChartSpec`을 엔진별 옵션으로 변환하는
adapter 1계층만 특정 라이브러리를 안다. 도메인·AST·persisted query는 렌더 엔진을 모른다.

## Adapter interface

```ts
type ChartEngineAdapter = {
  id: string // 'recharts' | 'echarts' | 'highcharts' | …
  license: 'free' | 'commercial'
  requiredModules?: (spec: ChartSpec) => string[] // 코드 스플릿 단위
  supports(spec: ChartSpec, resultSchema: ResultSchema): { ok: boolean; reason?: string }
  render(spec: ChartSpec, resultSchema: ResultSchema): EngineOptions // 순수 함수
}
```

`ChartSpec`은 chart type + 채널 매핑 + presentation 옵션(엔진 무관)이다. `render`의 결과 타입은
adapter 내부에만 존재한다.

## 경계 규칙

- 도메인/AST/persisted semantic query 타입은 **엔진 라이브러리를 import하지 않는다** (검증 게이트).
- `render`는 순수 함수 — 입력이 같으면 출력이 같고 부수효과 없음.
- **HTML 문자열 포매터 금지** — 포인트/툴팁은 구조적 포매터만(문자열 주입 XSS 인접 리스크 차단).
- renderer-specific 옵션을 persisted semantic query/`ChartSpec`에 넣지 않는다.

## 개방형 registry

chart type registry는 **개수를 고정하지 않는다**. 코어는 seed set(line/bar/table/funnel/retention/flow)을
제공하고, adapter가 자신이 지원하는 type을 `supports()`로 선언한다. type 추가는 adapter + registry 항목
+ `chart-compatibility.md` 항목의 3곳 동기화로 끝난다(선택 매트릭스의 나머지 관계는 여기로 승격).

## 엔진 선택 — inform-and-choose

엔진을 조용히 회피하지도, 조용히 방출하지도 않는다.

1. **감지** — analytics-BI 차트 필요(semantic query + 차트). 기존 프로젝트는 `package.json`의 차트
   라이브러리로, 신규는 intake의 고품질/다종 차트 요구로 감지.
2. **고지 + 선택** — 상용 라이선스가 필요한 엔진(`license: 'commercial'`)을 쓰려면 `tech-advisor`가
   **라이선스 필요 여부를 알리고 선택을 제시**한다(`NEEDS_DECISION`):
   - 라이선스 보유/가능 → 상용 adapter 채택
   - 없음/원치 않음 → 무료 adapter(대용량=canvas, 표준=SVG) — 커버 type·특성 차이 고지
3. **기록·스팩 확정** — 선택과 근거를 `decision-log.md`에 남기고 그때 capability를 확정한다
   (예: `chart-registry(<adapterId>)`, 상용 선택 시 `chart-engine.licensed` 표식).
   기존 프로젝트가 상용 엔진을 이미 쓰면 자동 감지하되 "라이선스 확인됨"을 decision-log에 명시.

상용 엔진은 **사전 조건 플래그가 아니라 선택의 결과**로 켜진다 — 다른 프로젝트에 라이선스 의무를
자동 생성하지 않기 위함. 무료 adapter가 기본값이다.

## 검증

- 경계 검증: 도메인/AST 파일에 엔진 import 0.
- registry `supports()` 정확성 + 미지원 전환에 disabled 이유.
- 엔진 선택이 decision-log에 근거와 함께 기록됐는지.

## 일반화 근거

서로 다른 서비스 형태에 같은 계약이 성립함 — **명명 수준**(fixture로 2형태 생성 검증 전):

- 사내 BI 대시보드 빌더 — 조직이 상용 엔진 라이선스를 보유, inform-and-choose로 상용 adapter 채택. 다종 차트·대용량.
- 공개 SaaS 제품 대시보드 — 라이선스 없음, 무료 adapter(canvas/SVG) 기본 채택. 소수 chart type, 번들 예산 우선.
- 마케팅/리포트 위젯 임베드 — 단일 chart type 렌더러만 등록하는 최소 registry 사용.

세 형태 모두 동일한 `ChartEngineAdapter` 경계·`supports()` registry·선택 플로우를 소비하고, 달라지는 것은 adapter 구성뿐이다.
