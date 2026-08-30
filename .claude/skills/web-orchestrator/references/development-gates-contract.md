# Development Gates Contract

Phase 3의 늦은 통합 실패를 줄이기 위한 진단 게이트다. release evidence는 Phase 4에서 새 source fingerprint로 다시 생성한다.

## 공통 규칙

- 각 gate 전에 실제 changed paths와 owner journal을 확인한다.
- 실행 전 사용자에게 project code를 실행할 check와 cwd를 보여주고 확인받는다.
- raw package-manager 명령을 사용하지 않는다. 승인된 host에서는 `run-quality-gates.mjs --check {id} --allow-host-execution`, 격리 CI에서는 `WEB_HARNESS_ISOLATED_EXECUTION=1`을 사용한다.
- gate 뒤 source가 바뀌면 이전 receipt는 진단 기록일 뿐이며 release evidence로 재사용하지 않는다.
- 실패하면 다음 wave를 계속 생성하지 않고 가장 작은 owning agent로 되돌린다.
- **toolchain pin**: 게이트는 프로젝트 pin(`.nvmrc`) 버전으로 실행한다. 세션 기본 Node가 pin보다 낮으면
  (SessionStart `check-session-toolchain` 경고 참조) 실행 전에 pin된 Node를 PATH에 앞세운다. 낮은 버전에서 나온
  실패·green은 evidence로 인정하지 않는다. 이 pin 준비는 매 게이트 실행 명령에 포함해 실행 위치·버전을 증거에 남긴다.

- **`lint`는 A·B·C 세 곳에서 돈다**(2026-08-28). 종전에는 Gate A에서 한 번만 돌았는데,
  A는 **기반 직후**라 UI 코드가 아직 없다. 구현 코드가 대량으로 들어오는 것은 B·C 구간이고
  거기서는 `typecheck`·`build`만 돌았다 — 스타일 규약(명명·파일명·`enum`·`export *`·
  `React.FC`·TODO)이 Phase 4 릴리스 게이트까지 안 잡힐 수 있었다. **스타일 수렴을 노린
  규칙인데 피드백이 가장 늦게 오는 구조**였다. 되돌리기 비용은 늦게 알수록 커진다.

## Gate A0 — 의존성 pin 사전검증 (install 전, greenfield)

`environment-scaffolder`가 `package.json`을 만든 뒤 **lockfile/install 전에** 실행한다:

```bash
node .claude/scripts/validate-dependency-pins.mjs --project {project-root}
```

exact 버전 pin이 (a) registry에 존재하는지, (b) pin 집합 내부의 peer 호환을 만족하는지
검사한다(Tessl Spec Registry 착안). 이 명령은 bash 정책의 등록된 validation contract를
경유해야 agent가 실행할 수 있다(`global-bash-policy-lib.mjs`의 `validationScriptContract`에
등록됨 — 신규 검증 스크립트는 정책 등록 없이 문서화하면 `DENY_VALIDATION_COMMAND`로 막힌다). `FAIL`이면 install을 시작하지 않고 pin을 정정한다
(가장 작은 owner: `tech-advisor`/`environment-scaffolder`). 근거(seminar-booking 실증):
tech-advisor가 존재하지 않는 버전(typescript 6.0.0)과 **install/lockfile이 WARN으로만
흘려보내 lint까지 새어든 peer 비호환**(typescript-eslint 8.57.0이 TS7 미지원)을 냈다.
이 게이트는 두 클래스를 install 전에 잡아 Phase 2/3 낭비를 막는다. 파싱 불가한 범위는
false-fail 대신 미검사로 남긴다(신뢰성 우선). 네트워크(registry 조회)가 없는 환경이면
`no-registry-data`로 skip되며 install 시점 검증에 위임한다.

## Gate A — Foundation

package, tooling, shared foundation, app shell과 활성 infrastructure가 완료된 뒤:

1. package script ↔ config ↔ entrypoint closure — **기계로 대조한다**:

   ```bash
   node .claude/scripts/validate-environment-closure.mjs --project {project-root}
   ```

   필수 script(`build`·`lint`·`typecheck`·`test`·`test:coverage`·`test:tc`, web app이면
   `dev`·`test:e2e`)와 ESLint 계열 의존성·Flat Config의 존재를 본다. 누락이면 `BLOCKED`이며
   `environment-scaffolder`로 되돌린다. 산문 계약만으로는 지켜지지 않는다는 것이 실측됐다
   (2026-08-30: lint·typecheck·test:coverage·test:tc·test:e2e 5개와 ESLint가 통째로 없는 채
   Phase 3가 진행돼, 세 게이트가 요구하는 lint 축이 도구 부재로 조용히 사라졌다).
2. locked profile/toolchain 재생성 및 execution-plan binding
3. `typecheck`, `lint`
4. 기존 프로젝트면 changed paths ↔ `ALLOWED_PATHS`와 owner journal

entrypoint나 dependency가 아직 없어 check가 실행 불가능하면 `BLOCKED`다. 후속 UI가 해결할 오류로 넘기지 않는다.

**축이 없으면 통과가 아니다(A·B·C 공통).** 도구·script가 없어 `typecheck`·`lint`·`build`를
실행할 수 없으면 그 게이트는 `BLOCKED`다 — "미구성"으로 표기하고 넘어가면 계약이 요구하는
축이 **없다는 이유로 면제**되어 §4 공허 통과가 된다. 표기는 정직해야 하지만, 정직한 표기가
통과를 만들지는 않는다.

