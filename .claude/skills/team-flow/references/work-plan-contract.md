# WORK 분해 계약 — 선행 분석(P0)과 작업 계획(P1)

`claim`(WORK 모드)이 개발 준비를 조정할 때 `system-architect`가 쓰는 두 파일의 계약이다. CLI
(`ticket/cli.mjs claim`)는 의미를 이해하지 않고 **참조·상태·그래프**를 검증한 뒤 검토표를 만든다.
판정의 의미 품질(재사용이 정말 맞는가, 경계가 적절한가)은 개발 검토의 몫이다.

| 파일 | 소유 | 정본인 것 | 복제하지 않는 것 |
|---|---|---|---|
| `_workspace/03_dev/work-analysis.json` | system-architect | 출처·코드 관찰·판정·미결의 **연결** | 원문 설계·API 스키마·상태 계약 본문(00_source·02_design) |
| `_workspace/03_dev/work-plan.json` | system-architect | 기능 바인딩·작업 정의 | 요구사항·TC(정본은 feature-plan) |
| `work-plan-review.md` · `*-revisions/` · `work-plan-reviewed.json` | CLI | 검토표(생성물)·검토한 판본 스냅샷·포인터 | — |

## claim 흐름 (스킬이 조정하고 CLI가 검증한다)

1. `cli.mjs claim [--features FEAT-001,…]`(범위 생략 = 계획 전체). 외부 쓰기 0 — 결과의 `phase`가 다음 할 일이다.
   분석의 `scope.featureIds`는 호출한 범위와 **정확히** 같아야 한다 — 범위를 바꾸면 분석도 그 범위로 다시 쓴다.
2. 개발자가 준 설계 자료(Markdown·경로·링크 — 묶어 낼 때만 `developer-design-input.md` 템플릿)는 먼저
   `source-artifact-ingestor`로 `00_source/`에 원문 보존한다(구현 설계는 정규화하지 않는다). 받은 자료를 승인된
   결정으로 올리지 않는다 — 현재 설명·목표 설계·참고, 확정·초안·미정을 구분해 받는다.
3. `P0_ANALYSIS_REQUIRED` → `system-architect`를 스폰해 분석을 쓰게 한다(`next.reads`와 이 문서 경로를 넘긴다).
   `P1_PLAN_REQUIRED` → 같은 에이전트가 계획을 쓴다(`next.analysisRef`·`inventory[].sourceDigest`를 넘긴다).
   `*_INVALID`(exit 2) → `errors`를 그대로 돌려 고치게 한다 — 검사를 약화하지 않는다.
4. `P1_REVIEW` → `_workspace/03_dev/work-plan-review.md`를 보여주고 검토·수정을 받는다. 개발 책임자가 공통 경계·
   의존을 조정하고 실제 구현 개발자도 참여한다 — 계약·경계 안의 세부 구현까지 매번 승인받지 않는다.
   수정은 에이전트가 JSON에 반영하고 1로 돌아간다. `confirmable: false`면 범위 목록이 불완전하다.
5. `claim --publish` → 미리보기다. **외부 쓰기 0**으로 무엇을 어디에 낼지 돌려준다.
   같은 요청에 `--confirm`을 붙였을 때만 발행한다 — 미리보기가 승인의 대상이고, `--confirm`은 그 목록의 승인이다.
   `--work-ids a,b`로 일부만, `--parent <KEY>`로 부모 티켓과의 관계를 함께 건다.

## 이벤트 원장과 티켓 종류 (P2-a)

`_workspace/03_dev/work-item-events.jsonl`은 append-only다. 상태는 **접어서** 계산하고 어떤 줄도 뒤에서 고쳐
쓰지 않는다. 파손 줄·모르는 종류·스키마 위반은 **실패**다(버리면 상태가 이전 완료로 되돌아간다). 같은
`eventId`가 다른 내용이면 실패, 같은 내용의 재기록은 재실행의 정상 결과다. **순서의 정본은 파일 순서이고
`at`은 정보다** — 겹친 append는 시각이 역전될 수 있어 시각 단조를 강제하지 않는다. `plan-reviewed`에는 `planDigest`와 `payload.workIds`가 필수이며, 같은 판본을 다시
검토하면 이벤트를 쓰지 않는다(재실행이 원장을 상한까지 키우지 않게).
종류는 `plan-reviewed` · `publish-attempted`·`publish-confirmed`·`publish-unknown` · `relation-linked` ·
`work-linked`·`work-completed` · `aggregate-attempted`·`aggregate-confirmed`·`aggregate-unknown`·`aggregate-refreshed`다 — 생산자와 소비자가 함께 있는 것만 둔다. 검토 계보(한 번이라도 검토된 작업 ID)는
이 원장에서 읽으므로 로컬 포인터를 지워도 작업 삭제 대조가 살아 있다.

