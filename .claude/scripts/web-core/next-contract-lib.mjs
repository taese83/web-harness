import {assertKnownKeys, isPlainObject, sortedUnique, stableStringify, WebCoreError} from './core-lib.mjs'

const ADAPTER_ID = 'next-app-fullstack'
const STATUS_VALUES = Object.freeze(['PASS', 'FAIL', 'BLOCKED', 'NOT_APPLICABLE'])
const PHASES = new Set(['profile-resolution', 'source-contract', 'runtime-contract', 'release-contract'])
const PROFILE_KEYS = [
  'router',
  'runtime',
  'deployment',
  'nextOutput',
  'capabilities',
  'topology',
  'dynamicRoutesCompleteAtBuild',
  'readsRuntimeRequest',
  'routeHandlerMethods',
]
const CAPABILITIES = new Set([
  'build-time-server-component',
  'cookie-auth',
  'dynamic-route',
  'isr',
  'request-time-ssr',
  'route-handler',
  'route-handler-mutation',
  'server-action',
  'static-get-route-handler',
])
const ROUTE_METHODS = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'])
const CHECK_ID_PATTERN = /^next\.[a-z][a-z0-9-]*$/
const REASON_CODE_PATTERN = /^NEXT_[A-Z0-9]+(?:_[A-Z0-9]+)*$/

const result = (status, reasonCode, details = {}) => ({status, reasonCode, ...details})

const requireKeys = (value, keys, label, errors) => {
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) errors.push(`${label}.${key} is required`)
  }
}

const requireBoolean = (value, key, label, errors) => {
  if (Object.hasOwn(value, key) && typeof value[key] !== 'boolean') {
    errors.push(`${label}.${key} must be a boolean`)
  }
}

const requireEnum = (value, key, values, label, errors, {optional = false} = {}) => {
  if (optional && !Object.hasOwn(value, key)) return
  if (typeof value[key] !== 'string' || !values.has(value[key])) {
    errors.push(`${label}.${key} must be one of: ${[...values].sort().join(', ')}`)
  }
}

const validateStringArray = (value, key, allowed, label, errors, {optional = false} = {}) => {
  if (optional && !Object.hasOwn(value, key)) return
  if (!Array.isArray(value[key])) {
    errors.push(`${label}.${key} must be an array`)
    return
  }
  const seen = new Set()
  for (const [index, item] of value[key].entries()) {
    if (typeof item !== 'string' || !allowed.has(item)) {
      errors.push(`${label}.${key}[${index}] is unsupported: ${String(item)}`)
    }
    if (seen.has(item)) errors.push(`${label}.${key} must contain unique values`)
    seen.add(item)
  }
}

const validateProfileInput = (input, label, errors) => {
  assertKnownKeys(input, PROFILE_KEYS, label, errors)
  requireKeys(input, ['router', 'runtime', 'deployment', 'capabilities'], label, errors)
  requireEnum(input, 'router', new Set(['app', 'pages']), label, errors)
  requireEnum(input, 'runtime', new Set(['edge', 'node', 'node-build-only']), label, errors)
  requireEnum(input, 'deployment', new Set(['adapter-platform', 'docker-standalone', 'node-server', 'static-export']), label, errors)
  requireEnum(input, 'nextOutput', new Set(['export', 'standalone']), label, errors, {optional: true})
  requireEnum(input, 'topology', new Set(['multi-instance', 'single-instance']), label, errors, {optional: true})
  validateStringArray(input, 'capabilities', CAPABILITIES, label, errors)
  validateStringArray(input, 'routeHandlerMethods', ROUTE_METHODS, label, errors, {optional: true})
  requireBoolean(input, 'dynamicRoutesCompleteAtBuild', label, errors)
  requireBoolean(input, 'readsRuntimeRequest', label, errors)
}

