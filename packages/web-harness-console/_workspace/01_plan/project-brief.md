# Project Brief — Web Harness Console

Web Harness Console은 여러 서비스의 02_design까지의 작업 문서와 디자인 프리뷰를 모아 보여주는 로컬 도구다. 문서 탐색, FEAT/TC 요약, preview 상태, 세션 기준 변경점을 제공한다. 기존 정본 산출물은 수정하지 않으며, 사용자의 변경 의도만 `_workspace/01_plan/change-requests/`에 append-only로 기록한다. 별도 preview origin으로 prototype을 격리한다.

- Effort: M
- Drivers: filesystem indexing, safe path/write boundary, two-origin server, document/feature/change UI
- Recommendation: invest
- Smallest visible slice: 프로젝트 목록 → 문서 보기 → nocode-builder MISSING preview 확인
- Deferred: 정식 디자인 승인·상태 전이, approved design version 발행, dev/qa indexing

## 2026-08-07 부기 — 범위 진화

원문 작성 이후 Console은 변경 의도 기록을 넘어, 격리 candidate에 대한 승인 게이트 정본 승격(PC-011)과 승인 전 Change Request 물리 삭제(PC-015)까지 수행한다. apply는 server-created temporary candidate에서만 실행되고 `APPROVED` review만 digest 검증을 거쳐 정본에 반영된다. 실행기는 Codex CLI 외에 Claude Code CLI를 지원한다(auto 폴백). 정식 디자인 승인·상태 전이와 approved design version(design-v*) 발행은 여전히 Deferred다. 원문은 수정하지 않는다.
