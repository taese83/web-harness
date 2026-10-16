#!/usr/bin/env node
// test-deny-remedies.mjs — 훅 거부마다 이유와 허용되는 대안이 붙는가, 그리고 문구를 바꿔도 판정은 그대로인가.
//
// 고정하는 사실:
//   - 고정 입력 표의 허용/거부·코드·이유가 아래 리터럴과 같다(문구 변경이 판정을 바꾸지 않았다는 증거)
//   - 두 정책이 내는 모든 거부 코드에 대안 문구가 있다(소스의 코드 리터럴을 전수로 본다)
//   - 대안 문구가 가리키는 입력·예시 명령은 같은 정책이 실제로 허용한다(막힌 곳을 다시 가리키지 않는다)
//   - 훅 stderr가 정책의 이유와 대안을 그대로 낸다(verifier Bash 훅은 종전에 코드만 냈다)
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {evaluateSensitiveAccess, SECRET_EXCLUDE_GLOB, sensitiveDenyRemedy} from './sensitive-access-policy-lib.mjs'
import {bashPolicyRemedy, evaluateGlobalBashPolicy} from './global-bash-policy-lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const node = (script, input, projectRoot) => spawnSync(process.execPath, [join(HERE, script)], {encoding: 'utf8', cwd: projectRoot,
  env: {...process.env, CLAUDE_PROJECT_DIR: projectRoot}, input: JSON.stringify(input)})

const withProject = run => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-deny-remedy-')))
  const files = {'src/a.ts': 'x\n', 'apps/user/.env.dev': 'V=1\n', 'apps/user/src/a.ts': 'x\n', 'app/.ENV': 'X=1\n', 'app/src/a.ts': 'x\n',
    'linky/a.ts': 'x\n', '.env': 'S=1\n', '.env.example': 'S=\n', '.git/config': '[core]\n', 'big.log': 'x'.repeat(5 * 1024 * 1024 + 1)}
  try {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), {recursive: true})
      writeFileSync(join(root, path), content)
    }
    symlinkSync(join(root, 'linky/a.ts'), join(root, 'linky/link.ts'))
    return run(root)
  } finally { rmSync(root, {recursive: true, force: true}) }
}

// [도구, 입력, 허용, 코드, 이유, 붙는 glob] — 문구 변경 전 판정을 그대로 적었다. 대안 입력은 마지막 칸(거부 행만).
const SENSITIVE_TABLE = [
  ['Read', {file_path: 'src/a.ts'}, true, 'ALLOW_SENSITIVE_ACCESS_POLICY', null, null],
  ['Read', {file_path: '/etc/hosts'}, false, 'DENY_PATH_OUTSIDE', null, null],
  ['Read', {file_path: '.env'}, false, 'DENY_SECRET_PATH', null, null, ['Read', {file_path: '.env.example'}]],
  ['Read', {file_path: '.env.example'}, true, 'ALLOW_SENSITIVE_ACCESS_POLICY', null, null],
  ['Read', {file_path: 'big.log'}, false, 'DENY_FILE_TOO_LARGE', null, null, ['Grep', {pattern: 'x', path: 'big.log', output_mode: 'content', head_limit: 5}]],
  ['Read', {file_path: 'big.log', offset: 1, limit: 10}, false, 'DENY_FILE_TOO_LARGE', null, null],
  ['Grep', {pattern: 'x'}, false, 'DENY_RECURSIVE_ROOT_GREP', null, null, ['Grep', {pattern: 'x', path: 'src'}]],
  ['Grep', {pattern: 'x', path: '.'}, false, 'DENY_RECURSIVE_ROOT_GREP', null, null],
  ['Grep', {pattern: 'x', path: 'apps/user'}, true, 'ALLOW_GREP_SECRETS_EXCLUDED', null, SECRET_EXCLUDE_GLOB],
  ['Grep', {pattern: 'x', path: 'apps/user', glob: '*.{ts,tsx}'}, true, 'ALLOW_SENSITIVE_ACCESS_POLICY', null, null],
  ['Grep', {pattern: 'x', path: 'app'}, false, 'DENY_SENSITIVE_TREE_GREP', 'secret-not-excludable', null, ['Grep', {pattern: 'x', path: 'app/src'}]],
  ['Grep', {pattern: 'x', path: 'linky'}, false, 'DENY_SENSITIVE_TREE_GREP', 'symlink', null, ['Grep', {pattern: 'x', path: 'linky/a.ts'}]],
  ['Glob', {pattern: '**/*'}, false, 'DENY_GIT_CONFIG_GLOB', null, null],
  ['Glob', {pattern: '**/.env*'}, false, 'DENY_SECRET_GLOB', null, null, ['Glob', {pattern: '**/*.example'}]],
]

