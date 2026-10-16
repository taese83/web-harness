#!/usr/bin/env node
// test-harness-session-mode.mjs — `/wh`로 켠 세션만 이후 평문 요청에 라우팅 안내를 붙인다.
//
// 고정하는 사실:
//   - 켜지 않은 세션에는 아무것도 붙이지 않는다(하네스 스킬 자동 호출을 막아 둔 설계를 지킨다)
//   - `/wh`·`/web-harness:wh`·`/web-harness:team-flow`로 켜고, 이후 같은 세션·같은 프로젝트의 요청에 안내를 붙인다
//   - 전문(문서 경로 포함)은 켠 뒤 첫 요청과 compact·clear 뒤 첫 요청에만, 그 밖에는 60자 이하 한 줄만 붙인다
//   - 안내가 가리키는 문서 경로는 읽기 정책(evaluateSensitiveAccess)이 허용하는 경로다
//   - `/wh off`로 끈다. 다른 세션·다른 프로젝트에는 붙이지 않는다. 훅은 어떤 경우에도 요청을 막지 않는다
//   - 경로에 링크가 끼어도(플러그인 경로) 훅이 돈다
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {dirname, isAbsolute, join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {handlePrompt, handleSessionStart, sessionsDirectory} from './harness-session-mode.mjs'
import {evaluateSensitiveAccess} from './sensitive-access-policy-lib.mjs'

const HOOK = fileURLToPath(new URL('./harness-session-mode.mjs', import.meta.url))
const withDirs = run => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-session-mode-')))
  try {
    const home = join(root, 'home')
    const project = join(root, 'project')
    const other = join(root, 'other')
    const payload = join(root, 'payload')
    for (const directory of [home, project, other]) mkdirSync(directory, {recursive: true})
    run({home, project, other, payload})
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
}

test('켜지 않은 세션에는 아무것도 붙이지 않는다', () => withDirs(({home, project}) => {
  assert.equal(handlePrompt({session_id: 's1', prompt: 'AOA-70 픽업', cwd: project}, {home, projectDir: project}), '')
  assert.equal(existsSync(sessionsDirectory(home)), false, '켜지 않았는데 표시를 남겼다')
}))

test('/wh로 켜면 이후 같은 세션·같은 프로젝트의 평문 요청에 라우팅 안내가 붙고, off로 끈다', () => withDirs(({home, project, other}) => {
  const turn = (sessionId, prompt, projectDir = project) => handlePrompt({session_id: sessionId, prompt, cwd: projectDir}, {home, projectDir})
  assert.equal(turn('s1', '/web-harness:wh'), '', '켜는 턴에는 스킬이 로드되므로 안내를 붙이지 않는다')
  const reminder = turn('s1', 'state 공통 로직 티켓 만들어줘')
  assert.match(reminder, /하네스 모드/)
  assert.match(reminder, /skills\/wh\/SKILL\.md/, '대화가 요약돼도 다시 읽을 라우팅 문서 경로가 없다')
  assert.equal(turn('s2', 'state 공통 로직 티켓 만들어줘'), '', '다른 세션에 하네스 모드를 붙였다')
  assert.equal(turn('s1', 'state 공통 로직 티켓 만들어줘', other), '', '다른 프로젝트로 옮긴 세션에 붙였다')
  assert.match(turn('s1', '/web-harness:wh off'), /하네스 모드를 끝냈다/)
  assert.equal(turn('s1', 'AOA-70 픽업'), '', '끈 뒤에도 안내를 붙였다')
  assert.equal(turn('s3', '/team-flow AOA-70 픽업'), '')
  assert.match(turn('s3', 'PR 연결해줘'), /하네스 모드/, 'team-flow로 시작한 세션도 하네스 모드여야 한다')
  assert.equal(turn('s4', '/whatever'), '', '다른 슬래시 명령으로 켜졌다')
}))

test('훅 프로세스: 표준 출력으로 안내를 붙이고, 깨진 입력에도 막지 않는다', () => withDirs(({home, project}) => {
  const run = input => spawnSync(process.execPath, [HOOK], {input, encoding: 'utf8', env: {...process.env, HOME: home, CLAUDE_PROJECT_DIR: project}})
  assert.equal(run(JSON.stringify({session_id: 'p1', prompt: '/wh', cwd: project})).status, 0)
  const next = run(JSON.stringify({session_id: 'p1', prompt: '보드 보여줘', cwd: project}))
  assert.equal(next.status, 0)
  assert.match(next.stdout, /하네스 모드/)
  assert.equal(run('{ 깨진').status, 0, '깨진 입력이 요청을 막았다')
}))

test('훅 프로세스: 경로에 링크가 끼어도 안내를 붙인다 — main 판정은 실경로로 대조한다', () => withDirs(({home, project}) => {
  const linked = join(dirname(home), 'linked-scripts')
  // 링크는 저장소의 .claude/scripts를 가리킨다 — withDirs의 rmSync는 링크를 따라가지 않는다(따라가는 삭제로 바꾸면 저장소가 지워진다).
  symlinkSync(dirname(HOOK), linked, 'dir')
  const run = input => spawnSync(process.execPath, [join(linked, 'harness-session-mode.mjs')],
    {input, encoding: 'utf8', env: {...process.env, HOME: home, CLAUDE_PROJECT_DIR: project}})
  assert.equal(run(JSON.stringify({session_id: 'l1', prompt: '/wh', cwd: project})).status, 0)
  assert.match(run(JSON.stringify({session_id: 'l1', prompt: '보드 보여줘', cwd: project})).stdout, /하네스 모드/,
    '링크 경로로 부른 훅이 조용히 빠졌다')
}))

test('훅이 저장소 설정과 플러그인 배포 양쪽에 배선돼 있다 — UserPromptSubmit과 SessionStart(compact·clear 재안내)', () => {
  const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
  const settings = JSON.parse(readFileSync(join(repositoryRoot, '.claude/settings.json'), 'utf8'))
  const wired = event => (settings.hooks?.[event] ?? []).filter(entry => (entry.hooks ?? []).some(hook => hook.command.includes('harness-session-mode.mjs')))
  assert.equal(wired('UserPromptSubmit').length, 1, '저장소 설정 UserPromptSubmit에 하네스 모드 훅이 없다')
  assert.deepEqual(wired('SessionStart').map(entry => entry.matcher), ['compact|clear'], '저장소 설정 SessionStart 재안내 리셋이 없거나 compact·clear로 좁혀 있지 않다')
  const build = readFileSync(join(repositoryRoot, '.claude/scripts/build-plugin.mjs'), 'utf8')
  assert.match(build, /PLUGIN_USER_PROMPT_HOOKS = \[[^\]]*'harness-session-mode\.mjs'[^\]]*\]/)
  assert.match(build, /UserPromptSubmit: PLUGIN_USER_PROMPT_HOOKS\.map/, '플러그인 hooks.json에 UserPromptSubmit이 생성되지 않는다')
  assert.match(build, /PLUGIN_SESSION_START_HOOKS = \[.*\['compact\|clear', 'harness-session-mode\.mjs'\]/, '플러그인 SessionStart에 재안내 리셋이 없다')
  assert.match(build, /SessionStart: PLUGIN_SESSION_START_HOOKS\.map\(\(\[matcher, script\]\) => \(\{\n\s*\.\.\.\(matcher \? \{matcher\} : \{\}\)/, '플러그인 SessionStart에 matcher가 실리지 않는다')
})

test('세션 ID는 파일 이름으로 정화된다 — 입력이 세션 폴더 밖에 쓰지 못한다', () => withDirs(({home, project}) => {
  const hostile = '../../escape'
  assert.equal(handlePrompt({session_id: hostile, prompt: '/wh', cwd: project}, {home, projectDir: project}), '')
  assert.equal(existsSync(join(home, 'escape.json')), false, '세션 ID가 세션 폴더 밖으로 경로를 만들었다')
  assert.equal(existsSync(join(home, '.claude', 'escape.json')), false)
  assert.deepEqual(readdirSync(sessionsDirectory(home)), ['______escape.json'])
  assert.match(handlePrompt({session_id: hostile, prompt: '보드', cwd: project}, {home, projectDir: project}), /하네스 모드/)
}))

test('티켓 요청 안내는 team-flow 파일을 Read로 읽으라고 하고, Skill 도구로 부르지 말라고 한다 — 모델 호출이 막힌 스킬이다', () => withDirs(({home, project}) => {
  handlePrompt({session_id: 's9', prompt: '/wh', cwd: project}, {home, projectDir: project})
  const hint = handlePrompt({session_id: 's9', prompt: 'AOA-80 픽업해줘', cwd: project}, {home, projectDir: project})
  assert.match(hint, /skills\/team-flow\/SKILL\.md를 Read로 읽어/)
  assert.match(hint, /Skill 도구로 부르지 않는다/)
}))

test('전문은 켠 뒤 첫 요청에만 붙고, 이후에는 60자 이하 한 줄이다 — compact·clear 뒤에는 전문을 다시 붙인다', () => withDirs(({home, project}) => {
  const turn = prompt => handlePrompt({session_id: 'b1', prompt, cwd: project}, {home, projectDir: project})
  turn('/wh')
  const first = turn('보드 보여줘')
  assert.match(first, /skills\/wh\/SKILL\.md/, '첫 요청에 라우팅 문서 경로가 없다')
  assert.match(first, /문맥에 남아 있으면 다시 읽지 않는다/, '이미 읽은 문서를 다시 읽지 말라는 말이 없다')
  const short = turn('PR 연결해줘')
  assert.notEqual(short, first, '두 번째 요청에도 전문을 붙였다')
  assert.match(short, /harness mode on/)
  assert.ok(short.trimEnd().length <= 60, `짧은 표시가 60자를 넘는다: ${short.length}`)
  assert.equal(turn('다음'), short)
  for (const source of ['startup', 'resume']) {
    handleSessionStart({session_id: 'b1', source}, {home})
    assert.equal(turn('다음'), short, `${source} 뒤에 전문을 다시 붙였다 — 이어 온 대화에는 안내가 남아 있다`)
  }
  for (const source of ['compact', 'clear']) {
    handleSessionStart({session_id: 'b1', source}, {home})
    assert.equal(turn('다음'), first, `${source} 뒤 첫 요청에 전문을 다시 붙이지 않았다`)
    assert.equal(turn('다음'), short)
  }
  handleSessionStart({session_id: 'nobody', source: 'compact'}, {home})
  assert.equal(existsSync(join(sessionsDirectory(home), 'nobody.json')), false, '켜지 않은 세션에 표시를 만들었다')
  turn('/wh off')
  handleSessionStart({session_id: 'b1', source: 'compact'}, {home})
  assert.equal(turn('다음'), '', '끈 세션이 compact 뒤 다시 켜졌다')
}))

test('훅 프로세스: SessionStart(compact)는 아무것도 출력하지 않고 다음 요청에 전문을 되살린다', () => withDirs(({home, project}) => {
  const run = input => spawnSync(process.execPath, [HOOK], {input: JSON.stringify(input), encoding: 'utf8', env: {...process.env, HOME: home, CLAUDE_PROJECT_DIR: project}})
  run({session_id: 'c1', prompt: '/wh', cwd: project})
  const full = run({session_id: 'c1', prompt: '보드', cwd: project}).stdout
  assert.match(full, /skills\/wh\/SKILL\.md/)
  assert.doesNotMatch(run({session_id: 'c1', prompt: '보드', cwd: project}).stdout, /SKILL\.md/)
  const started = run({hook_event_name: 'SessionStart', session_id: 'c1', source: 'compact', cwd: project})
  assert.equal(started.status, 0)
  assert.equal(started.stdout, '', 'SessionStart 출력은 문맥에 붙는다 — 아무것도 내지 않아야 한다')
  assert.equal(run({session_id: 'c1', prompt: '보드', cwd: project}).stdout, full)
}))

// 안내가 가리키는 문서를 Read로 열면 읽기 정책(PreToolUse enforce-sensitive-access)이 막지 않아야 한다 — 막히면 안내가 헛걸음이다.
const plugin = payload => {
  mkdirSync(join(payload, '.claude-plugin'), {recursive: true})
  writeFileSync(join(payload, '.claude-plugin/plugin.json'), JSON.stringify({name: 'web-harness', version: '0.0.0-test'}))
  for (const root of ['skills', '.claude/skills']) {
    for (const name of ['wh', 'team-flow']) {
      mkdirSync(join(payload, root, name), {recursive: true})
      writeFileSync(join(payload, root, name, 'SKILL.md'), '# skill\n')
    }
  }
}
const injectedPaths = line => [...line.matchAll(/(\S*skills\/(?:wh|team-flow)\/SKILL\.md)/g)].map(match => match[1].replace(/^\(/, ''))
const readDecision = (path, project, payloadRoot) =>
  evaluateSensitiveAccess({tool_name: 'Read', tool_input: {file_path: path}, cwd: project}, {CLAUDE_PROJECT_DIR: project}, {payloadRoot}).code

test('플러그인: 안내의 문서 경로는 읽기 정책이 허용한다 — 계약 사본이 있으면 프로젝트 상대 경로, 없으면 플러그인 문서 루트', () => withDirs(({home, project, payload}) => {
  plugin(payload)
  const turn = sessionId => {
    handlePrompt({session_id: sessionId, prompt: '/web-harness:wh', cwd: project}, {home, projectDir: project, payloadRoot: payload})
    return handlePrompt({session_id: sessionId, prompt: '보드', cwd: project}, {home, projectDir: project, payloadRoot: payload})
  }
  assert.equal(readDecision(join(payload, '.claude/skills/wh/SKILL.md'), project, payload), 'DENY_PATH_OUTSIDE',
    '전제: 플러그인 .claude/skills 사본은 읽기 정책이 막는다')

  const withoutContracts = turn('p-none')
  assert.match(withoutContracts, /\/web-harness:wh/)
  const outside = injectedPaths(withoutContracts)
  assert.deepEqual(outside, [join(payload, 'skills/wh/SKILL.md'), join(payload, 'skills/team-flow/SKILL.md')])
  for (const path of outside) assert.equal(readDecision(path, project, payload), 'ALLOW_SENSITIVE_ACCESS_POLICY', path)

  for (const name of ['wh', 'team-flow']) {
    mkdirSync(join(project, '_workspace/.contracts/skills', name), {recursive: true})
    writeFileSync(join(project, '_workspace/.contracts/skills', name, 'SKILL.md'), '# skill\n')
  }
  const inside = injectedPaths(turn('p-synced'))
  assert.deepEqual(inside, ['_workspace/.contracts/skills/wh/SKILL.md', '_workspace/.contracts/skills/team-flow/SKILL.md'])
  for (const path of inside) assert.equal(readDecision(path, project, payload), 'ALLOW_SENSITIVE_ACCESS_POLICY', path)
}))

test('플러그인이 아니면(저장소 자체) 안내의 문서 경로는 프로젝트 상대 .claude/skills이고 읽기 정책이 허용한다', () => withDirs(({home}) => {
  const repositoryRoot = realpathSync(fileURLToPath(new URL('../..', import.meta.url)))
  const options = {home, projectDir: repositoryRoot, payloadRoot: repositoryRoot}
  handlePrompt({session_id: 'r1', prompt: '/wh', cwd: repositoryRoot}, options)
  const line = handlePrompt({session_id: 'r1', prompt: '보드', cwd: repositoryRoot}, options)
  assert.match(line, /\(\/wh로 켰다\)/)
  const paths = injectedPaths(line)
  assert.deepEqual(paths, ['.claude/skills/wh/SKILL.md', '.claude/skills/team-flow/SKILL.md'])
  for (const path of paths) {
    assert.equal(isAbsolute(path), false)
    assert.equal(readDecision(path, repositoryRoot, repositoryRoot), 'ALLOW_SENSITIVE_ACCESS_POLICY', path)
  }
}))
