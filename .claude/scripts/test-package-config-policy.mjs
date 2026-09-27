#!/usr/bin/env node
// test-package-config-policy.mjs — 품질 러너의 프로젝트 .npmrc·pnpm 훅 판정.
//
// 사내 registry 브라운필드는 레지스트리·인증 줄을 담은 .npmrc를 커밋한다 — 그것만으로 러너가 막히면 그 프로젝트에서
// 하네스 증거가 한 장도 서지 않는다. 대신 스크립트 실행을 바꾸는 키(node-options·script-shell·pre/post 스크립트 등)와
// pnpm 훅 파일은 막고, 값은 어디에도 출력·기록하지 않는다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {classifyNpmrcKey, inspectPackageConfig, parseNpmrcKeys, workspaceDisallowedKeys} from './quality-policy-lib.mjs'

const runner = fileURLToPath(new URL('./run-quality-gates.mjs', import.meta.url))
const fixture = fileURLToPath(new URL('../../golden/vite-serverless-hybrid', import.meta.url))

test('허용: 레지스트리·스코프 레지스트리·레지스트리 인증·전송·설치 옵션', () => {
  assert.equal(classifyNpmrcKey('registry'), 'registry')
  assert.equal(classifyNpmrcKey('@acme:registry'), 'scoped-registry')
  assert.equal(classifyNpmrcKey('//npm.acme.example/:_authToken'), 'registry-auth')
  assert.equal(classifyNpmrcKey('//npm.acme.example/path/:_auth'), 'registry-auth')
  assert.equal(classifyNpmrcKey('strict-ssl'), 'transport')
  assert.equal(classifyNpmrcKey('auto-install-peers'), 'install-option')
})

test('거부: 실행을 바꾸는 키·레지스트리 호스트 아래의 모르는 필드·섹션·모르는 키', () => {
  for (const key of ['node-options', 'script-shell', 'shell-emulator', 'enable-pre-post-scripts', 'node-linker',
    'verify-deps-before-run', 'manage-package-manager-versions', 'use-node-version', 'pnpmfile', 'global-pnpmfile',
    'userconfig', 'globalconfig', '//npm.acme.example/:node-options', '[section]', 'totally-unknown-key',
    'audit-level', 'https-proxy', 'proxy', 'ca', 'cafile']) {
    assert.equal(classifyNpmrcKey(key), null, `${key}를 허용했다`)
  }
})

test('키 이름만 뽑는다 — 주석·따옴표·배열 표기를 가리고 값은 버린다', () => {
  const keys = parseNpmrcKeys([
    '# 사내 registry', '; 주석', '', 'registry = https://npm.acme.example/', '"@acme:registry"=https://npm.acme.example/',
    '//npm.acme.example/:_authToken=${NPM_TOKEN}', 'public-hoist-pattern[]=*eslint*', 'engine-strict',
  ].join('\n'))
  assert.deepEqual(keys, ['registry', '@acme:registry', '//npm.acme.example/:_authToken', 'public-hoist-pattern', 'engine-strict'])
  assert.ok(!keys.some(key => key.includes('NPM_TOKEN') || key.includes('https')), '값이 키로 섞였다')
})

// pnpm(ini)은 \r 단독도 줄 끝으로 본다 — 다르게 나누면 거부할 키가 허용 키의 값 안에 숨어 audit 판정을 바꾼다
// (pnpm 10.23 실측: `registry=…\raudit-level=critical`에서 audit-level이 critical로 적용됐다).
test('줄 나누기는 pnpm과 같다 — \\r 단독 줄 끝에 숨긴 키도 찾아 거부한다, NUL 바이트도 거부', () => {
  const hidden = parseNpmrcKeys('registry=https://registry.npmjs.org/\raudit-level=critical')
  assert.deepEqual(hidden, ['registry', 'audit-level'])
  assert.ok(hidden.some(key => !classifyNpmrcKey(key)), 'CR로 숨긴 키를 허용했다')
  assert.ok(parseNpmrcKeys('registry=x\0node-options=y').some(key => !classifyNpmrcKey(key)))
})

