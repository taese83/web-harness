# Plan Review: 도서관 열람실 좌석 예약 웹앱 (Phase 1 → Phase 2 인계)

- 레인: `plan` (강제 지정) · 기획 공급원: `generated`
- 검토자: `plan-reviewer` (read-only) · 기계 판정: 디자인 인계 검사

## 1. 기계 판정 (design 인계)

- 명령: `web-harness-script validate-handoff-readiness --project <cwd> --to design --json` (완화 플래그 없음)
- exit code: **0** · verdict: **READY** · **holes: []**

| id | state | detail |
|---|---|---|
| plan | PASS | FEAT 7건 전부 의존·경로 선언됨 |
| prose-ordering | PASS | 의존 엣지 5건 선언 |
| prose-edges | SKIPPED | 산문에서 의존 진술을 찾지 못함 |
| acceptance | PASS | FEAT 7건 전부 TC 보유 |
| active-pickup | SKIPPED | 진행 중 픽업 없음 |
| source-consumption | SKIPPED | 공급 원문 인벤토리 없음(generated 경로) |
| design-inputs | PASS | 화면 3 · 조건 열 6 · **상용 조건 축 `권한`이 열로 없다** (막지 않음 — 사람 판정) |
| design-binding | SKIPPED | 공급된 디자인 근거 없음 |
| upstream-decisions | SKIPPED | 프리뷰 없음 |

parallelism: units 7 · edges 8 · longestChain 3 · independent 2 · bottleneck FEAT-001(3건 차단)

**메인 세션 판정(design-inputs 경고):** 이 서비스에는 권한 부류가 있다 — 401 세션 만료와 별개로 403/422 정책 거절(이용 제한 회원·보유 한도 초과)과 "타인 예약에 취소 진입점 없음"이 존재한다(§3-9, §3-10). 따라서 `ux-brief.md` 조건 표에 `권한` 열을 추가해야 하며, 해당 없는 화면(PAGE-001 로그인 등)은 `해당 없음(사유)`로 채운다. → D3에 포함.

## 2. 항목별 판정

| 항목 | 판정 | 근거 |
|---|---|---|
| 사용자·목표·성공 조건 | OK | 정회원 / 헛걸음 pain / "좌석 현황 진입 → 예약 확정 피드백 60초"가 연결됨(`requirements.md:4-8`, PC-006). 측정 구간은 ASSUMPTION이며 검증 방법 있음. 권고: Phase 2 task timing은 MSW 지연 0이면 과대평가 — fixture에 LTE 수준 지연을 넣어 측정. |
| Must/Should/Won't 범위·현실성 | NEEDS_DECISION | Must 5개(REQ-F-001~005)는 M 규모로 현실적. 정책 NEEDS_DECISION 3건(`requirements.md:99-101`: 1인 보유 한도, 연속 슬롯, 운영시간)이 REQ-F-003/002의 핵심 인터랙션을 직접 바꿈. 수동 새로고침 지위가 문서마다 다름(§4). |
| 근거 없는 "당연한 기능" 유입 | 지적 | (1) REQ-F-002 partial("상태 확인 불가" 좌석, `requirements.md:40`)은 API가 좌석 단위 부분 실패를 준다는 가정 — ASSUMPTION 표기 필요. (2) 로그아웃·회원 식별 표시(`ux-brief.md:40,47,58`)는 REQ/FEAT 없이 UX에만 있음. |
| silent conflict resolution | 1건 지적 | 충돌 문구 requirements "이미 예약된 좌석입니다"(`:44`) vs ux-brief "다른 회원이 먼저 예약했습니다"(`:73`) — TC-005-2(`feature-plan.md:113`)가 결정 없이 합침. |
| UX Check · critical state · annotation | 부분 OK | UX Check·Critical States 4종 있음, Annotation N/A 적절. 누락: 정책 거절, 선택 중 슬롯 시각 경과, 이미 취소·만료된 예약 취소, 타임아웃 후 결과 불명. |
| 시나리오 카테고리 | 지적 | `requirements.md:111` "빠진 시나리오: 없음"이지만 §3의 6건이 AC/TC에 없음. |
| ASSUMPTION 검증 · BLOCKER 누락 | 부분 OK | (1) "실제 공간 배치도 은유"(`ux-brief.md:8`)는 API가 좌석 좌표를 준다는 미기록 가정. (2) "열람실 단일 공간"(`requirements.md:93`)은 PAGE-002 IA를 바꾸는 도메인 사실이며 도서관 확인으로만 검증 가능. |
| 데이터 전략 · Mock→real | OK, 보완 1 | mock / production-integration-later 분리, mock 단계 production mutation 없음. 보완: 실 전환 조건에 **비운영 API 환경 또는 테스트 계정** 없음. requirements fixture 목록에 401 세션 만료 누락(tech-stack `:106`에는 있음). |
| S/M/L/XL · invest/reduce/split | 경미 | 전체 M인데 Delivery Slice 3이 L(`feature-plan.md:166`) — driver 정합 필요. |
| REQ → FEAT → evidence | OK, 경미 | 고아 Must REQ 없음. 로그아웃/마지막 갱신 시각에 REQ·FEAT 없음. FEAT-008/009가 REQ ID 없이 생성(`feature-plan.md:35` 자체 규칙과 불일치). "세션 만료 중 조작 손실" risk → TC-007-1이 선택 상태를 검증하지 않음. |
| 동작 명세 · TC 품질 | 지적 | TC-005-3 "일정 시간 후" 임계값 없음. FEAT-005/006 경계 케이스 없음, FEAT-003 네트워크 오류 TC 없음. TC-004-5/004-6은 ux-brief에만 근거 — requirements write-back 필요. REQ-F-002 AC "스크롤/필터 조작"(`requirements.md:39`)이 defer된 FEAT-009를 Must에 넣음. |
| plan history | 경미 | feature-plan/tech-stack 최초 생성과 AD-02가 PC 엔트리로 없음 — 다음 라운드 diff 기준점 부재. |
| 공급 원문 갭 분류 | N/A | `00_source/` 비어 있음. |

