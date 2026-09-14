# WORK 분해 검증 매트릭스 (T01~T62)

설계안 T01~T28(`docs/work-item-decomposition-design.ko.md` §15)과 확장안 T29~T62(`docs/developer-input-and-foundation-analysis.ko.md` §9)를
실제 테스트에 연결한다. **이 표는 구현 단계마다 갱신한다.** 기준: 2026-09-11, **P0+P1 구현 시점**.
두 설계 원문은 사용자 문서이며 저장소에 추적되지 않는다(작성자 로컬) — 번호와 상황 문구는 이 표에 옮겨 둔다.

상태: **PASS** 자동 회귀로 확인 · **부분** 이 단계 몫만 확인(남은 몫 명시) · **P2/P3** 해당 단계에서 구현 예정(미구현) ·
**N/A** 사용자 결정(legacy 호환 불필요)으로 해당 없음 · **NOT_RUN** 외부 환경(실 Jira 등) 필요.

테스트 파일: `U` = `.claude/scripts/test-work-plan.mjs` · `C` = `.claude/scripts/test-work-claim-process.mjs`(실제 CLI 프로세스) ·
`E` = `.claude/scripts/test-work-events.mjs` · `L` = `.claude/scripts/test-wh-lanes.mjs`. fixture: `.claude/evals/fixtures/work-plan/{crud,editor}`.

