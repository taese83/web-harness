# Phase 3 — 개발 (순서 있음)

`web-orchestrator`의 Phase 3 본문이다. **Phase 2 체크포인트를 통과한 시점에 읽는다**(선행 로드 금지).
SKILL.md 본문에서 시점 로드로 강등했다(2026-08-27) — 강등 근거와 한계는 `docs/protected-core.md` §4.

`_workspace/02_design/preview/`가 존재하면 첫 source edit 전에 `node .claude/scripts/validate-design-preview.mjs --project {root} --json`을 실행한다. 상태가 `APPROVED`가 아니면 `BLOCKED`이며, `STALE`이면 바뀐 스펙에서 프리뷰를 재생성·재확인·재승인한다. **`spec.json`의 `designPreview.policy`가 `skip`이면 `SKIPPED`로 통과한다** — 프로젝트가 프리뷰를 만들지 않기로 선언한 경우다. 다만 `skip`인데 프리뷰 디렉터리가 남아 있으면 `OPT_OUT_CONFLICT`로 막는다(선언과 실물이 어긋난 것을 조용히 넘기지 않는다). 선언이 없으면 종전대로 `APPROVED`를 요구한다. production builder에는 승인된 source digest가 묶은 design-system/layout-spec/component-spec/feature-plan만 전달하고 preview HTML/CSS/JS는 구현 입력으로 전달하지 않는다.

## 착수 전 — Gate 0

첫 줄을 쓰기 전에 `development-gates-contract.md`의 **Gate 0**(개발 착수 준비)를 통과한다.
개발 중에 막히는 것은 여기서 미리 닫는다. 개발 중 `BLOCKED` 중 **착수 전에 알 수 있었던 원인**은 Gate 0의 결함이다 — Gate A·B·C가 방금 쓴 코드를 막는 것은 정당한 차단이며 예외다.

## 이 단계는 아무것도 실행하지 않는다

`environment-scaffolder`와 `developer`는 도구가 `Read·Glob·Grep·Write·Edit`뿐이다 — **Bash가 없다.**
의도된 설계다(검사를 정의하는 것과 검사를 통과해야 하는 것을 분리한다). 그 결과 **이 단계가 끝난
시점에 build·test·lint 중 무엇도 실행된 적이 없다.**

두 에이전트는 이 사실을 정직하게 보고한다("not done — 결과를 지어내지 않겠다"). 그 줄을 넘기면
검증되지 않은 산출물이 "구현 완료"로 보이고, 사용자가 전부 손으로 확인하게 된다(2026-09-01 실측).

실행 검증은 Bash를 가진 별도 에이전트가 한다. **Phase 3 체크포인트에서 무엇이 아직 실행되지
않았는지 사용자에게 명시하고 Phase 4로 넘긴다.**

| 실행할 것 | 에이전트 |
|---|---|
| build · 라우트 · Mock API 연결 · dev 서버 기동 | `integration-verifier` |
| 테스트 실행과 커버리지 | `test-executor` |
| TS·ESLint·경계 위반 리뷰 | `code-reviewer` |

## 형상 규율 — 이 단계의 커밋·브랜치

개발 단계에 들어가면 **묻지 않고 진행한다**. 확인을 받는 지점은 **PR 직전 하나뿐**이다.

산출물끼리 어긋나 막히는 것도 예외가 아니다 — `interaction-contract.md`의 "묻지 않는 것"을
그대로 따른다.

- **디자인은 최대한 구현한다.** design-system·component-spec·layout-spec에 정해진 것은 그대로
  따르고 임의 값으로 대체하지 않는다. 정본에 **없거나 맞지 않으면** 적정한 값을 판단해 정한 뒤
  **정본에 추가·수정한다** — 디자인은 확정 뒤에도 바꿀 수 있는 산출물이다. 없다고 멈추지 않고,
  정본을 고쳤으면 무엇을 왜 바꿨는지 PR에 남긴다. 기계 게이트로 강제하지는 않는다.
- **권장안을 낼 수 있으면 묻지 않는다.** 선택지에 "(권장)"을 붙일 수 있다는 것은 판단이 이미
  섰다는 뜻이고, 그 상태에서 묻는 것은 결정을 사용자에게 떠넘기는 것이다. 권장안으로 진행한 뒤
  **무엇을 왜 그렇게 정했는지 한 줄로 보고**한다 — 사용자는 그때 뒤집으면 된다. 아래 "묻는
  경우 넷"도 이 단서를 먼저 통과해야 한다: **문서로 답이 나오면 그 답으로 진행한다.**
