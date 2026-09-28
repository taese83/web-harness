#!/usr/bin/env node
// test-human-approval-hook.mjs — 사람의 승인을 대신하는 행위는 에이전트 종류와 무관하게 사용자 확인을 거친다.
//
// 훅은 승인 flag가 붙은 Bash와 승인·인수 기록 파일 쓰기에 `ask`를 돌려준다(대화형은 확인 창, 비대화는 거부).
// 플러그인 판본에도 실려야 한다 — 전역 Bash 정책은 플러그인에 없다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

const hook = fileURLToPath(new URL('./enforce-human-approval.mjs', import.meta.url))
const run = input => spawnSync(process.execPath, [hook], {input: JSON.stringify(input), encoding: 'utf8', env: {...process.env, CLAUDE_PROJECT_DIR: '/p'}})
const decisionOf = result => (result.stdout ? JSON.parse(result.stdout).hookSpecificOutput : null)
const bash = (command, agentType) => ({tool_name: 'Bash', tool_input: {command}, ...(agentType ? {agent_type: agentType} : {})})

test('승인 flag가 붙은 Bash는 메인·서브에이전트 모두 사용자 확인(ask)이다', () => {
  for (const agentType of [undefined, 'developer', 'browser-verifier']) {
    for (const command of [
      'node .claude/scripts/run-quality-gates.mjs --project . --check typecheck --allow-host-execution',
      'bin/web-harness-script run-quality-gates --project . --check lint --accept-workflow-findings',
    ]) {
      const decision = decisionOf(run(bash(command, agentType)))
      assert.equal(decision?.permissionDecision, 'ask', `${agentType ?? 'main'}: ${command}`)
      assert.match(decision.permissionDecisionReason, /기본안 승인은 이 승인이 아니다/)
    }
  }
})

test('승인 flag가 없으면 관여하지 않는다', () => {
  const result = run(bash('node .claude/scripts/run-quality-gates.mjs --project . --check typecheck'))
  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
})

test('승인·인수 기록 파일을 직접 쓰는 것도 사용자 확인이다', () => {
  for (const file of ['/p/_workspace/03_dev/host-execution-grant.json', '/p/_workspace/03_dev/workflow-security-acceptance.json']) {
    for (const tool of ['Write', 'Edit']) {
      assert.equal(decisionOf(run({tool_name: tool, tool_input: {file_path: file}}))?.permissionDecision, 'ask', `${tool} ${file}`)
    }
  }
  assert.equal(run({tool_name: 'Write', tool_input: {file_path: '/p/_workspace/03_dev/change-scope.md'}}).stdout, '')
  for (const command of ['cat > _workspace/03_dev/host-execution-grant.json <<EOF', 'cp /tmp/x _workspace/03_dev/workflow-security-acceptance.json']) {
    assert.equal(decisionOf(run(bash(command)))?.permissionDecision, 'ask', command)
  }
})

test('입력을 읽지 못하면 통과가 아니라 확인이다', () => {
  const result = spawnSync(process.execPath, [hook], {input: '{', encoding: 'utf8'})
  assert.equal(decisionOf(result)?.permissionDecision, 'ask')
})

test('플러그인 판본에 훅이 실린다', () => {
  const build = readFileSync(fileURLToPath(new URL('./build-plugin.mjs', import.meta.url)), 'utf8')
  assert.match(build, /^ {2}\['Bash\|Write\|Edit', 'enforce-human-approval\.mjs'\],$/m, 'PLUGIN_HOOKS에 배선되지 않았다')
  for (const settings of ['../settings.json', '../settings.project.json']) {
    assert.match(readFileSync(fileURLToPath(new URL(settings, import.meta.url)), 'utf8'), /enforce-human-approval\.mjs/, settings)
  }
})

test('러너 --help: 옵션·check·승인 규칙을 보여 주고 아무것도 실행하지 않는다', () => {
  const runner = fileURLToPath(new URL('./run-quality-gates.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [runner, '--help'], {encoding: 'utf8'})
  assert.equal(result.status, 0, result.stderr)
  for (const expected of ['--check <id>', '--all', '--failure-summary', 'typecheck', '--allow-host-execution', 'not approval to run project code', 'WEB_HARNESS_ISOLATED_EXECUTION']) {
    assert.ok(result.stdout.includes(expected), `사용법에 ${expected}가 없다`)
  }
})

test('프로필 잠금 마이그레이션 적용은 사용자 확인이고, 미리보기는 관여하지 않는다', () => {
  const decide = command => run({tool_name: 'Bash', tool_input: {command}, cwd: '/p'}).stdout
  assert.match(decide('web-harness-script migrate-profile-lock --project-root . --apply'), /"permissionDecision":"ask"/)
  assert.match(decide('node .claude/scripts/migrate-profile-lock.mjs --apply --project-root .'), /"permissionDecision":"ask"/)
  assert.equal(decide('web-harness-script migrate-profile-lock --project-root .'), '')
})
