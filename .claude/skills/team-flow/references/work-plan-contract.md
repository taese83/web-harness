# WORK 분해 계약 — 선행 분석(P0)과 작업 계획(P1)

`claim`(WORK 모드)이 개발 준비를 조정할 때 `system-architect`가 쓰는 두 파일의 계약이다. CLI
(`ticket/cli.mjs claim --work`)는 의미를 이해하지 않고 **참조·상태·그래프**를 검증한 뒤 검토표를 만든다.
판정의 의미 품질(재사용이 정말 맞는가, 경계가 적절한가)은 개발 검토의 몫이다.

| 파일 | 소유 | 정본인 것 | 복제하지 않는 것 |
|---|---|---|---|
| `_workspace/03_dev/work-analysis.json` | system-architect | 출처·코드 관찰·판정·미결의 **연결** | 원문 설계·API 스키마·상태 계약 본문(00_source·02_design) |
| `_workspace/03_dev/work-plan.json` | system-architect | 기능 바인딩·작업 정의 | 요구사항·TC(정본은 feature-plan) |
| `work-plan-review.md` · `*-revisions/` · `work-plan-reviewed.json` | CLI | 검토표(생성물)·검토한 판본 스냅샷·포인터 | — |

## claim 흐름 (스킬이 조정하고 CLI가 검증한다)

1. `cli.mjs claim --work [--features FEAT-001,…]`(범위 생략 = 계획 전체). 외부 쓰기 0 — 결과의 `phase`가 다음 할 일이다.
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
5. `claim --work --publish`(P2-c) → 미리보기다. **외부 쓰기 0**으로 무엇을 어디에 낼지 돌려준다.
   같은 요청에 `--confirm`을 붙였을 때만 발행한다 — 미리보기가 승인의 대상이고, `--confirm`은 그 목록의 승인이다.
   `--work-ids a,b`로 일부만, `--parent <KEY>`로 부모 티켓과의 관계를 함께 건다.

## 이벤트 원장과 티켓 종류 (P2-a)

`_workspace/03_dev/work-item-events.jsonl`은 append-only다. 상태는 **접어서** 계산하고 어떤 줄도 뒤에서 고쳐
쓰지 않는다. 파손 줄·모르는 종류·스키마 위반은 **실패**다(버리면 상태가 이전 완료로 되돌아간다). 같은
`eventId`가 다른 내용이면 실패, 같은 내용의 재기록은 재실행의 정상 결과다. **순서의 정본은 파일 순서이고
`at`은 정보다** — 겹쳐 append하면 시각이 역전되는 것이 정상이고, 시각 단조를 강제하면 정상 실행이 원장을
읽을 수 없게 만든다. `plan-reviewed`에는 `planDigest`와 `payload.workIds`가 필수이며, 같은 판본을 다시
검토하면 이벤트를 쓰지 않는다(재실행이 원장을 상한까지 키우지 않게).
지금 있는 종류는 `plan-reviewed` 하나 — 소비자와 함께 늘린다. 검토 계보(한 번이라도 검토된 작업 ID)는
이 원장에서 읽으므로 로컬 포인터를 지워도 작업 삭제 대조가 살아 있다.

WORK 티켓 본문에는 마커 하나를 둔다: `<!-- web-harness:work plan=<planId> work=<WORK-…> feat=… tc=… rev=<계획 digest> -->`.
**모든 판독 입구는 종류를 먼저 판정한다**(`classifyTicketKind`) — `work`·`aggregate`는 legacy FEAT 폴백에서
제외되어 픽업·인수·인테이크가 거부한다. 마커가 둘이거나 필드가 깨졌거나 두 모델의 마커가 함께 있으면
명시적 오류다 — 어느 쪽이 정본인지 추측하지 않는다. `source`(기획 출처) 티켓은 여기서 거부하지 않고
기존 경로로 흘려보낸다 — 왕복 마커가 없어 픽업의 기존 게이트가 막는다(동작 유지). `aggregate`는 아직
**생산자가 없다**(부모 집계는 P3) — 판독 입구만 먼저 닫아 둔다.

