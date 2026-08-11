# Tech Stack — Web Harness Console

- Runtime: Node.js `>=22.22.0`
- Package manager: pnpm `11.18.0`
- UI: dependency-free HTML/CSS/ES modules
- Server: Node `http`, `fs`, `path`, `crypto`
- Tests: built-in `node:test`
- Deployment: none; localhost-only developer tool
- Bindings: Console `127.0.0.1:4310`, preview origin `127.0.0.1:4311`
- External dependencies: none

## Architecture Decision

일반 배포 앱이 아니라 저장소 control-plane이므로 built-in web deployment profile을 사용하지 않는다. 브라우저에 filesystem 권한을 주지 않고 Node server가 allowlisted read-only API를 제공한다. 프리뷰는 module script 호환성과 Console origin 격리를 동시에 만족하도록 별도 localhost origin에서 서빙한다.

## Test Strategy

- indexer unit test: discovery, phase allowlist, feature parsing, changes
- server integration test: API, traversal rejection, preview origin
- static source check와 실제 localhost smoke
