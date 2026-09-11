#!/usr/bin/env node
// test-write-lease.mjs — 같은 체크아웃의 developer write 스폰은 한 번에 하나만 쓴다.
//
// 계기(감사 FINDING-003): 병렬 developer 스폰이 `change-scope.md` 하나를 공유해 마지막 범위가
// 다른 스폰에도 적용된다. 규칙은 산문뿐이었다. 2026-09-11 실측으로 훅 입력에 스폰별 `agent_id`가
// 실리는 것을 확인하고(병렬 서브에이전트 둘 → 서로 다른 id, 메인 스레드 → 없음) 그것으로 직렬화한다.
//
// 여기서 고정하는 사실:
//   (1) 먼저 쓴 developer가 임대를 잡고, 다른 agent_id의 쓰기는 **막힌다** — 이유와 해제 방법을 댄다
//   (2) 같은 agent_id의 연속 쓰기는 막히지 않는다
//   (3) SubagentStop이 **자기** 임대만 놓는다 — 남의 것은 지우지 않는다
//   (4) 메인 스레드(agent_id 없음)와 developer가 아닌 writer는 임대의 대상이 아니다
//   (5) 체크아웃이 다르면 임대가 따로다 — 병렬이 필요할 때의 정답(worktree)을 기계가 허용한다
//   (6) 권한 오류는 「보유 중」이 아니다 · 후보가 전부 막히면 unavailable — 가짜 홀더를 짓지 않는다
//   (7) 자동 회수하지 않는다 — 죽은 홀더의 임대도 막고 경로를 댄다
import assert from 'node:assert/strict'
import test from 'node:test'
import {execFileSync} from 'node:child_process'
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {acquireLease, leasePathsFor, releaseLease} from './write-lease-lib.mjs'

const OWNERSHIP_HOOK = fileURLToPath(new URL('./enforce-agent-ownership.mjs', import.meta.url))
const RELEASE_HOOK = fileURLToPath(new URL('./release-write-lease.mjs', import.meta.url))
const SPEC = {
  schemaVersion: 2,
  layerMap: {domainModel: 'src/entities', composedUI: 'src/widgets'},
  testLayers: {unit: 'src', e2e: 'e2e'},
}

// 스팩이 확정된 작은 프로젝트. **`.git`이 없으므로** 임대는 실경로 해시의 임시 경로에 선다.
const withProject = run => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-lease-')))
  mkdirSync(join(root, '_workspace/03_dev'), {recursive: true})
  writeFileSync(join(root, '_workspace/03_dev/spec.json'), JSON.stringify(SPEC))
  try { return run(root) } finally {
    for (const path of leasePathsFor(root)) rmSync(path, {force: true})
    rmSync(root, {recursive: true, force: true})
  }
}

