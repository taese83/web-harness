# Solution Design — 평가용 브라운필드

기존 코드를 실측해 확정한 작은 앱이다. 수용 기준은 `01_plan/feature-plan.md`의 TC다(`specTier: verifiable`).

```json web-harness:solution-design
{
  "targetShapes": ["web-app"],
  "constitution": {"conventions": []},
  "architecture": {"pattern": "existing", "rationale": "기존 관례 — 앱·화면·공유 세 층"},
  "layerMap": {"app": "src/app", "pages": "src/pages", "shared": "src/shared"},
  "testLayers": {"unit": "src", "e2e": "e2e"},
  "libraries": {},
  "moduleBoundaries": [],
  "acceptanceSource": "feature-plan",
  "acceptanceRefs": ["TC-001-1"],
  "nonGoals": [],
  "openDecisions": []
}
```
