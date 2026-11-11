// test-verifier-bash.mjs — 검증 에이전트 Bash 훅이 지침이 요구하는 읽기 명령을 실제로 통과시키는가.
// Bash를 가진 실행형 verifier(browser·integration 등)가 보호 exclude를 붙인 재귀 grep을 쓸 수 있어야 한다 —
// 훅의 읽기 명령 목록에 grep이 없으면 그 검색이 런타임에 막혀 검사가 조용히 빠진다. 판단형 리뷰어는 Bash가 없다.
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
  for (const agent of ['integration-verifier', 'web-harness:browser-verifier']) {
    const result = run(agent, command)
    assert.equal(result.status, 0, `${agent}: ${result.stderr}`)
  }
})

test('verifier는 여전히 프로젝트 스크립트를 직접 실행하지 못한다', () => {
  const result = run('integration-verifier', 'pnpm run lint')
  assert.equal(result.status, 2)
})

test('developer 셸은 양성 목록만 — 실행기 --check·브로커 install·lockfile·pnpm install --ignore-scripts·읽기 전용 검사·읽기는 통과하고, 파일·외부 상태를 바꾸는 명령은 막힌다', () => {
  const allowed = [
    'node .claude/scripts/run-quality-gates.mjs --project . --check test --failure-summary',
    'web-harness-script run-quality-gates --project . --check typecheck --failure-summary',
    'node .claude/scripts/run-package-operation.mjs --project . --operation install',
    'web-harness-script run-package-operation --project . --operation lockfile',
    "rg -n 'token' .claude/agents/developer.md",
    'pnpm install --ignore-scripts',
    'pnpm install --frozen-lockfile --ignore-scripts',
    'node .claude/scripts/run-git-inspection.mjs --project . --operation diff-stat',
  ]
  for (const agent of ['developer', 'web-harness:developer']) {
    for (const command of allowed) {
      const result = run(agent, command)
      assert.equal(result.status, 0, `${agent} ${command}: ${result.stderr}`)
    }
  }
  const blocked = [
    'pnpm test', 'pnpm install', 'git status', "sed -i 's/a/b/' package.json", 'rm package.json', 'echo x > package.json',
    'cp package.json x.json', "node -e 'require(\"fs\").writeFileSync(\"x\",\"y\")'",
    'node .claude/scripts/run-package-operation.mjs --project . --operation git-init',
    'web-harness-script run-package-operation --project . --operation husky-init',
    'node .claude/scripts/run-quality-gates.mjs --project . --all --failure-summary',
    'node .claude/scripts/run-quality-gates.mjs --project . --all',
    'pnpm install', 'pnpm add left-pad@1.3.0', 'pnpm install --ignore-scripts --filter user', 'pnpm install --ignore-scripts --ignore-scripts',
    // verifier에게는 열린 검사 스크립트 중 파일·외부 상태를 바꾸는 것 — 쓰는 에이전트는 물려받지 않는다
    'node .claude/scripts/validate-development-readiness.mjs --project . --fix',
    'node .claude/scripts/validate-plan-delta.mjs --project . --change PC-001 --snapshot',
    'node .claude/scripts/ticket/cli.mjs claim --repo o/r',
  ]
  for (const command of blocked) {
    assert.equal(run('developer', command).status, 2, `developer에 허용됐다: ${command}`)
  }
  const background = spawnSync(process.execPath, [HOOK], {input: JSON.stringify({tool_name: 'Bash', agent_type: 'developer', cwd: ROOT,
    tool_input: {command: 'pnpm install --ignore-scripts', run_in_background: true}}), cwd: ROOT, encoding: 'utf8', env: {...process.env, CLAUDE_PROJECT_DIR: ROOT}})
  assert.equal(background.status, 2, 'developer가 설치를 백그라운드로 띄웠다')
  assert.equal(run('integration-verifier', 'node .claude/scripts/run-package-operation.mjs --project . --operation install').status, 2,
    'verifier가 패키지 브로커를 돌렸다')
})

test('하위 폴더에서 물려받은 위치에서도 루트를 --project로 명시한 실행기와 설치는 통과하고, 명시 없는 실행기는 막힌다', () => {
  const sub = resolve(ROOT, '.claude/scripts')
  const runAt = (command, cwd) => spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({tool_name: 'Bash', agent_type: 'developer', cwd, tool_input: {command}}),
    cwd: ROOT, encoding: 'utf8', env: {...process.env, CLAUDE_PROJECT_DIR: ROOT},
  })
  assert.equal(runAt(`web-harness-script run-quality-gates --project ${ROOT} --check test --failure-summary`, sub).status, 0,
    '하위 폴더에서 루트를 명시한 실행기가 막혔다')
  assert.equal(runAt('pnpm install --ignore-scripts', sub).status, 0, '하위 폴더에서 설치가 막혔다')
  assert.equal(runAt('web-harness-script run-quality-gates --check test', sub).status, 2, '루트 명시 없이 하위 폴더에서 실행기가 통과했다')
  assert.equal(runAt('web-harness-script run-quality-gates --check test --project', sub).status, 2, '값 없는 --project를 루트 명시로 쳤다')
})
