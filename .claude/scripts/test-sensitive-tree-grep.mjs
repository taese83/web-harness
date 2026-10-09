#!/usr/bin/env node
// test-sensitive-tree-grep.mjs — 비밀 경로가 있는 트리의 Grep을 막는 대신 비밀 파일을 빼는 glob을 붙여 연다.
//
// 고정하는 사실: 커밋된 공개값 env 파일 때문에 앱 폴더 검색이 늘 막혀 에이전트가 턴을 재시도에 썼다(실사용 2026-10). 이제
//   - glob이 없거나 제외 glob이면 비밀 제외 glob으로 바꿔 허용(type 필터는 유지) · 코드 확장자 포함 glob은 그대로 허용
//   - 넓거나 비밀에 걸리는 포함 glob은 제외 glob으로 바꾸고(확장자 하나면 rg type으로 범위 유지), 빠지지 않는 비밀(대소문자)·링크는 막는다
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {evaluateSensitiveAccess, SECRET_EXCLUDE_GLOB} from './sensitive-access-policy-lib.mjs'
import {readdirSync} from 'node:fs'

const hook = join(dirname(fileURLToPath(import.meta.url)), 'enforce-sensitive-access.mjs')
const withProject = (files, run) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-tree-grep-')))
  try {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), {recursive: true})
      writeFileSync(join(root, path), content)
    }
    return run(root)
  } finally { rmSync(root, {recursive: true, force: true}) }
}
const grep = (root, input) => evaluateSensitiveAccess({tool_name: 'Grep', tool_input: {pattern: 'x', ...input}}, {CLAUDE_PROJECT_DIR: root})
const ENV_APP = {'apps/user/.env.dev': 'VITE_X=1\n', 'apps/user/src/a.ts': 'x\n'}

test('공개값 env가 커밋된 앱 폴더: glob이 없거나 제외 glob이면 비밀 제외 glob으로 바꿔 허용한다', () => withProject(ENV_APP, root => {
  for (const glob of [undefined, '!node_modules/**']) {
    const decision = grep(root, {path: join(root, 'apps/user'), ...(glob ? {glob} : {})})
    assert.equal(decision.allowed, true, JSON.stringify(decision))
    assert.equal(decision.updatedInput.glob, SECRET_EXCLUDE_GLOB)
  }
  const typed = grep(root, {path: join(root, 'apps/user'), type: 'ts'})
  assert.equal(typed.updatedInput.type, 'ts', 'type 필터를 지웠다')
}))

test('코드 확장자 포함 glob은 그대로 허용하고, 넓은 포함 glob은 비밀 제외 glob으로 바꾼다', () => withProject(ENV_APP, root => {
  const code = grep(root, {path: join(root, 'apps/user'), glob: '*.{ts,tsx}'})
  assert.equal(code.allowed, true)
  assert.equal(code.updatedInput, undefined)
  assert.equal(grep(root, {path: join(root, 'apps/user'), glob: '*.json'}).updatedInput.glob, SECRET_EXCLUDE_GLOB)
}))

test('Codex 교차 리뷰 지적: 비밀 파일이 포함 glob에 걸리면(.env.ts·*.ts) 그대로 두지 않고 제외 glob으로 바꾼다', () => withProject({'app/.env.ts': 'K=1\n', 'app/a.ts': 'x\n'}, root => {
  assert.equal(grep(root, {path: join(root, 'app'), glob: '*.ts'}).updatedInput.glob, SECRET_EXCLUDE_GLOB)
}))

test('Codex 교차 리뷰 지적: 비밀 디렉터리 이름과 같은 일반 파일(secrets)도 제외 glob이 뺀다', () => {
  assert.match(SECRET_EXCLUDE_GLOB, /[{,]secrets,secrets\/\*\*[,}]/)
})

test('비밀 디렉터리는 코드 확장자 glob으로 빠지지 않는다 — 그 glob을 제외 glob으로 바꾼다', () => withProject({'app/secrets/k.ts': 'x\n', 'app/a.ts': 'x\n'}, root => {
  assert.equal(grep(root, {path: join(root, 'app'), glob: '*.ts'}).updatedInput.glob, SECRET_EXCLUDE_GLOB)
  assert.equal(grep(root, {path: join(root, 'app')}).updatedInput.glob, SECRET_EXCLUDE_GLOB)
}))

test('glob으로 정확히 빠지지 않는 비밀(대소문자)·심볼릭 링크는 계속 막는다', () => {
  withProject({'app/.ENV': 'X=1\n', 'app/a.ts': 'x\n'}, root => {
    assert.equal(grep(root, {path: join(root, 'app')}).code, 'DENY_SENSITIVE_TREE_GREP')
  })
  withProject({'app/a.ts': 'x\n'}, root => {
    symlinkSync(join(root, 'app/a.ts'), join(root, 'app/link.ts'))
    assert.equal(grep(root, {path: join(root, 'app')}).code, 'DENY_SENSITIVE_TREE_GREP')
  })
})

