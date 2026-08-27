# 경쟁 지형 — 증거 게이트 vs 지형

*2026년 8월 작성. 이 분석의 디자인된 단일 페이지 버전이 비공개 Claude 아티팩트로 있다 —
링크는 메인테이너에게 문의. [competitive-landscape.md](competitive-landscape.md)의 한국어판.*

이제 거의 모든 AI 코딩 툴이 테스트를 돌리고 반복한다. 지형 전체는 **단 하나의 축 —
검증 경계에서 무슨 일이 일어나는가 — 로 갈린다**: "통과했다"를 자기 채점하는가, 사람이나
기존 CI에 넘겨 게이트하는가, 아니면 증거 없이는 전진을 거부하는 기계 강제 승격인가?
web-harness는 마지막 위치에 프로덕션 툴 수준에서 사실상 홀로 서 있다. 다만 그 *아키텍처*는
주류이고, 유일한 풀-SDLC Claude Code 플러그인도 **아니다**. 이 문서는 둘 다 정직하게 다룬다.

## 검증 스펙트럼

툴은 **기본** 정본 판정으로 배치했다.

| Tier | 신호 | 게이트 | 툴 |
|---|---|---|---|
| 0 · 프리뷰 | 렌더 = 끝 | 라이브 프리뷰 + 사람 PR 리뷰 | v0, bolt.new |
| 1 · 자기 채점 | 자기 테스트 루프 | 에이전트가 자기 검사를 만족 | Replit Agent 3, Lovable, Cursor 2.0, Windsurf, Devin, OpenHands, SWE-agent, Aider, gpt-pilot |
| 2 · 위임 게이트 | 구조적 사람 게이트 | 브랜치 보호 + 필수 사람, 고객 자신의 CI 위에서 | GitHub Copilot 코딩 에이전트, Google Jules |
| 3 · 증거 게이트 | 증거 승격 | 서명 receipt · 격리 실행 · 증명 없인 승격 없음 | **web-harness** (프로덕션 유사 선례 없음) |

Replit Agent 3(가장 강한 자기 테스트, REPL + Playwright)조차, 그리고 Copilot(구조적으로
사람 게이트를 강제)조차 "테스트를 시도한 뒤 수락/거부 결정을 위임"에서 멈춘다.
증명-이-승격의-전제라는 지점에 web-harness가 홀로 선다.

## 마스터 매트릭스

4개 카테고리 대표 툴. ● 있음 & 강제 · ◐ 옵트인 패턴으로 가능 · ○ 못 찾음.

| 축 | 앱 빌더 (v0 · bolt · Lovable) | 자율 SWE (Devin · Copilot · OpenHands) | MA 프레임워크 (LangGraph · CrewAI · MAF) | 스펙 주도 (Spec Kit · Kiro · BMAD) | web-harness |
|---|:---:|:---:|:---:|:---:|:---:|
| 테스트 실행·반복 | ◐ 반응형 | ● | ◐ 직접 배선 | ◐ 에이전트 경유 | ● |
| 증거 기반 릴리스 게이트 | ○ | ○ 사람/CI | ○ | ○ | ● |
| 서명 receipt / tier | ○ | ○ | ○ | ○ | ● |
| 생성자 ≠ 검증자 | ○ | ◐ Devin 리뷰어 | ◐ 패턴 | ◐ QA 페르소나 | ● 구조적 |
| 반-게이밍 불변식 | ○ | ○ | ○ | ○ | ● |
| 스펙 → 구현 추적성 | ○ | ○ | ○ | ● 코어 | ● 같은 TC-ID |
| runaway 제어 | ◐ | ◐ 반복 상한 | ● 상한 | ◐ | ● 스폰 전 fit-gate |
| 지연 / 단계 디스패치 | ○ 단일 루프 | ◐ | ● | ◐ | ● 46 에이전트, 시점 로드 |
| 웹앱 특화 | ● | ○ 범용 | ○ 범용 | ○ 범용 | ● |

## 주류 아키텍처, 독특한 규율

### web-harness가 공유하는 것 (해자 아님 — 2026 주류다)

- **다중 에이전트 역할 분해.** MetaGPT(~5역할), gpt-pilot(Tech Lead → Dev → Reviewer),
  CrewAI / LangGraph / MAF는 조립형.
- **생성자 ≠ 검증자, 패턴으로.** ChatDev, gpt-pilot, SWE-agent, LangGraph evaluator-optimizer
  — 대개 같은 모델 계열, 강제는 드묾.
- **스펙 / 계획 우선.** 스펙 주도 개발이 *2026의* 방법론 — Spec Kit(11만★), Kiro, BMAD,
  Lovable Plan Mode.
