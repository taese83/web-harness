# 티켓 종류마다 문이 다르다

팀이 컴포넌트 축을 선언했으면(`componentAxis`) 그것이 기준이다. 선언이 없으면 인테이크는
분류하지 않고 `source-artifact-ingestor`가 본문을 읽어 정한다.

| 티켓 | 문 | 남기는 것 | 원장 |
|---|---|---|---|
| 기획 티켓(사람이 씀) | `intake` → ingestor → feature-planner → `bind` | 스냅샷 · 인벤토리 행 · **출처 마커**(`web-harness:source`) | 쓰지 않는다 |
| 개발 티켓(하네스 발행) | `claim` → `pickup` | **왕복 마커**(`web-harness:refs`) | 청구 기록 |
| 개발 티켓(개발자가 직접 씀) | `adopt` → `pickup` | **왕복 마커** | 청구 기록(`origin: adopt`) |
| 개발 티켓 · 기획 문서 없음 | `adopt --normalize` → `pickup` | **왕복 마커** | 청구 기록 + 계획에 FEAT 섹션 |

## 모든 문이 같은 change-scope로 끝난다

네 경로 모두 마지막 문은 `pickup`이고, 픽업이 **티켓 경로의 유일한 발급자**다 — 그래서 기획 경로로 온
티켓과 개발자가 직접 쓴 티켓이 개발 에이전트에게 **같은 키**로 닿는다. 아래는 **티켓 경로가 발급하는**
change-scope의 키이며 `test-change-scope-contract.mjs`가 코드(`buildChangeScope`와 실제 발급 파일)와
양방향으로 대조한다. 같은 경로(`_workspace/03_dev/change-scope.md`)에 오케스트레이터도 **다른 형식**
(`minimal-change-contract.md`의 마크다운 brief — `REQUEST`·`DOCS_TO_UPDATE` 등)을 쓴다. 두 형식은
생산자가 다르고 키가 다르다 — 이 표는 그 brief를 대체하지 않는다(통합은 별건).

<!-- web-harness:change-scope-keys -->
| 키 | 뜻 |
|---|---|
| `ticketKey` | 트래커 키(종전 호환) |
| `ticket.key` · `ticket.provider` | 어느 트래커의 어느 티켓인가 |
| `ticket.revision` · `ticket.revisionStage` | 개발 기준 개정 — 픽업 끝에 다시 잰다(`settled-at-pickup`). 못 재면 `pre-pickup` 그대로 |
| `ticket.revisionError` (선택) | 픽업 끝의 재조회가 실패했거나 빈 값을 줬을 때 그 이유 |
| `featureId` | 계획 단위 |
| `TARGET_BEHAVIOR` | 제목·본문 + 티켓 맥락(개정·링크·코멘트) — 전부 격리 블록, 지시 아님 |
| `requestType` | 요청 유형 |
| `testCaseIds` | **수용 기준** — 계획의 TC(티켓이 지어내지 않는다). `link`의 완료 판정이 이것을 본다 |
| `ALLOWED_PATHS` · `needsConfirmation` | 쓰기 범위 seed와 확인 필요 표시 |
| `PUBLIC_CONTRACTS_TO_PRESERVE` · `NON_GOALS` · `CHANGE_BUDGET` | `minimal-change-contract.md`의 같은 필드 |
| `sourceDigest` | STALE 앵커 — 픽업 뒤 계획이 바뀌면 `link`가 막는다 |
<!-- /web-harness:change-scope-keys -->

`link`는 대조한 change-scope의 `ticket`을 원장 링크 기록에 옮긴다 — **이 PR이 어느 티켓 개정을
보고 개발됐는지**가 원장에 남는다(티켓 → change-scope → PR). 지금 티켓과의 비교는 하지 않는다 —
`link`는 로컬 기록이고 트래커를 부르지 않는다.

두 경로를 **실제 Jira provider 코드**로 처음부터 끝까지 도는 회귀가 `test-ticket-routes-e2e.mjs`다(메모리 Jira · feature-planner 단계는 계획 파일로 대신 · git 주입) — 같은 키 집합, 기획자 코멘트의 도달, 트래커 쓰기가 스탬프·발행·배정·in-progress 전이뿐임(`done`이 매핑돼 있어도 부르지 않는다), 원장 링크의 개정 일치를 잰다. 실행 요약: `docs/audits/receipts/2026-09-11-ticket-routes-e2e.json`. **누가 했는가는 트래커 배정자까지다** — 원장은 Claude 세션·에이전트 id를 잇지 않는다(소비자가 생기면 그때 잇는다).

