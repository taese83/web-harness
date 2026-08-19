#!/usr/bin/env node
import {spawn} from 'node:child_process'
import {createReadStream, existsSync, lstatSync, readFileSync, realpathSync, statSync} from 'node:fs'
import {createServer} from 'node:http'
import {dirname, extname, join, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {inspectDesignPreview, recordPreviewApproval} from '../../.claude/scripts/design-preview-status-lib.mjs'
import {recordImplementationVerification} from './src/change-request-implementation.mjs'
import {CodexRunManager} from './src/codex-runs.mjs'
import {EXECUTOR_KINDS, createExecutorAdapter} from './src/executor-adapters.mjs'
import {WorkspaceCatalog} from './src/indexer.mjs'
import {createLiveBasePreviewServer, parseLiveBaseTarget} from './src/live-base-preview.mjs'

const packageRoot = dirname(fileURLToPath(import.meta.url))
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
}

const parseArguments = argv => {
  const values = {root: resolve(packageRoot, '..', '..'), port: 4310, previewPort: 4311, executor: 'auto', impactModel: null, applyModel: null}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (key === '--root') values.root = resolve(value)
    else if (key === '--port') values.port = Number(value)
    else if (key === '--preview-port') values.previewPort = Number(value)
    else if (key === '--executor') values.executor = value
    else if (key === '--impact-model') values.impactModel = value
    else if (key === '--apply-model') values.applyModel = value
    else if (key === '--live-base') values.liveBase = value
    else if (key === '--live-base-root') values.liveBaseRoot = resolve(value)
    else if (key === '--live-base-port') values.liveBasePort = Number(value)
    else throw new Error(`Unknown argument: ${key}`)
  }
  for (const [name, port] of [['port', values.port], ['preview-port', values.previewPort]]) {
    if (!Number.isInteger(port) || port < 0 || port > 65535 || (port > 0 && port < 1024)) throw new Error(`${name} must be 0 or an integer between 1024 and 65535`)
  }
  if (values.port !== 0 && values.port === values.previewPort) throw new Error('console and preview ports must differ')
  if (!EXECUTOR_KINDS.includes(values.executor)) throw new Error(`executor must be one of: ${EXECUTOR_KINDS.join(', ')}`)
  if (values.liveBase || values.liveBaseRoot) {
    if (!parseLiveBaseTarget(values.liveBase)) throw new Error('live-base must be a loopback http URL (http://127.0.0.1:<port>)')
    if (!values.liveBaseRoot) throw new Error('live-base requires --live-base-root <project-root>')
    values.liveBasePort = values.liveBasePort ?? 4312
    if (!Number.isInteger(values.liveBasePort) || values.liveBasePort < 1024 || values.liveBasePort > 65535) throw new Error('live-base-port must be an integer between 1024 and 65535')
  }
  return values
}

const json = (response, status, value, headers = {}) => {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  })
  response.end(`${JSON.stringify(value, null, 2)}\n`)
}

