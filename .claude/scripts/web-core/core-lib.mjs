import {readFileSync} from 'node:fs'

export class WebCoreError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'WebCoreError'
    this.code = code
    this.details = details
  }
}

export const isPlainObject = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export const sortedUnique = values => [...new Set(values)].sort((left, right) => left.localeCompare(right))

const stableValue = value => {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!isPlainObject(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map(key => [key, stableValue(value[key])]),
  )
}

export const stableStringify = value => `${JSON.stringify(stableValue(value), null, 2)}\n`

export const readJson = path => {
  let source
  try {
    source = readFileSync(path, 'utf8')
  } catch (error) {
    throw new WebCoreError('JSON_READ_FAILED', `Cannot read JSON file: ${path}`, {cause: error.code ?? 'UNKNOWN'})
  }

  try {
    return JSON.parse(source)
  } catch (error) {
    throw new WebCoreError('JSON_PARSE_FAILED', `Invalid JSON file: ${path}`, {cause: error.message})
  }
}

export const assertKnownKeys = (value, keys, label, errors) => {
  if (!isPlainObject(value)) {
    errors.push(`${label} must be an object`)
    return false
  }
  const allowed = new Set(keys)
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${label} contains unsupported property: ${key}`)
  }
  return true
}

export const parseArgv = (argv, specification) => {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    const rule = specification[name]
    if (!rule) throw new WebCoreError('INVALID_ARGUMENT', `Unknown argument: ${name}`)
    if (rule === 'boolean') {
      result[name.slice(2)] = true
      continue
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new WebCoreError('INVALID_ARGUMENT', `Argument requires a value: ${name}`)
    }
    index += 1
    const key = name.slice(2)
    if (rule === 'repeatable') {
      result[key] = [...(result[key] ?? []), value]
    } else if (result[key] !== undefined) {
      throw new WebCoreError('INVALID_ARGUMENT', `Argument may be provided only once: ${name}`)
    } else {
      result[key] = value
    }
  }
  return result
}

export const runCli = callback => {
  try {
    const result = callback()
    if (result !== undefined) process.stdout.write(stableStringify(result))
  } catch (error) {
    const payload = error instanceof WebCoreError
      ? {ok: false, error: {code: error.code, message: error.message, details: error.details}}
      : {ok: false, error: {code: 'INTERNAL_ERROR', message: error.message}}
    process.stderr.write(stableStringify(payload))
    process.exitCode = 1
  }
}