const validateSourceInput = (input, label, errors) => {
  if (Object.hasOwn(input, 'clientEntryImportsServerOnly')) {
    const keys = ['clientEntryImportsServerOnly', 'serverOnlyModuleReadsPrivateEnvironment']
    assertKnownKeys(input, keys, label, errors)
    requireKeys(input, keys, label, errors)
    for (const key of keys) requireBoolean(input, key, label, errors)
    return
  }

  if (Object.hasOwn(input, 'environmentName')) {
    const keys = ['environmentName', 'classification']
    assertKnownKeys(input, keys, label, errors)
    requireKeys(input, keys, label, errors)
    if (typeof input.environmentName !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(input.environmentName)) {
      errors.push(`${label}.environmentName must be an uppercase environment variable name`)
    }
    requireEnum(input, 'classification', new Set(['public', 'secret']), label, errors)
    return
  }

  if (input.entryPoint === 'route-handler') {
    const keys = [
      'entryPoint',
      'protected',
      'handlerAuthentication',
      'handlerResourceAuthorization',
      'layoutRedirectOnly',
    ]
    assertKnownKeys(input, keys, label, errors)
    requireKeys(input, keys, label, errors)
    for (const key of keys.slice(1)) requireBoolean(input, key, label, errors)
    return
  }

  if (input.entryPoint === 'server-action') {
    const keys = ['entryPoint', 'protected', 'actionAuthentication', 'actionResourceAuthorization']
    assertKnownKeys(input, keys, label, errors)
    requireKeys(input, keys, label, errors)
    for (const key of keys.slice(1)) requireBoolean(input, key, label, errors)
    return
  }

  errors.push(`${label} does not match a supported source-contract shape`)
}

const validateRuntimeInput = (input, label, errors) => {
  const keys = ['dataClass', 'cacheScope', 'identityMarkersCrossed']
  assertKnownKeys(input, keys, label, errors)
  requireKeys(input, keys, label, errors)
  requireEnum(input, 'dataClass', new Set(['authenticated', 'private', 'public', 'tenant']), label, errors)
  requireEnum(input, 'cacheScope', new Set(['none', 'request', 'shared-public', 'tenant', 'user']), label, errors)
  requireBoolean(input, 'identityMarkersCrossed', label, errors)
}

const validateReleaseInput = (input, label, errors) => {
  const keys = ['receiptStatus', 'receiptSourceFingerprint', 'currentSourceFingerprint']
  assertKnownKeys(input, keys, label, errors)
  requireKeys(input, keys, label, errors)
  requireEnum(input, 'receiptStatus', new Set(STATUS_VALUES), label, errors)
  for (const key of keys.slice(1)) {
    if (typeof input[key] !== 'string' || input[key].length === 0) errors.push(`${label}.${key} must be a non-empty string`)
  }
}

const validateInput = (phase, input, label, errors) => {
  if (!isPlainObject(input)) {
    errors.push(`${label} must be an object`)
    return
  }
  if (phase === 'profile-resolution') validateProfileInput(input, label, errors)
  else if (phase === 'source-contract') validateSourceInput(input, label, errors)
  else if (phase === 'runtime-contract') validateRuntimeInput(input, label, errors)
  else if (phase === 'release-contract') validateReleaseInput(input, label, errors)
}

const validateExpected = (expected, label, errors) => {
  const keys = ['status', 'reasonCode', 'artifact', 'requiredChecks']
  if (!assertKnownKeys(expected, keys, label, errors)) return
  requireKeys(expected, ['status', 'reasonCode'], label, errors)
  requireEnum(expected, 'status', new Set(STATUS_VALUES), label, errors)
  if (typeof expected.reasonCode !== 'string' || !REASON_CODE_PATTERN.test(expected.reasonCode)) {
    errors.push(`${label}.reasonCode must be a NEXT_* reason code`)
  }
  if (Object.hasOwn(expected, 'artifact') && (
    typeof expected.artifact !== 'string' ||
    expected.artifact.length === 0 ||
    expected.artifact.startsWith('/') ||
    expected.artifact.split(/[\\/]/).includes('..')
  )) errors.push(`${label}.artifact must be a safe relative path`)
  if (Object.hasOwn(expected, 'requiredChecks')) {
    const declaredChecks = Array.isArray(expected.requiredChecks) ? expected.requiredChecks : []
    validateStringArray(expected, 'requiredChecks', new Set(declaredChecks), label, errors)
    if (Array.isArray(expected.requiredChecks)) {
      for (const [index, checkId] of expected.requiredChecks.entries()) {
        if (typeof checkId === 'string' && !CHECK_ID_PATTERN.test(checkId)) {
          errors.push(`${label}.requiredChecks[${index}] must be a next.* check id`)
        }
      }
    }
  }
}

