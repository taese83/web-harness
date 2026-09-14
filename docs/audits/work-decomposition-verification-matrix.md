# WORK 분해 검증 매트릭스 (T01~T62)

설계안 T01~T28(`docs/work-item-decomposition-design.ko.md` §15)과 확장안 T29~T62(`docs/developer-input-and-foundation-analysis.ko.md` §9)를
실제 테스트에 연결한다. **이 표는 구현 단계마다 갱신한다.** 기준: 2026-09-14, **P2-c(발행) 구현 시점**.
두 설계 원문은 사용자 문서이며 저장소에 추적되지 않는다(작성자 로컬) — 번호와 상황 문구는 이 표에 옮겨 둔다.

상태: **PASS** 자동 회귀로 확인 · **부분** 이 단계 몫만 확인(남은 몫 명시) · **P2/P3** 해당 단계에서 구현 예정(미구현) ·
**N/A** 사용자 결정(legacy 호환 불필요)으로 해당 없음 · **NOT_RUN** 외부 환경(실 Jira 등) 필요.

테스트 파일: `U` = `.claude/scripts/test-work-plan.mjs` · `C` = `.claude/scripts/test-work-claim-process.mjs`(실제 CLI 프로세스) ·
`E` = `.claude/scripts/test-work-events.mjs` · `V` = `.claude/scripts/test-work-provider.mjs`(provider 능력·WORK 필드 빌더 conformance) · `P` = `.claude/scripts/test-work-publish.mjs` · `K` = `.claude/scripts/test-work-pickup.mjs`(픽업·실행부·CLI 배선) · `B` = `.claude/scripts/test-work-board.mjs`(보드) · `N` = `.claude/scripts/test-work-link.mjs`(완료 주장·머지 관측) · `A` = `.claude/scripts/test-work-aggregate.mjs`(부모 집계·집계 티켓) · `X` = `.claude/scripts/test-work-close.mjs`(자동 닫기 — 실제 프로세스·가짜 gh) · `R` = `.claude/scripts/test-work-resolve.mjs`(원장 키 인식·발행 확정 입구) · `L` = `.claude/scripts/test-wh-lanes.mjs`. fixture: `.claude/evals/fixtures/work-plan/{crud,editor}`.

