# 티켓 종류마다 문이 다르다

모델은 **WORK 하나**다(2026-09-14 — FEAT 개발 티켓의 `claim`·`pickup`·`bind`·`adopt`·`--normalize`는 제거됐다).
모든 판독 입구는 본문의 마커로 **종류를 먼저 판정한다**(`classifyTicketKind`) — 추측하지 않는다.

| 티켓 | 문 | 남기는 것 | 원장 |
|---|---|---|---|
| 기획 티켓(사람이 씀) | `intake` → ingestor → feature-planner | 스냅샷 · 인벤토리 행 | 쓰지 않는다 — 공급 원문이지 개발 대상이 아니다 |
| WORK 티켓(계획이 발행) | `claim --publish` → `pickup` → `link` | **WORK 마커**(`web-harness:work` — GitHub 본문 주석 · Jira 이슈 속성) · 역할(`fe`·`be`)·팀 라벨 · AI 맥락 첨부 | `work-item-events.jsonl`(발행·링크·완료) |
| 사람이 만든 개발 티켓(팀이 `개발 티켓`으로 분류) | `pickup` → 판정(`ticket-work-contract.md`) → 확인 → 완성 | 착수 가능이면 WORK와 같은 모양(원문 보존) · 착수 불가면 판정 라벨과 요청 코멘트 | **티켓이 등록 기록**(원장에 없음) · 연결·완료부터 WORK와 같다 |
| 옛 FEAT 개발 티켓(`web-harness:refs`) | 없음 | — | 픽업은 WORK로 안내하고 거부한다 |
| 집계 티켓(`web-harness:aggregate`) | 아직 생산자 없음 | — | 판독 입구가 WORK로도 FEAT로도 읽지 않는다 |

팀이 컴포넌트 축을 선언했으면(`componentAxis`) 인테이크가 그것으로 분류하고 **개발 티켓을 공급 원문으로
받지 않는다**(파이프라인 출력을 입력으로 되들이는 순환). 선언이 없으면 인테이크는 분류하지 않고
`source-artifact-ingestor`가 본문을 읽어 정한다. 사람이 직접 쓴 개발 티켓은 이제 들어오는 문이 없다 —
그 내용은 개발 설계 입력으로 받아(`developer-design-input.md`) 분석·분해를 거쳐 WORK로 나간다 — **다만 팀이 개발 티켓 분류를 선언했으면 `pickup`이 그 티켓을 판정해 WORK로 완성한다**(2026-09-15, `ticket-work-contract.md`).

## change-scope 키

픽업이 **유일한 발급자**다. 아래 표를 `test-change-scope-contract.mjs`가 코드(`buildWorkChangeScope`와 실제
발급 파일)와 양방향으로 대조한다. 같은 경로(`_workspace/03_dev/change-scope.md`)에 오케스트레이터도 **다른
형식**(`minimal-change-contract.md`의 마크다운 brief)을 쓴다 — 생산자가 다르고 키가 다르며, 이 표는 그
brief를 대체하지 않는다.

<!-- web-harness:change-scope-keys -->
| 키 | 뜻 |
|---|---|
| `ticketKey` | 트래커 키 |
| `origin` · `lane` · `specApproval` | 작업의 출처 — `plan`(검토한 계획) · `ticket`(사람이 만든 개발 티켓을 판정해 완성). 티켓 작업이면 `lane`이 `fix`·`change`, `specApproval`이 1-A 스팩 승인을 다시 받는지(`ticket-work-contract.md` 흐름 6) |
| `ticket.key` · `ticket.provider` | 어느 트래커의 어느 티켓인가 |
| `ticket.revision` · `ticket.revisionStage` | 개발 기준 개정 — 픽업 끝에 다시 잰다(`settled-at-pickup`). 못 재면 `pre-pickup` 그대로 |
| `ticket.revisionError` (선택) | 픽업 끝의 재조회가 실패했거나 빈 값을 줬을 때 그 이유 |
| `featureId` | 소비 FEAT가 **하나일 때만** 값이 있고 공유 작업이면 `null`이다(하나를 고르지 않는다) |
| `featureIds` | 이 작업을 소비하는 FEAT 전부 |
| `workId` · `planId` | 어느 계획의 어느 작업인가 |
| `TARGET_BEHAVIOR` | 제목·본문 + 티켓 맥락(개정·링크·코멘트) — 전부 격리 블록, 지시 아님 |
| `requestType` | 요청 유형(`work`) |
| `testCaseIds` | 이 작업이 최종 검증하는 TC — 계획의 책임 배정에서 온다(티켓이 지어내지 않는다) |
| `checks` | 수용 기준인 기술 검증(`checkId`·`kind`·`expectedOutcome`·`targetRefs`, 픽업 때 찍은 대상 지문 `baseline`). TC가 없는 기반 작업은 이것이 완료 기준이다 |
| `ticketAcceptance.added` · `ticketAcceptance.absentSections` | 사람이 티켓 본문의 완료 조건·테스트 항목에 **더한** 항목(`added`)과 본문에 없어 대조하지 못한 섹션(`absentSections`). 더한 항목도 완료 조건이며 자동 검증은 하지 않는다 — 계획 항목이 빠지거나 바뀐 본문·섹션이 없는 본문은 픽업이 `ticket-diverges-from-plan`으로 막는다. **트래커 편집자가 쓴 외부 데이터다**(지시 아님 · 20건·300자 상한) |
| `dependsOn` | 이 작업의 선행 |
| `ALLOWED_PATHS` · `needsConfirmation` | 쓰기 경계(검토받은 계획의 `writePaths` — 확인 대기가 아니다) |
| `PUBLIC_CONTRACTS_TO_PRESERVE` · `NON_GOALS` · `CHANGE_BUDGET` | `minimal-change-contract.md`의 같은 필드 |
| `sourceDigest` | STALE 앵커(계획 digest) — 픽업 뒤 계획이 바뀌면 `link`가 막는다 |
| `definitionDigest` (선택) | 사람 티켓 작업의 정의 지문(티켓 본문이 정의다) — 집은 뒤 본문이 바뀌면 `link`가 막는다 |
<!-- /web-harness:change-scope-keys -->