const noContent = response => {
  response.writeHead(204, {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end()
}

const errorBody = (code, message) => ({error: {code, message}})
const MAX_REQUEST_BODY_BYTES = 16 * 1024

const readJsonBody = request => new Promise((resolveBody, rejectBody) => {
  const chunks = []
  let bytes = 0
  let tooLarge = false
  request.on('data', chunk => {
    bytes += chunk.length
    if (bytes > MAX_REQUEST_BODY_BYTES) tooLarge = true
    else chunks.push(chunk)
  })
  request.on('end', () => {
    if (tooLarge) return rejectBody(Object.assign(new Error('Request body is too large'), {code: 'REQUEST_TOO_LARGE', status: 413}))
    try {
      resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    } catch {
      rejectBody(Object.assign(new Error('Request body must be valid JSON'), {code: 'INVALID_JSON', status: 400}))
    }
  })
  request.on('error', () => rejectBody(Object.assign(new Error('Request body could not be read'), {code: 'REQUEST_READ_FAILED', status: 400})))
})

const isAllowedConsoleOrigin = (origin, port) => new Set([
  `http://127.0.0.1:${port}`,
  `http://localhost:${port}`,
]).has(origin)

const isAllowedHost = (host, port) => new Set([
  `127.0.0.1:${port}`,
  `localhost:${port}`,
]).has(host)

const decodePathSegment = value => {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

const safeStaticFile = (root, pathname, fallbackIndex = false) => {
  const requested = fallbackIndex && pathname === '/' ? '/index.html' : pathname
  let candidate
  try {
    candidate = realpathSync(join(root, requested))
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

const streamFile = (request, response, path, headers = {}) => {
  response.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  })
  if (request.method === 'HEAD') return response.end()
  createReadStream(path).pipe(response)
}

export const createConsoleServers = ({repositoryRoot, port = 4310, previewPort = 4311, executorKind = 'auto', executorModels = null, codexRunManager = null, liveBase = null}) => {
  if (!codexRunManager) {
    const adapter = createExecutorAdapter({kind: executorKind})
    codexRunManager = new CodexRunManager({connectionProbe: adapter.probe, executor: adapter.execute, models: executorModels})
  }
  const catalog = new WorkspaceCatalog(repositoryRoot)
  const publicRoot = realpathSync(join(packageRoot, 'public'))
  let boundConsolePort = port
  let boundPreviewPort = previewPort

  const consoleServer = createServer(async (request, response) => {
    // frame-src: 임베드 대상은 전부 loopback(격리 프리뷰 서버·동적 델타 프록시)이고
    // 프록시 포트는 문서 로드 뒤에 배정될 수 있어, 고정 열거식 CSP는 first-load에서
    // 프레임을 막는 구조적 경합이 있다 — loopback 포트 와일드카드로 허용한다.
    // 데이터 신뢰 경계는 frame-src가 아니라 postMessage origin 엄격 검증이 담당한다.
    const frameSources = 'http://127.0.0.1:* http://localhost:*'
    response.setHeader('content-security-policy', `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src ${frameSources}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`)
    response.setHeader('referrer-policy', 'no-referrer')
    response.setHeader('x-frame-options', 'DENY')
    response.setHeader('cross-origin-resource-policy', 'same-origin')
    if (!isAllowedHost(request.headers.host, boundConsolePort)) {
      return json(response, 403, errorBody('HOST_NOT_ALLOWED', 'Console requests must target the loopback host'))
    }
    let url
    try {
      url = new URL(request.url, 'http://127.0.0.1')
    } catch {
      return json(response, 400, errorBody('BAD_URL', 'Invalid URL'))
    }
    const projectDetail = url.pathname.match(/^\/api\/projects\/([^/]+)$/)
    const projectDocument = url.pathname.match(/^\/api\/projects\/([^/]+)\/document$/)
    const projectChangeRequests = url.pathname.match(/^\/api\/projects\/([^/]+)\/change-requests$/)
    const projectChangeRequest = url.pathname.match(/^\/api\/projects\/([^/]+)\/change-requests\/([^/]+)$/)
    const projectChangeRequestRevisions = url.pathname.match(/^\/api\/projects\/([^/]+)\/change-requests\/(CHG-\d{8}-\d{3})\/revisions$/)
    const projectCodexRuns = url.pathname.match(/^\/api\/projects\/([^/]+)\/change-requests\/(CHG-\d{8}-\d{3})\/codex-runs$/)
    const projectReviewDecisions = url.pathname.match(/^\/api\/projects\/([^/]+)\/change-requests\/(CHG-\d{8}-\d{3})\/review-decisions$/)
    const projectImplementationVerifications = url.pathname.match(/^\/api\/projects\/([^/]+)\/change-requests\/(CHG-\d{8}-\d{3})\/implementation-verifications$/)
    const projectPreviewApproval = url.pathname.match(/^\/api\/projects\/([^/]+)\/preview-approval$/)
    if (request.method === 'DELETE' && projectChangeRequest) {
      if (!isAllowedConsoleOrigin(request.headers.origin, boundConsolePort) || request.headers['x-web-harness-intent'] !== 'delete-change-request') {
        return json(response, 403, errorBody('CHANGE_REQUEST_DELETE_FORBIDDEN', 'Change request deletion origin or intent was rejected'))
      }
      if (request.headers['transfer-encoding'] || Number(request.headers['content-length'] ?? 0) > 0) {
        return json(response, 400, errorBody('CHANGE_REQUEST_DELETE_BODY_NOT_ALLOWED', 'Change request deletion does not accept a request body'))
      }
      try {
        const projectId = decodePathSegment(projectChangeRequest[1])
        const changeRequestId = decodePathSegment(projectChangeRequest[2])
        if (projectId === null || changeRequestId === null || !/^CHG-\d{8}-\d{3}$/.test(changeRequestId)) {
          return json(response, 400, errorBody('BAD_URL', 'Invalid Change Request URL'))
        }
        catalog.refresh()
        const project = catalog.project(projectId)
        if (!project) return json(response, 404, errorBody('PROJECT_NOT_FOUND', 'Project was not found'))
        catalog.deleteChangeRequest(projectId, changeRequestId, {codexRuns: codexRunManager.list(project.root)})
        return noContent(response)
      } catch (error) {
        const status = Number.isInteger(error.status) ? error.status : 500
        const code = typeof error.code === 'string' ? error.code : 'CHANGE_REQUEST_DELETE_FAILED'
        const message = status === 500 ? 'Change request could not be deleted' : error.message
        return json(response, status, errorBody(code, message))
      }
    }
    if (request.method === 'POST' && projectPreviewApproval) {
      if (!isAllowedConsoleOrigin(request.headers.origin, boundConsolePort) || request.headers['x-web-harness-intent'] !== 'record-preview-approval') {
        return json(response, 403, errorBody('PREVIEW_APPROVAL_FORBIDDEN', 'Preview approval origin or intent was rejected'))
      }
      if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
        return json(response, 415, errorBody('UNSUPPORTED_MEDIA_TYPE', 'Preview approval requires application/json'))
      }
      try {
        const input = await readJsonBody(request)
        const projectId = decodePathSegment(projectPreviewApproval[1])
        if (projectId === null) return json(response, 400, errorBody('BAD_URL', 'Invalid URL'))
        catalog.refresh()
        const project = catalog.project(projectId)
        if (!project) return json(response, 404, errorBody('PROJECT_NOT_FOUND', 'Project was not found'))
        const approvalText = typeof input.approvalText === 'string' ? input.approvalText.trim() : ''
        if (!approvalText || approvalText.length > 500 || /[\r\n\0]/.test(approvalText)) {
          return json(response, 400, errorBody('APPROVAL_TEXT_INVALID', 'Approval text must be a single non-empty line of at most 500 characters'))
        }
        // 이후 검사·기록은 전부 동기라 이벤트 루프 안에서 원자적이다. 상태 게이트를 digest
        // 형식 검사보다 먼저 둔다 — STALE은 현재 preview digest가 null이라 형식 검사가 먼저
        // 걸리면 상태 문제가 입력 문제(400)로 위장되기 때문이다.
        const current = inspectDesignPreview(project.root)
        const publicApproval = status => ({
          status: status.status,
          reason: status.reason ?? null,
          approval: status.approval ? {
            approvedAt: status.approval.approvedAt,
            recordedVia: status.approval.recordedVia ?? null,
            sourceDigest: status.approval.sourceDigest,
            previewDigest: status.approval.previewDigest,
          } : null,
        })
        if (
          current.status === 'APPROVED'
          && current.approval?.sourceDigest === input.sourceDigest
          && current.approval?.previewDigest === input.previewDigest
          && current.approval?.approvalText === approvalText
        ) {
          return json(response, 200, publicApproval(current))
        }
        if (current.status !== 'UNAPPROVED') {
          return json(response, 409, errorBody('PREVIEW_NOT_APPROVABLE', `Preview status is ${current.status}; Console approval is allowed only for UNAPPROVED previews`))
        }
        const digestPattern = /^[0-9a-f]{64}$/
        if (!digestPattern.test(input.sourceDigest ?? '') || !digestPattern.test(input.previewDigest ?? '')) {
          return json(response, 400, errorBody('PREVIEW_DIGEST_INVALID', 'Preview approval requires the observed 64-character source and preview digests'))
        }
        if (current.source.digest !== input.sourceDigest || current.preview.digest !== input.previewDigest) {
          return json(response, 409, errorBody('PREVIEW_DIGEST_MISMATCH', 'The preview changed since it was reviewed; refresh and confirm the current preview before approving'))
        }
        const result = recordPreviewApproval(project.root, approvalText, {recordedVia: 'console-user-attested'})
        catalog.refresh()
        return json(response, 201, publicApproval(result))
      } catch (error) {
        const status = Number.isInteger(error.status) ? error.status : 500
        const code = typeof error.code === 'string' ? error.code : 'PREVIEW_APPROVAL_FAILED'
        const message = status === 500 ? 'Preview approval could not be recorded' : error.message
        return json(response, status, errorBody(code, message))
      }
    }
    if (request.method === 'POST' && projectImplementationVerifications) {
      if (!isAllowedConsoleOrigin(request.headers.origin, boundConsolePort) || request.headers['x-web-harness-intent'] !== 'record-implementation-verification') {
        return json(response, 403, errorBody('IMPLEMENTATION_FORBIDDEN', 'Implementation verification origin or intent was rejected'))
      }
      if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
        return json(response, 415, errorBody('UNSUPPORTED_MEDIA_TYPE', 'Implementation verifications require application/json'))
      }
      try {
        const input = await readJsonBody(request)
        const projectId = decodePathSegment(projectImplementationVerifications[1])
        if (projectId === null) return json(response, 400, errorBody('BAD_URL', 'Invalid URL'))
        catalog.refresh()
        const project = catalog.project(projectId)
        if (!project) return json(response, 404, errorBody('PROJECT_NOT_FOUND', 'Project was not found'))
        const verificationRequest = project.changeRequests.find(candidate => candidate.id === projectImplementationVerifications[2])
        if (!verificationRequest) return json(response, 404, errorBody('CHANGE_REQUEST_NOT_FOUND', 'Change Request was not found'))
        const result = recordImplementationVerification(project.root, verificationRequest, input, {idempotencyKey: request.headers['idempotency-key']})
        catalog.refresh()
        return json(response, result.created ? 201 : 200, result)
      } catch (error) {
        const status = Number.isInteger(error.status) ? error.status : 500
        const code = typeof error.code === 'string' ? error.code : 'IMPLEMENTATION_VERIFICATION_FAILED'
        const message = status === 500 ? 'Implementation verification could not be recorded' : error.message
        return json(response, status, errorBody(code, message))
      }
    }
    if (request.method === 'POST' && projectReviewDecisions) {
      if (!isAllowedConsoleOrigin(request.headers.origin, boundConsolePort) || request.headers['x-web-harness-intent'] !== 'record-change-review') {
        return json(response, 403, errorBody('REVIEW_DECISION_FORBIDDEN', 'Review decision origin or intent was rejected'))
      }
      if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
        return json(response, 415, errorBody('UNSUPPORTED_MEDIA_TYPE', 'Review decisions require application/json'))
      }
      let candidateReview = null
      try {
        const input = await readJsonBody(request)
        const projectId = decodePathSegment(projectReviewDecisions[1])
        if (projectId === null) return json(response, 400, errorBody('BAD_URL', 'Invalid URL'))
        catalog.refresh()
        const project = catalog.project(projectId)
        if (!project) return json(response, 404, errorBody('PROJECT_NOT_FOUND', 'Project was not found'))
        const changeRequestId = projectReviewDecisions[2]
        const applyRun = codexRunManager.list(project.root).find(run => run.changeRequestId === changeRequestId && run.phase === 'apply') ?? null
        const prepared = catalog.prepareChangeRequestReview(projectId, changeRequestId, input, {
          idempotencyKey: request.headers['idempotency-key'],
          applyRun,
        })
        if (prepared.replay) return json(response, 200, prepared.replay)
        candidateReview = codexRunManager.prepareCandidateReview(project.root, applyRun, input.decision)
        if (input.decision === 'APPROVED' && applyRun?.candidate) catalog.refresh()
        const result = catalog.commitChangeRequestReview(projectId, changeRequestId, prepared.event, {applyRun})
        candidateReview.commit()
        return json(response, 201, result)
      } catch (error) {
        candidateReview?.rollback()
        if (candidateReview) catalog.refresh()
        const status = Number.isInteger(error.status) ? error.status : 500
        const code = typeof error.code === 'string' ? error.code : 'REVIEW_DECISION_FAILED'
        const message = status === 500 ? 'Review decision could not be recorded' : error.message
        return json(response, status, errorBody(code, message))
      }
    }
    if (request.method === 'POST' && projectChangeRequestRevisions) {
      if (!isAllowedConsoleOrigin(request.headers.origin, boundConsolePort) || request.headers['x-web-harness-intent'] !== 'revise-change-request') {
        return json(response, 403, errorBody('CHANGE_REQUEST_REVISION_FORBIDDEN', 'Change request revision origin or intent was rejected'))
      }
      if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
        return json(response, 415, errorBody('UNSUPPORTED_MEDIA_TYPE', 'Change request revisions require application/json'))
      }
      try {
        const input = await readJsonBody(request)
        const projectId = decodePathSegment(projectChangeRequestRevisions[1])
        if (projectId === null) return json(response, 400, errorBody('BAD_URL', 'Invalid URL'))
        catalog.refresh()
        const project = catalog.project(projectId)
        if (!project) return json(response, 404, errorBody('PROJECT_NOT_FOUND', 'Project was not found'))
        const result = catalog.reviseChangeRequest(projectId, projectChangeRequestRevisions[2], input, {
          idempotencyKey: request.headers['idempotency-key'],
          codexRuns: codexRunManager.list(project.root),
        })
        return json(response, result.created ? 201 : 200, result)
      } catch (error) {
        const status = Number.isInteger(error.status) ? error.status : 500
        const code = typeof error.code === 'string' ? error.code : 'CHANGE_REQUEST_REVISION_FAILED'
        const message = status === 500 ? 'Change request revision could not be recorded' : error.message
        return json(response, status, errorBody(code, message))
      }
    }
    if (request.method === 'POST' && projectCodexRuns) {
      if (!isAllowedConsoleOrigin(request.headers.origin, boundConsolePort) || request.headers['x-web-harness-intent'] !== 'start-codex-run') {
        return json(response, 403, errorBody('CODEX_RUN_FORBIDDEN', 'Codex run origin or intent was rejected'))
      }
      if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
        return json(response, 415, errorBody('UNSUPPORTED_MEDIA_TYPE', 'Codex runs require application/json'))
      }
      try {
        const input = await readJsonBody(request)
        const codexProjectId = decodePathSegment(projectCodexRuns[1])
        if (codexProjectId === null) return json(response, 400, errorBody('BAD_URL', 'Invalid URL'))
        const project = catalog.project(codexProjectId)
        if (!project) return json(response, 404, errorBody('PROJECT_NOT_FOUND', 'Project was not found'))
        const result = codexRunManager.start(project, projectCodexRuns[2], input, {idempotencyKey: request.headers['idempotency-key']})
        return json(response, result.cacheHit ? 200 : result.created ? 202 : 200, result)
      } catch (error) {
        const status = Number.isInteger(error.status) ? error.status : 500
        const code = typeof error.code === 'string' ? error.code : 'CODEX_RUN_FAILED'
        const message = status === 500 ? 'Codex run could not be started' : error.message
        return json(response, status, errorBody(code, message))
      }
    }
    if (request.method === 'POST' && (url.pathname === '/api/live-base/start' || url.pathname === '/api/live-base/stop')) {
      const action = url.pathname.endsWith('/start') ? 'start' : 'stop'
      if (!isAllowedConsoleOrigin(request.headers.origin, boundConsolePort) || request.headers['x-web-harness-intent'] !== `${action}-live-base`) {
        return json(response, 403, errorBody('LIVE_BASE_FORBIDDEN', 'Live-base control origin or intent was rejected'))
      }
      if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
        return json(response, 415, errorBody('UNSUPPORTED_MEDIA_TYPE', 'Live-base control requires application/json'))
      }
      try {
        const input = await readJsonBody(request)
        const controlProject = catalog.project(String(input?.project ?? ''))
        const manifest = controlProject ? readDeltaManifest(controlProject.root) : null
        const target = manifest ? parseLiveBaseTarget(manifest.target) : null
        if (!target) return json(response, 404, errorBody('LIVE_TARGET_NOT_FOUND', 'Project has no valid live-delta target'))
        if (action === 'stop') {
          const managed = liveBaseProcesses.get(target.port)
          if (!managed?.child) return json(response, 409, errorBody('NOT_CONSOLE_MANAGED', 'Target process was not started by this console'))
          // 실제 종료를 확인하고 응답한다 — SIGTERM 미종료 시 SIGKILL 에스컬레이션(리뷰 반영).
          const waitExit = ms => new Promise(resolveExit => {
            if (managed.child.exitCode !== null || managed.child.signalCode !== null) return resolveExit(true)
            const timer = setTimeout(() => resolveExit(false), ms)
            managed.child.once('exit', () => { clearTimeout(timer); resolveExit(true) })
          })
          managed.child.kill('SIGTERM')
          let exited = await waitExit(3000)
          let escalated = false
          if (!exited) {
            escalated = true
            managed.child.kill('SIGKILL')
            exited = await waitExit(2000)
          }
          liveBaseProcesses.delete(target.port)
          return json(response, 200, {stopped: exited, escalated, entry: managed.entry, port: target.port})
        }
        const entry = readLaunchEntry(String(input?.entry ?? ''))
        if (!entry) return json(response, 404, errorBody('LAUNCH_ENTRY_NOT_FOUND', 'launch.json entry was not found'))
        if (String(entry.port) !== String(target.port)) {
          return json(response, 403, errorBody('ENTRY_PORT_MISMATCH', 'launch.json entry port does not match the project live-delta target'))
        }
        if (liveBaseProcesses.has(target.port)) return json(response, 409, errorBody('ALREADY_MANAGED', 'A console-managed process already exists for this port'))
        // in-flight 락 — spawn 확정(await) 사이의 동시 시작 요청이 이중 스폰으로
        // 이어지는 TOCTOU를 막는다(리뷰 반영). 실패 경로는 반드시 락을 해제한다.
        liveBaseProcesses.set(target.port, {starting: true})
        // env 상속은 의도적 선택 — launch.json 명령(node·pnpm 등)이 운영자 셸과 같은
        // PATH·도구 체인을 쓰게 한다. 로컬 신뢰 모델 안의 트레이드오프.
        const child = spawn(entry.runtimeExecutable, entry.runtimeArgs ?? [], {cwd: repositoryRoot, stdio: ['ignore', 'ignore', 'ignore'], env: process.env})
        const settle = await new Promise(resolveSpawn => {
          child.once('spawn', () => resolveSpawn({ok: true}))
          child.once('error', error => resolveSpawn({ok: false, message: error.message}))
        })
        if (!settle.ok) {
          liveBaseProcesses.delete(target.port)
          return json(response, 500, errorBody('LIVE_BASE_SPAWN_FAILED', settle.message))
        }
        liveBaseProcesses.set(target.port, {child, entry: entry.name, startedAt: new Date().toISOString()})
        child.once('exit', () => {
          if (liveBaseProcesses.get(target.port)?.child === child) liveBaseProcesses.delete(target.port)
        })
        return json(response, 202, {started: true, entry: entry.name, port: target.port})
      } catch (error) {
        const status = Number.isInteger(error.status) ? error.status : 500
        return json(response, status, errorBody('LIVE_BASE_CONTROL_FAILED', status === 500 ? 'Live-base control failed' : error.message))
      }
    }
    if (request.method === 'POST' && projectChangeRequests) {
      if (!isAllowedConsoleOrigin(request.headers.origin, boundConsolePort) || request.headers['x-web-harness-intent'] !== 'create-change-request') {
        return json(response, 403, errorBody('CHANGE_REQUEST_FORBIDDEN', 'Change request origin or intent was rejected'))
      }
      if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
        return json(response, 415, errorBody('UNSUPPORTED_MEDIA_TYPE', 'Change requests require application/json'))
      }
      try {
        const input = await readJsonBody(request)
        const createProjectId = decodePathSegment(projectChangeRequests[1])
        if (createProjectId === null) return json(response, 400, errorBody('BAD_URL', 'Invalid URL'))
        const result = catalog.createChangeRequest(createProjectId, input, {idempotencyKey: request.headers['idempotency-key']})
        return json(response, result.created ? 201 : 200, result)
      } catch (error) {
        const status = Number.isInteger(error.status) ? error.status : 500
        const code = typeof error.code === 'string' ? error.code : 'CHANGE_REQUEST_FAILED'
        const message = status === 500 ? 'Change request could not be created' : error.message
        return json(response, status, errorBody(code, message))
      }
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json(response, 405, errorBody('METHOD_NOT_ALLOWED', 'This endpoint does not allow mutations'), {allow: 'GET, HEAD'})
    }
    if (url.pathname === '/api/codex/status') return json(response, 200, codexRunManager.connection({refresh: url.searchParams.get('refresh') === '1'}))
    if (url.pathname === '/api/live-base/health') {
      // 구성된 loopback 대상만 프로브한다(임의 URL 프로브 없음). 대상은 프로젝트의
      // delta manifest 또는 --live-base 플래그에서만 나온다.
      const healthProjectId = url.searchParams.get('project')
      let target = null
      if (healthProjectId) {
        const healthProject = catalog.project(healthProjectId)
        const manifest = healthProject ? readDeltaManifest(healthProject.root) : null
        target = manifest ? parseLiveBaseTarget(manifest.target) : null
        if (target && !launchAllowedPorts().has(target.port)) target = null
      } else if (liveBase) {
        target = liveBase.target
      }
      if (!target) return json(response, 200, {configured: false})
      const startHints = []
      try {
        const launch = JSON.parse(readFileSync(join(repositoryRoot, '.claude', 'launch.json'), 'utf8'))
        for (const entry of launch.configurations ?? []) {
          if (String(entry.port) === String(target.port) && entry.runtimeExecutable) {
            startHints.push({name: entry.name, command: [entry.runtimeExecutable, ...(entry.runtimeArgs ?? [])].join(' ')})
          }
        }
      } catch { /* launch.json 없음/파싱 실패 — 힌트 생략 */ }
      const managed = liveBaseProcesses.get(target.port)
      fetch(target.origin, {signal: AbortSignal.timeout(1500), redirect: 'manual'})
        .then(() => true, () => false)
        .then(healthy => json(response, 200, {
          configured: true, target: target.origin, healthy, startHints,
          managed: managed?.child ? {entry: managed.entry, startedAt: managed.startedAt} : null,
          checkedAt: new Date().toISOString(),
        }))
      return
    }
    if (url.pathname === '/api/projects') {
      const payload = url.searchParams.get('refresh') === '1' ? catalog.refresh() : catalog.list()
      payload.previewOrigin = `http://127.0.0.1:${boundPreviewPort}`
      return json(response, 200, payload)
    }
    if (projectDocument) {
      const documentProjectId = decodePathSegment(projectDocument[1])
      if (documentProjectId === null) return json(response, 400, errorBody('BAD_URL', 'Invalid URL'))
      const result = catalog.document(documentProjectId, url.searchParams.get('path'))
      if (!result.error) return json(response, 200, result)
      const status = result.error === 'DOCUMENT_TOO_LARGE' ? 413 : result.error === 'INVALID_DOCUMENT_PATH' ? 400 : 404
      return json(response, status, errorBody(result.error, result.error.replaceAll('_', ' ').toLowerCase()))
    }
    if (projectDetail) {
      const detailProjectId = decodePathSegment(projectDetail[1])
      if (detailProjectId === null) return json(response, 400, errorBody('BAD_URL', 'Invalid URL'))
      const detail = catalog.detail(detailProjectId)
      if (!detail) return json(response, 404, errorBody('PROJECT_NOT_FOUND', 'Project was not found'))
      const project = catalog.project(detailProjectId)
      detail.codexRuns = codexRunManager.list(project.root)
      detail.livePreview = null
      try {
        const proxy = await ensureLiveProxy(project, {allowStart: request.headers['x-web-harness-ui'] === '1'})
        if (proxy?.port) {
          detail.livePreview = {
            url: `http://127.0.0.1:${proxy.port}`,
            target: proxy.target.origin,
            deltaPresent: existsSync(join(project.root, '_workspace', '02_design', 'preview', 'delta', 'bootstrap.mjs')),
          }
        } else if (proxy?.error) {
          detail.livePreviewError = proxy.error
        }
      } catch { /* 프록시 준비 실패 시 livePreview 미노출 */ }
      return json(response, 200, detail)
    }
    if (url.pathname.startsWith('/api/')) return json(response, 404, errorBody('ENDPOINT_NOT_FOUND', 'Endpoint was not found'))

    const pathname = url.pathname === '/' ? '/index.html' : url.pathname
    const file = safeStaticFile(publicRoot, pathname)
    if (!file) return json(response, 404, errorBody('ASSET_NOT_FOUND', 'Asset was not found'))
    return streamFile(request, response, file)
  })

  const previewServer = createServer((request, response) => {
    response.setHeader('content-security-policy', "default-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'")
    response.setHeader('referrer-policy', 'no-referrer')
    response.setHeader('cross-origin-resource-policy', 'same-origin')
    if (!isAllowedHost(request.headers.host, boundPreviewPort)) {
      return json(response, 403, errorBody('HOST_NOT_ALLOWED', 'Preview requests must target the loopback host'))
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, errorBody('READ_ONLY', 'Preview server is read-only'), {allow: 'GET, HEAD'})
    let pathname
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)
    } catch {
      return json(response, 400, errorBody('BAD_URL', 'Invalid URL'))
    }
    // 발산 시안 아카이브 정적 서빙 — 프리뷰와 동일한 read-only·safeStaticFile 태세.
    // 시안은 승인 상태와 무관한 보존 증거물이라 preview.exists를 요구하지 않는다.
    const styleTiles = pathname.match(/^\/([^/]+)\/__style-tiles(\/.+)$/)
    if (styleTiles) {
      const tileProject = catalog.project(styleTiles[1])
      if (!tileProject) return json(response, 404, errorBody('STYLE_TILES_NOT_FOUND', 'Style tiles were not found'))
      let tilesRoot
      try {
        tilesRoot = realpathSync(join(tileProject.root, '_workspace', '02_design', 'design-system', 'style-tiles'))
      } catch {
        return json(response, 404, errorBody('STYLE_TILES_NOT_FOUND', 'Style tiles were not found'))
      }
      const tileFile = safeStaticFile(tilesRoot, styleTiles[2])
      if (!tileFile) return json(response, 404, errorBody('STYLE_TILE_ASSET_NOT_FOUND', 'Style tile asset was not found'))
      return streamFile(request, response, tileFile)
    }
    const match = pathname.match(/^\/([^/]+)(\/.*)?$/)
    if (!match) return json(response, 404, errorBody('PREVIEW_NOT_FOUND', 'Preview was not found'))
    const project = catalog.project(match[1])
    if (!project?.preview.exists) return json(response, 404, errorBody('PREVIEW_NOT_FOUND', 'Preview was not found'))
    let previewRoot
    try {
      previewRoot = realpathSync(join(project.root, '_workspace', '02_design', 'preview'))
    } catch {
      return json(response, 404, errorBody('PREVIEW_NOT_FOUND', 'Preview was not found'))
    }
    const requested = match[2] && match[2] !== '/' ? match[2] : '/index.html'
    const file = safeStaticFile(previewRoot, requested)
    if (!file) return json(response, 404, errorBody('PREVIEW_ASSET_NOT_FOUND', 'Preview asset was not found'))
    return streamFile(request, response, file, {'x-web-harness-preview-status': project.preview.status})
  })

  const livePreviewServer = liveBase
    ? createLiveBasePreviewServer({
      target: liveBase.target,
      deltaRoot: join(liveBase.root, '_workspace', '02_design', 'preview', 'delta'),
      streamDeltaFile: streamFile,
    })
    : null
  let boundLivePreviewPort = liveBase?.port ?? null

  // live-base 동적 구성(후속 작업 7-③): delta manifest의 target(loopback 한정)으로
  // 프로젝트별 프록시를 지연 생성한다 — 플래그 없이 plain 콘솔 하나로 통합.
  // --live-base 플래그는 해당 프로젝트의 포트 고정 수동 오버라이드로 유지된다.
  const liveProxies = new Map() // realpath(project.root) → {port, target, server} | {error} | {promise}
  const readDeltaManifest = projectRoot => {
    try {
      const manifest = JSON.parse(readFileSync(join(projectRoot, '_workspace', '02_design', 'preview', 'manifest.json'), 'utf8'))
      return manifest?.mode === 'live-delta' ? manifest : null
    } catch {
      return null
    }
  }
  // 승인 게이트 dev server 시작/중지(후속 작업 7-②): 명령은 launch.json 항목에서만
  // 나오고(임의 명령 불가), 항목 포트가 프로젝트 manifest target 포트와 일치해야 하며,
  // 중지는 이 콘솔이 스폰한 프로세스만 가능하다. POST는 origin+intent 가드를 거친다.
  const liveBaseProcesses = new Map() // port(Number) → {child, entry, startedAt}
  const readLaunchEntry = name => {
    try {
      const launch = JSON.parse(readFileSync(join(repositoryRoot, '.claude', 'launch.json'), 'utf8'))
      return (launch.configurations ?? []).find(entry => entry.name === name && entry.runtimeExecutable) ?? null
    } catch {
      return null
    }
  }
  const launchAllowedPorts = () => {
    // 동적 프록시 대상 allowlist: 운영자가 launch.json에 등록한 dev server 포트만.
    // "loopback이면 뭐든 통과"를 좁힌다(리뷰 지적 — manifest는 repo 콘텐츠).
    try {
      const launch = JSON.parse(readFileSync(join(repositoryRoot, '.claude', 'launch.json'), 'utf8'))
      return new Set((launch.configurations ?? []).map(entry => Number(entry.port)).filter(Number.isInteger))
    } catch {
      return new Set()
    }
  }
  const ensureLiveProxy = (project, {allowStart = false} = {}) => {
    const manifest = readDeltaManifest(project.root)
    if (!manifest) return null
    let realRoot
    try {
      realRoot = realpathSync(project.root)
    } catch {
      return null
    }
    if (liveBase && boundLivePreviewPort) {
      try {
        if (realpathSync(liveBase.root) === realRoot) return {port: boundLivePreviewPort, target: liveBase.target}
      } catch { /* 플래그 루트 해석 실패 — 동적 경로로 진행 */ }
    }
    const existing = liveProxies.get(realRoot)
    if (existing) return existing.promise ?? existing
    // 실패는 캐시하지 않는다 — manifest/launch.json을 고치면 재시작 없이 복구된다.
    const target = parseLiveBaseTarget(manifest.target)
    if (!target) return {error: 'INVALID_LIVE_TARGET'}
    if (!launchAllowedPorts().has(target.port)) return {error: 'LIVE_TARGET_NOT_IN_LAUNCH'}
    if (!allowStart) return null
    const server = createLiveBasePreviewServer({
      target,
      deltaRoot: join(project.root, '_workspace', '02_design', 'preview', 'delta'),
      streamDeltaFile: streamFile,
    })
    const promise = new Promise(resolveEntry => {
      server.once('error', () => {
        liveProxies.delete(realRoot)
        resolveEntry({error: 'LIVE_PROXY_START_FAILED'})
      })
      server.listen(0, '127.0.0.1', () => {
        const entry = {port: server.address().port, target, server}
        liveProxies.set(realRoot, entry)
        resolveEntry(entry)
      })
    })
    liveProxies.set(realRoot, {promise})
    return promise
  }

  const listen = () => new Promise((resolveListen, reject) => {
    const expected = livePreviewServer ? 3 : 2
    let ready = 0
    const done = () => {
      ready += 1
      if (ready === expected) resolveListen({consolePort: boundConsolePort, previewPort: boundPreviewPort, livePreviewPort: boundLivePreviewPort})
    }
    consoleServer.once('error', reject)
    previewServer.once('error', reject)
    previewServer.listen(previewPort, '127.0.0.1', () => {
      boundPreviewPort = previewServer.address().port
      done()
    })
    consoleServer.listen(port, '127.0.0.1', () => {
      boundConsolePort = consoleServer.address().port
      done()
    })
    if (livePreviewServer) {
      livePreviewServer.once('error', reject)
      livePreviewServer.listen(liveBase.port, '127.0.0.1', () => {
        boundLivePreviewPort = livePreviewServer.address().port
        done()
      })
    }
  })

  const close = async () => {
    // 자식 종료를 확인하고 반환한다 — SIGTERM 미종료 시 SIGKILL 에스컬레이션(리뷰 반영).
    const children = [...liveBaseProcesses.values()].filter(managed => managed.child).map(managed => managed.child)
    liveBaseProcesses.clear()
    await Promise.all(children.map(child => new Promise(resolveExit => {
      if (child.exitCode !== null || child.signalCode !== null) return resolveExit()
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolveExit() }, 2000)
      child.once('exit', () => { clearTimeout(timer); resolveExit() })
      child.kill('SIGTERM')
    })))
    await codexRunManager.close()
    await Promise.all([
      new Promise(resolveClose => consoleServer.close(() => resolveClose())),
      new Promise(resolveClose => previewServer.close(() => resolveClose())),
      livePreviewServer ? new Promise(resolveClose => livePreviewServer.close(() => resolveClose())) : Promise.resolve(),
      ...[...liveProxies.values()].filter(entry => entry.server).map(entry => new Promise(resolveClose => entry.server.close(() => resolveClose()))),
    ])
  }

  return {catalog, codexRunManager, consoleServer, previewServer, livePreviewServer, listen, close}
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  try {
    const options = parseArguments(process.argv.slice(2))
    if (!existsSync(options.root) || !statSync(options.root).isDirectory()) throw new Error(`Repository root does not exist: ${options.root}`)
    const servers = createConsoleServers({
      repositoryRoot: options.root,
      port: options.port,
      previewPort: options.previewPort,
      executorKind: options.executor,
      executorModels: {impact: options.impactModel, apply: options.applyModel},
      liveBase: options.liveBase
        ? {target: parseLiveBaseTarget(options.liveBase), root: options.liveBaseRoot, port: options.liveBasePort}
        : null,
    })
    const addresses = await servers.listen()
    if (addresses.livePreviewPort) {
      process.stdout.write(`Live-base preview (pinned): http://127.0.0.1:${addresses.livePreviewPort} → ${options.liveBase} (delta: ${options.liveBaseRoot})\n`)
    }
    process.stdout.write('Live-base delta proxies: delta manifest의 target으로 프로젝트별 자동 구성 (임시 포트)\n')
    process.stdout.write(`Web Harness Console: http://127.0.0.1:${addresses.consolePort}\n`)
    process.stdout.write(`Isolated previews: http://127.0.0.1:${addresses.previewPort}/<project-id>/\n`)
    const connection = servers.codexRunManager.connection()
    const executorLabel = connection.executor === 'claude-code' ? 'Claude Code' : 'Codex'
    process.stdout.write(`Indexed ${servers.catalog.list().projects.length} project(s), append-only requests and approval-gated executor runs enabled; ${executorLabel} ${connection.connected ? 'connected' : 'not connected'} — Ctrl+C to stop\n`)
    // 콘솔이 스폰한 dev server가 고아로 남지 않도록 시그널에서 close()를 거친다.
    const shutdown = () => { servers.close().finally(() => process.exit(0)) }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  } catch (error) {
    process.stderr.write(`Web Harness Console failed: ${error.message}\n`)
    process.exit(1)
  }
}