- **먼저 최신으로 맞춘다.** 분기 전에 base 브랜치를 `fetch`하고 최신 상태로 올린다. 오래된
  base에서 따면 충돌을 스스로 만들고, 이미 머지된 남의 작업을 되돌리는 diff를 낸다.
  `origin/<브랜치>` 참조는 **마지막 fetch 시점의 스냅샷**이라 fetch 없이는 "최신"을 알 수 없다.
  **base가 뒤처져 있으면 묻지 않고 fast-forward한다** — 발산이 없으면 되돌릴 것이 없다.
  양쪽이 다 앞선 진짜 발산일 때만 멈춘다.
- **dev 브랜치를 딴다.** 공유 브랜치(`main`·`develop`·티켓 청구 브랜치)에 직접 커밋하지 않는다.
  티켓 흐름이면 청구 브랜치에서 `feat/<FEAT-NNN>-<슬러그>`로 분기한다(그 브랜치가 PR base다).
- **확정 산출물은 자체 판단으로 따른다.** 기획·디자인·설계·스팩은 이미 승인된 입력이므로 해석
  여지는 스스로 정한다. 멈추고 묻는 경우는 넷뿐이다:
  스펙에 없는 동작을 만들어야 할 때(**TC 발명 금지** — feature-planner 되돌림) ·
  `change-scope`의 `ALLOWED_PATHS` 밖을 고쳐야 할 때 · 확정된 계약·결정과 충돌할 때 ·
  되돌리기 어렵거나 팀 전체에 영향이 가는 조치가 필요할 때.
  **`ALLOWED_PATHS`가 비어 있는 것은 질문거리가 아니라 계획 결함이다** — 자기 TC를 검증할 수
  없는 경로 선언(`paths=none` 등)은 성립하지 않는다. 같은 공백을 앞선 FEAT가 어떻게 갈랐는지
  (선 소유 규칙)를 적용해 스스로 정하고, 계획의 `paths=` 선언을 함께 고친다.
- **커밋은 묻지 않고 계속하되 한 커밋 = 한 가지 변화**로 쪼갠다. 리팩터링과 기능 추가를 섞지
  않고, 커밋마다 무엇을·왜 바꿨는지 남기며 실측이 있으면 수치를 적는다(주장과 증명을 섞지
  않는다). **AI 공동저자 트레일러(`Co-Authored-By: Claude …`)는 넣지 않는다.**
- **커밋 후 dev 브랜치에 푸시한다.** 확인 없이 한다 — 되돌릴 수 있고 그 브랜치 안에 갇힌다.
- **PR 직전에 확인받는다.** 변경 요약·영향 파일·TC 결과·남은 미결을 보이고 승인 뒤에만 만든다.
  PR은 리뷰어를 부르고 base 브랜치로 나가는 **팀을 향한 행위**라 자율 범위 밖이다.

Gate A·B·C와 스폰 완결성 게이트는 이 규율과 무관하게 그대로 밟는다 — 커밋 자율은 게이트
면제가 아니다.

source 존재 여부로 `CHANGE_MODE: greenfield | existing-change`를 먼저 결정한다. `existing-change`이면 첫 edit 전에 `_workspace/03_dev/change-scope.md`에 `TARGET_BEHAVIOR`, `ALLOWED_PATHS`, `PUBLIC_CONTRACTS_TO_PRESERVE`, `NON_GOALS`, `CHANGE_BUDGET`, `TEST_EVIDENCE`, `CAPABILITY_ESCALATION`, `DOCS_TO_UPDATE`를 기록한다(스키마는 `minimal-change-contract.md`가 canonical). 모든 implementation/retry agent prompt에 이 필드를 전달하고 scope 확대가 필요하면 확대된 경로를 수정하기 전에 brief를 갱신한다. `CAPABILITY_ESCALATION: detected`이면 Phase 4에서 `security-reviewer` 재투입이 의무다.

`existing-change`이면 `_workspace/02_design/integration-overlay.json`이 있어야 한다 — **스팩 확정 전에** 만든다(`solution-design-contract.md` §6). 여기서 처음 만들면 스팩이 즉시 stale이 된다. 각 owner는 `change-journal-contract.md`에 따라 자기 `_workspace/03_dev/change-journal/{agent-name}.md`에 생성·수정·실패·증거를 기록한다.

