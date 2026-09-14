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
5. 발행(P2)은 아직 없다. `--confirm`은 `PUBLISH_NOT_AVAILABLE`을 돌려주고 FEAT 개발 티켓 발행으로 폴백하지 않는다.

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
**생산자가 없다**(P2-c) — 판독 입구만 먼저 닫아 둔다.

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
