export type SchemaResult<T> = {ok: true; value: T} | {ok: false; fields: string[]}

export type GuardConfig = {
  methods: readonly string[]
  auth: 'public' | 'bearer'
  maxBodyBytes: number
  schema: ((body: unknown) => SchemaResult<unknown>) | null
  rateLimit: {limit: number; windowMs: number} | null
}

export type WebHandler = (request: Request) => Promise<Response>

const rateBuckets = new Map<string, {count: number; resetAt: number}>()
const encoder = new TextEncoder()

const errorResponse = (status: number, code: string, fields?: string[]): Response =>
  Response.json({error: {code, ...(fields ? {fields} : {})}}, {status})

const clientKey = (request: Request): string =>
  request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
  request.headers.get('x-real-ip') ||
  'unknown'

const readBodyWithinLimit = async (
  request: Request,
  limit: number,
): Promise<{tooLarge: boolean; text: string}> => {
  const declared = request.headers.get('content-length')
  if (declared && /^\d+$/.test(declared) && Number(declared) > limit) {
    return {tooLarge: true, text: ''}
  }
  if (!request.body) return {tooLarge: false, text: ''}

  const chunks: Uint8Array[] = []
  const reader = request.body.getReader()
  let received = 0
  for (;;) {
    const {done, value} = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > limit) {
      await reader.cancel('payload_too_large')
      return {tooLarge: true, text: ''}
    }
    chunks.push(value)
  }
  const joined = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return {tooLarge: false, text: new TextDecoder().decode(joined)}
}

export const resetRateLimits = (): void => rateBuckets.clear()

export const withGuards = (
  config: GuardConfig,
  handler: (request: Request, body: unknown) => Promise<Response> | Response,
): WebHandler => async request => {
  if (!config.methods.includes(request.method)) return errorResponse(405, 'method_not_allowed')

  if (config.auth === 'bearer') {
    const expected = process.env.GOLDEN_API_TOKEN
    if (!expected) return errorResponse(503, 'auth_unconfigured')
    const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!supplied || supplied !== expected) return errorResponse(401, 'unauthorized')
  }

  if (config.rateLimit) {
    const key = `${clientKey(request)}:${new URL(request.url).pathname}`
    const now = Date.now()
    const bucket = rateBuckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      rateBuckets.set(key, {count: 1, resetAt: now + config.rateLimit.windowMs})
    } else if (bucket.count >= config.rateLimit.limit) {
      return errorResponse(429, 'rate_limited')
    } else {
      bucket.count += 1
    }
  }

  let body: unknown = null
  if (!['GET', 'HEAD'].includes(request.method)) {
    const raw = await readBodyWithinLimit(request, config.maxBodyBytes)
    if (raw.tooLarge) return errorResponse(413, 'payload_too_large')
    if (config.schema) {
      let parsed: unknown
      try {
        parsed = raw.text ? JSON.parse(raw.text) : null
      } catch {
        return errorResponse(400, 'invalid_json')
      }
      const result = config.schema(parsed)
      if (!result.ok) return errorResponse(400, 'validation_failed', result.fields)
      body = result.value
    }
  }

  return handler(request, body)
}

export const utf8Bytes = (value: string): number => encoder.encode(value).byteLength
