# Web Harness Control Plane

이 디렉터리가 배포 가능한 Web Harness의 canonical source of truth다.

## 다른 프로젝트에 적용

저장소 루트에서 다음 명령을 사용한다.

```bash
node .claude/scripts/deploy-harness.mjs --target <existing-child-project>
```

배포기는 source 검증, symlink 차단, 기존 `.claude` 덮어쓰기 차단, staging 후 atomic promotion, target 재검증을 수행한다. `skills`만 복사하지 않는다. agents, scripts, evals, adapters, schemas, settings, toolchain pin이 함께 있어야 MSW 초기화, OpenAPI 선택 적용, profile resolution, QA receipt와 release gate가 동작한다.

## 이식 후 시작

1. `node .claude/scripts/validate-harness.mjs`
2. `/web-plan`으로 제품 중심 intake, UX 위험, 데이터 전략, 상대 노력도와 준비도를 먼저 검토하거나 `/web-orchestrator`로 전체 lifecycle 시작
3. 기존 서비스는 감지된 `CHANGE_MODE: existing-change`와 integration overlay를 확인
4. API가 있으면 `/api-connect`가 기존 client/generator를 보존하고 선택 endpoint만 채택
5. `/web-verify`로 machine receipt와 read-only QA 수행
6. Figma/reference image, 시각 회귀, theme/viewport 검증은 `/visual-design-verify`로 contract와 승인 baseline을 추가

## 경로 규칙

- `.claude/`는 Claude Code용 canonical control plane이다.
- `.agents/`, `.codex/`가 로컬에 있더라도 runtime adapter 또는 작업 사본으로 취급하며 canonical 파일을 대신하지 않는다.
- **adapter는 직접 수정하지 않는다** — `.agents`는 `node .claude/scripts/build-adapters.mjs`로만 재생성한다 (skills/adapters/evals/ai-harness.json을 canonical에서 verbatim 미러). drift는 `validate-harness.mjs`가 byte 단위로 검출해 실패시킨다.
- 새 skill/agent는 먼저 `.claude`에 추가하고 `validate-harness.mjs`를 통과시킨 뒤 adapter를 재생성한다.
- 스킬 문서를 수정하면 해당 SKILL.md frontmatter의 `metadata.version`을 올리고 `changelog`를 한 줄 남긴다 (`metadata.version`은 validator 필수 필드).

## 프로젝트별 설정

기존 프로젝트의 package manager, app root, alias, UI library, API client, auth/service context, MSW activation, OpenAPI generator는 탐지 결과와 `_workspace/02_design/integration-overlay.json`에 기록한다. 불명확한 항목은 한 번에 최대 3개 질문으로 확인하며, 기존 공개 계약을 추측으로 교체하지 않는다.
