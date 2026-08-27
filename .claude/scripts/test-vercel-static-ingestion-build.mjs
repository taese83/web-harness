#!/usr/bin/env node

import assert from 'node:assert/strict'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {loadBuiltinAdapters} from './web-core/adapter-lib.mjs'
import {resolveProjectProfile} from './web-core/profile-lib.mjs'

const root = mkdtempSync(join(tmpdir(), 'web-harness-vercel-static-build-'))
const wrapper = fileURLToPath(new URL('./run-vercel-static-ingestion-build.mjs', import.meta.url))
const envelope = records => ({
  generatedAt: new Date().toISOString(),
  count: records.length,
  data: records,
})

try {
  for (const directory of [
    'public', 'schemas', 'scripts', 'src', '_workspace/01_plan', '_workspace/02_design',
  ]) mkdirSync(join(root, directory), {recursive: true})
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({
    name: 'vercel-static-ingestion-fixture',
    packageManager: 'pnpm@11.18.0',
    engines: {node: '>=22.22.0'},
    scripts: {
      build: 'node scripts/build.mjs',
      'validate:ingestion': 'node scripts/validate-ingestion.mjs',
    },
    dependencies: {react: '19.1.1'},
    devDependencies: {vite: '7.1.3'},
  })}\n`)
  writeFileSync(join(root, 'vite.config.ts'), 'export default {}\n')
  writeFileSync(join(root, 'src/main.tsx'), 'export {}\n')
  writeFileSync(join(root, 'scripts/validate-ingestion.mjs'), 'process.exit(0)\n')
  writeFileSync(
    join(root, 'scripts/build.mjs'),
    "import {cpSync,mkdirSync} from 'node:fs'; mkdirSync('dist',{recursive:true}); for(const x of ['data.json','last-known-good.json']) cpSync('public/'+x,'dist/'+x)\n",
  )
  writeFileSync(join(root, 'schemas/data.schema.json'), `${JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    required: ['generatedAt', 'count', 'data'],
    properties: {
      generatedAt: {type: 'string', format: 'date-time'},
      count: {type: 'integer', minimum: 0},
      data: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id'],
          properties: {id: {type: 'string'}},
          additionalProperties: false,
        },
      },
    },
    additionalProperties: false,
  })}\n`)
  const records = [{id: 'race-1'}, {id: 'race-2'}]
  writeFileSync(join(root, 'public/data.json'), `${JSON.stringify(envelope(records))}\n`)
  writeFileSync(join(root, 'public/last-known-good.json'), `${JSON.stringify(envelope(records))}\n`)
  writeFileSync(join(root, '_workspace/02_design/ingestion-contract.md'), '# Ingestion Contract\n')
  writeFileSync(join(root, '_workspace/02_design/runtime-data-contract.json'), `${JSON.stringify({
    $schema: '.claude/schemas/runtime-data-contract.schema.json',
    schemaVersion: 1,
    mode: 'static-snapshot',
    authoritativeSource: 'fixture-source',
    buildCwd: '.',
    deploymentRoot: '.',
    generatedArtifacts: [{
      path: 'public/data.json',
      required: true,
      schema: 'schemas/data.schema.json',
      minCount: 1,
      validation: {diff: {baselinePath: 'public/last-known-good.json', maximumCountDropRatio: 0.25}},
    }],
    freshnessSlo: 'PT24H',
    promotionPolicy: 'reject-invalid',
    servingFallback: 'last-known-good',
    refreshCapabilities: ['manual-recovery', 'scheduled'],
  })}\n`)
  // 2026-08-27: 감지가 capability를 강제하지 않으므로 스팩이 선언한다 — 이 테스트의 대상은
  // "선언된 ingestion이 Vercel static 경로에서 제대로 결박되는가"이며 그 계약은 그대로다.
  const profile = resolveProjectProfile({
    projectRoot: root,
    requested: 'auto',
    deploymentProvider: 'vercel',
    capabilities: ['client-routing', 'csr', 'static-build', 'external-ingestion', 'scheduled-static-ingestion'],
    adapters: loadBuiltinAdapters(),
  })
  writeFileSync(join(root, '_workspace/01_plan/project-profile.json'), `${JSON.stringify(profile, null, 2)}\n`)

  const run = () => spawnSync(process.execPath, [wrapper], {cwd: root, encoding: 'utf8'})
  const passing = run()
  assert.equal(passing.status, 0, passing.stderr)

  writeFileSync(
    join(root, 'scripts/build.mjs'),
    "import {writeFileSync,mkdirSync} from 'node:fs'; mkdirSync('dist',{recursive:true}); const x='{\"generatedAt\":\"2000-01-01T00:00:00Z\",\"count\":0,\"data\":[]}\\n'; writeFileSync('public/data.json',x); writeFileSync('dist/data.json',x)\n",
  )
  const mutating = run()
  assert.equal(mutating.status, 1)
  assert.match(mutating.stderr, /mutated protected source|post-build runtime data is invalid/)

  writeFileSync(join(root, 'public/data.json'), `${JSON.stringify(envelope(records))}\n`)
  writeFileSync(
    join(root, 'scripts/build.mjs'),
    "import {cpSync,mkdirSync} from 'node:fs'; import {spawn} from 'node:child_process'; mkdirSync('dist',{recursive:true}); for(const x of ['data.json','last-known-good.json']) cpSync('public/'+x,'dist/'+x); const child=spawn(process.execPath,['-e',\"setTimeout(()=>require('node:fs').writeFileSync('dist/data.json','[]\\\\n'),250)\"],{cwd:process.cwd(),detached:true,stdio:'ignore'}); child.unref()\n",
  )
  const delayedMutation = run()
  assert.equal(delayedMutation.status, 1)
  assert.match(delayedMutation.stderr, /quiescence|not byte-identical|deployment artifact changed/)

  process.stdout.write('Vercel static ingestion build self-test passed (3 cases).\n')
} finally {
  rmSync(root, {recursive: true, force: true})
}
