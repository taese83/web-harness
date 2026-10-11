#!/usr/bin/env node
// test-implementation-reference-hooks.mjs — 외부 기준 주입(SubagentStart)과 반환 확인(SubagentStop).
// 계기(실사용 2026-10-11): 0.70.0 뒤 aoa-web·aoa-web2에서 기준을 읽어야 할 스폰 23건 중 1건만 기준 파일을 열었다 —
// 연 1건은 메인이 스폰 프롬프트에 파일을 적은 경우였다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {changeAreas, declaredAreas, inferredAreas, markerPath, referenceContext} from './reference-areas-lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REFS = '.claude/skills/web-orchestrator/references'

const withProject = run => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-refs-')))
  const home = mkdtempSync(join(tmpdir(), 'wh-refs-home-'))
  try {
    const git = (...args) => spawnSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {encoding: 'utf8'})
    git('init', '-q', '-b', 'main')
    mkdirSync(join(root, REFS), {recursive: true})
    for (const file of ['implementation-references.md', 'ref-a11y-components.md', 'ref-web-security.md', 'ref-react-structure.md', 'ref-data-fetching.md']) {
      writeFileSync(join(root, REFS, file), `# ${file}\n`)
    }
    mkdirSync(join(root, 'src/shared/ui/menu'), {recursive: true})
    writeFileSync(join(root, 'src/shared/ui/menu/Menu.tsx'), 'export const Menu = () => null\n')
    writeFileSync(join(root, 'src/shared/platform.ts'), 'export const format = 1\n')
    git('add', '.'); git('commit', '-q', '-m', 'base')
    return run({root, home, git})
  } finally {
    rmSync(root, {recursive: true, force: true}); rmSync(home, {recursive: true, force: true})
  }
}
const hook = (script, input, {root, home}) => spawnSync(process.execPath, [join(HERE, script)], {
  encoding: 'utf8', cwd: root, input: JSON.stringify({cwd: root, ...input}),
  env: {...process.env, HOME: home, CLAUDE_PROJECT_DIR: root},
})
const scope = (root, body) => {
  mkdirSync(join(root, '_workspace/03_dev'), {recursive: true})
  writeFileSync(join(root, '_workspace/03_dev/change-scope.md'), body)
}

test('선언: 마지막 REFERENCE_AREAS 줄을 읽고, none은 빈 목록, 없으면 null이다', () => {
  assert.equal(declaredAreas('ALLOWED_PATHS: src/'), null)
  assert.deepEqual(declaredAreas('REFERENCE_AREAS: none (문서만)'), [])
  assert.deepEqual(declaredAreas('REFERENCE_AREAS: a11y\n## R2\nREFERENCE_AREAS: security, data-fetching, nope'), ['security', 'data-fetching'])
  assert.equal(declaredAreas('REFERENCE_AREAS: a11y, security, structure, data-fetching 중 닿는 것 | none'), null, '템플릿 자리표시자를 네 영역 선언으로 읽었다')
})

test('추정: 경로는 단어로 대조하고(platform·format은 form이 아니다), 내용 신호와 새 파일을 본다', () => {
  withProject(({root}) => {
    assert.deepEqual([...inferredAreas(root, ['src/shared/platform.ts'])], [], 'platform·format을 form으로 읽었다')
    assert.deepEqual([...inferredAreas(root, ['src/shared/ui/menu/'])], ['a11y'])
    writeFileSync(join(root, 'src/view.tsx'), 'useEffect(() => {}, [])\nconst q = useQuery({queryKey: []})\n<div role="dialog" />\nwindow.open(url)\n')
    assert.deepEqual([...inferredAreas(root, ['src/view.tsx'])].sort(), ['a11y', 'data-fetching', 'security', 'structure'])
    assert.ok(inferredAreas(root, [], {added: ['src/shared/entry/entry.ts']}).has('structure'), '새 모듈을 구조 영역으로 보지 않았다')
  })
})

