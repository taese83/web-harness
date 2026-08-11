import {isIP} from 'node:net'
import {lstatSync} from 'node:fs'
import {basename, isAbsolute, resolve} from 'node:path'
import {normalizeGeneratedArtifactPath, sha256} from './evidence-lib.mjs'
import {readProjectRegularFile} from './safe-project-file-lib.mjs'

export const RUNTIME_DATA_CONTRACT_PATH = '_workspace/02_design/runtime-data-contract.json'
export const INGESTION_RECEIPT_ID = 'ingestion'
export const BUILTIN_INGESTION_SCHEMA = 'builtin:ingestion-envelope-v1'

const CONTRACT_SCHEMA_PATH = '.claude/schemas/runtime-data-contract.schema.json'
const MAX_CONTRACT_BYTES = 2 * 1024 * 1024
const MAX_SCHEMA_BYTES = 2 * 1024 * 1024
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024
const MAX_TOTAL_ARTIFACT_BYTES = 64 * 1024 * 1024
const MAX_ARTIFACT_RECORDS = 100_000
const MAX_TOTAL_ARTIFACT_RECORDS = 250_000
const MAX_SCHEMA_DEPTH = 64
const MAX_SCHEMA_NODES = 10_000
const MAX_VALIDATION_ERRORS = 100
const MAX_INSTANCE_NODES = 1_000_000
const MAX_FRESHNESS_SLO_MS = 366 * 24 * 60 * 60 * 1000
const FUTURE_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000

const ROOT_KEYS = new Set([
  '$schema', 'schemaVersion', 'mode', 'authoritativeSource', 'buildCwd', 'deploymentRoot',
  'generatedArtifacts', 'freshnessSlo', 'promotionPolicy', 'servingFallback', 'refreshCapabilities',
])
const ARTIFACT_KEYS = new Set(['path', 'required', 'schema', 'minCount', 'validation'])
const VALIDATION_KEYS = new Set([
  'recordsPointer', 'countPointer', 'freshnessPointer', 'coverage', 'duplicates', 'diff',
])
const COVERAGE_KEYS = new Set([
  'requiredFields', 'minimumFieldRatio', 'metricPointer', 'minimumMetric',
])
const DUPLICATE_KEYS = new Set(['keyPointers', 'maximumRatio'])
const DIFF_KEYS = new Set(['baselinePath', 'maximumCountDropRatio'])
const FORBIDDEN_FILE_ROOTS = new Set(['.git', 'node_modules', 'secrets'])
const GENERATED_OUTPUT_ROOTS = new Set(['build', 'data', 'dist', 'generated', 'out', 'public', 'static'])
const GENERATED_PROTECTED_SEGMENTS = new Set([
  '.claude', '.git', '.github', '_workspace', 'app', 'config', 'lib', 'node_modules', 'pages', 'scripts', 'src', 'workers',
])
const SECRET_FILE_NAMES = new Set([
  '.dev.vars', '.env', '.git-credentials', '.netrc', '.npmrc', '.pypirc',
  'credentials.json', 'service-account.json',
])
const JSON_SCHEMA_ANNOTATIONS = new Set([
  '$schema', '$id', 'title', 'description', 'default', 'examples', 'deprecated', 'readOnly', 'writeOnly',
])
const JSON_SCHEMA_KEYWORDS = new Set([
  ...JSON_SCHEMA_ANNOTATIONS,
  '$defs', '$ref', 'type', 'enum', 'const', 'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else',
  'properties', 'additionalProperties', 'required', 'minProperties', 'maxProperties',
  'propertyNames', 'items', 'prefixItems', 'contains', 'minContains', 'maxContains', 'minItems', 'maxItems',
  'minLength', 'maxLength', 'format', 'minimum', 'maximum', 'exclusiveMinimum',
  'exclusiveMaximum', 'multipleOf',
])
const JSON_SCHEMA_TYPES = new Set(['null', 'boolean', 'object', 'array', 'number', 'integer', 'string'])
const JSON_SCHEMA_FORMATS = new Set([
  'date-time', 'date', 'time', 'duration', 'email', 'hostname', 'ipv4', 'ipv6', 'uri', 'uri-reference', 'uuid',
])

const BUILTIN_SCHEMA_DOCUMENT = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['data', 'count'],
  properties: {
    data: {type: 'array', items: {type: 'object'}},
    count: {type: 'integer', minimum: 0},
  },
})

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const pushError = (errors, message) => {
  if (errors.length < MAX_VALIDATION_ERRORS) errors.push(message)
}
const exactKeys = (value, allowed, label, errors) => {
  if (!isObject(value)) {
    pushError(errors, `${label} must be an object`)
    return false
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) pushError(errors, `${label}: unknown field ${key}`)
  }
  return true
}
const stableValue = value => {
  if (Array.isArray(value)) return value.map(stableValue)
  if (isObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
  }
  return value
}
const stableJson = value => JSON.stringify(stableValue(value))
const scalarSchemaValue = value => value === null || ['boolean', 'number', 'string'].includes(typeof value)
const scalarEqual = (left, right) => scalarSchemaValue(left) && scalarSchemaValue(right) && left === right

const normalizeProjectFile = (value, label, errors) => {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 1024 ||
    value.includes('\0') ||
    isAbsolute(value) ||
    /^[A-Za-z]:[\\/]/.test(value)
  ) {
    pushError(errors, `${label} must be a project-relative file path`)
    return null
  }
  const normalized = value.replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/\/+$/, '')
  const segments = normalized.split('/')
  if (!normalized || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    pushError(errors, `${label} contains an unsafe path segment`)
    return null
  }
  if (segments.some(segment => !/^[A-Za-z0-9._-]+$/.test(segment))) {
    pushError(errors, `${label} must use portable ASCII path segments`)
    return null
  }
  if (FORBIDDEN_FILE_ROOTS.has(segments[0].toLowerCase())) {
    pushError(errors, `${label} targets a forbidden project root`)
    return null
  }
  const name = basename(normalized).toLowerCase()
  if (
    SECRET_FILE_NAMES.has(name) ||
    (name.startsWith('.env.') && !['.env.example', '.env.sample', '.env.template'].includes(name)) ||
    /\.(?:jks|key|keystore|p12|pem|pfx)$/.test(name)
  ) {
    pushError(errors, `${label} targets a secret-bearing file name`)
    return null
  }
  return normalized
}

const normalizeGeneratedDataPath = (value, label, errors) => {
  const declaredPath = normalizeProjectFile(value, label, errors)
  if (!declaredPath) return null
  const segments = declaredPath.split('/')
  const normalized = normalizeGeneratedArtifactPath(declaredPath)
  if (
    !normalized ||
    !normalized.toLowerCase().endsWith('.json') ||
    !segments.some(segment => GENERATED_OUTPUT_ROOTS.has(segment.toLowerCase())) ||
    segments.some(segment => GENERATED_PROTECTED_SEGMENTS.has(segment.toLowerCase()))
  ) {
    pushError(errors, `${label} must be a JSON file under an approved generated output root`)
    return null
  }
  return normalized
}

