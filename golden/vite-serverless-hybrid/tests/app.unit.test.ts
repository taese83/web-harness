import {describe, expect, it} from 'vitest'
import {formatApiStatus} from '../src/App'

describe('client status formatting', () => {
  it('accepts only the expected API status', () => {
    expect(formatApiStatus('ok')).toBe('API: ok')
    expect(formatApiStatus('unexpected')).toBe('API: invalid response')
  })
})