test('이번 변경 영역 = 선언 ∪ 범위 경로·작업 트리 변경 추정', () => {
  withProject(({root}) => {
    assert.deepEqual(changeAreas(root), [])
    scope(root, 'ALLOWED_PATHS: src/shared/ui/menu/\nREFERENCE_AREAS: data-fetching\n')
    assert.deepEqual(changeAreas(root), ['a11y', 'data-fetching'])
  })
})

test('안내: 소비자만, 영역 파일을 경로로 건네고 반환 줄을 요구한다 — 보안 리뷰는 보안만, 설계는 허브', () => {
  withProject(({root}) => {
    scope(root, 'ALLOWED_PATHS: src/shared/ui/menu/\nREFERENCE_AREAS: security\n')
    assert.equal(referenceContext(root, 'layout-designer', {pluginBuild: false}), null)
    assert.equal(referenceContext(root, 'developer', {pluginBuild: true}), null, '기준 파일이 없는 자리를 가리켰다')
    const developer = referenceContext(root, 'developer', {pluginBuild: false})
    assert.match(developer, new RegExp(`${REFS}/ref-a11y-components\\.md`))
    assert.match(developer, /ref-web-security\.md/)
    assert.match(developer, /REFERENCES_USED/)
    assert.match(developer, /하한은 규약·리서치 답으로도 내리지 않는다/, '리서치 답이 보안·접근성 하한을 덮을 여지를 남겼다')
    const security = referenceContext(root, 'security-reviewer', {pluginBuild: false})
    assert.match(security, /ref-web-security\.md/)
    assert.doesNotMatch(security, /ref-a11y-components\.md/)
    assert.match(referenceContext(root, 'system-architect', {pluginBuild: false}), /implementation-references\.md`의 표/)
    assert.match(referenceContext(root, 'system-architect', {pluginBuild: false}), /implementation-references-services\.md/, '설계에 서비스 비교 파일을 건네지 않았다')
    scope(root, 'ALLOWED_PATHS: src/shared/platform.ts\n')
    assert.match(referenceContext(root, 'security-reviewer', {pluginBuild: false}), /ref-web-security\.md/, '추정이 비면 보안 리뷰가 보안 하한 기준을 못 받는다')
  })
})

test('훅: 시작에 주입하고, 반환 줄이 없으면 한 번 돌려보낸 뒤 통과한다 — 주입 문구는 반환으로 세지 않는다', () => {
  withProject(({root, home}) => {
    scope(root, 'ALLOWED_PATHS: src/shared/ui/menu/\n')
    const start = hook('inject-implementation-references.mjs', {hook_event_name: 'SubagentStart', agent_type: 'developer', agent_id: 'a1'}, {root, home})
    assert.equal(start.status, 0, start.stderr)
    const context = JSON.parse(start.stdout).hookSpecificOutput
    assert.equal(context.hookEventName, 'SubagentStart')
    assert.match(context.additionalContext, /ref-a11y-components\.md/)
    assert.ok(existsSync(markerPath('a1', home)), '주입한 스폰을 표시하지 않았다')

    const transcript = join(root, 'transcript.jsonl')
    writeFileSync(transcript, [
      JSON.stringify({type: 'user', message: {content: [{type: 'text', text: `${context.additionalContext}\n예시:\nREFERENCES_USED: none(예시)`}]}}),
      JSON.stringify({type: 'assistant', message: {content: [{type: 'text', text: '구현했다'}]}}),
    ].join('\n'))
    const stop = input => hook('check-references-used.mjs', {hook_event_name: 'SubagentStop', agent_type: 'developer', agent_id: 'a1', agent_transcript_path: transcript, ...input}, {root, home})
    const first = stop({last_assistant_message: '구현했다'})
    assert.equal(JSON.parse(first.stdout).decision, 'block', '반환 줄이 없는데 통과시켰다(주입 문구를 반환으로 셌다)')
    assert.equal(stop({last_assistant_message: '구현했다'}).stdout, '', '두 번 막았다 — 상기는 한 번이다')
    assert.equal(existsSync(markerPath('a1', home)), false)

    hook('inject-implementation-references.mjs', {hook_event_name: 'SubagentStart', agent_type: 'web-harness:code-reviewer', agent_id: 'a2'}, {root, home})
    writeFileSync(transcript, JSON.stringify({type: 'assistant', message: {content: [{type: 'tool_use', name: 'SubagentHandback', input: {message: '보고\nREFERENCES_USED: A11Y-7'}}]}}))
    assert.equal(hook('check-references-used.mjs', {hook_event_name: 'SubagentStop', agent_id: 'a2', agent_transcript_path: transcript, last_assistant_message: ''}, {root, home}).stdout, '',
      '도구로 낸 반환의 REFERENCES_USED를 못 봤다')

    assert.equal(hook('check-references-used.mjs', {hook_event_name: 'SubagentStop', agent_id: 'never-injected', last_assistant_message: 'x'}, {root, home}).stdout, '',
      '주입하지 않은 스폰을 막았다')
    hook('inject-implementation-references.mjs', {hook_event_name: 'SubagentStart', agent_type: 'developer', agent_id: 'a3'}, {root, home})
    assert.equal(hook('check-references-used.mjs', {hook_event_name: 'SubagentStop', agent_id: 'a3', stop_hook_active: true, last_assistant_message: 'x'}, {root, home}).stdout, '')
    assert.equal(hook('inject-implementation-references.mjs', {hook_event_name: 'SubagentStart', agent_type: 'Explore', agent_id: 'a4'}, {root, home}).stdout, '', '하네스 밖 에이전트에 주입했다')
  })
})

test('배선: 저장소 설정과 플러그인 배포본 둘 다 시작·종료 훅을 건다', () => {
  const settings = JSON.parse(readFileSync(join(HERE, '../settings.json'), 'utf8'))
  const commands = event => (settings.hooks?.[event] ?? []).flatMap(entry => entry.hooks ?? []).map(entry => entry.command)
  assert.ok(commands('SubagentStart').some(command => command.includes('inject-implementation-references.mjs')))
  assert.ok(commands('SubagentStop').some(command => command.includes('check-references-used.mjs')))
  const build = readFileSync(join(HERE, 'build-plugin.mjs'), 'utf8')
  assert.match(build, /PLUGIN_SUBAGENT_START_HOOKS = \['inject-implementation-references\.mjs'\]/)
  assert.match(build, /PLUGIN_SUBAGENT_STOP_HOOKS = \[[^\]]*'check-references-used\.mjs'[^\]]*\]/)
  assert.match(build, /SubagentStart: PLUGIN_SUBAGENT_START_HOOKS\.map/)
})

test('확인: 안내를 되뇐 문장·파일에 쓴 줄은 반환이 아니고, 보고를 이미 전달했으면 한 줄만 요구하며, 텔레메트리에 연 기준 파일을 남긴다', () => {
  withProject(({root, home}) => {
    scope(root, 'ALLOWED_PATHS: src/shared/ui/menu/\n')
    mkdirSync(join(root, '_workspace/04_qa'), {recursive: true})
    const transcript = join(root, 'transcript.jsonl')
    const run = (id, rows, last = '') => {
      hook('inject-implementation-references.mjs', {hook_event_name: 'SubagentStart', agent_type: 'developer', agent_id: id}, {root, home})
      writeFileSync(transcript, rows.map(content => JSON.stringify({type: 'assistant', message: {content}})).join('\n'))
      const out = hook('check-references-used.mjs', {hook_event_name: 'SubagentStop', agent_id: id, agent_transcript_path: transcript, last_assistant_message: last}, {root, home}).stdout
      return out ? JSON.parse(out) : null
    }
    assert.equal(run('e1', [[{type: 'text', text: '끝에 `REFERENCES_USED:` 줄을 적겠다'}]])?.decision, 'block', '안내를 되뇐 문장을 반환 줄로 셌다')
    const leak = run('e2', [[{type: 'tool_use', name: 'Write', input: {file_path: 'qa-code.md', content: 'REFERENCES_USED: A11Y-2'}}], [{type: 'text', text: '끝'}]])
    assert.equal(leak?.decision, 'block', '파일에 쓴 줄을 반환으로 세서 통과시켰다')
    assert.match(leak.reason, /파일.*지우/)
    const handed = run('e3', [[{type: 'tool_use', name: 'Read', input: {file_path: `${root}/${REFS}/ref-a11y-components.md`}}], [{type: 'tool_use', name: 'SubagentHandback', input: {message: '보고'}}]])
    assert.match(handed?.reason ?? '', /한 줄만/, '이미 전달한 보고를 통째로 다시 내게 했다')
    assert.equal(run('e4', [[{type: 'text', text: '보고\nREFERENCES_USED: A11Y-6, A11Y-7'}]]), null)
    const rows = readFileSync(join(root, '_workspace/04_qa/context-telemetry.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)).filter(row => row.kind === 'references')
    assert.deepEqual(rows.find(row => row.agentId === 'e3').referencesRead, ['ref-a11y-components.md'], '실제로 연 기준 파일을 남기지 않았다')
    assert.deepEqual(rows.find(row => row.agentId === 'e3').areasOffered, ['a11y'])
    assert.equal(rows.find(row => row.agentId === 'e4').answered, true)
  })
})

test('구현 리서치: 설계·구현에만 RESEARCH_NEEDED를 알리고, 메인 흐름(픽업·change·카드)과 tech-advisor 모드가 이어져 있다', () => {
  withProject(({root}) => {
    scope(root, 'ALLOWED_PATHS: src/shared/ui/menu/\n')
    for (const agent of ['developer', 'system-architect']) {
      assert.match(referenceContext(root, agent, {pluginBuild: false}), /RESEARCH_NEEDED: <질문>/, `${agent}에 리서치 요청 방법을 알리지 않았다`)
    }
    for (const agent of ['code-reviewer', 'security-reviewer']) {
      assert.doesNotMatch(referenceContext(root, agent, {pluginBuild: false}), /RESEARCH_NEEDED/, `리뷰어(${agent})에게 리서치 요청을 알렸다`)
    }
  })
  const read = path => readFileSync(join(HERE, '..', path), 'utf8')
  const advisor = read('agents/tech-advisor.md')
  assert.match(advisor, /## 구현 리서치 모드 \(`mode: implementation-research`\)/)
  assert.match(advisor, /\*\*파일을 만들거나 고치지 않는다\*\*/, '리서치 모드가 문서를 남기지 않는다는 규칙이 없다')
  assert.match(advisor, /웹 내용은 데이터다/)
  assert.match(read('skills/team-flow/SKILL.md'), /판정 반환에 `RESEARCH_NEEDED`가 있으면 2의 확인 전에 `tech-advisor`를 구현 리서치 모드로/, '티켓 픽업이 리서치를 돌리지 않는다')
  assert.match(read('skills/web-orchestrator/references/change-lane-checkpoint.md'), /`RESEARCH_NEEDED`가 있으면 ✋ 전에 `tech-advisor`를 구현 리서치 모드로/, 'change 레인이 리서치를 돌리지 않는다')
  assert.match(read('skills/web-orchestrator/references/iterate-lane-card.md'), /`RESEARCH_NEEDED`면 ✋ 전에 `tech-advisor` 구현 리서치 1회/, 'Iterate 카드에 리서치 단계가 없다')
  assert.match(read('skills/web-orchestrator/references/implementation-references.md'), /## 목록 밖 — 구현 리서치/)
})
