---
name: dev-orchestrator
description: Entry orchestrator for TypeScript projects. Classifies requests as web applications, React component packages, or pure TypeScript packages; delegates every web application lifecycle to /web-orchestrator and owns only the library workflows. Invoke with /dev-orchestrator followed by a project description or artifact paths.
argument-hint: "[project description or artifact paths]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, Agent, AskUserQuestion
metadata:
  version: 1.0.0
  maturity: eval-covered
  updated: 2026-07-27
  changelog: 최초 버저닝 — adapter 재생성·검증 체계 도입과 함께 일괄 부여.
---

# Dev Orchestrator

TypeScript 프로젝트의 **분류 라우터**다. 웹 애플리케이션은 즉시 `/web-orchestrator`에 위임하고, 이 문서는 React 컴포넌트 패키지와 순수 TypeScript 패키지의 수명주기만 정의한다.

기존 library source를 수정할 때는 `.claude/skills/web-orchestrator/references/minimal-change-contract.md`를 읽고 구현 agent에 change brief를 전달한다.

## 핵심 경계

- 프로젝트 유형을 결정하기 전에는 파일을 생성하거나 기존 산출물을 수정하지 않는다.
- `web-app`으로 판정되면 원문 요청, 대상 경로, 기존 문서 경로, 배포 요구를 손실 없이 `/web-orchestrator`에 전달한다.
- 웹의 intake, source/resume 판별, 설계, 개발, QA, release 규칙을 이 문서에 복제하지 않는다.
- 웹 위임 후에는 별도 agent를 실행하거나 웹 산출물을 보정하지 않고 위임 결과를 그대로 반환한다.
- 이 문서의 나머지 절차는 `react-component`와 `ts-util`에만 적용한다.

## Intake와 유형 판단

사용자 입력과 제공된 산출물에서 다음만 확인한다.

1. 만들 대상과 공개 API
2. 프로젝트 이름과 생성 위치
3. 기존 API/설계 문서 경로
4. npm 배포 여부와 대상 registry
5. React peer dependency 또는 특정 build format 요구

다음 순서로 분류한다.

1. 브라우저에서 실행되는 사이트·서비스·관리 화면이면 `web-app`
2. npm 패키지이며 React UI를 export하면 `react-component`
3. npm 패키지이며 프레임워크 독립 로직·타입을 export하면 `ts-util`
4. 판단할 증거가 충돌할 때만 한 번 질문한다

"라이브러리", "패키지", "npm"이라는 단어만으로 웹 서비스를 패키지로 오판하지 않는다. 배포 단위와 소비자가 브라우저 사용자면 웹, import하는 개발자면 라이브러리다.

## Web 위임

`web-app`이면 다음 호출만 수행한다.

`/web-orchestrator {사용자의 원문 요청과 모든 artifact 경로}`

위임 호출에는 추론으로 축약한 요약보다 사용자 원문을 우선 포함한다. 대상 경로와 기존 문서가 상대 경로라면 현재 작업 디렉터리를 함께 전달한다.

## Library workspace

라이브러리 유형이면 다음 디렉터리를 준비한다.

```bash
mkdir -p _workspace/00_source _workspace/01_plan _workspace/02_design _workspace/03_dev _workspace/04_qa _workspace/RELEASE
```

`_workspace/01_plan/project-type.md`에 아래를 기록한다.

- `TYPE: react-component | ts-util`
- `NAME`
- `REASON`
- `TARGET_REGISTRY`
- `SOURCE_ARTIFACTS`

기존 API 설계가 있으면 원본을 보존하고 `lib-api-designer`가 `_workspace/02_design/api-design.md`로 정규화한다. 기존 파일을 덮어쓰지 않는다.

## Library planning

순서를 지켜 실행한다.

1. `requirements-analyst` → 기능, 호환성, 지원 runtime, 비기능 요구
2. `ux-researcher` → 화면 UX가 아니라 API 발견성, 타입 추론, 오류 메시지, migration DX
3. `feature-planner` → public API 기준 Must/Should/Could
4. `tech-advisor` → module format, Node/browser matrix, bundler, test, release 전략
5. `planning-synthesizer` → `_workspace/01_plan/project-brief.md`
6. `lib-api-designer` → `_workspace/02_design/api-design.md`

각 단계는 앞 단계의 산출물이 존재하고 blocker가 없을 때만 진행한다.

## Library development

기존 source가 있으면 `CHANGE_MODE: existing-change`로 기록하고 첫 edit 전에 `_workspace/03_dev/change-scope.md`를 작성한다. 각 builder에는 `ALLOWED_PATHS`, 보존할 public export/type/runtime contract, `NON_GOALS`, 예상 파일 범위를 전달한다.

### React component package

1. `lib-scaffolder`가 package, TypeScript, build, test, Storybook 기반을 만든다.
2. 기반 완료 후 `lib-core-builder`와 `lib-story-builder`를 병렬 실행한다.
3. 구현과 story가 완료되면 `lib-docs-generator`가 사용법, 접근성, migration 예시를 작성한다.

### Pure TypeScript package

1. `lib-scaffolder`가 package, TypeScript, build, test 기반을 만든다.
2. `lib-core-builder`가 구현, 타입, 테스트, public export를 만든다.
3. `lib-docs-generator`가 사용법, 오류 계약, migration 예시를 작성한다.

두 유형 모두 공개 API를 먼저 확정하고 내부 구현을 그 계약에 맞춘다. package metadata나 export map을 기능 코드에 임시로 중복 선언하지 않는다.

## Publish preparation

1. `changeset-setup`으로 변경 기록 정책을 준비한다.
2. `package-publish-metadata`로 files, exports, types, sideEffects, provenance 경계를 확정한다.
3. 자동 publish가 명시적으로 요구된 경우에만 `publish-ci-writer`를 실행한다.
4. 실제 release가 요청된 경우에만 `version-analyzer` → `changelog-writer` → `version-file-updater` 순서로 실행한다.
5. version 또는 metadata 변경 뒤에는 이전 QA 결과를 재사용하지 않는다.

## Library QA

변경이 끝난 뒤 read-only verifier를 실행하고 반환 결과를 해당 QA 문서에 기록한다.

- `code-reviewer` → `_workspace/04_qa/qa-code.md`
- `test-writer`로 누락된 public contract test를 보강한 뒤 `test-executor` → `_workspace/04_qa/qa-test.md`
- `pack-verifier` → `_workspace/04_qa/qa-pack.md`

build, typecheck, lint, test, pack dry-run, publint, 타입 소비 fixture 중 하나라도 실패하면 release를 중단한다. 수정은 해당 owner agent에만 돌리고 동일 실패는 최대 두 번 재시도한 뒤 blocker로 보고한다.

모든 검증이 통과하면 `_workspace/RELEASE/HANDOFF.md`에 설치법, 지원 matrix, public exports, breaking-change 여부, publish 명령, 필요한 registry secret, rollback 절차를 기록한다.

## 안전 원칙

- 기존 디렉터리 덮어쓰기, dependency 대규모 변경, major version은 사용자 확인 후 진행한다.
- `npm publish`, git commit/tag/push, registry credential 설정은 명시적 승인 없이 실행하지 않는다.
- 테스트가 없거나 실행되지 않은 상태를 PASS로 기록하지 않는다.
- peer dependency와 개발 dependency를 혼동하지 않는다.
- `dist`, type declarations, source map, license 포함 여부를 pack 결과로 확인한다.
