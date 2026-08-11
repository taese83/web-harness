# workspace/ — 개발 산출물 워크스페이스

하네스가 만들거나 다루는 프로젝트를 모아두는 곳이다. **이 README를 제외한 전체가 VCS 제외 대상**(.gitignore `workspace/*`) — 여기 있는 프로젝트는 각자 자기 저장소(GitHub 등)로 버전 관리한다.

## 두 가지 사용 모드

### 1. 하네스 세션에서 생성/작업 (기본)

세션의 작업 디렉터리를 **web-harness 루트**에 두고 skill을 실행한다.
루트의 `.claude` control plane(스킬/에이전트/hook)이 로드된 상태에서, 산출물만 이 폴더에 생긴다.

```text
/web-orchestrator 관리자가 주문을 조회·변경하는 웹 서비스를 만들어줘. 위치는 workspace/order-admin
```

### 2. 기존 GitHub 프로젝트에 하네스 이식

clone을 이 폴더에 두고, control plane을 그 프로젝트 안으로 배포한 뒤 **프로젝트 디렉터리에서** 세션을 연다.

```bash
git clone <repo-url> workspace/my-service
node .claude/scripts/deploy-harness.mjs --target workspace/my-service
cd workspace/my-service   # 이후 세션은 여기서 — 배포된 .claude가 로드된다
```

주의: 배포 후 target 재검증이 toolchain pin(Node/pnpm)을 요구한다 — pin이 다른 프로젝트는 배포가 거부되므로 먼저 정렬할 것.

## 규칙

- `_workspace/`(하네스가 각 프로젝트 내부에 만드는 기획·설계·QA 산출물 디렉터리)와는 다른 폴더다 — 언더스코어 유무로 구분.
- 새 앱 생성 위치는 `workspace/<이름>` — 루트에 직접 만들지 않는다.
- clone된 프로젝트의 커밋/푸시는 각 프로젝트의 저장소 기준으로 한다 (web-harness에는 어떤 흔적도 남지 않음).
- eval 실행 산출물은 여기가 아니라 `eval-runs/`에 생긴다 (run-eval-executor.mjs가 관리).