- **runaway 상한.** Claude Agent SDK가 depth / concurrency / 예산 / turn 상한을 기본 탑재.
- **풀-SDLC Claude Code 플러그인.** closedloop-ai와 agentic-sdlc가 이미 품질 게이트 QA 루프를
  배포. web-harness가 유일하지 않다.

### 독특한 것 (프로덕션 툴에 유사 선례 못 찾음)

- **증거 tier + 서명 attestation을 승격 통화로.** T0→T2, Ed25519 서명. 어떤 프로덕션 툴도
  이렇게 릴리스를 게이트하지 않는다.
- **반-게이밍 불변식을 등록 규율로.** 프록시 등록부, "검증 약화로 폐곡선 닫기 금지",
  "증명 없는 tier 승격 금지." 프런티어 reward-hacking 문제를 eval 벤치마크가 아니라
  거버넌스 계약으로 적용.
- **같은 TC-ID 재검증.** 프리뷰에서 승인된 TC를 구현에서 동일 기계 ID로 재검증 — BMAD의
  "vision→code" 추적보다 조임.
- **저자 자기 도그푸드 감시.** 메인테이너가 하네스를 우회하면 감지. 유사 선례 없음.

## 포지셔닝을 가르는 네 대조

### 1. Claude Agent SDK — 토대 (모두 가능케, 아무것도 강제 안 함)

web-harness는 **바로 이 프리미티브 위에** 지어졌다: 컨텍스트 격리 서브에이전트, 에이전트별
도구/모델 제한, 지연 디스패치, hooks + permissions, depth/concurrency/예산 상한. SDK는 모든
web-harness 속성을 *가능하게* 하고, 규율 속성은 아무것도 *강제하지* 않는다.

| 속성 | Claude Agent SDK | web-harness가 더함 |
|---|---|---|
| 생성자 ≠ 검증자 | 관례 — read-only 리뷰어 정의 *가능* | **구조적** — 모든 단계에 read-only 검증자 필수 |
| 승격 게이트 | "증거 필요" 프리미티브 없음 | **receipt 없으면 승격 없음**, 게이트 로직에 강제 |
| 핸드오프 | 프롬프트 in, 요약 out | **파일 계약** + `_workspace` 공용 아티팩트 |
| runaway | depth / concurrency / $ 상한 | + **스폰당** 읽기 토큰·산출 fit-gate |

**정리:** web-harness는 *모두가 공유하는 SDK 위에 얹은 규율 컨트롤 플레인*으로 보는 게
정확 — 또 하나의 프레임워크가 아니다.

### 2. GitHub Spec Kit · AWS Kiro — 방법론 쌍둥이 (스펙 우선, 증거 게이트 없음)

스펙 주도 개발이 가장 가까운 방법론: 실행 가능한 스펙을 정본으로, 스펙 → 계획 → 태스크 →
구현. web-harness의 Plan → Design 단계와 TC 추적성을 거의 그대로 반영한다. 갈라지는 곳은
하류 — SDD는 "스펙이 코드를 이끌었다"에서 멈추고, "코드가 스펙에 대해 자신을 증명했다"까지는
안 간다.

| 차원 | Spec Kit / Kiro | web-harness |
|---|---|---|
| 스펙 = 정본 | 예 — 그게 전부의 논지 | 예 — Plan/Design + `TC-NNN-N` |
| 추적성 | 스펙 → 태스크 → PR | **스펙 → 프리뷰 → 구현, 같은 TC ID 재실행** |
| 검증 | 에이전트 + 사람 리뷰 | **실행 receipt가 단계를 게이트** |
| 반-게이밍 | 없음 | **protected-core 프록시 등록부** |

**정리:** 같은 척추에 척추뼈 하나 더. Spec Kit / Kiro는 경쟁자가 아니라 자연스러운 연동 대상.

### 3. gpt-pilot · Pythagora — 아키텍처 쌍둥이 (역할 + 리뷰어, tier 없음)

가장 가까운 풀 다중에이전트 SWE 형태: Tech Lead → Developer → Code Monkey → *Reviewer* →
Technical Writer, 나쁜 단계를 되돌리는 Reviewer + 2계층 테스트(단계마다 유닛, 태스크마다 E2E).
"검증이 구조적"에 도달 — 그러나 tier·서명·반-게이밍 직전에서 멈추고, OSS 라인은 실제 신뢰
리스크를 안는다.

| 차원 | gpt-pilot | web-harness |
|---|---|---|
| 리뷰어 | 단계를 되돌림(재량적) | **read-only 검증자, receipt 게이트** |
| 테스트 | 2계층 생성(유닛 + E2E) | 같은 ID 재검증 + tier 증거 |
| 승격 | 막히면 사람에게 에스컬레이트 | **증명 없이는 차단** |
| 상태 | OSS 유지중단 · 2025–26 공급망 웜(정리됨) | 활발히 게이트 + 자기 도그푸드 |