const normalizeProjectDirectory = (value, label, errors) => {
  if (value === '.') return '.'
  const normalized = normalizeProjectFile(value, label, errors)
  return normalized
}

const readJsonProjectFile = (projectRoot, relativePath, label, errors, maxBytes) => {
  let source
  try {
    source = readProjectRegularFile(projectRoot, relativePath, {maxBytes})
  } catch (error) {
    pushError(errors, `${label}: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
  try {
    return {source, value: JSON.parse(source.toString('utf8')), sha256: sha256(source)}
  } catch (error) {
    pushError(errors, `${label}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

const parseDurationMs = (value, label, errors) => {
  if (typeof value !== 'string') {
    pushError(errors, `${label} must be an ISO-8601 day/time duration`)
    return null
  }
  const match = value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(\d+(?:\.\d+)?S)?)?$/)
  if (!match || match.slice(1).every(part => part === undefined)) {
    pushError(errors, `${label} must use an unambiguous ISO-8601 day/time duration`)
    return null
  }
  const milliseconds =
    Number(match[1] ?? 0) * 86_400_000 +
    Number(match[2] ?? 0) * 3_600_000 +
    Number(match[3] ?? 0) * 60_000 +
    Number((match[4] ?? '0').replace(/S$/, '')) * 1000
  if (!Number.isFinite(milliseconds) || milliseconds <= 0 || milliseconds > MAX_FRESHNESS_SLO_MS) {
    pushError(errors, `${label} must be greater than zero and no longer than 366 days`)
    return null
  }
  return milliseconds
}

const validJsonPointer = value => {
  if (typeof value !== 'string' || value.length > 1024) return false
  if (value === '') return true
  if (!value.startsWith('/')) return false
  return value.split('/').slice(1).every(segment => !/~(?:[^01]|$)/.test(segment))
}
const normalizePointer = (value, fallback, label, errors) => {
  const pointer = value ?? fallback
  if (!validJsonPointer(pointer)) {
    pushError(errors, `${label} must be an RFC 6901 JSON Pointer`)
    return fallback
  }
  return pointer
}
const decodePointer = pointer => pointer === ''
  ? []
  : pointer.split('/').slice(1).map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
const resolvePointer = (value, pointer) => {
  let current = value
  for (const segment of decodePointer(pointer)) {
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/.test(segment) || Number(segment) >= current.length) return {found: false, value: undefined}
      current = current[Number(segment)]
    } else if (isObject(current) && own(current, segment)) {
      current = current[segment]
    } else {
      return {found: false, value: undefined}
    }
  }
  return {found: true, value: current}
}

const ratio = (value, fallback, label, errors) => {
  const observed = value ?? fallback
  if (typeof observed !== 'number' || !Number.isFinite(observed) || observed < 0 || observed > 1) {
    pushError(errors, `${label} must be a finite number between 0 and 1`)
    return fallback
  }
  return observed
}
const pointerArray = (value, fallback, label, errors, maximum) => {
  const observed = value ?? fallback
  if (!Array.isArray(observed) || observed.length === 0 || observed.length > maximum) {
    pushError(errors, `${label} must contain between 1 and ${maximum} JSON Pointers`)
    return fallback
  }
  const result = []
  for (const [index, pointer] of observed.entries()) {
    if (!validJsonPointer(pointer)) pushError(errors, `${label}[${index}] must be an RFC 6901 JSON Pointer`)
    else if (result.includes(pointer)) pushError(errors, `${label} contains duplicate pointer ${pointer}`)
    else result.push(pointer)
  }
  return result.length ? result : fallback
}

const normalizeArtifactValidation = (value, artifactPath, errors) => {
  const label = `${RUNTIME_DATA_CONTRACT_PATH}: ${artifactPath}.validation`
  const source = value ?? {}
  exactKeys(source, VALIDATION_KEYS, label, errors)

  const coverageSource = source.coverage ?? {}
  exactKeys(coverageSource, COVERAGE_KEYS, `${label}.coverage`, errors)
  const metricPointer = coverageSource.metricPointer === undefined
    ? null
    : normalizePointer(coverageSource.metricPointer, '', `${label}.coverage.metricPointer`, errors)
  if (coverageSource.minimumMetric !== undefined && metricPointer === null) {
    pushError(errors, `${label}.coverage.minimumMetric requires metricPointer`)
  }

  const duplicateSource = source.duplicates ?? {}
  exactKeys(duplicateSource, DUPLICATE_KEYS, `${label}.duplicates`, errors)

  let diff = null
  if (source.diff !== undefined) {
    if (exactKeys(source.diff, DIFF_KEYS, `${label}.diff`, errors)) {
      const baselinePath = normalizeGeneratedDataPath(source.diff.baselinePath, `${label}.diff.baselinePath`, errors)
      const maximumCountDropRatio = ratio(
        source.diff.maximumCountDropRatio,
        null,
        `${label}.diff.maximumCountDropRatio`,
        errors,
      )
      if (baselinePath?.toLowerCase() === artifactPath.toLowerCase()) {
        pushError(errors, `${label}.diff.baselinePath must differ from the generated artifact on case-insensitive filesystems`)
      }
      if (baselinePath && maximumCountDropRatio !== null) diff = {baselinePath, maximumCountDropRatio}
    }
  }

  return {
    recordsPointer: normalizePointer(source.recordsPointer, '/data', `${label}.recordsPointer`, errors),
    countPointer: normalizePointer(source.countPointer, '/count', `${label}.countPointer`, errors),
    freshnessPointer: normalizePointer(source.freshnessPointer, '/generatedAt', `${label}.freshnessPointer`, errors),
    coverage: {
      requiredFields: pointerArray(
        coverageSource.requiredFields,
        ['/id'],
        `${label}.coverage.requiredFields`,
        errors,
        64,
      ),
      minimumFieldRatio: ratio(
        coverageSource.minimumFieldRatio,
        1,
        `${label}.coverage.minimumFieldRatio`,
        errors,
      ),
      metricPointer,
      minimumMetric: ratio(
        coverageSource.minimumMetric,
        1,
        `${label}.coverage.minimumMetric`,
        errors,
      ),
    },
    duplicates: {
      keyPointers: pointerArray(
        duplicateSource.keyPointers,
        ['/id'],
        `${label}.duplicates.keyPointers`,
        errors,
        16,
      ),
      maximumRatio: ratio(
        duplicateSource.maximumRatio,
        0,
        `${label}.duplicates.maximumRatio`,
        errors,
      ),
    },
    diff,
  }
}

const jsonSchemaTypeValid = (value, type) => {
  if (type === 'null') return value === null
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return isObject(value)
  if (type === 'integer') return typeof value === 'number' && Number.isSafeInteger(value)
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  return typeof value === type
}

