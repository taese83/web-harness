---
name: project-init
description: Project scaffolding skill for new frontend projects based on the web-harness tech stack. Use when the user wants to create a new React + TypeScript + Vite + FSD project from scratch, set up a monorepo, or bootstrap a new app with the same conventions as web-harness.
argument-hint: "[project description]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, AskUserQuestion
metadata:
  version: 1.1.0
  maturity: eval-covered
  updated: 2026-08-18
  changelog: scaffold vs 서비스 구축 범위 기준선 신설 — 서비스 요청을 골격 생성으로 흡수해 기획·설계·QA 게이트를 우회하지 못하게 하고, scaffold 완결 시 게이트 미실행 고지를 의무화.
---

# Project Init

web-harness 기술 스펙 기반의 새 프론트엔드 프로젝트를 처음부터 세팅한다. 파일은 소유권 범위에서 생성하고 package/Git 작업은 typed broker에 위임한다.

## Canonical web routing guard

사용자 설명, 전달 문서 또는 대상 디렉토리에 crawling/scraping, RSS·CSV import, scheduled third-party sync, generated runtime JSON, `scripts/ingestion`, `scripts/crawl.*`, refresh workflow 중 하나가 있으면 scaffold를 시작하지 않는다. 원문 요청과 대상 경로를 손실 없이 `/web-orchestrator`에 넘겨 `EXTERNAL_DATA_INGESTION_MODE` 계약부터 만들게 한다. `/project-init`은 이 경로를 일반 React/Vite Mock 프로젝트로 축소할 수 없다.

### 이 skill의 범위 — scaffold vs 서비스 구축

`/project-init`은 **빈 골격 세팅**(package/tooling/FSD 디렉터리/템플릿)까지다. 제품 기획·화면 설계·기능 구현·QA 게이트는 범위 밖이며 `/web-orchestrator`가 소유한다.

요청이 **동작하는 서비스**를 원하면(화면·기능·데이터 흐름을 말하거나, "만들어줘"의 대상이 앱 자체이거나, 기획·디자인 산출물을 기대하면) scaffold만 하고 끝내지 않는다. 그 요청은 `greenfield-service`이며 `/web-orchestrator`의 Phase 1~4가 canonical 경로다 — `request-type-contract.md` 참조.

- 골격만 필요하다고 **명시된** 경우(기존 팀 규약대로 빈 프로젝트만, 이후 직접 개발)에만 이 skill로 완결한다.
- 판단이 갈리면 한 번 확인한다: "골격만 세팅할까요, 아니면 기획·설계·QA까지 포함해 서비스를 만들까요?"
- scaffold로 완결한 경우 완료 보고에 **"기획·설계·QA 게이트는 실행되지 않음 — 서비스 구축은 `/web-orchestrator`"**를 명시한다. scaffold 성공을 서비스 완성으로 보고하지 않는다.

빈 골격 생성이 쉽다는 이유로 서비스 요청을 이 경로로 흡수하면 기획·설계·QA 게이트 전체가 조용히 우회된다.

Read `references/checklist.md` before starting any phase. 템플릿 catalog 전체를 읽지 않는다. 파일을 만들기 직전에 `node .claude/scripts/read-skill-section.mjs --catalog project-templates --section <SECTION>`을 실행해 필요한 section 하나만 가져온다. section 이름이 불명확할 때만 `--list`를 사용한다.

## Start

When the user invokes `/project-init` alone, start with:

> 새 프론트엔드 프로젝트를 세팅할게요. 몇 가지만 확인하겠습니다.

그리고 다음 intake 질문을 한 번에 묻는다 (개별로 나눠서 묻지 않는다):

```markdown
## 프로젝트 기본 정보

1. **프로젝트 이름** (예: my-app) — 디렉토리명과 package.json name에 사용됩니다.
2. **앱 제목** (예: My Dashboard) — index.html `<title>`에 들어갑니다.
3. **생성 위치** — 절대 경로 또는 현재 디렉토리 기준 (예: ~/Project/my-app)
4. **모노레포 여부** — Turborepo 모노레포로 만들까요, 아니면 단일 앱으로 만들까요?
5. **환경(env) 이름** — 어떤 환경이 필요한가요? (기본값: dev, staging, production / web-harness처럼 sandbox, cbt도 추가 가능)
6. **GitHub Actions preview** — WIP preview CI가 필요한가요? (self-hosted runner를 쓸 경우 필요)
7. **내부(사설) 패키지** — 조직 사설 레지스트리의 내부 패키지가 필요한가요? (필요하면 스코프·패키지명을 알려주세요)
8. **외부 데이터 수집** — 크롤링·파일 import·scheduled sync·build-generated JSON이 있나요? 있으면 source와 실행 주기도 알려주세요.
9. **UI 레인** — 어드민·대시보드처럼 밀도·속도가 우선이면 `mui`, 브랜드·디자인 자유도가 우선이면 `tailwind-shadcn`을 권합니다. 어느 쪽으로 할까요? (미정이면 서비스 성격을 알려주시면 제안합니다)
```

