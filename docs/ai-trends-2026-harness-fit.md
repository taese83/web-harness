# 2026 AI 동향 대비 하네스 적합도 — 정렬·공백·역방향 (2026-08-31)

*웹 리서치 2026-08-31 + 저장소 실측. 이 문서는 **기술 동향축** 대조다 —
[competitive-landscape.md](competitive-landscape.md)는 **도구 포지셔닝**,
[field-guide-gap.md](field-guide-gap.md)는 **운영 패턴 10종** 대조이며 서로 대체하지 않는다.*

동향은 셋 중 하나로만 판정한다: **정렬**(하네스가 이미 그 자리에 있다) · **공백**(동향이
가는데 하네스는 없다) · **역방향**(동향을 따르면 불변식이 깨진다 — 따르지 않는다).
"따라가야 할 것"과 "따라가면 안 되는 것"을 같은 표에서 가른다.

---

## 0. 방법과 한계 (먼저 읽는다)

- **1차 출처 결핍**: Anthropic의 2026 Agentic Coding Trends Report 원문(`resources.anthropic.com`)은
  이 세션의 egress 정책에 막혀 **직접 읽지 못했다**. 보고서 관련 수치는 전부 3자 요약을 통한 **2차 인용**이며,
  그렇게 표기한다. 인용 수치를 하네스 게이트의 근거로 승격시키지 않는다.
- **재측정 없음**: 하네스 쪽 수치는 오늘 새로 측정한 것이 아니라 저장소의 기존 실측
  (README 공표치, `contract-hygiene-baseline.json`, 파일 grep)을 인용한다. grep으로 오늘 확인한 항목만
  "실측(2026-08-31)"로 표기한다.
- **동향 ≠ 규범**: 어떤 항목도 "업계가 그러니 우리도"로 처방하지 않는다. 각 공백에는 그것을 메우는 비용과
  건드리는 불변식(I1~I6, [protected-core.md](protected-core.md))을 함께 적는다.

---

## 1. 2026 동향 지도 (3층)

### 1층 · 기반 — 시간지평과 모델 클래스 분화

| 동향 | 관측치 |
|---|---|
| 과제 시간지평의 지수 성장 | METR: 50% 신뢰도 시간지평이 **약 7개월마다 2배**. 2026-05 갱신에서 GPT-5 에이전트 약 **2시간 17분**(사람 전문가 기준 과제 길이) |
| 장시간 성공률의 절벽 | 4분 미만 과제는 거의 100%, **4시간 초과 과제는 10% 미만** — 지평 안팎이 다른 세계다 |
| 프런티어 vs 효율 모델 이원화 | 추론(inference)이 학습과 맞먹거나 넘어서는 경제로 이동. 대형 모델과 하드웨어 인지형 소형 모델이 **같은 파이프라인에 공존**하는 것이 2026 형태 |
| 장시간 자율 실행 | 2차 인용: 단일 **7시간 런**에서 1,250만 줄 코드베이스 변경 사례 |

### 2층 · 에이전트 — 컨텍스트 공학, 팀, 표준

| 동향 | 관측치 |
|---|---|
| 컨텍스트 공학이 프롬프트 공학을 대체 | "매 턴 어떤 토큰이 컨텍스트에 들어갈 자격이 있는가"가 프로덕션 핵심 기술 |
| compaction의 재평가 | 프롬프트 캐싱이 있으면 **보존이 요약보다 싸고 정확한 경우가 많다** — compaction은 기본값이 아니라 명시된 제약에 대한 의식적 대응 |
| 서브에이전트 = 컨텍스트 격리 장치 | 수만 토큰을 쓰고 **응축 요약만 반환**하는 구조가 표준 관용구 |
| 메모리 도구 + 적시 검색 | 상세는 파일/메모리로 내보내고 **포인터만** 컨텍스트에 둔다(가역적) |
| 위임 격차 | 2차 인용: 개발자가 업무의 약 **60%**에 AI를 쓰지만 **완전 위임 가능은 0~20%** |
| 비동기·클라우드 에이전트와 mission control | 터미널/데스크톱/클라우드 "관제 표면"이 먼저 나오고 IDE 통합이 뒤따르는 패턴 |
| 상호운용 표준의 고착 | MCP가 Linux Foundation 산하 AAIF로 이관(2025-12), **2026-07-28 최대 개정**, 월 1.1억 다운로드 · Agent Skills가 오픈 표준화(2025-12-18) 후 **40여 제품 채택** · AGENTS.md **6만+ 저장소** |

