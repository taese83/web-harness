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

## 0-1. 진입 경로 — 스팩은 언제 서는가

스팩 확정은 사용자가 따로 실행하는 명령이 아니다. 작업이 들어온 그 시점에 붙는다.

| 진입 | 기획 | 디자인 | 스팩 |
|---|---|---|---|
| **그린필드** | 필요 | 필요 | 요청·기획에서 **추론**(`inferred`)해 세운다 |
| **브라운필드 첫 작업** | — | — | 기능 작업 **전에** 기존 코드를 **실측**(`measured`)해 세운다 |
| **기능 추가** | 필요 | 필요 | 갱신 — 새 레이어·라이브러리·형태가 생기면 재확정한다 |
| **단순 수정**(bug-fix·refactor) | 건너뜀 | 건너뜀 | 없으면 실측해 만든다. 있고 바뀔 게 없으면 그대로 쓴다 |

단순 수정에서 기획·디자인을 건너뛰는 것이 **스팩까지 건너뛰는 근거는 아니다** — 소유권 경계가
거기서 나오므로 스팩이 없으면 경계도 없다. 반대로 스팩이 이미 있고 이번 변경이 레이어·라이브러리·
형태를 건드리지 않으면 재확정하지 않는다(재확정은 receipt를 stale로 만든다, §6).

## 1. 두 층 — 고정 기반과 유동 선택

스팩은 **고정되는 것**과 **서비스마다 달라지는 것**을 구분해 담는다. 이 구분이 무너지면
유동 선택을 기반처럼 강요하거나(범위가 좁아진다) 기반을 매번 재결정하게 된다(일관성이 없어진다).

| 층 | 성격 | 담는 곳 |
|---|---|---|
| **원칙** | 프로세스 법 — test-first·증거 요구·안전 하한 | `docs/protected-core.md`가 소유. **스팩에서 재선언하지 않는다** |
| **고정 기반** | 도구 substrate — 패키지 매니저·번들러·테스트 러너·언어·lint·formatter·e2e | `constitution.substrate` |
| **유동 선택** | 서비스마다 답이 다른 것 | `targetShape`·`architecture`·`layerMap`·`libraries`·`communication`·`concurrency`·`moduleBoundaries` |

**고정 기반은 기본 제공 + 브라운필드 실측 우선이다.** 하네스가 `.claude/substrate-defaults.json`으로
기본값을 주고, 프로젝트가 지정하지 않은 키만 그 값으로 채워진다(`source: "default"`).

- `measured` — 기존 코드에서 실측했다. **기본값을 이긴다**
- `declared` — 기본값을 의도적으로 덮어쓴다. **`rationale` 필수** — 이탈은 판단이므로 근거가 남아야 한다.
  실측 근거 없이 기본값을 벗어나면 rationale만으로 확정하지 말고 §4로 제시한다 — 고정 기반의
  이탈 문턱이 유동 선택보다 낮아선 안 된다
- `default`라 적으면서 값이 기본값과 다르면 거부한다(`SUBSTRATE_DEFAULT_MISMATCH`)

**`targetShapes`는 필수이고 배열이다.** 하나의 패키지가 **라이브러리이면서 CLI인 것이 정상
패턴**이다(`exports` + `bin`의 dual entry point). 하나로 강제하면 나머지 절반의 검증을 잃으므로
검사 세트는 선언된 형태의 **합집합**이 된다. `web-app`·`library`·`cli` 등 열린 문자열이다.

**형태는 기계로 대조된다**(§7). 대조 없이 형태가 게이트를 고르면 **형태 자기보고 하나로
검증 세트 전체를 회피**할 수 있다. 다만 대조는 **모순 검출**이지 결정 수단이 아니다 —
형태를 정하는 것은 아래 근거 순서다.

**한계(미해결, protected-core §4가 정본)**: `substrate-defaults.json`은 네 곳 중 단일 소스가
아니고, 기본값이 web-app 기준이라 `library`·`cli`에도 `e2e: playwright`가 default로 채워진다 —
형태에 맞지 않는 기본값은 `measured`·`inferred`·`declared`로 덮어써야 한다.

## 2. 무엇을 담고 무엇을 담지 않는가

이 구분이 계약의 핵심이다. 지키지 않으면 산문 파이프라인을 다른 파일로 옮긴 것뿐이다.

**담는다 — "무엇이 참이어야 하는가"**

