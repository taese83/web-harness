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

// target 신원 선언(manifest identity): 리터럴 부분 문자열만 허용한다 — 정규식을 받으면
// repo 콘텐츠가 프록시에 ReDoS를 주입할 수 있다. 미선언(null)과 형식 오류(error)를
// 구분해 반환한다 — 오류를 미선언으로 강등하면 오타가 검사를 조용히 끈다.
export const parseLiveIdentity = value => {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) return {error: 'INVALID_LIVE_IDENTITY'}
  if (typeof value.titleIncludes !== 'string') return {error: 'INVALID_LIVE_IDENTITY'}
  const titleIncludes = value.titleIncludes.trim()
  if (!titleIncludes || titleIncludes.length > 200) return {error: 'INVALID_LIVE_IDENTITY'}
  return {titleIncludes}
}

export const extractHtmlTitle = html => {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html ?? ''))
  if (!match) return null
  return match[1].replace(/\s+/g, ' ').trim()
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, character => (
  {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]
))

const identityBlockPage = ({code, expected, actualTitle, targetOrigin}) => `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>Web Harness live target check</title></head>
<body style="font-family: system-ui, sans-serif; margin: 24px; max-width: 640px; color: #7f1d1d;" data-wh-error="${escapeHtml(code)}">
<h1 style="font-size: 17px;">${code === 'INVALID_LIVE_IDENTITY' ? '라이브 베이스 표시 차단 — identity 선언이 유효하지 않습니다' : '라이브 베이스 표시 차단 — 대상 포트의 앱이 이 프로젝트가 아닙니다'}</h1>
${code === 'INVALID_LIVE_IDENTITY'
    ? '<p>preview/manifest.json의 <code>identity.titleIncludes</code>는 1~200자 문자열이어야 합니다. 선언을 고치면 다음 로드에서 자동으로 회복됩니다.</p>'
    : `<p>${escapeHtml(targetOrigin)}의 응답 제목이 선언된 신원과 일치하지 않아 표시하지 않습니다.</p>
<p>기대 제목 포함: <code>${escapeHtml(expected ?? '')}</code> — 실제: ${actualTitle ? `<code>${escapeHtml(actualTitle)}</code>` : '(제목 없음)'}.</p>
<p>다른 프로젝트의 dev server가 이 포트를 점유했을 수 있습니다. 올바른 앱을 이 포트에서 시작하거나, 정당한 제목 변경이라면 manifest의 identity.titleIncludes를 갱신하세요.</p>`}
</body></html>
`

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

export const createLiveBasePreviewServer = ({target, deltaRoot, streamDeltaFile, readIdentity}) => {
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
        // target 신원 대조는 HTML 응답마다 수행한다 — 프록시 생성 시 1회 검사로는 이후
        // 포트를 점유한 다른 앱(실측 오표시 사건 2026-08-19)을 잡지 못한다. 선언은 요청
        // 시점에 다시 읽으므로(readIdentity) manifest를 고치면 재시작 없이 회복된다.
        // 선언된 신원과 불일치하면 바탕 앱 HTML을 표시하지 않는다(fail-closed) — 제목
        // 미검출도 차단이다. 비-HTML 경로는 미검사(protected-core §4 등록 한계).
        const identity = readIdentity?.() ?? null
        if (identity) {
          const actualTitle = extractHtmlTitle(body)
          const code = identity.error
            ? 'INVALID_LIVE_IDENTITY'
            : actualTitle !== null && actualTitle.includes(identity.titleIncludes) ? null : 'LIVE_TARGET_IDENTITY_MISMATCH'
          if (code) {
            response.writeHead(502, {
              'content-type': 'text/html; charset=utf-8',
              'cache-control': 'no-store',
              'x-content-type-options': 'nosniff',
              'x-web-harness-live-identity': identity.error ? 'invalid' : 'mismatch',
            })
            return response.end(identityBlockPage({code, expected: identity.titleIncludes ?? null, actualTitle, targetOrigin: target.origin}))
          }
        }
        const injected = injectDeltaScript(body)
        const responseHeaders = {
          ...upstreamResponse.headers,
          'content-length': Buffer.byteLength(injected),
          'x-web-harness-live-identity': identity ? 'verified' : 'unverified',
        }
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