test('훅 프로세스: 바꾼 입력을 permissionDecision allow + updatedInput으로 돌려준다', () => withProject(ENV_APP, root => {
  const result = spawnSync(process.execPath, [hook], {encoding: 'utf8', env: {...process.env, CLAUDE_PROJECT_DIR: root},
    input: JSON.stringify({tool_name: 'Grep', cwd: root, tool_input: {pattern: 'x', path: join(root, 'apps/user')}})})
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout).hookSpecificOutput
  assert.equal(output.permissionDecision, 'allow')
  assert.equal(output.updatedInput.glob, SECRET_EXCLUDE_GLOB)
  assert.equal(output.updatedInput.path, join(root, 'apps/user'))
}))

test('비밀에 걸리는 확장자 하나짜리 포함 glob은 제외 glob + 같은 rg type으로 바꿔 범위를 지킨다', () => withProject({'app/.env.ts': 'K=1\n', 'app/a.ts': 'x\n'}, root => {
  const decision = grep(root, {path: join(root, 'app'), glob: '*.{ts,tsx}'})
  assert.equal(decision.updatedInput.glob, SECRET_EXCLUDE_GLOB)
  assert.equal(decision.updatedInput.type, 'ts')
  assert.equal(decision.replacedGlob, '*.{ts,tsx}')
}))

// 실제 ripgrep으로 제외 glob을 확인한다 — 손 실측이 아니라 고정된 증거(rg가 없으면 건너뛴다).
const rg = spawnSync('rg', ['--version'], {encoding: 'utf8'})
test('실제 rg: 제외 glob이 모든 비밀 형태(파일·디렉터리·같은 이름 일반 파일)를 빼고 .env.yaml처럼 포함 glob에 걸리는 것도 뺀다', {skip: rg.status !== 0 && 'rg 없음'}, () => {
  const files = {'a/.env': 'S', 'a/.env.dev': 'S', 'a/.env.yaml': 'S', 'a/.env.ts': 'S', 'a/.dev.vars': 'S', 'a/.git-credentials': 'S', 'a/.netrc': 'S',
    'a/.npmrc': 'S', 'a/.pypirc': 'S', 'a/credentials.json': 'S', 'a/service-account.json': 'S', 'a/k.jks': 'S', 'a/k.key': 'S', 'a/k.keystore': 'S',
    'a/k.p12': 'S', 'a/k.pem': 'S', 'a/k.pfx': 'S', 'b/secrets': 'S', 'b/secret': 'S', 'b/credentials': 'S', 'b/credential': 'S',
    'c/secrets/x.ts': 'S', 'c/.ssh/id': 'S', 'c/.aws/config': 'S', 'c/.kube/config': 'S', 'c/.docker/config.json': 'S', 'c/.gnupg/k': 'S', 'c/.azure/x': 'S',
    'ok/a.ts': 'S', 'ok/b.yaml': 'S', 'ok/c.json': 'S'}
  withProject(files, root => {
    const listed = glob => spawnSync('rg', ['--files', '--hidden', '-g', SECRET_EXCLUDE_GLOB, ...(glob ? ['-g', glob] : []), '.'], {cwd: root, encoding: 'utf8'})
      .stdout.split('\n').filter(Boolean).map(path => path.replace(/^\.\//, '')).sort()
    assert.deepEqual(listed(), ['ok/a.ts', 'ok/b.yaml', 'ok/c.json'])
    // 포함 glob이 숨김 파일을 끌어들여도(.env.yaml) 제외 glob이 이긴다.
    assert.deepEqual(spawnSync('rg', ['--files', '-g', SECRET_EXCLUDE_GLOB, '-t', 'yaml', '.'], {cwd: root, encoding: 'utf8'})
      .stdout.split('\n').filter(Boolean).map(path => path.replace(/^\.\//, '')), ['ok/b.yaml'])
    assert.ok(readdirSync(join(root, 'a')).length > 10)
  })
})

test('Codex 교차 리뷰 지적: 검사가 건너뛴 디렉터리(dist·node_modules)는 검색에서도 빼고, 그때는 포함 glob을 그대로 두지 않는다', () => withProject({'app/.env': 'K=1\n', 'app/dist/PRIVATE.KEY': 'S\n', 'app/a.ts': 'x\n'}, root => {
  const kept = grep(root, {path: join(root, 'app'), glob: '*.ts'})
  assert.equal(kept.updatedInput?.glob, SECRET_EXCLUDE_GLOB, '건너뛴 디렉터리가 있는데 포함 glob을 그대로 뒀다')
  assert.match(SECRET_EXCLUDE_GLOB, /[{,]dist,dist\/\*\*[,}]/)
  assert.match(SECRET_EXCLUDE_GLOB, /[{,]node_modules,node_modules\/\*\*[,}]/)
}))