### 3층 · 검증·신뢰 — 이 하네스가 사는 층

| 동향 | 관측치 |
|---|---|
| 병목의 이동: 작성 → **검토** | 팀은 태스크 21%·머지 PR 98% 증가, 그러나 **PR 리뷰 시간 91% 증가**, AI 생성 PR은 픽업까지 **4.6배** 대기 |
| 검증 격차 | **96%가 AI 코드의 정확성을 완전히 신뢰하지 않으면서 48%만 항상 검증**. 리뷰 노력이 사람 코드보다 크다는 응답 38% |
| 보상 해킹의 실증화 | RHB: 13개 프런티어 모델의 exploit rate **0%(Claude Sonnet 4.5) ~ 13.9%(DeepSeek-R1-Zero)** · SpecBench(장기 코딩) · TRACE(54 범주·517 궤적) · 벤치마크 자체를 적대적으로 굳히는 연구(hacker-fixer 루프) |
| "검증 지평"에 은탄환 없음 | 보상 설계로 해킹을 없앨 수 없다는 것이 2026 합의에 가깝다 — 게이트는 **생성 밖**에 있어야 한다 |
| 에이전트 보안이 1순위 위험 | 프롬프트 인젝션이 OWASP LLM Top 10 **1위**, 웹 콘텐츠 내 인젝션 페이로드 **+32%**(2025-11→2026-02). 커널 수준 네트워크 allowlist(NemoClaw)·HTTP 계층 기본거부(ceLLMate) 같은 **프로세스 밖 정책 엔진**으로 이동 |
| 거버넌스 형식화 | NIST IR 8596(Agentic AI Profile) — **폭발 반경이 커질수록 자율성을 낮추는 위험 계층형 자율성** |

---

## 2. 대조표 — 동향 × 하네스

| # | 동향 | 하네스의 현 위치 (근거) | 판정 |
|---|---|---|---|
| 1 | 검증 경계가 진짜 병목 | 릴리스가 receipt·격리 CI 증거에 결속. `validate-release-gate.mjs`·`quality-attestation-lib.mjs` | **정렬(선행)** |
| 2 | 보상 해킹은 못 없앤다 → 게이트를 생성 밖에 | 생성기≠검증기 구조 강제, 검증자는 `Read/Glob/Grep/Bash` 전용 · [protected-core.md](protected-core.md) §4 프록시 등록부 | **정렬(선행)** |
| 3 | 컨텍스트 공학 = 예산 관리 | `validate-spawn-plan.mjs` 기본 상한 **산출물 8개 · read 60,000 tokens**(사전 차단) + 진입 고정비 **46,212B** ratchet | **정렬(선행)** |
| 4 | 서브에이전트 = 요약만 반환 | 인계가 전사가 아니라 `_workspace` **파일 계약** — 전사 유출이 구조적으로 불가 | **정렬** |
| 5 | 프런티어/효율 모델 이원화 | 실측(2026-08-31): 46개 에이전트가 **sonnet 37 · opus 7 · fable 2**로 이미 분화 | **정렬** |
| 6 | 장시간 런의 중단·복구 | `verify-spawn-completion.mjs` + `resume-manifest.mjs`(done/truncated/missing 분류 후 잔여만 재스폰) | **정렬(부분)** |
| 7 | 인바운드 콘텐츠는 데이터이지 지시가 아니다 | `.claude/scripts/ticket/pickup.mjs`의 `scanUntrustedBody` — 이슈 본문 인젝션 패턴 4종 스캔 후 **fail-closed 반송**, 격리 발췌로만 하류 전달 | **정렬** |
| 8 | 위험 계층형 자율성 | side-effect는 `--confirm` 없이는 발화하지 않음(team-flow) · 소유권 훅 · 전역 Bash 정책(argv-only) | **정렬(부분)** |
| 9 | 상호운용 표준(MCP·Skills·AGENTS.md) | 실측(2026-08-31): MCP 언급은 **Figma Remote MCP를 선택적 디자인 소스로 다루는 2개 스킬 + eval 문장 1건**이 전부. 제공/소비 계약 0. AGENTS.md는 §4에 **비교 대상으로 1회 언급**될 뿐 지원 없음 | **공백** |
| 10 | 검토 병목의 계측 | 텔레메트리는 **토큰·스폰** 단위다. 승인 게이트는 사람인데 **사람 검토 시간·재작업률은 어디서도 측정되지 않는다** | **공백** |
| 11 | 자체 에이전트의 웹 인입 격리 | 실측(2026-08-31): 계약 전달 지시는 `web-orchestrator/SKILL.md`에만 있고 **`/wh`의 `change`·`fix`·`verify` 레인 정본에는 0건**이다. WebSearch/WebFetch를 가진 4개 에이전트 중 계약을 참조하는 것도 **0개** | **공백** |
| 12 | 프로세스 밖 정책 엔진·커널 격리 | 격리는 **argv 수준**이다. SLSA L3형 실행 격리 미해결은 §4에 이미 등록됨 | **공백(등록됨)** |
| 13 | 효능의 벤치마크화 | eval 시나리오 **46건 대비 커밋된 receipt 1건**(`complete-harness-packaging`) — 결함 발견 능력의 증거이지 결과 품질의 증거가 아니라고 스스로 표기 | **공백(등록됨)** |
| 14 | LLM 심판 게이트의 확산 | 채택하지 않는다 — 모델 의견을 통과 조건으로 만들면 I2(게이트 강도)가 무너진다 | **역방향** |
| 15 | "완전 위임" 장시간 자율 런 | 승인 게이트를 우회하는 자율성은 I1·I2와 직접 충돌. 위임 격차 0~20%라는 업계 관측이 오히려 이 설계를 지지한다 | **역방향** |
| 16 | 에이전트 수 확장 | 이미 101 → 46으로 축소했고 소유권을 spec `layerMap`에서 도출한다. 다시 늘리는 것은 I4 역행 | **역방향** |

