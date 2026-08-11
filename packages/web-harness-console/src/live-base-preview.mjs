import {createServer, request as httpRequest} from 'node:http'
import {connect} from 'node:net'
import {lstatSync, realpathSync} from 'node:fs'
import {join, sep} from 'node:path'

// 브라운필드 delta 프리뷰(파일럿): 실행 중인 기존 dev server를 바탕으로 프록시하면서
// HTML 응답에 delta bootstrap 스크립트를 주입한다. 기존 서비스 코드는 수정하지 않고,
// delta 산출물은 `_workspace/02_design/preview/delta/`에서만 서빙한다.
// target은 loopback으로 제한한다 — 콘솔의 로컬 전용 보안 경계를 유지한다.

const LOOPBACK_TARGET = /^http:\/\/(?:127\.0\.0\.1|localhost):(\d{2,5})$/
const DELTA_PREFIX = '/__wh_delta__/'
const DELTA_SCRIPT_TAG = `<script type="module" src="${DELTA_PREFIX}bootstrap.mjs"></script>`
const MAX_HTML_BYTES = 8 * 1024 * 1024

export const parseLiveBaseTarget = value => {
  const match = LOOPBACK_TARGET.exec(String(value ?? '').replace(/\/+$/, ''))
  if (!match) return null
  const port = Number(match[1])
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return {host: '127.0.0.1', port, origin: `http://127.0.0.1:${port}`}
}

export const injectDeltaScript = html => {
  if (html.includes('</head>')) return html.replace('</head>', `${DELTA_SCRIPT_TAG}\n</head>`)
  if (html.includes('</body>')) return html.replace('</body>', `${DELTA_SCRIPT_TAG}\n</body>`)
  return `${html}\n${DELTA_SCRIPT_TAG}`
}

const isAllowedHost = (host, port) => new Set([`127.0.0.1:${port}`, `localhost:${port}`]).has(host)

const safeDeltaFile = (deltaRoot, pathname) => {
  let root
  try {
    root = realpathSync(deltaRoot)
  } catch {
    return null
  }
  let candidate
  try {
    candidate = realpathSync(join(root, pathname))
  } catch {
    return null
  }
  if (candidate !== root && !candidate.startsWith(root + sep)) return null
  try {
    const stat = lstatSync(candidate)
    if (!stat.isFile() || stat.isSymbolicLink()) return null
  } catch {
    return null
  }
  return candidate
}

export const createLiveBasePreviewServer = ({target, deltaRoot, streamDeltaFile}) => {
  let boundPort = 0
  const server = createServer((request, response) => {
    if (!isAllowedHost(request.headers.host, boundPort)) {
      response.writeHead(403, {'content-type': 'application/json; charset=utf-8'})
      return response.end('{"error":{"code":"HOST_NOT_ALLOWED"}}\n')
    }
    let pathname
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)
    } catch {
      response.writeHead(400, {'content-type': 'application/json; charset=utf-8'})
      return response.end('{"error":{"code":"BAD_URL"}}\n')
    }
    if (pathname.startsWith(DELTA_PREFIX)) {
      const file = safeDeltaFile(deltaRoot, pathname.slice(DELTA_PREFIX.length))
      if (!file) {
        response.writeHead(404, {'content-type': 'application/json; charset=utf-8'})
        return response.end('{"error":{"code":"DELTA_ASSET_NOT_FOUND"}}\n')
      }
      return streamDeltaFile(request, response, file)
    }
    const headers = {...request.headers, host: `${target.host}:${target.port}`, 'accept-encoding': 'identity'}
    const upstream = httpRequest({host: target.host, port: target.port, method: request.method, path: request.url, headers}, upstreamResponse => {
      const contentType = upstreamResponse.headers['content-type'] ?? ''
      if (!contentType.includes('text/html')) {
        response.writeHead(upstreamResponse.statusCode, upstreamResponse.headers)
        return upstreamResponse.pipe(response)
      }
      let body = ''
      upstreamResponse.setEncoding('utf8')
      upstreamResponse.on('data', chunk => {
        if (body.length < MAX_HTML_BYTES) body += chunk
      })
      upstreamResponse.on('end', () => {
        const injected = injectDeltaScript(body)
        const responseHeaders = {...upstreamResponse.headers, 'content-length': Buffer.byteLength(injected)}
        delete responseHeaders['transfer-encoding']
        delete responseHeaders['content-encoding']
        response.writeHead(upstreamResponse.statusCode, responseHeaders)
        response.end(injected)
      })
    })
    upstream.on('error', () => {
      if (!response.headersSent) {
        response.writeHead(502, {'content-type': 'application/json; charset=utf-8'})
        response.end('{"error":{"code":"LIVE_BASE_UNREACHABLE","message":"base dev server is not responding"}}\n')
      } else {
        response.destroy()
      }
    })
    request.pipe(upstream)
  })

  // dev server HMR 웹소켓을 원시 TCP 패스스루로 중계한다.
  // WebSocket은 SOP/CORS 보호가 없으므로 HTTP 경로와 동일한 Host 검증을 강제한다.
  server.on('upgrade', (request, socket, head) => {
    if (!isAllowedHost(request.headers.host, boundPort)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nconnection: close\r\n\r\n')
      return socket.destroy()
    }
    const upstream = connect(target.port, target.host, () => {
      const lines = [`${request.method} ${request.url} HTTP/1.1`]
      for (let index = 0; index < request.rawHeaders.length; index += 2) {
        const name = request.rawHeaders[index]
        const value = name.toLowerCase() === 'host' ? `${target.host}:${target.port}` : request.rawHeaders[index + 1]
        lines.push(`${name}: ${value}`)
      }
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`)
      if (head?.length) upstream.write(head)
      socket.pipe(upstream)
      upstream.pipe(socket)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
  })

  server.on('listening', () => {
    boundPort = server.address().port
  })
  return server
}
