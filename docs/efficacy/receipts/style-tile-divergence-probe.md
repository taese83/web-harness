# 발산 기계화 경로 — 프로브 완주 receipt (2026-08-19)

`design-principles-research.md` §발산의 기계화의 첫 end-to-end 실행 근거. 프로브
프로젝트(`workspace/style-tile-probe`, gitignored eval fixture)의 가상 서비스
Grainhouse(필름 현상소 온라인 창구 — **브랜드-포워드 소비자 형태**, 취향 미결
`ASSUMPTION(시안 확정)` 2건 + 반(反)레트로 긴장 제약 포함 브리프).

## 실행 요약

- 스폰: `design-system-architect` 1회 — **132,616 tokens · 32 tool uses · 13.8분 · 완주**
  (probe `_workspace/04_qa/execution-telemetry.json`). 오케스트레이터 개입 0회 —
  계약 텍스트만으로 산출.
- 에이전트 산출: sharded design-system(INDEX + tokens·direction-rationale·
  component-inventory·accessibility) + 후보 3종 타일 + README(순위·기각 사유).

## 계약 이행 검증 (오케스트레이터 실측)

| 규약 | 결과 |
|---|---|
| 템플릿 사본 무결성 | sha256 4/4 동일(원본 + 후보 3 사본) — 수정 금지 준수 |
| 직교성(쌍마다 ≥2축) | A–B 4축·A–C 2축+·B–C 4축, 자기확인 기록 존재 |
| 상투 회피 자기검열 | **에이전트가 자기 후보 B를 상투 근접으로 자진 3순위 강등** — 목록의 음성 제약이 생성 시점에 작동 |
| 하한 우선 | 내장 대비 검사 전 후보 6/6 PASS — 실측: A 13.60/5.28/14.81/5.25/6.00/3.49 · B 14.03/5.35/14.76/5.04/6.12/3.51 · C 13.90/4.99/15.04/8.31/6.04/3.28 |
| 사전 계산 성실성 | 에이전트 수동 계산 vs 렌더 실측 오차 ±0.01~0.4(추정 표기 제외) — 날조 없음 |
| 렌더 판정 | 거부권 불행사 — 1순위 A 유지(브리프 적합성·상투 불성립 렌더 확인), 상세는 probe `style-tiles/RENDER-VERDICT.md` |
| 범위 재개 규칙 인지 | 에이전트가 전원-FAIL→재샘플링→BLOCKER 경로까지 README에 정확 재서술 |

## 판정과 한계

- 브랜드-포워드 형태에서 **직교 후보 생성→타일 렌더→하한 판정→커밋 완주 실증**.
  거부권 실행 경로(1순위 기각→차순위 재개)는 이번 런에서 미발동 — 미실증으로 남음.
- 어드민/대시보드 형태 완주는 미실증(명명 수준 유지).
- 프로브는 eval fixture다 — 실사용 프로젝트의 P2 발산 완주는 별도.
- 마찰 1건 발견·해소: 계약이 렌더 판정 기록의 위치를 미명세 → §발산의 기계화 5에
  `style-tiles/RENDER-VERDICT.md`로 고정(이 receipt와 같은 커밋).
