#!/usr/bin/env node

import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {inspectDeploymentArtifact} from '../artifact-inventory-lib.mjs'
import {computeSourceFingerprint} from '../evidence-lib.mjs'
import {readProjectRegularFile} from '../safe-project-file-lib.mjs'
import {evaluateSensitiveAccess} from '../sensitive-access-policy-lib.mjs'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '..', '..', '..')
const packageBroker = join(repositoryRoot, '.claude/scripts/run-package-operation.mjs')
const temporaryRoot = mkdtempSync(join(tmpdir(), 'web-harness-security-hardening-'))
const packageFixture = mkdtempSync(join(repositoryRoot, '.security-hardening-package-'))

const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
const runBroker = operation => {
  const environment = {...process.env}
  delete environment.WEB_HARNESS_ISOLATED_EXECUTION
  return spawnSync(process.execPath, [packageBroker, '--project', packageFixture, '--operation', operation], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: environment,
  })
}

try {
  const gitDirectory = join(temporaryRoot, 'sensitive-project/.git')
  mkdirSync(gitDirectory, {recursive: true})
  writeFileSync(join(gitDirectory, 'config'), '[remote "origin"]\n  url = https://user:credential@example.invalid/repo\n')
  const sensitiveEnvironment = {CLAUDE_PROJECT_DIR: join(temporaryRoot, 'sensitive-project')}
  for (const input of [
    {tool_name: 'Read', tool_input: {file_path: '.git/config'}},
    {tool_name: 'Grep', tool_input: {path: '.git/config', pattern: '.'}},
    {tool_name: 'Glob', tool_input: {path: '.git', pattern: '**/config'}},
    {tool_name: 'Glob', tool_input: {path: '.', pattern: '.git/config'}},
    {tool_name: 'Glob', tool_input: {path: '.', pattern: '.g?t/config'}},
    {tool_name: 'Glob', tool_input: {path: '.', pattern: '[.]git/config'}},
    {tool_name: 'Glob', tool_input: {path: '.', pattern: '**/config'}},
    {tool_name: 'Glob', tool_input: {pattern: '{.git,src}/config'}},
  ]) {
    assert.equal(evaluateSensitiveAccess(input, sensitiveEnvironment).allowed, false, `${input.tool_name} exposed .git/config`)
  }

  const sourceProject = join(temporaryRoot, 'source-project')
  mkdirSync(join(sourceProject, 'src/internal'), {recursive: true})
  writeFileSync(join(sourceProject, 'src/internal/value.ts'), 'export const value = 1\n')
  symlinkSync('internal/value.ts', join(sourceProject, 'src/value.ts'), 'file')
  const firstFingerprint = computeSourceFingerprint(sourceProject)
  writeFileSync(join(sourceProject, 'src/internal/value.ts'), 'export const value = 2\n')
  const secondFingerprint = computeSourceFingerprint(sourceProject)
  assert.notEqual(firstFingerprint, secondFingerprint, 'contained symlink target content was not fingerprinted')

  const externalSource = join(temporaryRoot, 'external.ts')
  writeFileSync(externalSource, 'export const outside = true\n')
  symlinkSync(externalSource, join(sourceProject, 'src/external.ts'), 'file')
  assert.throws(() => computeSourceFingerprint(sourceProject), /symlink escapes the project/)
  rmSync(join(sourceProject, 'src/external.ts'))
  mkdirSync(join(sourceProject, '.git'), {recursive: true})
  writeFileSync(join(sourceProject, '.git/config'), '[remote "origin"]\n')
  symlinkSync('../.git/config', join(sourceProject, 'src/secret-config'), 'file')
  assert.throws(() => computeSourceFingerprint(sourceProject), /targets ignored or sensitive content/)
  rmSync(join(sourceProject, 'src/secret-config'))
  symlinkSync('internal', join(sourceProject, 'src/directory-link'), 'dir')
  assert.throws(() => computeSourceFingerprint(sourceProject), /directory and special-file symlinks are unsupported/)

  const evidenceProject = join(temporaryRoot, 'evidence-project')
  const outsideEvidence = join(temporaryRoot, 'outside-evidence')
  mkdirSync(evidenceProject, {recursive: true})
  mkdirSync(outsideEvidence, {recursive: true})
  writeFileSync(join(outsideEvidence, 'receipt.json'), '{"status":"PASS"}\n')
  symlinkSync(outsideEvidence, join(evidenceProject, 'evidence'), 'dir')
  assert.throws(
    () => readProjectRegularFile(evidenceProject, 'evidence/receipt.json'),
    /parent must be a real non-symlink directory/,
    'bounded project reader followed a parent-directory symlink',
  )

  const artifactProject = join(temporaryRoot, 'artifact-project')
  const artifactDirectory = join(artifactProject, 'dist/nested')
  mkdirSync(artifactDirectory, {recursive: true})
  writeFileSync(join(artifactDirectory, 'index.js'), 'export default 1\n')
  chmodSync(artifactDirectory, 0o755)
  const firstArtifact = inspectDeploymentArtifact(artifactProject, {id: 'dist', path: 'dist', kind: 'static-directory'})
  assert.equal(firstArtifact.directoryCount, 2)
  if (process.platform !== 'win32') {
    chmodSync(artifactDirectory, 0o700)
    const secondArtifact = inspectDeploymentArtifact(artifactProject, {id: 'dist', path: 'dist', kind: 'static-directory'})
    assert.notEqual(firstArtifact.sha256, secondArtifact.sha256, 'artifact directory metadata was not bound')
  }

  writeJson(join(packageFixture, 'package.json'), {
    name: 'security-hardening-fixture',
    private: true,
    packageManager: 'pnpm@11.18.0',
    dependencies: {example: '1.0.0'},
  })
  writeFileSync(join(packageFixture, 'pnpm-lock.yaml'), String.raw`lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      example:
        specifier: 1.0.0
        version: 1.0.0
packages:
  example@1.0.0:
    resolution:
      tarball: "https:\u002F\u002Fevil.example.invalid\u002Fexample.tgz"
`)
  const escapedUrl = runBroker('install')
  assert.equal(escapedUrl.status, 2)
  assert.match(escapedUrl.stderr, /escaped or ambiguous YAML/)

  for (const source of [
    'ftp://registry.npmjs.org/example.tgz',
    'ssh://registry.npmjs.org/example.tgz',
    'data:application/octet-stream;base64,ZXhhbXBsZQ==',
    '//evil.example.invalid/example.tgz',
  ]) {
    writeFileSync(join(packageFixture, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'\nresolution:\n  tarball: "${source}"\n`)
    const nonRegistryScheme = runBroker('install')
    assert.equal(nonRegistryScheme.status, 2, `${source} was not blocked`)
    assert.match(nonRegistryScheme.stderr, /non-public-registry/, `${source} did not report the source policy`)
  }

  writeFileSync(join(packageFixture, 'pnpm-workspace.yaml'), `packages:\n  - apps/*\n"overrides":\n  example: 2.0.0\n`)
  const quotedOverride = runBroker('install')
  assert.equal(quotedOverride.status, 2)
  assert.match(quotedOverride.stderr, /resolution customization/)

  rmSync(join(packageFixture, 'pnpm-workspace.yaml'))
  writeJson(join(packageFixture, 'package.json'), {
    name: 'security-hardening-fixture',
    private: true,
    packageManager: 'pnpm@11.18.0',
    dependencies: {msw: '2.12.10'},
  })
  writeFileSync(
    join(packageFixture, 'pnpm-lock.yaml'),
    "lockfileVersion: '9.0'\nimporters:\n  .: {}\npackages:\n  msw@2.12.10:\n    resolution:\n      tarball: https://registry.npmjs.org/msw/-/msw-2.12.10.tgz\n",
  )
  const hostInitializer = runBroker('msw-init')
  assert.equal(hostInitializer.status, 2)
  assert.match(hostInitializer.stderr, /BLOCKED without externally isolated execution/)

  const isolatedEnvironment = {...process.env, WEB_HARNESS_ISOLATED_EXECUTION: '1'}
  const unreviewedInitializer = spawnSync(
    process.execPath,
    [packageBroker, '--project', packageFixture, '--operation', 'msw-init'],
    {cwd: repositoryRoot, encoding: 'utf8', env: isolatedEnvironment},
  )
  assert.equal(unreviewedInitializer.status, 2)
  assert.match(unreviewedInitializer.stderr, /reviewed installed local binary/)

  process.stdout.write('Security hardening self-test passed (package YAML, sensitive access, source/evidence symlinks, artifact metadata, initializer isolation).\n')
} finally {
  rmSync(temporaryRoot, {recursive: true, force: true})
  rmSync(packageFixture, {recursive: true, force: true})
}