// 훅을 실제 프로세스로 돌린다 — 실측한 입력 모양 그대로(agent_id·session_id 포함).
const write = (root, {agentId, agentType = 'developer', file = 'src/entities/x.ts'}) => {
  const payload = {tool_name: 'Write', agent_type: agentType, session_id: 's', cwd: root,
    tool_input: {file_path: join(root, file)}, ...(agentId ? {agent_id: agentId} : {})}
  try {
    execFileSync(process.execPath, [OWNERSHIP_HOOK], {input: JSON.stringify(payload), cwd: root, encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'], env: {...process.env, CLAUDE_PROJECT_DIR: root}})
    return {allowed: true, message: ''}
  } catch (error) {
    return {allowed: false, message: String(error.stderr ?? '')}
  }
}
const stop = (root, agentId) => execFileSync(process.execPath, [RELEASE_HOOK], {
  input: JSON.stringify({hook_event_name: 'SubagentStop', agent_id: agentId, agent_type: 'developer', cwd: root}),
  cwd: root, env: {...process.env, CLAUDE_PROJECT_DIR: root}, stdio: ['pipe', 'pipe', 'pipe']})

test('다른 developer 스폰의 쓰기는 막히고, 끝나면 풀린다 — 실제 훅 프로세스', () => {
  withProject(root => {
    assert.equal(write(root, {agentId: 'agent-a'}).allowed, true, '첫 developer 쓰기가 막혔다')
    const blocked = write(root, {agentId: 'agent-b', file: 'src/widgets/y.tsx'})
    assert.equal(blocked.allowed, false, '같은 체크아웃에서 두 developer가 동시에 썼다 — 직렬화가 아니다')
    assert.match(blocked.message, /agent-a/, '누가 쥐고 있는지 말하지 않는다')
    assert.match(blocked.message, /worktree/, '병렬이 필요할 때 무엇을 하라는지 말하지 않는다')
    stop(root, 'agent-a')
    assert.equal(write(root, {agentId: 'agent-b', file: 'src/widgets/y.tsx'}).allowed, true, 'SubagentStop 뒤에도 풀리지 않았다')
  })
})

test('같은 agent_id의 연속 쓰기는 막히지 않는다', () => {
  withProject(root => {
    assert.equal(write(root, {agentId: 'agent-a'}).allowed, true)
    assert.equal(write(root, {agentId: 'agent-a', file: 'src/widgets/y.tsx'}).allowed, true, '홀더 자신을 막았다')
  })
})

test('SubagentStop은 자기 임대만 놓는다 — 남의 것을 지우면 쓰는 도중 다른 스폰이 들어온다', () => {
  withProject(root => {
    assert.equal(write(root, {agentId: 'agent-a'}).allowed, true)
    stop(root, 'agent-other')
    assert.equal(write(root, {agentId: 'agent-b'}).allowed, false, '남의 SubagentStop이 임대를 지웠다')
  })
})

test('메인 스레드와 developer가 아닌 writer는 임대의 대상이 아니다', () => {
  withProject(root => {
    assert.equal(write(root, {agentId: 'agent-a'}).allowed, true)
    // 실측: 메인 스레드 쓰기에는 agent_id가 없다. agent_type도 없으면 소유권 훅 자체가 보지 않는다.
    assert.equal(write(root, {agentId: null, agentType: 'developer'}).allowed, true,
      'agent_id 없는 쓰기(--agent 세션)를 임대로 막았다 — 서브에이전트가 아니다')
    // developer가 아닌 writer는 임대를 보지 않는다(디자인 wave는 서로소 산출물을 병렬로 쓴다).
    const other = write(root, {agentId: 'agent-c', agentType: 'layout-designer', file: '_workspace/02_design/layout-spec.md'})
    assert.doesNotMatch(other.message, /쓰는 중이다/, 'developer가 아닌 writer를 임대로 막았다')
  })
})

test('체크아웃이 다르면 임대가 따로다 — worktree로 나누면 병렬이 된다', () => {
  withProject(first => withProject(second => {
    assert.equal(write(first, {agentId: 'agent-a'}).allowed, true)
    assert.equal(write(second, {agentId: 'agent-b'}).allowed, true, '다른 체크아웃의 스폰을 막았다')
  }))
})

// 전제: **non-root로 돈다.** root는 0o555 디렉터리에도 쓸 수 있어 EACCES가 나지 않는다 — root CI에서
// 이 테스트와 seed `write-lease-classifies-errors`는 거짓 실패한다(현재 러너는 non-root).
test('권한 오류는 보유 중이 아니다 · 전부 막히면 unavailable · 읽을 수 없는 임대는 남의 것이다', () => {
  const locked = mkdtempSync(join(tmpdir(), 'wh-lease-ro-'))
  const spare = mkdtempSync(join(tmpdir(), 'wh-lease-ok-'))
  chmodSync(locked, 0o555)
  try {
    const fallback = acquireLease({projectRoot: '/x', agentId: 'a', agentType: 'developer',
      paths: [join(locked, 'l.json'), join(spare, 'l.json')]})
    assert.equal(fallback.ok, true, `권한 오류에서 다음 후보로 가지 않았다: ${JSON.stringify(fallback)}`)
    const none = acquireLease({projectRoot: '/x', agentId: 'b', agentType: 'developer', paths: [join(locked, 'l.json')]})
    assert.ok(Array.isArray(none.unavailable), '막힌 후보를 unavailable로 내지 않았다')
    writeFileSync(join(spare, 'bad.json'), '{깨짐')
    const unreadable = acquireLease({projectRoot: '/x', agentId: 'c', agentType: 'developer', paths: [join(spare, 'bad.json')]})
    assert.ok(unreadable.held, '읽을 수 없는 임대를 통과로 셌다')
  } finally {
    chmodSync(locked, 0o755)
    rmSync(locked, {recursive: true, force: true})
    rmSync(spare, {recursive: true, force: true})
  }
})

test('자동 회수하지 않는다 — 죽은 홀더의 임대도 막고 지울 경로를 댄다', () => {
  withProject(root => {
    // SubagentStop 없이 죽은 홀더(세션 강제 종료)를 흉내낸다.
    const [path] = leasePathsFor(root)
    writeFileSync(path, JSON.stringify({agentId: 'dead', agentType: 'developer', acquiredAt: '2026-01-01T00:00:00.000Z'}))
    const blocked = write(root, {agentId: 'agent-b'})
    assert.equal(blocked.allowed, false, '죽은 홀더의 임대를 조용히 회수했다 — 원자로 만들 수 없는 회수다')
    assert.ok(blocked.message.includes(path), '지울 경로를 대지 않는다')
    assert.equal(releaseLease({projectRoot: root, agentId: 'agent-b'}).released, false, '남의 임대를 놓았다')
  })
})

// **취득과 해제는 함께 배포된다.** 해제 훅이 빠지면 첫 developer 스폰이 끝난 뒤에도 임대가 남아
// 두 번째 스폰부터 **영원히 막힌다** — 저장소 설정과 플러그인 hooks.json 양쪽을 본다.
test('SubagentStop 해제 훅이 저장소 설정과 플러그인 배포 양쪽에 배선돼 있다', () => {
  const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
  const settings = JSON.parse(readFileSync(join(repositoryRoot, '.claude/settings.json'), 'utf8'))
  const stopCommands = (settings.hooks?.SubagentStop ?? []).flatMap(entry => entry.hooks ?? []).map(hook => hook.command)
  assert.ok(stopCommands.some(command => command.includes('release-write-lease.mjs')),
    `저장소 설정의 SubagentStop에 해제 훅이 없다: ${JSON.stringify(stopCommands)}`)
  const build = readFileSync(join(repositoryRoot, '.claude/scripts/build-plugin.mjs'), 'utf8')
  assert.match(build, /PLUGIN_SUBAGENT_STOP_HOOKS = \['release-write-lease\.mjs'\]/, '플러그인 배포 목록에 해제 훅이 없다')
  assert.match(build, /SubagentStop: PLUGIN_SUBAGENT_STOP_HOOKS\.map/, '플러그인 hooks.json에 SubagentStop이 생성되지 않는다')
})
