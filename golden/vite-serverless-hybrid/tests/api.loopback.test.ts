import {createServer} from 'node:http'
import {afterEach, describe, expect, it} from 'vitest'
import {toWebRequest, writeWebResponse} from '../dev/node-adapter'
import health from '../api/health'

const openServers: Array<ReturnType<typeof createServer>> = []

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    if (!server.listening) return resolve()
    server.close(error => error ? reject(error) : resolve())
  })))
})

describe('loopback health fixture', () => {
  it('serves the real handler through a terminating Node HTTP process boundary', async () => {
    const server = createServer(async (request, response) => {
      await writeWebResponse(await health.fetch(toWebRequest(request)), response)
    })
    openServers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('loopback address unavailable')

    const response = await fetch(`http://127.0.0.1:${address.port}/api/health`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({status: 'ok'})
  })
})