const inspectJsonSchema = (schema, errors, label = 'artifact schema') => {
  const state = {nodes: 0}
  const inspect = (node, path, depth) => {
    state.nodes += 1
    if (state.nodes > MAX_SCHEMA_NODES) {
      pushError(errors, `${label}: schema exceeds ${MAX_SCHEMA_NODES} nodes`)
      return
    }
    if (depth > MAX_SCHEMA_DEPTH) {
      pushError(errors, `${label}: schema exceeds depth ${MAX_SCHEMA_DEPTH}`)
      return
    }
    if (typeof node === 'boolean') return
    if (!isObject(node)) {
      pushError(errors, `${label}${path}: schema node must be an object or boolean`)
      return
    }
    for (const key of Object.keys(node)) {
      if (!JSON_SCHEMA_KEYWORDS.has(key)) pushError(errors, `${label}${path}: unsupported JSON Schema keyword ${key}`)
    }
    if (node.$schema !== undefined && node.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
      pushError(errors, `${label}${path}.$schema must use draft 2020-12`)
    }
    if (node.$ref !== undefined && (typeof node.$ref !== 'string' || !node.$ref.startsWith('#/'))) {
      pushError(errors, `${label}${path}.$ref must be a local document reference`)
    }
    if (node.type !== undefined) {
      const types = Array.isArray(node.type) ? node.type : [node.type]
      if (!types.length || types.some(type => !JSON_SCHEMA_TYPES.has(type)) || new Set(types).size !== types.length) {
        pushError(errors, `${label}${path}.type is invalid`)
      }
    }
    if (node.const !== undefined && !scalarSchemaValue(node.const)) {
      pushError(errors, `${label}${path}.const must be a scalar JSON value`)
    }
    if (
      node.enum !== undefined &&
      (!Array.isArray(node.enum) || node.enum.length === 0 || node.enum.length > 64 || node.enum.some(value => !scalarSchemaValue(value)))
    ) {
      pushError(errors, `${label}${path}.enum must contain between 1 and 64 scalar JSON values`)
    }
    for (const key of ['allOf', 'anyOf', 'oneOf', 'prefixItems']) {
      if (node[key] !== undefined) {
        if (!Array.isArray(node[key]) || node[key].length === 0 || node[key].length > 64) pushError(errors, `${label}${path}.${key} must contain between 1 and 64 schemas`)
        else node[key].forEach((child, index) => inspect(child, `${path}/${key}/${index}`, depth + 1))
      }
    }
    for (const key of ['not', 'if', 'then', 'else', 'items', 'contains', 'propertyNames']) {
      if (node[key] !== undefined) inspect(node[key], `${path}/${key}`, depth + 1)
    }
    for (const key of ['$defs', 'properties']) {
      if (node[key] !== undefined) {
        if (!isObject(node[key]) || Object.keys(node[key]).length > 256) pushError(errors, `${label}${path}.${key} must be an object with at most 256 entries`)
        else {
          for (const [name, child] of Object.entries(node[key])) {
            inspect(child, `${path}/${key}/${name}`, depth + 1)
          }
        }
      }
    }
    if (node.additionalProperties !== undefined && typeof node.additionalProperties !== 'boolean') {
      inspect(node.additionalProperties, `${path}/additionalProperties`, depth + 1)
    }
    if (node.required !== undefined && (
      !Array.isArray(node.required) ||
      node.required.length > 64 ||
      node.required.some(value => typeof value !== 'string') ||
      new Set(node.required).size !== node.required.length
    )) pushError(errors, `${label}${path}.required must be an array of at most 64 unique strings`)
    for (const key of ['minProperties', 'maxProperties', 'minItems', 'maxItems', 'minContains', 'maxContains', 'minLength', 'maxLength']) {
      if (node[key] !== undefined && (!Number.isInteger(node[key]) || node[key] < 0)) {
        pushError(errors, `${label}${path}.${key} must be a non-negative integer`)
      }
    }
    for (const key of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum']) {
      if (node[key] !== undefined && (typeof node[key] !== 'number' || !Number.isFinite(node[key]))) {
        pushError(errors, `${label}${path}.${key} must be a finite number`)
      }
    }
    if (node.multipleOf !== undefined && (typeof node.multipleOf !== 'number' || !Number.isFinite(node.multipleOf) || node.multipleOf <= 0)) {
      pushError(errors, `${label}${path}.multipleOf must be a positive finite number`)
    }
    if (node.format !== undefined && !JSON_SCHEMA_FORMATS.has(node.format)) pushError(errors, `${label}${path}.format is unsupported`)
  }
  inspect(schema, '', 0)
}

const resolveSchemaRef = (rootSchema, reference) => {
  if (reference === '#') return rootSchema
  if (typeof reference !== 'string' || !reference.startsWith('#/')) return null
  return resolvePointer(rootSchema, reference.slice(1)).found ? resolvePointer(rootSchema, reference.slice(1)).value : null
}

const inspectSchemaReferences = (schema, errors, label) => {
  const schemaNodes = new Set()
  const collect = node => {
    if (typeof node === 'boolean' || schemaNodes.has(node) || !isObject(node)) return
    schemaNodes.add(node)
    for (const key of ['$defs', 'properties']) {
      for (const child of Object.values(isObject(node[key]) ? node[key] : {})) collect(child)
    }
    for (const key of ['allOf', 'anyOf', 'oneOf', 'prefixItems']) {
      for (const child of Array.isArray(node[key]) ? node[key] : []) collect(child)
    }
    for (const key of ['not', 'if', 'then', 'else', 'items', 'contains', 'propertyNames']) collect(node[key])
    if (isObject(node.additionalProperties) || typeof node.additionalProperties === 'boolean') collect(node.additionalProperties)
  }
  collect(schema)
  for (const node of schemaNodes) {
    if (node.$ref === undefined) continue
    const referenced = resolveSchemaRef(schema, node.$ref)
    if (typeof referenced !== 'boolean' && !schemaNodes.has(referenced)) {
      pushError(errors, `${label}: unresolved or non-schema local reference ${node.$ref}`)
    }
  }
}

const validDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().startsWith(value)
}
const validTime = value => /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
const validDateTime = value => {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/)
  if (!match || !validDate(match[1])) return false
  return Number.isFinite(Date.parse(value))
}
const formatValid = (value, format) => {
  if (format === 'date-time') return validDateTime(value)
  if (format === 'date') return validDate(value)
  if (format === 'time') return validTime(value)
  if (format === 'duration') return /^P(?=\d|T\d)(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/.test(value)
  if (format === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  if (format === 'hostname') return value.length <= 253 && value.split('.').every(label => /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)$/.test(label))
  if (format === 'ipv4') return isIP(value) === 4
  if (format === 'ipv6') return isIP(value) === 6
  if (format === 'uuid') return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  if (format === 'uri') {
    try { return Boolean(new URL(value).protocol) } catch { return false }
  }
  if (format === 'uri-reference') {
    try { new URL(value, 'https://reference.invalid/'); return true } catch { return false }
  }
  return true
}

const validateJsonSchemaValue = (value, schema, rootSchema, label, errors) => {
  const state = {nodes: 0, exhausted: false}
  const validate = (instance, node, path, targetErrors, depth = 0) => {
    if (state.exhausted) return
    state.nodes += 1
    if (state.nodes > MAX_INSTANCE_NODES || depth > 256) {
      state.exhausted = true
      pushError(targetErrors, `${label}${path}: instance validation budget exceeded`)
      return
    }
    if (node === true) return
    if (node === false) {
      pushError(targetErrors, `${label}${path}: value is rejected by the schema`)
      return
    }
    if (!isObject(node)) {
      pushError(targetErrors, `${label}${path}: referenced schema node is invalid`)
      return
    }
    if (node.$ref !== undefined) {
      const referenced = resolveSchemaRef(rootSchema, node.$ref)
      if (referenced === null || (typeof referenced !== 'boolean' && !isObject(referenced))) pushError(targetErrors, `${label}${path}: unresolved local schema reference ${node.$ref}`)
      else validate(instance, referenced, path, targetErrors, depth + 1)
    }
    if (node.type !== undefined) {
      const types = Array.isArray(node.type) ? node.type : [node.type]
      if (!types.some(type => jsonSchemaTypeValid(instance, type))) {
        pushError(targetErrors, `${label}${path}: expected type ${types.join('|')}`)
        return
      }
    }
    if (node.const !== undefined && !scalarEqual(instance, node.const)) pushError(targetErrors, `${label}${path}: value does not match const`)
    if (node.enum !== undefined && !node.enum.some(candidate => scalarEqual(instance, candidate))) pushError(targetErrors, `${label}${path}: value is not in enum`)

    for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
      if (!Array.isArray(node[keyword])) continue
      const results = node[keyword].map(candidate => {
        const candidateErrors = []
        validate(instance, candidate, path, candidateErrors, depth + 1)
        return candidateErrors
      })
      const passing = results.filter(candidateErrors => candidateErrors.length === 0).length
      if (keyword === 'allOf' && passing !== results.length) pushError(targetErrors, `${label}${path}: allOf did not match`)
      if (keyword === 'anyOf' && passing === 0) pushError(targetErrors, `${label}${path}: anyOf did not match`)
      if (keyword === 'oneOf' && passing !== 1) pushError(targetErrors, `${label}${path}: oneOf matched ${passing} branches`)
    }
    if (node.not !== undefined) {
      const candidateErrors = []
      validate(instance, node.not, path, candidateErrors, depth + 1)
      if (candidateErrors.length === 0) pushError(targetErrors, `${label}${path}: not schema matched`)
    }
    if (node.if !== undefined) {
      const conditionErrors = []
      validate(instance, node.if, path, conditionErrors, depth + 1)
      if (conditionErrors.length === 0 && node.then !== undefined) validate(instance, node.then, path, targetErrors, depth + 1)
      if (conditionErrors.length > 0 && node.else !== undefined) validate(instance, node.else, path, targetErrors, depth + 1)
    }

    if (isObject(instance)) {
      const keys = Object.keys(instance)
      if (node.minProperties !== undefined && keys.length < node.minProperties) pushError(targetErrors, `${label}${path}: too few properties`)
      if (node.maxProperties !== undefined && keys.length > node.maxProperties) pushError(targetErrors, `${label}${path}: too many properties`)
      for (const required of node.required ?? []) {
        if (!own(instance, required)) pushError(targetErrors, `${label}${path}: missing required property ${required}`)
      }
      const matched = new Set()
      for (const [key, childSchema] of Object.entries(node.properties ?? {})) {
        if (own(instance, key)) {
          matched.add(key)
          validate(instance[key], childSchema, `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`, targetErrors, depth + 1)
        }
      }
      const extras = keys.filter(key => !matched.has(key))
      if (node.additionalProperties === false && extras.length) pushError(targetErrors, `${label}${path}: unexpected properties ${extras.join(', ')}`)
      else if (isObject(node.additionalProperties) || typeof node.additionalProperties === 'boolean') {
        if (node.additionalProperties !== true) {
          for (const key of extras) validate(instance[key], node.additionalProperties, `${path}/${key}`, targetErrors, depth + 1)
        }
      }
      if (node.propertyNames !== undefined) {
        for (const key of keys) validate(key, node.propertyNames, `${path}/<property-name>`, targetErrors, depth + 1)
      }
    }

    if (Array.isArray(instance)) {
      if (node.minItems !== undefined && instance.length < node.minItems) pushError(targetErrors, `${label}${path}: too few items`)
      if (node.maxItems !== undefined && instance.length > node.maxItems) pushError(targetErrors, `${label}${path}: too many items`)
      for (const [index, childSchema] of (node.prefixItems ?? []).entries()) {
        if (index < instance.length) validate(instance[index], childSchema, `${path}/${index}`, targetErrors, depth + 1)
      }
      if (node.items !== undefined) {
        const offset = Array.isArray(node.prefixItems) ? node.prefixItems.length : 0
        for (let index = offset; index < instance.length; index += 1) {
          validate(instance[index], node.items, `${path}/${index}`, targetErrors, depth + 1)
        }
      }
      if (node.contains !== undefined) {
        let matches = 0
        for (let index = 0; index < instance.length; index += 1) {
          const candidateErrors = []
          validate(instance[index], node.contains, `${path}/${index}`, candidateErrors, depth + 1)
          if (candidateErrors.length === 0) matches += 1
        }
        const minimum = node.minContains ?? 1
        const maximum = node.maxContains ?? Number.POSITIVE_INFINITY
        if (matches < minimum || matches > maximum) pushError(targetErrors, `${label}${path}: contains matched ${matches} items`)
      }
    }

    if (typeof instance === 'string') {
      const length = [...instance].length
      if (node.minLength !== undefined && length < node.minLength) pushError(targetErrors, `${label}${path}: string is too short`)
      if (node.maxLength !== undefined && length > node.maxLength) pushError(targetErrors, `${label}${path}: string is too long`)
      if (node.format !== undefined && !formatValid(instance, node.format)) pushError(targetErrors, `${label}${path}: string does not match format ${node.format}`)
    }
    if (typeof instance === 'number' && Number.isFinite(instance)) {
      if (node.minimum !== undefined && instance < node.minimum) pushError(targetErrors, `${label}${path}: number is below minimum`)
      if (node.maximum !== undefined && instance > node.maximum) pushError(targetErrors, `${label}${path}: number is above maximum`)
      if (node.exclusiveMinimum !== undefined && instance <= node.exclusiveMinimum) pushError(targetErrors, `${label}${path}: number is not above exclusiveMinimum`)
      if (node.exclusiveMaximum !== undefined && instance >= node.exclusiveMaximum) pushError(targetErrors, `${label}${path}: number is not below exclusiveMaximum`)
      if (node.multipleOf !== undefined) {
        const quotient = instance / node.multipleOf
        if (Math.abs(quotient - Math.round(quotient)) > 1e-10) pushError(targetErrors, `${label}${path}: number is not a multipleOf ${node.multipleOf}`)
      }
    }
  }
  validate(value, schema, '', errors)
  if (state.exhausted) pushError(errors, `${label}: instance validation budget exceeded`)
}