## 3. 심화 검토: 권한 · destructive(취소) · 동시성

**동시성**
1. 예약 타임아웃 후 결과 불명 — 서버에서 이미 성공했다면 재시도가 중복 예약 또는 409를 낳고, 409면 "다른 회원이 먼저 예약했습니다"가 자기 예약을 타인 탓으로 오안내. 재시도 전 재조회(reconcile) AC 필요.
2. [예약하기] 중복 제출 방지 AC 없음(로그인에는 있음, `requirements.md:33`).
3. 슬롯 시각 경계 — 선택 후 확정 전에 슬롯이 "지난 시간"이 되는 경우 처리 없음.
4. 데이터 신선도 — 정상 상태 수동 새로고침이 Must로 보장되지 않아 stale "가용" 표시가 헛걸음을 재생산할 수 있음.
5. TC-006-1 Then("다시 예약 가능 상태로 표시")은 타인의 즉시 재선점에 좌우 — 본인 관점 결과로 교체. 취소 완료 문구 AC 없음.

**destructive(취소)**
6. stale 취소(다른 기기에서 취소·노쇼 자동 해제) → 404/409가 일반 실패로 처리되어 재시도 무한 반복.
7. 다이얼로그 닫기 버튼이 "취소"(`feature-plan.md:129`) — "예약 취소" 다이얼로그 안의 "취소" 버튼은 오조작 위험.
8. 진행 중 예약 조기 반납 허용 여부 미정 — 정책 묶음에 편입.
- 잘된 점: confirm dialog, 바깥 클릭 닫기 제외, 포커스 복귀, 좌석·시간 노출, 낙관적 갱신 금지(AD-04) 일관.

**권한**
9. 401/403 구분 없음 — 이용 제한·한도 초과 403/422가 일반 오류로 떨어짐. (기계 판정 design-inputs의 `권한` 열 부재와 같은 원인)
10. 타인 예약에 취소 진입점 없음 negative AC 없음. "내 예약" 판별 소유 필드가 미기록 mock 가정.
11. 로그인 연속 실패 계정 잠금 문구 없음(API 소유, 경미).

## 4. 문서 간 정합