프로필은 **스팩 확정 전에** 해석돼 있어야 한다(§6) — `project-profile.json`이 `LOCK_INPUTS`라 여기서 처음 만들면 확정한 스팩이 곧바로 낡는다. 아직 없으면 `web-profile-contract.md`의 resolver를 실행하고 **스팩을 재확정한다.** 이때 intake에서 판별한 요청 언어를 `outputLanguage`로 프로필에 병합하고 산출 스폰마다 주입한다 — 규약·검사는 `development-gates-contract.md` Gate L. 기존 project는 `--requested auto`, greenfield는 tech-stack의 명시 profile/provider/deployment/capability를 전달한다. resolver는 crawler script, ingestion package, scheduled refresh workflow를 발견했는데 두 ingestion 계약 또는 `external-ingestion` capability가 없으면 fail-closed해야 한다. stable stdout JSON을 `_workspace/01_plan/project-profile.json`에 그대로 저장하고 `--profile-file`로 DAG를 컴파일해 `_workspace/03_dev/web-execution-plan.json`에 저장한다. profile conflict, provider-target conflict, forbidden marker, ingestion contract/capability 누락, stale adapter hash는 `BLOCKED`다. **구현 스폰마다 `.claude/skills/component-gen/references/ts-conventions.md` 경로를 prompt에 전달한다** — Phase 2가 designer에게 디자인 원칙 허브를 넘기는 것과 같은 방식이며, 코드 작성 규약이 사후 `code-reviewer` 지적이 아니라 생성 시점에 적용되게 한다(포매팅 정본은 생성된 `.prettierrc`).

**스팩이 확정돼 있으면(`_workspace/03_dev/spec.json`) `references/shape-routing-contract.md`를 먼저 읽고 `targetShapes`가 고르는 빌더 세트를 적용한다** — `library`·`cli`는 `shape-routing-contract.md` §2의 `library` 행 세트로 가고 아래 웹 파이프라인을 돌지 않는다. 확정이 없으면 기존 `WEB_PROFILE` 경로다(무발화). `WEB_PROFILE: next-app-fullstack`이면 `/next-app`에 Phase 3 구현과 Next contract QA를 위임하고 아래 Vite 전용 1~6단계를 실행하지 않는다. `WEB_PROFILE: react-vite-spa` 또는 `vite-serverless-hybrid`일 때만 아래 단계를 실행한다 — hybrid는 같은 단계에 serverless handler 구현이 추가된다.

## 디자인 부채 청구 — 화면을 만드는 첫 스폰 **전에** 한 번

**프로필 공통 전제다.** 아래 Vite 전용 단계 목록 밖에 두는 이유는 `next-app-fullstack`이 그 목록을 실행하지 않기 때문이다(`/next-app` 위임) — 청구의 조건은 "화면을 만든다"이지 번들러가 아니다(적대 리뷰 2026-09-04).
`DESIGN_SOURCE: absent`는 "디자인이 필요 없다"가 아니라 "지금 만들지 않는다"다
(`provenance-contract.md` §3). 그 결정은 사라지지 않고 **구현하는 사람에게 넘어간다** —
실측(2026-09-04)에서 디자인 부재는 인계 판정에 흔적을 남기지 않았다(양쪽 인계 READY,
판정 변화 0건). 그래서 개발이 실제로 그 화면에 부딪히는 여기서 청구한다.

```bash
node .claude/scripts/validate-handoff-readiness.mjs --project {root} --design-debt
```

**이 출력은 진행을 막지 않는다**(항상 exit 0). 막으면 `absent`를 고를 수 없게 되고,
고를 수 없으면 사용자는 우회로 돌아간다 — §3이 존재하는 이유다. 대신:

보고는 여섯 상태 중 하나를 낸다. **상태마다 다음 행동이 다르다** — "보여주고 진행"으로
끝내면 청구가 공허해진다.