export const validateNextContractDocument = document => {
  const errors = []
  if (!assertKnownKeys(document, ['schemaVersion', 'adapterId', 'statusValues', 'cases'], 'fixture', errors)) {
    return sortedUnique(errors)
  }
  if (document.schemaVersion !== 1) errors.push('fixture.schemaVersion must equal 1')
  if (document.adapterId !== ADAPTER_ID) errors.push(`fixture.adapterId must equal ${ADAPTER_ID}`)
  if (stableStringify(document.statusValues) !== stableStringify(STATUS_VALUES)) {
    errors.push(`fixture.statusValues must equal: ${STATUS_VALUES.join(', ')}`)
  }
  if (!Array.isArray(document.cases) || document.cases.length === 0) {
    errors.push('fixture.cases must be a non-empty array')
    return sortedUnique(errors)
  }

  const ids = new Set()
  for (const [index, contractCase] of document.cases.entries()) {
    const label = `fixture.cases[${index}]`
    if (!assertKnownKeys(contractCase, ['id', 'phase', 'input', 'expected'], label, errors)) continue
    requireKeys(contractCase, ['id', 'phase', 'input', 'expected'], label, errors)
    if (typeof contractCase.id !== 'string' || !/^next-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(contractCase.id)) {
      errors.push(`${label}.id must be a next-* kebab-case id`)
    } else if (ids.has(contractCase.id)) {
      errors.push(`${label}.id must be unique: ${contractCase.id}`)
    }
    ids.add(contractCase.id)
    if (!PHASES.has(contractCase.phase)) errors.push(`${label}.phase is unsupported: ${String(contractCase.phase)}`)
    else validateInput(contractCase.phase, contractCase.input, `${label}.input`, errors)
    validateExpected(contractCase.expected, `${label}.expected`, errors)
  }
  return sortedUnique(errors)
}

const evaluateProfile = input => {
  const capabilities = new Set(input.capabilities)
  if (input.router !== 'app') {
    return result('BLOCKED', 'NEXT_ROUTER_OUTSIDE_COMPATIBLE_SCOPE')
  }
  if (input.runtime === 'edge') {
    return result('BLOCKED', 'NEXT_RUNTIME_OUTSIDE_COMPATIBLE_SCOPE')
  }
  if (input.deployment === 'docker-standalone') {
    return result('BLOCKED', 'NEXT_DOCKER_OCI_EVIDENCE_BROKER_REQUIRED')
  }

  if (input.deployment === 'static-export') {
    if (capabilities.has('cookie-auth') || capabilities.has('request-time-ssr')) {
      return result('BLOCKED', 'NEXT_STATIC_REQUEST_IDENTITY_UNSUPPORTED')
    }
    if (capabilities.has('server-action')) {
      return result('BLOCKED', 'NEXT_STATIC_SERVER_ACTION_UNSUPPORTED')
    }
    if (capabilities.has('isr')) {
      return result('BLOCKED', 'NEXT_STATIC_ISR_UNSUPPORTED')
    }
    if (
      capabilities.has('route-handler-mutation') ||
      (capabilities.has('route-handler') && input.routeHandlerMethods?.some(method => method !== 'GET'))
    ) {
      return result('BLOCKED', 'NEXT_STATIC_ROUTE_MUTATION_UNSUPPORTED')
    }
    if (capabilities.has('route-handler') && input.readsRuntimeRequest === true) {
      return result('BLOCKED', 'NEXT_STATIC_REQUEST_HANDLER_UNSUPPORTED')
    }
    if (capabilities.has('dynamic-route') && input.dynamicRoutesCompleteAtBuild !== true) {
      return result('BLOCKED', 'NEXT_STATIC_DYNAMIC_ROUTE_INCOMPLETE')
    }
    if (input.runtime !== 'node-build-only' || input.nextOutput !== 'export') {
      return result('BLOCKED', 'NEXT_STATIC_OUTPUT_CONTRACT_MISSING')
    }
    return result('PASS', 'NEXT_PROFILE_COMPATIBLE', {
      artifact: 'out',
      requiredChecks: [
        'next.build',
        'next.route-contract',
        'next.client-boundary',
        'next.secret-boundary',
        'next.export-artifact',
        'next.static-host-smoke',
        'next.static-browser',
        'next.static-hydration',
      ],
    })
  }

  if (input.deployment === 'node-server') {
    if (input.runtime !== 'node') return result('BLOCKED', 'NEXT_RUNTIME_OUTSIDE_COMPATIBLE_SCOPE')
    if (input.topology !== undefined && input.topology !== 'single-instance') {
      return result('BLOCKED', 'NEXT_TOPOLOGY_OUTSIDE_COMPATIBLE_SCOPE')
    }
    const requiredChecks = [
      'next.build',
      'next.route-contract',
      'next.client-boundary',
      'next.secret-boundary',
    ]
    if (capabilities.has('cookie-auth')) requiredChecks.push('next.node-authz', 'next.node-cache-isolation')
    requiredChecks.push(
      'next.production-start',
      'next.node-smoke',
      'next.node-browser',
      'next.node-hydration',
      'next.node-shutdown',
    )
    return result('PASS', 'NEXT_PROFILE_COMPATIBLE', {artifact: '.next', requiredChecks})
  }

  return result('BLOCKED', 'NEXT_DEPLOYMENT_OUTSIDE_COMPATIBLE_SCOPE')
}

