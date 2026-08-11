#!/usr/bin/env node

import {chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {
  analyzePackageScript,
  hasMeaningfulProfileScript,
  readDependencyBinding,
  readExecutionTargetBinding,
} from '../quality-policy-lib.mjs'

const fail = message => {
  process.stderr.write(`Quality policy self-test failed: ${message}\n`)
  process.exitCode = 1
}
const expectRejected = source => {
  const analysis = analyzePackageScript(source)
  if (analysis.ok) fail(`unsafe script was accepted: ${source}`)
}
const expectProfile = (id, definition, source) => {
  const analysis = analyzePackageScript(source)
  if (!analysis.ok || !hasMeaningfulProfileScript(id, definition, source, analysis)) {
    fail(`valid profile script was rejected: ${source}`)
  }
}

for (const source of [
  'FOO=tsc true',
  'FOO="tsc" true',
  'echo "tsc" && true',
  'printf \'next build\'',
  'tsc --noEmit && true',
  'tsc --noEmit || true',
  'tsc --noEmit; true',
  'tsc *.ts',
  'tsc !generated.ts',
  'sh -c "tsc --noEmit"',
  '"tsc" && "true"',
]) expectRejected(source)

expectProfile('quality.typecheck', {kind: 'contract'}, 'tsc --noEmit')
expectProfile('quality.typecheck', {kind: 'contract'}, 'CI=1 tsc -b --pretty false')
expectProfile('vite.build', {kind: 'build'}, 'tsc -b && vite build --mode production')
expectProfile('next.build', {kind: 'build'}, 'next build')
expectProfile('next.production-start', {kind: 'runtime'}, 'node scripts/production-start.mjs')
expectProfile('next.node-hydration', {kind: 'browser'}, 'playwright test tests/hydration.spec.ts')
expectProfile('vite.production-mock-boundary', {kind: 'security'}, 'vitest run tests/production-boundary.test.ts')
if (hasMeaningfulProfileScript('vite.production-mock-boundary', {kind: 'security'}, 'node scripts/noop.mjs')) {
  fail('Vite production boundary accepted an unstructured Node script')
}
if (hasMeaningfulProfileScript('quality.typecheck', {kind: 'contract'}, 'tsc --version')) {
  fail('diagnostic-only tsc script was accepted')
}
if (!analyzePackageScript('node -e "process.exit(0)"').ok) {
  fail('generic argv parser rejected the existing unprofiled Node fixture shape')
}

const root = mkdtempSync(join(tmpdir(), 'web-harness-quality-policy-'))
try {
  const lockfile = "lockfileVersion: '9.0'\n"
  const packageRoot = join(root, 'node_modules/.pnpm/typescript@1.0.0/node_modules/typescript')
  const binaryPath = join(packageRoot, 'bin/tsc')
  const libraryPath = join(packageRoot, 'lib/compiler.js')
  mkdirSync(dirname(binaryPath), {recursive: true})
  mkdirSync(dirname(libraryPath), {recursive: true})
  mkdirSync(join(root, 'node_modules/.bin'), {recursive: true})
  writeFileSync(join(root, 'pnpm-lock.yaml'), lockfile)
  writeFileSync(join(root, 'node_modules/.pnpm/lock.yaml'), lockfile)
  writeFileSync(join(packageRoot, 'package.json'), '{"name":"typescript","version":"1.0.0","bin":{"tsc":"bin/tsc"}}\n')
  writeFileSync(binaryPath, '#!/usr/bin/env node\n')
  writeFileSync(libraryPath, 'export const value = 1\n')
  symlinkSync('.pnpm/typescript@1.0.0/node_modules/typescript', join(root, 'node_modules/typescript'))
  symlinkSync('../.pnpm/typescript@1.0.0/node_modules/typescript/bin/tsc', join(root, 'node_modules/.bin/tsc'))
  const packageJson = {devDependencies: {typescript: '1.0.0'}}
  const dependencyBefore = readDependencyBinding(root, packageJson)
  if (!dependencyBefore.satisfied || !dependencyBefore.installedDependencyContentSha256) {
    fail('complete dependency fixture did not produce a content binding')
  }
  writeFileSync(libraryPath, readFileSync(libraryPath, 'utf8').replace('1', '2'))
  const dependencyAfter = readDependencyBinding(root, packageJson)
  if (dependencyBefore.installedDependencyContentSha256 === dependencyAfter.installedDependencyContentSha256) {
    fail('installed dependency content mutation was not detected')
  }

  const wrapperPath = join(root, 'node_modules/.bin/tsc')
  rmSync(wrapperPath)
  writeFileSync(wrapperPath, '#!/bin/sh\nexit 0\n')
  chmodSync(wrapperPath, 0o755)
  const wrapperMutation = readDependencyBinding(root, packageJson)
  if (dependencyAfter.installedDependencyContentSha256 === wrapperMutation.installedDependencyContentSha256) {
    fail('effective .bin wrapper mutation was not detected')
  }
  rmSync(wrapperPath)
  symlinkSync('../.pnpm/typescript@1.0.0/node_modules/typescript/bin/tsc', wrapperPath)

  const packageLinkPath = join(root, 'node_modules/typescript')
  rmSync(packageLinkPath)
  mkdirSync(packageLinkPath)
  writeFileSync(join(packageLinkPath, 'package.json'), '{"name":"typescript","version":"1.0.0"}\n')
  const shadowBinding = readDependencyBinding(root, packageJson)
  if (shadowBinding.satisfied || !shadowBinding.inventoryError?.includes('top-level installed package')) {
    fail('regular top-level package shadow directory was not blocked')
  }
  rmSync(packageLinkPath, {recursive: true, force: true})

  const ignoredWorkspacePackageRoot = join(root, '_workspace/04_qa/typescript')
  mkdirSync(ignoredWorkspacePackageRoot, {recursive: true})
  writeFileSync(join(ignoredWorkspacePackageRoot, 'package.json'), '{"name":"typescript","version":"1.0.0"}\n')
  writeFileSync(join(ignoredWorkspacePackageRoot, 'index.js'), 'export const hiddenRuntime = true\n')
  symlinkSync('../_workspace/04_qa/typescript', packageLinkPath)
  const ignoredWorkspaceBinding = readDependencyBinding(root, packageJson)
  if (
    ignoredWorkspaceBinding.satisfied ||
    !ignoredWorkspaceBinding.inventoryError?.includes('pnpm virtual-store graph')
  ) {
    fail('top-level package symlink to a source-ignored workspace was not blocked')
  }
  rmSync(packageLinkPath)
  symlinkSync('.pnpm/typescript@1.0.0/node_modules/typescript', packageLinkPath)

  mkdirSync(join(root, '.git'), {recursive: true})
  writeFileSync(join(root, '.git/config'), '[credential]\nhelper = unsafe\n')
  const protectedLinkPath = join(packageRoot, 'protected-link')
  symlinkSync(join(root, '.git/config'), protectedLinkPath)
  const protectedLinkBinding = readDependencyBinding(root, packageJson)
  if (protectedLinkBinding.satisfied || !protectedLinkBinding.inventoryError?.includes('escapes node_modules')) {
    fail(`installed dependency symlink to a protected project path was not blocked: ${protectedLinkBinding.inventoryError ?? 'satisfied'}`)
  }
  rmSync(protectedLinkPath)

  const analysis = analyzePackageScript('tsc --noEmit')
  const targetBefore = readExecutionTargetBinding({
    projectRoot: root,
    analysis,
    pnpmExecutable: process.execPath,
    searchPath: process.env.PATH,
  })
  if (!targetBefore.satisfied || !targetBefore.targets.some(target => target.executable === 'tsc')) {
    fail(`local package binary was not resolved and bound: ${targetBefore.errors.join('; ')}`)
  }
  writeFileSync(binaryPath, '#!/usr/bin/env node\n// changed\n')
  const targetAfter = readExecutionTargetBinding({
    projectRoot: root,
    analysis,
    pnpmExecutable: process.execPath,
    searchPath: process.env.PATH,
  })
  if (targetBefore.sha256 === targetAfter.sha256) fail('resolved package binary mutation was not detected')
} finally {
  rmSync(root, {recursive: true, force: true})
}

if (!process.exitCode) process.stdout.write('Quality policy self-test passed\n')
