# Web Harness Execution Contract

웹 작업의 공통 phase 경계와 안전 규칙이다. 개발 상세는 `buildable-app-contract.md`, QA 상세는 `qa-evidence-contract.md`에서 해당 phase에만 읽는다.

## Agent invocation

- `.claude/agents/{agent-name}.md`가 agent별 source of truth다.
- Task/subagent tool이 있으면 frontmatter `name`과 같은 `subagent_type`으로 호출한다.
- subagent tool이 없으면 현재 agent가 같은 입력·출력·소유권 계약을 지켜 수행한다.
- subagent 능력은 실행 harness마다 다르다 — 호출 전에 필요한 tool·모델 가용성을 확인한다. subagent에서 web research/fetch가 불가한 harness에서는 그 조사를 **main 세션에서 수행**하고, harness가 요구하는 모델 override가 있으면 적용한다. subagent가 부분 능력·실패로 계약을 못 채우면 현재 agent가 같은 계약으로 직접 완결한다.
- 이전 phase 필수 산출물이 존재하기 전에는 다음 phase를 시작하지 않는다.

## Workspace

source ingestion 또는 Phase 1 전에 다음을 준비한다.

```bash
mkdir -p _workspace/00_source _workspace/01_plan _workspace/02_design _workspace/03_dev _workspace/04_qa _workspace/RELEASE
```

## Safety gates

다음 작업은 먼저 사용자 확인이 필요하다. Agent는 확인 후에도 raw package-manager/VCS 명령을 실행하지 않고 `run-package-operation.mjs`의 typed operation과 `run-git-inspection.mjs`를 사용한다.

- 비어 있지 않은 target에 생성하거나 기존 파일 덮어쓰기
- dependency metadata 변경과 lockfile/install, Git 초기화, Husky/MSW 초기화
- 장시간 dev server 실행
- 삭제, 실제 deploy, push/PR, publish, 외부 API mutation

합의된 빈 target의 mock-only 생성, `_workspace` 산출물 작성, 로컬 문서 읽기는 별도 확인 없이 진행할 수 있다. 배포 target이 확정된 workflow template 작성은 허용되지만 실제 배포와 secret 설정은 허용되지 않는다.

## Source immutability

사용자가 제공한 PRD, 디자인, API 문서는 read-only source of truth다.

- 원본을 수정·이동·이름 변경·재포맷하지 않는다.
- 정규화 결과와 가정은 `_workspace`에만 쓴다.
- 원본 수정 제안은 `_workspace/00_source/source-change-proposals.md`에 기록한다.
- 원본 수정은 사용자가 명시적으로 요청한 별도 작업으로 처리한다.

기존 문서가 있으면 `source-artifacts.md`를 읽고 `source-artifact-ingestor`를 먼저 실행한다. consumed source index, gap report, source trace를 남기고 `BLOCKER`가 있으면 Phase 3으로 진행하지 않는다.

## Resume and phase skip

1. Plan과 Design 필수 파일이 모두 있으면 Phase 3부터 시작한다.
2. Plan만 완성됐으면 Phase 2부터 시작한다.
3. 외부 source만 있으면 먼저 정규화한 뒤 같은 규칙을 적용한다.
4. documented non-blocking assumption만 허용한다.
5. phase를 건너뛰어도 이후 phase의 input completeness를 다시 확인한다.
6. 공급원이 `absent`인 단계는 "건너뛴 것"이 아니라 "없는 것"이다 — 1~2를 적용하지 않고 `specTier`가 상태를 들고 간다. 나중에 붙이면 스팩이 stale이 되어 재확정하고 1~2로 돌아온다(`provenance-contract.md`).
## Iterate mode (이미 만들어진 프로젝트의 범위 좁힌 변경)

buildable한 기존 프로젝트에 `request-type-contract.md`가 `change`·`fix`·`verify` 레인으로 매핑하는 요청(`feature`·`ui-change`·`api-integration`·`infrastructure`·`bug-fix`·`refactor`·`verification-only`)이 오면 Phase 1~2 intake·mode 배너·workspace 재생성을 라운드마다 반복하지 않고 아래 경량 루프로 수행한다. Plan/Design 산출물은 최초 1회만 만들고 이후 라운드는 재사용한다.

