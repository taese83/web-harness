# Existing Project Integration Overlay

기존 프로젝트의 profile을 교체하지 않고 integration 지점만 구조화한다. 결과는 `_workspace/02_design/integration-overlay.json`에 기록하고 runtime schema로 검증한다.

```json
{
  "project": {
    "appRoot": ".",
    "packageManager": "pnpm",
    "aliases": {"@shared/*": "src/shared/*"},
    "router": "react-router"
  },
  "uiLibrary": {"package": "@mui/material", "themePath": "src/app/theme.ts", "uiLane": "mui", "vendoredUiPath": null},
  "api": {
    "clientImport": "@shared/api",
    "responseWrapper": null,
    "queryLibrary": "@tanstack/react-query",
    "authContext": null
  },
  "serviceContext": null,
  "modal": {"registryPath": null},
  "msw": {"directory": "src/mocks", "activationEnv": "VITE_MSW"},
  "openapi": {"source": null, "generator": "manual-types"}
}
```

## 원칙

- source와 package에서 감지된 값만 기록하고 불명확한 값은 `null` 또는 decision으로 남긴다.
- app root, package manager, alias, router, query library도 기존 명령·설정에서 감지하고 임의 기본값으로 덮어쓰지 않는다.
- 기존 API wrapper, response envelope, service/tenant context를 우회하는 두 번째 client를 만들지 않는다.
- UI library의 public API와 기존 shared component를 먼저 사용한다.
- 기존 MSW/OpenAPI generator가 있으면 새 도구를 추가하지 않는다.
- overlay 변경은 validator를 통과해야 하며 project profile과 충돌하면 `BLOCKER`다.
