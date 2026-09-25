#!/usr/bin/env node
// test-harness-session-mode.mjs — `/wh`로 켠 세션만 이후 평문 요청에 라우팅 안내를 붙인다.
//
// 고정하는 사실:
//   - 켜지 않은 세션에는 아무것도 붙이지 않는다(하네스 스킬 자동 호출을 막아 둔 설계를 지킨다)
//   - `/wh`·`/web-harness:wh`·`/web-harness:team-flow`로 켜고, 이후 같은 세션·같은 프로젝트의 요청마다 `/wh` 문서 경로를 붙인다
//   - `/wh off`로 끈다. 다른 세션·다른 프로젝트에는 붙이지 않는다. 훅은 어떤 경우에도 요청을 막지 않는다
//   - 경로에 링크가 끼어도(플러그인 경로) 훅이 돈다
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {handlePrompt, sessionsDirectory} from './harness-session-mode.mjs'

const HOOK = fileURLToPath(new URL('./harness-session-mode.mjs', import.meta.url))
const withDirs = run => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-session-mode-')))
  try {
    const home = join(root, 'home')
    const project = join(root, 'project')
    const other = join(root, 'other')
    for (const directory of [home, project, other]) mkdirSync(directory, {recursive: true})
    run({home, project, other})
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

test('훅이 저장소 설정과 플러그인 배포 양쪽에 배선돼 있다', () => {
  const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
  const settings = JSON.parse(readFileSync(join(repositoryRoot, '.claude/settings.json'), 'utf8'))
  const commands = (settings.hooks?.UserPromptSubmit ?? []).flatMap(entry => entry.hooks ?? []).map(hook => hook.command)
  assert.ok(commands.some(command => command.includes('harness-session-mode.mjs')), `저장소 설정에 하네스 모드 훅이 없다: ${JSON.stringify(commands)}`)
  const build = readFileSync(join(repositoryRoot, '.claude/scripts/build-plugin.mjs'), 'utf8')
  assert.match(build, /PLUGIN_USER_PROMPT_HOOKS = \[[^\]]*'harness-session-mode\.mjs'[^\]]*\]/)
  assert.match(build, /UserPromptSubmit: PLUGIN_USER_PROMPT_HOOKS\.map/, '플러그인 hooks.json에 UserPromptSubmit이 생성되지 않는다')
})

test('세션 ID는 파일 이름으로 정화된다 — 입력이 세션 폴더 밖에 쓰지 못한다', () => withDirs(({home, project}) => {
  const hostile = '../../escape'
  assert.equal(handlePrompt({session_id: hostile, prompt: '/wh', cwd: project}, {home, projectDir: project}), '')
  assert.equal(existsSync(join(home, 'escape.json')), false, '세션 ID가 세션 폴더 밖으로 경로를 만들었다')
  assert.equal(existsSync(join(home, '.claude', 'escape.json')), false)
  assert.deepEqual(readdirSync(sessionsDirectory(home)), ['______escape.json'])
  assert.match(handlePrompt({session_id: hostile, prompt: '보드', cwd: project}, {home, projectDir: project}), /하네스 모드/)
}))
