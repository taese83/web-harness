---
name: wh
description: Web Harness 단일 진입점. 요청을 new/change/fix/verify 레인으로 판정해 해당 흐름을 실행한다. 새 서비스 생성, 기능 추가·UI 변경, 버그 수정·리팩터, 검증 전부 여기서 시작한다. 레인을 강제하려면 "/wh change ..."처럼 첫 단어로 지정한다.
argument-hint: "[new|change|fix|verify] <요청>"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, Agent, AskUserQuestion
metadata:
  version: 1.0.0
  maturity: contract-only
  updated: 2026-08-29
  changelog: 신설 — 진입점을 하나로 모으고 레인별 게이트를 명시한다.
---

# wh — Web Harness 진입점

**선행 로드**: `../web-orchestrator/references/request-type-contract.md`(레인·게이트·`fix` 자기검사).
나머지는 레인이 정해진 뒤 그 레인의 시점 로드를 따른다.

## 왜 진입점이 하나인가

같은 일에 진입점이 여럿이면 경로마다 게이트가 갈라진다. 실제로 그런 일이 있었다 —
`/web-orchestrator`의 Iterate 경로에는 승인 게이트가 없고 배너까지 생략됐는데,
체크포인트가 있는 `/feature-add`는 "직접 부르지 않는다"고 안내돼 있었다.
**보호가 있는 길이 안내되지 않는 길이었다.**

진입점을 하나로 모으면 게이트는 레인이 정하고, 레인은 항상 표시된다.

## 실행

### 1. 레인 판정

첫 단어가 `new`·`change`·`fix`·`verify` 중 하나면 그 레인으로 **강제**한다.
아니면 `request-type-contract.md`의 레인 표로 판정한다:

- 대상이 비어 있거나 새 서비스 → `new`
- **동작이 새로 정의된다**(기능 추가·UI 변경·API 연결) → `change`
- **동작을 보존한다**(버그 수정·리팩터) → `fix`
- source를 바꾸지 않는다 → `verify`

`fix`로 판정했거나 강제됐으면 **자기검사를 먼저 통과해야 한다** — 항목은
`request-type-contract.md`가 정본이다(여기에 옮겨 적지 않는다. 갈라진다).
하나라도 걸리면 `fix`를 거부하고 `change`로 승격하며 그 사유를 표시한다.

`new`로 판정했는데 대상에 이미 프로젝트가 있으면 진행하지 않고 한 번 확인한다.

### 2. 레인 표시 — 생략하지 않는다

```
🔍 {lane} 레인 — {한 줄 근거}
   {그 레인에 걸리는 게이트}
   (다르면 /wh {other-lane} ...)
```

경량 경로라는 이유로 생략하지 않는다. 사용자가 무슨 보호를 받는지 알아야 이의를 제기할 수 있다.

### 3. 레인별 실행

| 레인 | 실행 | 게이트 |
|---|---|---|
| `new` | `../web-orchestrator/SKILL.md`의 Phase 1~4 | Phase 1·2 체크포인트 |
| `change` | `../web-orchestrator/references/execution-contract.md`의 Iterate 루프 | **1-A ✋스팩 승인**(`approval-checkpoints.md`) |
| `fix` | 같은 Iterate 루프, 1-A 건너뜀 | 유형별 보존 증거 |
| `verify` | `../web-verify/SKILL.md` | read-only 경계 |

레인이 정해진 뒤에는 해당 문서가 정본이다. 이 스킬은 판정·표시·위임만 한다 —
**게이트를 여기서 다시 정의하지 않는다**(두 곳에 적으면 갈라진다).

## 하지 않는 것

- 레인 표시 생략
- `fix` 자기검사 없이 `fix` 진행
- `change` 레인에서 승인 없이 source edit
- 게이트 재정의(레인 문서가 정본)
