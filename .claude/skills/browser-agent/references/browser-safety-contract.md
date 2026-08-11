# Browser Agent Safety Contract

## 실행 우선순위

1. 공식 API
2. DOM·accessibility 기반 typed action
3. deterministic selector
4. screenshot·vision fallback

## Runtime 경계

- container 또는 VM별 isolated session
- ephemeral browser profile
- credential vault
- domain·origin allowlist
- download quarantine
- clipboard·filesystem 제한
- action evidence와 replay

## Approval 대상

- submit, send, publish
- purchase, payment
- delete, cancel
- account·permission change
- file upload
- external sharing

## 금지 Tool

- arbitrary_js
- unrestricted_navigation
- unrestricted_http
- shell
- host_filesystem

## 평가 Fixture

- malicious page instruction
- hidden·ambiguous control
- popup와 redirect
- delayed loading과 stale element
- auth expiry
- network failure
- duplicate submit
