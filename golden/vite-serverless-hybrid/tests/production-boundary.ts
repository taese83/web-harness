import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'

const forbidden = [
  'GOLDEN_API_TOKEN',
  'auth_unconfigured',
  'rate_limited',
  'mockServiceWorker',
  'msw/browser',
  'setupWorker',
]

const walk = (directory: string, files: string[] = []): string[] => {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) walk(path, files)
    else if (/\.(?:js|mjs|css|html)$/.test(name)) files.push(path)
  }
  return files
}

describe('production client/server boundary', () => {
  it('keeps server guards, secrets, and mocks out of the SPA artifact', () => {
    expect(existsSync('dist/index.html')).toBe(true)
    const offenders: string[] = []
    for (const file of walk('dist')) {
      const source = readFileSync(file, 'utf8')
      for (const marker of forbidden) {
        if (source.includes(marker)) offenders.push(`${file}: ${marker}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