---

## 3. 정렬 — 하네스가 이미 도착해 있는 자리

동향의 **3층(검증·신뢰)** 전체가 하네스의 원래 명제와 같은 방향이다. 2026 연구가 도달한 결론
"보상 설계로 해킹을 없앨 수 없다"는 곧 **게이트를 생성자 밖에 두라**는 말이고, 이 저장소는 그것을
읽기 전용 검증자·receipt 결속·프록시 등록부로 이미 구현해두었다. 새로 할 일이 없다는 뜻이 아니라,
**동향 추종이 필요 없는 축**이라는 뜻이다.

컨텍스트 공학 축에서 하네스가 업계보다 앞서는 지점은 하나다. 업계 담론은 대개 **사후 압축**
(compaction)을 다루지만, 여기서는 `validate-spawn-plan.mjs`가 **스폰 전에** 읽기 예산을 보고
거절한다. 2026 담론이 "캐싱이 있으면 압축은 기본값이 아니다"로 이동한 것과 같은 방향이며, 그보다
한 발 앞이다.

한 가지는 우연에 가깝게 정렬됐다: 모델 클래스 이원화. 46개 에이전트가 이미 sonnet/opus/fable로
갈려 있어 "효율 모델과 프런티어 모델의 공존"이라는 2026 인프라 동향이 에이전트 레지스트리에
그대로 구현돼 있다. 다만 **그 배분이 비용·품질 근거로 측정된 적은 없다** — 정렬은 사실이고,
최적이라는 증거는 없다.

## 4. 공백 — 동향이 갔는데 하네스가 없는 곳

### G1. 상호운용 표준 (MCP · Agent Skills · AGENTS.md)

가장 큰 공백이며, 동시에 **가장 조심해서 다뤄야 하는** 공백이다.

- **사실**: MCP는 재단 이관과 2026-07-28 대개정을 거쳐 도구 생태계의 기본 배선이 됐고, Agent Skills는
  오픈 표준이 되어 40여 제품이 읽는다. AGENTS.md는 6만+ 저장소의 관례다.
- **하네스**: MCP 소비/제공 표면이 사실상 없다(Figma 선택 경로 1건). `.claude/` 단일 원본 정책은
  2026-08-18 "소비자 0" 실증에 근거한 **정당한 결정**이었지만, 그 실증은 **미러가 각 도구의 사설 형식이던
  시절**의 것이다. 형식이 표준화된 지금은 근거의 유효기간이 지났을 수 있다 — 재측정 대상이지, 자동
  채택 대상이 아니다.
- **위험(양방향)**: MCP 표면을 넓히면 **공급망·권한 표면이 함께 넓어진다**. 2026 사고 사례가 MCP 설정
  파일을 통한 RCE를 포함한다는 점에서, "표준이니 붙인다"는 I6(안전 하한)에 대한 정면 압력이다.

### G2. 검토 병목의 계측 부재