// pnpm-workspace.yaml 설정은 env 고정보다 우선한다(실측) — 파일 자체를 판정한다.
test('pnpm-workspace.yaml: 작업공간·설치 해석 키만 허용하고 audit·실행·네트워크 키와 모호한 YAML은 거부', () => {
  assert.deepEqual(workspaceDisallowedKeys("packages:\n  - 'apps/*'\nonlyBuiltDependencies:\n  - esbuild\n"), [])
  assert.deepEqual(workspaceDisallowedKeys('packages: []\nauditLevel: critical\nstrictSsl: false\n'), ['auditLevel', 'strictSsl'])
  assert.deepEqual(workspaceDisallowedKeys('packages: []\rhttpsProxy: http://evil\n'), ['httpsProxy'])
  assert.ok(workspaceDisallowedKeys('base: &b {auditLevel: critical}\npackages: []\n').length > 0, '앵커를 통과시켰다')
  assert.ok(workspaceDisallowedKeys('"auditLevel": critical\n').length > 0, '따옴표 키를 통과시켰다')
  // js-yaml은 들여쓴 루트·`---` 줄의 흐름 매핑·BOM을 받아들인다(pnpm 10.23·11.18 실측: 셋 다 audit-level=critical)
  assert.deepEqual(workspaceDisallowedKeys('  packages: []\n  auditLevel: critical\n'), ['<indented root>'])
  assert.ok(workspaceDisallowedKeys('--- {packages: [], auditLevel: critical}\n').length > 0, '`---` 줄의 내용을 통과시켰다')
  assert.ok(workspaceDisallowedKeys('\uFEFFauditLevel: critical\npackages: []\n').length > 0, 'BOM 뒤의 키를 통과시켰다')
  assert.deepEqual(workspaceDisallowedKeys('packages: []\nautoInstallPeers: true\n'), [], '.npmrc에서 허용한 설치 옵션의 camelCase를 거부했다')
})

