#!/usr/bin/env node
// 디자인 프리뷰 정적 서버 — Phase 2 프리뷰 루프 전용 typed control-plane script.
//
// `_workspace/02_design/preview/`만 read-only로 localhost에 서빙한다.
//   - 쓰기 없음, 디렉토리 목록 없음, preview 밖 경로 접근은 realpath로 차단
//   - localhost 바인딩 고정 (외부 노출 금지)
//   - idle timeout 후 자동 종료 (버려진 서버 방지)
//
// 사용법: node .claude/scripts/preview-server.mjs --project <root> [--port 4173] [--idle-minutes 30]
// 서브에이전트는 서버를 띄우지 않는다 — 오케스트레이터(main)가 실행하고 사용자에게 URL을 안내한다.

import {createServer} from 'node:http'
import {existsSync, realpathSync, statSync, createReadStream} from 'node:fs'
import {extname, join, resolve, sep} from 'node:path'
import {inspectDesignPreview} from './design-preview-status-lib.mjs'

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
}

const parseArguments = argv => {
  const values = {port: 4173, idleMinutes: 30, project: null}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (key === '--project') values.project = value
    else if (key === '--port') values.port = Number(value)
    else if (key === '--idle-minutes') values.idleMinutes = Number(value)
    else {
      process.stderr.write(`Unknown argument: ${key}\n`)
      process.exit(2)
    }
  }
  if (!values.project || !Number.isInteger(values.port) || values.port < 1024 || values.port > 65535) {
    process.stderr.write('Usage: node .claude/scripts/preview-server.mjs --project <root> [--port 4173] [--idle-minutes 30]\n')
    process.exit(2)
  }
  if (!Number.isFinite(values.idleMinutes) || values.idleMinutes < 1 || values.idleMinutes > 480) {
    process.stderr.write('--idle-minutes must be between 1 and 480.\n')
    process.exit(2)
  }
  return values
}

const {project, port, idleMinutes} = parseArguments(process.argv.slice(2))
const previewRoot = (() => {
  try {
    return realpathSync(resolve(project, '_workspace', '02_design', 'preview'))
  } catch {
    process.stderr.write('Preview directory does not exist — run design-preview-builder first.\n')
    process.exit(1)
  }
})()

let lastActivity = Date.now()
const server = createServer((request, response) => {
  lastActivity = Date.now()
  const deny = (status, message) => {
    response.writeHead(status, {'content-type': 'text/plain; charset=utf-8'})
    response.end(message)
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return deny(405, 'read-only preview server')
  let pathname
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
  } catch {
    return deny(400, 'bad request')
  }
  if (pathname === '/__web-harness/preview-status') {
    const status = inspectDesignPreview(resolve(project))
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    if (request.method === 'HEAD') return response.end()
    return response.end(`${JSON.stringify(status, null, 2)}\n`)
  }
  if (pathname.endsWith('/')) pathname += 'index.html'
  const candidate = join(previewRoot, pathname)
  let resolved
  try {
    resolved = realpathSync(candidate)
  } catch {
    return deny(404, 'not found')
  }
  if (resolved !== previewRoot && !resolved.startsWith(previewRoot + sep)) return deny(403, 'outside preview root')
  if (!statSync(resolved).isFile()) return deny(404, 'not found')
  response.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(resolved).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  if (request.method === 'HEAD') return response.end()
  createReadStream(resolved).pipe(response)
})

server.listen(port, '127.0.0.1', () => {
  const previewStatus = inspectDesignPreview(resolve(project))
  process.stdout.write(`design preview: http://localhost:${port}/ (root: ${previewRoot})\n`)
  process.stdout.write(`traceability: ${previewStatus.status} (http://localhost:${port}/__web-harness/preview-status)\n`)
  process.stdout.write(`read-only, localhost only, auto-shutdown after ${idleMinutes}m idle — Ctrl+C to stop\n`)
})
server.on('error', error => {
  process.stderr.write(`preview server failed: ${error.message}\n`)
  process.exit(1)
})

const idleCheck = setInterval(() => {
  if (Date.now() - lastActivity > idleMinutes * 60_000) {
    process.stdout.write('idle timeout reached — shutting down preview server\n')
    clearInterval(idleCheck)
    server.close(() => process.exit(0))
  }
}, 30_000)
idleCheck.unref?.()
