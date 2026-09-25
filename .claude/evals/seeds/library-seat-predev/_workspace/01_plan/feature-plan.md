# Feature Plan — 도서관 열람실 좌석 예약 웹앱

입력: `requirements.md`, `ux-brief.md`, `decision-log.md` (PC-001~PC-006). 비대화 세션 — 미결 항목은 원문서의
ASSUMPTION/NEEDS_DECISION/BLOCKER 표기를 그대로 인용하며 이 문서에서 새로 임의로 해소하지 않는다.

## Page Groups
SURFACE_MODEL: route

근거: `ux-brief.md`가 `/login`·`/seats` 라우트와 URL 단위 화면 전환을 기술한다. 슬롯 상세·취소 확인은 `/seats`
안의 인라인·다이얼로그라 overlay 근거가 아니다.

| Page Group ID | Page | Route/Screen | Order |
|---|---|---|---|
| PAGE-001 | 로그인 | `/login` | 1 |
| PAGE-002 | 좌석 현황 | `/seats` | 2 |
| PAGE-000 | 공통(전역 세션/셸) | all | 99 |

## Feature List
| ID | Feature | User Value (1 line) | Priority | Page Group | Screen | Scope |
|---|---|---|---|---|---|---|
| FEAT-001 | 인증 세션 상태 & API 클라이언트 가드 | 로그인 이후 모든 화면이 일관된 인증 상태로 API를 호출하고 401을 놓치지 않는다 | Must | PAGE-000 | all | keep |
| FEAT-002 | 좌석/예약 도메인 계약 | 좌석·예약을 읽고 쓰는 모든 기능이 같은 상태값·오류 형태를 공유한다 | Must | PAGE-000 | all | keep |
| FEAT-003 | 로그인 | 회원번호+비밀번호로 인증해 좌석 현황에 진입한다 | Must | PAGE-001 | `/login` | keep |
| FEAT-004 | 오늘 좌석 현황 조회 | 현장에 가지 않고 지금 예약 가능한 좌석을 색으로 즉시 파악한다 | Must | PAGE-002 | `/seats` | keep |
| FEAT-005 | 좌석 예약 생성 | 좌석·슬롯을 선택해 1분 내 예약을 확정한다 | Must | PAGE-002 | `/seats` | keep |
| FEAT-006 | 예약 취소 | 실수 없이 내 예약을 취소하고 좌석을 재개방한다 | Must | PAGE-002 | `/seats` | keep |
| FEAT-007 | 세션 만료/미인증 접근 가드 | 세션이 끊겨도 하던 일을 잃지 않고 안전하게 재로그인으로 유도된다 | Must | PAGE-000 | `/login`, `/seats` | keep |
| FEAT-008 | 좌석 현황 자동/상시 새로고침 | 항상 최신 좌석 상태를 유지해 헛걸음을 더 줄인다 | Should | PAGE-002 | `/seats` | defer |
| FEAT-009 | 좌석 검색/구역 필터 | 좌석이 많을 때 원하는 구역만 빠르게 스캔한다 | Should | PAGE-002 | `/seats` | defer |

Should 항목(FEAT-008, FEAT-009)은 정책/규모 확인 전까지 `defer`다 — FEAT-008은 requirements.md의
NEEDS_DECISION(폴링 부하 허용치 불명), FEAT-009는 ASSUMPTION(실제 좌석 수 확인 후 50석 이상이면 필요)에
묶여 있다. Could Have(즐겨찾기, 카운트다운)는 REQ ID·AC가 없어 이번 계획에서 FEAT로 만들지 않았다 — 필요 시
requirements.md에 REQ ID와 AC가 먼저 확정된 뒤 write-back한다.

## Feature Behavior Specs and Test Cases (all Must — design-readiness-contract §3-1)