test('파일 판정: 허용 키만이면 통과, pnpm 훅 파일은 늘 막힌다, 저장소 경계까지 올라간다', () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-npmrc-'))
  try {
    mkdirSync(join(root, '.git'))
    mkdirSync(join(root, 'apps/web'), {recursive: true})
    writeFileSync(join(root, '.npmrc'), 'registry=https://npm.acme.example/\n//npm.acme.example/:_authToken=secret-value\n')
    const allowed = inspectPackageConfig(join(root, 'apps/web'))
    assert.equal(allowed.blocked, false)
    assert.deepEqual(allowed.files.map(file => file.classes), [['registry', 'registry-auth']])
    writeFileSync(join(root, '.pnpmfile.cjs'), 'module.exports = {}\n')
    assert.equal(inspectPackageConfig(join(root, 'apps/web')).blocked, true, 'pnpm 훅 파일을 통과시켰다')
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

const runOnFixture = npmrc => {
  const root = mkdtempSync(join(tmpdir(), 'wh-npmrc-run-'))
  const project = join(root, 'p')
  try {
    cpSync(fixture, project, {recursive: true, filter: source => !source.includes('/node_modules')})
    writeFileSync(join(project, '.npmrc'), npmrc)
    const result = spawnSync(process.execPath, [runner, '--project', project, '--check', 'typecheck'], {
      encoding: 'utf8', env: {...process.env, WEB_HARNESS_ISOLATED_EXECUTION: '1'},
    })
    let receipt = null
    try { receipt = JSON.parse(readFileSync(join(project, '_workspace/04_qa/evidence/typecheck.json'), 'utf8')) } catch { /* 거부되면 없다 */ }
    return {result, receipt}
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
}

test('실제 러너: 사내 registry .npmrc는 통과해 영수증을 쓰고, 영수증엔 키 분류만 남는다', () => {
  const {result, receipt} = runOnFixture('registry=https://npm.acme.example/\n//npm.acme.example/:_authToken=tok-VALUE-4471\n')
  assert.doesNotMatch(result.stderr, /allowlist/, `허용 설정을 거부했다:\n${result.stderr}`)
  assert.ok(receipt, `영수증이 없다:\n${result.stderr}`)
  assert.deepEqual(receipt.packageConfig, [{kind: 'npmrc', classes: ['registry', 'registry-auth']}])
  assert.doesNotMatch(JSON.stringify(receipt), /tok-VALUE-4471|npm\.acme\.example/, '영수증에 값이나 사내 호스트가 실렸다')
  // audit(러너 안의 유일한 pnpm 호출) 판정을 프로젝트 설정이 바꾸지 못하게 env로 고정한다.
  for (const key of ['npm_config_strict_ssl', 'npm_config_audit_level', 'npm_config_registry']) {
    assert.ok(receipt.environmentPolicy.inheritedKeys.includes(key), `${key} 고정이 빠졌다`)
  }
})

test('실제 러너: package.json pnpm.auditConfig가 있으면 막는다 — audit 판정에서 권고를 지운다', () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-auditcfg-'))
  const project = join(root, 'p')
  try {
    cpSync(fixture, project, {recursive: true, filter: source => !source.includes('/node_modules')})
    const packagePath = join(project, 'package.json')
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
    packageJson.pnpm = {...(packageJson.pnpm ?? {}), auditConfig: {ignoreCves: ['CVE-2099-0001']}}
    writeFileSync(packagePath, JSON.stringify(packageJson, null, 2))
    const result = spawnSync(process.execPath, [runner, '--project', project, '--check', 'audit'], {
      encoding: 'utf8', env: {...process.env, WEB_HARNESS_ISOLATED_EXECUTION: '1'},
    })
    assert.equal(result.status, 2)
    assert.match(result.stderr, /auditConfig/)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('실제 러너: 실행을 바꾸는 키가 있으면 막고, 키 이름만 알리며 값은 출력하지 않는다', () => {
  const {result, receipt} = runOnFixture('registry=https://npm.acme.example/\nnode-options=--require ./steal-4471.js\n')
  assert.equal(result.status, 2)
  assert.match(result.stderr, /node-options/)
  assert.doesNotMatch(result.stderr, /steal-4471/, '값을 출력했다')
  assert.equal(receipt, null, '거부했는데 영수증을 썼다')
})

// 수집 QA는 감지가 아니라 선언에 걸린다(프로필 해석과 같은 규칙) — 나가는 호출이 있는 개발 스크립트 하나로 러너 전체를 막지 않는다.
const runIngestionCase = setup => {
  const root = mkdtempSync(join(tmpdir(), 'wh-ingestion-run-'))
  const project = join(root, 'p')
  try {
    cpSync(fixture, project, {recursive: true, filter: source => !source.includes('/node_modules')})
    mkdirSync(join(project, 'scripts'), {recursive: true})
    writeFileSync(join(project, 'scripts/upload.mjs'), "await fetch('https://cdn.example.test/upload', {method: 'POST'})\n")
    setup(project)
    const result = spawnSync(process.execPath, [runner, '--project', project, '--check', 'typecheck'], {
      encoding: 'utf8', env: {...process.env, WEB_HARNESS_ISOLATED_EXECUTION: '1'},
    })
    let receipt = null
    try { receipt = JSON.parse(readFileSync(join(project, '_workspace/04_qa/evidence/typecheck.json'), 'utf8')) } catch { /* 막히면 없다 */ }
    return {result, receipt}
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
}

test('실제 러너: 감지만 되고 선언이 없으면 막지 않고 알리며 영수증에 남긴다', () => {
  const {result, receipt} = runIngestionCase(() => {})
  assert.doesNotMatch(result.stderr, /requires both/, `감지만으로 러너를 막았다:\n${result.stderr}`)
  assert.match(result.stderr, /detected but not declared/)
  assert.ok(receipt, `영수증이 없다:\n${result.stderr}`)
  assert.equal(receipt.ingestionReadiness.detected, true)
  assert.equal(receipt.ingestionReadiness.declared, false)
})

test('실제 러너: 계약을 하나라도 두면 선언이다 — 나머지 계약이 없으면 막는다', () => {
  const {result, receipt} = runIngestionCase(project => {
    mkdirSync(join(project, '_workspace/02_design'), {recursive: true})
    writeFileSync(join(project, '_workspace/02_design/ingestion-contract.md'), '# ingestion\n')
  })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /Declared external ingestion requires both/)
  assert.equal(receipt, null)
})