| `status` | 뜻 | 다음 행동 |
|---|---|---|
| `no-screens` | 화면이 없는 형태(library·cli) | 청구 없음. 그대로 진행 |
| `design-present` | **분모가 선 뒤에** 디자인 산출물이 있고 마커가 `supplied`라고 말하지 않는다 | **청구 없음.** 이 경로의 조건 확인은 Phase 2 체크포인트가 이미 했다 — 여기서 다시 물으면 이미 내린 결정을 되묻는 것이다. 조건별 귀속은 재지 않았고 보고가 그 사실을 적는다. 마커에 `DESIGN_SOURCE`가 없으면 **판정 불가**임을 함께 알린다 — 시안을 받아 만든 것이라면 귀속 기록이 필요하다 |
| `binding-missing` | **분모가 선 뒤에** 마커가 `DESIGN_SOURCE: supplied`인데 귀속 기록이 없다 | 아래 ④ — 디자인을 다시 만들지 않고 `design-binding.json`에 귀속을 적는다 |
| `binding-invalid` | 근거 기록(`design-binding.json`)이 유효하지 않다 | **청구하지 않는다** — 깨진 기록을 근거로 센 숫자는 사실이 아니다. `design-binding-contract.md` 형식으로 고친 뒤 재실행한다. 같은 상태에서 `--to development`도 `design-binding` HOLE을 낸다 |
| `clear` | 조건이 전부 시각 근거를 갖는다 | 그대로 진행 |
| `acknowledged` | 미결이 **전부 인수 기록으로 덮였다**(`ux-brief` 인용이 결정 로그와 대조됨) | 그대로 진행. `clear`와 섞어 읽지 않는다 — 근거가 아니라 **결정**이 있는 상태다 |
| `no-plan` | 기획 문서를 못 찾았다 | **"청구할 것이 없다"가 아니다.** 기획·디자인이 둘 다 없으면 부채가 최대다 — `PLAN_SOURCE`를 확인하고, `absent`가 의식적 선택이면 그 사실과 함께 아래 ③을 받는다 |
| `denominator-broken` | 조건 분모를 못 읽었다 | ⓐ `ux-brief` 표를 `형:이름` 형식으로 고친 뒤 재실행(`ux-researcher` 재스폰 또는 사용자 편집) 또는 ⓑ **범위 없는 인수임을 명시**하고 ③으로 간다. 무엇이 미결인지 셀 수 없는 상태의 인수는 범위가 없다 |
| `debt` | 미결이 있다 | 아래 넷 중 하나를 받는다 |

`debt`이면 **목록을 그대로 보여준다.** 출력은 두 부류를 나눠 적는다 — `결정이 보류된 조건`
(`resolution: pending`으로 **명시적으로 미룬 것**)과 `시각 근거가 없는 조건`(바인딩 행이 아예
없는 것). 둘 다 조건의 **내용**은 기획에 있다(빈 칸이면 분모 검사가 먼저 잡는다) — 없는 것은
그리는 방식이다. 앞의 것은 `--to development`가 이미 구멍으로 잡으므로 대가가 더 급하다.

① **지금 붙인다** — 디자인 공급원을 `generated`(Phase 2 wave) 또는 `supplied`로 바꾼다.
§3 지연 공급이며, 붙는 순간 `component-spec.md` 등이 `LOCK_INPUTS`에 잡혀 **스팩이
자동으로 stale**이 되므로 재확정한다(실측: `sourceDigest` cf3a7647 → c5718dc0).
② **첫 화면 하나로 언어를 세운다** — `design-approval-contract.md` 「시스템 추출」이
화면 1장에서 시스템을 뽑는 절차를 이미 갖고 있다. `absent` 경로는 그 1장을 Phase 2가
아니라 **여기서** 받는다. 그 뒤 화면은 원리에서 파생하고, 원리로 안 되는 것만 다시 묻는다.
③ **인수한다** — 구현이 그 자리에서 정하는 것을 사용자가 받아들인다.
④ **`supplied`인데 귀속 기록이 없다** — 시안을 받았는데 `design-binding.json`이 없으면
디자인을 다시 만드는 것이 아니라 귀속을 기록한다(`design-binding-contract.md`,
`protected-core.md` §4 「무문서 SKIP」). `generated`는 이 경우가 아니다 — 산출물이 있으면
보고가 `design-present`로 끝난다.

**어느 쪽이든 결정을 남긴다 — 그리고 그 기록이 `developer`의 정지를 푼다.**

