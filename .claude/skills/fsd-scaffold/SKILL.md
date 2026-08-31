---
name: fsd-scaffold
description: [내부] Phase 3가 고른다. 사용자 진입점은 /wh 하나다. Project-scoped scaffold guide for Feature-Sliced Design (FSD) in the web-harness repo. Use this skill when the user asks where to put a new file, how to create a new feature/entity/page slice, or needs FSD layer decision guidance. Also helps scaffold boilerplate for new slices following the project's conventions.
argument-hint: "[slice responsibility]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, AskUserQuestion
metadata:
  version: 1.1.0
  maturity: contract-only
  updated: 2026-08-18
  changelog: UI 레인 tier b — slice-template 보일러플레이트 레인 분기(mui/tailwind-shadcn 병기).
---

# FSD Scaffold

Use this skill to guide slice placement decisions and generate FSD-compliant boilerplate for web-harness. Keep user-facing prose in Korean.

Read `references/fsd-rules.md` before any layer decision. Read `references/slice-template.md` when generating file scaffolding. 기존 프로젝트에 파일을 생성하거나 연결할 때는 `.claude/skills/web-orchestrator/references/minimal-change-contract.md`를 읽고 새 slice에 필요한 integration path만 수정한다.

## Start

When the user invokes `/fsd-scaffold` alone, start with:

> 어떤 기능을 어디에 만들어야 할지 안내해드릴게요. 만들려는 기능과 그 기능이 어떤 역할을 하는지 간단히 알려주세요.

인자(`/fsd-scaffold 장바구니 기능`)가 있으면 별도 질문 없이 바로 레이어 결정으로 넘어간다.

인자가 없으면 두 가지만 확인한다:

- 만들려는 것이 무엇인지 (화면, 기능, API 연동, 공통 유틸 등)
- 이 기능이 다른 기능에 의존하는지, 또는 다른 곳에서 가져다 써야 하는지

## Workflow

1. 사용자의 의도를 파악한다.
2. `references/fsd-rules.md`의 레이어 결정 트리에 따라 어느 레이어/슬라이스에 위치해야 하는지 판단한다. **결정 근거를 한 줄로 명시한다** — "다른 feature에서 재사용하지 않으므로 `features/`", "도메인 모델만 포함하므로 `entities/`" 등.
3. 파일 구조와 index.ts 공개 API를 제안한다. **공개할 것과 공개하지 않을 것을 구분해 명시한다.**
4. 요청이 있으면 `references/slice-template.md` 기반으로 보일러플레이트를 생성한다. **생성 전에 경로 확인** — 동일한 slice가 이미 존재하면 기존 파일과 충돌 여부를 먼저 알린다.

## Layer Decision Output Format

```markdown
## 레이어 배치

- **레이어:** `features/` (또는 `entities/`, `shared/`, etc.)
- **슬라이스 이름:** `featureName`
- **이유:** 이 기능은 [이유] 때문에 features 레이어에 속합니다.
- **경로:** `{앱 루트}/src/features/featureName/` (예: `apps/my-app/src/features/featureName/`)

## 공개 API (index.ts)

공개할 것: [목록]
공개하지 않을 것: [목록]

## 다음 단계

- [ ] 슬라이스 디렉토리 생성
- [ ] index.ts 공개 API 작성
- [ ] tsconfig paths 별칭 확인 (`@features/featureName`)
```

## Gotchas

- 같은 레이어 내 슬라이스 간 직접 import는 Entities 레이어에서만 `@x` 표기법으로 허용된다. Features, Widgets에서는 props/callback 주입(IoC) 패턴을 사용한다.
- `export *`는 FSD 공개 API에서 금지다. 반드시 명시적 named export만 사용한다.
- Processes 레이어는 deprecated다. 해당 내용은 `features/` 또는 `app/`으로 옮긴다.
- `shared/`는 슬라이스 없이 세그먼트만 가진다 (`shared/api`, `shared/ui`, `shared/hooks` 등).
- web-harness의 path alias: `@app/*`, `@pages/*`, `@widgets/*`, `@features/*`, `@entities/*`, `@shared/*`