WORK 티켓 본문에는 마커 하나를 둔다: `<!-- web-harness:work plan=<planId> work=<WORK-…> feat=… tc=… rev=<계획 digest> -->`.
**모든 판독 입구는 종류를 먼저 판정한다**(`classifyTicketKind`) — 픽업은 WORK만 받고, 인테이크는 WORK·집계
티켓을 공급 원문으로 되들이지 않는다. 마커가 둘이거나 필드가 깨졌거나 두 모델의 마커가 함께 있으면 명시적
오류다 — 어느 쪽이 정본인지 추측하지 않는다. 옛 FEAT 개발 티켓(`web-harness:refs`)을 픽업하면 분해된 FEAT면
어느 WORK로 가야 하는지 돌려준다. `aggregate`의 생산자는 `claim --publish --aggregate`다(아래 「부모 집계」) — 픽업·인테이크는 거부한다.

## provider 능력 (P2-b)

WORK 축은 FEAT 조회를 재사용하지 않고 **라벨도 쓰지 않는다**(라벨은 사람이 거르는 축만). 결과를 모르는 발행은
원장의 시도 시각 이후 이슈를 끝까지 읽어 본문의 작업 ID·마커로 찾는다.

| 능력 | Jira | GitHub |
|---|---|---|
| `findByWorkId` | `created >= -Nm`을 끝까지 읽고 설명(Cloud는 ADF를 평문으로 풀어)의 작업 ID로 대조 — 보고자로 좁히지 않는다(다른 계정도 재개한다). 시각이 없거나 `total`보다 적게 받으면 `complete:false` | 시각이 있으면 REST 목록(`issues?since=`, 색인 지연 없음)을 끝까지 읽고 마커의 `work=`로 대조 — 완결. 시각이 없으면 본문 검색이라 `complete:false` |
| `listWorkIssues` | `key in (...)` + `startAt` 커서 | 목록(`--limit` 상한). 키를 줬는데 목록이 잘렸으면 못 본 키를 `issue view`로 하나씩 조회한다 — 「없다」는 gh가 그렇게 답한 키만이다 |
| `linkRelated` | 설정 `workLink.mode: issue-link` + `linkType`일 때만. 실패는 분류해 올린다 | `link-only` — 확인된 유형 관계가 없다(계층이라 부르지 않는다) |

**발행 전에 능력을 확인한다**(`workProviderReadiness`) — 관계 설정이 없으면 무엇을 설정해야 하는지
돌려주고 발행을 막는다 — 관계 없이 발행하면 연결 없는 티켓만 남는다. 하위 작업(subtask)은 발행 시점의
부모 필드라 연결 시점에 붙일 수 없어 지원하지 않는다(미구현으로 표기).

## 발행 (P2-c)

발행은 **확인한 판본만** 나간다. 검토 이벤트의 `planDigest`와 지금 계획이 다르면 막는다 — `--confirm`은 검토한 판본의 승인일 뿐이다.

외부 쓰기의 규율:

1. 쓰기 **전에** 시도를 남긴다 — `publish-attempted`에 시도 id(`operationId`)와 **요청 지문**(`payloadDigest`).
   같은 시도 id로 다른 본문을 보냈는지 나중에 가릴 수 있어야 한다.
2. 성공은 `publish-confirmed`(티켓 키), 응답 유실·키 없음·예외는 `publish-unknown`이다. **실패와 유실을
   구분하지 못하므로 부재로 읽지 않는다.**
3. 다음 실행은 `unknown`을 **조회로 확인**한다. 1건이면 그 키로 확정, 2건 이상이면 `DUPLICATE_REMOTE`로
   보류(사람이 정리한다), 조회가 **불완전하면** `UNKNOWN_REMOTE_RESULT`로 보류 — 색인 지연에서 재발행하면
   중복이 생긴다. 조회가 완전하고 0건일 때만 다시 낸다.
4. 선행이 이번 발행에도 없고 등록되지도 않았으면 막는다 — 미등록 선행을 완료로 치지 않는다.
   이미 발행된 작업은 `reuse`이고 다시 내지 않는다 — 공유 WORK가 배치마다 복제되지 않게.
   다만 **다른 판본으로 나가 있으면 동기화한다**(아래 「이미 발행한 티켓의 동기화」).
5. 일부만 발행된 배치는 `PUBLISHED_WITH_PENDING`이다. 성공분은 그대로 두고 나머지만 재개한다.

트래커별 한계(실 왕복은 NOT_RUN이다 — 계약과 순수 빌더까지만 회귀로 잰다):

- **필드 빌더는 WORK 전용이다.** 두 트래커 모두 `buildWorkFields`를 갖고, 없는 provider로는 발행이 열리지 않는다.
- **GitHub**: 관계는 `link-only`뿐이고 그 사실을 `workLink.mode`로 **선언해야** 발행이 열린다.
  조회는 색인 지연으로 늘 불완전하므로 한 번 `unknown`이 되면 **보류가 풀리지 않는다** —
  원장의 티켓 키를 보고 사람이 잇는다(`--resolve`). 없는 라벨은 발행·동기화가 먼저 만든다(triage 이상 권한).
- **Jira**: `workLink.mode: issue-link` + 프로젝트에 실재하는 `linkType`이 필요하다.

### 티켓의 모양 (2026-09-15 사용자 결정)

WORK 티켓은 **공유 작업도 하나**다(FEAT마다 복제하지 않는다). 두 독자를 가른다:

- **라벨은 사람이 거르는 축뿐이다** — 계획의 `roles`(누가 집는가: `fe`·`be` 등)와 설정의 팀 라벨. 조회 키(`work-`·`plan-`)와
  FEAT 라벨은 달지 않는다. 소비 FEAT는 본문 「참고」와 마커에 적는다.