const loadArtifactSchema = (projectRoot, schemaReference, label, errors) => {
  if (schemaReference === BUILTIN_INGESTION_SCHEMA) {
    return {
      reference: schemaReference,
      document: BUILTIN_SCHEMA_DOCUMENT,
      sha256: sha256(stableJson(BUILTIN_SCHEMA_DOCUMENT)),
      evidencePath: null,
    }
  }
  const path = normalizeProjectFile(schemaReference, `${label}.schema`, errors)
  if (!path || !path.toLowerCase().endsWith('.json')) {
    if (path) pushError(errors, `${label}.schema must reference a JSON file or ${BUILTIN_INGESTION_SCHEMA}`)
    return null
  }
  const file = readJsonProjectFile(projectRoot, path, `${label}.schema`, errors, MAX_SCHEMA_BYTES)
  if (!file) return null
  const schemaErrorsBefore = errors.length
  if (!isObject(file.value)) {
    pushError(errors, `${label}.schema must be a JSON Schema object`)
  } else {
    if (file.value.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
      pushError(errors, `${label}.schema must declare JSON Schema draft 2020-12`)
    }
    inspectJsonSchema(file.value, errors, `${label}.schema`)
    inspectSchemaReferences(file.value, errors, `${label}.schema`)
  }
  if (errors.length !== schemaErrorsBefore) return null
  return {reference: path, document: file.value, sha256: file.sha256, evidencePath: path}
}

export class RuntimeDataContractError extends Error {
  constructor(errors) {
    super(errors.join('; '))
    this.name = 'RuntimeDataContractError'
    this.errors = errors
  }
}