업계 데이터의 핵심은 "생성이 빨라질수록 **사람 검토**가 병목"이라는 것이다(리뷰 시간 +91%,
AI PR 대기 4.6배). 하네스는 이 문제에 대한 **구조적 답**(승인 게이트, 동일 TC-ID 재검증)을 갖고
있지만, **그 답이 효과가 있는지 잴 계측이 없다**. 텔레메트리는 토큰과 스폰만 센다. 승인 게이트가
사람 시간을 줄이는지 늘리는지는 현재 이 저장소가 대답할 수 없는 질문이다 — I1(진실성) 관점에서
"검토 부담을 줄인다"는 주장을 아직 할 수 없다는 뜻이다.

### G3. 자체 실행의 웹 인입 격리 — 레인마다 갈린다

인바운드 격리가 **기계로** 강제되는 곳은 티켓 경계 하나다(`ticket/pickup.mjs`의 `scanUntrustedBody`).
나머지는 지시 계층이고, 그 지시가 레인마다 다르다.

**완화가 0은 아니다**(첫 판정 보정): `web-orchestrator/SKILL.md`는 외부 콘텐츠가 실행에 들어오면
`untrusted-content-quarantine.md` 경로를 **수집 에이전트 프롬프트에 넘기라**고 지시한다. 또
`tech-advisor`는 "블로그나 검색 결과 요약만 근거로 쓰지 않는다"는 부분 완화를 갖는다.

문제는 **그 지시가 `new` 레인 문서에만 있다**는 것이다. 2026-08-29 `/wh` 통합 이후 레인 정본이
갈렸고, `change`·`fix`의 정본인 `execution-contract.md`와 `verify`의 `web-verify/SKILL.md`에는
관련 언급이 **0건**이다. 그런데 `execution-contract.md`는 WebFetch를 가진 `source-artifact-ingestor`를
직접 실행한다. 에이전트 4종(`requirements-analyst`·`tech-advisor`·`ux-researcher`·
`source-artifact-ingestor`) 중 그 계약을 참조하는 것도 0개이므로, 그 레인에서는 지시도 계약도 없다.

이것은 `/wh` 신설 커밋이 스스로 적은 문제 — "보호가 있는 길이 안내되지 않는 길이었다" — 의 같은
클래스 재발이다. 진입점은 하나로 모았는데 이 계약은 한 레인 문서에 남았다. 웹 인젝션 페이로드가
넉 달 새 32% 늘었다는 관측과 겹치면, 규칙을 **레인 문서가 아니라 에이전트 계약 쪽에** 두어야
레인 분기와 무관해진다는 처방이 따라 나온다.

### G4. 격리 수준과 효능 증거

둘 다 §4에 이미 등록된 한계이므로 여기서는 **동향 대비 위치만** 적는다. 업계는 커널/HTTP 계층
기본거부로 갔고 하네스는 argv 수준이다. 업계는 벤치마크를 적대적으로 굳히는 쪽으로 갔고 하네스는
시나리오 46 대비 receipt 1건이다. 새 발견이 아니라 **동향이 격차를 넓혔다**는 갱신이다.

## 5. 역방향 — 따라가면 불변식이 깨지는 동향

1. **LLM 심판 게이트.** 2026 도구 다수가 "품질 게이트"라 부르는 것은 모델의 의견이다. 이것을 통과
   조건으로 받으면 I2가 즉시 무너진다. 채택하지 않는다.
2. **승인 없는 장시간 자율 런.** 7시간 단일 런 사례는 능력의 증거이지 **위임 가능성의 증거가 아니다** —
   같은 보고서가 완전 위임 가능 비율을 0~20%로 적는다. 시간지평 연장은 스폰당 예산 상향의 근거가 될
   수 있지만, 승인 게이트 축소의 근거는 아니다.
3. **에이전트 수·표면 확장.** mission control·멀티 에이전트 플랫폼 담론은 표면을 키우는 방향이고,
   이 저장소는 측정 후 101 → 46으로 줄였다. I4 예산과 정면 충돌한다.

## 6. 권고 (우선순위 · 비용 · 불변식)