- **본문(description)은 개발자용이다** — 설명 · 완료 조건 · 테스트 항목 · 수정 범위 · 하지 않는 것 · 선행 작업(티켓 키) · 참고.
  GitHub은 마크다운, Jira Data Center는 위키 서식(대괄호 등은 이스케이프)으로 쓴다(`work-ticket-doc.mjs`).
- **기계 마커는 보이지 않는 곳에 둔다** — GitHub은 본문 끝 HTML 주석, Jira는 이슈 속성 `web-harness.work`(위키 서식이 주석을
  숨기지 못한다). Jira 조회는 속성을 본문 끝에 붙여 돌려주므로 판독 입구는 그대로 본문 마커를 본다.
- **AI가 읽는 맥락은 첨부로 둔다** — 계약 참조·디자인 조건·검증 대상 경로·근거·판본을 담은 `web-harness-work-….md`.
  Jira는 첨부 파일, GitHub은 파일 첨부 API가 없어 접힌 코멘트 하나다. 원장 `context-attached`가 첨부 id를 기억하고
  동기화는 그것을 교체한다. 첨부 실패는 발행을 되돌리지 않고 보류로 올린다(다음 발행이 다시 붙인다).

**사람이 본문을 고칠 수 있다.** 픽업이 완료 조건·테스트 항목 섹션을 되읽어 계획이 만든 항목과 대조한다(정규화한 문장 일치):
사람이 **더한** 항목은 change-scope `ticketAcceptance.added`로 개발 범위에 싣고(자동 검증은 하지 않는다 — `link`가
`not-automated`로 적는다), 계획 항목이 **빠지거나 바뀌면**, 섹션을 **지우거나 제목을 바꾸면**, 옛 계획의 흔적(다른 작업이 책임지는
TC 줄·건수가 다른 통과 줄)이 남아 있으면 `ticket-diverges-from-plan`으로 착수하지 않는다(계획에 반영하거나 본문을 맞춘다).
더한 항목은 외부 데이터이며(본문 인젝션 스캔을 통과한 것만) 20건·항목당 300자를 넘으면 `ticket-additions-too-large`로 계획에
올린다. 보고는 원문 그대로다(대조만 정규화한다). Jira 위키의 `#`은 번호 목록으로 읽는다.

### 이미 발행한 티켓의 동기화 (T47)

계획을 고쳐 다시 검토하면 이미 발행한 티켓은
옛 판본이다 — 픽업·보드가 `stale-plan`으로 막는다. 같은 `claim --publish`가 그 작업을 `sync`로 보여주고,
`--confirm`이면 **소비 메타데이터만** 새 판본에 맞춘다: 본문(소비 FEAT·책임 TC·선행 키)·마커·라벨·AI 맥락을 맞춘 뒤
원장에 `publish-synced`를 남긴다. **소비 FEAT·책임 TC·부모가 바뀐 티켓에만** 코멘트로 알린다 — 판본 표지만 바뀐 개정마다 코멘트하면 소음이 된다.

- **작업 내용이 바뀐 티켓은 제자리로 고치지 않는다**(제목·목표·경계·계약·검증 등 — `WORK_CONTENT_KEYS`). 작업 중인
  개발자 밑에서 계약이 조용히 바뀌기 때문이다 — `supersede-required`로 보류하고,
  옛 작업을 `superseded`로 두고 새 WORK로 대체한다. 발행 때의 내용 지문이 원장에 없어도 고치지 않는다.
- 원장이 기록한 트래커가 지금 provider가 아니면 쓰지 않는다(`provider-mismatch`) — 같은 키가 다른 트래커의 무관한 이슈다.
- 새로 만들지 않는다 — 원장이 확정한 그 키에만 쓴다. 판본과 요청 지문이 같으면 쓰지 않는다(멱등).
- 떼는 라벨은 **원장이 기록한 우리 라벨** 중 새 요청에 없는 것뿐이다. 사람이 단 라벨은 건드리지 않는다.
- 본문·라벨이 **둘 다 된 뒤에만** 원장을 새 판본으로 옮긴다. 중간 실패는 보류이고 원장은 옛 판본이라 픽업이 계속 막는다.
- **사람이 고친 본문은 덮어쓰지 않는다** — 우리가 마지막으로 쓴 본문의 지문(`docDigest`)과 지금 본문이 같을 때만 교체한다.
  고쳤으면 마커(판본 표지)만 옮기고, 더할 계획 항목과 지울 옛 항목을 코멘트로 넘긴다(맞추기 전에는 픽업이 막는다).
  **예외: 지문 기록이 없는 발행분(0.27.x)은 이관으로 교체한다** — 옛 본문은 섹션이 없어 대조할 수 없다(사람이 고친 0.27 본문도 덮인다).
- 이미 픽업한 작업이면 그 change-scope는 옛 판본이다 — `link`가 STALE로 막으므로 다시 픽업한다. 개정을 받지 않았으면 `pickup`·`link`가
  원격 기준(PR base·계획의 baseBranch·원격 HEAD)으로 `plan-behind-remote`를 낸다. 같은 작업을 다시 집으면 처음 찍은 대상 지문을 잇는다.
