# Web Harness

Claude Code로 웹 애플리케이션을 만드는 컨트롤 플레인 — 기획 → 디자인 → 구현 → QA →
인수인계까지, skill과 subagent로 구동된다.

> English documentation: see [README.md](README.md). 이 문서는 현재 README.md를 베이스로 한
> 한국어 번역이다. contract 본문 다수는 아직 한국어이며, 번역 현황은 아래 [문서 언어](#문서-언어)
> 절을 참고하라.

## 이게 실제로 무엇인가

대부분의 agent scaffolding은 모델이 코드를 더 빨리 쓰도록 돕는다. 이것은 다른 문제를 중심으로
설계됐다: **agent가 끝나지 않은 일을 끝났다고 보고하는 것을 막는다.**

harness는 당신과 agent 사이에 놓인 계약·소유권 규칙·기계 게이트의 묶음이다. 핵심 규칙은
**주장은 증거가 아니다**라는 것. 빌더가 "store를 구현했다"고 말해도, 파일이 존재하고 파싱되며
빌더가 실행되기 *전에* 고정된 계획과 일치하기 전까지는 아무 의미가 없다.

이게 오버헤드처럼 들린다면, 맞다 — 의도적으로 그렇다. 산출물이 조각(snippet)이 아니라 실제
서비스일 때 이 트레이드오프는 값어치를 한다.

## 채택 비용

정직하고 기계로 검증된 수치 — 하나라도 드리프트하면 ratchet이 빌드를 실패시킨다.

- **당신*이* 읽는 것**: 이 README + [docs/quickstart.md](docs/quickstart.md). 이게 사람 온보딩
  경로의 전부다. ~110개 계약 문서는 *agent가* 필요할 때 읽지, 당신이 읽지 않는다.
- **오케스트레이터 실행당 고정 계약 로드**: 28,291 bytes <!-- inventory:entry-cost --> 의
  always-read 계약 파일. 이는 바로 그 파일들의 *바이트* 측정이다 — bytes/3 기준 약 9k 토큰,
  토큰 카운트가 아니라 근사치다. skill 파일 자체(~9k 토큰), 스폰당 agent 정의, 런타임 훅 주입,
  그리고 필요할 때 로드되는 모든 것을 의도적으로 **제외**한다 — 그러니 이것은 총 컨텍스트 비용이
  아니라 한 차원의 하한으로 취급하라. always/on-demand 구분은 `<!-- always-read -->` 앵커로
  선언되며, 참조 개수와 바이트 크기 둘 다 ratchet된다: 증가하면 누군가 JUDGMENT 기록과 함께
  baseline을 갱신하기 전까지 빌드가 실패한다.
- **앱당 토큰 비용**: 추정이 아니라 측정. 참조 파일럿 — intake에서 T0 receipt까지 간 중형 SPA
  — 은 **~90 스폰에 걸쳐 약 12.7M 토큰**을 썼고, 스폰의 ~11%가 재시도를 필요로 했다. (그 파일럿의
  종료 시점 기준이며, telemetry 파일은 후속 작업으로 계속 누적되므로 이것을 라이브 카운터가 아니라
  기록된 자릿수로 취급하라. 정본 기록은 `docs/efficacy/greenfield-pilot-2-protocol.md` 부록 A.)
  이것이 정직한 헤드라인이다 — harness는 증거를 사는 것이고, 증거는 비싸다. 몇 분 만에
  프로토타입을 원한다면 프로토타입 툴을 쓰라; 이것은 "다 된 것처럼 보인다"로는 충분하지 않을 때를
  위한 것이다.

## 5분 만에 시작하기

**첫 앱을 만드는가?** **[docs/quickstart.md](docs/quickstart.md)**로 시작하라 — 플러그인 설치,
첫 생성 앱, 정직한 비용 기대치, 브라운필드 경로. 아래 명령은 *harness 자체*를 검증한다(기여자 경로):

```bash
nvm use
pnpm install --frozen-lockfile
pnpm run ci
```

green 실행은 다음을 검증한다:

- 31 skills <!-- inventory:skills -->
- 99 agents <!-- inventory:agents -->
- 3개 built-in 프로필: `vite-serverless-hybrid`는 `certified`, `react-vite-spa`·`next-app-fullstack`은
  `compatible`. `certified` 라벨은 격리-CI 증거(`validate-certified-evidence`)에 기계로 결박돼
  있다 — hybrid 레인의 receipt는 `golden/vite-serverless-hybrid/_workspace/04_qa/t1-summary.json`
  (격리 `hybrid-t1` 워크플로 run 32614388125, 2026-08-23, `ISOLATED_VERIFIED`). T1은 기계 하한이며
  T2 서명 attestation은 별도다
- agent별 파일 소유권
- read-only verifier 경계
- 문서 위생(깨진 repo-path 참조, 하드코딩 잔재, skill 버전, README 인벤토리)
- 전역 Bash 정책 fixture, 프로필 resolver/DAG 단언, Next.js 계약 케이스, harness 통합 검사,
  web·AI eval 계약, AI secret/tool 안전 훅, 그리고 Console의 정적 검사·회귀 테스트

위 skill/agent 수치는 `validate-harness.mjs`가 실제 디렉터리와 대조하는
`<!-- inventory -->` 마커를 달고 있어, 이 README가 조용히 stale해질 수 없다.

### Claude Code 플러그인으로 설치

```
/plugin marketplace add https://github.com/taese83/web-harness-plugin
/plugin install web-harness@web-harness-marketplace
```

그런 다음 아무 프로젝트 디렉터리에서 `/web-harness:web-orchestrator`,
`/web-harness:web-plan`, `/web-harness:web-console`를 실행하라.

비용 참고: 플러그인은 세션당 약 10k 토큰의 always-on 컨텍스트를 더한다. 쓰지 않을 때는 비활성화하라.

## 작업 흐름

```
Phase 1  기획          requirements, UX, feature plan, tech stack   → project brief
Phase 2  디자인        design system, layout, components, API       → 승인 표면
         ── 승인 게이트: 이것 없이는 아무것도 진행하지 않는다 ──
Phase 3  구현          scaffolding, domain state, components, routes
Phase 4  QA            code, UX, security, browser, performance, state verifier
         Release       인수인계 문서
```

이것이 프롬프트 체인과 다른 두 가지:

**승인 게이트는 실재한다.** 구현이 시작되기 전에 승인할 동작하는 표면을 받는다 — 그린필드
프로젝트는 인터랙티브 프로토타입, 브라운필드는 *라이브 델타*(실행 중인 dev server 위에 변경분만
주입). 승인은 소스 스펙의 digest와 함께 기록된다; 이후 스펙이 바뀌면 승인이 `STALE`이 되고 재승인
전까지 Phase 3이 차단된다.

**승인된 내용이 구현의 입력이다.** 당신이 승인한 바로 그 test-case ID가 구현 후 검증되는 ID다.
승인·구현·검증은 기억이 아니라 식별자로 연결된다.

## 소유권과 안전

모든 agent는 선언된 파일 소유권 범위를 갖고, 훅이 이를 강제한다. component builder가 당신의 빌드
설정을 조용히 다시 쓸 수 없다. verifier agent는 read-only다 — 문제를 찾을 수는 있으나 통과하도록
"고쳐" 넣을 수 없다.

전역 Bash 정책이 agent가 실행할 수 있는 명령을 제한한다: 검증 스크립트는 인자 수준 계약과 함께
allowlist되고, 그 밖의 것은 best-effort 허용이 아니라 거부된다.

## Runaway 방지

스폰이 서비스 규모에서 실패할 때, 대개 같은 방식으로 실패한다: 스펙을 재독하는 데 130–170k 토큰을
쓰고 산출을 끝내기 전에 종료된다. 전체 서비스 파일럿(22 스폰, 기획~구현)의 스폰당 telemetry는 실제
비율을 **22개 중 3개 미완 스폰 — 토큰의 15%**로 놓고, 전부 나머지만 재스폰해 복구됐다. 즉 이것은
상수가 아니라, 실제 비용을 가진 실제 실패 모드다.

세 개의 기계 게이트가 이를 다룬다:

| 게이트 | 하는 일 |
|---|---|
| `validate-spawn-plan.mjs` | 산출을 너무 많이 선언하거나 스펙 읽기 표면이 너무 크면 스폰이 실행되기 *전에* 거부 |
| `verify-spawn-completion.mjs` | 스폰이 산출을 남기지 않거나 파일을 편집 도중 절단된 채 남기면 실패 |
| `resume-manifest.mjs` | 선언된 각 산출을 done/truncated/missing으로 분류해 나머지만 재스폰 |

스폰 전 계획을 잠글 수 있고(`--lock`), digest는 append-only 원장에 기록된다. 이후 매니페스트를
줄여 완료를 위조하는 것은 `TAMPERED`로 잡힌다.

정직한 범위: 이 게이트들은 측정된 실패에 맞춰 교정됐으나, 실제로 runaway 비율을 *낮추는지*는 아직
측정되지 않았다. 알려진 모든 프록시와 그 한계는 [docs/protected-core.md](docs/protected-core.md)
§4를 보라.

## 비용

토큰 사용은 추정이 아니라 스폰당 기록된다. 런타임이 usage를 보고하지 않으면 필드는 `null`로 쓴다는
것이 계약에 명시돼 있다 — **값을 추측하거나 채워 넣지 않는다**. 전체 서비스 파일럿 하나(기획 →
디자인 → 구현)에서:

| Phase | 스폰 | 토큰 | 비중 |
|---|---|---|---|
| 기획 | 10 | 844,039 | 30% |
| 디자인 | 6 | 1,130,234 | 40% |
| 구현 | 6 | 831,449 | 30% |
| **합계** | **22** | **2,805,722** | |

가장 큰 단일 스폰은 473k의 design-preview 빌더 — 구현이 시작되기 전 당신이 승인하는 인터랙티브
프로토타입을 만드는 agent다. 비용은 재작업 위험이 가장 높은 곳에 집중되며, 이는 낭비가 아니라 의도된
배분이다.

이 계측은 harness에 대한 주장이 자기 기록과 대조될 수 있도록 존재한다. 이미 이 README의 과장된
실패율 주장을 바로잡는 데 쓰였다.

## 정직성을 설계 제약으로

repository는 어떤 검사가 증명이 아니라 **프록시**인 모든 지점을 등록부로 유지한다 — 실제로 무엇을
검증하는지, 어떻게 게이밍됐는지, 무엇이 미해결로 남았는지. 약점이 발견되면 항목이 추가되며,
harness 자신의 게이트에서 발견된 약점도 포함한다. `docs/protected-core.md` §4가 그 등록부이며,
불편한 읽기를 의도한 것이다.

비협상: 로컬에서 서명 증거를 위조하지 않는다, 폐곡선을 닫으려 게이트를 약화하지 않는다, 증명 없이
성숙도 tier를 승격하지 않는다.

## 디렉터리 구조

```
.claude/            정본 소스 — skills, agents, scripts, evals, schemas
docs/               protected-core(불변식 + 프록시 등록부), 채택 가이드
packages/           Web Harness Console(로컬 승인 UI)
```

`.claude/`가 유일한 정본이다. (구 `.agents/`/`.codex/` 툴 미러는 감사에서 소비자 0이 확인돼
2026-08-18 제거됐다 — `.codex` 훅이 Claude 전용 환경변수를 참조하고 있어, 다른 어떤 툴에서도 실행된
적이 없음을 증명했다. 특정 툴 통합이 나중에 필요하면, 그 툴의 실제 형식으로 생성될 것이다.)

## 한계

- **문서는 대체로 한국어다.** skill·agent *description* — 모델이 라우팅하는 근거 — 은 영어이나,
  대부분의 계약 본문은 아직 번역되지 않았다.
- 빌더는 여전히 서비스 규모에서 오케스트레이터가 개입해야 할 만큼 자주 runaway한다; 게이트는
  그것을 잡지만, 막지는 못한다.
- SSR(Next.js), strict-CSP dev server, Shadow DOM은 라이브-델타 프리뷰에서 명명됐으나 미검증
  표면이다.
- 임계값(output fan-out, read budget)은 단일 파일럿 서비스에서 교정됐으며, 형태가 다른
  프로젝트에서는 재교정이 필요하다.

## 문서 언어

지금까지 한 것:

1. **Validator를 언어 독립적으로.** 여러 게이트가 한국어 문자열 마커(`항상 … 읽는다`,
   `## 일반화 근거` 등)에 키를 걸고 있었다. 본문을 먼저 번역했으면 그 정규식이 매칭을 멈췄을
   것이고 — 대부분 "마커 부재"를 통과로 취급했으므로, CI는 green인 채 게이트가 조용히 꺼졌을 것이다.
   이제 한국어·영어·중립 `<!-- always-read -->` 앵커를 모두 받아들이며, baseline이 마커를 기대하는
   곳에서 마커가 사라지면 조용한 통과가 아니라 실패다.
2. **이 README** — 현재 README.md를 베이스로 한 한국어 번역이며 [README.md](README.md)와 병행 유지된다.

아직 안 됐고, 단순 번역 작업이 아닌 것:

agent와 skill 본문은 여전히 한국어다. 파일 종류별로 번역할 수 없는데, **11개의 백틱 인용 한국어
토큰이 파일 간에 매칭되는 기능적 식별자**이지 산문이 아니기 때문이다 — `주 소비자`와 `담당 범위`는
26개 agent 정의에 나타나며 sharded-artifact 읽기 프로토콜과 대조되고; `ASSUMPTION(시안 확정)`은
design readiness 계약과 대조된다. agent만 번역하면 반쪽 한국어로 남거나, 계약이 따라올 때까지 파일
간 매칭이 조용히 깨질 것이다.

그래서 실제 마이그레이션 단위는 **마커 클러스터** — agent 하나와 그 리터럴을 공유하는 모든 계약 —
를 그것들을 검사하는 validator와 함께 옮기는 것이다. 이는 번역 패스가 아니라 리팩터이며, 아직
시작되지 않았다.

실무적 의미: 채택에 가장 큰 영향을 주는 표면 — 모델이 라우팅하고 메뉴가 보여주는 agent·skill
`description` 필드 — 은 이미 영어이며, 이 README도 그렇다. 한국어로 남은 것은 agent를 감사하거나
커스터마이즈할 때 읽을 지시 상세다.

## 더 읽기

- [docs/protected-core.md](docs/protected-core.md) — 불변식 I1–I6과 프록시 등록부
- [docs/brownfield-adoption.md](docs/brownfield-adoption.md) — 기존 코드베이스에 채택하기
- [docs/competitive-landscape.ko.md](docs/competitive-landscape.ko.md) — 2026 툴 지형에서의 위치와 실제 차별점
- [docs/field-guide-gap.ko.md](docs/field-guide-gap.ko.md) — 에이전트 엔지니어링 10개 패턴을 이 코드베이스와 대조, 항목별 근거
- [CLAUDE.md](CLAUDE.md) — 이 repository의 변경에 적용되는 판단 게이트