### FEAT-001 — 인증 세션 상태 & API 클라이언트 가드
<!-- web-harness:unit feat=FEAT-001 dependsOn=none paths=src/shared/auth/, src/shared/api/ -->
**동작 명세**: 로그인 성공 응답을 받으면 세션 상태(토큰/식별자)를 메모리·세션 스토리지에 저장한다(ASSUMPTION,
requirements.md Open Decisions — 실 API 토큰 방식 확정 전). 이후 모든 API 호출은 공용 클라이언트를 통해
세션 정보를 첨부한다. 임의 API 응답이 401(인증 실패)이면 클라이언트는 세션을 즉시 무효화하고
"session-expired" 이벤트를 발행한다(FEAT-007이 구독해 리다이렉트를 수행 — 이 FEAT는 리다이렉트 자체를
수행하지 않는다). 이 FEAT는 화면을 직접 그리지 않는 기반 계층이다.

| Test Case | Given | When | Then |
|---|---|---|---|
| TC-001-1 | 로그인 응답이 성공(토큰 포함) | 세션 스토어가 응답을 수신 | 세션 상태가 저장되고 이후 API 요청에 인증 정보가 첨부된다 |
| TC-001-2 | 임의 API 응답이 401 | 클라이언트가 응답을 수신 | 세션 상태가 즉시 무효화되고 session-expired 이벤트가 발행된다(리다이렉트는 FEAT-007 책임) |
| TC-001-3 | 세션이 유효하지 않은 상태 | 보호된 API를 호출 | 요청 전송 전에 세션 부재를 감지해 즉시 session-expired 이벤트를 발행하고 불필요한 네트워크 요청을 보내지 않는다 |

### FEAT-002 — 좌석/예약 도메인 계약
<!-- web-harness:unit feat=FEAT-002 dependsOn=none paths=src/entities/seat/, src/entities/reservation/ -->
**동작 명세**: 좌석 상태(available/타인예약/내예약/지난시간/상태확인불가) enum, 슬롯, 예약 타입과 조회/생성/
취소 함수 시그니처를 정의한다. Data Review Strategy에 따라 Phase 1~2는 mock fixture(normal/empty/error/
partial/conflict)로 이 계약을 만족시키며, 실 엔드포인트 매핑은 BLOCKER(OpenAPI 계약 미확보, decision-log
PC-004)가 해소된 뒤 `api-schema-designer` 산출물로 교체한다 — 이 FEAT는 shape만 소유하고 실제 엔드포인트
URL/인증 방식은 소유하지 않는다.

| Test Case | Given | When | Then |
|---|---|---|---|
| TC-002-1 | mock fixture(normal) | 좌석 목록 조회 함수를 호출 | 스키마를 만족하는 좌석/슬롯 목록을 반환한다(가용/타인예약/내예약/지난시간 상태 포함) |
| TC-002-2 | mock fixture(conflict 409) | 예약 생성 함수를 호출 | 표준화된 conflict 에러 타입(재시도 불가·재조회 필요 표시 포함)을 반환한다 |
| TC-002-3 | mock fixture(partial: 일부 좌석 조회 실패) | 좌석 목록 조회 함수를 호출 | 실패한 좌석은 "상태 확인 불가" 마커가 있는 항목으로, 나머지는 정상 항목으로 함께 반환한다 |

### FEAT-003 — 로그인
<!-- web-harness:unit feat=FEAT-003 dependsOn=FEAT-001 paths=src/pages/login/ -->
**동작 명세**: 회원번호·비밀번호 입력 폼을 제출하면 FEAT-001의 인증 API를 호출한다. 성공 시 PAGE-002로
이동한다. 실패 시 비밀번호 필드만 비우고 회원번호는 유지한 채 인라인 에러를 표시하며 재제출 가능 상태를
유지한다. 제출 중에는 버튼이 처리중(disabled) 상태가 되어 중복 제출을 막는다. 전 과정은 Tab/Enter만으로
완료 가능하다.

