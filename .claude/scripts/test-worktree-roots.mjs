// test-worktree-roots.mjs — 같은 저장소의 git worktree(`.claude/worktrees/<이름>/`·형제 디렉터리)는 그 체크아웃이 판정 root다.
// 쓰기(소유권 훅)·읽기(민감 경로 훅)·Bash 정책이 같은 판정을 쓴다. 등록 정보와 `.git` 파일이 서로 가리키지 않는 디렉터리는 worktree가 아니다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {execFileSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {attachedWorktreeRoots} from './worktree-roots-lib.mjs'
import {evaluateSensitiveAccess} from './sensitive-access-policy-lib.mjs'
import {evaluateGlobalBashPolicy} from './global-bash-policy-lib.mjs'

const OWNERSHIP = fileURLToPath(new URL('./enforce-agent-ownership.mjs', import.meta.url))

// 메인 체크아웃 + 진짜 worktree 둘(.claude/worktrees 안·형제) + 사칭 디렉터리 둘(.git 파일만 있음·등록만 있음).
const withRepo = run => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'wh-worktree-')))
  try {
    const main = join(base, 'repo')
    const attach = (id, dir) => {
      mkdirSync(join(main, '.git/worktrees', id), {recursive: true})
      mkdirSync(join(dir, 'src/entities'), {recursive: true})
      writeFileSync(join(main, '.git/worktrees', id, 'gitdir'), `${join(dir, '.git')}\n`)
      writeFileSync(join(dir, '.git'), `gitdir: ${join(main, '.git/worktrees', id)}\n`)
      writeFileSync(join(dir, 'src/entities/a.ts'), 'export {}\n')
    }
    mkdirSync(join(main, '_workspace/03_dev'), {recursive: true})
    writeFileSync(join(main, '_workspace/03_dev/spec.json'), JSON.stringify({schemaVersion: 2, layerMap: {domain: 'src/entities'}}))
    const inner = join(main, '.claude/worktrees/w1')
    const sibling = join(base, 'repo-w2')
    attach('w1', inner)
    attach('w2', sibling)
    const fakeInner = join(main, '.claude/worktrees/fake')
    mkdirSync(join(fakeInner, 'src/entities'), {recursive: true})
    writeFileSync(join(fakeInner, '.git'), `gitdir: ${join(main, '.git/worktrees/fake')}\n`)
    // 등록만 있고 그 디렉터리의 .git은 다른 곳을 가리킨다 — 등록 하나로 아무 디렉터리를 root로 만들 수 없다.
    const hijack = join(base, 'hijack')
    mkdirSync(join(main, '.git/worktrees/w3'), {recursive: true})
    mkdirSync(join(hijack, 'src/entities'), {recursive: true})
    writeFileSync(join(main, '.git/worktrees/w3', 'gitdir'), `${join(hijack, '.git')}\n`)
    writeFileSync(join(hijack, '.git'), `gitdir: ${join(base, 'other-repo/.git')}\n`)
    const stranger = join(base, 'stranger')
    mkdirSync(join(stranger, 'src'), {recursive: true})
    writeFileSync(join(stranger, 'src/x.ts'), 'export {}\n')
    return run({main, inner, sibling, fakeInner, stranger, hijack})
  } finally {
    rmSync(base, {recursive: true, force: true})
  }
}

const write = (main, filePath, agentId = undefined) => {
  try {
    execFileSync(process.execPath, [OWNERSHIP], {
      input: JSON.stringify({tool_name: 'Write', agent_type: 'developer', cwd: main, ...(agentId ? {agent_id: agentId} : {}), tool_input: {file_path: filePath}}),
      cwd: main, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: {...process.env, CLAUDE_PROJECT_DIR: main},
    })
    return true
  } catch {
    return false
  }
}

test('등록 정보와 .git 파일이 서로 가리키는 디렉터리만 worktree다', () => {
  withRepo(({main, inner, sibling}) => {
    assert.deepEqual(attachedWorktreeRoots(main).sort(), [inner, sibling].sort())
    assert.deepEqual(attachedWorktreeRoots(inner), [], 'worktree 안에서는 메인 체크아웃의 등록부를 읽지 않는다')
  })
})

