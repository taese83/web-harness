import {existsSync} from 'node:fs'
import {join} from 'node:path'
import {sha256} from '../evidence-lib.mjs'
import {readProjectRegularFile} from '../safe-project-file-lib.mjs'

export const VERCEL_CONFIG_PATH = 'vercel.json'
const VERCEL_SCHEMA = 'https://openapi.vercel.sh/vercel.json'
const MAX_CONFIG_BYTES = 512 * 1024
const STATIC_INGESTION_BUILD = 'node .claude/scripts/run-vercel-static-ingestion-build.mjs'
const TOP_LEVEL_KEYS = new Set([
  '$schema',
  'buildCommand',
  'cleanUrls',
  'framework',
  'headers',
  'installCommand',
  'outputDirectory',
  'redirects',
  'rewrites',
  'trailingSlash',
])
const EXPLICITLY_FORBIDDEN_KEYS = new Set([
  'alias', 'build', 'crons', 'env', 'functions', 'git', 'ignoreCommand', 'name', 'public', 'routes', 'scope', 'version',
])
const SECURITY_HEADERS = new Set([
  'content-security-policy',
  'permissions-policy',
  'referrer-policy',
  'x-content-type-options',
  'x-frame-options',
])

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const exactKeys = (value, allowed, label, errors) => {
  if (!isObject(value)) {
    errors.push(`${label} must be an object`)
    return false
  }
  let valid = true
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      errors.push(`${label} contains unsupported field ${key}`)
      valid = false
    }
  }
  return valid
}
const safeRouteString = value =>
  typeof value === 'string' && value.startsWith('/') && value.length <= 2048 && !/[\0\r\n]/.test(value) && !value.includes('${')
const normalizedCommand = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : null
const catchAllSource = source => source === '/(.*)' || source === '/:path*'

const validateRouteRules = (config, key, errors) => {
  if (config[key] === undefined) return []
  if (!Array.isArray(config[key]) || config[key].length > 128) {
    errors.push(`vercel.json ${key} must be an array with no more than 128 entries`)
    return []
  }
  const rules = []
  const sources = new Set()
  for (const [index, rule] of config[key].entries()) {
    const allowed = key === 'redirects'
      ? new Set(['destination', 'permanent', 'source', 'statusCode'])
      : new Set(['destination', 'source'])
    const label = `vercel.json ${key}[${index}]`
    if (!isObject(rule)) {
      exactKeys(rule, allowed, label, errors)
      continue
    }
    exactKeys(rule, allowed, label, errors)
    if (!safeRouteString(rule.source)) errors.push(`${label}.source must be a bounded absolute pathname pattern`)
    else if (sources.has(rule.source)) errors.push(`${label}.source is duplicated`)
    else sources.add(rule.source)
    if (!safeRouteString(rule.destination)) {
      errors.push(`${label}.destination must stay inside the application; external and dynamic destinations are forbidden`)
    }
    if (key === 'redirects') {
      if (rule.permanent !== undefined && typeof rule.permanent !== 'boolean') errors.push(`${label}.permanent must be boolean`)
      if (rule.statusCode !== undefined && ![301, 302, 303, 307, 308].includes(rule.statusCode)) {
        errors.push(`${label}.statusCode is unsupported`)
      }
      if (rule.permanent !== undefined && rule.statusCode !== undefined) {
        errors.push(`${label} must not mix permanent and statusCode`)
      }
    }
    rules.push(rule)
  }
  return rules
}