**실행 조건은 change-scope 키가 아니다.** 선언해도 읽는 쪽이 없고, 강제의 실체는 다른 곳에 있다:
외부 쓰기는 이 스킬의 규약(픽업 요청이 승인하는 셋 — 배정·in-progress 전이·되돌림 코멘트, 머지·완료
전이는 하지 않는다)이 정하고, 기계 차단은 **하네스 저장소 세션의 서브에이전트에 한한다**(bash 정책은
플러그인에 실리지 않고 메인 스레드는 대상이 아니다). 같은 체크아웃의 developer 쓰기 직렬화는 write
임대 훅이 한다(플러그인에도 실린다).

## 왜 마커가 둘인가

기획 티켓에 왕복 마커를 찍으면 `findByFeature`·`parseIssueRefs`가 그것을 **개발 티켓으로
착각한다** — 픽업 대상이 갈라진다. 그래서 출처는 다른 이름의 마커를 쓴다.

기획 하나가 기능 여럿을 낳는 것은 정상이므로 **출처 마커는 여러 개 붙을 수 있다**. 왕복
마커는 하나뿐이고, 다른 FEAT의 마커가 이미 있으면 loud하게 거부한다.

## 왜 `bind`는 원장을 쓰지 않는가

개발자가 픽업하는 것은 개발 티켓이다. 기획 티켓을 청구로 올리면 개발자가 기획 티켓을
픽업하게 되고, 팀이 선언한 컴포넌트 축이 무의미해진다.

## 개발자가 직접 쓴 개발 티켓

`adopt`가 없으면 그 티켓은 **어느 문으로도 못 들어온다**(실측: `intake`는
`dev-ticket-not-source`, `bind`는 `not-intaken`, `pickup`은 `not-claimed`로 전부 닫혔다).
`adopt`는 그 티켓을 원장에 청구로 올리고 왕복 마커를 찍어 픽업 대상으로 만든다.

**근거 없이 인수하지 않는다**: FEAT가 로컬 계획에 실재해야 하고, 팀이 축을 선언했으면 그
티켓이 개발 티켓이어야 하며, 양쪽 다 다른 곳에 묶여 있지 않아야 한다.

## 발행하는 개발 티켓의 라벨·컴포넌트

`labels`·`components` 설정이 그대로 실린다(예: `components: ['DEVELOP']`,
`labels: ['frontend']`). **하네스 라벨이 먼저고 팀 라벨이 뒤다** — `feat-…`은 조회 키라
사라지면 왕복이 끊긴다.

## 일반화 근거

이 계약이 인코딩하는 것은 **「티켓 종류마다 문이 다르다」는 구조**이지 특정 팀의 컴포넌트
이름이 아니다. `PLAN`·`DEVELOP`은 코드 어디에도 없고 `componentAxis` 선언이 든다.

- **Jira + 컴포넌트로 축을 나누는 팀** — `componentAxis`에 매핑을 선언하면 인테이크가 그것으로
  분류하고 개발 티켓을 공급 원문으로 받지 않는다. 실측 형태(2026-09-09): `PLAN`·`DESIGN`·
  `DEVELOP`·`AGENT` 넷을 쓰는 팀이며, 매핑에 없는 `AGENT`는 **미분류**로 남는다(추측하지 않는다).
- **GitHub Issues처럼 컴포넌트가 없는 트래커** — 선언이 없으므로 `classifyByComponent`가 `null`을
  내고 인테이크는 분류하지 않는다. `bind`·`adopt`는 그대로 동작한다(축 검사만 건너뛴다).
  즉 **축 선언은 강화이지 전제가 아니다.**

**진실 검증 수준: 명명 수준.** 세 문의 판정 경계는 회귀와 반증으로 고정했으나(`bind`가 왕복
마커를 쓰지 않는가 · `adopt`가 기획 티켓을 거부하는가 · 인테이크가 개발 티켓을 거부하는가),
**실제 팀의 Jira에서는 픽업까지 1회 돌았고(2026-09-09 AOA — intake·bind·adopt·pickup), link·PR까지 돈 기록은 아직 없다.** `workspace/*`는 하네스 자기
산출물이라 그 증거가 되지 못한다(`docs/protected-core.md` §4).

## `--normalize` — 기획 문서가 없는 개발 티켓

