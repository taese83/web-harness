import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {resetRateLimits} from '../api/_lib/guard'
import health from '../api/health'
import notes, {resetNotes} from '../api/notes'

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://golden.local/api/notes', {
    method: 'POST',
    headers: {'content-type': 'application/json', ...headers},
    body: JSON.stringify(body),
  })

const auth = {authorization: 'Bearer test-token'}

beforeEach(() => {
  process.env.GOLDEN_API_TOKEN = 'test-token'
  resetRateLimits()
  resetNotes()
})

afterEach(() => {
  delete process.env.GOLDEN_API_TOKEN
})

describe('health', () => {
  it('returns the public health state', async () => {
    const response = await health.fetch(new Request('http://golden.local/api/health'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({status: 'ok'})
  })
})

describe('notes mutation', () => {
  it('fails closed when the auth environment is missing', async () => {
    delete process.env.GOLDEN_API_TOKEN
    const response = await notes.fetch(post({title: 'blocked'}, auth))
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('auth_unconfigured')
  })

  it('creates a structurally filtered note with valid auth', async () => {
    const response = await notes.fetch(post({title: 'golden', ignored: 'drop-me'}, auth))
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({id: 1, title: 'golden'})
  })

  it.each([
    ['missing auth', post({title: 'x'}), 401],
    ['wrong method', new Request('http://golden.local/api/notes'), 405],
    ['invalid schema', post({title: ''}, auth), 400],
    ['oversized body', post({title: 'x'.repeat(2000)}, auth), 413],
  ])('rejects %s', async (_label, request, status) => {
    expect((await notes.fetch(request)).status).toBe(status)
  })

  it('rate limits the mutation before another paid-style operation can run', async () => {
    for (let index = 0; index < 5; index += 1) {
      expect((await notes.fetch(post({title: `note-${index}`}, auth))).status).toBe(201)
    }
    expect((await notes.fetch(post({title: 'over'}, auth))).status).toBe(429)
  })
})