- 계획에서 대체·취소된 작업의 티켓에는 발행이 한 번 알린다(`work-retired`, 이어서 할 티켓 키). 끝난 작업은 알리지 않는다.
- 코멘트(동기화 알림·픽업 되돌림)의 언어는 프로젝트 선언(`project-profile.json`의 `outputLanguage`)을 따르고, 없으면 티켓·작업 글의 언어를 따른다.
- 머지로 끝난 작업은 **라벨만** 맞춘다 — 닫힌 티켓의 본문을 그 PR이 구현하지 않은 판본으로 바꾸지 않는다.

## 픽업 (P2-d)

`pickup <티켓키> --developer <나>`의 게이트:

| 게이트 | 규칙 |
|---|---|
| 인젝션 스캔 | 제목·본문 fail-closed, 의심 코멘트는 제외한다 |
| 종류 선판정 | WORK가 아니면 거부. **분해된 FEAT면 어느 WORK로 가야 하는지** 함께 준다 |
| 스펙 대조(TC를 지어내지 않는다) | 마커의 작업·FEAT·TC가 계획에 실재하는가 |
| STALE | 발행 시점 계획 digest ↔ 지금 계획 digest(`evaluatePickupReadiness`) |
| 원장 등록 대조 | 원장의 `publish-confirmed`가 이 티켓 키를 아는가 — 모르면 집지 않는다 |
| 준비도 되돌림 | 미해결 결정·**머지되지 않은 선행**이면 착수하지 않는다 |
| 수용 기준 존재 | WORK는 TC가 없을 수 있다(기반 작업) — 그때 `checks`가 수용 기준이며 **둘 다 없으면 거부**한다 |
| 트래커 쓰기 제한 | 배정 · 경합 시 자기 배정 회수 · `in-progress` 전이 · 되돌림 알림뿐. 머지·완료 전이는 하지 않는다 |
| 동시 배정 감지 | 배정 직전 재조회(양보), 배정 뒤 남도 보이면 자기 배정 회수(GitHub처럼 덧붙이는 트래커). 나 말고도 배정돼 있으면 내 것으로 보지 않는다 |
| 컨플릭·원격 신선도 | 미해결 컨플릭이면 착수하지 않고, 판정 전에 origin을 갱신하며 못 하면 `local-snapshot`으로 적는다 |

픽업이 보지 않는 것: 브랜치 대조(발행은 브랜치를 기록하지 않는다) · 경로 충돌(계획 검증 P1이 막는다).
완료·PR 연결은 아래 「완료」 절이다.

change-scope 키 집합은 `ticket-kinds.md` 표가 정본이다.
쓰기 경계는 검토받은 계획의 `writePaths`라 `needsConfirmation: false`이고, STALE 앵커는 계획
digest이며, 공유 작업이면 `featureId`가 `null`이고 `featureIds`가 전부를 싣는다.

**선행이 끝나야 착수한다**(무엇이 끝남인지는 「완료」 절). PR 연결은 완료의 주장이라 세지 않는다.
되돌림은 미완료 선행을 「등록 안 됨」과 「머지 안 됨」으로 나눠 적는다.

## 보드 (P2-d)

`board [--developer 나]`는 「지금 무엇을 집을 수 있나」를 보여준다. **착수 가능 판정은
픽업과 같은 다섯 축**이다: 등록 · 발행 판본(STALE) · 미해결 결정 · 선행 등록 · 소유(누구인지
말하지 않으면 판정하지 않는다 — 픽업도 같다). 표시와 게이트가 갈라지면 표시는 장식이 된다. **보드가 재지 않는 것**은 티켓 본문을 받지 않아 잴 수 없는 것들이다 —
인젝션 스캔 · 종류/마커 판정 · 다른 계획의 티켓 · 티켓 키 대조 · 워크트리 컨플릭 · 수용 기준
부재(계획 검증이 보장). 그래서 보드가 「집을 수 있다」고 해도 픽업이 이 축에서 되돌릴 수 있다.

재지 못한 것을 통과로 접지 않는다: 트래커를 못 보거나 목록이 잘리면 배정은 `null`이고
`assignment-unknown`이며 **미배정이 아니다**(`--no-tracker`로 조회를 아예 건너뛸 수 있고, 그때도
같은 표기가 붙는다). 원장은 발행이라는데 목록에 없으면 `ticket-not-found`로 따로 말한다.
발행 판본을 원장이 모르면 `plan-digest-unknown`이며 「같다」고 접지 않는다.
PR은 연결됐는데 머지가 관측되지 않은 작업은 따로 센다 — `link --sync`로 머지를 확인해야 후속이 열린다.

**트래커 창의 한계**: Jira는 커서를 따라 돌고, GitHub은 저장소 이슈 목록(생성 역순 상한 100건)을 먼저 읽고, 목록이 잘렸으면 **원장의 키를 하나씩 직접 조회**한다(발행한 WORK 수만큼 `gh` 호출). 권한·네트워크
실패는 부재가 아니라 「조회 실패」로 적는다.

## 완료 (P3-a)

