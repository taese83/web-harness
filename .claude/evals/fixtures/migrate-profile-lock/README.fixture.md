# fixture: migrate-profile-lock

`root-locked-profile.json`은 옛 판본이 모노레포 **루트**에서 잠근 `react-vite-spa` 프로필이다(경로·증거는 중립 이름으로 바꿨다).
어댑터 `sha256`이 지금 내장 어댑터와 같아야 잠금 검증이 PACKAGE_MISSING까지 간다 — 어댑터를 고쳐 테스트가 `refuse`로 뒤집히면
`web-core/resolve-profile.mjs --project-root <react·vite를 루트에 둔 임시 프로젝트> --requested react-vite-spa` 출력의 `adapter`
블록으로 갈아 끼운다. `diagnoseRootLock`은 sha와 무관하게 어댑터 id로 본다(`test-migrate-profile-lock`이 둘 다 고정).