답변을 받으면 외부 데이터 수집 여부를 먼저 판별한다. 해당하면 `/web-orchestrator`로 위임하고, 아니면 Phase 1부터 순서대로 실행한다.

## Workflow

`references/checklist.md`에 정의된 5개 Phase를 순서대로 실행한다.

각 Phase 시작 시:
```
## Phase N — 제목
[작업 목록 출력 후 실행]
```

각 Phase 완료 시:
```
✅ Phase N 완료 — [다음 Phase로 이어서 진행]
```

전체 완료 시 최종 체크리스트를 출력한다 (`references/checklist.md`의 ## 완료 후 체크리스트 섹션).

## Execution Rules

- 파일 생성은 Write 도구를 사용한다.
- lockfile 생성, install, Git 초기화, MSW/Husky 초기화는 직접 shell command가 아니라 `run-package-operation.mjs`의 typed operation으로만 실행한다. lockfile diff 검토 전 install을 실행하지 않는다.
- 생성 위치가 이미 존재하고 비어 있지 않으면 파일을 만들기 전에 사용자에게 확인한다.
- 비어 있지 않은 위치의 기존 source 수정을 승인받았다면 `.claude/skills/web-orchestrator/references/minimal-change-contract.md`를 적용하고 scaffold 전체 덮어쓰기를 금지한다.
- package operation broker도 package code/network 또는 repository mutation을 수행하므로 실행 전 사용자 확인이 필요하다. maintainer/project settings에서 자동 승인하지 않는다.
- 각 Phase의 모든 파일/명령이 끝난 뒤 다음 Phase로 넘어간다.
- 오류가 발생하면 그 자리에서 보고하고 해결한 후 계속 진행한다.
- 모노레포 여부에 따라 경로가 달라진다:
  - **모노레포**: `{root}/apps/{appName}/src/...`
  - **단일 앱**: `{root}/src/...`
- 사설 내부 패키지가 필요 없으면 해당 패키지와 설정을 제거하고 선택된 UI 레인의 표준 구성으로 대체한다.
- Mock API를 생성하면 `msw` 의존성과 `src/mocks/` 설정을 함께 생성한다.
- browser Mock을 생성하면 package.json에 `msw.workerDirectory`를 설정하고 install 후 실제 외부 격리 setup job에서만 broker의 `msw-init` operation으로 worker script를 생성한다. package 내부 worker를 수동 복사하거나 임의 구현하지 않는다.

## Variable Substitution

선택한 template section의 `{{APP_NAME}}`, `{{APP_TITLE}}`, `{{ENVS}}` 등은 intake에서 받은 값으로 치환한다. asset catalog를 통째로 context에 로드하지 않는다.

## Gotchas

- `install` operation 전에 `package.json`과 workspace 설정을 먼저 생성한다. broker는 lifecycle script를 기본 차단한다.
- `husky-init` operation은 install 이후 실제 외부 격리 setup job에서만 실행한다. `WEB_HARNESS_ISOLATED_EXECUTION=1`은 격리를 만드는 기능이 아니라 외부 격리 선언이다.
- 단일 앱이면 `turbo.json`과 `pnpm-workspace.yaml`은 생성하지 않는다.
- `.env.dev`, `.env.staging`, `.env.production`은 공개 `VITE_*` 값만 포함할 때 커밋 가능하다. `.env.local`, `.env.*.local`은 반드시 `.gitignore`에 추가한다.
- GitHub Actions workflow는 self-hosted runner가 필요한 경우에만 그 label로 생성한다. 일반 공개 환경이면 `ubuntu-latest`로 대체한다.
<!-- repo-only:start -->
- `.claude` 하네스를 배포할 때 `README.md`, skills, agents, scripts, evals, adapters, schemas를 **모두** 복사하고, 생성 프로젝트에는 maintainer 설정이 아닌 `settings.project.json`을 `.claude/settings.json`으로 배포한다.
- `.claude/ai-harness.json` manifest도 함께 복사한다.
- 복사 후 `node .claude/scripts/validate-harness.mjs`와 `node .claude/scripts/test-ai-harness.mjs --through eval-contracts`를 실행한다.
<!-- repo-only:end -->
- 생성 프로젝트의 test scaffold가 준비된 뒤 사용자 확인을 받고 `node .claude/scripts/run-quality-gates.mjs --all --allow-host-execution`으로 로컬 진단 receipt를 만든다. 최종 release manifest v3는 격리 CI에서 동일 cohort를 재실행하고 신뢰 attester가 서명한 뒤에만 검증한다. missing script를 임의 fallback command로 대체하지 않는다.
