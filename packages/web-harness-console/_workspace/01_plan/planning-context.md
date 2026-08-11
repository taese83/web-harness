# Web Harness Console — Planning Context

## Current Planning Memo

- 대상: web-harness 저장소 안의 서비스별 `_workspace/00_source`, `01_plan`, `02_design` 산출물과 디자인 프리뷰를 한 화면에서 확인하는 로컬 Console
- 주 사용자: web-orchestrator로 여러 서비스를 설계·개발하는 개발자와 기획·디자인 검토자
- 핵심 업무: 프로젝트 선택 → 문서 구조와 기능 목록 파악 → 디자인 프리뷰 확인 → 변경·승인 상태 확인
- 현재 pain: 산출물이 서비스별 폴더에 흩어져 있고, 프리뷰와 기획 FEAT/TC의 연결 및 변경 여부를 한눈에 보기 어렵다
- 성공 조건: `pnpm console` 한 번으로 로컬 서버가 열리고, 02_design까지만 인덱싱하며 기존 프로젝트를 수정하지 않는다

## UX Check

- 첫눈에 알 수 있어야 하는 것: 어떤 프로젝트가 있고 각 프로젝트의 Plan/Design/Preview 상태가 어떤지
- 다음 행동이 보이는가: 프로젝트 선택, 문서 열기, 프리뷰 보기, 새로고침
- 실수하거나 오해할 지점: `MISSING`이나 `STALE`을 승인 완료로 오해하는 것, Console이 원본 문서를 수정한다고 오해하는 것
- 먼저 정할 방향: 읽기 전용, 고밀도 3-pane 작업 화면, 상태는 색과 텍스트를 함께 사용
- 구현에서 확인할 것: 긴 문서/경로, 프리뷰 없음, 잘못된 traceability, 좁은 화면, 키보드 탐색

## Assumptions

- 로컬 저장소 root가 authoritative source다.
- 외부 네트워크·DB·인증은 사용하지 않는다.
- 변경점은 서버 시작 시점의 메모리 snapshot과 현재 파일을 비교한다. 영구 이력은 후속 범위다.
- Console 자체 디자인 프리뷰와 정식 디자인 승인은 사용자의 Console-first 결정에 따라 후속으로 미룬다.