## provider 능력 (P2-b)

WORK 축은 FEAT 조회를 재사용하지 않는다 — 계획·작업 **라벨**(`plan-<planId>`·`work-<uuid>`)로 찾는다.

| 능력 | Jira | GitHub |
|---|---|---|
| `findByWorkId` | 라벨 JQL. `total`보다 적게 받으면 `complete:false` | 본문 검색 — **색인 지연**이라 항상 `complete:false`(부재를 단정하지 않는다) |
| `listWorkIssues` | `key in (...)` + `startAt` 커서 | `--limit` 상한에 닿으면 `truncated:true` |
| `linkRelated` | 설정 `workLink.mode: issue-link` + `linkType`일 때만. 실패는 분류해 올린다 | `link-only` — 확인된 유형 관계가 없다(계층이라 부르지 않는다) |

**발행 전에 능력을 확인한다**(`workProviderReadiness`) — 관계 설정이 없으면 무엇을 설정해야 하는지
돌려주고 발행을 막는다. 공유 WORK를 FEAT마다 복제하지 않으려면 관계가 필요하고, 없는 채 발행하면
연결 없는 티켓만 남는다. 하위 작업(subtask)은 발행 시점의 부모 필드라 연결 시점에 붙일 수 없다 —
지원한다고 말하지 않는다(미구현으로 표기).

## 발행 (P2-c)

발행은 **확인한 판본만** 나간다. 검토 이벤트의 `planDigest`와 지금 계획이 다르면 막는다 — 미리 받은
`--confirm` 하나가 아직 쓰이지도 않은 분해안의 승인이 되지 않는다.

외부 쓰기의 규율(설계 §8):

1. 쓰기 **전에** 시도를 남긴다 — `publish-attempted`에 시도 id(`operationId`)와 **요청 지문**(`payloadDigest`).
   같은 시도 id로 다른 본문을 보냈는지 나중에 가릴 수 있어야 한다.
2. 성공은 `publish-confirmed`(티켓 키), 응답 유실·키 없음·예외는 `publish-unknown`이다. **실패와 유실을
   구분하지 못하므로 부재로 읽지 않는다.**
3. 다음 실행은 `unknown`을 **조회로 확인**한다. 1건이면 그 키로 확정, 2건 이상이면 `DUPLICATE_REMOTE`로
   보류(사람이 정리한다), 조회가 **불완전하면** `UNKNOWN_REMOTE_RESULT`로 보류 — 색인 지연에서 재발행하면
   중복이 생긴다. 조회가 완전하고 0건일 때만 다시 낸다.
4. 선행이 이번 발행에도 없고 등록되지도 않았으면 막는다 — 미등록 선행을 완료로 치지 않는다(§4.5).
   이미 발행된 작업은 `reuse`이고 다시 내지 않는다 — 공유 WORK가 배치마다 복제되지 않게.
5. 일부만 발행된 배치는 `PUBLISHED_WITH_PENDING`이다. 성공분은 그대로 두고 나머지만 재개한다.

트래커별 한계(실 왕복은 NOT_RUN이다 — 계약과 순수 빌더까지만 회귀로 잰다):

- **필드 빌더는 WORK 전용이다.** FEAT 빌더는 `sourceKey`를 FEAT로 보고 `feat-<키>` 라벨과
  `web-harness:refs` 마커를 덧붙인다 — WORK에 쓰면 조회 축이 사라지고 마커가 충돌한다.
  두 트래커 모두 `buildWorkFields`를 갖고, 없는 provider로는 발행이 열리지 않는다.
- **GitHub**: 관계는 `link-only`뿐이고 그 사실을 `workLink.mode`로 **선언해야** 발행이 열린다.
  조회는 색인 지연으로 늘 불완전하므로 한 번 `unknown`이 되면 **보류가 풀리지 않는다** —
  원장의 티켓 키를 보고 사람이 잇는다. 라벨은 저장소에 미리 있어야 한다(`gh`는 없는 라벨에 실패).
