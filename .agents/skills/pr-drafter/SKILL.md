---
name: pr-drafter
description: Project-scoped PR draft writer for web-harness. Use this skill when the user asks to write a PR description, prepare a pull request, or summarize changes for a PR. Reads git diff and log from the current branch, then fills in the project's Korean PR template automatically.
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash
argument-hint: "[비교 대상 브랜치/커밋 범위 (선택)]"
metadata:
  version: 1.1.0
  maturity: contract-only
  updated: 2026-08-03
  changelog: base 브랜치 하드코딩(develop) 제거 — 인자 → 기본 브랜치 후보 탐색 → working-tree fallback 순으로 확정하고 사용한 base를 초안에 명시.
---

# PR Drafter

격리된 읽기 전용 Git inspection broker로 diff와 log를 읽어 web-harness의 한국어 PR 템플릿에 맞는 초안을 자동 작성한다.

Read `references/pr-guide.md` before writing any PR draft.

## Start

When the user invokes `/pr-drafter` alone, start with:

> 현재 브랜치의 변경 내용을 읽어 PR 초안을 작성할게요.

그리고 바로 아래 Workflow를 실행한다. 추가 질문 없이 시작한다.

## Workflow

1. **비교 기준(base) 확정** — 하드코딩하지 않는다. 순서대로 정한다:
   1. 인자로 받은 브랜치/범위가 있으면 그것을 쓴다 (`/pr-drafter main`)
   2. 없으면 저장소의 기본 브랜치를 쓴다. `--base` 없는 연산으로 먼저 커밋 유무를 확인하고, 후보(`main` → `develop` 순)로 `--operation log --base <후보>`를 시도해 성공한 첫 후보를 base로 고정한다
   3. 후보가 모두 실패하면(단일 브랜치·이름 상이) base 없이 `--operation diff`/`status`의 working-tree 기준으로 진행하고, 초안에 "base: working tree (기준 브랜치 미확정)"를 명시한다

   base가 잘못되면 diff에 남의 커밋이 섞여 PR 설명이 사실과 달라진다 — 실패를 조용히 넘기지 않고 어느 기준을 썼는지 초안에 남긴다.

2. 확정한 base로 컨텍스트를 수집한다 (`{base}`는 1단계 결과):
   ```bash
   node .claude/scripts/run-git-inspection.mjs --project . --operation log --base {base}
   node .claude/scripts/run-git-inspection.mjs --project . --operation diff-stat --base {base}
   node .claude/scripts/run-git-inspection.mjs --project . --operation diff --base {base}
   node .claude/scripts/run-git-inspection.mjs --project . --operation status
   node .claude/scripts/run-git-inspection.mjs --project . --operation diff
   ```
3. 변경 범위를 파악한다:
   - 어느 레이어/슬라이스가 변경됐는지 (FSD 기준)
   - 사용자에게 보이는 동작 변화가 무엇인지
   - 왜 이 방법을 선택했는지 코드에서 추론한다
4. `references/pr-guide.md`의 템플릿을 채워 한국어 PR 초안을 작성한다. 사용한 base를 초안 머리에 한 줄로 남긴다
5. 작성한 초안을 보여주고, 수정할 부분이 있으면 반영한다
6. 확정되면 `gh pr create` 명령을 제안한다 (직접 실행하지 않고 명령만 출력)

## Output Format

```markdown
<!-- 사용하고 있는 채널만 사용하면 됩니다 -->
* JIRA: [티켓_번호]()
* Issue: #깃헙_이슈_번호
* 관련 문서(선택): [링크]()

## 작업 내용
1. [변경 사항 요약]
    > 왜 이렇게 해결했는지, 이 방법이 최선인 이유

## 체크리스트
- [ ] 테스트 통과 (`pnpm test`)
- [ ] 정상 동작 확인
- [ ] 코드 수정에 따른 주석, 문서 수정

## 기타
```

## Gotchas

- 이슈·관련 문서 링크는 알 수 없으면 `[작성 필요]`로 표시한다
- 왜 이 방법인지 설명은 코드에서 최대한 추론하되, 확실하지 않으면 `[작성 필요]`로 남긴다
- 현재 프로젝트의 `package.json` scripts를 확인해 실제 검증 명령을 체크리스트에 사용한다. 기본값은 `pnpm test`다
- PR을 직접 열지 않는다. `gh pr create` 명령을 제안하는 것으로 끝낸다
- 직접 `git`을 실행하지 않는다. broker는 repo/global/system Git config, pager, external diff, textconv를 신뢰하지 않고 secret-bearing 경로를 제외한다
- `--base develop` 결과는 local ref 기준이므로 remote freshness를 가정하지 않는다. status의 untracked path는 Read 도구로 별도 검토한다
- 플래닝 완료 후 PR을 열어야 한다면 `/web-plan` 산출물을 PR 본문에 연결한다
