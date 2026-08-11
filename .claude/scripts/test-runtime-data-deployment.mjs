#!/usr/bin/env node

import assert from 'node:assert/strict'
import {cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {validateStaticRuntimeDataDeployment} from './runtime-data-deployment-lib.mjs'

const root = mkdtempSync(join(tmpdir(), 'web-harness-runtime-deployment-'))
const profile = ({target = 'static-cdn', output = 'dist'} = {}) => ({
  selection: {
    target: {id: target},
    artifacts: [{id: 'static-output', path: output, kind: 'static-directory'}],
  },
})
const envelope = records => ({
  generatedAt: new Date().toISOString(),
  count: records.length,
  data: records,
})
const document = `${JSON.stringify(envelope([{id: 'race-1'}, {id: 'race-2'}]))}\n`
const schema = {
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
}
const writeContract = ({path = 'public/data.json', baselinePath = 'public/last-known-good.json'} = {}) => {
  writeFileSync(join(root, '_workspace/02_design/runtime-data-contract.json'), `${JSON.stringify({
    $schema: '.claude/schemas/runtime-data-contract.schema.json',
    schemaVersion: 1,
    mode: 'static-snapshot',
    authoritativeSource: 'fixture-source',
    buildCwd: '.',
    deploymentRoot: '.',
    generatedArtifacts: [
      {
        path,
        required: true,
        schema: 'schemas/data.schema.json',
        minCount: 1,
        validation: {diff: {baselinePath, maximumCountDropRatio: 0.25}},
      },
      {
        path: 'public/optional.json',
        required: false,
        schema: 'schemas/data.schema.json',
        minCount: 1,
        validation: {diff: {baselinePath: 'public/optional-last-known-good.json', maximumCountDropRatio: 0.25}},
      },
    ],
    freshnessSlo: 'PT24H',
    promotionPolicy: 'reject-invalid',
    servingFallback: 'last-known-good',
    refreshCapabilities: ['manual-recovery', 'scheduled'],
  })}\n`)
}
const writeData = path => {
  mkdirSync(dirname(join(root, path)), {recursive: true})
  writeFileSync(join(root, path), document)
}
const copyPublicData = output => {
  mkdirSync(join(root, output), {recursive: true})
  for (const path of [
    'data.json',
    'last-known-good.json',
    'optional.json',
    'optional-last-known-good.json',
  ]) cpSync(join(root, 'public', path), join(root, output, path))
}
const validate = (lockedProfile = profile()) => validateStaticRuntimeDataDeployment({
  projectRoot: root,
  lockedProfile,
})

try {
  for (const directory of ['public', 'dist', 'schemas', '_workspace/02_design']) {
    mkdirSync(join(root, directory), {recursive: true})
  }
  writeFileSync(join(root, 'schemas/data.schema.json'), `${JSON.stringify(schema)}\n`)
  writeContract()
  for (const path of [
    'public/data.json',
    'public/last-known-good.json',
    'public/optional.json',
    'public/optional-last-known-good.json',
  ]) writeData(path)
  copyPublicData('dist')
  const passing = validate()
  assert.equal(passing.ok, true)
  assert.equal(passing.copies.length, 4)
  assert.equal(typeof passing.runtimeDataEvidenceSha256, 'string')

  writeFileSync(join(root, 'dist/data.json'), '{"data":[2]}\n')
  assert.match(validate().errors.join('\n'), /not byte-identical/)
  cpSync(join(root, 'public/data.json'), join(root, 'dist/data.json'))

  rmSync(join(root, 'dist/data.json'))
  assert.match(validate().errors.join('\n'), /Deployed runtime artifact/)
  cpSync(join(root, 'public/data.json'), join(root, 'dist/data.json'))

  writeFileSync(join(root, 'dist/last-known-good.json'), '{"owned":true}\n')
  assert.match(validate().errors.join('\n'), /not byte-identical/)
  cpSync(join(root, 'public/last-known-good.json'), join(root, 'dist/last-known-good.json'))

  writeFileSync(join(root, 'dist/optional.json'), '{"owned":true}\n')
  assert.match(validate().errors.join('\n'), /not byte-identical/)
  cpSync(join(root, 'public/optional.json'), join(root, 'dist/optional.json'))

  writeContract({path: 'data/generated.json', baselinePath: 'data/last-known-good.json'})
  writeData('data/generated.json')
  writeData('data/last-known-good.json')
  assert.match(validate().errors.join('\n'), /under public/)
  writeContract()

  copyPublicData('out')
  assert.equal(validate(profile({target: 'static-export', output: 'out'})).ok, true)
  assert.equal(validate(profile({target: 'container-static', output: 'dist'})).ok, true)
  assert.equal(validate(profile({target: 'node-server', output: '.next'})).applicable, false)

  const outside = mkdtempSync(join(tmpdir(), 'web-harness-runtime-deployment-outside-'))
  writeFileSync(join(outside, 'data.json'), document)
  rmSync(join(root, 'dist/data.json'))
  symlinkSync(join(outside, 'data.json'), join(root, 'dist/data.json'))
  assert.match(validate().errors.join('\n'), /non-symlink|regular/)
  rmSync(join(root, 'dist/data.json'))
  cpSync(join(root, 'public/data.json'), join(root, 'dist/data.json'))
  rmSync(outside, {recursive: true, force: true})

  process.stdout.write('Static runtime data deployment self-test passed (11 cases).\n')
} finally {
  rmSync(root, {recursive: true, force: true})
}