test('판정 고정: 문구를 바꿔도 sensitive-access의 허용/거부·코드·이유는 그대로다', () => withProject(root => {
  for (const [tool_name, tool_input, allowed, code, reason, glob] of SENSITIVE_TABLE) {
    const decision = evaluateSensitiveAccess({tool_name, tool_input}, {CLAUDE_PROJECT_DIR: root})
    assert.deepEqual([decision.allowed, decision.code, decision.reason ?? null, decision.updatedInput?.glob ?? null], [allowed, code, reason, glob],
      `${tool_name} ${JSON.stringify(tool_input)}`)
  }
  assert.equal(evaluateSensitiveAccess({tool_name: 'Read', tool_input: {file_path: 'a'}}, {CLAUDE_PROJECT_DIR: join(root, 'missing')}).code, 'DENY_CONTEXT')
}))

test('거부마다 훅 stderr에 대안이 붙고, 그 대안 입력은 같은 정책이 허용한다', () => withProject(root => {
  for (const [tool_name, tool_input, allowed, code, , , alternative] of SENSITIVE_TABLE) {
    if (allowed) continue
    const result = node('enforce-sensitive-access.mjs', {tool_name, cwd: root, tool_input}, root)
    assert.equal(result.status, 2, `${code}: ${result.stderr}`)
    const remedy = sensitiveDenyRemedy(evaluateSensitiveAccess({tool_name, tool_input}, {CLAUDE_PROJECT_DIR: root}), {tool_name, tool_input})
    assert.ok(remedy, `${code}: 대안 문구가 없다`)
    assert.ok(result.stderr.includes(`${code}`) && result.stderr.includes(remedy), `${code}: ${result.stderr}`)
    if (alternative) {
      const [altTool, altInput] = alternative
      assert.equal(evaluateSensitiveAccess({tool_name: altTool, tool_input: altInput}, {CLAUDE_PROJECT_DIR: root}).allowed, true,
        `${code}의 대안 ${altTool} ${JSON.stringify(altInput)}이 막힌다`)
    }
  }
}))

test('트리 Grep 거부는 걸린 항목을 짚는다(어느 하위 폴더를 고르면 되는지)', () => withProject(root => {
  const at = path => evaluateSensitiveAccess({tool_name: 'Grep', tool_input: {pattern: 'x', path}}, {CLAUDE_PROJECT_DIR: root}).at
  assert.equal(at('app'), 'app/.ENV')
  assert.equal(at('linky'), 'linky/link.ts')
  assert.match(sensitiveDenyRemedy({code: 'DENY_SENSITIVE_TREE_GREP', reason: 'symlink', at: 'linky/link.ts'}), /^linky\/link\.ts is a symlink/)
}))