const validateHeaders = (config, errors, mutableDataPaths = new Set()) => {
  if (!Array.isArray(config.headers) || config.headers.length === 0 || config.headers.length > 128) {
    errors.push('vercel.json headers must contain between 1 and 128 rules')
    return
  }
  const globalHeaders = new Map()
  const headerKeysBySource = new Map()
  for (const [index, rule] of config.headers.entries()) {
    const label = `vercel.json headers[${index}]`
    if (!isObject(rule)) {
      exactKeys(rule, new Set(['headers', 'source']), label, errors)
      continue
    }
    exactKeys(rule, new Set(['headers', 'source']), label, errors)
    if (!safeRouteString(rule.source)) errors.push(`${label}.source must be a bounded absolute pathname pattern`)
    if (!Array.isArray(rule.headers) || rule.headers.length === 0 || rule.headers.length > 64) {
      errors.push(`${label}.headers must contain between 1 and 64 entries`)
      continue
    }
    const sourceKeys = headerKeysBySource.get(rule.source) ?? new Set()
    for (const [headerIndex, header] of rule.headers.entries()) {
      const headerLabel = `${label}.headers[${headerIndex}]`
      if (!isObject(header)) {
        exactKeys(header, new Set(['key', 'value']), headerLabel, errors)
        continue
      }
      exactKeys(header, new Set(['key', 'value']), headerLabel, errors)
      const key = typeof header.key === 'string' ? header.key.toLowerCase() : ''
      if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(key)) errors.push(`${headerLabel}.key is invalid`)
      else if (sourceKeys.has(key)) errors.push(`${headerLabel}.key is duplicated for ${rule.source}`)
      else sourceKeys.add(key)
      if (
        typeof header.value !== 'string' ||
        !header.value ||
        header.value.length > 4096 ||
        /[\0\r\n]/.test(header.value) ||
        header.value.includes('${')
      ) {
        errors.push(`${headerLabel}.value is invalid`)
      }
      if (['authorization', 'proxy-authorization', 'set-cookie'].includes(key)) {
        errors.push(`${headerLabel} must not persist credentials in repository configuration`)
      }
      if (
        key === 'cache-control' &&
        /(?:^|,)\s*(?:public\s*,\s*)?.*immutable/i.test(header.value ?? '') &&
        (catchAllSource(rule.source) || mutableDataPaths.has(rule.source))
      ) errors.push(`${headerLabel} must not mark HTML or refreshable runtime data immutable`)
      if (catchAllSource(rule.source) && SECURITY_HEADERS.has(key)) {
        if (globalHeaders.has(key)) errors.push(`${headerLabel}.key duplicates a global security header`)
        else globalHeaders.set(key, header.value)
      }
    }
    headerKeysBySource.set(rule.source, sourceKeys)
  }
  if (globalHeaders.get('x-content-type-options')?.toLowerCase() !== 'nosniff') {
    errors.push('vercel.json must apply X-Content-Type-Options: nosniff globally')
  }
  for (const key of ['referrer-policy', 'permissions-policy']) {
    if (!globalHeaders.has(key)) errors.push(`vercel.json must apply ${key} globally`)
  }
  const frameHeader = globalHeaders.get('x-frame-options')?.toUpperCase()
  const csp = globalHeaders.get('content-security-policy') ?? ''
  if (!['DENY', 'SAMEORIGIN'].includes(frameHeader) && !/(?:^|;)\s*frame-ancestors\s+[^;]+/i.test(csp)) {
    errors.push('vercel.json must apply a global frame policy')
  }
}