내부 상태관리·네트워크 로직처럼 화면도 시안도 없는 작업은 기획 문서를 거치지 않고 개발
티켓으로 바로 들어온다. 그때 `adopt`는 걸 단위가 없어 `unknown-feature`(또는 계획 파일 자체가
없으면 `missing-plan`)로 막는데, **처방만 있고 그것을 수행할 명령이 없었다**(실측 2026-09-09).
처방 없는 멈춤은 개발자를 티켓 흐름 **밖**으로 보낸다 — `/wh change` 직행이고, 그러면 원장·왕복
마커·PR 연결·완료 판정이 전부 빠진다.

`--normalize`는 티켓 본문을 FEAT **단위**로 정규화한다. **기획 문서를 만드는 것이 아니다**:

- **출처 판정을 우회하지 않는다.** `checkAdopt`가 먼저 서므로 기획 티켓은 이 경로로도 거부된다
  (`not-a-dev-ticket`). `bind`가 막는 것은 "이 티켓이 기획의 **출처**다"라는 주장이고,
  정규화가 만드는 것은 스케줄링 **단위**다. 순서를 바꾸면 그 문이 뒷문으로 열린다.
- **TC를 지어내지 않는다.** 본문에 규격 ID가 있으면 파서가 줍고, 없으면 없는 채로 둔다.
  **한계**: 그렇게 주운 TC를 `spec.mjs`는 기획자가 쓴 TC와 구별하지 못한다 — 개발자가 자기
  티켓에 `TC-NNN-N`을 적으면 기획 없이 `verifiable` 스팩이 선다(`protected-core.md` §4 등록).
  기계에 결속된 비용은 pickup readiness(동작·완료·실패)와 `deps-undeclared`뿐이다.
- **착수는 자동이 아니다.** `dependsOn` 미선언이면 `claimScopeReadiness`가 픽업을 막는다.
  `--depends-on none`(또는 FEAT 목록)을 **운영자가** 줘야 한다 — 하네스가 `none`을 자동으로
  쓰면 「미선언 ≠ 없음」 규율이 깨진다.
- **입구 하한은 `intake`와 같다.** 비신뢰 본문 스캔(`scanUntrustedBody`) · 단일 단위 검사 ·
  제목 한 줄 접기. 본문에 `## FEAT-NNN` 줄이 있으면 `normalize-ambiguous`로 반려한다 —
  그대로 두면 계획에 유령 단위가 생기고 `claim`이 그것을 티켓으로 발행한다(실측).
- **개발 티켓이라는 근거를 요구한다.** 일반 `adopt`는 미분류를 통과시키지만 정규화는
  `componentAxis`로 `개발 티켓`이 확정돼야 한다 — 공유 계획에 쓰기 때문이다.
- **출처가 사람 눈에 보인다.** 섹션 맨 앞에 `> 출처: 개발 티켓 <키>` 줄이 들어간다.
  주석에만 있으면 계획을 읽는 다음 사람이 이 FEAT가 기획을 거쳤다고 읽는다(I1).
- **멱등이다.** 마커의 `ticket=`으로 이미 정규화된 티켓을 찾는다. 트래커에서 본문이 편집돼
  왕복 마커가 지워져도 두 번 만들지 않는다(`ticket-already-normalized`).
- 붙는 자리는 flat이면 `feature-plan.md`, sharded면 **정렬 마지막 샤드**다.

readiness는 그대로다 — 동작 · 완료 기준 · 실패 시는 여전히 요구하고, 화면·디자인 근거는
`hasUserInterface`가 거짓이면 묻지 않는다. 채울 수 없는 것을 묻는 게이트는 아무 문자나 적게 만든다.

### `--normalize`의 일반화 근거 (검증 수준: 명명 수준)

서로 다른 서비스 형태 2개 이상에 성립한다:

- **화면 있는 웹앱의 비-UI 작업** — 세션 스토어 만료 정리처럼 `PAGE-000`(전역 책임)에 해당하는
  단위. 화면 근거를 요구하지 않는 기존 예약 ID와 같은 자리다.
- **화면 없는 형태(library·cli)** — `hasUserInterface`가 거짓이라 애초에 화면·시안을 묻지
  않는다. 이 형태에서는 개발 티켓이 정상 입구이며 기획 문서 부재가 결함이 아니다.

특정 서비스의 이름·백엔드·수치를 인코딩하지 않는다 — 분류 어휘(`componentAxis`)는 팀이
설정으로 들고, 이 경로가 아는 것은 「개발 티켓인가」와 「걸 단위가 있는가」 둘뿐이다.

