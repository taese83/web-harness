// test-verifier-bash.mjs — 검증 에이전트 Bash 훅이 지침이 요구하는 읽기 명령을 실제로 통과시키는가.
// security-reviewer·code-reviewer 지침은 재귀 content 검색을 보호 exclude를 붙인 grep으로 하라고 한다 —
// 훅의 읽기 명령 목록에 grep이 없으면 그 검색이 런타임에 막혀 검사가 조용히 빠진다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {resolve} from 'node:path'

const HOOK = fileURLToPath(new URL('./enforce-verifier-bash.mjs', import.meta.url))
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const run = (agentType, command) => spawnSync(process.execPath, [HOOK], {
  input: JSON.stringify({tool_name: 'Bash', agent_type: agentType, cwd: ROOT, tool_input: {command}}),
  cwd: ROOT,
  encoding: 'utf8',
  env: {...process.env, CLAUDE_PROJECT_DIR: ROOT},
})

test('verifier는 보호 exclude를 갖춘 재귀 grep을 실행할 수 있다(플러그인 접두 포함)', () => {
  const command = "grep -rn token .claude/skills '--exclude=.env*' '--exclude=*.pem' '--exclude=*.key' '--exclude=id_*' '--exclude=*secret*' '--exclude=*credential*' --exclude-dir=.git --exclude-dir=node_modules"
  for (const agent of ['security-reviewer', 'web-harness:code-reviewer']) {
    const result = run(agent, command)
    assert.equal(result.status, 0, `${agent}: ${result.stderr}`)
  }
})

test('verifier는 여전히 프로젝트 스크립트를 직접 실행하지 못한다', () => {
  const result = run('security-reviewer', 'pnpm run lint')
  assert.equal(result.status, 2)
})
