# 결정론적 껍질 — web-harness 분석 (2026-08-26)

*디자인된 단면 버전은 Claude artifact로 존재한다(링크는 메인테이너에게 문의).*

**범위**: 커밋 49 · `+6,801/−3,364` · 189 파일 · 에이전트 99 → 56
한계 표기의 정본은 `docs/protected-core.md` §4다. 이 문서는 요약이며 그것을 대체하지 않는다.

---

## 1. 지금의 모양 — 여섯 단계와 세 축

흐름은 **기획 → 디자인 → 설계 → 스팩 → 개발 → QA**다. 앞의 넷이 무엇을 만들지 확정하고,
개발은 그 안에서 자유롭고, QA가 증거를 남긴다.

```
기획    8 에이전트   요구사항 · UX · 기능 계획 · 기술 방향
디자인 18 에이전트   디자인 시스템 · 레이아웃 · 컴포넌트 · API 스키마
설계    1 에이전트   system-architect → solution-design.md
스팩    오케스트레이터  spec.mjs → spec.json  (미결정 잔존 시 확정 거부)
개발    2 에이전트   developer · environment-scaffolder
QA     24 에이전트   verifier · reviewer (전부 read-only)
```

**개발이 2종인 것이 이 구조의 핵심이다.** 무엇을 어느 순서로 만들지 지시하지 않는다 — 스팩이
정한 `architecture`·`layerMap`·`libraries` 안에서 모델이 정한다. 병렬 격리는 에이전트 종류가
아니라 `moduleBoundaries`가 공급한다.

`environment-scaffolder`를 분리해 남긴 이유는 하나다: `package.json`의 `scripts`가 **무엇이
검사로 도는지**를 정한다(`resolve-commands`가 거기서 읽는다). 구현자가 그 권한을 가지면
`"lint": "echo ok"`로 게이트를 스스로 끌 수 있다. **검사를 정의하는 것과 통과해야 하는 것은
분리한다.**

### 검증이 셋으로 갈린다

| 축 | 무엇을 답하나 |
|---|---|
| **TC** | 행위가 맞는가 |
| **정합** | 기록이 현실과 맞는가 — **실행이 증명하지 못하는 것만** (layerMap 실존·스팩 원장·형태별 요구 커버리지) |
| **코드리뷰** | 확정된 결정을 따랐는가 — `spec.json`을 읽고 대조 |

정합에서 `measured` 대조를 걷어낸 근거: 빌드가 돌면 vite가 있는 것이고 테스트가 통과하면 그
라이브러리가 있는 것이다. **실행이 증명하는 것을 정적으로 흉내내면 중복이고, 흉내가 어긋나면
오탐이다.**

---

## 2. 무엇이 달라졌나

| 축 | 이전 | 지금 |
|---|---|---|
| 개발 지시 | 22단계 산문 파이프라인이 빌더 순서를 지정 | 모듈 경계마다 `developer` 스폰. 순서 지시 없음 |
| 소유권 근거 | FSD 경로 하드코딩(`src/entities/`·`src/widgets/`) | 스팩의 `layerMap` — 프로젝트 자기 어휘 |
| 병렬 격리 | 에이전트 정체성 | 스폰 범위 = `moduleBoundaries` ∩ 소유권 |
| 진입점 | `/dev-orchestrator` · `/web-orchestrator` 이원 | `/web-orchestrator` 하나. `targetShapes`가 경로를 고른다 |
| 실행 명세 | 어댑터 3종이 `commands`·`tasks` 선언 | `package.json`에서 즉시 판단 + 규칙 4개로 DAG 도출 |
| 스팩 | "잠금"이라는 별도 의식 | 작업 진입에 결박. 미결정 잔존 시 확정 거부 |

### 제거 근거는 전부 실측이었다

- **구조 지시 빌더 6종** — `src/pages/**`를 셋이 겹쳐 갖고, 비-FSD 어휘(`src/stores`·`src/hooks`·
  `src/components`)는 소유자가 아예 없었다. "병렬 작업이 서로 침범하지 않게 한다"는 명분이
  이미 깨져 있었다.
- **도메인 특화 5종** — `packages/analytics-agent/`·`apps/browser-runner/`처럼 **패키지 이름까지**
  처방했다. FSD 경로 처방보다 강하다.
- **조건부 구현 빌더 6종** — 첫 측정이 "겹침 0"으로 나와 유지를 권고했으나 틀렸다. 실사용
  브라운필드 9경로 중 **6개가 무소유**였고 소유된 것 중 하나는 오탐이었다.
- **5범주 밖 26종** — 소스는 `developer`로, 설정·배포·문서는 `environment-scaffolder`로 흡수.
  패키지 이름 처방은 흡수하지 않고 버렸다.

### 실사용 스팩 2건

| 대상 | 형태 | 결과 |
|---|---|---|
| `golden/vite-serverless-hybrid` | `web-app` + `serverless-functions` | 형태 **생략** 우회 발견 |
| `@kakao/ai-chatkit` (사내 SDK) | `library` | 미빌드 오보고 · cwd 오염 · 결속 비대칭 발견 |

2호의 미결정 3건이 **전부 `confirmed`**다 — 1호가 전부 `assumed`였던 것과 대비되며, 질의 왕복이
실제로 작동함을 보인다(1호의 `assumed`는 질문이 사소해서가 아니라 비대화형 서브에이전트에서
구조적으로 물을 수 없었기 때문이다).

---

## 3. 업계 대조 — "하네스 엔지니어링"이 이름을 얻은 해