## Gate B — Surface Contract

API contract/auth, route, Mock, component가 완료된 뒤:

1. API schema ↔ runtime validation ↔ Mock method/path/status/body
2. route ↔ page/widget/component public export
3. production build에서 Mock activation이 가능한 구조인지 정적 확인
4. `typecheck`, `lint`

TIMESERIES_MODE에서 Mock이 의도적으로 뒤로 미뤄졌으면 transport interface와 지연 근거를 기록하고 Mock 항목만 `DEFERRED`로 둔다.

## Gate C — Integrated Source

entity query, mutation/form/domain/realtime owner와 `developer`가 완료된 뒤:

1. requirement/UX risk → screen → owner → source trace
2. loading/error/empty/partial/permission/destructive 연결
3. `typecheck`, `lint`, `build`
4. source mutation, unexpected lockfile/config change, production Mock boundary

Gate C 통과 뒤 deployment/visual test source가 바뀌면 Phase 4에서 전체 profile과 evidence를 다시 확정한다.

## Gate R — 요구사항 표기 (의무 진술의 존재)

요구사항이 **라벨인지 요구사항인지**를 가른다. 실측(seminar-booking)에서 REQ 헤드라인은
`- [ ] REQ-F-014 대기열 순서 FIFO`처럼 명사구인 경우가 있고, 그 아래 AC가 없으면 "무엇을
보장해야 하는가"가 문서 어디에도 없다 — 그래도 아무도 잡지 않았다.

```bash
node .claude/scripts/validate-requirements-notation.mjs --project {root}
```

- `NO_OBLIGATION` — Must 요구사항 블록에 의무 진술이 하나도 없다. 라벨일 뿐이다.
- `NO_ACCEPTANCE_CRITERIA` — 의무는 진술했으나 검증 가능한 AC가 하나도 없다.
- `AC_NO_RESPONSE` — AC가 결과(Then/shall/서술체 종결)를 말하지 않는다. EARS의 최소 요건
  (시스템 응답 명시) 미달이다.
- 통과 시 AC 단위 **EARS 패턴 분포**(complex/event/state/ubiquitous/unwanted)를 보고하고,
  `unwanted`(오류·경계)가 0이면 경고한다 — 작성자가 빠뜨리기 쉬운 범주다.

**EARS와 Given/When/Then은 동형이다** (실측: 파일럿 AC 38개 전부 구조 충족 — Given=상태/전제,
When=트리거, Then=응답). 그래서 별도 문법을 도입하지 않고 기존 GWT AC에 EARS의 구조 요건
(응답 명시 필수, 조건·트리거 분류)을 검사로 얹는다. 한국어·영어를 모두 인정한다(0단계 교훈).

## Gate L — 산출물 언어 (선언과 실제의 일치)

지시(에이전트·스킬 본문)의 언어와 **산출물의 언어는 별개 문제**다. 모델은 한국어 지시로도
동작하지만, 기획서·설계서·QA 리포트가 사용자 언어로 나오지 않으면 이 하네스의 핵심 가치가
그 사용자에게 통째로 사라진다. 실측: 산출물 문서 템플릿을 가진 에이전트 20개가 한국어
헤딩(`## 색상 팔레트`, `## 엔드포인트 목록` 등)을 들고 있었다.

**규약**

1. intake에서 **요청 언어를 판별**해 `_workspace/01_plan/project-profile.json`에
   `"outputLanguage": "en" | "ko" | …`로 기록한다(resolver stdout에 병합).
2. **산출물을 쓰는 모든 스폰 프롬프트에 그 값을 주입**한다 — "산출물 문서의 제목·본문은
   {outputLanguage}로 작성한다. 식별자·파일 경로·코드·FEAT/TC ID는 그대로 둔다."
   에이전트 정의에 always-read를 추가하지 않는다(I4 — 주입은 고정 비용이 0이다).
3. Phase 4에서 선언과 실제를 기계로 대조한다:

```bash
node .claude/scripts/validate-output-language.mjs --project {root}
```

**판정**: `PASS`(일치) · `FAIL`(선언과 다른 언어의 헤딩 존재) · `UNDECLARED`(선언 없음 —
통과가 아니라 **검사 미수행**이다. 특정 언어권 지원을 주장하려면 선언이 있어야 한다).

**한계**(§4 등록): 헤딩만 검사한다 — 본문·표·코드펜스는 샘플·고유명사로 한글이 정당하게
들어갈 수 있어 오탐 비용이 크다. 즉 헤딩만 맞추고 본문이 다른 언어여도 PASS가 난다.
검사는 단방향(en 선언에 한글 헤딩 금지)이며 `outputLanguage` 판별 자체는 자기선언이다.

## 판정

- `PASS` — 다음 wave 진행 가능
- `DEFERRED` — 계약상 뒤 wave owner가 명확한 항목만 허용
- `FAIL` — owner 수정 후 같은 gate 재실행
- `BLOCKED` — dependency/profile/권한/범위/실행 승인 부재로 진행 불가

같은 gate가 두 번 수정 후에도 실패하면 `retry-policy.md`의 hard stop으로 넘긴다.