| T | 상황 | 상태 | 근거(테스트) · 남은 몫 |
|---|---|---|---|
| T01 | FEAT 하나를 A~G로 분해 | PASS | U「T01·T03·T43」 — FEAT·TC 불변, WORK만 존재 |
| T02 | 기반 작업에 사용자 TC 없음 | PASS | U「T02」 — checks 필수, 가짜 TC 거부 |
| T03 | 공통 기반을 FEAT 둘이 사용 | PASS | U + `P`「T43·T48」 — 계획상 WORK 하나, 발행도 생성 1건(소비 FEAT 라벨 다중) |
| T04 | 필수 TC 매핑 제거 | PASS | U「T04」 — 누락·중복 책임 거부 |
| T05 | 필수 작업을 계획에서 삭제 | PASS | U「T05」·C「T05·T39」·C「취소한 작업」·C「검토는 이벤트 원장에」 — 계보는 **이벤트 원장 ∪ 포인터**라 포인터를 지워도 삭제를 잡는다. 한계: 원장 자체를 지우는 것은 못 막는다(append-only는 tamper-evident) |
| T06 | foundation 순환·미충족 의존 | PASS | U「T06·T07」 |
| T07 | 미선언 의존과 명시적 [] | PASS | U「T06·T07」 |
| T08 | 같은 파일 동시 수정 | PASS | U「T08」 — 순서 있는 쌍은 허용 |
| T09 | 범위 밖 수정·symlink 탈출 | PASS | `K`「T09」 — WORK 픽업이 발급한 change-scope로 **소유권 훅을 실제 프로세스로** 돌려, 계획의 `writePaths` 안 쓰기는 허용되고 공유 기반·형제 작업 경계는 막힘을 확인했다. **훅은 실경로로 판정한다**(2026-09-14 적대 리뷰가 프로젝트 안 symlink로 범위를 넘는 우회를 잡아 고쳤다) — 같은 T09 회귀의 symlink 사례와 `test-ownership-hook`(7)이 결박하고(대상 없는 링크도 막는다), 루트 이탈은 기존 회귀가 잰다. 동시 쓰기 직렬화(임대)는 별도 훅 회귀다 |
| T10 | WORK 본문의 부모 FEAT를 legacy로 오인 | PASS | `E`「T10·T11」·`K`「G」 — 종류 선판정이 먼저 선다. FEAT 픽업 입구는 제거됐고(2026-09-14) WORK 픽업은 WORK만 받으며, 인테이크도 WORK·집계 티켓을 공급 원문으로 받지 않는다 |
| T11 | 마커 삭제·파손·중복 | PASS | `E`「T10·T11」·`R`「T11」 — 파손·중복·두 모델 동시 소속은 명시적 오류이고, 마커가 지워진 WORK 티켓은 원장 키로 알아봐 픽업은 `work-marker-missing`으로 막고 인테이크는 공급 원문으로 받지 않는다(원장이 깨졌으면 멈춘다). **전제: 발행 원장이 커밋·공유돼 있어야 한다** — 원장 없는 체크아웃에서는 `unknown`으로 떨어진다. 키가 확정되기 전(`attempted`·`unknown`) 발행의 마커 삭제는 알아보지 못한다 |
| T12 | 생성 응답 유실·원장 실패 | PASS | `P`「T12·T13」·「조회가 불완전하면」·「원장에 시도를」·「확정을 원장에」·「키가 없으면」 — 쓰기 전 시도(요청 지문·시도 id) 기록(외부 쓰기 **시점에** 원장 대조), 유실·키 없음은 `unknown`, 원장 실패는 쓰기 전이면 정지·쓰기 뒤면 티켓 키를 실어 보류. 한계: 실 트래커 왕복은 NOT_RUN |
| T13 | 배치 일부 실패·재실행 | PASS | `P`「T12·T13」 — 성공분은 `reuse`로 남고 재생성 0, 나머지만 재개 |
| T14 | 동시 발행·계획 변경 | P2 | |
| T15 | Jira 하위 작업 미지원 | 부분 | `V`「T15」 — 설정 없으면 필요한 설정을 돌려주고 트래커를 부르지 않는다. subtask는 미구현으로 표기(성공 위장 없음). **실 Jira 왕복 NOT_RUN** — 링크 방향(부모=outward)은 가정이며 `workLink.parentSide`로 뒤집을 수 있다 |
| T16 | provider 조회 실패·페이지 절단 | 부분 | `V`「T16」 — total 미만이면 `complete:false`+커서, 0건 페이지는 `stalled`(전진 불가), 손상 커서는 loud, 형식 아닌 요청 키는 loud, 완결일 때만 못 본 키를 보고. gh 검색은 색인 지연이라 항상 불완전, 상한 도달은 `truncated`이고 키를 주면 못 본 키를 직접 조회한다(부재는 gh의 「없음」 응답만, 권한 실패는 던진다). **실 트래커 왕복 NOT_RUN**(없는 키 조회·검색 토큰화는 가정) |
| T17 | Closed지만 테스트 실패 | 부분 | `A`「T17·T19」 — 트래커 상태는 집계 입력이 아니고, 작업이 머지돼도 부모는 `closeEligible: false`(증거 미연결)다. **남은 몫**: 실제 테스트 실행 결과를 작업·부모 증거로 연결하는 runner·receipt 결합 |
| T18 | PR 링크만·다른 repo/base 머지 | 부분 | `N`「머지」·「기대 base」·`K`「T45」·`X`(1)(2) — PR 연결은 완료가 아니고, 링크 때 기록한 **기대 base에 머지된 것만** 완료·자동 닫기 대상이다(기대 base를 모르면 링크하지 않는다). **남은 몫**: 저장소(repo) 대조와 머지 뒤 revert(T23) |
| T19 | 다른 revision의 TC 통과 모음 | 부분 | `A`「T17·T19」 — 통합 revision 증거가 없으므로 부모를 닫을 수 있다고 하지 않는다(모을 증거 자체가 아직 없다). **남은 몫**: 같은 통합 snapshot 기준 집계 |
| T20 | TC 문자열만 주석에 존재 | 부분 | `N`「완료」 — 인용이 **아예 없는** 것은 막는다. **프록시 한계**: 주석에만 ID가 있어도 통과한다(legacy와 같은 등급, §4 등록) — 테스트가 기준을 실제로 검증하는지는 코드 리뷰의 몫 |
| T21 | 정책·시안·공유 상태 계약 변경 | 부분 | U「T21」 — FEAT 명세 변경 시 분해를 낡음으로 거부. 증거 stale은 P3 |
| T22 | 담당자만 변경 | P3 | 증거가 생긴 뒤에야 의미가 있다 |
| T23 | 머지 후 revert·base 변경 | P3 | |
| T24 | 인수 요구 누락·유예 TC | 부분 | `N`「완료 조건 미충족」 — 미충족을 `--accept-incomplete`로 넘기면 판정 요약과 함께 원장에 남는다. 유예 TC는 계획에서 책임 작업이 없다(P1). `A`「T24」 — 인수로 넘긴 완료는 `works-merged-with-exceptions`, 계획의 TC 유예는 `works-merged-with-deferrals`로 따로 표시되고 둘 다 닫을 수 없다. **남은 몫**: 사람 인수(`ACCEPTED`) 기록 |
| T25 | 구 자동 닫기 설치본 | PASS | `X`(4) — 판본 표지 없는 옛 사본은 설치됨으로 세지 않고 준비 검사가 FAIL로 알리며, 손봤을 수 있어 덮지 않는다 |
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
| T43 | FEAT 여러 개가 새 공통 계약 | PASS | U + `P`「T43·T48」 — 공유 작업의 생성 호출 1건, 소비 FEAT 라벨 전부. `V`가 두 트래커의 **실 필드 빌더**가 그 라벨을 보존하는지 잰다(발행 경로는 그 빌더를 쓴다) |
| T44 | FEAT 누락·Jira 목록 일부 | 부분 | U「T44」 — 범위 누락 거부, 불완전 목록은 확정만 막음. Jira 페이지 조회 실패 기록은 P2 |
| T45 | 선행 미완료 후속 WORK 등록 | PASS | `P`「T45」·「미해결 결정」·「결정이 안 난 작업은」·「후손은 손자까지」 — 이름 대고 고른 것은 **거절**, 전체 발행에서는 뿌리와 후손 모두 사유와 함께 목록에 남기고 나머지를 낸다. 이번 회차 결과를 모르는 작업의 후손은 손자까지 내지 않는다 |
| T46 | WORK pickup·부모 FEAT pickup | 부분 | `K` 14건(순수 8 · 실행부 5 · CLI 배선 1) — 분해된 FEAT를 집으면 어느 WORK로 가야 하는지 알려주고, legacy 게이트(인젝션·종류·STALE·등록·준비도·TC 없는 완료 거부·트래커 쓰기 제한·동시 배정·컨플릭·되돌림 코멘트)가 옮겨졌다. **해당 없음**: 기획자 체크리스트·브랜치 대조(WORK에 브랜치 청구가 없다). 완료·PR 연결은 `N`(P3-a) |
| T47 | 분해 후 FEAT 추가·부분 발행 | PASS | U「T44」 + `P`「T12·T13」「T47」 — FEAT 추가는 범위 누락으로 재검토 강제, 부분 발행은 성공분 유지·재개. 이미 발행한 작업이 다른 판본으로 나가 있으면 같은 발행이 **소비 메타데이터(본문의 소비 FEAT·TC·마커와 우리 라벨)만** 맞추고 코멘트로 알리며 둘 다 된 뒤에만 원장을 옮긴다(사람 라벨 보존·멱등·실패 시 옛 판본 유지·끝난 작업은 라벨만). 작업 내용이 바뀌었거나 원장의 트래커가 다르면 쓰지 않는다(대체로 간다). 실 트래커 왕복은 NOT_RUN |
| T48 | 공유 WORK의 관계 표현 부족 | PASS | `V` + `P`「T43·T48」 — 발행 경로에서 FEAT별 복제 없음(생성 1건·라벨 다중), 관계는 부모를 준 경우에만 걸고 적용 여부를 원장에 그대로 남긴다 |
| T49 | UI·state·API·통합 WORK로 분해 | 부분 | 작업별 designContext 선택·검증(U「T50·T52·T54」). 픽업 전달은 P2 |
| T50 | 여러 화면·이름만 유사 | PASS | U「T50·T52·T54」 — 없는 조건·다른 조건의 근거 거부 |
| T51 | 공통 컴포넌트 여러 FEAT/Epic | 부분 | 공통 WORK·디자인 근거 공유(계획). Epic 그룹 없음 |
| T52 | 시안 접근 실패·pending | PASS | U — pending 구현 근거 거부, 읽지 못한 자료 표시 |
| T53 | 원격 최신성 미확인·새 시안 | 부분 | 선택에 해시 키 거부, design-binding 판본 변경 경고. 관련 WORK·통합 영향 검토는 P3 |
| T54 | 비UI·generated/absent | PASS | U「T36」·「T50·T52·T54」 — not-applicable 근거 필수 |
| T55 | 첫 연결 일부·mock만 통과 | P3 | |
| T56 | 관련 없는 조건 변경·참조 삭제 | 부분 | 참조 삭제는 선택 검증이 거부. 관련 내용 비교 후 증거 재사용은 P3 |
| T57 | work-plan 없이 최초 WORK claim | PASS | C「T57」 — 실제 CLI 프로세스, 외부 쓰기 0 |
| T58 | 검토 후 변경·사전 confirm | PASS | C「T61·T58」(실제 CLI 프로세스: 배선·설정 부재·미검토·미리보기) + `P`「T58」×2 — 확인 전 외부 쓰기 0(트래커 호출 0·발행 이벤트 0), 검토 뒤 계획이 바뀌면 `--confirm`이 있어도 발행하지 않는다 |
| T59 | 검토 중 종료·일부 발행 후 재요청 | 부분 | 저장된 분석·계획·판본으로 검토 재개. 발행 재개는 P2 |
| T60 | 기획 문서+Jira 기획 출처 흐름 | 부분 | L — `/wh plan`이 기존 intake로 취합, 기획 티켓 청구 금지 문구. 전체 흐름·실 Jira는 NOT_RUN |
| T61 | legacy claim과 WORK 준비 요청 | PASS | FEAT 발행 경로가 제거돼(2026-09-14) `claim`은 WORK 준비·발행뿐이다. C「T61」 — `--confirm`이 와도 준비 흐름이 발행으로 폴백하지 않는다 |
| T62 | plan→claim→WORK pickup 전체 | 부분 | `C`·`P`·`K`가 구간별로(준비·검토 / 발행 / 픽업) 실제 CLI 프로세스와 stub 트래커로 돈다. **남은 몫**: 한 번에 끝까지 도는 회귀와 실 트래커 왕복은 없다 |