test('소유권: worktree 안 레이어는 쓰고, 보호 경로·사칭 worktree·남의 디렉터리는 막힌다', () => {
  withRepo(({main, inner, sibling, fakeInner, stranger, hijack}) => {
    assert.equal(write(main, join(hijack, 'src/entities/b.ts')), false, '.git이 서로 가리키지 않는 등록 디렉터리가 열렸다')
    assert.equal(write(main, join(inner, 'src/entities/b.ts')), true, '.claude/worktrees 안 worktree에서 레이어 쓰기가 막혔다')
    assert.equal(write(main, join(sibling, 'src/entities/b.ts')), true, '형제 worktree에서 레이어 쓰기가 막혔다')
    assert.equal(write(main, join(inner, 'docs/x.md')), false, 'worktree에서 layerMap 밖이 열렸다')
    assert.equal(write(main, join(main, '.claude/settings.json')), false, '세션 root의 .claude가 열렸다')
    assert.equal(write(main, join(inner, '.claude/settings.json')), false, 'worktree 안 .claude가 열렸다')
    assert.equal(write(main, join(fakeInner, 'src/entities/b.ts')), false, '등록 없는 사칭 worktree가 열렸다')
    assert.equal(write(main, join(stranger, 'src/x.ts')), false, '저장소와 무관한 형제 디렉터리가 열렸다')
  })
})

test('읽기·Bash: 형제 worktree는 읽히고 무관한 디렉터리는 막힌다', () => {
  withRepo(({main, sibling, stranger}) => {
    const env = {CLAUDE_PROJECT_DIR: main}
    const read = file => evaluateSensitiveAccess({tool_name: 'Read', cwd: main, tool_input: {file_path: file}}, env).allowed
    assert.equal(read(join(sibling, 'src/entities/a.ts')), true, '형제 worktree 읽기가 막혔다')
    assert.equal(read(join(stranger, 'src/x.ts')), false, '무관한 형제 디렉터리를 읽었다')
    const bash = command => evaluateGlobalBashPolicy({tool_name: 'Bash', agent_type: 'developer', cwd: main, tool_input: {command}},
      {environment: env, processCwd: main}).allowed
    assert.equal(bash(`cat ${join(sibling, 'src/entities/a.ts')}`), true, 'Bash로 형제 worktree를 못 읽는다')
    assert.equal(bash(`cat ${join(stranger, 'src/x.ts')}`), false, 'Bash로 무관한 디렉터리를 읽었다')
  })
})

test('실행기 Node 고정: 실행 Node 옆 형제 설치에서 같은 major의 가장 높은 버전을 고르고, 없으면 null', async () => {
  const {siblingNodeFor} = await import('./node-pin-lib.mjs')
  const execPath = '/h/.nvm/versions/node/v22.22.3/bin/node'
  const list = () => ['v22.22.3', 'v24.2.0', 'v24.21.0', 'v24.9.1', 'v26.0.0', 'system']
  const exists = path => !path.includes('v24.21.0') || true
  assert.equal(siblingNodeFor(24, {execPath, list, exists, platform: 'darwin'}), '/h/.nvm/versions/node/v24.21.0/bin/node')
  assert.equal(siblingNodeFor(24, {execPath, list, exists: path => !path.includes('v24.21.0'), platform: 'darwin'}), '/h/.nvm/versions/node/v24.9.1/bin/node',
    '실행 파일이 없는 버전은 건너뛴다')
  assert.equal(siblingNodeFor(20, {execPath, list, exists, platform: 'darwin'}), null)
  assert.equal(siblingNodeFor(24, {execPath, list: () => { throw new Error('x') }, exists, platform: 'darwin'}), null)
})

test('worktree 쓰기 임대는 그 스폰이 끝나면 풀린다 — 다음 developer가 막히지 않는다', () => {
  const RELEASE = fileURLToPath(new URL('./release-write-lease.mjs', import.meta.url))
  withRepo(({main, inner}) => {
    assert.equal(write(main, join(inner, 'src/entities/b.ts'), 'agent-1'), true)
    assert.equal(write(main, join(inner, 'src/entities/c.ts'), 'agent-2'), false, '임대가 동시 쓰기를 막지 않았다')
    execFileSync(process.execPath, [RELEASE], {input: JSON.stringify({agent_id: 'agent-1', cwd: main}), cwd: main,
      env: {...process.env, CLAUDE_PROJECT_DIR: main}})
    assert.equal(write(main, join(inner, 'src/entities/c.ts'), 'agent-2'), true, 'worktree 임대가 스폰 종료 뒤에도 남았다')
  })
})

test('같은 세션 범위를 쓰는 메인 체크아웃과 worktree의 developer는 한 임대로 직렬화된다', () => {
  withRepo(({main, inner}) => {
    assert.equal(write(main, join(main, 'src/entities/m.ts'), 'agent-main'), true)
    assert.equal(write(main, join(inner, 'src/entities/w.ts'), 'agent-tree'), false, '범위를 공유하는 worktree 스폰이 다른 임대로 동시에 썼다')
  })
})
