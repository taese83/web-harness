---
name: wh
description: Web Harness 단일 진입점. 요청을 new/change/fix/verify 레인으로 판정해 해당 흐름을 실행한다. 새 서비스 생성, 기능 추가·UI 변경, 버그 수정·리팩터, 검증 전부 여기서 시작한다. 레인을 강제하려면 "/wh change ..."처럼 첫 단어로 지정한다. new 레인은 착수 전 기획·디자인·설계의 공급원(문서·링크·Figma가 있다 | 글로 설명 | 하네스가 만든다 | 없이 진행)을 묻는다.
argument-hint: "[new|change|fix|verify] <요청>"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, Agent, AskUserQuestion
metadata:
  version: 1.1.0
  maturity: contract-only
  updated: 2026-09-02
  changelog: new 레인 착수 전 공급원 3문항(§1-B) — 기획·디자인·설계를 문서/링크·글로 설명·하네스가 만든다·없이 진행 중에서 고른다. 이전 — 신설: 진입점을 하나로 모으고 레인별 게이트를 명시한다.
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

### 1-B. 공급원 확인 — `new` 레인에서만

종전에는 `new`가 곧 "Phase 1부터 전부 만든다"였다. 그래서 **이미 PRD와 시안을 가진 사용자는
같은 것을 다시 만들라는 요구**를 받았고, 기획을 세울 생각이 없는 사용자에게는 우회 말고
길이 없었다. 우회하면 게이트가 통째로 빠진다 — 이 스킬이 존재하는 이유와 정반대다.

그래서 `new`는 착수 전에 **각 단계의 공급원을 묻는다**(정본:
`../web-orchestrator/references/provenance-contract.md` §1).
`change`·`fix`·`verify`는 이 3문항을 묻지 않는다 — 산출물이 이미 있거나 source를 바꾸지 않는다.
**다만 어느 레인이든 요청에 새 문서·링크·시안·Figma가 붙어 있으면 먼저 정규화한다**
(`provenance-contract.md` §6). 진입 방식이 게이트 강도를 바꾸지 않듯, 사용자가 준 것을
읽을지 말지도 바꾸지 않는다. 브라운필드 첫 작업은 설계 공급원 **1문항만** 묻는다(§7).

`interaction-contract.md`에 따라 **한 번에 최대 3문항**이고, 요청에서 이미 답이 나온 항목은
묻지 않고 채워서 보여준 뒤 확인만 받는다(경로·URL·이미지가 붙어 있으면 ①로 채운다).

| 단계 | 선택지 | 공급원 |
|---|---|---|
| **기획** | ① 기획 문서·링크가 있다 | `supplied` |
| | ② 지금 글로 설명하겠다 | `supplied` |
| | ③ 하네스가 만들어줘 | `generated` |
| | ④ 없이 진행 | `absent` |
| **디자인** | ① 디자인 자료가 있다 — 문서·링크·시안 이미지·Figma MCP | `supplied` |
| | ② 지금 글로 설명하겠다 | `supplied` |
| | ③ 하네스가 만들어줘 | `generated` |
| | ④ 없이 진행 | `absent` |
| **설계·스팩** | ① 설계 문서가 있다 | `supplied` |
| | ② 지금 글로 설명하겠다 | `supplied` |
| | ③ 하네스가 세워줘(`system-architect`) | `generated` |

**설계·스팩에는 ④가 없다.** 소유권 경계가 스팩에서 나오므로 스팩이 없으면 경계도 없다 —
어느 공급원을 골라도 `spec.mjs` 확정은 통과해야 한다(`solution-design-contract.md` §0-1).
설계는 세 값 모두 `system-architect`가 기계 블록을 쓴다 — 공급원이 가르는 것은 **누가 쓰느냐가
아니라 무엇을 근거로 쓰느냐**다(`provenance-contract.md` §1). ①을 고르면 사용자 문서가 우선
입력이 되고, 문서와 다르게 가야 하면 `openDecisions`로 올려 되묻는다.

디자인 ①을 고르면 자료의 형태(문서·링크·시안 이미지·Figma MCP)를 한 번 더 확인한다.
읽을 수 있다고 가정하지 않는다 — 처리 절차는 `../web-orchestrator/references/source-artifacts.md`가 정본이다.

**④를 고르면 그 자리에서 대가를 함께 보여준다**(`provenance-contract.md` §2):
`specTier: unverifiable` · 팀 인계와 티켓 청구 차단 · 종료 조건이 실행 예산뿐. 대가를 모른 채
고른 선택은 선택이 아니다. 대신 **나중에 붙일 수 있다** — `provenance-contract.md` §3 지연 공급이 그 경로다.

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
| `new` (기획·디자인 `generated`\|`supplied`) | `../web-orchestrator/SKILL.md`의 Phase 1~4 | Phase 1·2 체크포인트 |
| `new` (기획 또는 디자인 `absent`) | 같은 SKILL의 공급원 조합 실행 — `absent` 단계의 wave만 건너뛰고 Phase 3·4는 동일 | `approval-checkpoints.md`의 「기획·디자인 `absent` 진입 → 개발」 |
| `change` | `../web-orchestrator/references/execution-contract.md`의 Iterate 루프 | **1-A ✋스팩 승인**(`approval-checkpoints.md`) |
| `fix` | 같은 Iterate 루프, 1-A 건너뜀 | 유형별 보존 증거 |
| `verify` | `../web-verify/SKILL.md` | read-only 경계 |

레인이 정해진 뒤에는 해당 문서가 정본이다. 이 스킬은 판정·표시·위임만 한다 —
**게이트를 여기서 다시 정의하지 않는다**(두 곳에 적으면 갈라진다).

## 하지 않는 것

- 레인 표시 생략
- `fix` 자기검사 없이 `fix` 진행
- `change` 레인에서 승인 없이 source edit
- `new` 레인에서 공급원을 묻지 않고 착수
- 사용자가 고르지 않았는데 기획·디자인을 `absent`로 처리
- 설계·스팩 단계에 `absent` 선택지를 제시
- `absent`의 대가(`specTier: unverifiable` · 인계 차단 · 종료 조건 부재)를 알리지 않은 채 진입
- 게이트 재정의(레인 문서가 정본)