- Mode 일치: OK — requirements·tech-stack 모두 LOCAL_DOMAIN_STATE / TIMESERIES / ANALYTICS_BUILDER / EXTERNAL_DATA_INGESTION = false.
- 수동 새로고침 범위 충돌: `requirements.md:58` Should / `ux-brief.md:67` "Must 대체 수단" / `tech-stack.md:96` AD-09 "Must 대체 수단" / `feature-plan.md:30` FEAT-008 Should·defer. 정상 상태 새로고침·"마지막 갱신 시각"(`ux-brief.md:46`)을 소유한 Must FEAT 없음.
- 충돌 안내 문구 불일치(§2).
- 세션 만료 후 선택 유지: FEAT-007 가치 "하던 일을 잃지 않고"(`feature-plan.md:29`) vs 명세 "안전한 리다이렉트만"(`:136`) vs ux-brief "유지 시도(ASSUMPTION)"(`:46`).
- 토큰 저장·BLOCKER 소재: OK(requirements 3건 / tech-stack 4건은 표현 차이).
- Won't 노쇼 "표시만 최소화"(`requirements.md:71`) 모호 — BLOCKER 4와 함께 정리.

## 5. 외부 API 계약 부재의 영향 범위

- **Phase 2(mock 디자인)는 막지 않는다.** 엔드포인트·스키마·토큰 방식·CORS·409 payload는 mock으로 대체 가능한 전송·형식 계층이고, AD-02 Branch A/B는 배포·BFF 구조만 바꾼다(`tech-stack.md:89`).
- Phase 2 재작업 위험은 **도서관 정책·도메인 사실**(연속 슬롯, 보유 한도, 운영시간, 조기 반납, 열람실 수, 배치 좌표)에서 온다 → NEEDS_DECISION.

---

## READINESS: NEEDS_DECISION

기계 판정 READY(HOLE 0) + 내용 검토상 사용자 결정 3건. Phase 2 착수를 막는 내용 BLOCKER는 없다.

## 우선 결정 (최대 3)

**D1. [P1] 수동 새로고침·신선도의 Must/Should 지위**
- 추천: 수동 새로고침 버튼 + "마지막 갱신 시각"을 REQ-F-002 Must AC로 승격(FEAT-004 소유), 자동 폴링만 FEAT-008 Should/defer. — Must가 버튼·표시 하나씩 늘지만 네 문서 약속이 일치하고 stale 가용 표시를 막는다.
- 대안: 전부 Should, 문구만 정리. — 작업은 적지만 정상 상태 헛걸음 위험이 남는다.

**D2. [P1] 예약 정책 묶음(연속 슬롯 / 보유·일일 한도 / 운영시간 / 조기 반납 / 열람실 수)의 Phase 2 반영 방식**
- 추천: Phase 2를 지금 시작하되 슬롯 피커는 "시작~종료 범위 선택(단일 30분은 특수 경우)", 정책 거절 상태와 열람실 선택 자리를 흡수형으로 설계하고 도서관 확인 후 축소. — 시안 범위가 조금 넓지만 정책이 어느 쪽이든 PAGE-002를 재설계하지 않는다.
- 대안: 단일 30분·단일 열람실 고정. — 가장 단순하나 확정 결과에 따라 핵심 화면 재설계.

**D3. [P2] 동시성·취소·권한 AC 보강 (§3의 1·2·3·5·6·7·9·10 + ux-brief `권한` 열)**
- 추천: reconcile-then-retry(타임아웃 후 재조회 먼저), 취소 404/409는 "이미 취소되었거나 만료된 예약입니다"+재조회(재시도 없음), 401/403 분리 및 조건 표 `권한` 열 추가, 다이얼로그 라벨 "예약 유지"/"예약 취소하기", 충돌 문구 단일화. — 타임아웃 경로에 조회 1회가 늘지만 중복 예약과 오귀속 안내를 막는다.
- 대안: 실 API 계약 확보까지 보류. — 지금은 가볍지만 Phase 2 시안에서 상태가 빠져 개발 단계에서 UX 재작업.

## BLOCKER 목록

**Phase 2 착수 BLOCKER: 없음**

**production 연결 전 BLOCKER**
1. 도서관 API 계약(OpenAPI 등) 부재 — 엔드포인트·스키마 (`requirements.md:103`)
2. 인증 토큰 방식(쿠키 vs Bearer)·CORS 허용 origin 미확정 — AD-02 Branch A/B 결정 원인 (`tech-stack.md:53`)
3. 409 충돌 응답 스펙 미확정 (`requirements.md:104`)
4. 노쇼·자동 해제 정책 소유 주체 불명 (`requirements.md:105`)
5. (추가 권고) 예약·취소 mutation을 검증할 비운영 환경/테스트 계정 — Mock→real 전환 조건(`requirements.md:82`)에 추가 필요