`developer`는 조건 내용이 없으면 지어내지 않고 멈춘다(그 규율이 이 청구의 backstop이다).
따라서 **인수(③)를 골랐는데 기록이 없으면 첫 스폰이 다시 막히고, 사용자가 고른 경로가
완결되지 않는다**(교차 모델 리뷰 2026-09-04). 기록은 형식이 아니라 그 정지를 푸는 열쇠다.

- `decision-log`에 `PC-NNN`으로 남긴다(`plan-history-contract.md`). **flat·sharded 두 형태다** —
  `_workspace/01_plan/decision-log.md`가 있으면 거기에, `decision-log/`로 분할돼 있으면
  **최신 ID 구간 절에 append**한다(`artifact-sharding-contract.md`: 디렉터리와 동명 `.md`를
  함께 두지 않는다 — 새 flat 파일을 만들면 정본이 둘이 된다). 둘 다 없으면 flat으로 만든다.
- **엔트리에 인수 범위를 명시한다.** 분모가 선 상태(`debt`)면 인수한 조건을 이름으로 적고
  (`PAGE-002[variant=권한 없음]`), 분모가 없는 상태(`no-plan`·`denominator-broken`)면
  **"이 프로젝트의 화면 조건 전부"**라고 적는다 — 후자는 범위가 넓다는 사실 자체가 기록돼야
  한다. 범위를 적지 않은 인수는 나중에 무엇이 인수됐는지 아무도 모른다.
- **표가 있으면 `ux-brief`의 해당 자리에 `ack:<ID>` 토큰으로 인용한다 — 이 토큰이 기계가 읽는
  인수 기록이다.** 어디에 적느냐가 범위를 정한다(형식 정본은
  `../../web-plan/references/design-readiness-contract.md` §1.4):

  **인수는 `ack:<ID>` 토큰으로만 표시한다.** 맨 ID는 인수가 아니다 — `checkDecisionsLanded`가
  정본에 결정 ID를 **내용 근거로** 인용하도록 이미 밀고 있어서, 맨 ID를 인수로 읽으면
  **하네스의 다른 게이트를 따르는 것이 곧 부채를 지우는 행위**가 된다(적대 리뷰 2026-09-04).

  | 적는 자리 | 인수 범위 |
  |---|---|
  | 조건 칸 (`state:empty` 열의 그 화면 칸) | **그 조건 하나** |
  | 화면 이름 칸 또는 서술(`info:`) 칸 | **그 행의 조건 전부** |

  ```markdown
  | PAGE-002 | ① 주문 상태 | 표준 | 첫 주문 안내 (ack:PC-007) | 접근 요청 안내 |
  ```

  **토큰은 결정 로그와 대조된 뒤에만 인수로 센다.** 로그에 없는 ID를 적으면 인수가 아니라
  `결정 로그에 없는 ID를 인용한 자리`로 보고된다 — 없는 결정을 적어 미결을 지우는 것은
  자기신고보다 나쁘다(파일에 거짓이 남고, 다음 사람이 그것을 근거로 넘어간다).

  **대조되는 것은 "그 ID가 로그에 표제로 있다"까지다.** 결정의 내용이 그 조건과 관계있는지,
  범위 진술이 맞는지는 검사하지 않으며 **결정 하나가 여러 조건을 인수할 수 있다**. 보고가
  `PC-011 하나가 N건을 인수했다`로 fan-out을 함께 내므로 넓은 인수는 눈에 보인다 — 그 적정성
  판정은 `plan-reviewer`가 이력을 볼 때의 몫이다.

  인용이 필요한 이유는 둘이다: ⓐ `checkDecisionsLanded`는 정본(`01_plan`·`02_design`)이 인용하지
  않는 새 결정을 구멍으로 잡으므로, 인용 없이 로그에만 적으면 **다음 인계가 이 절차 때문에
  HOLE이 된다**(적대 리뷰 2026-09-04). ⓑ 인용이 있으면 `--design-debt`가 그 조건을
  `acknowledgedBy`로 표시해 **자기신고가 파일 대조가 된다.**
  분모가 없어 인용할 행이 없으면 ⓐ의 대가가 남고 ⓑ도 성립하지 않는다: 다음 인계에서 그 PC가
  stranded로 잡히면 **그때 표를 세우고 인용을 붙인다**. 다만 **`developer`는 그 상태에서
  범위를 명시한 로그 엔트리를 인수로 받는다**(`.claude/agents/developer.md` 「멈추지 않는 두
  경우」 예외) — 적을 행이 없다는 이유로 구현이 멈추면 사용자가 이 절차를 그대로 따랐는데도
  완결되지 않는다. 기계 보고가 세지 못하는 것과 구현이 멈추는 것은 다른 문제다. 인용할 자리를 만드는 것이 곧 분모를
  세우는 것이다.