| Test Case | Given | When | Then |
|---|---|---|---|
| TC-003-1 | 비로그인 상태로 앱 진입 | 올바른 회원번호·비밀번호 제출 | 인증 성공 후 좌석 현황 화면(PAGE-002)으로 이동한다 |
| TC-003-2 | 잘못된 회원번호 또는 비밀번호 입력 | 제출 | 비밀번호 필드만 초기화, 회원번호는 유지, "회원번호 또는 비밀번호가 올바르지 않습니다" 인라인 에러 표시, 재시도 가능 |
| TC-003-3 | 로그인 처리 중 | 제출 버튼을 반복 클릭 | 버튼이 처리중(disabled) 상태로 바뀌어 중복 제출이 발생하지 않는다 |
| TC-003-4 | 키보드만 사용 | Tab/Enter로 입력 및 제출 | 마우스 없이 로그인 흐름을 완료할 수 있다 |

### FEAT-004 — 오늘 좌석 현황 조회
<!-- web-harness:unit feat=FEAT-004 dependsOn=FEAT-001, FEAT-002 paths=src/pages/seats/ui/SeatGrid/, src/pages/seats/model/, src/pages/seats/api/seatStatusQuery.ts -->
**동작 명세**: 좌석 현황 화면 진입 시 오늘 날짜 좌석 전체를 30분 슬롯 단위 상태(가용/타인예약/내예약/지난
시간/상태확인불가)로 조회·렌더링한다. 최초 진입은 그리드와 동일 크기의 스켈레톤을 보여 레이아웃 이동이
없게 하고, 재조회는 상단 미세 인디케이터로 표시한다. 전체 만석이면 안내 문구와 재조회 액션을 보여주는
빈 상태로 전환한다. 일부 좌석 조회가 실패해도 해당 좌석만 "상태 확인 불가"로 표기하고 나머지는 정상
표시한다(부분 실패). 전체 조회 실패 시 마지막 정상 데이터를 유지한 채 오류 배너와 재시도를 제공한다.
이 FEAT는 좌석 셀(`SeatCell`)에 액션 영역을 prop으로 노출해, FEAT-005(선택 콜백)·FEAT-006(취소 트리거
주입)이 이 파일을 직접 수정하지 않고 조합(IoC)으로 확장할 수 있게 한다.

| Test Case | Given | When | Then |
|---|---|---|---|
| TC-004-1 | 로그인 상태로 좌석 현황 화면 진입 | 화면 로드 | 모든 좌석이 30분 슬롯 단위로 가용/타인예약/내예약/지난시간 상태로 색+아이콘 이중 신호로 구분 표시된다 |
| TC-004-2 | 오늘 모든 좌석·슬롯이 이미 예약된 상태 | 좌석 현황 화면 조회 | "현재 예약 가능한 좌석이 없습니다" 안내와 재조회 액션을 보여준다(빈 상태) |
| TC-004-3 | 정상~최대 fixture(약 50~300석) 렌더링 | 스크롤 조작 | 조작 반응이 100ms 이내 시각 피드백을 유지한다(REQ-NFR-001 연계) |
| TC-004-4 | 일부 좌석의 상태 조회가 실패(API 부분 실패) | 화면 표시 | 해당 좌석은 "상태 확인 불가"로 별도 표기하고 나머지 좌석은 정상 표시된다 |
| TC-004-5 | 좌석 현황 화면 최초 진입 | 데이터 로딩 중 | 그리드와 동일 크기/위치의 스켈레톤이 표시되고 레이아웃 이동(CLS)이 없다(ux-brief 로딩 패턴 근거) |
| TC-004-6 | 이전에 정상 데이터를 표시한 상태에서 재조회 실패(500/네트워크 오류) | 오류 응답 수신 | 마지막 정상 데이터를 유지한 채 "좌석 정보를 불러오지 못했습니다, 다시 시도" 배너를 표시한다(ux-brief error state 근거) |