export const validateVercelProjectConfig = ({projectRoot, lockedProfile, runtimeDataContract = null}) => {
  const errors = []
  if (lockedProfile?.selection?.provider?.id !== 'vercel') return {ok: true, errors, configSha256: null}
  if (existsSync(join(projectRoot, 'vercel.ts'))) {
    errors.push('vercel.ts is unsupported because build-time programmatic configuration bypasses the reviewed static contract')
  }

  let source
  let config
  try {
    source = readProjectRegularFile(projectRoot, VERCEL_CONFIG_PATH, {maxBytes: MAX_CONFIG_BYTES})
    config = JSON.parse(source.toString('utf8'))
  } catch (error) {
    errors.push(`vercel.json cannot be inspected safely: ${error instanceof Error ? error.message : String(error)}`)
    return {ok: false, errors, configSha256: null}
  }
  if (!isObject(config)) {
    exactKeys(config, TOP_LEVEL_KEYS, 'vercel.json', errors)
    return {ok: false, errors, configSha256: sha256(source)}
  }
  if (!exactKeys(config, TOP_LEVEL_KEYS, 'vercel.json', errors)) {
    for (const key of Object.keys(isObject(config) ? config : {})) {
      if (EXPLICITLY_FORBIDDEN_KEYS.has(key)) errors.push(`vercel.json field ${key} is forbidden by the built-in provider profile`)
    }
  }
  if (config.$schema !== VERCEL_SCHEMA) errors.push(`vercel.json $schema must be ${VERCEL_SCHEMA}`)

  const profileId = lockedProfile.adapter.id
  const targetId = lockedProfile.selection.target.id
  const viteFamily = profileId === 'react-vite-spa' || profileId === 'vite-serverless-hybrid'
  const expectedFramework = viteFamily ? 'vite' : 'nextjs'
  if (config.framework !== expectedFramework) errors.push(`vercel.json framework must be ${expectedFramework}`)
  if (normalizedCommand(config.installCommand) !== 'pnpm install --frozen-lockfile --ignore-scripts') {
    errors.push('vercel.json installCommand must use the frozen lockfile with lifecycle scripts disabled')
  }
  const ingestionEnabled = lockedProfile.selection.selectedCapabilities.includes('external-ingestion')
  const staticIngestion = ingestionEnabled && ['static-cdn', 'static-export'].includes(targetId)
  const expectedBuildCommand = staticIngestion
    ? STATIC_INGESTION_BUILD
    : ingestionEnabled
      ? 'pnpm run validate:ingestion && pnpm run build'
      : 'pnpm run build'
  if (normalizedCommand(config.buildCommand) !== expectedBuildCommand) {
    errors.push(`vercel.json buildCommand must be ${expectedBuildCommand}`)
  }
  if (ingestionEnabled && !runtimeDataContract) errors.push('Vercel external ingestion profile requires a valid runtime data contract')
  if (runtimeDataContract && (runtimeDataContract.contract.buildCwd !== '.' || runtimeDataContract.contract.deploymentRoot !== '.')) {
    errors.push('Vercel built-in profile requires runtime buildCwd and deploymentRoot to equal the canonical project root')
  }
  if (staticIngestion) {
    for (const artifact of runtimeDataContract?.contract.generatedArtifacts ?? []) {
      if (!artifact.path.startsWith('public/')) {
        errors.push(`Vercel static runtime artifact must be promoted under public/: ${artifact.path}`)
      }
      const baselinePath = artifact.validation?.diff?.baselinePath
      if (
        runtimeDataContract?.contract.servingFallback === 'last-known-good' &&
        baselinePath &&
        !baselinePath.startsWith('public/')
      ) errors.push(`Vercel static last-known-good fallback must be promoted under public/: ${baselinePath}`)
    }
  }

  const expectedOutput = viteFamily
    ? 'dist'
    : targetId === 'static-export'
      ? 'out'
      : null
  if (expectedOutput === null) {
    if (config.outputDirectory !== undefined) errors.push('Vercel Next node-server profile must use the framework preset output without outputDirectory override')
  } else if (config.outputDirectory !== expectedOutput) {
    errors.push(`vercel.json outputDirectory must be ${expectedOutput}`)
  }
  for (const booleanKey of ['cleanUrls', 'trailingSlash']) {
    if (config[booleanKey] !== undefined && typeof config[booleanKey] !== 'boolean') {
      errors.push(`vercel.json ${booleanKey} must be boolean`)
    }
  }

  const rewrites = validateRouteRules(config, 'rewrites', errors)
  validateRouteRules(config, 'redirects', errors)
  if (viteFamily && !rewrites.some(rule => catchAllSource(rule.source) && rule.destination === '/index.html')) {
    errors.push('Vercel React/Vite SPA profile requires an internal catch-all rewrite to /index.html')
  }
  const mutableDataPaths = new Set((runtimeDataContract?.contract.generatedArtifacts ?? []).map(artifact => {
    const path = artifact.path.startsWith('public/') ? artifact.path.slice('public/'.length) : artifact.path
    return `/${path}`
  }))
  validateHeaders(config, errors, mutableDataPaths)

  return {ok: errors.length === 0, errors: [...new Set(errors)], configSha256: sha256(source)}
}