## §4.5 운영 보완 대조

| 항목 | 상태 | 근거 |
|---|---|---|
| 후속 상세화와 제품 유예 구분 · 분모 보존 | PASS | `A`「§4.5」 — 부모 집계에서 제품 유예는 분모에서 빠지고 후속 상세화는 분모에 남아 완료로 세지 않는다. 핸드오프(「유예 FEAT」)는 두 종류를 따로 **보고**하되 후속 상세화로 인계를 막지는 않는다(설계 결정) |
| 부분 발행 · 기존 선행 재사용 | PASS | `P`「T12·T13」 — 실패분만 재개하고 이미 발행된 선행은 `reuse`로 재사용(재생성 0) |
| 등록과 착수 조건 분리 | PASS | 등록(`P`)은 선행 닫힘만 요구하고, 착수 차단은 픽업(`K`)이 한다. `B`가 보드와 픽업을 **다섯 상태**(전부 발행 · 일부 발행 · 타인 배정 · 내 배정 · 발행 뒤 계획 변경)에서 행마다 대조한다 — 등록·판본·결정·선행·소유 **다섯 축에서** 일치한다. 티켓 본문이 필요한 축(인젝션·종류·키 대조·컨플릭)은 보드가 재지 않으며 계약에 그렇게 적었다 |
| 담당자 조정(세부 구현에 리드 승인 강제 금지) | 기계 검사 없음 | 계약 문서 「claim 흐름」 4에 명시. 행동 규칙이라 회귀로 잴 수 없다 |
| Jira 댓글을 계약 자동 승인으로 쓰지 않음 | 부분 | 인젝션 의심 코멘트 제외(J-1). 계약 차이 표시는 P2 |
| 자동 일정 최적화·기간 추정 없음 | PASS(구성) | `computeWorkView`는 rank·여는 후속 수·ID만 쓴다 |