`link <티켓키> <PR>`은 **완료를 주장**하고, `link --sync`는 **머지를 관측**한다.
둘은 다른 사실이다 — 원장에 `work-linked`와 `work-completed`로 따로 남는다. **완료는 머지 관측 또는 트래커의 끝남이다**
(트래커를 정본으로 옮기는 중이라 둘 중 하나라도 완료면 완료). 트래커의 끝남은 Jira는 해결 사유가 설정 `completedResolutions`
(기본 Fixed·Done)에 있을 때, GitHub은 닫힌 이유가 completed일 때다. 나머지 해결 사유·not planned는 취소로 보고 집지도 선행으로
세지도 않으며, 해결 사유 없이 끝난 Jira 티켓은 어느 쪽으로도 세지 않고 보드가 알린다. `link --reopen`으로 거둔 작업은 거둔 뒤에
트래커에서 다시 끝났을 때만 트래커 완료를 센다.

`link`의 게이트:

| 게이트 | 규칙 |
|---|---|
| STALE 대조(미수행은 loud) | change-scope가 이 작업의 것이면 계획 digest로 대조. 없거나 다른 작업의 것이면 `--accept-unverified-scope` 없이 막고, 넘기면 원장에 남긴다 |
| 멱등 | 이미 연결된 작업의 재실행은 지나간 판정을 다시 심판하지 않는다 |
| 완료 조건(TC 인용) | 소유 TC가 소스·테스트에 인용되는가 **그리고** `checks`의 대상 경로가 실재하고 픽업 때 찍은 지문에서 바뀌었는가(이미 있던 경로를 적고 아무것도 안 한 기반 작업은 `check-targets-unchanged`). 기준이 하나도 없으면 판정 불가(`no-acceptance`). `--accept-incomplete`로 넘기면 원장에 남긴다 |
| close 대상 정합 | 원장이 이 작업에 등록한 티켓 키로만 닫는 줄을 만든다. 트래커는 **발행 원장**이 정한다(지금 설정이 아니다). GitHub만 머지로 닫히고, 트래커를 모르면 닫는다고 적지 않는다 |

**완료 판정은 프록시다** — TC는 ID가 인용됐는가, check는 대상 경로가 있는가까지이며 그 테스트가
기준을 실제로 검증하는지는 보지 않는다(의미 판정은 코드 리뷰의 몫).

**기대 base**: `link`는 이 작업이 어느 브랜치에 머지돼야 끝나는지 원장에 남긴다 — PR에서 읽거나(`gh pr view`)
운영자가 `--base`로 준다(`refs/heads/`·`origin/` 접두는 떼어 기록한다). 모르면 링크하지 않는다(기대 base 없는 링크는
아무 브랜치 머지로 완료가 된다). 기대 base 없이 남은 **옛 링크는 같은 PR에 한해** `link <키> <PR> --base <브랜치>`로
다시 기록한다 — 판정은 전부 다시 지난다. PR URL은 정규형(`…/pull/<번호>`)만 받는다.

`--sync`는 연결됐고 아직 완료가 아닌 작업의 PR 상태를 PR URL의 호스트에서 읽는다(쓰기 없음). **기대 base에
머지된 것만** 완료로 쓰고, 다른 브랜치 머지·기대 base 없는 옛 링크는 `baseMismatch`로 올린다.
열린 PR은 그대로, 조회 실패는 `ok:false`로 올린다 — 완료로도
침묵으로도 접지 않는다.

## 부모 집계 (P3-b)

`board --by-feature`가 FEAT마다 필수 WORK의 상태를 모아 보여준다(로컬 계획·원장만 — 트래커를 부르지 않는다).

| 상태 | 뜻 |
|---|---|
| `not-started` · `in-progress` | 필수 작업이 아직 머지되지 않았다(PR 연결은 머지가 아니다) |
| `works-merged` | 필수 작업이 **전부 머지됐다** — 인수 완료가 아니다 |
| `works-merged-with-exceptions` | 머지됐지만 어떤 작업이 완료 조건·STALE 대조를 명시 인수로 넘겼다 |
| `works-merged-with-deferrals` | 머지됐지만 계획이 이 FEAT의 TC 일부를 유예했다 |
| `awaiting-follow-up` | 후속 상세화 — **분모에 남고** 상세화·분해 전에는 끝나지 않는다 |
| `deferred-product` | 제품 유예 — 분모에서 뺀다(뺐다고 적는다) |
| `merged-tc-unchecked` | 머지됐지만 feature-plan에서 이 FEAT의 TC를 읽지 못해 **책임 대조를 하지 않았다** |
| `plan-inconsistent` | 책임 없는 TC·취소된 필수 작업·빈 필수 작업 목록 — 분모를 줄인 것이 아니라 계획 불일치다 |

**`closeEligible`은 늘 거짓이다.** 통합 revision의 TC 증거가 아직 연결되지 않았고 부모 자동 닫기는 기본 비활성이다
— 무엇이 막는지 `closeBlockers`로 낸다. 사람이 판단해 전이한다.