test('Glob 거부 문구가 예로 드는 패턴은 실제로 허용된다', () => withProject(root => {
  for (const code of ['DENY_GIT_CONFIG_GLOB', 'DENY_SECRET_GLOB']) {
    const patterns = [...sensitiveDenyRemedy({code}).matchAll(/`([^`]+)`/g)].map(match => match[1]).filter(pattern => pattern.includes('.'))
    assert.ok(patterns.length > 0, code)
    for (const pattern of patterns.filter(pattern => !['**/*', '*/config'].includes(pattern) && !pattern.includes('env.'))) {
      assert.equal(evaluateSensitiveAccess({tool_name: 'Glob', tool_input: {pattern}}, {CLAUDE_PROJECT_DIR: root}).allowed, true, `${code}: ${pattern}`)
    }
  }
}))

test('저장된 큰 도구 출력(tool-results)을 읽으려다 막히면 다시 좁혀 실행하라고 안내한다', () => {
  const remedy = sensitiveDenyRemedy({allowed: false, code: 'DENY_PATH_OUTSIDE'},
    {tool_name: 'Read', tool_input: {file_path: '/Users/u/.claude/projects/p/s/tool-results/b.txt'}})
  assert.match(remedy, /Re-run the command with narrower output/)
  assert.match(sensitiveDenyRemedy({code: 'DENY_PATH_OUTSIDE'}, {tool_input: {file_path: '/etc/hosts'}}), /workspace-roots\.json/)
})

const codesIn = (file, pattern) => [...new Set([...readFileSync(join(HERE, file), 'utf8').matchAll(pattern)].map(match => match[1]))]

test('두 정책이 내는 모든 거부 코드에 대안 문구가 있다', () => {
  const sensitive = codesIn('sensitive-access-policy-lib.mjs', /code: '(DENY_[A-Z_]+)'/g)
  assert.ok(sensitive.length >= 9, sensitive.join(' '))
  for (const code of sensitive) {
    for (const reason of code === 'DENY_SENSITIVE_TREE_GREP' ? ['symlink', 'too-large', 'too-many-secrets', 'secret-not-excludable'] : [undefined]) {
      assert.ok(sensitiveDenyRemedy({code, reason}), `${code} ${reason ?? ''}`)
    }
  }
  const bash = codesIn('global-bash-policy-lib.mjs', /(?:fail|deny)\('(DENY_[A-Z_]+)'/g)
  assert.ok(bash.length >= 15, bash.join(' '))
  for (const code of bash) assert.ok(bashPolicyRemedy(code), code)
})

// [명령, 코드] — 문구 변경 전 판정을 그대로 적었다(null = 허용).
const BASH_TABLE = [
  ['cat package.json', null],
  ['cat package.json | head', 'DENY_COMPOUND_SYNTAX'],
  ['echo hi && ls', 'DENY_COMPOUND_SYNTAX'],
  ['cat $HOME/x', 'DENY_SHELL_EXPANSION'],
  ['ls *.json', 'DENY_AMBIGUOUS_SYNTAX'],
  ['rg -n foo .claude/skills', 'DENY_ARGUMENTS'],
  ['grep -rn foo .claude/skills', 'DENY_ARGUMENTS'],
  ['head -n 5000 package.json', 'DENY_ARGUMENTS'],
  ['curl x', 'DENY_NETWORK'],
  ['git status', 'DENY_NETWORK'],
  ['rm x', 'DENY_DESTRUCTIVE'],
  ['pnpm run lint', 'DENY_PNPM_DIRECT'],
  ['python3 x', 'DENY_COMMAND'],
  ['cat /etc/hosts', 'DENY_PATH_OUTSIDE'],
  ['cat .env', 'DENY_SECRET_PATH'],
  ['cat nope.txt', 'DENY_PATH_MISSING'],
]
// Bash 표는 저장소 트리 상태에 묶이지 않게 임시 루트에서 판정한다. 예외: 실재 스크립트가 필요한 typed runner 예시는 저장소 루트.
const policy = (command, root) => evaluateGlobalBashPolicy({tool_name: 'Bash', cwd: root, tool_input: {command}},
  {environment: {CLAUDE_PROJECT_DIR: root}, processCwd: root})
const withBashProject = run => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-deny-bash-')))
  try {
    mkdirSync(join(root, '.claude/skills'), {recursive: true})
    writeFileSync(join(root, 'package.json'), '{}\n')
    writeFileSync(join(root, '.claude/skills/x.md'), 'x\n')
    return run(root)
  } finally { rmSync(root, {recursive: true, force: true}) }
}

test('판정 고정: 문구를 바꿔도 Bash 정책의 허용/거부·코드는 그대로다', () => withBashProject(root => {
  for (const [command, code] of BASH_TABLE) {
    const decision = policy(command, root)
    assert.deepEqual([decision.allowed, decision.allowed ? null : decision.code], [code === null, code], command)
  }
}))

test('verifier Bash 훅은 정책의 이유와 허용 형태를 그대로 낸다(종료 코드는 그대로)', () => withBashProject(root => {
  for (const [command, code] of BASH_TABLE) {
    const result = node('enforce-verifier-bash.mjs', {tool_name: 'Bash', agent_type: 'integration-verifier', cwd: root, tool_input: {command}}, root)
    if (code === null) { assert.equal(result.status, 0, `${command}: ${result.stderr}`); continue }
    assert.equal(result.status, 2, command)
    const {reason} = policy(command, root)
    assert.ok(result.stderr.includes(`(${code}): ${reason}`), `${command}: 이유가 빠졌다 — ${result.stderr}`)
    assert.ok(result.stderr.includes(bashPolicyRemedy(code)), `${command}: 대안이 빠졌다 — ${result.stderr}`)
  }
}))

test('Bash 대안 문구의 예시 명령은 같은 정책이 실제로 허용한다', () => {
  const sample = {FILE: 'package.json', DIR: '.claude', PATTERN: 'x', PATH: 'skills/README.md'}
  const examples = new Set()
  for (const [, code] of BASH_TABLE) {
    for (const [, snippet] of (bashPolicyRemedy(code) ?? '').matchAll(/`([^`]+)`/g)) {
      if (/^(?:cat|head|ls|rg|web-harness-read) /.test(snippet)) examples.add(snippet.replace(/\b(FILE|DIR|PATTERN|PATH)\b/g, name => sample[name]))
    }
  }
  assert.ok(examples.size >= 4, [...examples].join(' | '))
  withBashProject(root => {
    for (const command of examples) assert.equal(policy(command, root).allowed, true, `${command}: ${policy(command, root).reason}`)
  })
  // git 대안(typed runner)은 실재 스크립트가 필요하다 — 저장소 루트에서 판정한다.
  const git = bashPolicyRemedy('DENY_NETWORK').match(/`(node \.claude\/scripts\/run-git-inspection\.mjs [^`]+)`/)?.[1]
  assert.ok(git, 'DENY_NETWORK 문구에 git runner 예시가 없다')
  assert.equal(policy(git, ROOT).allowed, true, `${git}: ${policy(git, ROOT).reason}`)
})
