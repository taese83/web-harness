# Solution Design Contract — 개발 착수 전 구현 설계

Phase 2(디자인)와 Phase 3(개발) 사이에서 `system-architect`가 **구현 설계 결정**을 기록하고
사용자에게 선택지를 제시한다. 산출물은 `_workspace/02_design/solution-design.md`.

## 0. 이 단계의 지위 — Stage 0(관측)

**현재 이 산출물은 게이트가 아니다.** 어떤 검사도 이 파일을 근거로 `BLOCKED`시키지 않고,
빌더 파이프라인은 이 파일이 없어도 평소대로 동작한다. 목적은 하나다 — **설계자가 실제로 쓸 만한
결정을 내는지 관측하는 것**. 관측 결과가 이후 단계(스팩 락 → 게이트 전환 → 소유권 이관)의
실패 데이터가 된다.

이 지위는 문서에 명시된다. 산출물 상단에 `STAGE: 0 (observational — not a gate)`를 적고,
읽는 쪽이 이것을 계약으로 오해하지 않게 한다. 지위가 바뀌면 이 절을 갱신한다.

## 1. 무엇을 담고 무엇을 담지 않는가

이 구분이 계약의 핵심이다. 지키지 않으면 산문 파이프라인을 다른 파일로 옮긴 것뿐이다.

**담는다 — "무엇이 참이어야 하는가"**

| 항목 | 내용 |
|---|---|
| 아키텍처 패턴 | FSD · 레이어드 · 도메인 모듈 · 기존 관례 준수 중 무엇이며 **왜** |
| 레이어 맵 | 논리 레이어 → 실제 경로. 브라운필드는 `integration-overlay.json` 실측이 우선 |
| 라이브러리 결정 | 데이터 계층·상태·폼·mock·UI 레인. 각 항목에 대안과 선택 사유. **확인된 부재도 결정이다**(§4 `measured-absent`) |
| 모듈 경계 | 병렬 작업이 서로 침범하지 않을 쓰기 범위 후보 |
| 수용 기준 참조 | `feature-plan.md`의 FEAT/TC ID — **여기서 새로 만들지 않는다**. 부재하면 §4 `acceptanceSource`로 그 사실을 명시한다 |
| 데이터 계약 참조 | `api-schema.md` · `state-contract.md` — 참조만, 복제 금지 |
| 비목표 | 이번 범위 밖임을 명시할 것 |
| 미결정 | 사용자 결정이 필요한 항목 (§3) |

**담지 않는다 — "어떻게 만드는가"**

- 파일 생성 순서, 어떤 빌더가 언제 도는지
- 컴포넌트 트리, 함수 시그니처, 구현 절차
- Phase 1·2 산출물의 복제 (요구사항·화면·토큰은 참조로만)

판단 기준: **그 문장이 검증 가능한 명제인가, 아니면 작업 지시인가.** 후자면 빼라.

## 2. 브라운필드 우선 규칙

**이미 확정된 결정은 재결정하지 않는다.** `tech-stack.md`와 해석된 프로필이 고정한 것(특히
`UI_LANE`·프레임워크·배포 target)은 정본이 하나여야 한다 — 다르게 가야 한다고 판단하면
`openDecisions`로만 올리고 여기서 값을 바꿔 적지 않는다. 두 곳에 다른 값이 적히면 validator는
`tech-stack.md`만 보므로 조용한 불일치가 된다.

기존 source가 있으면 **관례 실측이 제안보다 우선한다.**

- `integration-overlay.json`의 app root·package manager·alias·router·query library를 먼저 읽고
  레이어 맵과 라이브러리 결정의 기본값으로 쓴다
- 실측값과 다른 것을 제안하려면 **이유와 이전 비용**을 함께 적고 미결정으로 올린다.
  조용히 덮어쓰지 않는다
- 기존 프로젝트에 아키텍처 관례가 없으면 그 사실을 그대로 기록한다 — 없는 관례를 지어내
  기록하지 않는다

## 3. 사용자 제시 — 결정을 대신하지 않는다

설계자는 **판단하되 확정하지 않는다.** 다음은 반드시 선택지로 제시한다:

