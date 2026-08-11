---
name: visual-design-verify
description: Builds and runs governed visual design verification for React/Vite and Next.js web applications. Use for design-to-code comparison, visual regression, Storybook state coverage, Playwright screenshots, responsive or theme matrices, Figma references, design-token drift, layout stability, and approved baseline changes.
argument-hint: "[project path or visual QA request]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, AskUserQuestion, Agent
metadata:
  version: 1.0.0
  maturity: eval-covered
  updated: 2026-07-27
  changelog: 최초 버저닝 — adapter 재생성·검증 체계 도입과 함께 일괄 부여.
---

# Visual Design Verify

시각 검증을 문서 리뷰가 아니라 재현 가능한 contract, test, baseline, evidence로 수행한다.

작업 전에 다음을 모두 읽는다.

- `references/visual-qa-contract.md`
- `references/render-matrix.md`
- `references/baseline-governance.md`
- `../web-orchestrator/references/qa-evidence-contract.md`
- `../web-orchestrator/references/minimal-change-contract.md`

## Activation

다음 중 하나면 `VISUAL_QA_MODE`를 활성화한다.

- 사용자가 시각 디자인, 디자인 QA, pixel diff, screenshot regression을 요청
- Figma node/export, reference screenshot, design QA note가 입력에 존재
- `DESIGN_PROTOTYPE_MODE`, L/XL 화면, 브랜드 핵심 공개 화면
- theme, locale, high-contrast, dense dashboard, editor, drag/resize가 존재
- `_workspace/02_design/visual-qa-contract.json`이 이미 존재

단순 비시각 library 작업에는 활성화하지 않는다.

## Workflow

### 1. Contract

`visual-contract-designer`가 다음을 만든다.

- `_workspace/02_design/visual-qa-contract.md`
- `_workspace/02_design/visual-qa-contract.json`

contract에 target, state, viewport, theme, locale, reference, threshold, stability, baseline policy를 고정한다. Figma 연결이 없으면 local export path와 SHA-256을 사용한다. 원격 URL을 읽을 수 있다고 가정하지 않는다.

### 2. Design checkpoint

`DESIGN_PROTOTYPE_MODE`에서는 ASCII를 시각 승인 증거로 사용하지 않는다. 최소 rendered prototype 또는 핵심 frame screenshot을 요구하고 `design-reviewer`가 contract coverage를 검토한다.

사용자에게 다음을 보여주고 구현 전에 확인한다.

- target/state/mode matrix
- 디자인 source와 코드 target의 mapping
- 결정적 렌더 환경
- baseline 승인자와 threshold/mask 예외

### 3. Test preparation

구현 완료 후 `visual-test-writer`가 테스트만 작성한다.

- component/state 격리가 유리하면 Storybook CSF story
- route/flow 검증은 Playwright `toHaveScreenshot()`
- 320 CSS px reflow, desktop, 적용 가능한 theme/locale/state
- font ready, frozen clock/data, disabled animation, stable network fixture
- CLS, focus obscuring, target size처럼 pixel diff만으로 판정할 수 없는 assertion

package/config/dependency 변경이 필요하면 해당 owner에게 반환한다. `visual-test-writer`가 package metadata를 직접 편집하지 않는다.

### 4. Baseline approval

`references/baseline-governance.md`를 적용한다. verifier는 snapshot을 만들거나 갱신하지 않는다.

baseline candidate는 verifier와 분리된 승인 환경에서 생성한다. 실제 snapshot 변경 전 사용자 또는 지정 reviewer에게 before/after/diff, target, 변경 사유를 보여주고 명시적 승인을 받는다. 승인 후에만 `visual-baseline-manager`가 `_workspace/02_design/visual-baseline-manifest.json`의 hash와 승인 metadata를 갱신한다.

승인되지 않은 baseline, hash mismatch, broad mask, 임의 threshold 완화는 `BLOCKED`다.

### 5. Verification

승인된 실행 context에서 quality runner를 실행한다.

```bash
node .claude/scripts/run-quality-gates.mjs --all --allow-host-execution
```

release 후보는 격리 CI에서 다시 실행한다. browser receipt의 `visualEvidence`가 contract, test assertion, baseline manifest와 현재 PNG hash를 결속해야 한다.

그 다음 read-only `visual-regression-verifier`를 실행해 `_workspace/04_qa/qa-visual.md`에 저장할 본문을 받는다.

### 6. Release

다음 중 하나면 release를 중단한다.

- visual contract가 있는데 `qa-visual.md` 또는 browser `visualEvidence`가 없음
- target/state/mode 또는 required baseline 누락
- baseline hash가 승인 manifest와 다름
- verifier 또는 quality command가 snapshot을 변경
- 환경, font, viewport, locale, timezone, theme가 contract와 다름
- unreviewed diff, excessive mask/threshold, CLS budget 초과

## Tool selection

- 기본: local Playwright screenshot comparison
- component state matrix: Vite/Next-Vite Storybook + `@storybook/addon-vitest` browser mode; a11y는 `test: 'error'`
- cloud cross-browser가 승인된 경우에만 Chromatic adapter
- Figma access가 승인된 경우에만 Remote MCP/Code Connect mapping
- AI vision review는 advisory finding만 허용하고 hard gate로 사용하지 않는다

Chromatic이나 Figma로 화면·디자인 데이터가 외부 전송될 수 있으면 사용 전에 데이터 경계와 사용자 승인을 확인한다.