1. 패키지/도구/앱 기반 생성 (순서 있음):
   - `environment-scaffolder` — package/workspace metadata → TS/Vite/ESLint/Vitest 설정까지 한 스폰
   - `developer` — shared/api/config/store/env/MSW 기반
   - `EXTERNAL_DATA_INGESTION_MODE`이면 `developer` — adapter/normalize/schema/quality/atomic promotion 구현
   - `HYBRID_SERVERLESS_MODE`(`WEB_PROFILE: vite-serverless-hybrid`)이면 `/vite-serverless-hybrid`의 계약으로 루트 `api/` handler를 구현한다 — **§7 엔드포인트 공통 가드 5종이 handler 구현보다 앞선다** (release DAG의 `api.guards`·`api.unit` receipt가 강제). `SERVER_DB_MODE`·`OAUTH_SERVER_MODE`가 이 위에 조합된다
   - `SERVER_DB_MODE`이면 `/server-db-migration`을 실행해 `migrations/` 디렉토리, idempotent SQL 규칙, direct/pooled DSN 분리, 러너 script를 준비한다. 실제 migration 실행은 사용자 승인 후
   - `developer` — main/App/router/theme/home shell
2. 지원 companion과 API 계약 확정:
   - `API_CONTRACT_MODE`이면 `/api-contract-typegen`을 실행해 client/server가 공유할 schema(Zod 또는 OpenAPI codegen)를 확정한다. Mock handler와 entity/feature builder가 이 schema를 참조한다
   - `OAUTH_SERVER_MODE`이면 `/auth-setup`을 실행해 `_lib/oauth.ts`, `_lib/session.ts`, `api/auth/*/{start,callback}.ts`, `authGuard`를 구현한다. 이후 protected handler가 이 guard를 사용한다
   - `MOCK_SERVICE_MODE`이고 `developer`의 기본 셋업 이상이 필요하면 `/mock-service-setup`을 실행해 handler·fixture·시나리오 스위치·bypass mode를 조직한다
3. **구현 — `developer`를 모듈 경계마다 스폰한다.**
   **전제조건: `_workspace/03_dev/spec.json`이 있어야 한다.** 없으면 스폰하지 않는다 —
   `developer`는 기본 소유권이 비어 있어 layerMap 없이는 아무것도 쓸 수 없고, 스폰해 봐야
   디스크 변경 0건으로 반려된다(2026-08-30 실측). 스팩 확정(`spec.mjs`)으로 되돌린다.
   위쪽 "스팩이 확정돼 있으면 … 확정이 없으면 기존 `WEB_PROFILE` 경로다"는 **빌더 세트
   라우팅**에 대한 문장이지 소유권 면제가 아니다. 스팩의 `moduleBoundaries` 각각이 한 스폰의
   범위(`change-scope.md`의 `ALLOWED_PATHS`)가 되고, 소유권은 `layerMap`이 공급한다. **무엇을
   어느 순서로 만들지 지시하지 않는다** — 스팩이 정한 `architecture`·`layerMap`·`libraries` 안에서
   모델이 정한다.

   **병렬 안전의 조건(2026-09-10 정정)**: 경계가 겹치지 않는 것은 필요조건일 뿐이다. 범위를
   집행하는 훅은 모든 스폰이 공유하는 `change-scope.md` **하나**를 읽는다 — 같은 체크아웃에서
   병렬로 쓰면 **마지막에 기록된 범위가 다른 스폰에도 적용**된다(감사 FINDING-003).
   스폰마다 다른 범위를 넣는 채널이 이 하네스에 없으므로 실효 있는 안전 조건은 하나뿐이다:

   **같은 체크아웃에서 developer 쓰기 스폰은 직렬로 띄운다** — 병렬이 필요하면 **체크아웃(worktree)을
   나눈다.** 세션만 나누는 것은 격리가 아니다 — 훅은 세션과 무관하게 같은 프로젝트 루트의
   `change-scope.md`를 읽는다(worktree 분리는 훅의 root 판정과 함께 검증되지 않았다).
   **2026-09-11부터 훅이 강제한다**: 먼저 쓴 developer 스폰이 체크아웃 단위 write 임대를 잡고
   (`write-lease-lib.mjs` — 스폰 신원은 런타임이 넣는 `agent_id`), 다른 스폰의 쓰기는 막히며,
   `SubagentStop`이 자기 임대를 놓는다. 그러니 **병렬로 띄우면 두 번째 스폰은 막히고 멈춘다** —
   실측 receipt `docs/audits/receipts/2026-09-11-write-lease-e2e.json`. 직렬로 띄워라.
   임대는 자동 회수하지 않는다: 홀더가 `SubagentStop` 없이 죽으면 다음 쓰기가 경로를 대며 막히고
   사람이 지운다. (스폰별 범위를 env로 넣던 첫 시도는 생산자 0건이라 걷어냈다.)
   - 구조 지시 빌더 6종(`app-shell`·`route`·`component`·`entity-query`·`feature-mutation`·
     `data-ui-binder`)은 2026-08-26에 제거됐다. 실측으로 그 소유권이 이미 성립하지 않았고
     (`src/pages/**` 3중 겹침, 비-FSD 어휘 무소유) 공급한 것은 격리가 아니라 FSD 경로 처방이었다.