| 항목 | 내용 |
|---|---|
| 아키텍처 패턴 | FSD · 레이어드 · 도메인 모듈 · 기존 관례 준수 중 무엇이며 **왜** |
| 레이어 맵 | 논리 레이어 → 실제 경로. 브라운필드는 `integration-overlay.json` 실측이 우선 |
| 라이브러리 결정 | 데이터 계층·상태·폼·mock·UI 레인. 각 항목에 대안과 선택 사유. **확인된 부재도 결정이다**(§5 `measured-absent`) |
| 모듈 경계 | 병렬 작업이 서로 침범하지 않을 쓰기 범위 후보 |
| 수용 기준 참조 | `feature-plan.md`의 FEAT/TC ID — **여기서 새로 만들지 않는다**. 부재하면 §5 `acceptanceSource`로 그 사실을 명시한다 |
| 데이터 계약 참조 | `api-schema.md` · `state-contract.md` — 참조만, 복제 금지 |
| 비목표 | 이번 범위 밖임을 명시할 것 |
| 미결정 | 사용자 결정이 필요한 항목 (§4) |

**담지 않는다 — "어떻게 만드는가"**

- 파일 생성 순서, 어떤 빌더가 언제 도는지
- 컴포넌트 트리, 함수 시그니처, 구현 절차
- Phase 1·2 산출물의 복제 (요구사항·화면·토큰은 참조로만)

판단 기준: **그 문장이 검증 가능한 명제인가, 아니면 작업 지시인가.** 후자면 빼라.

## 3. 브라운필드 우선 규칙

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

## 4. 근거 순서와 사용자 왕복

**실측 → 추론 → 질의.** 이 순서가 `source` 티어다.

| 티어 | 언제 | 근거 |
|---|---|---|
| `measured` / `measured-absent` | 브라운필드 | `package.json`·`tsconfig`·env·설정·코드에서 읽는다. 찾아보고 없으면 `measured-absent` |
| `inferred` | 그린필드 | 사용자 요청에서 추론한다 — "라이브러리가 필요해"→`library`, "모바일에 들어가야"→hybrid, "브라우저 확장"→extension |
| `confirmed` | 실측도 추론도 안 될 때 | 사용자에게 물어 확정했다 |
| `proposed` | 위 어느 근거도 없다 | 설계자 제안일 뿐이라고 표기하는 자리 |

**읽을 수 있는 것을 묻지 않는다.** `@scope` + 사내 repository URL이면 사내 배포다.
`build.lib`와 `files: ["dist"]`면 라이브러리다. 이런 것은 추론이지 질문이 아니다.

**질의는 왕복이다 — 설계자가 스스로 닫지 않는다.** 설계자는 서브에이전트라 사용자에게 직접
묻지 못한다. 갈리는 결정은 `openDecisions`에 `status: "open"`으로 남기고 **거기서 멈춘다**.
오케스트레이터가 `interaction-contract.md`에 따라(한 번에 최대 3개, 추천안과 사유 첨부)
사용자에게 묻고, 답을 설계자에게 돌려준다.

- 사용자가 답했다 → `confirmed`
- 사용자가 보류·거부했다 → 추천안을 `assumed`로 확정하고 그렇게 표기한다

`assumed`는 **묻고 나서** 나오는 상태다. 묻지 않고 `assumed`로 적으면 사용자 제시를
건너뛴 것이며, 그 잠금은 "제시했다"를 자기보고로 만든다. `spec.mjs`는 `open`이 하나라도
남으면 확정을 거부하므로 왕복이 기계로 강제된다.

**반드시 올리는 것**: 대안이 실질적으로 갈리는 결정 · 브라운필드 실측과 다른 제안 ·
되돌리기 비용이 큰 결정(디렉토리 구조, 데이터 계층, 형태).
**묻지 않는 것**: 기존 관례가 있고 그것을 따르면 되는 항목은 기록만 한다.

## 5. 기계 판독 가능 블록 (전방 호환)

문서 끝에 결정을 구조화해 한 번 더 적는다. Stage 1에서 이 블록이 스팩 확정 아티팩트로 승격되므로
**형식을 임의로 바꾸지 않는다.**

