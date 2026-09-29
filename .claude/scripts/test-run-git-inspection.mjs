#!/usr/bin/env node
// test-run-git-inspection.mjs — base 비교가 공통 조상 기준인지 고정한다.
//
// 분기 뒤 base가 앞서 나가면 두 점 비교(`git diff <base>`)는 base의 새 변경을 이쪽이 지운 것처럼
// 보인다 — pr-drafter의 PR 설명과 version-analyzer의 semver 판정이 그 유령 삭제를 읽는다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'

const RUNNER = join(dirname(fileURLToPath(import.meta.url)), 'run-git-inspection.mjs')

// 러너는 자기 위치 기준 하네스 트리 안의 프로젝트만 받는다 — 임시 하네스에 사본을 두고 자식 repo를 만든다.
const withForkedRepo = run => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-git-inspection-'))
  try {
    mkdirSync(join(root, '.claude/scripts'), {recursive: true})
    copyFileSync(RUNNER, join(root, '.claude/scripts/run-git-inspection.mjs'))
    copyFileSync(join(dirname(RUNNER), 'cli-help-lib.mjs'), join(root, '.claude/scripts/cli-help-lib.mjs'))
    const project = join(root, 'proj')
    mkdirSync(project)
    const git = (...args) => {
      const result = spawnSync('git', ['-C', project, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {encoding: 'utf8'})
      assert.equal(result.status, 0, result.stderr)
    }
    git('init', '-q', '-b', 'main')
    git('commit', '-q', '--allow-empty', '-m', 'root')
    git('checkout', '-q', '-b', 'feature')
    writeFileSync(join(project, 'mine.txt'), 'mine\n')
    git('add', 'mine.txt')
    git('commit', '-q', '-m', 'feature change')
    git('checkout', '-q', 'main')
    writeFileSync(join(project, 'theirs.txt'), 'theirs\n')
    git('add', 'theirs.txt')
    git('commit', '-q', '-m', 'base moved on')
    git('checkout', '-q', 'feature')
    const inspect = (operation, extra = []) => spawnSync(process.execPath,
      [join(root, '.claude/scripts/run-git-inspection.mjs'), '--project', project, '--operation', operation, ...extra],
      {encoding: 'utf8'})
    return run({project, git, inspect})
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
}

test('회귀 반증: base가 앞서 나가도 base의 새 파일을 이쪽 삭제로 보고하지 않는다', () => {
  withForkedRepo(({inspect}) => {
    const names = inspect('diff-names', ['--base', 'main'])
    assert.equal(names.status, 0, names.stderr)
    assert.deepEqual(names.stdout.trim().split('\n'), ['"mine.txt"'],
      '두 점 비교면 theirs.txt가 삭제로 섞여 PR 설명·semver 판정이 틀어진다')
    const stat = inspect('diff-stat', ['--base', 'main'])
    assert.doesNotMatch(stat.stdout, /theirs\.txt/)
  })
})

test('회귀 반증: base --log도 base의 새 커밋을 이 브랜치 커밋으로 싣지 않는다', () => {
  withForkedRepo(({inspect}) => {
    const log = inspect('log', ['--base', 'main'])
    assert.equal(log.status, 0, log.stderr)
    assert.match(log.stdout, /feature change/)
    assert.doesNotMatch(log.stdout, /base moved on/, '대칭 차집합이면 PR 설명의 커밋 목록에 남의 커밋이 섞인다')
  })
})

test('base 비교는 워킹 트리 변경을 계속 포함한다', () => {
  withForkedRepo(({project, inspect}) => {
    writeFileSync(join(project, 'mine.txt'), 'mine\nedited\n')
    const diff = inspect('diff', ['--base', 'main'])
    assert.equal(diff.status, 0, diff.stderr)
    assert.match(diff.stdout, /\+edited/)
  })
})

test('공통 조상이 없으면 두 점 비교로 물러서지 않고 거부한다', () => {
  withForkedRepo(({git, inspect}) => {
    git('checkout', '-q', '--orphan', 'unrelated')
    git('commit', '-q', '--allow-empty', '-m', 'unrelated root')
    const result = inspect('diff-names', ['--base', 'main'])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /No common ancestor/)
  })
})

test('없는 base ref는 git 원문과 함께 거부한다', () => {
  withForkedRepo(({inspect}) => {
    const result = inspect('diff-names', ['--base', 'no-such-branch'])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /No common ancestor[\s\S]*no-such-branch/)
  })
})

// 플러그인 판본: 러너는 플러그인 캐시에 있고 사용자 프로젝트는 그 밖이다. 저장소 루트만 보면 모든 호출이 exit 2였다.
const withPluginLayout = run => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-git-inspection-plugin-'))
  try {
    const plugin = join(root, 'plugin-cache/web-harness/.claude/scripts')
    mkdirSync(plugin, {recursive: true})
    copyFileSync(RUNNER, join(plugin, 'run-git-inspection.mjs'))
    copyFileSync(join(dirname(RUNNER), 'cli-help-lib.mjs'), join(plugin, 'cli-help-lib.mjs'))
    const project = join(root, 'user-project')
    mkdirSync(project)
    const result = spawnSync('git', ['-C', project, 'init', '-q', '-b', 'main'], {encoding: 'utf8'})
    assert.equal(result.status, 0, result.stderr)
    writeFileSync(join(project, 'a.txt'), 'a\n')
    const inspect = (target, {cwd, env = {}} = {}) => spawnSync(process.execPath,
      [join(plugin, 'run-git-inspection.mjs'), '--project', target, '--operation', 'status'],
      {encoding: 'utf8', cwd, env: {...process.env, CLAUDE_PROJECT_DIR: '', ...env}})
    return run({root, project, inspect})
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
}

test('회귀 반증: 플러그인 판본에서 세션 프로젝트(작업 디렉터리)를 조회한다', () => {
  withPluginLayout(({project, inspect}) => {
    const result = inspect(project, {cwd: project})
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /a\.txt/)
  })
})

test('플러그인 판본에서 CLAUDE_PROJECT_DIR가 세션 프로젝트를 정한다', () => {
  withPluginLayout(({root, project, inspect}) => {
    const result = inspect(project, {cwd: root, env: {CLAUDE_PROJECT_DIR: project}})
    assert.equal(result.status, 0, result.stderr)
  })
})

test('세션 프로젝트 밖과 제어면 디렉터리는 계속 거부한다', () => {
  withPluginLayout(({root, project, inspect}) => {
    mkdirSync(join(project, '_workspace'))
    const outside = inspect(root, {cwd: project})
    assert.equal(outside.status, 2)
    assert.match(outside.stderr, /must stay inside/)
    const control = inspect(join(project, '_workspace'), {cwd: project})
    assert.equal(control.status, 2)
  })
})

test('회귀 반증: 파이프로 읽어도 64KB 넘는 diff를 자르지 않는다', () => {
  withForkedRepo(({project, inspect}) => {
    writeFileSync(join(project, 'mine.txt'), `${'x'.repeat(99)}\n`.repeat(2000))
    const diff = inspect('diff')
    assert.equal(diff.status, 0, diff.stderr)
    assert.ok(Buffer.byteLength(diff.stdout) > 200_000, `잘렸다: ${Buffer.byteLength(diff.stdout)}B`)
  })
})
