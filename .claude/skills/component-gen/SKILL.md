---
name: component-gen
description: Project-scoped component generator for web-harness. Use this skill when the user asks to create a new React component or UI boilerplate that follows the project's TypeScript conventions and its selected UI lane (MUI, or Tailwind + shadcn/ui vendored primitives). Generates code that respects Prettier config, the lane's public styling API rules, and the FSD layer the component belongs to.
argument-hint: "[component name and responsibility]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, Agent, AskUserQuestion
metadata:
  version: 1.1.0
  maturity: contract-only
  updated: 2026-07-27
  changelog: UI 레인 이원화(M4) — UI_LANE(mui|tailwind-shadcn) 분기, tailwind-shadcn-styling 계약 신설, 인덱스·설명 레인 중립화.
---

# Component Gen

web-harness 컨벤션에 맞는 React 컴포넌트 보일러플레이트를 생성한다. UI 레인은
`tech-stack.md`의 `UI_LANE`(mui | tailwind-shadcn)을 따른다.

Read `.claude/skills/web-orchestrator/references/minimal-change-contract.md` before changing an existing component. Read `references/mui-patterns.md` as the navigation index and `references/ts-conventions.md` for TypeScript rules. Then read only the focused reference needed by the component: the lane's styling doc (`references/mui-styling.md` for the mui lane; `references/tailwind-shadcn-styling.md` for the tailwind-shadcn lane — vendoring, cva, a11y preservation), `references/input-focus-ime.md` for text input/menu focus, `references/responsive-layout.md` for responsive structure/grid/transform, and `references/accessibility.md` for interactive UI.

## Start

When the user invokes `/component-gen` alone, start with:

> 어떤 컴포넌트를 만들어야 하는지 알려주세요. FSD 레이어와 역할을 함께 알면 더 정확하게 만들 수 있어요.

그리고 두 가지만 물어본다:
- 컴포넌트 이름과 어느 레이어/슬라이스에 속하는지 (모르면 역할을 설명하면 결정해준다)
- 레인 라이브러리 컴포넌트를 직접 감싸는 래퍼인지, 새로운 UI를 만드는 것인지

인자(`/component-gen ButtonGroup features/cart`)처럼 명확하면 별도 질문 없이 바로 생성한다.

## Workflow

1. 위치(레이어/슬라이스)와 역할을 파악한다. 레이어가 불명확하면 `/fsd-scaffold` 결정 트리를 적용하고 결과를 한 줄로 설명한다.
2. 기존 component 수정이면 change brief에 목표 동작, `ALLOWED_PATHS`, 보존할 props/접근성 contract, `NON_GOALS`를 기록한다. **신규 생성이면 이 단계를 생략한다.**
3. `references/mui-patterns.md`의 map으로 필요한 focused reference만 선택한다. interactive UI(클릭·키보드·포커스가 있는 컴포넌트)면 `references/accessibility.md`를 반드시 읽는다.
4. 프로젝트 Prettier 설정에 맞는 코드를 생성한다.
5. index.ts 공개 API export를 함께 제안한다. **export할 항목(컴포넌트, 타입)과 export하지 않을 항목(내부 헬퍼)을 명시한다.**
6. **QA — 신규 생성 및 기존 컴포넌트 수정 후 반드시 실행한다** (생략 불가, 사용자가 묻기 전에 자동 실행):

   **6-1. 테스트 보강**:
   - interaction, form, keyboard, async state가 있으면 `test-writer`가 deterministic component/browser test를 추가한다.
   - 단순 presentational component도 기존 test closure를 깨지 않는지 확인한다.

   **6-2. 결정론적 quality 실행**:
   - 사용자 승인 후 `node .claude/scripts/run-quality-gates.mjs --all --allow-host-execution`
   - `--fix`, formatter write, snapshot update로 QA 단계에서 source를 바꾸지 않는다.

   **6-3. 코드 리뷰** (Agent 도구로 `code-reviewer` subagent 실행):
   - 생성/수정된 파일 경로 목록을 컨텍스트로 전달해 `code-reviewer`를 호출한다.
   - `code-reviewer`는 source를 수정하지 않고 receipt, MUI selector, FSD import, CJK IME, a11y, 미사용 파일을 검사한다.
   - FAIL은 component owner가 수정하고 quality `--all`부터 다시 실행한다. WARN은 사용자에게 보고한다.

   **6-4. 런타임 검증** (UI 컴포넌트는 반드시 브라우저 확인):
   - `/run` 스킬을 호출해 dev server를 기동하고 추가된 컴포넌트를 브라우저에서 직접 확인한다.
   - 확인 항목: 렌더링 정상, 콘솔 오류 없음, 모바일/데스크탑 레이아웃, 인터랙션(클릭·키보드·포커스).
   - 시각적 이상(레이아웃 깨짐, 색상 오류)이 발견되면 즉시 수정 후 재확인한다.
   - dev server 기동이 불가한 환경이면 "런타임 검증: SKIP (이유)" 로 보고한다.

   **6-5. 결과 보고**:
   ```
   QA 결과
   ├── Quality receipts: PASS / FAIL / BLOCKED
   ├── 코드 리뷰:  PASS / WARN / FAIL (항목 목록)
   ├── 런타임 검증: PASS / FAIL / SKIP (이유)
   └── 종합: PASS면 완료 / FAIL이면 수정 후 재실행
   ```

## Gotchas

- 레인의 공개 스타일 API를 우선한다 — mui: `slotProps`/`classes`/theme `styleOverrides`(`references/mui-styling.md`), tailwind-shadcn: cva variant + `cn()` 병합(`references/tailwind-shadcn-styling.md`). 어떤 레인이든 substring selector와 생성된 hash class는 금지한다.
- SVG는 `import {ReactComponent as IconName} from './icon.svg'` 대신 vite-plugin-svgr 방식인 `import IconName from './icon.svg?react'`를 사용한다.
- strict TypeScript, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`를 전제로 타입을 작성한다.
- `noUnusedParameters: true` — 미사용 파라미터는 `_` 접두사를 붙인다.
- TypeScript 오류가 있는 채로 완료를 선언하지 않는다. current source의 `typecheck` machine receipt PASS가 완료 조건이다.
- source 변경으로 기존 receipt와 qa-manifest가 stale이므로 release 전 `/web-verify`를 다시 실행한다.