| T | 상황 | 상태 | 근거(테스트) · 남은 몫 |
|---|---|---|---|
| T01 | FEAT 하나를 A~G로 분해 | PASS | U「T01·T03·T43」 — FEAT·TC 불변, WORK만 존재 |
| T02 | 기반 작업에 사용자 TC 없음 | PASS | U「T02」 — checks 필수, 가짜 TC 거부 |
| T03 | 공통 기반을 FEAT 둘이 사용 | 부분 | U — 계획상 WORK 하나를 소비 FEAT 셋이 같은 ID로 참조. 외부 티켓 하나는 P2 |
| T04 | 필수 TC 매핑 제거 | PASS | U「T04」 — 누락·중복 책임 거부 |
| T05 | 필수 작업을 계획에서 삭제 | PASS | U「T05」·C「T05·T39」·C「취소한 작업」·C「검토는 이벤트 원장에」 — 계보는 **이벤트 원장 ∪ 포인터**라 포인터를 지워도 삭제를 잡는다. 한계: 원장 자체를 지우는 것은 못 막는다(append-only는 tamper-evident) |
| T06 | foundation 순환·미충족 의존 | PASS | U「T06·T07」 |
| T07 | 미선언 의존과 명시적 [] | PASS | U「T06·T07」 |
| T08 | 같은 파일 동시 수정 | PASS | U「T08」 — 순서 있는 쌍은 허용 |
| T09 | 범위 밖 수정·symlink 탈출 | P2 | WORK change-scope와 훅 소유권 연결은 픽업(P2) |
| T10 | WORK 본문의 부모 FEAT를 legacy로 오인 | PASS | `E`「T10·T11」 — 종류 선판정 후 픽업·인수가 거부, 인테이크도 공급 원문으로 받지 않음 |
| T11 | 마커 삭제·파손·중복 | 부분 | `E`「T10·T11」 — 파손·중복·두 모델 동시 소속은 명시적 오류. 마커 삭제 시의 원장 대조는 발행이 생기는 P2-c |
| T12 | 생성 응답 유실·원장 실패 | P2 | 이벤트 원장 기반은 준비됨(`E`「파손·순서·원자성」) — 발행 경로는 P2-c |
| T13 | 배치 일부 실패·재실행 | P2 | |
| T14 | 동시 발행·계획 변경 | P2 | |
| T15 | Jira 하위 작업 미지원 | P2 | provider 관계 능력 |
| T16 | provider 조회 실패·페이지 절단 | P2 | |
| T17 | Closed지만 테스트 실패 | P3 | |
| T18 | PR 링크만·다른 repo/base 머지 | P3 | |
| T19 | 다른 revision의 TC 통과 모음 | P3 | |
| T20 | TC 문자열만 주석에 존재 | P3 | |
| T21 | 정책·시안·공유 상태 계약 변경 | 부분 | U「T21」 — FEAT 명세 변경 시 분해를 낡음으로 거부. 증거 stale은 P3 |
| T22 | 담당자만 변경 | P3 | 증거가 생긴 뒤에야 의미가 있다 |
| T23 | 머지 후 revert·base 변경 | P3 | |
| T24 | 인수 요구 누락·유예 TC | P3 | |
| T25 | 구 자동 닫기 설치본 | P3 | legacy 전환이 아니라 자동 닫기의 **교체**로 다룬다 |
| T26 | 전환 중 실패 후 재시도 | N/A | legacy 전환 없음(사용자 결정) |
| T27 | 분해하지 않은 v1 FEAT 유지 | N/A | P2에서 「WORK 경로만 존재」 확인으로 대체 |
| T28 | help·skill·배포 플러그인에서 도달 | 부분 | C「배선」(bash 정책) · CLI 분기 seed · 배포본 CLI 스모크 receipt `docs/audits/receipts/2026-09-11-work-claim-dist-smoke.json`(수동 1회). help 전체는 P5 |
| T29 | Markdown·다이어그램·타입·코드 경로 | 부분 | fixture가 Markdown 원문·코드 경로·읽지 못한 링크를 싣고 반영 연결까지 검증. 다이어그램·타입 입력 fixture 없음 |
| T30 | 초안·현재 설명 | PASS | U「T30」 |
| T31 | 문서와 코드가 다름 | 부분 | `intent`(current·target) 구분은 스키마. 불일치 판정은 의미 분석(에이전트)의 몫 — 기계 검사 없음 |
| T32 | URL 접근 불가 | PASS | U「T32」 — 읽지 못한 자료의 지문 거부, 반영 연결 필수 |
| T33 | 공통 모듈이 계약 충족 | PASS | U「T33·T35」 — reuse는 코드 관찰 근거 필수 |
| T34 | 공통 컴포넌트 일부 부족 | 부분 | extend/adapt/create는 gap 필수. 영향 분석은 의미 검토 |
| T35 | 검색 절단·동적 사용처 | PASS | U「T33·T35」 |
| T36 | 화면 없는 작업·단순 조회 | PASS | U「T36」 — 편집기 fixture, 디자인 부재 프로젝트(UI 작업은 direct-ui + 화면 명세, 기반은 not-applicable) |
| T37 | 미완 선행 기능의 우선순위 상승 | PASS | U「T37·T38」 |
| T38 | release 제외 기능의 소비자 | 부분 | 여는 후속 수는 계획 안의 작업만 센다(구성상). 전용 반례 테스트 없음 |
| T39 | source/state/common 계약 변경 | 부분 | C「T05·T39」 — CLI가 계산한 입력 지문 변경을 알리고 **계획이 다시 검토될 때까지** 검토표에 남긴다, WORK ID 유지. 한계: 분석이 언급한 파일만 본다 · 계획이 바뀌면(반영 여부와 무관하게) 알림을 비운다 · 연결 WORK를 stale로 좁히는 정밀 전파는 없다 |
| T40 | 우선순위·담당자만 변경 | P3 | 증거 무효화 판정은 증거가 생긴 뒤 |
| T41 | resolutionLinks 누락 | PASS | U「T41」 |
| T42 | WORK가 다른 digest/미결을 무시 | 부분 | U·C「T42」 — 검토 단계 차단. 활성화·발행·픽업 소비 지점은 P2 |
| T43 | FEAT 여러 개가 새 공통 계약 | 부분 | U — 공통 WORK 하나·소비 FEAT 전부. 티켓 하나는 P2 |
| T44 | FEAT 누락·Jira 목록 일부 | 부분 | U「T44」 — 범위 누락 거부, 불완전 목록은 확정만 막음. Jira 페이지 조회 실패 기록은 P2 |
| T45 | 선행 미완료 후속 WORK 등록 | P2 | |
| T46 | WORK pickup·부모 FEAT pickup | P2 | |
| T47 | 분해 후 FEAT 추가·부분 발행 | 부분 | FEAT 추가 시 범위 누락으로 재검토 강제(U「T44」). 부분 발행은 P2 |
| T48 | 공유 WORK의 관계 표현 부족 | P2 | |
| T49 | UI·state·API·통합 WORK로 분해 | 부분 | 작업별 designContext 선택·검증(U「T50·T52·T54」). 픽업 전달은 P2 |
| T50 | 여러 화면·이름만 유사 | PASS | U「T50·T52·T54」 — 없는 조건·다른 조건의 근거 거부 |
| T51 | 공통 컴포넌트 여러 FEAT/Epic | 부분 | 공통 WORK·디자인 근거 공유(계획). Epic 그룹 없음 |
| T52 | 시안 접근 실패·pending | PASS | U — pending 구현 근거 거부, 읽지 못한 자료 표시 |
| T53 | 원격 최신성 미확인·새 시안 | 부분 | 선택에 해시 키 거부, design-binding 판본 변경 경고. 관련 WORK·통합 영향 검토는 P3 |
| T54 | 비UI·generated/absent | PASS | U「T36」·「T50·T52·T54」 — not-applicable 근거 필수 |
| T55 | 첫 연결 일부·mock만 통과 | P3 | |
| T56 | 관련 없는 조건 변경·참조 삭제 | 부분 | 참조 삭제는 선택 검증이 거부. 관련 내용 비교 후 증거 재사용은 P3 |
| T57 | work-plan 없이 최초 WORK claim | PASS | C「T57」 — 실제 CLI 프로세스, 외부 쓰기 0 |
| T58 | 검토 후 변경·사전 confirm | 부분 | C「T61」 — `--confirm`을 승인으로 쓰지 않음. 쓰기 직전 digest 재대조는 P2 |
| T59 | 검토 중 종료·일부 발행 후 재요청 | 부분 | 저장된 분석·계획·판본으로 검토 재개. 발행 재개는 P2 |
| T60 | 기획 문서+Jira 기획 출처 흐름 | 부분 | L — `/wh plan`이 기존 intake로 취합, 기획 티켓 청구 금지 문구. 전체 흐름·실 Jira는 NOT_RUN |
| T61 | legacy claim과 WORK 준비 요청 | 부분 | C「T61」 — WORK 요청이 FEAT 발행으로 폴백하지 않음. legacy 의미 보존은 N/A |
| T62 | plan→claim→WORK pickup 전체 | P2 | 픽업이 없다 |