`claim --publish --aggregate [--features …]`는 FEAT마다 **집계 티켓**(`web-harness:aggregate` 마커·`work-aggregate`
라벨)을 낸다. 개발 대상이 아니라 트래커에 보이는 요약이다. 발행 규율은 WORK와 같다: 확인한 판본만, 쓰기 전에
시도를 남기고, 결과를 모르면 `unknown`으로 두어 **사람이 확인한다**(집계를 찾는 조회 능력이 없어 자동으로 풀지
않는다 — 재발행하면 집계가 둘이 된다). 이미 낸 집계는 같은 요청에 `--confirm`이면 **본문만 갱신**하고,
본문이 같으면 쓰지 않는다. WORK를 낼 때 `--parent <집계 키>`로 관계를 걸 수 있다.

- **확인한 판본**은 계획 digest **와 분석 digest** 둘 다다 — 분석이 곧 분모(유예 종류)다. feature-plan을 읽지
  못하면 TC 대조를 못 하므로 발행을 막는다.
- **집계가 나가지 않는 FEAT**: 필수 작업이 없는 것 — 후속 상세화·blocked·unbound·제품 유예. 트래커에는 보이지
  않고 `board --by-feature`에만 보인다.
- **`unknown`을 푸는 법**: 사람이 트래커에서 그 티켓을 찾아 `claim --publish --resolve <FEAT-ID> --ticket <키>`로
  확정한다(아래 「결과를 모르는 발행 확정」).

## 결과를 모르는 발행 확정

`claim --publish --resolve <WORK-ID|FEAT-ID> --ticket <키> [--confirm]`. 발행 응답이 유실돼 `unknown`·`attempted`로 남았고
자동 재개로 풀리지 않을 때(GitHub 색인 지연·집계 조회 능력 없음), **사람이 찾은 티켓을 원장에 잇는다**.

- 사람의 말만 믿지 않는다 — 준 키로 티켓을 조회해 **본문에 그 작업(또는 FEAT 집계)의 마커**가 있을 때만 확정한다.
  WORK 마커는 발행 판본까지 같아야 한다(집계 마커에는 판본이 없다). 트래커는 설정된 것만 쓴다(`--ticket-provider` 거부).
- 결과를 모르는 발행만 받는다 — 이미 확정됐거나 시도한 적 없는 것은 막는다(새 발행의 뒷문이 되지 않게).
- 원래 시도의 `operationId`로 잇고, 확인 없이는 미리보기다.

## 마커가 지워진 티켓 (T11)

사람이 본문을 고쳐 WORK 마커가 사라져도 **원장은 그 키를 안다**. 픽업은 `work-marker-missing`으로 막고(STALE·작업
대조의 근거가 본문에서 사라졌다 — 본문을 복구한다), 인테이크는 원장이 발행한 키를 공급 원문으로 받지 않는다(원장이 깨졌으면 멈춘다).
**전제: 발행 원장(`work-item-events.jsonl`)이 커밋·공유돼 있어야 한다** — 원장이 없는 체크아웃에서는 `unknown`으로 떨어진다.

## 여러 사람이 쓸 때

- 원장은 브랜치마다 끝에 줄을 덧붙이므로 `.gitattributes`에 `merge=union`이 있어야 PR끼리 충돌하지 않는다. `change-scope.md`와
  `ticket-assessments/`는 한 개발자의 로컬 작업 상태라 커밋하지 않는다. 개발 준비 검사 `team-sharing`이 둘을 확인하고 `--fix`로 넣는다.
- 연결·완료된 작업의 범위는 다음 픽업을 막지 않는다(STALE 대조는 link 때 끝났다).
- 완료된 작업은 다시 집지 않는다. 머지를 되돌렸으면 `link --reopen <키> --reason`으로 완료·연결을 거둔다(`work-reopened`) — 같은 작업을 다시 집고,
  이 작업을 선행으로 둔 작업은 다시 기다린다. 이미 끝난 후속 작업은 목록으로 알릴 뿐 거두지 않는다. 닫힌 티켓은 사람이 다시 연다.
- 머지 확인은 누구나 로컬에서 할 수 있다. 같은 완료가 여러 사람에게서 다른 eventId로 기록돼도 접기 결과는 같다.
- 픽업 범위에는 작업의 `writePaths`와 소스와 따로 둔 테스트 레이어(`spec.testLayers`)가 들어간다. 테스트를 소스 옆에 두는 레이어는 넣지 않는다(범위가 소스 전체로 넓어진다). 테스트 레이어 안에서는 다른 작업의 테스트도 쓸 수 있고, 짧은 이름(`tests`)은 어느 깊이의 같은 이름 디렉터리에도 맞는다.
- 같은 파일을 쓰는 작업은 계획에서 순서를 줘야 한다(T08). 선언하지 않은 파일(package.json 등)을 고쳐 커밋하면 `link`가 `scopeDrift`로 알린다 — 막지 않으며, 병렬 작업과의 충돌은 머지에서 난다. 점검하지 못하면 그 이유를 적는다.
- 사람 티켓의 겹침은 다른 클론에서 방금 등록돼 내 원장에 없는 진행 중 티켓까지 본다 — 트래커 본문의 「수정 범위」로 잰다.
- 회귀: `test-team-e2e.mjs`(Jira)·`test-team-github-e2e.mjs`(GitHub·자동 닫기 v3)·`test-team-monorepo-e2e.mjs`(앱 접두 범위·실제 소유권 훅)·`test-team-shared-file-e2e.mjs`(같은 파일)·`test-team-revision-e2e.mjs`(5인·개정 두 번·되돌림)·`test-team-human-tickets-e2e.mjs`(계획 없이 사람 티켓만), 모두 실제 git.