- 대안이 실질적으로 갈리는 결정 (예: 상태 관리 라이브러리, 아키텍처 패턴)
- 브라운필드 실측과 다른 제안
- 되돌리기 비용이 큰 결정 (디렉토리 구조, 데이터 계층)

제시 형식은 `interaction-contract.md`를 따른다 — 한 번에 최대 3개, 각 선택지에 **추천안과
사유**를 붙인다. 사용자가 답하지 않으면 추천안을 `ASSUMPTION`으로 확정하고 그렇게 표기한다.

명백한 것은 묻지 않는다. 기존 관례가 있고 그것을 따르면 되는 항목은 기록만 한다.

## 4. 기계 판독 가능 블록 (전방 호환)

문서 끝에 결정을 구조화해 한 번 더 적는다. Stage 1에서 이 블록이 잠금 아티팩트로 승격되므로
**형식을 임의로 바꾸지 않는다.**

````
```json web-harness:solution-design
{
  "stage": 0,
  "architecture": {"pattern": "fsd|layered|domain-modules|existing|<기타>", "rationale": "..."},
  "layerMap": {"<논리 레이어>": "<실제 경로>"},
  "libraries": {"<역할>": {"choice": "...", "alternatives": ["..."], "source": "measured|measured-absent|proposed"}},
  "moduleBoundaries": [{"scope": "<glob>", "rationale": "..."}],
  "acceptanceSource": "feature-plan|absent",
  "acceptanceRefs": ["FEAT-001", "TC-001-1"],
  "nonGoals": ["..."],
  "openDecisions": [{"id": "...", "question": "...", "options": ["..."], "recommended": "...", "status": "open|assumed|confirmed"}]
}
```
````

`pattern`의 나열값은 **예시이며 열린 문자열이다** — hexagonal 등 미등재 패턴도 유효하다.

`source` 필드는 정직성 장치다. 세 값의 구분이 요점이다:

| 값 | 뜻 |
|---|---|
| `measured` | 기존 코드에서 실측해 **있음**을 확인한 값 |
| `measured-absent` | 실측해 **없음**을 확인했다. `choice: "none"`과 짝을 이룬다 |
| `proposed` | 설계자가 새로 제안한 값 — 실측 근거가 없다 |

`measured-absent`가 별도 값인 이유(실사용 발견, 2026-08-26): `choice: "none"` + `source:
"measured"`로는 **"찾아봤는데 없다"와 "안 찾아봤다"가 구분되지 않는다**. 네트워크 계층·mock·
E2E의 부재는 그 자체가 설계 결정이며, 확인된 부재와 미확인은 이후 단계에서 전혀 다르게 다뤄야
한다. 확인하지 않았으면 `measured-absent`를 쓰지 말고 미결정으로 올려라.

## 일반화 근거

이 계약은 특정 프레임워크·아키텍처·라이브러리를 전제하지 않는다. `layerMap`은 논리 레이어에서
경로로 가는 **매핑**이고 레이어 이름과 경로 어휘를 둘 다 프로젝트가 정한다. `libraries`는
역할(데이터 계층·상태·mock)만 고정하고 구현체를 열어 둔다. `architecture.pattern`은 열린
문자열이며 `existing`(기존 관례 준수)이 유효한 값이다.

서로 다른 서비스 형태에서 성립함을 확인한다:

- **그린필드 React SPA** — 패턴 `fsd`, 레이어 맵이 하네스 기본 어휘(`entities`/`features`/
  `widgets`/`shared`), 라이브러리 전부 `proposed`, 미결정은 대안이 갈리는 항목만
- **기존 모노레포의 패키지(브라운필드)** — 패턴 `existing`, 레이어 맵과 라이브러리 대부분
  `measured`(실측 트리·`integration-overlay.json`에서), 하네스 기본 어휘와 다른 디렉토리
  이름이 그대로 기록됨. 제안은 전부 미결정으로 올라감
- **아키텍처 관례가 없는 기존 앱** — 패턴 `existing`, `layerMap`이 부분적이거나 비어 있고
  그 사실 자체가 기록됨. 없는 관례를 지어내지 않는 것이 유효한 산출이다

**진실 검증 수준: 명명 수준.** 위 세 형태는 스키마가 표현 가능함을 보인 것이고, 실제 산출물이
유용한지는 아직 실측되지 않았다 — Stage 0의 관측 목적이 정확히 그것이다. eval fixture로
검증되기 전까지 이 계약은 "형태를 담을 수 있다"까지만 주장한다.

