# Minimal Change Contract

기능 추가, 버그 수정, API 연결, migration, refactor에서 **문제를 완전히 해결하는 smallest coherent change**를 선택한다. 최소 줄 수가 목적이 아니며 root cause를 남겨 둔 채 증상만 우회하는 patch도 허용하지 않는다.

## Activation

- `CHANGE_MODE: existing-change` — 기존 application/library source를 수정하면 이 계약을 적용한다.
- `CHANGE_MODE: greenfield` — 합의된 빈 target에 최초 scaffold를 만들 때는 change brief를 생략할 수 있다.
- 기존 source가 있는 target에 새 파일만 추가해도 integration 지점을 수정하면 `existing-change`다.
- security, data loss, public contract consistency 때문에 범위 확대가 필요하면 아래 escalation 절차를 따른다.

## Change Brief

첫 source edit 전에 `_workspace/03_dev/change-scope.md`를 작성하거나 같은 필드를 agent prompt에 명시한다.

```markdown
# Change Scope

CHANGE_MODE: existing-change
REQUEST: 사용자가 요청한 동작
OBSERVED_BASELINE: 현재 동작과 관련 owner
TARGET_BEHAVIOR: 변경 후 검증 가능한 동작
ALLOWED_PATHS: 수정이 예상되는 owner 경로
PUBLIC_CONTRACTS_TO_PRESERVE: API, schema, route, state, persistence, accessibility
NON_GOALS: 이번 작업에서 하지 않을 것
CHANGE_BUDGET: 예상 파일·component·dependency 범위
TEST_EVIDENCE: 변경 전 재현과 변경 후 검증
CAPABILITY_ESCALATION: none | detected: 신호 목록
DOCS_TO_UPDATE: 이 변경과 충돌하는 02_design canonical 문서 | none — **대조한 문서 목록을 괄호로 병기한다**(`none (대조: layout-spec, component-spec, api-schema)`). change 레인은 개발 전 감지 단계에서 채운다(`approval-checkpoints.md`)
```

`CHANGE_BUDGET`은 line cap이 아니다. 예상 범위를 벗어나는 rewrite와 우발적 확장을 발견하기 위한 검토 기준이다.

`CAPABILITY_ESCALATION`은 이번 변경이 **제품의 공격 표면 등급을 올리는지**를 기록한다. 다음 신호 중 하나라도 있으면 `detected`다 —
① `api/` 등 서버 실행 경로 신규 생성 ② 인증·세션·DB·서버 SDK 의존성 추가(`jose`, `@neondatabase/*`, `pg`, `next-auth`, LLM SDK 등)
③ 클라이언트에서 자체 서버 엔드포인트로의 fetch/mutation 도입 ④ 외부 API 키를 소비하는 코드 추가.
`detected`면 project profile의 capabilities를 현재화하고 **`security-reviewer`(+서버 계약이 생겼으면 `api-contract-verifier`) 재투입이 의무**다.
최초 생성 시 `capabilities: base`였다는 사실은 면제 사유가 아니다 — 승격된 표면은 승격된 QA를 받는다.

`DOCS_TO_UPDATE`는 이번 변경이 `_workspace/02_design/`의 canonical 계약(state-contract·api-schema·layout-spec·component-spec·design-system)과 — 소비 형태가 화면이 아니면 그 형태의 canonical로 읽는다(라이브러리·CLI는 `api-design.md`, `shape-routing-contract.md` §2). 대조 집합은 **그 프로젝트의 `02_design/`에 실재하는 문서 전부**이며, 위 열거는 web-app 형태의 예시다 —
충돌할 때 그 문서를 나열한다. **나열된 문서의 개정이 끝나기 전에는 라운드를 완료로 선언하지 않는다.** change-scope의 누적 기록은
canonical 문서의 대체물이 아니다 — 다음 라운드 에이전트는 canonical 문서를 믿고 움직이므로, 갱신 없이 닫힌 라운드는 미기록 계약 변경이다.

## Execution Rules