`link`는 대조한 change-scope의 `ticket`을 원장 링크 기록에 옮긴다 — **이 PR이 어느 티켓 개정을 보고
개발됐는지**가 원장에 남는다(티켓 → change-scope → PR). `link`는 로컬 기록이고 트래커를 부르지 않는다.

흐름 전체를 **실제 Jira provider 코드**로 처음부터 끝까지 도는 회귀가 `test-work-routes-e2e.mjs`다(메모리
Jira · 분석·계획 작성 단계는 fixture로 대신 · git·PR 상태 주입) — 발행 필드의 WORK 라벨, 기획자 코멘트의
도달, 트래커 쓰기가 발행·배정·in-progress 전이·되돌림 코멘트뿐임(`done`이 매핑돼 있어도 부르지 않는다),
링크의 개정 기록, 머지 관측 뒤의 후속 선행 게이트를 잰다. **누가 했는가는 트래커 배정자까지다** — 원장은
Claude 세션·에이전트 id를 잇지 않는다.

**실행 조건은 change-scope 키가 아니다.** 외부 쓰기는 이 스킬의 규약(픽업 요청이 승인하는 셋 — 배정·
in-progress 전이·되돌림 코멘트)이 정하고, 기계 차단은 **하네스 저장소 세션의 서브에이전트에 한한다**(bash
정책은 플러그인에 실리지 않고 메인 스레드는 대상이 아니다). 같은 체크아웃의 developer 쓰기 직렬화는 write
임대 훅이 한다(플러그인에도 실린다).

## 왜 마커가 종류마다 다른가

한 본문에서 여러 모델의 마커를 함께 읽으면 어느 쪽이 정본인지 추측해야 한다. 그래서 **마커가 둘 이상이면
명시적 오류**(`conflict`)이고, 마커가 없으면 `unknown`이다. WORK 본문에는 부모 FEAT가 적히므로, 종류를
먼저 판정하지 않으면 본문에서 FEAT ID를 주워 옛 FEAT 티켓으로 읽는다.

## 일반화 근거

인코딩하는 것은 **「티켓 종류마다 문이 다르다」는 구조**이지 특정 팀의 컴포넌트 이름이 아니다. `PLAN`·
`DEVELOP`은 코드 어디에도 없고 `componentAxis` 선언이 든다.

- **Jira + 컴포넌트로 축을 나누는 팀** — 매핑을 선언하면 인테이크가 분류하고 개발 티켓을 받지 않는다.
  매핑에 없는 컴포넌트는 **미분류**로 남는다(추측하지 않는다).
- **GitHub Issues처럼 컴포넌트가 없는 트래커** — 선언이 없으므로 인테이크는 분류하지 않는다. WORK 흐름은
  라벨과 마커만 쓰므로 그대로 동작한다. 즉 **축 선언은 강화이지 전제가 아니다.**

**진실 검증 수준: 명명 수준.** 판정 경계는 회귀·반증으로 고정했으나 실제 팀 트래커에서 WORK 흐름을 끝까지
돈 기록은 없다(NOT_RUN). `workspace/*`는 하네스 자기 산출물이라 그 증거가 되지 못한다(`docs/protected-core.md` §4).