### FEAT-005 — 좌석 예약 생성
<!-- web-harness:unit feat=FEAT-005 dependsOn=FEAT-002, FEAT-004 paths=src/pages/seats/ui/SlotPicker/, src/pages/seats/ui/ReservationConfirmBar/, src/pages/seats/api/createReservationMutation.ts -->
**동작 명세**: 가용 좌석을 탭하면 FEAT-004가 노출한 선택 콜백을 통해 해당 좌석의 오늘 남은 슬롯이 인라인
확장된다. 슬롯을 선택하면 하단 고정 확정 바가 활성화된다. [예약하기] 실행은 honest loading(낙관적 갱신
금지)으로 서버 확정을 기다린다. 성공하면 좌석·슬롯이 "내 예약"으로 즉시 갱신되고 확정 피드백을 보여준다.
확정 시점에 이미 타인이 선점(409류)했으면 "다른 회원이 먼저 예약했습니다"로 원인을 명시한 안내와 함께
좌석 현황을 자동 재조회하고 내 선택을 초기화한다. 네트워크 타임아웃 시 로딩을 유지하다 재시도 안내를
표시하고 중복 요청을 보내지 않는다. 전 과정은 Tab/Enter/Space로 완료 가능하다.

| Test Case | Given | When | Then |
|---|---|---|---|
| TC-005-1 | 예약 가능(available) 좌석·슬롯 선택 | 예약 확정 액션 실행 | 해당 좌석·슬롯이 "내 예약"으로 즉시 갱신되고 확정 피드백(인라인 메시지)을 보여준다 |
| TC-005-2 | 확정 시도 중 다른 회원이 같은 좌석·슬롯을 먼저 확정(서버 409류) | 확정 요청 실패 응답 수신 | "이미 예약된 좌석입니다"(다른 회원이 먼저 예약했다는 원인 명시) 안내와 함께 좌석 현황을 자동 재조회하고 내 선택을 초기화한다 |
| TC-005-3 | 예약 요청 중 네트워크 타임아웃 | 응답 없음 | 로딩 상태를 유지하다 일정 시간 후 재시도 안내를 표시하고, 중복 예약 요청을 보내지 않는다 |
| TC-005-4 | 키보드만 사용 | Tab/Enter/Space로 좌석·슬롯 선택 및 확정 | 마우스 없이 예약을 완료할 수 있다 |

### FEAT-006 — 예약 취소
<!-- web-harness:unit feat=FEAT-006 dependsOn=FEAT-002, FEAT-004 paths=src/pages/seats/ui/CancelDialog/, src/pages/seats/api/cancelReservationMutation.ts -->
**동작 명세**: 본인의 "내 예약" 좌석(FEAT-004가 노출한 액션 영역에 이 FEAT가 취소 트리거를 주입)을 탭하면
취소 액션이 노출된다. 취소를 실행하면 좌석 번호·시간을 명시한 확인 다이얼로그가 열린다. 확정하면 예약이
취소되고 좌석·슬롯이 다시 예약 가능 상태로 표시된다. 다이얼로그를 닫거나(X/Esc) 취소를 선택하면 예약
상태는 변경되지 않고 포커스가 트리거(취소 버튼)로 복귀한다(파괴적 확인이므로 바깥 클릭으로는 닫히지
않는다). 취소 요청이 실패하면 낙관적 갱신을 하지 않았으므로 예약 상태를 되돌릴 필요가 없고, 실패 안내와
재시도 수단을 제공한다.

| Test Case | Given | When | Then |
|---|---|---|---|
| TC-006-1 | 본인의 활성 예약이 있는 좌석 | 취소 액션 실행 후 확인 다이얼로그에서 확정 | 예약이 취소되고 해당 좌석·슬롯이 다시 예약 가능 상태로 표시된다 |
| TC-006-2 | 취소 확인 다이얼로그가 열린 상태 | 다이얼로그를 닫거나(X/Esc) 취소를 선택 | 예약 상태는 변경되지 않고 포커스가 취소 버튼(트리거)으로 복귀한다 |
| TC-006-3 | 취소 요청이 실패(네트워크/서버 오류) | 실패 응답 수신 | 예약 상태를 되돌리지 않고(낙관적 갱신 금지) 실패 안내와 재시도 수단을 제공한다 |