## 자동 닫기 (P3-c)

`validate-development-readiness`의 `ticket-assets`가 WORK 원장이 있는 프로젝트에 `ticket-close.yml`·
`close-merged-tickets.mjs`(v3)를 설치한다(`--fix`, 덮어쓰지 않는다). 머지된 PR마다:

- **근거는 WORK 원장뿐** — `work-linked`가 이 PR을 결속했고, 기대 base가 머지 base와 같고, 그 작업이 **검토 계보에
  있을 때만**. PR 본문의 `#N`은 보지 않는다. 원장 줄도 PR이 가져오지만 PR diff로 리뷰를 거친다 — 신뢰 경계는 머지 승인이다.
- **전제**: `link`가 남긴 `work-linked` 줄이 **그 PR에 커밋돼 base에 도달**해야 한다. 커밋하지 않으면 워크플로우는
  「결속된 WORK 없음」으로 아무것도 닫지 않는다.
- 이슈 번호가 아닌 키는 provider가 github여도 닫지 않는다(gh는 URL도 받는다). 한 건 실패는 모아서 exit 1로 알린다.
  fork PR은 토큰이 읽기 전용이라 닫지 못한다.
- **GitHub WORK 티켓만 닫는다**(근거 코멘트, 이미 닫혔으면 건너뜀). 발행 트래커가 GitHub이 아니거나 기록이
  없으면 PENDING으로 남긴다 — 추측해 닫지 않는다.
- **부모 FEAT·집계 티켓은 닫지 않는다**(부모 자동 닫기는 기본 비활성).
- 원장 파손 줄이 있으면 **멈춘다**.
- 판본 표지(`web-harness:ticket-close v3` — v3는 사람 티켓 작업도 닫는다)가 없는 옛 사본은 설치됨으로 세지 않고 FAIL로 알린다 — 손봤을 수
  있어 자동으로 덮지 않는다. **v2 사본이 설치된 저장소는 사람 티켓 작업을 닫지 못한다** — 두 파일을 지우고 `--fix`로 다시 설치한다.

## 원칙

- **FEAT·TC는 그대로 둔다.** 기술 작업은 `WORK-<UUID>`로 따로 둔다. 기반 작업에 사용자 TC를 만들지
  않는다 — 대신 실제 기술 검증(`checks`)을 적는다.
- **대상 FEAT 전부를 분류한다**(`planned` · `deferred` · `blocked`). 유예는 `follow-up-detail`(후속 상세화 —
  완료 분모를 줄이지 않는다)과 `product-deferral`(제품 범위 유예)을 가른다. 목록이 불완전하면
  `inventoryComplete: false`와 사유 — 초안은 되지만 검토 확정은 막힌다.
- **읽은 것과 받은 것을 가른다.** 읽지 못한 자료는 `accessState: unreadable`이고 `digest`를 적지 않는다.
  `decisionStatus`가 `approved`인 원문만 `confirmed` 결정의 근거가 된다 — 받았다고 승인된 것이 아니다.
- **조사 범위 안의 결과만 말한다.** 재사용(`reuse`)은 코드 관찰 근거가 있어야 하고, 조사가 절단됐으면
  `create`로 확정하지 않는다(`unknown`). 이름에 `shared`가 있다고 공통 기반이 아니다.
- **실제 gap만 WORK가 된다.** 작은 확장은 소비 WORK 안에 둔다. 기본은 **FEAT당 세로 WORK 하나**이고,
  공유 계약·별도 담당·별도 기술 검증의 경계가 있을 때만 쪼갠다(`feature-planner`의 세로 분할 원칙).
  공통 WORK는 하나이며 소비하는 모든 FEAT의 `requiredWorkIds`에 같은 ID로 들어간다.
- **의존은 제약, 우선순위는 선택이다.** `dependsOn`은 실제 인터페이스·쓰기 충돌에서 나오고 미선언은
  오류다(없으면 `[]`). 우선순위는 착수 가능한 작업 안에서만 순서를 정하며 상위 기능의 우선순위는 그것을
  여는 선행 작업에 승계된다. 기간·가중치를 지어내지 않는다.
- **디자인은 기존 연결을 승계한다.** `designContext`는 `design-binding.json`의 `(pageGroup, condition)`과
  `referenceIds`를 고른다. 연결이 없는 조건은 미결로 두고 이름 유사도로 선언을 짓지 않는다. 비UI·디자인
  부재(generated/absent)면 UI를 직접 바꾸는 작업은 `direct-ui` + 화면 명세(`contextRefs`), 동작 참고는
  `behavior-context`, 화면이 없으면 `not-applicable`과 근거(`rationaleRef`)로 적는다.
  Figma 원격 reference에 해시를 적지 않는다.
- **작업을 지우지 않는다.** 한 번 검토한 판본에 있던 작업은 `cancelled`·`superseded`로 남기고 TC 책임을
  재배치한다.

## 키

