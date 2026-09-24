#!/usr/bin/env node
// test-verdict-record.mjs — 검증 에이전트가 낸 판정을 기록하고, 옮겨 적은 QA 보고서와 대조한다.
//
// 고정하는 사실:
//   - SubagentStop 훅이 검증 에이전트의 최종 응답(`last_assistant_message`)에서 `## Result`를 읽어 증거 폴더에 남긴다
//   - 기록이 한 번도 없던 프로젝트(훅 미배선·옛 판본)는 막지 않는다 — 기록이 있는 프로젝트에서만 대조한다
//   - 기록이 있는데 보고서 판정이 다르거나 그 보고서의 기록이 없으면 릴리스가 막힌다(옮겨 적으며 바뀐 판정·검증 없이 쓴 보고서)
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {checkVerdictBinding, parseVerdictStatus, recordVerdict, VERDICTS_RELATIVE} from './verdict-record-lib.mjs'
import {buildReleaseManifest} from './release-gate-lib.mjs'

const HOOK = fileURLToPath(new URL('./record-verdict.mjs', import.meta.url))
const withProject = run => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-verdict-')))
  try {
    mkdirSync(join(root, '_workspace/04_qa'), {recursive: true})
    writeFileSync(join(root, 'package.json'), `${JSON.stringify({name: 'fixture'})}\n`)
    return run(root)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
}

test('판정 읽기(순수): `## Result` 다음 줄의 알려진 상태만 받는다', () => {
  assert.equal(parseVerdictStatus('# 보안 리뷰\n\n## Result\n**FAIL**\n\n## Findings'), 'FAIL')
  assert.equal(parseVerdictStatus('## Result\npass'), 'PASS')
  assert.equal(parseVerdictStatus('## Result\nPASS — 경고 2건'), 'PASS', '꼬리가 붙은 판정 줄을 판정 없음으로 기록했다')
  assert.equal(parseVerdictStatus('## Result\nPASSABLE'), null)
  assert.equal(parseVerdictStatus('## Result\n아마 괜찮음'), null)
  assert.equal(parseVerdictStatus(undefined), null)
})

test('훅: 끝난 검증 에이전트의 판정을 기록하고, 검증 에이전트가 아니면 남기지 않는다', () => withProject(root => {
  const stop = (agentType, message) => spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({hook_event_name: 'SubagentStop', agent_type: agentType, agent_id: 'agent-1', cwd: root, last_assistant_message: message}),
    cwd: root, encoding: 'utf8', env: {...process.env, CLAUDE_PROJECT_DIR: root},
  })
  assert.equal(stop('security-reviewer', '## Result\nFAIL\n토큰이 localStorage에 있다').status, 0)
  const lines = readFileSync(join(root, VERDICTS_RELATIVE, 'security.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual([lines[0].reportId, lines[0].agent, lines[0].status, lines[0].agentId], ['security', 'security-reviewer', 'FAIL', 'agent-1'])
  assert.match(lines[0].digest, /^[0-9a-f]{64}$/)
  assert.equal(stop('developer', '## Result\nPASS').status, 0, '스톱 훅이 종료를 막았다')
  assert.equal(existsSync(join(root, VERDICTS_RELATIVE, 'developer.jsonl')), false)
  assert.equal(stop('security-reviewer', 'not json-safe \u0000').status, 0)
}))

test('대조: 기록이 없던 프로젝트는 막지 않고, 기록이 있으면 판정 불일치·기록 없음을 잡는다', () => withProject(root => {
  assert.deepEqual(checkVerdictBinding(root, 'security', 'PASS'), {bound: false})
  recordVerdict(root, {agentName: 'security-reviewer', message: '## Result\nFAIL'})
  assert.match(checkVerdictBinding(root, 'security', 'PASS').error, /보고서 판정\(PASS\)이 검증 에이전트 security-reviewer의 판정\(FAIL\)과 다르다/)
  recordVerdict(root, {agentName: 'security-reviewer', message: '## Result\nPASS'})
  assert.equal(checkVerdictBinding(root, 'security', 'PASS').error, undefined, '마지막 판정이 아니라 옛 판정으로 대조했다')
  assert.match(checkVerdictBinding(root, 'ux', 'PASS').error, /판정 기록이 없다/, '검증 에이전트 없이 쓴 보고서를 통과시켰다')
}))

test('릴리스 게이트: 보고서가 PASS인데 검증 에이전트가 FAIL을 냈으면 막는다', () => withProject(root => {
  writeFileSync(join(root, '_workspace/04_qa/qa-security.md'), '# Security\n\n## Result\nPASS\n')
  const before = buildReleaseManifest(root).errors.filter(error => error.startsWith('_workspace/04_qa/qa-security.md'))
  assert.deepEqual(before, [], '기록이 없는 프로젝트의 보고서를 판정 대조로 막았다')
  recordVerdict(root, {agentName: 'security-reviewer', message: '## Result\nFAIL'})
  const after = buildReleaseManifest(root).errors.filter(error => error.startsWith('_workspace/04_qa/qa-security.md'))
  assert.ok(after.some(error => /검증 에이전트 security-reviewer의 판정\(FAIL\)/.test(error)), `옮겨 적으며 바뀐 판정이 릴리스를 통과했다: ${JSON.stringify(after)}`)
}))

test('기록 훅이 저장소 설정과 플러그인 배포 양쪽에 배선돼 있다', () => {
  const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
  const settings = JSON.parse(readFileSync(join(repositoryRoot, '.claude/settings.json'), 'utf8'))
  const stopCommands = (settings.hooks?.SubagentStop ?? []).flatMap(entry => entry.hooks ?? []).map(hook => hook.command)
  assert.ok(stopCommands.some(command => command.includes('record-verdict.mjs')), `저장소 설정의 SubagentStop에 기록 훅이 없다: ${JSON.stringify(stopCommands)}`)
  const build = readFileSync(join(repositoryRoot, '.claude/scripts/build-plugin.mjs'), 'utf8')
  assert.match(build, /PLUGIN_SUBAGENT_STOP_HOOKS = \[[^\]]*'record-verdict\.mjs'[^\]]*\]/, '플러그인 배포 목록에 기록 훅이 없다')
})
