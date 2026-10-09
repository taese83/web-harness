#!/usr/bin/env node
// test-remind-commit-review.mjs — 하네스 모드 세션의 `git commit` 직전 코드 리뷰 상기 훅.
// 계기(실사용 2026-10-09): fix 레인이 레인 카드를 읽지 않은 채 고치고 커밋·강제 푸시했다 — 커밋 전 리뷰 규칙이 문서로만 있었다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {execFileSync, spawnSync} from 'node:child_process'
import {appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {COMMIT_STAGE, decide} from './remind-commit-review.mjs'
import {isCodeReviewTarget} from './ticket/work-link.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

test('커밋 전 리뷰 대상은 코드 파일만이다 — 문서·_workspace·설정은 아니다', () => {
  // 설정·스키마·워크플로는 의존성·배포·보안 경로라 대상이다. docs 디렉터리는 루트만 뺀다(apps/docs는 코드 앱일 수 있다).
  for (const path of ['src/a.ts', 'apps/user/src/App.tsx', 'lib/x.mjs', 'styles/a.css', 'index.html', 'package.json', '.github/workflows/ci.yml', 'db/001.sql', 'apps/docs/app/page.tsx'])
    assert.ok(isCodeReviewTarget(path), path)
  for (const path of ['README.md', 'docs/guide.ts', 'apps/user/README.md', '_workspace/03_dev/a.ts', 'img/a.png', 'notes.mdx', 'pnpm-lock.yaml', 'apps/user/icon.svg'])
    assert.ok(!isCodeReviewTarget(path), path)
})

test('git commit 단계만 잡는다 — 문자열 속 언급·다른 git 명령은 아니다', () => {
  for (const command of ['git commit -m x', 'git add a && git commit -q -m x', 'git -C /p -c user.name=t commit -m x', 'cd p; git commit --amend',
    'GIT_EDITOR=true git commit', 'env A=1 git commit -m x', '/usr/bin/git commit -m x', 'command git commit', 'git --no-pager commit -m x', '{ git commit -m x; }'])
    assert.match(command, COMMIT_STAGE, command)
  for (const command of ['git status', 'echo "git commit"', 'git log --grep commit', 'git commit-tree abc'])
    assert.doesNotMatch(command, COMMIT_STAGE, command)
})

test('하네스 모드 세션: 리뷰 안 된 코드면 한 번 알리고, 같은 내용 재시도·리뷰한 내용·문서만·하네스 모드 아님·서브에이전트는 통과', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-remind-commit-')))
  const home = mkdtempSync(join(tmpdir(), 'wh-remind-home-'))
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {encoding: 'utf8'})
  const packet = () => {
    const result = spawnSync(process.execPath, [join(HERE, 'prepare-review-packet.mjs'), '--project-root', root, '--base', 'HEAD'],
      {cwd: root, encoding: 'utf8', env: {...process.env, CLAUDE_PROJECT_DIR: ''}})
    assert.equal(result.status, 0, result.stderr)
  }
  const verdict = (id = 'code') => {
    mkdirSync(join(root, '_workspace/04_qa/evidence/verdicts'), {recursive: true})
    appendFileSync(join(root, `_workspace/04_qa/evidence/verdicts/${id}.jsonl`),
      `${JSON.stringify({reportId: id, agent: `${id}-reviewer`, status: 'PASS', at: new Date().toISOString()})}\n`)
  }
  const commit = (extra = {}) => decide({tool_name: 'Bash', tool_input: {command: 'git add -A && git commit -m x'}, session_id: 's1', cwd: root, ...extra}, {home, projectDir: root})
  try {
    git('init', '-q', '-b', 'main')
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src/a.ts'), 'a\n')
    writeFileSync(join(root, 'README.md'), 'r\n')
    git('add', '.'); git('commit', '-q', '-m', 'base')

    // 문서만 바꿨다 — 하네스 모드여도 대상이 아니다
    mkdirSync(join(home, '.claude/web-harness/sessions'), {recursive: true})
    writeFileSync(join(home, '.claude/web-harness/sessions/s1.json'), `${JSON.stringify({projectRoot: root, since: new Date().toISOString()})}\n`)
    writeFileSync(join(root, 'README.md'), 'r2\n')
    assert.equal(commit(), null, '문서만 바꾼 커밋에 코드 리뷰를 요구했다')

    // 코드를 리뷰 없이 고쳤다 — 한 번 알린다(새 파일 포함)
    writeFileSync(join(root, 'src/a.ts'), 'a2\n')
    writeFileSync(join(root, 'src/new.tsx'), 'n\n')
    const reason = commit()
    assert.ok(reason && reason.includes('src/a.ts') && reason.includes('src/new.tsx'), `리뷰 안 된 코드를 커밋 전에 알리지 않았다: ${reason}`)
    assert.ok(!reason.includes('README.md'), '문서를 리뷰 대상으로 적었다')
    assert.equal(commit(), null, '같은 내용 재시도를 또 막았다 — 상기 장치는 한 번만 알린다')
    assert.equal(commit({agent_type: 'developer'}), null, '서브에이전트 Bash에 적용했다')
    assert.equal(decide({tool_name: 'Bash', tool_input: {command: 'git commit -m x'}, session_id: 'other', cwd: root}, {home, projectDir: root}), null,
      '하네스 모드가 아닌 세션에 적용했다')

    // 리뷰 묶음 + 판정 뒤에는 통과 — light 레인은 보안 신호면 security-reviewer 한 스폰이 커밋 전 리뷰다
    packet(); verdict('security')
    assert.equal(commit(), null, 'security-reviewer 리뷰를 리뷰 안 됐다고 했다')

    // 리뷰 뒤 다시 고쳤다 — 다시 알린다
    writeFileSync(join(root, 'src/a.ts'), 'a3\n')
    const again = commit()
    assert.ok(again && again.includes('src/a.ts') && !again.includes('src/new.tsx'), `리뷰 뒤 고친 파일만 짚지 않았다: ${again}`)
    // 「한 번 알림」 기록을 못 쓰면 다음에도 알린다(침묵하지 않는다)
    writeFileSync(join(root, 'src/a.ts'), 'a4\n')
    rmSync(join(home, '.claude/web-harness/sessions/s1.commit-review.json'), {force: true})
    mkdirSync(join(home, '.claude/web-harness/sessions/s1.commit-review.json'))
    assert.ok(commit() && commit(), '알림 기록을 못 쓰자 다음 시도를 그냥 통과시켰다')
  } finally {
    rmSync(root, {recursive: true, force: true}); rmSync(home, {recursive: true, force: true})
  }
})