## 레거시 제거 대응표 (2026-09-14)

FEAT 개발 티켓 경로(claim·pickup·board·link·bind·adopt·--normalize)를 제거하며 그 게이트를 셋 중 하나로 처분했다.
WORK로 **이관**된 것은 위 표(T45·T46·완료 절)가, **해당 없음**은 계약(`work-plan-contract.md` 「옮기지 않은 것」)이
적는다. 코드와 함께 **지운** 반증 seed 20건과 재앵커 15건은 receipt `docs/audits/receipts/2026-09-14-legacy-removal.json`에 있다.
핵심 검증기 두 검사는 WORK 기준으로 이관했다 — `tickets-cover-plan`(FEAT마다 필수 WORK가 발행됐는가) ·
`active-pickup`(진행 중 WORK가 지금 계획에서도 같은 판본인가). **남긴 것**: Console이 읽는 `ledger.mjs`·`route.mjs`
(Console은 범위 밖 — 판독 전용 표시). 자동 닫기 자산은 P3-c에서 WORK 원장 기반(v2)으로 교체했다.

## 반증

핵심 가드를 반증 seed로 결박했다(`falsification-registry.json`의 `work-*`·`cli-claim-work-dispatch`·`web-plan-intake-before-planning`) —
리뷰 반영 뒤 27곳(분석 7 · 계획 11 · CLI 7 · 스킬 1 · 계약 1) — 격리 사본 러너로 27/27 발화(2026-09-11).
P2-a에서 12곳(이벤트 원장 6 · 마커·종류 판정 2 · 판독 입구 2 · 검토 이벤트 2) — 12/12 발화
(receipt `docs/audits/receipts/2026-09-14-work-p2a-seeds.json`).
P2-b에서 14곳(절단·커서 5 · 요청 키 2 · 관계 설정 4 · 검색·목록 정직 2 · 발행 전 판정 1) — 14/14 발화. 그중 `github-list-missing-only-when-complete`는 T47에서 **은퇴**했다 — 잘린 목록에서 키 필터로 부재를 읽는 경로 자체가 키 단위 조회로 바뀌어 결박할 코드가 없고, 부재 판정은 `github-key-lookup-not-found-only`가 승계한다
(receipt `docs/audits/receipts/2026-09-14-work-p2b-seeds.json`).
T47·GitHub 보드에서 12곳(판본 차이 감지 1 · 쓰기 실패 시 원장 유지 1 · 빠진 우리 라벨 제거 1 · 동기화 기록의 판본 이동·확정 전제 2 · 내용 변경 거부·트래커 불일치 거부·끝난 작업 라벨만·알림 4 · 키 단위 조회·부재 판정 2 · 라벨 능력 필수 1) — 12/12 발화
(receipt `docs/audits/receipts/2026-09-14-work-t47-seeds.json`).
P2 틈(T09·T11·확정 입구)에서 10곳(마커 삭제 인식 2 · 확정: 마커 확인·대상 제한·확인 필요·판본 일치 4 · CLI 배선 1 · 인테이크 원장 파손 정지 1 · 소유권 훅 실경로 판정·대상 없는 링크 2) — 픽업 seed와 함께 28/28 발화
(receipt `docs/audits/receipts/2026-09-14-work-gaps-seeds.json`).
P3-c에서 13곳(기대 base 링크·머지·재링크 3 · PR URL 정규형 1 · 닫기 근거·트래커·검토 계보·이슈 번호 4 · 파손 정지 1 · 멱등 1 · 실패 수집 1 · 옛 사본 판정 2) — 링크 seed와 함께 32/32 발화
(receipt `docs/audits/receipts/2026-09-14-work-p3c-seeds.json`).
P3-b에서 15곳(유예 분모 2 · 닫기 불가 1 · 링크≠머지 1 · 예외·유예·TC 미대조 표시 3 · 책임 없는 TC 1 · 집계 티켓 발행 규율 5 · CLI 배선 1 · 핸드오프 보고 1) — 15/15 발화
(receipt `docs/audits/receipts/2026-09-14-work-p3b-seeds.json`).
P3-a에서 21곳(STALE 3 · 완료 조건 4 · 대상 기준선 2 · 인수 기록 1 · 멱등 1 · 등록 1 · 머지 관측 4 · 닫는 줄 트래커 1 · 선행=머지 완료 3 · CLI 배선 1) — 21/21 발화
(receipt `docs/audits/receipts/2026-09-14-work-p3a-seeds.json`).
P2-d 보드에서 7곳(픽업과 같은 축 1 · 발행 판본 1 · 소유 판정 1 · 미상≠미배정 1 · 등록 필수 1 · 사라진 티켓 1 · 조회 실패를 완결로 접기 1) — 7/7 발화
(receipt `docs/audits/receipts/2026-09-14-work-board-seeds.json`).
P2-d에서 16곳(인젝션·종류 2 · 등록·키 2 · STALE·워크트리 2 · 결정·선행 2 · 수용 기준 1 · 쓰기 경계 1 · 트래커 쓰기 제한 2 · 동시 배정 1 · 되돌림 어휘 1 · 범위 보호 1 · CLI 배선 1) — 16/16 발화
(receipt `docs/audits/receipts/2026-09-14-work-p2d-seeds.json`).
P2-c에서 20곳(검토 판본 결박 1 · 확인 전 쓰기 0 1 · 선행 닫힘·후손 전이 2 · 미해결 결정 2 · 재발행 금지 2 · 중복 보류 1 · 라벨 어휘·공유 라벨 2 · 시도 지문·순서 2 · 원장 실패 2 · 부모 참조 1 · WORK 필드 빌더 3 · CLI 배선 1) — 20/20 발화
(receipt `docs/audits/receipts/2026-09-14-work-p2c-seeds.json`).