### FEAT-007 — 세션 만료/미인증 접근 가드
<!-- web-harness:unit feat=FEAT-007 dependsOn=FEAT-001 paths=src/app/providers/ -->
**동작 명세**: `/seats`에서 조작(조회/예약/취소) 중 FEAT-001이 발행하는 session-expired 이벤트를 수신하면
즉시 `/login`으로 이동하고 "다시 로그인해주세요" 안내를 표시한다. 진행 중이던 선택 상태를 유지 시도할지는
ASSUMPTION(ux-brief, 실 API 세션 방식 확정 전 미정)이며 이번 계획은 최소한 데이터 유실 없이 안전하게
리다이렉트하는 것만 보장한다. 로그인하지 않은 사용자가 `/seats` URL로 직접 진입하면 라우트 진입 이전에
가드가 `/login`으로 리다이렉트한다.

| Test Case | Given | When | Then |
|---|---|---|---|
| TC-007-1 | 세션이 만료된 상태로 좌석 현황 화면에서 조작(조회/예약/취소) 시도 | API가 인증 실패(401류)를 반환 | 로그인 화면으로 유도하고 "다시 로그인해주세요" 안내를 표시한다 |
| TC-007-2 | 로그인하지 않은 사용자가 좌석 현황 URL로 직접 진입 | 페이지 로드 | 로그인 화면으로 리다이렉트된다 |

## Requirement Traceability
| Requirement/UX risk | Screen | Owner FEAT | Command/Query | Required Evidence |
|---|---|---|---|---|
| REQ-F-001 로그인 | PAGE-001 | FEAT-003 (+FEAT-001) | auth 로그인 mutation(엔드포인트는 FEAT-002/api-schema-designer 소유) | unit: TC-003-1~3 폼/에러/중복제출 로직, browser: TC-003-4 키보드 전용 E2E |
| REQ-F-002 좌석 현황 조회 | PAGE-002 | FEAT-004 (+FEAT-002) | 좌석 목록 query | integration: TC-004-1,2,4,6 mock fixture(normal/empty/partial/error) 렌더 검증, browser: TC-004-3,5 100ms 반응·스켈레톤 CLS 측정 |
| REQ-F-003 좌석 예약 생성 | PAGE-002 | FEAT-005 (+FEAT-002, FEAT-004) | 예약 생성 mutation | integration: TC-005-2,3 conflict 409·타임아웃 mock 재현, browser: TC-005-1,4 정상 확정·키보드 전용 E2E |
| REQ-F-004 예약 취소 | PAGE-002 | FEAT-006 (+FEAT-002, FEAT-004) | 예약 취소 mutation | integration: TC-006-3 실패 시 낙관적 갱신 금지 검증, browser: TC-006-1,2 confirm dialog 완료·포커스 복귀 |
| REQ-F-005 세션 가드 | PAGE-000/PAGE-001 | FEAT-007 (+FEAT-001) | session-expired 이벤트 구독, 라우트 가드 | integration: TC-007-1 401 mock 주입 리다이렉트, browser: TC-007-2 미인증 직접 URL 진입 리다이렉트 |
| REQ-NFR-001 성능(1분 완료, 100ms 그리드 반응) | PAGE-002 | FEAT-004, FEAT-005 | — | browser: max fixture(300석) 조작 반응 perf 측정, task timing(로그인 완료~예약 확정 피드백) |
| REQ-NFR-002 반응형 | PAGE-001, PAGE-002 | FEAT-003, FEAT-004, FEAT-005, FEAT-006 | — | browser: 모바일/태블릿/데스크톱 레이아웃 회귀 |
| REQ-NFR-003 접근성(WCAG 2.2 AA) | PAGE-001, PAGE-002 | FEAT-003, FEAT-004, FEAT-005, FEAT-006 | — | browser: 키보드 전용 전체 플로우, 44×44 타깃, 색+아이콘 이중 신호, `:focus-visible` axe 검사 |
| REQ-NFR-004 브라우저 | PAGE-001, PAGE-002 | FEAT-003, FEAT-004, FEAT-005, FEAT-006 | — | browser: iOS Safari/Chrome Android 최근 2버전 1차 검증, 데스크톱 Chrome/Safari/Edge 레이아웃 깨짐 없음 |
| UX risk: 동시성 충돌을 "내 실수"로 오인 | PAGE-002 | FEAT-005 | — | browser: TC-005-2 "다른 회원이 먼저 예약했습니다" 원인 명시 문구 확인 |
| UX risk: 취소 확인 문구 모호로 실수 취소 | PAGE-002 | FEAT-006 | — | browser: TC-006-1 다이얼로그에 좌석 번호·시간 노출 확인 |
| UX risk: 세션 만료 중 조작 손실 | PAGE-002/PAGE-001 | FEAT-007 | — | integration: TC-007-1 401 발생 시점 선택 상태 처리 확인(ASSUMPTION, ux-brief) |