export const inspectRuntimeDataContractMetadata = projectPath => {
  const projectRoot = resolve(projectPath)
  const errors = []
  const document = readJsonProjectFile(
    projectRoot,
    RUNTIME_DATA_CONTRACT_PATH,
    RUNTIME_DATA_CONTRACT_PATH,
    errors,
    MAX_CONTRACT_BYTES,
  )
  if (!document) return {ok: false, errors, mode: null, scheduled: false, contractSha256: null}
  const raw = document.value
  if (!exactKeys(raw, ROOT_KEYS, RUNTIME_DATA_CONTRACT_PATH, errors)) {
    return {ok: false, errors, mode: null, scheduled: false, contractSha256: document.sha256}
  }
  if (raw.$schema !== undefined && raw.$schema !== CONTRACT_SCHEMA_PATH) {
    pushError(errors, `${RUNTIME_DATA_CONTRACT_PATH}: $schema must be ${CONTRACT_SCHEMA_PATH}`)
  }
  if (raw.schemaVersion !== 1) pushError(errors, `${RUNTIME_DATA_CONTRACT_PATH}: schemaVersion must be 1`)
  if (!['static-snapshot', 'live-api', 'hybrid'].includes(raw.mode)) {
    pushError(errors, `${RUNTIME_DATA_CONTRACT_PATH}: invalid mode`)
  }
  if (typeof raw.authoritativeSource !== 'string' || !raw.authoritativeSource.trim() || raw.authoritativeSource.length > 512) {
    pushError(errors, `${RUNTIME_DATA_CONTRACT_PATH}: authoritativeSource must be a non-empty string no longer than 512 characters`)
  }
  const buildCwd = normalizeProjectDirectory(raw.buildCwd, `${RUNTIME_DATA_CONTRACT_PATH}: buildCwd`, errors)
  const deploymentRoot = normalizeProjectDirectory(raw.deploymentRoot, `${RUNTIME_DATA_CONTRACT_PATH}: deploymentRoot`, errors)
  if (buildCwd !== '.') pushError(errors, `${RUNTIME_DATA_CONTRACT_PATH}: buildCwd must match the root-bound quality runner cwd "."`)
  if (deploymentRoot !== '.') pushError(errors, `${RUNTIME_DATA_CONTRACT_PATH}: deploymentRoot must match the release root "."`)
  parseDurationMs(raw.freshnessSlo, `${RUNTIME_DATA_CONTRACT_PATH}: freshnessSlo`, errors)
  if (raw.promotionPolicy !== 'reject-invalid') {
    pushError(errors, `${RUNTIME_DATA_CONTRACT_PATH}: promotionPolicy must be reject-invalid`)
  }
  if (!['last-known-good', 'unavailable'].includes(raw.servingFallback)) {
    pushError(errors, `${RUNTIME_DATA_CONTRACT_PATH}: servingFallback must be last-known-good or unavailable`)
  }
  const allowedRefreshCapabilities = new Set(['scheduled', 'manual-recovery', 'on-demand', 'runtime'])
  if (
    !Array.isArray(raw.refreshCapabilities) ||
    raw.refreshCapabilities.length < 1 ||
    raw.refreshCapabilities.length > allowedRefreshCapabilities.size ||
    raw.refreshCapabilities.some(capability => !allowedRefreshCapabilities.has(capability)) ||
    new Set(raw.refreshCapabilities).size !== raw.refreshCapabilities.length
  ) {
    pushError(errors, `${RUNTIME_DATA_CONTRACT_PATH}: refreshCapabilities must contain unique supported capabilities`)
  } else if (raw.refreshCapabilities.includes('scheduled') && !raw.refreshCapabilities.includes('manual-recovery')) {
    pushError(errors, `${RUNTIME_DATA_CONTRACT_PATH}: scheduled refresh requires manual-recovery`)
  }
  if (!Array.isArray(raw.generatedArtifacts) || raw.generatedArtifacts.length > 64) {
    pushError(errors, `${RUNTIME_DATA_CONTRACT_PATH}: generatedArtifacts must be an array with no more than 64 entries`)
  } else {
    const artifactPaths = new Set()
    for (const [index, artifact] of raw.generatedArtifacts.entries()) {
      const label = `${RUNTIME_DATA_CONTRACT_PATH}: generatedArtifacts[${index}]`
      if (!exactKeys(artifact, ARTIFACT_KEYS, label, errors)) continue
      const path = normalizeGeneratedDataPath(artifact.path, `${label}.path`, errors)
      if (!path) pushError(errors, `${label}.path must be a safe generated JSON path`)
      else if (artifactPaths.has(path.toLowerCase())) pushError(errors, `${label}.path is duplicated across supported filesystems: ${path}`)
      else artifactPaths.add(path.toLowerCase())
      if (typeof artifact.required !== 'boolean') pushError(errors, `${label}.required must be boolean`)
      if (typeof artifact.schema !== 'string' || !artifact.schema || artifact.schema.length > 1024) {
        pushError(errors, `${label}.schema must be a non-empty schema reference`)
      }
      if (artifact.required === true && artifact.schema === BUILTIN_INGESTION_SCHEMA) {
        pushError(errors, `${label}.schema must reference a project JSON Schema for a required artifact`)
      }
      if (!Number.isInteger(artifact.minCount) || artifact.minCount < 1 || artifact.minCount > 1_000_000_000) {
        pushError(errors, `${label}.minCount must be an integer between 1 and 1000000000`)
      }
      if (artifact.required === true && (!isObject(artifact.validation) || !isObject(artifact.validation.diff))) {
        pushError(errors, `${label}: required artifacts must declare validation.diff`)
      }
    }
    if (['static-snapshot', 'hybrid'].includes(raw.mode) && !raw.generatedArtifacts.some(artifact => artifact?.required === true)) {
      pushError(errors, `${RUNTIME_DATA_CONTRACT_PATH}: ${raw.mode} requires at least one required generated artifact`)
    }
    if (raw.mode === 'live-api' && raw.generatedArtifacts.some(artifact => artifact?.required === true)) {
      pushError(errors, `${RUNTIME_DATA_CONTRACT_PATH}: live-api cannot declare a required generated artifact`)
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    mode: typeof raw.mode === 'string' ? raw.mode : null,
    scheduled: Array.isArray(raw.refreshCapabilities) && raw.refreshCapabilities.includes('scheduled'),
    contractSha256: document.sha256,
  }
}

export const readRuntimeDataContract = (projectPath, {mutableArtifactRoots = []} = {}) => {
  const projectRoot = resolve(projectPath)
  const errors = []
  const document = readJsonProjectFile(
    projectRoot,
    RUNTIME_DATA_CONTRACT_PATH,
    RUNTIME_DATA_CONTRACT_PATH,
    errors,
    MAX_CONTRACT_BYTES,
  )
  if (!document) throw new RuntimeDataContractError(errors)
  const raw = document.value
  if (!exactKeys(raw, ROOT_KEYS, RUNTIME_DATA_CONTRACT_PATH, errors)) throw new RuntimeDataContractError(errors)
  if (raw.$schema !== undefined && raw.$schema !== CONTRACT_SCHEMA_PATH) {
    pushError(errors, `${RUNTIME_DATA_CONTRACT_PATH}: $schema must be ${CONTRACT_SCHEMA_PATH}`)
  }
  if (raw.schemaVersion !== 1) pushError(errors, `${RUNTIME_DATA_CONTRACT_PATH}: schemaVersion must be 1`)
  if (!['static-snapshot', 'live-api', 'hybrid'].includes(raw.mode)) {
    pushError(errors, `${RUNTIME_DATA_CONTRACT_PATH}: invalid mode`)
  }
  if (typeof raw.authoritativeSource !== 'string' || !raw.authoritativeSource.trim() || raw.authoritativeSource.length > 512) {
    pushError(errors, `${RUNTIME_DATA_CONTRACT_PATH}: authoritativeSource must be a non-empty string no longer than 512 characters`)
  }
  const buildCwd = normalizeProjectDirectory(raw.buildCwd, `${RUNTIME_DATA_CONTRACT_PATH}: buildCwd`, errors)
  const deploymentRoot = normalizeProjectDirectory(raw.deploymentRoot, `${RUNTIME_DATA_CONTRACT_PATH}: deploymentRoot`, errors)
  if (buildCwd !== '.') pushError(errors, `${RUNTIME_DATA_CONTRACT_PATH}: buildCwd must match the root-bound quality runner cwd "."`)
  if (deploymentRoot !== '.') pushError(errors, `${RUNTIME_DATA_CONTRACT_PATH}: deploymentRoot must match the release root "."`)
  const freshnessSloMs = parseDurationMs(raw.freshnessSlo, `${RUNTIME_DATA_CONTRACT_PATH}: freshnessSlo`, errors)
  if (raw.promotionPolicy !== 'reject-invalid') {
    pushError(errors, `${RUNTIME_DATA_CONTRACT_PATH}: promotionPolicy must be reject-invalid`)
  }
  const allowedRefreshCapabilities = new Set(['scheduled', 'manual-recovery', 'on-demand', 'runtime'])
  if (
    !Array.isArray(raw.refreshCapabilities) ||
    raw.refreshCapabilities.length < 1 ||
    raw.refreshCapabilities.length > allowedRefreshCapabilities.size ||
    raw.refreshCapabilities.some(capability => !allowedRefreshCapabilities.has(capability)) ||
    new Set(raw.refreshCapabilities).size !== raw.refreshCapabilities.length
  ) {
    pushError(errors, `${RUNTIME_DATA_CONTRACT_PATH}: refreshCapabilities must contain unique supported capabilities`)
  }
  if (!['last-known-good', 'unavailable'].includes(raw.servingFallback)) {
    pushError(errors, `${RUNTIME_DATA_CONTRACT_PATH}: servingFallback must be last-known-good or unavailable`)
  }
  if (Array.isArray(raw.refreshCapabilities) && raw.refreshCapabilities.includes('scheduled') && !raw.refreshCapabilities.includes('manual-recovery')) {
    pushError(errors, `${RUNTIME_DATA_CONTRACT_PATH}: scheduled refresh requires manual-recovery`)
  }
  if (!Array.isArray(raw.generatedArtifacts) || raw.generatedArtifacts.length > 64) {
    pushError(errors, `${RUNTIME_DATA_CONTRACT_PATH}: generatedArtifacts must be an array with no more than 64 entries`)
  }

  const generatedArtifacts = []
  const artifactPaths = new Set()
  for (const [index, artifact] of (Array.isArray(raw.generatedArtifacts) ? raw.generatedArtifacts : []).entries()) {
    const label = `${RUNTIME_DATA_CONTRACT_PATH}: generatedArtifacts[${index}]`
    if (!exactKeys(artifact, ARTIFACT_KEYS, label, errors)) continue
    const path = normalizeGeneratedDataPath(artifact.path, `${label}.path`, errors)
    if (!path) pushError(errors, `${label}.path must be a safe generated JSON path`)
    else if (artifactPaths.has(path.toLowerCase())) pushError(errors, `${label}.path is duplicated across supported filesystems: ${path}`)
    else artifactPaths.add(path.toLowerCase())
    if (typeof artifact.required !== 'boolean') pushError(errors, `${label}.required must be boolean`)
    if (!Number.isInteger(artifact.minCount) || artifact.minCount < 1 || artifact.minCount > 1_000_000_000) {
      pushError(errors, `${label}.minCount must be an integer between 1 and 1000000000`)
    }
    if (typeof artifact.schema !== 'string' || !artifact.schema || artifact.schema.length > 1024) {
      pushError(errors, `${label}.schema must be a non-empty schema reference`)
    }
    if (artifact.required === true && artifact.schema === BUILTIN_INGESTION_SCHEMA) {
      pushError(errors, `${label}.schema must reference a project JSON Schema for a required artifact`)
    }
    if (artifact.required === true && artifact.validation === undefined) {
      pushError(errors, `${label}: required artifacts must declare validation`)
    }
    const validation = path ? normalizeArtifactValidation(artifact.validation, path, errors) : null
    if (artifact.required === true && validation && validation.diff === null) {
      pushError(errors, `${label}: required artifacts must declare validation.diff`)
    }
    const schema = typeof artifact.schema === 'string'
      ? loadArtifactSchema(projectRoot, artifact.schema, label, errors)
      : null
    if (path && validation && schema) {
      generatedArtifacts.push({
        path,
        required: artifact.required,
        schema: schema.reference,
        minCount: artifact.minCount,
        validation,
        schemaDocument: schema.document,
        schemaSha256: schema.sha256,
        schemaEvidencePath: schema.evidencePath,
      })
    }
  }
  if (['static-snapshot', 'hybrid'].includes(raw.mode) && !generatedArtifacts.some(artifact => artifact.required)) {
    pushError(errors, `${RUNTIME_DATA_CONTRACT_PATH}: ${raw.mode} requires at least one required generated artifact`)
  }
  if (raw.mode === 'live-api' && generatedArtifacts.some(artifact => artifact.required)) {
    pushError(errors, `${RUNTIME_DATA_CONTRACT_PATH}: live-api cannot declare a required generated artifact`)
  }
  for (const artifact of generatedArtifacts) {
    if (artifact.validation.diff && artifactPaths.has(artifact.validation.diff.baselinePath.toLowerCase())) {
      pushError(
        errors,
        `${RUNTIME_DATA_CONTRACT_PATH}: ${artifact.path}.validation.diff.baselinePath cannot be a mutable generated artifact`,
      )
    }
    for (const mutableRoot of mutableArtifactRoots) {
      const normalizedRoot = String(mutableRoot).replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')
      const normalizedRootKey = normalizedRoot.toLowerCase()
      const baselinePathKey = artifact.validation.diff?.baselinePath.toLowerCase()
      if (
        artifact.validation.diff &&
        normalizedRootKey &&
        (baselinePathKey === normalizedRootKey || baselinePathKey.startsWith(`${normalizedRootKey}/`))
      ) {
        pushError(
          errors,
          `${RUNTIME_DATA_CONTRACT_PATH}: ${artifact.path}.validation.diff.baselinePath cannot be inside mutable deployment artifact ${normalizedRoot}`,
        )
      }
    }
  }
  if (errors.length) throw new RuntimeDataContractError(errors)
  return {
    contract: {
      schemaVersion: 1,
      mode: raw.mode,
      authoritativeSource: raw.authoritativeSource.trim(),
      buildCwd,
      deploymentRoot,
      freshnessSlo: raw.freshnessSlo,
      freshnessSloMs,
      promotionPolicy: raw.promotionPolicy,
      servingFallback: raw.servingFallback,
      refreshCapabilities: [...raw.refreshCapabilities],
      generatedArtifacts,
    },
    contractSha256: document.sha256,
    contractSource: document.source,
  }
}

const meaningful = value => value !== null && value !== undefined && (typeof value !== 'string' || value.trim() !== '')
const schemaForEvidence = artifact => ({reference: artifact.schema, sha256: artifact.schemaSha256})
const optionalArtifactIsPresentOrUnsafe = (projectRoot, relativePath) => {
  let current = projectRoot
  const segments = relativePath.split('/')
  for (const [index, segment] of segments.entries()) {
    current = resolve(current, segment)
    try {
      const stats = lstatSync(current)
      if (stats.isSymbolicLink() || (!stats.isDirectory() && index < segments.length - 1)) return true
    } catch (error) {
      if (error?.code === 'ENOENT') return false
      return true
    }
  }
  return true
}

const validateArtifactDocument = ({
  projectRoot,
  artifact,
  freshnessSloMs,
  now,
  errors,
  budget,
}) => {
  const label = `generated artifact ${artifact.path}`
  const document = readJsonProjectFile(projectRoot, artifact.path, label, errors, MAX_ARTIFACT_BYTES)
  if (!document) return null
  budget.bytes += document.source.length
  if (budget.bytes > MAX_TOTAL_ARTIFACT_BYTES) {
    pushError(errors, `${label}: total runtime data exceeds ${MAX_TOTAL_ARTIFACT_BYTES} bytes`)
    return null
  }

  const recordsResult = resolvePointer(document.value, artifact.validation.recordsPointer)
  if (!recordsResult.found || !Array.isArray(recordsResult.value)) {
    pushError(errors, `${label}: recordsPointer ${artifact.validation.recordsPointer} must resolve to an array`)
    return null
  }
  const records = recordsResult.value
  budget.records += records.length
  if (records.length > MAX_ARTIFACT_RECORDS || budget.records > MAX_TOTAL_ARTIFACT_RECORDS) {
    pushError(errors, `${label}: record validation budget exceeded`)
    return null
  }
  validateJsonSchemaValue(document.value, artifact.schemaDocument, artifact.schemaDocument, label, errors)
  const countResult = resolvePointer(document.value, artifact.validation.countPointer)
  if (!countResult.found || !Number.isSafeInteger(countResult.value) || countResult.value < 0) {
    pushError(errors, `${label}: countPointer ${artifact.validation.countPointer} must resolve to a non-negative integer`)
  } else if (countResult.value !== records.length) {
    pushError(errors, `${label}: declared count ${countResult.value} does not match record count ${records.length}`)
  }
  if (records.length < artifact.minCount) {
    pushError(errors, `${label}: record count ${records.length} is below minCount ${artifact.minCount}`)
  }

  const freshnessResult = resolvePointer(document.value, artifact.validation.freshnessPointer)
  let freshnessTimestamp = null
  if (!freshnessResult.found || typeof freshnessResult.value !== 'string' || !validDateTime(freshnessResult.value)) {
    pushError(errors, `${label}: freshnessPointer ${artifact.validation.freshnessPointer} must resolve to an ISO date-time with timezone`)
  } else {
    freshnessTimestamp = freshnessResult.value
    const timestamp = Date.parse(freshnessTimestamp)
    if (timestamp > now + FUTURE_TIMESTAMP_TOLERANCE_MS) pushError(errors, `${label}: freshness timestamp is more than five minutes in the future`)
    if (now - timestamp > freshnessSloMs) pushError(errors, `${label}: freshness timestamp exceeds ${freshnessSloMs}ms SLO`)
  }

  const fieldRatios = {}
  for (const pointer of artifact.validation.coverage.requiredFields) {
    const present = records.filter(record => {
      const observed = resolvePointer(record, pointer)
      return observed.found && meaningful(observed.value)
    }).length
    const observedRatio = records.length === 0 ? 0 : present / records.length
    fieldRatios[pointer] = observedRatio
    if (observedRatio < artifact.validation.coverage.minimumFieldRatio) {
      pushError(errors, `${label}: field coverage ${pointer} is ${observedRatio}, below ${artifact.validation.coverage.minimumFieldRatio}`)
    }
  }
  let coverageMetric = null
  if (artifact.validation.coverage.metricPointer !== null) {
    const metricResult = resolvePointer(document.value, artifact.validation.coverage.metricPointer)
    if (
      !metricResult.found ||
      typeof metricResult.value !== 'number' ||
      !Number.isFinite(metricResult.value) ||
      metricResult.value < 0 ||
      metricResult.value > 1
    ) {
      pushError(errors, `${label}: coverage metric must be a finite ratio between 0 and 1`)
    } else {
      coverageMetric = metricResult.value
      if (coverageMetric < artifact.validation.coverage.minimumMetric) {
        pushError(errors, `${label}: coverage metric ${coverageMetric} is below ${artifact.validation.coverage.minimumMetric}`)
      }
    }
  }

  const keys = records.map((record, index) => {
    const parts = artifact.validation.duplicates.keyPointers.map(pointer => {
      const observed = resolvePointer(record, pointer)
      if (!observed.found || !meaningful(observed.value) || (isObject(observed.value) || Array.isArray(observed.value))) {
        pushError(errors, `${label}: duplicate key ${pointer} is missing or non-scalar at record ${index}`)
        return {missing: true, pointer}
      }
      return observed.value
    })
    return stableJson(parts)
  })
  const duplicateCount = records.length - new Set(keys).size
  const duplicateRatio = records.length === 0 ? 0 : duplicateCount / records.length
  if (duplicateRatio > artifact.validation.duplicates.maximumRatio) {
    pushError(errors, `${label}: duplicate ratio ${duplicateRatio} exceeds ${artifact.validation.duplicates.maximumRatio}`)
  }

  let diff = null
  let baselineEvidence = null
  if (artifact.validation.diff) {
    const baseline = readJsonProjectFile(
      projectRoot,
      artifact.validation.diff.baselinePath,
      `${label} baseline`,
      errors,
      MAX_ARTIFACT_BYTES,
    )
    if (baseline) {
      budget.bytes += baseline.source.length
      const baselineRecordsResult = resolvePointer(baseline.value, artifact.validation.recordsPointer)
      const baselineCountResult = resolvePointer(baseline.value, artifact.validation.countPointer)
      if (!baselineRecordsResult.found || !Array.isArray(baselineRecordsResult.value)) {
        pushError(errors, `${label} baseline: recordsPointer must resolve to an array`)
      } else if (
        baselineRecordsResult.value.length > MAX_ARTIFACT_RECORDS ||
        budget.records + baselineRecordsResult.value.length > MAX_TOTAL_ARTIFACT_RECORDS ||
        budget.bytes > MAX_TOTAL_ARTIFACT_BYTES
      ) {
        pushError(errors, `${label} baseline: runtime data validation budget exceeded`)
      } else if (!baselineCountResult.found || !Number.isSafeInteger(baselineCountResult.value) || baselineCountResult.value !== baselineRecordsResult.value.length) {
        pushError(errors, `${label} baseline: countPointer must match baseline record count`)
      } else {
        budget.records += baselineRecordsResult.value.length
        validateJsonSchemaValue(baseline.value, artifact.schemaDocument, artifact.schemaDocument, `${label} baseline`, errors)
        const baselineCount = baselineRecordsResult.value.length
        if (baselineCount < artifact.minCount) {
          pushError(errors, `${label} baseline: record count ${baselineCount} is below minCount ${artifact.minCount}`)
        }
        const countDropRatio = baselineCount === 0 ? 0 : Math.max(0, (baselineCount - records.length) / baselineCount)
        if (countDropRatio > artifact.validation.diff.maximumCountDropRatio) {
          pushError(errors, `${label}: count drop ratio ${countDropRatio} exceeds ${artifact.validation.diff.maximumCountDropRatio}`)
        }
        diff = {
          baselinePath: artifact.validation.diff.baselinePath,
          baselineSha256: baseline.sha256,
          baselineCount,
          maximumCountDropRatio: artifact.validation.diff.maximumCountDropRatio,
          countDropRatio,
        }
      }
      baselineEvidence = {path: artifact.validation.diff.baselinePath, sha256: baseline.sha256}
    }
  }

  return {
    evidence: {path: artifact.path, sha256: document.sha256},
    baselineEvidence,
    summary: {
      path: artifact.path,
      sha256: document.sha256,
      schema: schemaForEvidence(artifact),
      count: records.length,
      minCount: artifact.minCount,
      countPointer: artifact.validation.countPointer,
      recordsPointer: artifact.validation.recordsPointer,
      freshness: {
        pointer: artifact.validation.freshnessPointer,
        timestamp: freshnessTimestamp,
        sloMs: freshnessSloMs,
      },
      coverage: {
        requiredFields: artifact.validation.coverage.requiredFields,
        minimumFieldRatio: artifact.validation.coverage.minimumFieldRatio,
        fieldRatios,
        metricPointer: artifact.validation.coverage.metricPointer,
        minimumMetric: artifact.validation.coverage.minimumMetric,
        metric: coverageMetric,
      },
      duplicates: {
        keyPointers: artifact.validation.duplicates.keyPointers,
        maximumRatio: artifact.validation.duplicates.maximumRatio,
        duplicateCount,
        duplicateRatio,
      },
      diff,
    },
  }
}

export const validateRuntimeDataArtifacts = (projectPath, {now = Date.now(), mutableArtifactRoots = []} = {}) => {
  const projectRoot = resolve(projectPath)
  const errors = []
  let parsed
  try {
    parsed = readRuntimeDataContract(projectRoot, {mutableArtifactRoots})
  } catch (error) {
    const contractErrors = error instanceof RuntimeDataContractError ? error.errors : [error instanceof Error ? error.message : String(error)]
    return {
      ok: false,
      errors: contractErrors,
      evidence: {schemaVersion: 1, contractSha256: null, artifacts: []},
      evidenceFiles: [],
    }
  }
  const summaries = []
  const evidenceFiles = [{path: RUNTIME_DATA_CONTRACT_PATH, sha256: parsed.contractSha256}]
  const budget = {bytes: 0, records: 0}
  if (parsed.contract.mode !== 'static-snapshot') {
    pushError(
      errors,
      `${RUNTIME_DATA_CONTRACT_PATH}: ${parsed.contract.mode} release validation is blocked until live-source machine evidence is supported`,
    )
  }
  for (const artifact of parsed.contract.generatedArtifacts) {
    if (!artifact.required && !optionalArtifactIsPresentOrUnsafe(projectRoot, artifact.path)) continue
    if (artifact.schemaEvidencePath) evidenceFiles.push({path: artifact.schemaEvidencePath, sha256: artifact.schemaSha256})
    const result = validateArtifactDocument({
      projectRoot,
      artifact,
      freshnessSloMs: parsed.contract.freshnessSloMs,
      now,
      errors,
      budget,
    })
    if (result) {
      summaries.push(result.summary)
      evidenceFiles.push(result.evidence)
      if (result.baselineEvidence) evidenceFiles.push(result.baselineEvidence)
    }
  }
  const evidence = {
    schemaVersion: 1,
    contractSha256: parsed.contractSha256,
    artifacts: summaries.sort((left, right) => left.path.localeCompare(right.path)),
  }
  return {
    ok: errors.length === 0,
    errors,
    evidence,
    evidenceSha256: sha256(stableJson(evidence)),
    evidenceFiles: [...new Map(evidenceFiles.map(file => [file.path, file])).values()]
      .sort((left, right) => left.path.localeCompare(right.path)),
    contract: parsed.contract,
  }
}

export const ingestionReceiptEvidence = validation => ({
  ...validation.evidence,
  sha256: validation.evidenceSha256 ?? sha256(stableJson(validation.evidence)),
})

export const ingestionEvidenceMatches = (receiptEvidence, validation) => {
  if (!isObject(receiptEvidence)) return false
  const expected = ingestionReceiptEvidence(validation)
  return stableJson(receiptEvidence) === stableJson(expected)
}