4. **여전히 순서·조건이 걸리는 스폰** — 에이전트는 모두 `developer`이고 구별되는 것은 **실행
   조건과 스폰 범위**다. 3단계의 모듈 경계 스폰과 달리 아래는 앞선 산출물을 기다리거나 모드
   플래그가 켜져야 돈다:
   - Mock handler·fixture 범위. `TIMESERIES_MODE`에서는 realtime interface 완료 후로 미룬다 <!-- marker:timeseries-realtime-build-order -->
   - 차트·대시보드 범위(`TIMESERIES_MODE` · `ANALYTICS_BUILDER_MODE`) — 데이터 계층 완료 후
   - 폼 범위 · 로컬 도메인 상태 범위(`LOCAL_DOMAIN_STATE_MODE`) — 스키마 확정 후
   - SEO 산출물 범위 — 공개 노출 요구일 때만
5. browser Mock 사용 시 `public/mockServiceWorker.js`를 확인한다. dependency install이 승인·완료됐는데 파일이 없으면 실제 외부 격리가 적용된 setup job에서만 `WEB_HARNESS_ISOLATED_EXECUTION=1 node .claude/scripts/run-package-operation.mjs --project {project-root} --operation msw-init`을 실행한다. 사용자 승인만 있는 host 실행은 `BLOCKED`다
각 1·3·4단계 뒤 `development-gates-contract.md`의 Gate A·B·C를 실행하고 `FAIL|BLOCKED`면 다음 단계로 진행하지 않는다. 중간 receipt는 이후 source 변경 시 stale이며 Phase 4 release evidence를 대신하지 않는다. 이와 별개로 각 builder 스폰 직후 `execution-budget-contract.md`의 **스폰 완결성 게이트**(완결성 마커·`verify-spawn-completion.mjs`·runaway 임계)를 통과시킨다 — 실패면 re-spawn 또는 `NEEDS_DECISION`, 불완전 산출물 위에 다음 단계를 쌓지 않는다(품질 Gate A/B/C와 보완).
6. 배포 CI가 요구됐거나 `tech-stack.md`에 배포 target이 있으면 `environment-scaffolder`를 실행한다.
7. `scheduled-static-ingestion`이면 `environment-scaffolder`가 refresh workflow만 작성한다. workflow는 machine validator가 요구하는 kind/generated-path/direct-push metadata, read-only crawl job, 격리된 promotion 권한, concurrency를 포함해야 한다.
8. provider가 Vercel이면 `environment-scaffolder`가 root/app `vercel.json`, build/output/root 계약만 작성한다. ingestion workflow와 provider config를 일반 deploy agent가 임의 경로에 만들지 않는다. 모든 workflow/config는 source fingerprint 대상이므로 Phase 4 quality runner보다 먼저 완료한다.
9. `VISUAL_QA_MODE`이면 UI와 fixture 완료 후 `developer`를 시각 test/story 범위로 실행하고 baseline은 별도 승인 전까지 갱신하지 않는다.
