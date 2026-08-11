import {readdirSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import type {GuardConfig, WebHandler} from '../api/_lib/guard'
import * as health from '../api/health'
import * as notes from '../api/notes'

type EndpointModule = {guards: GuardConfig; default: {fetch: WebHandler}}
const endpoints: Array<{name: string; module: EndpointModule}> = [
  {name: 'health.ts', module: health},
  {name: 'notes.ts', module: notes},
]
const apiDirectory = join(dirname(fileURLToPath(import.meta.url)), '../api')

describe('endpoint guard matrix', () => {
  it('registers every public handler under api/', () => {
    const handlers = readdirSync(apiDirectory).filter(name => name.endsWith('.ts')).sort()
    expect(handlers).toEqual(endpoints.map(endpoint => endpoint.name).sort())
  })

  for (const {name, module} of endpoints) {
    describe(name, () => {
      const guard = module.guards

      it('declares all five guard dimensions', () => {
        expect(guard.methods.length).toBeGreaterThan(0)
        expect(['public', 'bearer']).toContain(guard.auth)
        expect(guard.maxBodyBytes).toBeGreaterThanOrEqual(0)
        expect(guard.schema).not.toBeUndefined()
        expect(guard.rateLimit).not.toBeUndefined()
      })

      it('allows null schema/rate limit only for an explicit public read', () => {
        const readOnly = guard.methods.every(method => ['GET', 'HEAD'].includes(method))
        if (guard.schema === null) expect(readOnly).toBe(true)
        if (guard.rateLimit === null) expect(readOnly && guard.auth === 'public').toBe(true)
      })

      it('proves the exported handler is wrapped by the method guard', async () => {
        const response = await module.default.fetch(
          new Request(`http://golden.local/api/${name}`, {method: 'PATCH'}),
        )
        expect(response.status).toBe(405)
      })
    })
  }
})