const evaluateSource = input => {
  if (Object.hasOwn(input, 'clientEntryImportsServerOnly')) {
    return input.clientEntryImportsServerOnly
      ? result('FAIL', 'NEXT_SERVER_ONLY_IN_CLIENT_GRAPH')
      : result('PASS', 'NEXT_SOURCE_CONTRACT_COMPATIBLE')
  }
  if (Object.hasOwn(input, 'environmentName')) {
    return input.classification === 'secret' && input.environmentName.startsWith('NEXT_PUBLIC_')
      ? result('FAIL', 'NEXT_SECRET_CLASSIFIED_PUBLIC')
      : result('PASS', 'NEXT_SOURCE_CONTRACT_COMPATIBLE')
  }
  if (input.entryPoint === 'route-handler') {
    const authorized = !input.protected || (input.handlerAuthentication && input.handlerResourceAuthorization)
    return authorized
      ? result('PASS', 'NEXT_SOURCE_CONTRACT_COMPATIBLE')
      : result('FAIL', 'NEXT_ENTRYPOINT_AUTHORIZATION_MISSING')
  }
  const authorized = !input.protected || (input.actionAuthentication && input.actionResourceAuthorization)
  return authorized
    ? result('PASS', 'NEXT_SOURCE_CONTRACT_COMPATIBLE')
    : result('FAIL', 'NEXT_ENTRYPOINT_AUTHORIZATION_MISSING')
}

const evaluateRuntime = input => {
  const privateData = new Set(['authenticated', 'private', 'tenant']).has(input.dataClass)
  return privateData && input.cacheScope === 'shared-public'
    ? result('FAIL', 'NEXT_PRIVATE_DATA_CACHE_LEAK')
    : result('PASS', 'NEXT_RUNTIME_CONTRACT_COMPATIBLE')
}

const evaluateRelease = input => {
  if (input.receiptStatus !== 'PASS') return result('BLOCKED', 'NEXT_EVIDENCE_NOT_PASSING')
  return input.receiptSourceFingerprint === input.currentSourceFingerprint
    ? result('PASS', 'NEXT_EVIDENCE_CURRENT')
    : result('BLOCKED', 'NEXT_EVIDENCE_STALE')
}

export const evaluateNextContractCase = contractCase => {
  const errors = []
  if (!isPlainObject(contractCase) || !PHASES.has(contractCase.phase)) {
    throw new WebCoreError('INVALID_NEXT_CONTRACT_CASE', 'Next contract case has an unsupported shape')
  }
  validateInput(contractCase.phase, contractCase.input, 'case.input', errors)
  if (errors.length) {
    throw new WebCoreError('INVALID_NEXT_CONTRACT_CASE', 'Next contract case input is invalid', {errors: sortedUnique(errors)})
  }
  if (contractCase.phase === 'profile-resolution') return evaluateProfile(contractCase.input)
  if (contractCase.phase === 'source-contract') return evaluateSource(contractCase.input)
  if (contractCase.phase === 'runtime-contract') return evaluateRuntime(contractCase.input)
  return evaluateRelease(contractCase.input)
}

export const evaluateNextContractDocument = document => {
  const errors = validateNextContractDocument(document)
  if (errors.length) {
    throw new WebCoreError('INVALID_NEXT_CONTRACT_FIXTURE', 'Next contract fixture is invalid', {errors})
  }

  const cases = document.cases.map(contractCase => {
    const actual = evaluateNextContractCase(contractCase)
    return {
      id: contractCase.id,
      phase: contractCase.phase,
      matched: stableStringify(actual) === stableStringify(contractCase.expected),
      actual,
      expected: contractCase.expected,
    }
  })
  const mismatches = cases.filter(contractCase => !contractCase.matched).map(contractCase => contractCase.id)
  if (mismatches.length) {
    throw new WebCoreError('NEXT_CONTRACT_FIXTURE_MISMATCH', 'Next contract fixture expectations do not match evaluator output', {
      mismatches,
      cases: cases.filter(contractCase => !contractCase.matched),
    })
  }
  return {
    ok: true,
    schemaVersion: document.schemaVersion,
    adapterId: document.adapterId,
    caseCount: cases.length,
    cases: cases.map(({id, phase, matched, actual}) => ({id, phase, matched, actual})),
  }
}