### 수용 기준이 없을 때 (실사용 발견, 2026-08-26)

기획 없이 기존 코드만 있는 상태에서는 `feature-plan.md`가 없어 참조할 FEAT/TC가 없다. 이때:

- `acceptanceSource: "absent"`, `acceptanceRefs: []`로 적고 **부재를 본문에도 명시한다**
- 그 상태의 설계 결정은 **검증 대상이 없는 채로 확정된다**는 사실을 함께 적는다 — 설계는
  할 수 있지만 그것이 맞는지 판정할 기준이 없다
- 수용 기준을 여기서 지어내지 않는다(§1). 필요하면 feature-plan을 선행하라는 것이 답이다

**Stage 1 전제조건**: 잠금 아티팩트로 승격할 때 `acceptanceSource: "absent"`를 허용할지
결정해야 한다. 허용하면 검증 기준 없는 스팩이 잠기고, 불허하면 기획 없는 브라운필드 개선이
막힌다. 이 판단은 Stage 1의 몫이며 여기서 미리 정하지 않는다.

## 5. 스팩 잠금 (Stage 1)

결정이 전부 확정되면 잠근다. 잠금은 **협업 계약**이다 — 여러 사람이 같은 스팩에 맞춰
개발하려면 그 스팩이 개발 중에 흔들리지 않아야 하고, 이 필요는 모델 능력과 무관하다.

```bash
node .claude/scripts/lock-spec.mjs --project-root {project-root}
```

stdout을 `_workspace/03_dev/spec-lock.json`에 그대로 저장한다 — `project-profile.json`·
`web-execution-plan.json`과 같은 관례다. 스키마는 `.claude/schemas/spec-lock.schema.json`.

**어떤 에이전트도 이 파일을 소유하지 않는다.** 따라서 구현 에이전트의 스팩 자기수정이
**Edit/Write 채널에서** 차단된다 — 차단의 실체는 `ORCHESTRATOR_AUTHORED_ARTIFACTS`(비강제
명세)가 아니라 소유권 훅의 default-deny다. Bash 채널과 메인 스레드는 훅 밖이며 이는
protected-core에 기등록된 한계다.

**잠금 거부(fail-closed)**

- `status: "open"`인 미결정이 **하나라도** 있으면 잠기지 않는다 — 착수 전 확정이 전제다.
  확정하거나 `ASSUMPTION`으로 기록해야 한다
- 결정 블록 부재·중복(정본이 모호)·JSON 오류
- `acceptanceSource`와 `acceptanceRefs`의 자기 모순
- `architecture.rationale` 부재 — 무엇을 골랐는지만으로는 잠글 수 없다

**거부하지 않고 라벨로 표기하는 것**

수용 기준이 없으면(`acceptanceSource: "absent"`) `specTier: "unverifiable"`로 잠긴다.
설계는 확정됐으나 맞는지 판정할 기준이 없다는 뜻이다. 기획 없는 브라운필드 개선을 막지
않으면서 그 상태를 숨기지도 않는다 — 이 tier를 게이트가 어떻게 다룰지는 **Stage 2의 결정**이다.

**staleness**: 잠금은 유래한 입력의 해시를 함께 담는다. 입력이 바뀌면 stale이며
`isSpecLockStale()`이 판정한다. 부재였던 입력이 생긴 것도 변경이다.

**Stage 1의 한계(정직 표기)**: 잠금이 생기고 검증되지만 **아직 아무 게이트도 이것을 읽지
않는다**. 게이트 전환은 Stage 2다.

## 6. Stage 0에서 하지 않는 것

- 이 산출물로 무엇도 차단하지 않는다
- `layerMap`·`moduleBoundaries`를 근거로 **다른 에이전트의** 소유권 경로를 바꾸지 않는다 —
  레이어 맵은 기록만 되고 소비자가 없다(설계자 자신의 산출 경로 등록은 이 변경에서 완료)
- `project-profile.json`을 대체하지 않는다 — 프로필 해석은 지금 경로 그대로다
- 빌더 파이프라인 순서를 바꾸지 않는다

위 넷 중 하나라도 하면 Stage 0이 아니다.
