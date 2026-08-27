---
name: version-bump
description: Analyzes git history and code changes to determine the correct semantic version bump, then updates local version files after user-safe gates. Works for versioned deployable apps and npm libraries. Invoke with /version-bump.
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, Agent, AskUserQuestion
argument-hint: "[대상 패키지 경로 (선택)]"
metadata:
  version: 1.0.0
  maturity: contract-only
  updated: 2026-07-27
  changelog: 최초 버저닝 — adapter 재생성·검증 체계 도입과 함께 일괄 부여.
---

# Version Bump

git 히스토리와 코드 변경을 분석해서 semantic version을 자동으로 결정하고 적용한다.

Read `references/semver-rules.md` and `.claude/skills/web-orchestrator/references/minimal-change-contract.md` before invoking `version-analyzer`. version, changelog, changeset 외 파일은 명시된 release contract가 요구할 때만 수정한다.

## Start

`/version-bump`를 호출하면 즉시 시작한다. 추가 질문 없이 분석부터 실행한다.

단, 다음 상황에서는 실행 전 확인한다:
- major bump로 판단된 경우 → "major 버전업입니다. 진행할까요?"
- 현재 브랜치가 main/master가 아닌 경우 → "현재 {브랜치}에서 실행 중입니다. 계속할까요?"
- uncommitted changes가 있는 경우 → "커밋되지 않은 변경사항이 있습니다. 먼저 커밋하거나 stash하세요."

## Workflow

1. 프로젝트 유형 판단:
   - `environment-scaffolder` 산출물 또는 `.changeset/` 폴더 존재 → 라이브러리
   - private 웹 앱이면 문서화된 release/version 정책 존재 여부 확인
   - versioned public contract와 app release policy가 모두 없으면 bump 없이 종료

2. `version-analyzer` 에이전트 실행

3. `environment-scaffolder` 에이전트 실행

4. 결과 출력 후 `environment-scaffolder` 에이전트로 로컬 파일만 적용:
   - 웹 앱: `package.json` 버전 업데이트 → `CHANGELOG.md` 업데이트 → commit/tag 명령 제안
   - 라이브러리: `.changeset/` 파일만 생성하고, package graph를 변경하는 changeset apply는 현재 app profile 범위 밖으로 `BLOCKED` 처리해 별도 typed library-release runner 또는 사용자 실행으로 넘긴다

5. 완료 메시지 출력

## 완료 메시지

```
✅ 버전 업데이트 완료

이전: v1.2.3
이후: v1.3.0  (minor)

변경 내용:
  [추가] 대시보드 필터 기능
  [수정] 차트 렌더링 오류

웹 앱:
  git push && git push --tags  ← 원격 반영 명령 (직접 실행하지 않음)

라이브러리:
  pnpm changeset publish  ← npm 배포 명령 (직접 실행하지 않음)
```

## Gotchas

- git push, git push --tags, npm publish, pnpm changeset publish는 사용자가 직접 실행한다. 이 skill은 로컬 변경까지만 처리한다
- git commit, git tag도 기본 실행하지 않는다. 사용자가 명시적으로 승인할 때만 별도 단계로 실행한다
- major 판단 시 반드시 사용자 확인 후 진행한다
- `.changeset/` 파일명은 `pnpm changeset` 명령이 생성하는 것과 동일한 랜덤 이름 형식을 따른다
