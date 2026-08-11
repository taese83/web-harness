# Visual QA Contract

## Required artifacts

`visual-contract-designer`는 사람이 읽는 `visual-qa-contract.md`와 machine-readable `visual-qa-contract.json`을 함께 만든다. JSON은 `.claude/schemas/visual-qa-contract.schema.json`을 따른다.

## Target contract

각 target에 다음을 기록한다.

- stable `id`
- `route | story | component`
- route 또는 story locator
- fixture와 UI state
- 적용 mode ID
- baseline PNG path
- design reference ID
- blocking 여부와 owner

최소 상태는 적용 가능한 `default`, `loading`, `empty`, `error`, `permission-denied`, `long-content`다. 모든 조합을 만들지 말고 정보 손실·브랜드·레이아웃 위험을 기준으로 선택한다.

## Reference contract

reference는 `figma-node | image | specification | none` 중 하나다.

- Figma: file key를 노출하지 않는 stable reference ID와 node URL/ID
- local image: project-relative path와 SHA-256
- specification: source document path와 section
- none: greenfield이며 승인된 rendered prototype이 source임을 명시

Figma Remote MCP를 사용할 수 있으면 frame, component, variable context를 읽고 Code Connect mapping을 기록한다. 연결이 없으면 export를 사용하며 원격 URL을 읽었다고 주장하지 않는다.

Pixel-perfect Figma 일치를 범용 hard gate로 사용하지 않는다. text rendering과 responsive semantic change는 structural assertion, token mapping, controlled screenshot diff, human review를 함께 사용한다.

## Token contract

design token source가 있으면 DTCG 2025.10 compatible JSON path와 다음 mapping을 기록한다.

```text
Figma variable → design token → CSS variable → MUI/theme consumer
```

DTCG type/value field, alias resolution, cycle, missing theme variant, hard-coded bypass를 검증한다. DTCG report를 W3C Recommendation으로 표현하지 않는다.

## Machine evidence

browser receipt의 `visualEvidence`에는 다음이 있어야 한다.

- contract와 baseline manifest SHA-256
- visual assertion이 있는 test path와 assertion count
- baseline path, current SHA-256, approval metadata
- platform/architecture, locale, timezone, DPR, browser family
- viewport/theme/locale/state coverage
- threshold와 stability policy
- validation errors

Markdown이나 모델 기억은 machine evidence를 대체하지 않는다.