1. 요청에 새 문서·링크·시안·Figma가 붙어 있으면 **레인 고정 전에** 공급 감지를 수행한다(`provenance-contract.md` §6 — 기존 산출물이 있으므로 `00_source/` 기록까지만). 그다음 `request-type-contract.md`로 **레인**을 고정하고 레인·게이트를 1줄로 알린다(생략 금지). `fix`는 같은 계약의 자기검사를 먼저 통과해야 한다.
1-A. `change` 레인이면 `approval-checkpoints.md`의 「change 레인 → 개발」(기획 개정 → 디자인 델타 감지 → 개정 → 스팩 → **✋승인**)을 수행한다. **확인 전에는 source edit를 시작하지 않는다.** `fix`·`verify`는 건너뛴다. 승인 뒤에는 `development-gates-contract.md`의 **Gate 0**(개발 착수 준비)을 돌린다 — Iterate는 Phase 3을 거치지 않으므로 여기서 걸지 않으면 그 관문이 도달 불가다.
2. `minimal-change-contract.md`의 change brief를 `_workspace/03_dev/change-scope.md`에 **라운드별 1항목 append**하고 그 계약대로 편집한다. `CAPABILITY_ESCALATION`·`DOCS_TO_UPDATE`를 포함한 전 필드를 기록한다. `change`는 `DOCS_TO_UPDATE`를 1-A의 감지 결과로 채운다 — 사후 추측이 아니다.
3. `development-gates-contract.md`의 게이트(typecheck·lint·test·build)를 프로젝트 toolchain pin으로 실행한다.
4. 런타임 검증은 아래 **Runtime verifiability**를 따른다.
5. **라운드 종료 게이트 3종** — 미충족이면 완료로 선언하지 않고 상태를 보고에 표기한다. 레인·진입 방식과 무관하게 같은 계약이며 세부는 `qa-evidence-contract.md`의 Iterate evidence가 canonical이다. ① 승격 QA: `CAPABILITY_ESCALATION: detected`면 `security-reviewer`(+서버 계약이 생겼으면 `api-contract-verifier`) 재투입, 불가하면 `BLOCKED (사유)` ② Evidence 재발급: `_workspace/04_qa/evidence/`가 있으면 `run-quality-gates.mjs --project {root} --all`로 재발급, 불가하면 `STALE` ③ 문서 동기화: `DOCS_TO_UPDATE`가 `none`이 아니면 나열된 `02_design` 문서 개정 완료, 남으면 `PENDING`.
6. 완료 보고에 changed files·보존 contract·scope deviation·요청 외 변경(있으면 승인 근거)·evidence와 게이트 3종 상태를 남긴다.

신규 화면·데이터 계약·아키텍처 변경이 필요하면 그 부분만 해당 Phase 에이전트로 승격한다. full Phase 4 attestation·release manifest는 iterate 라운드의 기본 산출물이 아니며 배포 후보를 낼 때만 `qa-evidence-contract.md`로 승격한다.

## Runtime verifiability

각 acceptance criterion을 `LOCAL_VERIFIABLE`(정적 preview/dev에서 재현 가능) 또는 `DEPLOY_ONLY`(인증 뒤 화면·serverless function·server DB·device sensor 등 로컬 정적 서버에서 재현 불가)로 라벨한다.

- `LOCAL_VERIFIABLE`은 브라우저/CLI 증거로 직접 확인한다.
- `DEPLOY_ONLY`는 **은닉하지 않는다** — fixture 주입이 가능하면 `auth-verification-contract.md`로 검증하고, 불가하면 change-scope의 `TEST_EVIDENCE`에 `DEPLOY_ONLY — 사용자 위임`으로 명시한다. 미검증 경로를 표면 PASS로 보고하지 않는다.
- 게이트(로컬 정적 서버 등) 때문에 로컬에서 볼 수 없는 UI를 fake state 주입으로 **외형만** 확인했다면 그것은 UI smoke이지 그 기능의 검증 PASS가 아니다 — 데이터·권한 경로는 여전히 `DEPLOY_ONLY`다.

## Deployment CI

- 사용자가 요구했거나 `tech-stack.md`에 target이 있을 때만 `environment-scaffolder`를 실행한다.
- workflow/config 변경은 final quality evidence 전에 끝낸다.
- target이 불명확하면 workflow 작성 전에 한 번 확인한다.
- 필요한 repository secret과 수동 절차를 HANDOFF에 기록한다.
- 실제 deploy, cloud 설정, secret 생성, push는 수행하지 않는다.

## Canonical conditional contracts

- local domain state: `local-domain-state.md`
- external ingestion: `external-data-ingestion.md`
- timeseries: `.claude/skills/timeseries-dashboard/references/`

같은 규칙을 이 파일에 복제하지 않고 각 canonical contract를 따른다. Phase별 조건부 reference 로딩도 SKILL.md의 읽기 지시가 canonical이다.

## Required outputs

| Phase | Required outputs |
|---|---|
| Source | existing artifact가 있으면 `source-index.md`, `gap-report.md`, 필요 시 `source-change-proposals.md` |
| Plan | requirements, UX brief, tech stack, feature plan, project brief |
| Design | design system, layout, component, API schema와 활성 mode별 contract |
| Develop | 선택한 project root 아래 buildable application, 기존 source 수정이면 `_workspace/03_dev/change-scope.md` |
| Deploy CI | 요구된 경우에만 deploy workflow/config |
| QA | base QA reports, machine receipts, conditional QA reports, signed attestation, manifest v3 |
| Release | 모든 hard gate 통과 후 `_workspace/RELEASE/HANDOFF.md` |
