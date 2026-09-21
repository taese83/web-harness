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
