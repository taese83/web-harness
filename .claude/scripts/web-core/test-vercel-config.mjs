#!/usr/bin/env node

import assert from 'node:assert/strict'
import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {validateVercelProjectConfig} from './vercel-config-lib.mjs'

const root = mkdtempSync(join(tmpdir(), 'web-harness-vercel-config-'))
writeFileSync(join(root, 'package.json'), `${JSON.stringify({scripts: {build: 'vite build'}})}\n`)
const profile = ({id = 'react-vite-spa', target = 'static-cdn'} = {}) => ({
  adapter: {id},
  selection: {
    provider: {id: 'vercel'},
    target: {id: target},
    selectedCapabilities: [],
  },
})
const baseConfig = () => ({
  $schema: 'https://openapi.vercel.sh/vercel.json',
  framework: 'vite',
  installCommand: 'pnpm install --frozen-lockfile --ignore-scripts',
  buildCommand: 'pnpm run build',
  outputDirectory: 'dist',
  rewrites: [{source: '/(.*)', destination: '/index.html'}],
  headers: [{
    source: '/(.*)',
    headers: [
      {key: 'X-Content-Type-Options', value: 'nosniff'},
      {key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin'},
      {key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()'},
      {key: 'X-Frame-Options', value: 'DENY'},
    ],
  }],
})
const writeConfig = config => writeFileSync(join(root, 'vercel.json'), `${JSON.stringify(config, null, 2)}\n`)
const codes = (config, options = {}) => {
  writeConfig(config)
  return validateVercelProjectConfig({projectRoot: root, lockedProfile: options.lockedProfile ?? profile()})
}

try {
  assert.equal(codes(baseConfig()).ok, true)

  const cron = baseConfig()
  cron.crons = [{path: '/api/refresh', schedule: '0 0 * * *'}]
  assert.match(codes(cron).errors.join('\n'), /crons is forbidden/)

  const wrongOrder = baseConfig()
  wrongOrder.buildCommand = 'pnpm run build && curl https://example.invalid'
  assert.match(codes(wrongOrder).errors.join('\n'), /buildCommand/)

  const externalRewrite = baseConfig()
  externalRewrite.rewrites = [{source: '/api/:path*', destination: 'https://example.invalid/:path*'}]
  assert.match(codes(externalRewrite).errors.join('\n'), /external and dynamic destinations/)

  const secretEnvironment = baseConfig()
  secretEnvironment.env = {API_TOKEN: '@api-token'}
  assert.match(codes(secretEnvironment).errors.join('\n'), /env is forbidden/)

  const missingHeader = baseConfig()
  missingHeader.headers[0].headers = missingHeader.headers[0].headers.filter(header => header.key !== 'Permissions-Policy')
  assert.match(codes(missingHeader).errors.join('\n'), /permissions-policy/)

  const immutableHtml = baseConfig()
  immutableHtml.headers.push({source: '/(.*)', headers: [{key: 'Cache-Control', value: 'public, max-age=31536000, immutable'}]})
  assert.match(codes(immutableHtml).errors.join('\n'), /must not mark HTML immutable/)

  const wrongOutput = baseConfig()
  wrongOutput.outputDirectory = 'build'
  assert.match(codes(wrongOutput).errors.join('\n'), /outputDirectory must be dist/)

  writeFileSync(join(root, 'vercel.json'), 'null\n')
  assert.match(validateVercelProjectConfig({projectRoot: root, lockedProfile: profile()}).errors.join('\n'), /must be an object/)

  assert.match(codes(baseConfig(), {
    lockedProfile: profile({id: 'next-app-fullstack', target: 'node-server'}),
  }).errors.join('\n'), /no built-in rule for profile next-app-fullstack/)

  const hybrid = baseConfig()
  hybrid.buildCommand = 'pnpm run build'
  assert.equal(codes(hybrid, {
    lockedProfile: profile({id: 'vite-serverless-hybrid', target: 'vercel-hybrid'}),
  }).ok, true)

  const hybridWrongFramework = {...hybrid, framework: 'nextjs'}
  assert.match(codes(hybridWrongFramework, {
    lockedProfile: profile({id: 'vite-serverless-hybrid', target: 'vercel-hybrid'}),
  }).errors.join('\n'), /framework must be vite/)

  const hybridNoCatchAll = {...hybrid, rewrites: []}
  assert.match(codes(hybridNoCatchAll, {
    lockedProfile: profile({id: 'vite-serverless-hybrid', target: 'vercel-hybrid'}),
  }).errors.join('\n'), /catch-all rewrite/)

  writeConfig(baseConfig())
  writeFileSync(join(root, 'vercel.ts'), 'export default {}\n')
  assert.match(validateVercelProjectConfig({projectRoot: root, lockedProfile: profile()}).errors.join('\n'), /vercel\.ts is unsupported/)
  rmSync(join(root, 'vercel.ts'))

  const outside = mkdtempSync(join(tmpdir(), 'web-harness-vercel-outside-'))
  writeFileSync(join(outside, 'vercel.json'), `${JSON.stringify(baseConfig())}\n`)
  rmSync(join(root, 'vercel.json'))
  symlinkSync(join(outside, 'vercel.json'), join(root, 'vercel.json'))
  assert.match(validateVercelProjectConfig({projectRoot: root, lockedProfile: profile()}).errors.join('\n'), /non-symlink|regular/)
  rmSync(outside, {recursive: true, force: true})

  process.stdout.write('Vercel provider config self-test passed (15 cases).\n')
} finally {
  rmSync(root, {recursive: true, force: true})
}