- **Jira**: `workLink.mode: issue-link` + 프로젝트에 실재하는 `linkType`이 필요하다.

WORK 티켓은 **공유 작업도 하나**다. 소비 FEAT는 라벨(`feat-<FEAT-ID>`)로 전부 달리고, FEAT마다 복제하지
않는다. 본문은 계약의 복제본이 아니라 **요약과 참조**이며, 마지막 줄의 마커가 되돌아오는 길이다.

## 픽업 (P2-d)

`pickup --work <티켓키> --developer <나>`. legacy FEAT 픽업의 게이트를 **버리지 않고 옮겼다**:

| legacy | WORK |
|---|---|
| 인젝션 스캔(제목·본문 fail-closed, 의심 코멘트 제외) | 같은 함수 그대로 |
| 종류 선판정 | WORK가 아니면 거부. **분해된 FEAT면 어느 WORK로 가야 하는지** 함께 준다 |
| 스펙 대조(TC를 지어내지 않는다) | 마커의 작업·FEAT·TC가 계획에 실재하는가 |
| STALE(픽업 뒤 기획 변경) | 발행 시점 계획 digest ↔ 지금 계획 digest(같은 `evaluatePickupReadiness`) |
| 청구 버전 대조 | 원장의 `publish-confirmed`가 이 티켓 키를 아는가 — 모르면 집지 않는다 |
| 준비도 되돌림 | 미해결 결정·**미등록 선행**이면 착수하지 않는다 |
| TC 없는 완료 거부 | WORK는 TC가 없을 수 있다(기반 작업) — 그때 `checks`가 수용 기준이며 **둘 다 없으면 거부**한다 |
| 트래커 쓰기 제한 | 배정 · `in-progress` 전이 · 되돌림 알림 셋뿐. 머지·완료 전이는 하지 않는다 |
| 동시 배정 감지 | 같다 — 배정 직전 재조회(양보)와 사후 소유 확인·다중 배정 감지 |
| 컨플릭·원격 신선도 | 같다 — 미해결 컨플릭이면 착수하지 않고, 판정 전에 origin을 갱신하며 못 하면 `local-snapshot`으로 적는다 |

**옮기지 않은 것(해당 없음·미구현)**: 기획자 체크리스트(`content-incomplete`)는 WORK 본문에 그
절이 없어 **해당 없음**이다. 브랜치 대조는 WORK에 브랜치 청구가 없어 **해당 없음**이다(발행은
브랜치를 기록하지 않는다). 경로 충돌 판정은 계획 검증(P1)이 이미 막으므로 픽업에서 다시 보지
않는다. **완료·PR 연결(`link`)은 아직 WORK를 모른다** — P3이며, 그때까지 WORK 범위로 `link`를
부르지 않는다.

change-scope는 **같은 파일·같은 키 집합**이다(`ticket-kinds.md` 표). 값이 오는 곳만 다르다:
쓰기 경계는 검토받은 계획의 `writePaths`라 `needsConfirmation: false`이고, STALE 앵커는 계획
digest이며, 공유 작업이면 `featureId`가 `null`이고 `featureIds`가 전부를 싣는다.

**선행 판정은 등록까지다.** 선행 작업이 끝났는지는 아직 원장에 없다(완료·집계는 P3) — 없는
것을 있다고 하지 않고, 지금 잴 수 있는 것까지만 막는다.

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
| plan.work | `workId` `title` `kind` `objective` `nonGoals` `dependsOn` `readPaths` `writePaths` `contractRefs` `provides` `consumes` `designContext` `basisRefs` `priorityRefs` `blockerRefs` `contributesTo` `checks` `lifecycle` `supersededBy` |
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

- 계획의 `analysisRef.digest` = 현재 분석의 digest(`claim --work`가 알려 준다). 분석이 바뀌면 계획을 다시 쓴다.
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