1. edit 전에 관련 call path, public export, test를 읽고 current status/diff는 `node .claude/scripts/run-git-inspection.mjs --project {project-root} --operation <status|diff>`로 수집한다. 직접 `git`을 실행하지 않는다.
2. 사용자가 이미 수정한 파일을 구분하고 unrelated changes를 revert, overwrite, reformat하지 않는다.
3. 기존 abstraction과 naming을 우선 사용하고 동일 책임의 새 helper/store/adapter를 중복 생성하지 않는다.
4. 요청과 무관한 rename, file move, dependency upgrade, formatter-wide rewrite, cleanup refactor를 함께 수행하지 않는다.
5. public API, wire schema, route, persisted state, environment contract는 요청 또는 root-cause상 필수일 때만 변경한다.
6. 테스트를 통과시키기 위해 production behavior를 약화하거나 broad fallback을 추가하지 않는다.
7. dead code 삭제는 이번 변경으로 직접 고아가 된 코드에 한하고 증거를 남긴다.
8. owner가 다른 경로는 해당 owner agent로 라우팅하며 한 agent의 편의를 위해 scope를 넓히지 않는다.
9. **Baseline 보존 (관측 가능한 외형·동작)** — 기존 화면·기능의 사용자 관측 가능한 상태(시각 속성, 문구,
   인터랙션 동작)는 보존 대상 계약이다. 요청에 없는 변경은 ASSUMPTION 대상이 아니며, 다른 화면이나 다른
   프로젝트의 패턴을 참조 이식할 때 따라오는 부수 속성도 마찬가지다. 필요하면 근거와 함께 사전 확인을
   받고, 승인된 것만 변경 보고의 "요청 외 변경" 항목에 기록한다.
10. **기존 결함의 개선 게이트** — 작업 중 요청 범위 밖에서 기존 코드·구조·레이아웃의 결함을 인지하면
    개선(리팩토링)을 제안할 수 있지만, 실행 전에 반드시 사용자에게 (a) 발견한 문제점, (b) 방치 시 영향,
    (c) 개선 범위와 대안을 알리고 실행 여부를 확인한다. 요청 작업의 부수 절차로 조용히 수행하지 않는다.

## Scope Expansion

다음 중 하나가 발생하면 확대된 경로를 수정하기 전에 change brief를 갱신한다.

- `ALLOWED_PATHS` 밖의 파일 변경 필요
- public contract 또는 persisted data migration 변경
- 새 runtime dependency, build tool, deployment 설정 필요
- 여러 feature/entity에 걸친 구조 변경
- 예상하지 못한 보안·데이터 무결성 root cause 발견

사용자 요구와 호환성에 실질적 영향을 주면 이유, 대안, blast radius를 설명하고 확인한다. 즉시 수정하지 않으면 보안·데이터 손실 위험이 있는 경우에는 가장 안전한 최소 조치를 적용하고 확대 이유를 명시한다.

## Verification

1. 변경 전 실패 또는 현재 동작을 가능한 가장 작은 test/fixture로 재현한다.
2. 변경 동작에 필요한 test만 추가·수정하고 unrelated snapshot 대량 갱신을 하지 않는다.
3. 가장 가까운 test부터 실행한 뒤 typecheck, lint, build, broader integration/browser 순서로 확장한다.
4. 실제 changed paths를 `ALLOWED_PATHS`와 대조하고, `PUBLIC_CONTRACTS_TO_PRESERVE`의 각 항목이 회귀하지 않았음을 명시적으로 재확인한다 — 특히 기능을 다른 화면·진입점으로 옮겼다면 옮긴 곳에서 실제로 동작하는지 증거로 확인한다.
5. format-only noise, accidental generated file, unrelated lockfile change를 검사한다.
6. 완료 보고에 changed files, 보존한 contract, scope deviation, **요청 외 변경(있다면 승인 근거)**,
   실행한 evidence를 기록한다.
7. **검증 불가 변경은 가설 하나씩** — 변경 결과를 에이전트가 직접 관측·검증할 수 없는 환경에서는
   검증되지 않은 변경 가설을 한 번에 하나만 적용하고, 사용자 확인을 받은 뒤 다음 가설로 진행한다.
   미검증 대안 패턴으로의 임의 전환은 새 회귀를 만든다.

## Review Decision

- **PASS** — 실제 diff가 brief 안에 있고 root cause와 acceptance criteria를 해결한다.
- **WARN** — 동작은 맞지만 설명되지 않은 작은 scope deviation 또는 검증 공백이 있다.
- **FAIL** — unrelated change, 정당화되지 않은 broad rewrite, 요청하지 않은 public contract 변경, 사용자 변경 덮어쓰기, 증상 우회 patch가 있다.
- **BLOCKED** — `existing-change`인데 baseline/brief가 없어 의도된 변경과 기존 사용자 변경을 구분할 수 없다.