**정리:** gpt-pilot은 *형태*가 독점이 아님을 증명한다. web-harness의 우위는 리뷰어의 판정이
재량이 아니라 서명 증거에 결박됐다는 점.

### 4. Claude Code 풀-SDLC 플러그인 — 플랫폼 경쟁자 (가장 직접적인 경쟁)

같은 플랫폼, 같은 야망. `closedloop-ai/claude-plugins`는 LLM 품질 판사가 붙은 계획 우선
SDLC를, `agentic-sdlc-plugin`은 아이디어→출시 10개 명령 + 8-에이전트 QA 루프 + "품질 게이트"
+ 자기 확장 테스트 스위트를 배포. 게이트는 있으나 — LLM-판사 게이트이지 증거-tier 게이트가
아니다.

| 차원 | closedloop / agentic-sdlc | web-harness |
|---|---|---|
| 풀 SDLC | 예 — 아이디어 → 출시 | 예 — Plan → Release |
| 품질 게이트 | LLM 판사 / 품질 게이트 | **exit-code + 서명 receipt tier** |
| "통과" | 모델이 괜찮아 보인다고 말함 | **실행이 증명, 아니면 출시 안 됨** |
| 반-게이밍 | 드러난 것 없음 | **등록된 불변식** |

**정리:** "풀-SDLC Claude Code 플러그인"은 붐비는 카테고리. 앞세울 차별점은 범위가 아니라
"증거 없인 green 없음" — LLM-판사 경쟁자는 여전히 모델의 의견을 신뢰한다.

## 지형이 이 아이디어로 기울고 있다

- **Cognition(Devin) 수렴.** 엔지니어링 블로그가 단일 스레드 쓰기 + read-only 보조 에이전트
  + 깨끗한 컨텍스트 리뷰어를 지지 — web-harness의 본능을 독립적으로 도달. 흔한 "Devin = 모델
  스웜" 서사는 근거 없는 SEO다.
- **BMAD가 에이전트를 줄임.** 선도 다중에이전트 방법론이 2026년 통합 — Scrum Master + QA를 Dev
  에이전트로 합치며 "다중에이전트 개발팀 모델을 은퇴." 업계는 *더 적은* 에이전트로 기운다.
- **reward hacking은 살아있는 필드.** SpecBench, ImpossibleBench, capped-evaluation 연구가
  게이밍이 실재함을 확인 — 그리고 "패치로 고칠 버그가 아니라 최적화의 불가피한 귀결." 학술은
  벤치마크 층, web-harness는 프로덕션 게이트에서 작동.

## 전략적 판독

1. **메시지.** 증거 게이트 승격과 반-게이밍을 앞세워라 — 둘 다 붐비는 "또 하나의 앱빌더"나
   "또 하나의 SDLC 플러그인"이 아니라.
2. **에이전트 수.** BMAD의 축소 흐름을 따라 "각 단위가 얇고 독립 검증 가능"을 팔아라, "우린
   46개다"가 아니라. (101 → 46 트림은 2026-08-26/27에 실제로 일어났다.)

## 출처 & 신뢰도

- 스펙 주도 — [github/spec-kit](https://github.com/github/spec-kit) · [kiro.dev](https://kiro.dev) · BMAD-METHOD
- 앱 빌더 — [v0](https://vercel.com/blog/introducing-the-new-v0) · [bolt.new](https://github.com/stackblitz/bolt.new) · [Lovable](https://docs.lovable.dev/features/agent-mode) · [Replit Agent 3](https://replit.com/blog/automated-self-testing)
- 자율 SWE — [Cognition/Devin](https://cognition.com/blog/multi-agents-working) · [Copilot 코딩 에이전트](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent) · [OpenHands SDK](https://arxiv.org/html/2511.03690v1) · [SWE-agent](https://arxiv.org/abs/2405.15793)
- 프레임워크 — [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/subagents) · [Microsoft Agent Framework](https://learn.microsoft.com/en-us/agent-framework/overview/) · CrewAI · LangGraph
- 플러그인 — [closedloop-ai](https://github.com/closedloop-ai/claude-plugins) · [agentic-sdlc](https://github.com/ajaywadhara/agentic-sdlc-plugin)
- reward hacking — [SpecBench](https://arxiv.org/pdf/2605.21384) · [The Verification Horizon](https://arxiv.org/pdf/2606.26300)

**신뢰도:** 검증 경계 배치는 2026년 다수 출처로 잘 뒷받침된다. Closed-source 내부(Devin
에이전트 구성, Devin/Factory의 하드 게이트 강제 여부)는 사실이 아니라 inference로 표기.
증거-tier 승격의 "프로덕션 유사 선례 없음"은 absence-of-evidence를 정직히 보고한 것 —
확인된 부재가 아니다.
