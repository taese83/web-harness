import assert from 'node:assert/strict'
import {createServer, request as httpRequest} from 'node:http'
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {connect} from 'node:net'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {createLiveBasePreviewServer, extractHtmlTitle, injectDeltaScript, parseLiveBaseTarget, parseLiveIdentity} from '../src/live-base-preview.mjs'

test('live-base target accepts loopback http origins only', () => {
  assert.deepEqual(parseLiveBaseTarget('http://127.0.0.1:8080'), {host: '127.0.0.1', port: 8080, origin: 'http://127.0.0.1:8080'})
  assert.equal(parseLiveBaseTarget('http://localhost:3000/').port, 3000)
  assert.equal(parseLiveBaseTarget('http://10.0.0.5:8080'), null)
  assert.equal(parseLiveBaseTarget('https://127.0.0.1:8080'), null)
  assert.equal(parseLiveBaseTarget('http://evil.example:8080'), null)
})

test('live identity declarations parse strictly and titles extract normalized', () => {
  // 미선언(null)과 형식 오류(error)는 구분된다 — 오류를 미선언으로 강등하면 오타가
  // 신원 검사를 조용히 끈다.
  assert.equal(parseLiveIdentity(undefined), null)
  assert.equal(parseLiveIdentity(null), null)
  assert.deepEqual(parseLiveIdentity({titleIncludes: ' Tart Web '}), {titleIncludes: 'Tart Web'})
  assert.equal(parseLiveIdentity({}).error, 'INVALID_LIVE_IDENTITY')
  assert.equal(parseLiveIdentity({titleIncludes: ''}).error, 'INVALID_LIVE_IDENTITY')
  assert.equal(parseLiveIdentity({titleIncludes: 123}).error, 'INVALID_LIVE_IDENTITY')
  assert.equal(parseLiveIdentity({titleInclude: 'typo-key'}).error, 'INVALID_LIVE_IDENTITY')
  assert.equal(parseLiveIdentity('Tart Web').error, 'INVALID_LIVE_IDENTITY')
  assert.equal(parseLiveIdentity({titleIncludes: 'x'.repeat(201)}).error, 'INVALID_LIVE_IDENTITY')

  assert.equal(extractHtmlTitle('<html><head><title>\n  Tamiya\n  Motor Lab </title></head></html>'), 'Tamiya Motor Lab')
  assert.equal(extractHtmlTitle('<TITLE data-x="1">App</TITLE>'), 'App')
  assert.equal(extractHtmlTitle('<html><body>no title</body></html>'), null)
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

  // 신원 미선언(readIdentity 자체가 없음) — 하위호환 패스스루이되 unverified를 정직 노출.
  const rootResponse = await fetch(`http://127.0.0.1:${livePort}/`)
  assert.equal(rootResponse.headers.get('x-web-harness-live-identity'), 'unverified')

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

test('live-base proxy blocks HTML from a target that fails the declared identity check', async t => {
  // 오표시 재현→차단 회귀(실측 사건 2026-08-19): manifest target 포트를 다른 프로젝트의
  // dev server가 점유하면, 신원 대조 전에는 그 앱이 이 프로젝트의 라이브 프리뷰로 표시됐다.
  const base = createServer((request, response) => {
    if (request.url === '/asset.js') {
      response.writeHead(200, {'content-type': 'text/javascript'})
      return response.end('console.log("asset untouched")')
    }
    response.writeHead(200, {'content-type': 'text/html; charset=utf-8'})
    response.end('<html><head><title>Tamiya Motor Lab</title></head><body><div id="app">foreign app</div></body></html>')
  })
  await new Promise(resolveListen => base.listen(0, '127.0.0.1', resolveListen))

  const projectRoot = mkdtempSync(join(tmpdir(), 'web-harness-live-identity-'))
  const deltaRoot = join(projectRoot, '_workspace', '02_design', 'preview', 'delta')
  mkdirSync(deltaRoot, {recursive: true})

  // readIdentity는 요청 시점마다 호출된다 — 선언을 바꾸면 재시작 없이 판정이 바뀌어야 한다.
  let identity = {titleIncludes: 'Tart Web'}
  const live = createLiveBasePreviewServer({
    target: parseLiveBaseTarget(`http://127.0.0.1:${base.address().port}`),
    deltaRoot,
    streamDeltaFile: (_request, response) => response.end('unused'),
    readIdentity: () => identity,
  })
  await new Promise(resolveListen => live.listen(0, '127.0.0.1', resolveListen))
  const origin = `http://127.0.0.1:${live.address().port}`
  t.after(async () => {
    await new Promise(resolveClose => live.close(() => resolveClose()))
    await new Promise(resolveClose => base.close(() => resolveClose()))
    rmSync(projectRoot, {recursive: true, force: true})
  })

  // 불일치: 바탕 앱 HTML을 표시하지 않고, bootstrap도 주입하지 않는다(fail-closed).
  const blocked = await fetch(`${origin}/`)
  assert.equal(blocked.status, 502)
  assert.equal(blocked.headers.get('x-web-harness-live-identity'), 'mismatch')
  const blockedBody = await blocked.text()
  assert.match(blockedBody, /LIVE_TARGET_IDENTITY_MISMATCH/)
  assert.match(blockedBody, /Tamiya Motor Lab/)
  assert.doesNotMatch(blockedBody, /foreign app/)
  assert.doesNotMatch(blockedBody, /__wh_delta__\/bootstrap\.mjs/)

  // 비-HTML 경로는 미검사 패스스루 — protected-core §4 등록 한계를 회귀로 고정한다.
  assert.equal(await fetch(`${origin}/asset.js`).then(response => response.text()), 'console.log("asset untouched")')

  // 일치: 표시 + 주입 + verified 노출.
  identity = {titleIncludes: 'Motor Lab'}
  const verified = await fetch(`${origin}/`)
  assert.equal(verified.status, 200)
  assert.equal(verified.headers.get('x-web-harness-live-identity'), 'verified')
  const verifiedBody = await verified.text()
  assert.match(verifiedBody, /foreign app/)
  assert.match(verifiedBody, /__wh_delta__\/bootstrap\.mjs/)

  // 선언 형식 오류: 미선언으로 강등하지 않고 차단한다(loud fail).
  identity = {error: 'INVALID_LIVE_IDENTITY'}
  const invalid = await fetch(`${origin}/`)
  assert.equal(invalid.status, 502)
  assert.equal(invalid.headers.get('x-web-harness-live-identity'), 'invalid')
  assert.match(await invalid.text(), /INVALID_LIVE_IDENTITY/)

  // 미선언(null): 패스스루 + unverified 정직 노출(하위호환 킷 경고의 근거).
  identity = null
  const undeclared = await fetch(`${origin}/`)
  assert.equal(undeclared.status, 200)
  assert.equal(undeclared.headers.get('x-web-harness-live-identity'), 'unverified')
  assert.match(await undeclared.text(), /foreign app/)
})
