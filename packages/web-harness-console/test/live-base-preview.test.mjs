import assert from 'node:assert/strict'
import {createServer, request as httpRequest} from 'node:http'
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {connect} from 'node:net'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {createLiveBasePreviewServer, injectDeltaScript, parseLiveBaseTarget} from '../src/live-base-preview.mjs'

test('live-base target accepts loopback http origins only', () => {
  assert.deepEqual(parseLiveBaseTarget('http://127.0.0.1:8080'), {host: '127.0.0.1', port: 8080, origin: 'http://127.0.0.1:8080'})
  assert.equal(parseLiveBaseTarget('http://localhost:3000/').port, 3000)
  assert.equal(parseLiveBaseTarget('http://10.0.0.5:8080'), null)
  assert.equal(parseLiveBaseTarget('https://127.0.0.1:8080'), null)
  assert.equal(parseLiveBaseTarget('http://evil.example:8080'), null)
})

test('delta script injection prefers head, falls back to body, then appends', () => {
  assert.match(injectDeltaScript('<html><head></head><body></body></html>'), /__wh_delta__\/bootstrap\.mjs"><\/script>\n<\/head>/)
  assert.match(injectDeltaScript('<html><body></body></html>'), /bootstrap\.mjs"><\/script>\n<\/body>/)
  assert.match(injectDeltaScript('plain'), /plain\n<script type="module"/)
})

test('live-base proxy injects into HTML, passes assets through, and serves delta files', async t => {
  const base = createServer((request, response) => {
    if (request.url === '/') {
      response.writeHead(200, {'content-type': 'text/html; charset=utf-8'})
      response.end('<html><head><title>base</title></head><body><div id="app">real app</div></body></html>')
    } else if (request.url === '/asset.js') {
      response.writeHead(200, {'content-type': 'text/javascript'})
      response.end('console.log("asset untouched")')
    } else {
      response.writeHead(404, {'content-type': 'text/plain'})
      response.end('missing')
    }
  })
  await new Promise(resolveListen => base.listen(0, '127.0.0.1', resolveListen))
  const basePort = base.address().port

  const projectRoot = mkdtempSync(join(tmpdir(), 'web-harness-live-base-'))
  const deltaRoot = join(projectRoot, '_workspace', '02_design', 'preview', 'delta')
  mkdirSync(deltaRoot, {recursive: true})
  writeFileSync(join(deltaRoot, 'bootstrap.mjs'), 'console.log("delta")\n')

  const streamDeltaFile = (_request, response, file) => {
    response.writeHead(200, {'content-type': 'text/javascript; charset=utf-8'})
    response.end(`served:${file.endsWith('bootstrap.mjs')}`)
  }
  const live = createLiveBasePreviewServer({
    target: parseLiveBaseTarget(`http://127.0.0.1:${basePort}`),
    deltaRoot,
    streamDeltaFile,
  })
  await new Promise(resolveListen => live.listen(0, '127.0.0.1', resolveListen))
  const livePort = live.address().port
  t.after(async () => {
    await new Promise(resolveClose => live.close(() => resolveClose()))
    await new Promise(resolveClose => base.close(() => resolveClose()))
    rmSync(projectRoot, {recursive: true, force: true})
  })

  const html = await fetch(`http://127.0.0.1:${livePort}/`).then(response => response.text())
  assert.match(html, /real app/)
  assert.match(html, /__wh_delta__\/bootstrap\.mjs/)

  const asset = await fetch(`http://127.0.0.1:${livePort}/asset.js`).then(response => response.text())
  assert.equal(asset, 'console.log("asset untouched")')

  const delta = await fetch(`http://127.0.0.1:${livePort}/__wh_delta__/bootstrap.mjs`).then(response => response.text())
  assert.equal(delta, 'served:true')

  const traversal = await fetch(`http://127.0.0.1:${livePort}/__wh_delta__/../../../secret.md`)
  assert.equal(traversal.status, 404)

  const missing = await fetch(`http://127.0.0.1:${livePort}/nope`)
  assert.equal(missing.status, 404)

  // Host 검증: HTTP 경로 — 비-loopback Host는 403
  const badHostStatus = await new Promise((resolveStatus, rejectStatus) => {
    const probe = httpRequest({host: '127.0.0.1', port: livePort, path: '/', headers: {host: 'evil.example:80'}}, res => {
      res.resume()
      resolveStatus(res.statusCode)
    })
    probe.on('error', rejectStatus)
    probe.end()
  })
  assert.equal(badHostStatus, 403)

  // Host 검증: WebSocket upgrade 경로 — HTTP 경로와 동일하게 거부되어야 한다
  const upgradeResponse = await new Promise((resolveHead, rejectHead) => {
    const socket = connect(livePort, '127.0.0.1', () => {
      socket.write([
        'GET /ws HTTP/1.1',
        'Host: evil.example:80',
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version: 13',
        '', '',
      ].join('\r\n'))
    })
    let head = ''
    socket.on('data', chunk => { head += chunk.toString('utf8') })
    socket.on('close', () => resolveHead(head))
    socket.on('error', rejectHead)
    setTimeout(() => socket.destroy(), 2000)
  })
  assert.match(upgradeResponse, /^HTTP\/1\.1 403 /)
})