2026년 2월 Mitchell Hashimoto의 글 이후 **harness engineering**이 별도 분야로 불리기 시작했다.
핵심 명제가 이 저장소의 전제와 같다 — *LLM의 지시 준수는 확률적이므로 결정론적 바깥
제약(린터·CI 게이트)과 결합해야 규모에서 신뢰할 수 있다.*

더 구체적으로: **권한·상태·부작용·완료 증명을 런타임 통제로 옮긴다.** 모델은 여전히 어떻게
풀지 고르지만 *스스로 권한을 넓히거나, 낡은 복구 상태를 믿거나, 현재 증거 없이 성공을 선언할
수 없다.*

| 항목 | 업계 2026 | web-harness | |
|---|---|---|---|
| 결정론적 게이트 | 린터·CI를 확률적 모델 바깥에 둔다 | 검증 스크립트 39 · CI 테스트 40 | 일치 |
| 완료 증명 | 현재 증거 없이 성공 선언 불가 | receipt + `sourceFingerprint` + 24h 신선도 | 일치 |
| 권한 확대 차단 | 런타임이 권한을 소유 | PreToolUse 훅 default-deny · 스팩 유래 소유권 | 일치 |
| 오케스트레이터-워커 | 워커는 좁은 브리프 + 격리 컨텍스트 | 스폰 범위 = `moduleBoundaries` | 일치 |
| 배포 관심사 분리 | Score·OAM — 워크로드 스펙과 배포를 분리 | 배포 메타를 receipt 결속에서 제거 | 일치 |
| **게이트의 반증** | 논의 거의 없음 | 게이트를 무력화해 테스트가 실패하는지 CI에서 확인 | **앞섬** |
| **한계 등록부** | 논의 거의 없음 | §4에 프록시·우회·미해결 59행. 커밋마다 `JUDGMENT:` | **앞섬** |
| 빌드 provenance | SLSA L2 — provenance를 빌드 스크립트가 아니라 플랫폼이 생성 | 설계 일치(호스트 receipt는 릴리스 증명 불가, 보호 CI 컨텍스트 결속). **실증 0 — CI 배선 미완** | 미실증 |
| 실행 격리 | CodeAct — 호출당 micro-VM | `argv-only` + `--ignore-scripts` 수준 | 뒤짐 |
| 결과 효능 | SWE-bench류 벤치마크로 측정 | **미측정** | 뒤짐 |

업계가 "무엇을 게이트로 둘까"를 논의하는 동안 이 저장소는 **"그 게이트가 실제로 발화하는가"**를
기계로 묻는 데까지 갔다. 오늘 두 번 확인했다 — 검증 호출을 지워도 CI가 통과했다. 테스트가
라이브러리를 직접 부르고 **배선 지점을 지나가지 않아서**다.

---

## 4. 정직하게 남는 것

**결과 효능은 여전히 미측정이다.** 오늘 만든 것 중 "더 나은 결과를 낸다"고 말할 수 있는 건
없다. 말할 수 있는 건 **결함을 찾는다**뿐이고, 오늘 찾은 것만 열 건이 넘는다.

**순증 6,801줄 중 얼마가 지워질지 모른다.** 오늘 만든 것 하나를 두 시간 만에 스스로 철회했다 —
필드 소유권은 `package.json` 소유자를 5종에서 1종으로 줄이자 가를 대상이 사라졌다.

**측정이 세 번 틀렸고 전부 같은 이유였다** — fixture가 검사 대상과 전제를 공유했다.

```
FSD 경로로 FSD 소유권 측정     → "겹침 0" 오판
web-app 어댑터로 등가성 측정    → library 경로 누락(도출이 loud fail)
정적 등록부로 소유 측정         → layerMap 파일 항목 무소유 미발견(실사용 스팩의 1/3)
```

세 번 다 **실사용 스팩으로 다시 재서** 잡혔다.

**어댑터 삭제가 미완이다.** `validate-release-fixtures` 1,422줄 중 단언 74/97이 프로필에 물려
있어 그 스캐폴딩을 다시 써야 한다.

**서명 provenance는 "뒤짐"이 아니라 "미실증"이다(2026-08-26 조사로 정정).** `quality-attestation-lib`이
SLSA L2와 같은 축을 이미 갖추고 있다 — 호스트 receipt는 릴리스 증명 대상이 아니고, 보호 CI
컨텍스트 6종은 빌드 스크립트가 위조할 수 없다. 보호 컨텍스트 부재 시 릴리스가 3건으로
fail-closed임을 실측했다. **공백은 배선이다** — CI 워크플로가 보호 컨텍스트를 하나도 주입하지
않고, `quality-attesters.json`이 없고, 실제 서명 증명이 0건이다. 아침의 스팩 확정과 같은
상태이며 처방도 같다(실사용 1호). 로컬에서 서명을 만들 수 없는 것은 결함이 아니라 설계다.

**실행 격리가 얇다.** `argv-only`는 하네스→pnpm 경계만 지키고 그다음 셸은 프로젝트 자기
script다. 업계가 micro-VM으로 가는 것과 차이가 크며, 이 저장소의 위협 모델에서 그게 필요한지는
아직 판단하지 않았다.

---

## 출처

- [Harness Engineering for AI Coding Agents](https://www.augmentcode.com/guides/harness-engineering-ai-coding-agents)
- [Agent Harness Engineering: The Rise of the AI Control Plane](https://medium.com/@adnanmasood/agent-harness-engineering-the-rise-of-the-ai-control-plane-938ead884b1d)
- [Microsoft Agent Framework at BUILD 2026](https://devblogs.microsoft.com/agent-framework/microsoft-agent-framework-at-build-2026-announce/)
- [Score vs OAM](https://score.dev/blog/score-vs-open-application-model-kubevela/)
- [SLSA Build Provenance](https://slsa.dev/spec/draft/build-provenance)