## §4.5 운영 보완 대조

| 항목 | 상태 | 근거 |
|---|---|---|
| 후속 상세화와 제품 유예 구분 · 분모 보존 | 부분 | U「T44·§4.5」 — 유예 사유 종류 필수, fixture에 두 종류 모두 있음. C — 유예 FEAT가 검토표에 종류·TC 수와 함께 남는다. **P1에서 두 종류의 기계적 취급은 같다**(둘 다 작업 없음) — 「후속 상세화는 완료 분모를 줄이지 않는다」는 부모 집계(P3)가 생겨야 실체가 된다(명명 수준) |
| 부분 발행 · 기존 선행 재사용 | P2 | 발행이 없다 |
| 등록과 착수 조건 분리 | 부분 | 착수 가능 집합 계산(U「T37·T38」). 등록은 P2 |
| 담당자 조정(세부 구현에 리드 승인 강제 금지) | 기계 검사 없음 | 계약 문서 「claim 흐름」 4에 명시. 행동 규칙이라 회귀로 잴 수 없다 |
| Jira 댓글을 계약 자동 승인으로 쓰지 않음 | 부분 | 인젝션 의심 코멘트 제외(J-1). 계약 차이 표시는 P2 |
| 자동 일정 최적화·기간 추정 없음 | PASS(구성) | `computeWorkView`는 rank·여는 후속 수·ID만 쓴다 |

## 반증

핵심 가드를 반증 seed로 결박했다(`falsification-registry.json`의 `work-*`·`cli-claim-work-dispatch`·`web-plan-intake-before-planning`) —
리뷰 반영 뒤 27곳(분석 7 · 계획 11 · CLI 7 · 스킬 1 · 계약 1) — 격리 사본 러너로 27/27 발화(2026-09-11).
P2-a에서 12곳(이벤트 원장 6 · 마커·종류 판정 2 · 판독 입구 2 · 검토 이벤트 2)을 더했다 — 12/12 발화
(receipt `docs/audits/receipts/2026-09-14-work-p2a-seeds.json`).
