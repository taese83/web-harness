---
name: lib-advisor
description: [내부] Phase 1 tech-advisor가 고른다. 사용자 진입점은 /wh 하나다. Library recommendation and setup advisor for React + TypeScript + Vite projects. Use this skill when the user wants to know which libraries to use for a new project or feature, needs help choosing between alternatives, or wants to set up a recommended library with initial configuration. Works for any service type — dashboard, e-commerce, blog, SaaS, etc.
argument-hint: "[service type or required capability]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, WebSearch, WebFetch, AskUserQuestion
metadata:
  version: 1.1.0
  maturity: contract-only
  updated: 2026-07-27
  changelog: UI 레인 이원화(M4) — §UI 2레인 결정표(판단 축·트레이드오프), Tailwind CSS + shadcn/ui 설정 스니펫 신설, preflight×CssBaseline 안티패턴.
---

# Lib Advisor

만들려는 서비스와 필요한 기능을 파악해서 적절한 라이브러리를 추천하고, 원하면 설치 및 초기 설정까지 수행한다.

카탈로그 전체를 읽지 말고 필요한 절만 가져온다 — 279줄 중 실제로 쓰는 것은 base stack 1개와 요청에 걸린 기능 영역 2~3개뿐이다:

```bash
node .claude/scripts/read-skill-section.mjs --catalog library-catalog --section BASE_STACK
node .claude/scripts/read-skill-section.mjs --catalog library-catalog --section <FEATURE_KEY>
```

키가 불확실할 때만 `--list`로 18개 절 목록을 확인한다. 주요 키: `BASE_STACK` · `STATE` · `FORMS` · `UI` · `CHARTS` · `TABLES` · `DATETIME` · `AUTH` · `I18N` · `PAYMENT` · `MAPS` · `ANTIPATTERNS`.
설치·설정이 확정되면 catalog 전체를 읽지 말고 `node .claude/scripts/read-skill-section.mjs --catalog library-setup --section <library-key>`로 해당 snippet만 가져온다. 지원 key는 필요할 때 `--list`로 확인한다.
기존 project에 dependency/config를 적용할 때는 `.claude/skills/web-orchestrator/references/minimal-change-contract.md`를 읽고 package와 필수 integration file만 change scope에 포함한다.

## Start

When the user invokes `/lib-advisor` alone, start with:

> 어떤 서비스를 만드는지 알려주시면 기술 스택에 맞는 라이브러리를 추천해드릴게요.

그리고 두 가지만 물어본다:

```
1. 만드는 서비스가 어떤 종류인가요?
   예: 데이터 대시보드 / 쇼핑몰 / 블로그 / SaaS 관리 도구 / 소셜 피드 / 예약 시스템 등

2. 특별히 필요한 기능이 있나요? (없으면 서비스 유형만 보고 추천)
   예: 차트, 무한 스크롤, 결제, 에디터, 지도, 실시간 업데이트, 드래그&드롭 등
```

## Workflow

1. 서비스 유형과 필요 기능을 파악한다.
2. `library-catalog`의 `BASE_STACK` 절과 요청에 걸린 기능 영역 절만 가져와 해당 유형·기능에 맞는 라이브러리를 찾는다. 마지막에 `ANTIPATTERNS`를 확인한다.
3. 추천 후보마다 현재 프로젝트 `package.json`과 공식 문서/npm metadata 기준으로 최신 안정 버전, 유지보수 상태, 라이선스를 확인한다.
4. 아래 Output Format으로 추천을 출력한다.
5. 사용자가 설치를 원하면:
   - `read-skill-section.mjs`로 해당 라이브러리 section만 조회한다.
   - 공식 metadata로 확인한 exact version을 `package.json`에 기록한다.
   - `run-package-operation.mjs`의 `lockfile`을 실행하고 read-only Git broker로 dependency/lockfile diff를 검토한 뒤 `install`을 실행한다. raw `pnpm add/install`은 실행하거나 제안하지 않는다.
   - 설치가 승인·완료된 뒤 초기 설정 파일을 생성한다.

## Output Format

```markdown
## 추천 스택 — {서비스 유형}

### 필수 (Base Stack)
이 서비스 유형이면 거의 항상 필요한 라이브러리:

| 역할 | 라이브러리 | 이유 |
|---|---|---|
| ... | ... | ... |

### 기능별 추천
요청하신 기능에 맞는 라이브러리:

#### {기능명}
- **추천:** `library-name`
- **이유:** 왜 이 라이브러리인지
- **대안:** 다른 선택지와 그 트레이드오프
- **피할 것:** 이 상황에서 쓰면 안 되는 것과 이유

### dependency 변경안
| 구분 | 패키지 | exact version | 근거 |
|---|---|---|---|
| dependencies | library-name | x.y.z | 공식 metadata 확인 |

적용 시 typed package broker의 lockfile 검토 → frozen install 절차를 사용합니다.

설치하고 초기 설정도 해드릴까요?
```

## Decision Principles

라이브러리 추천 시 다음 기준으로 판단한다:

1. **번들 크기** — 기능 대비 크기가 합리적인가
2. **유지보수 상태** — 최근 1년 내 업데이트, 오픈 이슈 처리 여부
3. **현재 React + TypeScript 호환성** — 설치된 major와 공식 peer/type 지원 여부
4. **Rendering 호환성** — 선택한 CSR/SSR/SSG 환경과 server/client boundary 지원 여부
5. **라이선스** — 상업 프로젝트에 적합한 MIT/Apache 여부
6. **현재성** — 추천 직전에 공식 문서, npm publish 시점, deprecated 여부를 확인했는가

이미 프로젝트에 유사 기능이 있으면 추가 라이브러리보다 기존 것 활용을 먼저 제안한다.

## Gotchas

- 라이브러리만 나열하지 않는다. 반드시 **왜 이 선택인지**, **언제 쓰면 안 되는지**를 함께 설명한다.
- "무조건 유명한 것"이 아니라 서비스 규모와 요구사항에 맞는 것을 추천한다.
  - 소규모 블로그에 Redux가 필요 없고, 대규모 커머스에 Zustand만으로 부족할 수 있다.
- 같은 역할의 라이브러리가 여럿 있으면 하나를 명확히 추천하고 나머지는 대안으로 설명한다. 모두 나열만 하지 않는다.
- 설치 전에 현재 프로젝트의 `package.json`을 확인해서 이미 설치된 것은 제외한다.
- 오래 변하지 않는 카탈로그 내용만으로 버전을 단정하지 않는다. 네트워크/문서 확인이 불가능하면 "현재성 미확인"을 명시하고 보수적인 대안을 제시한다.
