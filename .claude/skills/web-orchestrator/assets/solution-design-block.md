# solution-design 블록 — 형식 예시

`references/solution-design-contract.md`가 참조하는 블록 예시다. **형식을 임의로 바꾸지 않는다** —
Stage 1에서 이 블록이 스팩 확정 아티팩트로 승격된다.

계약 본문에서 여기로 옮긴 이유는 활성 참조 400줄 상한이다(`validate-modularity`가 제시한 두
방법 중 「asset으로 만든다」). 내용은 한 줄도 바꾸지 않았다.

````
```json web-harness:solution-design
{
  "stage": 0,
  "targetShapes": ["web-app|library|cli|<기타>"],
  "constitution": {"substrate": {"<키>": {"value": "...", "source": "default|measured|declared", "rationale": "declared면 필수"}}},
  "communication": ["rest|graphql|websocket|sse|streaming"],
  "concurrency": ["web-worker|service-worker|worker-thread"],
  "architecture": {"pattern": "fsd|layered|domain-modules|existing|<기타>", "rationale": "..."},
  "layerMap": {"<논리 레이어>": "<실제 경로>"},
  "designPreview": {                     // 선택 — 없으면 프리뷰를 기본 실행한다
    "policy": "required|skip",
    "rationale": "<skip이면 필수 — 기본을 끄는 것은 판단이다>"
  },
  "designSource": {                      // 선택 — 디자인 값이 있는 산출물에만
    "kind": "figma|markup|inline|none",
    "ref": "<원본 식별자>",
    "tokenFormat": "dtcg|css-vars|none",
    "tokenPath": "<프로젝트 내 토큰 파일 경로>",
    "readable": true,                    // **실측이다.** 링크의 존재가 아니라 이 런타임의 호출 가능 여부
    "modes": [{"name": "<모드>", "selector": "<토큰 파일에서 찾을 부분 문자열>"}]
  },
  "testLayers": {"unit": "<유닛 테스트 경로>", "e2e": "<e2e 경로 — UI가 있으면 필수>"},
  "libraries": {"<역할>": {"choice": "...", "alternatives": ["..."], "source": "measured|measured-absent|proposed"}},
  "moduleBoundaries": [{"scope": "<glob>", "rationale": "..."}],
  "acceptanceSource": "feature-plan|absent",
  "acceptanceRefs": ["FEAT-001", "TC-001-1"],
  "nonGoals": ["..."],
  "openDecisions": [{"id": "...", "question": "...", "options": ["..."], "recommended": "...", "status": "open|assumed|confirmed"}]
}
```
````