<!-- web-harness:work-keys -->
| 객체 | 키 |
|---|---|
| analysis.document | `schemaVersion` `analysisId` `scope` `sourceRefs` `codeEvidence` `scanCoverage` `decisions` `findings` `unresolved` `priorityInputs` `resolutionLinks` |
| analysis.scope | `featureIds` `targetRoots` `sourceRevision` `dirty` `inventoryRef` `inventoryComplete` `incompleteReasons` `featureDisposition` |
| analysis.disposition | `featureId` `status` `deferral` `reasonRef` |
| analysis.sourceRef | `id` `snapshotRef` `digest` `locator` `intent` `decisionStatus` `scopeRefs` `accessState` `note` |
| analysis.codeEvidence | `id` `path` `symbol` `digest` `observation` `method` `testState` |
| analysis.scanCoverage | `roots` `methods` `exclusions` `incompleteReasons` |
| analysis.decision | `id` `subjectRef` `status` `chosenValue` `authorityRef` `evidenceRefs` `scopeRefs` |
| analysis.finding | `id` `capability` `evidenceRefs` `disposition` `gap` `consumerRefs` `decisionRefs` |
| analysis.unresolved | `id` `topic` `ownerRole` `scopeRefs` `blockingReason` |
| analysis.priorityInput | `id` `scopeRefs` `preference` `rank` `sourceRef` |
| analysis.resolutionLink | `analysisItemId` `targetRefs` `resolution` `reason` |
| plan.document | `schemaVersion` `planId` `sourceRevision` `baseBranch` `analysisRef` `designBindingRef` `featureBindings` `workItems` |
| plan.ref | `path` `digest` |
| plan.binding | `featureId` `sourceDigest` `requiredWorkIds` `acceptanceOwners` |
| plan.owner | `testCaseId` `workId` |
| plan.work | `workId` `title` `kind` `roles` `objective` `nonGoals` `dependsOn` `readPaths` `writePaths` `contractRefs` `provides` `consumes` `designContext` `basisRefs` `priorityRefs` `blockerRefs` `contributesTo` `checks` `lifecycle` `supersededBy` |
| plan.contract | `path` `anchor` |
| plan.design | `applicability` `rationaleRef` `selections` `contextRefs` `unresolvedRefs` |
| plan.selection | `featureIds` `testCaseIds` `pageGroup` `condition` `referenceIds` `purpose` |
| plan.check | `checkId` `kind` `targetRefs` `expectedOutcome` |
<!-- /web-harness:work-keys -->

값의 어휘: `status` planned·deferred·blocked · `deferral` follow-up-detail·product-deferral · `intent`
current·target·reference · `decisionStatus` approved·draft·undecided · `accessState` read·partial·unreadable ·
결정 `status` confirmed·draft·open · `disposition` reuse·extend·adapt·create·exclude·unknown · `testState`
exists-not-run·ran-passed·ran-failed·absent·unknown · `resolution` consumed·excluded · `kind`
foundation·implementation·integration · `lifecycle` active·cancelled·superseded · `applicability`
direct-ui·behavior-context·not-applicable · `purpose` implementation·context·verification.

## 연결 규칙(검증기가 대조한다)

- 계획의 `analysisRef.digest` = 현재 분석의 digest(`claim`이 알려 준다). 분석이 바뀌면 계획을 다시 쓴다.
- `featureBindings`: planned FEAT 전부. `sourceDigest`는 그 FEAT 명세의 digest — 명세가 바뀌면 낡은 분해다.
  `acceptanceOwners`는 현재 TC마다(기획이 명시 유예한 TC 제외) **정확히 하나**, 그 FEAT의 필수 작업이어야 한다.
- 작업마다 `basisRefs`(분석의 판정·결정) ≥ 1, `checks` ≥ 1, `writePaths` ≥ 1. 어떤 FEAT의 필수 작업도 아니면 고아다.
- 같은 경로를 쓰는 두 작업은 의존으로 순서가 있어야 한다. 제공 계약(`provides`)을 소비(`consumes`)하면
  그 제공 작업에 (전이적으로) 의존해야 한다.
- 분석의 모든 원문·판정은 `resolutionLinks`로 반영처(`WORK-…`) 또는 제외 사유를 갖는다.

## 일반화 근거

- **서버 데이터 중심 화면**(회원 관리 CRUD fixture) — 조회 API·캐시는 기존 계층을 재사용하고, 타입·API 계약과
  페이지 틀이 공통 기반, 목록 연결이 최소 기능, 편집 draft 충돌 정책은 미결로 수정 WORK만 막는다.
- **로컬 문서 상태 중심 편집기**(편집기 fixture) — 공유 문서·명령·실행 취소가 공통 기반이고 화면 없는 기반은
  `not-applicable`, 디자인 연결이 없는 프로젝트는 `behavior-context`로 명세를 잇는다.
- 화면이 없는 라이브러리·CLI 작업도 같은 모델이다 — `designContext`는 `not-applicable`과 근거, `checks`는
  공개 API 검증이다(fixture 없음).

**진실 검증 수준: 명명 수준.** 검증기와 CLI는 두 fixture로 확인했고 실제 팀 프로젝트에 적용한 기록은 없다.
분해의 의미 품질(재사용 판정이 맞는가, 경계가 적절한가)은 스키마로 보장되지 않는다.
