# Browser Agent Implementation Contract

`browser-safety-contract.md`의 실행 우선순위·runtime 경계를 전제로, 운영 정책과 회복 전략을 고정한다.

## CAPTCHA·Bot Detection 정책 (명시적 거부)

- CAPTCHA를 감지하면 **우회를 시도하지 않는다** — 작업을 중단하고 사람에게 이관하며, 발생 지점·빈도를 기록해 공식 API 경로 협의 대상으로 보고한다.
- headless 탐지 회피(UA 위조, fingerprint 변조, 자동화 흔적 은닉)는 구현하지 않는다. 사이트가 자동화를 차단하면 그 의사를 존중하는 것이 이 스킬의 정책이다.
- 사내 시스템이 자사 봇을 허용해야 하는 경우, 회피가 아니라 **식별 UA + allowlist 등록**이 올바른 경로다.

## ToS·robots 준수

- domain을 allowlist에 등록하기 전에 확인·기록한다: ① 해당 사이트 ToS의 자동화 조항 ② 사내 시스템이면 시스템 owner의 서면 승인 ③ 조회 성격 작업이면 robots.txt 적용 여부.
- 미확인 domain은 등록할 수 없다 — "일단 등록하고 나중에 확인"은 FAIL.

## Politeness·Rate

- domain당 동시 세션 1, action 간 최소 간격(기본 1s, 사이트별 조정), 재시도는 지수 backoff + 상한(기본 3회).
- 대상 시스템의 오류율이 임계를 넘으면 해당 domain 작업을 자동 중지하고 보고한다 — 상대 시스템을 부하로 망가뜨리는 agent는 실패한 agent다.

## 비용 모델 (task당)

- step 상한, vision(screenshot 해석) 호출 상한, wall-clock 상한을 task 유형별 config로 고정한다.
- vision은 DOM/accessibility 경로 실패 시의 fallback 횟수만 — step마다 스크린샷을 모델에 넣는 설계는 비용 초과로 거부한다.
- 상한 도달 시 부분 결과 + 중단 지점 evidence로 종료한다. 조용한 무한 재시도 금지.

## Selector 회복력

- 우선순위: accessibility role/name → `data-testid` → 안정 속성 → 구조 selector (최후). 텍스트 내용 기반 selector는 i18n·문구 변경에 취약하므로 role/name과 결합해서만.
- 실패 시 재계획(re-plan)은 task당 N회(기본 2) — 초과하면 자가 치유 루프를 돌지 않고 사람에게 이관한다.
- 성공한 selector와 실패 이력을 site profile에 축적해 다음 실행의 초기 전략으로 사용한다 (프로필은 replay evidence와 함께 버전 관리).

## 세션·자격 증명 운영

- 세션은 task 단위 격리·종료 후 파기(기존 계약). 로그인 상태 재사용은 vault가 발급한 단기 세션 토큰으로만, 사이트별 최대 수명을 기록한다.
- MFA가 걸린 계정 작업은 사람 개입 지점을 워크플로에 명시한다 — agent가 MFA를 대행하지 않는다.

## 평가 추가 항목

- CAPTCHA 조우 시 이관 준수율 100 (우회 시도 0)
- politeness 상한 위반 0
- 재계획 상한 초과 후 이관 준수율
- site profile 적용 시 step 수 감소율 (회복력 학습 효과)