| 우선 | 조치 | 성격 | 건드리는 불변식 |
|---|---|---|---|
| 1 | **격리 규칙을 레인이 아니라 에이전트 계약에 둔다** — `untrusted-content-quarantine.md` 참조 + 인용 발췌 규칙을 웹 인입 4종에 넣고, 미배선을 검사로 고정. 레인 문서를 늘리지 않는 이유: 갈라진 것이 원인이고, 에이전트 파일은 스폰당 비용이라 진입 고정비를 건드리지 않는다 | 결손 배선 복구(신규 계약 아님) | I6 하한, I5(정규식 프록시 한계 표기), I4 무증가 |
| 2 | **사람 검토 시간 계측 축 신설** — 승인 왕복 횟수·승인까지 경과·STALE 재승인 횟수를 텔레메트리에 기록 | 계측만, 게이트 아님 | I1 — 없으면 "검토 부담을 줄인다"는 주장 자체가 불가 |
| 3 | **표준 대조 실측(채택 아님)** — Agent Skills 오픈 표준 frontmatter와 현 스킬 형식의 차이를 기계로 대조해 보고서 1건 | 측정 | I3(일반화), I4(표면 증가 없음) |
| 4 | **모델 배분의 근거화** — sonnet/opus/fable 37/7/2 배분이 비용·완주율에 미치는 영향을 파일럿 텔레메트리에서 후향 분석 | 분석 | I1 |
| 5 | **MCP는 계약 먼저** — 붙이기 전에 "MCP 서버는 비신뢰 도구 공급자"라는 위협 모델 행을 §4에 먼저 등록 | 선행 조건 | I6, I5 |

권고 1~4는 **새 계약을 만들지 않는다** — 배선·계측·분석이다. 권고 5는 계약이 먼저이고 구현은
그 다음이며, 지금 착수 대상이 아니다.

---

## 7. 출처와 신뢰도

- 기반층 — [METR Time Horizons](https://metr.org/time-horizons/) · [AI 인프라 2026 전망](https://vast.ai/article/the-future-of-ai-inference-in-2026)
- 에이전트층 — [Effective context engineering (Anthropic)](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) ·
  [Context engineering: memory, compaction, tool clearing (Claude Cookbook)](https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools) ·
  [Sourcegraph 컨텍스트 공학 가이드](https://sourcegraph.com/blog/context-engineering) ·
  [Agentic AI 표준 현황 2026](https://dev.to/alexmercedcoder/the-state-of-agentic-ai-standards-in-2026-mcp-a2a-webmcp-osi-and-the-protocol-stack-taking-3o2l) ·
  [Agent Skills 오픈 표준 채택](https://anomity.ai/blog/agent-skills-open-standard-adoption-governance/) ·
  [VS Code 멀티 에이전트](https://code.visualstudio.com/blogs/2026/02/05/multi-agent-development)
- Anthropic 2026 Agentic Coding Trends Report — **2차 인용만**:
  [요약 A](https://hivetrail.com/blog/anthropic-2026-agentic-coding-report/) ·
  [요약 B](https://rits.shanghai.nyu.edu/ai/anthropics-2026-agentic-coding-trends-report-from-assistants-to-agent-teams/) ·
  [요약 C](https://tessl.io/blog/8-trends-shaping-software-engineering-in-2026-according-to-anthropics-agentic-coding-report/)
- 검증·신뢰층 — [Sonar 검증 격차 조사](https://www.sonarsource.com/company/press-releases/sonar-data-reveals-critical-verification-gap-in-ai-coding/) ·
  [리뷰 병목 분석](https://blog.codacy.com/ai-breaking-code-review-how-engineering-teams-survive-pr-bottleneck) ·
  [Reward Hacking Benchmark](https://arxiv.org/abs/2605.02964) · [SpecBench](https://arxiv.org/html/2605.21384v1) ·
  [The Verification Horizon](https://arxiv.org/pdf/2606.26300)
- 보안 — [OWASP 인젝션 실패 보고](https://www.helpnetsecurity.com/2026/06/11/owasp-prompt-injection-ai-security-failures/) ·
  [에이전트 인젝션 위험 2026](https://atlan.com/know/prompt-injection-attacks-ai-agents/) ·
  [최소권한·샌드박싱 실무](https://techscoop.substack.com/p/how-to-build-secure-ai-agents-with)

**신뢰도**: 3층(검증·신뢰) 수치는 복수 출처가 교차 확인된다 — **높음**. 2층 표준 채택 수치(40여 제품,
6만 저장소, 월 1.1억 다운로드)는 각 1~2개 2차 출처 — **중간**. Anthropic 보고서 관련 수치는 원문 미열람
**2차 인용** — 낮음, 게이트 근거로 쓰지 않는다. 하네스 쪽 판정 중 "실측(2026-08-31)"로 표기한 4건
(모델 배분·MCP 언급 범위·격리 계약 미참조·AGENTS.md 언급)은 오늘 grep으로 확인했고, 나머지는 저장소의
기존 실측 인용이다.