## Delivery Slices
| Order | Visible user outcome | Dependencies | Critical states | Effort driver |
|---|---|---|---|---|
| 1 | 회원이 로그인해 인증 상태로 진입한다 | FEAT-001, FEAT-003 | 정상 로그인, 잘못된 자격증명, 중복 제출, 키보드 전용 | S |
| 2 | 로그인 후 오늘 좌석 상태를 색+아이콘으로 즉시 구분한다 | FEAT-001, FEAT-002, FEAT-003, FEAT-004 | loading 스켈레톤, empty(만석), partial(부분 실패), error(전체 실패) | M — 상태 수가 많음(가용/타인예약/내예약/지난시간/확인불가) |
| 3 | 좌석·슬롯을 선택해 1분 내 예약을 확정한다(핵심 성공 조건) | FEAT-002, FEAT-004, FEAT-005 | 정상 확정, conflict 409, 타임아웃, 키보드 전용 | L — 동시성 처리(낙관적 갱신 금지, 충돌 후 재조회)가 가장 큰 리스크 |
| 4 | 내 예약을 취소해 좌석을 재개방한다 | FEAT-002, FEAT-004, FEAT-006 | confirm dialog 확정/취소, 취소 실패(롤백 금지) | M — destructive 확인 흐름 |
| 5 | 세션이 끊기거나 미인증 접근 시 안전하게 로그인으로 유도된다 | FEAT-001, FEAT-007 | 조작 중 401, 미인증 직접 URL 진입 | S |
| 6 (Should, defer) | 좌석 현황이 자동/상시로 최신 유지된다 | FEAT-004, FEAT-008 | NEEDS_DECISION(폴링 부하) 해소 후 착수 | S |
| 7 (Should, defer) | 구역/검색으로 좌석을 빠르게 찾는다 | FEAT-004, FEAT-009 | ASSUMPTION(좌석 수 50석 이상 확인) 해소 후 착수 | S |

Effort Trade-off(requirements.md)의 "smallest visible review"는 Order 2+3을 하나의 mock 프로토타입(가용/
내예약/타인예약/충돌/만석 상태 포함)으로 합쳐 Phase 2에서 먼저 검증할 것을 권고한다 — 구현 Delivery Slice
순서(위 표)와 Phase 2 프로토타입 범위는 다를 수 있음을 명시한다.

## Local Domain State
N/A — `LOCAL_DOMAIN_STATE_MODE = false`(decision-log PC-003). 좌석·예약의 authoritative store는 도서관 REST
API이며 앱은 도메인 데이터를 브라우저에 영속하지 않는다(세션 토큰만 예외, FEAT-001 소유).

## External Data Flow
N/A — `EXTERNAL_DATA_INGESTION_MODE = false`(decision-log PC-002). 브라우저는 도서관 API를 요청마다 실시간
조회·호출만 하며 별도 수집·정규화·승격 파이프라인이 없다.