````
```json web-harness:solution-design
{
  "stage": 0,
  "targetShapes": ["web-app|library|cli|<기타>"],
  "constitution": {"substrate": {"<키>": {"value": "...", "source": "default|measured|declared", "rationale": "declared면 필수"}}},
  "communication": ["rest|graphql|websocket|sse|streaming"],
  "concurrency": ["web-worker|service-worker|worker-thread"],
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
- 수용 기준을 여기서 지어내지 않는다(§2). 필요하면 feature-plan을 선행하라는 것이 답이다

**Stage 1 전제조건**: 스팩 확정 아티팩트로 승격할 때 `acceptanceSource: "absent"`를 허용할지
결정해야 한다. 허용하면 검증 기준 없는 스팩이 잠기고, 불허하면 기획 없는 브라운필드 개선이
막힌다. 이 판단은 Stage 1의 몫이며 여기서 미리 정하지 않는다.

## 6. 스팩 확정 (Stage 1)

결정이 전부 확정되면 확정한다. 스팩은 **협업 계약**이다 — 여러 사람이 같은 스팩에 맞춰
개발하려면 그 스팩이 개발 중에 흔들리지 않아야 하고, 이 필요는 모델 능력과 무관하다.

```bash
node .claude/scripts/spec.mjs --project-root {project-root}
```

stdout을 `_workspace/03_dev/spec.json`에 그대로 저장한다 — `project-profile.json`·
`web-execution-plan.json`과 같은 관례다. 스키마는 `.claude/schemas/spec.schema.json`.

**어떤 에이전트도 이 파일을 소유하지 않는다.** 따라서 구현 에이전트의 스팩 자기수정이
**Edit/Write 채널에서** 차단된다 — 차단의 실체는 `ORCHESTRATOR_AUTHORED_ARTIFACTS`(비강제
명세)가 아니라 소유권 훅의 default-deny다. Bash 채널과 메인 스레드는 훅 밖이며 이는
protected-core에 기등록된 한계다.

**확정 거부(fail-closed)**

- `status: "open"`인 미결정이 **하나라도** 있으면 확정되지 않는다 — 착수 전 확정이 전제다.
  확정하거나 `ASSUMPTION`으로 기록해야 한다
- 결정 블록 부재·중복(정본이 모호)·JSON 오류
- `acceptanceSource`와 `acceptanceRefs`의 자기 모순
- `architecture.rationale` 부재 — 무엇을 골랐는지만으로는 잠글 수 없다

**거부하지 않고 라벨로 표기하는 것**

수용 기준이 없으면(`acceptanceSource: "absent"`) `specTier: "unverifiable"`로 확정된다.
설계는 확정됐으나 맞는지 판정할 기준이 없다는 뜻이다. 기획 없는 브라운필드 개선을 막지
않으면서 그 상태를 숨기지도 않는다 — 이 tier를 게이트가 어떻게 다룰지는 **Stage 2의 결정**이다.

**형태 생략도 대조 대상이다**: 형태가 게이트를 고르므로 **선언하지 않는 것**도 검증을 뺀다.
배포되는 패키지(`private !== true`)에 `bin`이 있는데 `cli`가 없거나 진입점이 있는데 `library`가
없으면 FAIL이다 — 이 검사들은 형태 층이 유일 경로다. `private:true`이면 note로 강등하되 침묵시키지
않는다(형제 패키지가 소비할 수 있다). 카탈로그에 없는 형태는 FAIL이 아니라 `unverifiable`이다 —
하네스가 모르는 것을 프로젝트 실패로 보고하지 않는다.

**원장 결박**: 스팩 확정 시 `spec-ledger.jsonl`에 **스팩 확정 자신의 해시**가 append된다.
`sourceDigest`는 *입력*만 다이제스트하므로 스팩을 사후에 고쳐 써도 잡지 못한다. 원장이
`SPEC_TAMPERED`(사후 수정)와 `SPEC_DELETED`(삭제)를 막는다. 재확정은 정상이고,
원장이 없으면 실패가 아니라 **결박 부재**로 보고된다. **한계**: 원장도 파일이라 함께 지우면
탐지되지 않는다 — 실질 방어는 원장이 git에 커밋되어 삭제가 히스토리에 남는 것이다.

**staleness**: 스팩은 유래한 입력의 해시를 함께 담는다. 입력이 바뀌면 stale이며
`isSpecStale()`이 판정한다. 부재였던 입력이 생긴 것도 변경이다.

## 7. 스팩 정합 검사 (Stage 2a)

확정된 스팩이 **실제와 맞는지** 검사한다. Phase 3 착수 전과 Phase 4 판정 전에 실행한다.

```bash
node .claude/scripts/validate-spec-conformance.mjs --project-root {project-root} --json
```

**왜 게이트 선택 전환보다 먼저인가**: 스팩이 게이트를 고르게 하려면 스팩 자체가 먼저 검증돼야
한다. 검증되지 않은 자기보고에 게이트 선택을 맡기는 것이 검증 약화다. 2a가 서야 2b(형태별
게이트 선택)를 얹을 수 있다.

**FAIL 조건**

- `measured` 주장이 실측과 어긋난다 — libraries가 의존성 선언에 없거나, substrate 도구의
  선언·설정 파일이 둘 다 없다. **이 검사가 없으면 스팩은 자기보고 봉인일 뿐이다**
- `layerMap`이 존재하지 않는 경로를 가리키거나 루트를 벗어난다
- 확정 이후 입력이 바뀌었다(stale) — 재확정이 필요하다
- substrate가 하네스 toolchain pin과 어긋난다

**FAIL이 아닌 것**

- `spec-lock` 부재 → `NO_SPEC`. 스팩은 아직 선택이다
- `specTier: unverifiable` → note. 형식 정합만 확인했고 설계가 옳은지는 판정하지 않았음을 보고
- `proposed`는 대조하지 않는다 — 아직 실측이 아니다

**검증 불가를 침묵하지 않는다.** 근거 규칙이 없는 substrate 키, 패키지 이름 형태가 아닌
`measured` choice는 `unverifiable`로 보고된다 — 모르는 것을 실패로 만들지도, 통과로 만들지도
않는다.

### layerMap이 소유권을 공급한다 (Stage 3)

`layerMap`은 기록에 그치지 않는다. 병렬 에이전트의 **쓰기 경계**가 여기서 나온다.

- 역할(도메인 모델을 만드는 자·라우트를 만드는 자)은 하네스가 고정하고, **그 역할이 어느
  경로를 쓰는지는 스팩이 정한다**. 소유권 강도는 그대로고 어휘만 프로젝트가 정한다
- 스팩이 `layerMap`을 주지 않으면 기존 등록부가 그대로 쓰인다. **FSD를 기본 layerMap으로
  대체하려 했으나 게이트가 회귀를 잡았다**(실측 2026-08-26) — 등록부는 레이어 이름보다 많은
  것을 인코딩한다. 예: `feature-mutation-builder`는 `src/features/*/api/`를 갖되 `live-mode`를
  제외한다(그 영역은 `realtime-data-builder` 소유). 평면 `layerMap`은 이런 carve-out을 표현할
  수 없어 기본값으로 쓰면 두 에이전트의 경계가 무너진다. **"FSD 기본값 제거"는 `layerMap`이
  carve-out을 표현할 수 있게 된 뒤에야 가능하다** — 미해결
- **레이어는 서로 겹치면 안 된다.** `src/`가 `src/pages/`를 삼키는 식이면 스팩을 신뢰하지
  않고 기본값으로 돌아간다 — 넓은 레이어 하나로 남의 영역을 가져가는 권한 확대를 막는다
- `layerMap`이 덮지 않는 소스 디렉토리는 **아무 에이전트도 쓸 수 없다.** 정합 검사가 그
  디렉토리 이름을 들어 보고한다(FAIL은 아니다 — 소유자가 없어도 되는 곳이 있다)

**Stage 2a의 한계(정직 표기)**

- **형태별 게이트 선택이 배선되지 않았다.** `targetShape`는 기록·보고되지만 어떤 검증을
  고를지는 정하지 않는다 — 그것이 2b다
- **기계 소비자가 없다.** 이 검사를 호출하는 것은 이 계약 산문뿐이고 release gate도
  `validate-harness`도 읽지 않는다. **게이트가 아니라 검사기다**
- substrate ↔ toolchain 정합은 7키 중 `packageManager` 1키만 대조한다
- 근거표(`SUBSTRATE_EVIDENCE`)가 수기라 미등록 도구명은 오탐 FAIL 또는 unverifiable이 된다

## 8. Stage 0에서 하지 않는 것

- 이 산출물로 무엇도 차단하지 않는다
- `layerMap`·`moduleBoundaries`를 근거로 **다른 에이전트의** 소유권 경로를 바꾸지 않는다 —
  레이어 맵은 기록만 되고 소비자가 없다(설계자 자신의 산출 경로 등록은 이 변경에서 완료)
- `project-profile.json`을 대체하지 않는다 — 프로필 해석은 지금 경로 그대로다
- 빌더 파이프라인 순서를 바꾸지 않는다

위 넷 중 하나라도 하면 Stage 0이 아니다.
