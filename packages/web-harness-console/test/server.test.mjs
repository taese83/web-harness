import assert from 'node:assert/strict'
import {existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs'
import {createServer, request as httpRequest} from 'node:http'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {createConsoleServers} from '../server.mjs'
import {CodexRunManager} from '../src/codex-runs.mjs'
import {writeSourceSnapshot} from '../../../.claude/scripts/design-preview-status-lib.mjs'

const rawRequest = ({port, path, host}) => new Promise((resolveResponse, reject) => {
  const request = httpRequest({host: '127.0.0.1', port, path, headers: {host}}, response => {
    const chunks = []
    response.on('data', chunk => chunks.push(chunk))
    response.on('end', () => resolveResponse({status: response.statusCode, body: Buffer.concat(chunks).toString('utf8')}))
  })
  request.on('error', reject)
  request.end()
})

const fixtureRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-console-server-'))
  const project = join(root, 'workspace', 'preview-project')
  const preview = join(project, '_workspace', '02_design', 'preview')
  mkdirSync(join(project, '_workspace', '01_plan'), {recursive: true})
  mkdirSync(preview, {recursive: true})
  writeFileSync(join(project, '_workspace', '01_plan', 'feature-plan.md'), '# FEAT-001 Preview\n\n- TC-001-1 works\n')
  writeFileSync(join(project, '_workspace', '01_plan', 'ux-brief.md'), '# UX\n')
  writeFileSync(join(project, '_workspace', '02_design', 'design-system.md'), '# DS\n')
  writeFileSync(join(project, '_workspace', '02_design', 'layout-spec.md'), '# Layout\n')
  writeFileSync(join(project, '_workspace', '02_design', 'component-spec.md'), '# Components\n')
  writeFileSync(join(preview, 'index.html'), '<!doctype html><h1>Fixture preview</h1>\n')
  writeFileSync(join(preview, 'secret.txt'), 'preview asset\n')
  return {root, project}
}

test('console keeps canonical artifacts read-only and isolates its single append-only mutation boundary', async t => {
  const fixture = fixtureRoot()
  const servers = createConsoleServers({repositoryRoot: fixture.root, port: 0, previewPort: 0})
  const addresses = await servers.listen()
  t.after(async () => {
    await servers.close()
    rmSync(fixture.root, {recursive: true, force: true})
  })

  const consoleOrigin = `http://127.0.0.1:${addresses.consolePort}`
  const previewOrigin = `http://127.0.0.1:${addresses.previewPort}`
  const featureStyles = await fetch(`${consoleOrigin}/styles.css`).then(response => response.text())
  const featureScript = await fetch(`${consoleOrigin}/app.js`).then(response => response.text())
  assert.match(featureStyles, /body\[data-active-surface="features"\] \.feature-list/)
  assert.match(featureStyles, /body\[data-active-surface="features"\] \.feature-detail/)
  assert.match(featureStyles, /overflow-y: auto/)
  assert.match(featureStyles, /\.codex-run-panel\.is-scrollable \{ block-size: clamp\(320px, 48vh, 480px\); overflow-y: auto;/)
  assert.match(featureStyles, /\.codex-run-panel\.is-scrollable \.codex-run-heading \{ position: sticky;/)
  assert.match(featureScript, /scrollIntoView\(\{block: 'nearest', inline: 'nearest'\}\)/)
  assert.match(featureScript, /codex-run-panel\$\{hasLongResult \? ' is-scrollable' : ''\}/)
  assert.match(featureScript, /openChangeRequestDeleteDialog/)
  assert.match(featureScript, /method: 'DELETE'/)
  assert.match(featureScript, /x-web-harness-intent': intent/)
  assert.match(featureScript, /text: '요청 삭제'/)
  assert.match(featureScript, /decision\.decision === 'APPROVED'/)
  const projectsResponse = await fetch(`${consoleOrigin}/api/projects`)
  assert.equal(projectsResponse.status, 200)
  const catalog = await projectsResponse.json()
  assert.equal(catalog.projects.length, 1)
  assert.equal(catalog.projects[0].preview.status, 'MISSING')
  assert.equal(catalog.previewOrigin, previewOrigin)

  const project = catalog.projects[0]
  const detailResponse = await fetch(`${consoleOrigin}/api/projects/${project.id}`)
  assert.equal(detailResponse.status, 200)
  const detail = await detailResponse.json()
  assert.equal(detail.documents.design.some(document => document.path.includes('/preview/')), false)
  assert.deepEqual(detail.changeRequests, [])
  assert.deepEqual(detail.features[0].pageGroup, {id: null, label: '미분류', route: '', order: null, source: 'ungrouped'})

  const blockedDocument = await fetch(`${consoleOrigin}/api/projects/${project.id}/document?path=${encodeURIComponent('_workspace/03_dev/secret.md')}`)
  assert.equal(blockedDocument.status, 404)
  const mutation = await fetch(`${consoleOrigin}/api/projects`, {method: 'POST'})
  assert.equal(mutation.status, 405)

  const featurePlanPath = join(fixture.project, '_workspace', '01_plan', 'feature-plan.md')
  const featurePlanBefore = readFileSync(featurePlanPath, 'utf8')
  const changeRequestBody = {
    targetFeatureId: 'FEAT-001',
    title: 'Preview heading revision',
    requestedChange: 'Make the preview heading more specific.',
    reason: 'The current label is ambiguous.',
    expectedBehavior: 'The revised heading matches the Feature terminology.',
    versionIntent: 'minor',
  }
  const idempotencyKey = '019fcf35-48fe-7d93-bb95-3304a2732950'
  const createRequest = (overrides = {}) => fetch(`${consoleOrigin}/api/projects/${project.id}/change-requests`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: consoleOrigin,
      'x-web-harness-intent': 'create-change-request',
      'idempotency-key': idempotencyKey,
      ...overrides.headers,
    },
    body: JSON.stringify(overrides.body ?? changeRequestBody),
  })

  const rejectedOrigin = await createRequest({headers: {origin: 'http://malicious.example'}})
  assert.equal(rejectedOrigin.status, 403)
  assert.equal(existsSync(join(fixture.project, '_workspace', '01_plan', 'change-requests')), false)
  const missingIntent = await fetch(`${consoleOrigin}/api/projects/${project.id}/change-requests`, {
    method: 'POST',
    headers: {'content-type': 'application/json', origin: consoleOrigin, 'idempotency-key': idempotencyKey},
    body: JSON.stringify(changeRequestBody),
  })
  assert.equal(missingIntent.status, 403)
  const unsupportedMedia = await fetch(`${consoleOrigin}/api/projects/${project.id}/change-requests`, {
    method: 'POST',
    headers: {origin: consoleOrigin, 'x-web-harness-intent': 'create-change-request', 'idempotency-key': idempotencyKey, 'content-type': 'text/plain'},
    body: JSON.stringify(changeRequestBody),
  })
  assert.equal(unsupportedMedia.status, 415)
  assert.equal(existsSync(join(fixture.project, '_workspace', '01_plan', 'change-requests')), false)

  const createdResponse = await createRequest()
  assert.equal(createdResponse.status, 201)
  const created = await createdResponse.json()
  assert.equal(created.created, true)
  assert.match(created.changeRequest.id, /^CHG-\d{8}-001$/)
  assert.equal(created.changeRequest.status, 'PROPOSED')
  assert.deepEqual(created.changeRequest.context.testCaseIds, [])
  assert.equal(readFileSync(featurePlanPath, 'utf8'), featurePlanBefore)
  const requestDirectory = join(fixture.project, '_workspace', '01_plan', 'change-requests')
  assert.deepEqual(readdirSync(requestDirectory), [`${created.changeRequest.id}.md`])

  const replayResponse = await createRequest()
  assert.equal(replayResponse.status, 200)
  const replay = await replayResponse.json()
  assert.equal(replay.created, false)
  assert.equal(replay.changeRequest.id, created.changeRequest.id)
  assert.equal(readdirSync(requestDirectory).length, 1)

  const refreshedDetail = await fetch(`${consoleOrigin}/api/projects/${project.id}`).then(response => response.json())
  assert.equal(refreshedDetail.changeRequests.length, 1)
  assert.equal(refreshedDetail.changeRequestCount, 1)
  assert.equal(refreshedDetail.documents.plan.some(document => document.path.endsWith(`${created.changeRequest.id}.md`)), true)

  const requestPath = join(requestDirectory, `${created.changeRequest.id}.md`)
  const originalRequestSource = readFileSync(requestPath, 'utf8')
  const revisionUrl = `${consoleOrigin}/api/projects/${project.id}/change-requests/${created.changeRequest.id}/revisions`
  const revisionBody = {
    title: 'Corrected preview heading revision',
    requestedChange: 'Use the corrected heading terminology.',
    reason: 'The first impact assumption was incomplete.',
    expectedBehavior: 'A new impact review uses the corrected request.',
    versionIntent: 'patch',
  }
  const reviseRequest = (overrides = {}) => fetch(revisionUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', origin: consoleOrigin, 'x-web-harness-intent': 'revise-change-request',
      'idempotency-key': '019fcf35-48fe-7d93-bb95-3304a2732953',
      ...overrides.headers,
    },
    body: JSON.stringify(overrides.body ?? revisionBody),
  })
  assert.equal((await reviseRequest({headers: {origin: 'http://malicious.example'}})).status, 403)
  assert.equal((await reviseRequest({headers: {'content-type': 'text/plain'}})).status, 415)
  const revisionResponse = await reviseRequest()
  assert.equal(revisionResponse.status, 201)
  const revision = await revisionResponse.json()
  assert.equal(revision.changeRequest.revisionCount, 1)
  assert.match(revision.revision.revisionId, /-REV-001$/)
  assert.equal(readFileSync(requestPath, 'utf8'), originalRequestSource)
  assert.equal((await reviseRequest()).status, 200)
  const revisedDetail = await fetch(`${consoleOrigin}/api/projects/${project.id}`).then(response => response.json())
  assert.equal(revisedDetail.changeRequests[0].title, revisionBody.title)
  assert.equal(revisedDetail.changeRequests[0].revisions.length, 1)
  assert.equal(revisedDetail.documents.plan.some(document => document.path.endsWith(`${revision.revision.revisionId}.md`)), true)

  const invalidTarget = await createRequest({
    headers: {'idempotency-key': '019fcf35-48fe-7d93-bb95-3304a2732951'},
    body: {...changeRequestBody, targetFeatureId: 'FEAT-999'},
  })
  assert.equal(invalidTarget.status, 400)
  assert.equal(readdirSync(requestDirectory).length, 1)

  const deleteUrl = `${consoleOrigin}/api/projects/${project.id}/change-requests/${created.changeRequest.id}`
  const deleteRequest = (overrides = {}) => fetch(deleteUrl, {
    method: 'DELETE',
    headers: {
      origin: consoleOrigin,
      'x-web-harness-intent': 'delete-change-request',
      ...overrides.headers,
    },
    body: overrides.body,
  })
  assert.equal((await deleteRequest({headers: {origin: 'http://malicious.example'}})).status, 403)
  assert.equal((await deleteRequest({headers: {'x-web-harness-intent': 'wrong-intent'}})).status, 403)
  assert.equal((await deleteRequest({headers: {'content-type': 'application/json'}, body: '{}'})).status, 400)
  assert.equal(existsSync(requestPath), true)
  const deletedResponse = await deleteRequest()
  assert.equal(deletedResponse.status, 204)
  assert.equal(await deletedResponse.text(), '')
  assert.equal(existsSync(requestPath), false)
  assert.equal(existsSync(join(fixture.project, '_workspace', '01_plan', 'change-request-revisions', `${revision.revision.revisionId}.md`)), false)
  const deletedDetail = await fetch(`${consoleOrigin}/api/projects/${project.id}`).then(response => response.json())
  assert.equal(deletedDetail.changeRequestCount, 0)
  assert.deepEqual(deletedDetail.changeRequests, [])
  assert.equal((await deleteRequest()).status, 204)
  assert.equal((await fetch(`${consoleOrigin}/api/projects/${project.id}/change-requests/not-a-change`, {
    method: 'DELETE', headers: {origin: consoleOrigin, 'x-web-harness-intent': 'delete-change-request'},
  })).status, 400)

  const previewResponse = await fetch(`${previewOrigin}/${project.id}/`)
  assert.equal(previewResponse.status, 200)
  assert.match(await previewResponse.text(), /Fixture preview/)
  assert.equal(previewResponse.headers.get('x-web-harness-preview-status'), 'MISSING')
  assert.match(previewResponse.headers.get('content-security-policy'), /connect-src 'self'/)
  const sameOriginAsset = await fetch(`${previewOrigin}/${project.id}/secret.txt`)
  assert.equal(sameOriginAsset.status, 200)
  assert.equal(await sameOriginAsset.text(), 'preview asset\n')
  const traversal = await fetch(`${previewOrigin}/${project.id}/%2e%2e/%2e%2e/secret.txt`)
  assert.equal(traversal.status, 404)
  const previewMutation = await fetch(`${previewOrigin}/${project.id}/`, {method: 'POST'})
  assert.equal(previewMutation.status, 405)
})

test('malformed URL encoding and non-loopback Host headers are rejected without killing the server', async t => {
  const fixture = fixtureRoot()
  const servers = createConsoleServers({repositoryRoot: fixture.root, port: 0, previewPort: 0})
  const addresses = await servers.listen()
  t.after(async () => {
    await servers.close()
    rmSync(fixture.root, {recursive: true, force: true})
  })
  const origin = `http://127.0.0.1:${addresses.consolePort}`

  const badDetail = await fetch(`${origin}/api/projects/%zz`)
  assert.equal(badDetail.status, 400)
  assert.equal((await badDetail.json()).error.code, 'BAD_URL')
  const badDocument = await fetch(`${origin}/api/projects/%zz/document?path=${encodeURIComponent('_workspace/01_plan/ux-brief.md')}`)
  assert.equal(badDocument.status, 400)
  assert.equal((await fetch(`${origin}/api/projects`)).status, 200)

  const reboundConsole = await rawRequest({port: addresses.consolePort, path: '/api/projects', host: 'attacker.example'})
  assert.equal(reboundConsole.status, 403)
  assert.match(reboundConsole.body, /HOST_NOT_ALLOWED/)
  const reboundPreview = await rawRequest({port: addresses.previewPort, path: '/', host: 'attacker.example:4311'})
  assert.equal(reboundPreview.status, 403)
  assert.match(reboundPreview.body, /HOST_NOT_ALLOWED/)
  const localhostHost = await rawRequest({port: addresses.consolePort, path: '/api/projects', host: `localhost:${addresses.consolePort}`})
  assert.equal(localhostHost.status, 200)

  const project = (await fetch(`${origin}/api/projects`).then(response => response.json())).projects[0]
  const oversized = await fetch(`${origin}/api/projects/${project.id}/change-requests`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', origin, 'x-web-harness-intent': 'create-change-request',
      'idempotency-key': '019fcf35-48fe-7d93-bb95-3304a2732980',
    },
    body: JSON.stringify({padding: 'x'.repeat(17 * 1024)}),
  })
  assert.equal(oversized.status, 413)
  assert.equal((await oversized.json()).error.code, 'REQUEST_TOO_LARGE')
  assert.equal(existsSync(join(fixture.project, '_workspace', '01_plan', 'change-requests')), false)
})

test('Codex run endpoint is loopback-gated and separates read-only impact from approved apply', async t => {
  const fixture = fixtureRoot()
  const uuids = ['019fcf35-48fe-7d93-bb95-3304a2732960', '019fcf35-48fe-7d93-bb95-3304a2732961', '019fcf35-48fe-7d93-bb95-3304a2732966', '019fcf35-48fe-7d93-bb95-3304a2732973', '019fcf35-48fe-7d93-bb95-3304a2732978']
  const invocations = []
  const manager = new CodexRunManager({
    connectionProbe: ({now}) => ({available: true, authenticated: true, connected: true, version: 'codex-cli test', reason: null, checkedAt: now.toISOString()}),
    uuid: () => uuids.shift(),
    executor: async input => {
      invocations.push(input)
      if (input.phase === 'apply') {
        writeFileSync(join(input.projectRoot, '_workspace', '01_plan', 'feature-plan.md'), '# FEAT-001 Preview\n\n- TC-001-1 works\n\nCandidate revision\n')
      }
      return {
        threadId: `thread-${input.phase}`,
        usage: null,
        result: {
          phase: input.phase,
          outcome: input.phase === 'impact' ? 'READY' : 'READY_FOR_REVIEW',
          summary: `${input.phase} complete`,
          affectedFiles: [],
          affectedFeatureIds: ['FEAT-001'],
          affectedSubFeatureIds: [],
          affectedTestCaseIds: ['TC-001-1'],
          sourceDigest: null,
          previewDigest: null,
          risks: [], checks: [], blockers: [],
        },
      }
    },
  })
  const servers = createConsoleServers({repositoryRoot: fixture.root, port: 0, previewPort: 0, codexRunManager: manager})
  const addresses = await servers.listen()
  t.after(async () => {
    await servers.close()
    rmSync(fixture.root, {recursive: true, force: true})
  })

  const origin = `http://127.0.0.1:${addresses.consolePort}`
  const project = (await fetch(`${origin}/api/projects`).then(response => response.json())).projects[0]
  const requestBody = {
    targetFeatureId: 'FEAT-001', title: 'Connected change', requestedChange: 'Update the copy.', reason: 'Clarity.', expectedBehavior: 'Copy matches the feature.', versionIntent: 'patch',
  }
  const createdRequest = await fetch(`${origin}/api/projects/${project.id}/change-requests`, {
    method: 'POST',
    headers: {'content-type': 'application/json', origin, 'x-web-harness-intent': 'create-change-request', 'idempotency-key': '019fcf35-48fe-7d93-bb95-3304a2732962'},
    body: JSON.stringify(requestBody),
  }).then(response => response.json())
  const requestId = createdRequest.changeRequest.id
  const runUrl = `${origin}/api/projects/${project.id}/change-requests/${requestId}/codex-runs`
  const start = (body, overrides = {}) => fetch(runUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', origin, 'x-web-harness-intent': 'start-codex-run',
      'idempotency-key': '019fcf35-48fe-7d93-bb95-3304a2732963',
      ...overrides.headers,
    },
    body: JSON.stringify(body),
  })

  const connection = await fetch(`${origin}/api/codex/status`).then(response => response.json())
  assert.equal(connection.connected, true)
  assert.equal(connection.version, 'codex-cli test')

  assert.equal((await start({phase: 'impact'}, {headers: {origin: 'http://malicious.example'}})).status, 403)
  assert.equal((await start({phase: 'impact'}, {headers: {'content-type': 'text/plain'}})).status, 415)
  const injected = await start({phase: 'impact', prompt: 'run arbitrary command'})
  assert.equal(injected.status, 400)
  assert.equal((await injected.json()).error.code, 'INVALID_CODEX_RUN')

  const impactResponse = await start({phase: 'impact'})
  assert.equal(impactResponse.status, 202)
  const impact = await impactResponse.json()
  assert.equal(impact.run.phase, 'impact')
  await manager.waitForIdle()
  let impactRun = manager.list(fixture.project).find(run => run.phase === 'impact')
  assert.equal(impactRun.status, 'COMPLETED')
  assert.equal(invocations[0].phase, 'impact')
  const cachedImpactResponse = await start(
    {phase: 'impact'},
    {headers: {'idempotency-key': '019fcf35-48fe-7d93-bb95-3304a2732979'}},
  )
  assert.equal(cachedImpactResponse.status, 200)
  const cachedImpact = await cachedImpactResponse.json()
  assert.equal(cachedImpact.cacheHit, true)
  assert.equal(cachedImpact.run.cache.hit, true)
  assert.equal(invocations.length, 1)

  const revisionUrl = `${origin}/api/projects/${project.id}/change-requests/${requestId}/revisions`
  const correctedRequest = {
    title: 'Corrected connected change',
    requestedChange: 'Update only the confirmed copy.',
    reason: requestBody.reason,
    expectedBehavior: requestBody.expectedBehavior,
    versionIntent: requestBody.versionIntent,
  }
  const requestRevisionResponse = await fetch(revisionUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', origin, 'x-web-harness-intent': 'revise-change-request',
      'idempotency-key': '019fcf35-48fe-7d93-bb95-3304a2732974',
    },
    body: JSON.stringify(correctedRequest),
  })
  assert.equal(requestRevisionResponse.status, 201)
  assert.equal((await requestRevisionResponse.json()).changeRequest.revisionCount, 1)

  const applyWithoutApproval = await start(
    {phase: 'apply', impactRunId: impactRun.runId},
    {headers: {'idempotency-key': '019fcf35-48fe-7d93-bb95-3304a2732964'}},
  )
  assert.equal(applyWithoutApproval.status, 403)
  const staleApply = await start(
    {phase: 'apply', impactRunId: impactRun.runId, approval: 'create-isolated-candidate'},
    {headers: {'idempotency-key': '019fcf35-48fe-7d93-bb95-3304a2732965'}},
  )
  assert.equal(staleApply.status, 409)
  assert.equal((await staleApply.json()).error.code, 'CODEX_IMPACT_STALE')

  const newImpactResponse = await start(
    {phase: 'impact'},
    {headers: {'idempotency-key': '019fcf35-48fe-7d93-bb95-3304a2732975'}},
  )
  assert.equal(newImpactResponse.status, 202)
  await manager.waitForIdle()
  impactRun = manager.list(fixture.project).find(run => run.phase === 'impact')
  assert.match(invocations[1].prompt, /Corrected connected change/)
  assert.match(invocations[1].prompt, /effective request embedded below is authoritative/)
  assert.match(invocations[1].prompt, /do not reread/)

  const applyResponse = await start(
    {phase: 'apply', impactRunId: impactRun.runId, approval: 'create-isolated-candidate'},
    {headers: {'idempotency-key': '019fcf35-48fe-7d93-bb95-3304a2732965'}},
  )
  assert.equal(applyResponse.status, 202)
  await manager.waitForIdle()
  const detail = await fetch(`${origin}/api/projects/${project.id}`).then(response => response.json())
  assert.equal(detail.codexRuns.length, 4)
  assert.equal(detail.codexRuns.some(run => run.phase === 'apply' && run.status === 'COMPLETED'), true)
  assert.equal(invocations[2].phase, 'apply')
  assert.notEqual(invocations[2].projectRoot, fixture.project)
  assert.equal(readFileSync(join(fixture.project, '_workspace', '01_plan', 'feature-plan.md'), 'utf8'), '# FEAT-001 Preview\n\n- TC-001-1 works\n')
  assert.deepEqual(detail.codexRuns.find(run => run.phase === 'apply').candidate.changedFiles.map(change => change.path), ['_workspace/01_plan/feature-plan.md'])

  const lateRevision = await fetch(`${origin}/api/projects/${project.id}/change-requests/${requestId}/revisions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', origin, 'x-web-harness-intent': 'revise-change-request',
      'idempotency-key': '019fcf35-48fe-7d93-bb95-3304a2732972',
    },
    body: JSON.stringify({...requestBody, targetFeatureId: undefined, title: 'Too late to revise'}),
  })
  assert.equal(lateRevision.status, 409)
  assert.equal((await lateRevision.json()).error.code, 'CHANGE_REQUEST_REVISION_APPLY_STARTED')

  const applyBeforeReview = await start(
    {phase: 'apply', impactRunId: impactRun.runId, approval: 'create-isolated-candidate'},
    {headers: {'idempotency-key': '019fcf35-48fe-7d93-bb95-3304a2732971'}},
  )
  assert.equal(applyBeforeReview.status, 409)
  assert.equal((await applyBeforeReview.json()).error.code, 'CODEX_REVIEW_REQUIRED')

  const reviewUrl = `${origin}/api/projects/${project.id}/change-requests/${requestId}/review-decisions`
  const review = (body, overrides = {}) => fetch(reviewUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', origin, 'x-web-harness-intent': 'record-change-review',
      'idempotency-key': '019fcf35-48fe-7d93-bb95-3304a2732967',
      ...overrides.headers,
    },
    body: JSON.stringify(body),
  })
  assert.equal((await review({decision: 'REVISION_REQUESTED', reason: 'Clarify the final button copy.'}, {headers: {origin: 'http://malicious.example'}})).status, 403)
  assert.equal((await review({decision: 'REVISION_REQUESTED', reason: ''})).status, 400)
  const revisionResponse = await review({decision: 'REVISION_REQUESTED', reason: 'Clarify the final button copy.'})
  assert.equal(revisionResponse.status, 201)
  const revision = await revisionResponse.json()
  assert.equal(revision.reviewDecision.applyRunId, detail.codexRuns.find(run => run.phase === 'apply').runId)
  const revisionReplay = await review({decision: 'REVISION_REQUESTED', reason: 'ignored'})
  assert.equal(revisionReplay.status, 200)
  assert.equal((await revisionReplay.json()).created, false)

  const reviseResponse = await start(
    {phase: 'apply', impactRunId: impactRun.runId, approval: 'create-isolated-candidate'},
    {headers: {'idempotency-key': '019fcf35-48fe-7d93-bb95-3304a2732968'}},
  )
  assert.equal(reviseResponse.status, 202)
  await manager.waitForIdle()
  assert.equal(invocations[3].phase, 'apply')
  assert.match(invocations[3].prompt, /untrusted_review_feedback/)
  assert.match(invocations[3].prompt, /Clarify the final button copy/)
  assert.equal(readFileSync(join(fixture.project, '_workspace', '01_plan', 'feature-plan.md'), 'utf8'), '# FEAT-001 Preview\n\n- TC-001-1 works\n')

  const featurePlanPath = join(fixture.project, '_workspace', '01_plan', 'feature-plan.md')
  const canonicalBeforeReview = readFileSync(featurePlanPath, 'utf8')
  writeFileSync(featurePlanPath, `${canonicalBeforeReview}\nConcurrent local edit\n`)
  const invalidReviewBody = await review(
    {decision: 'APPROVED', reason: '', unexpected: true},
    {headers: {'idempotency-key': '019fcf35-48fe-7d93-bb95-3304a2732976'}},
  )
  assert.equal(invalidReviewBody.status, 400)
  assert.equal((await invalidReviewBody.json()).error.code, 'INVALID_REVIEW_DECISION')
  assert.equal(readFileSync(featurePlanPath, 'utf8'), `${canonicalBeforeReview}\nConcurrent local edit\n`)
  writeFileSync(featurePlanPath, canonicalBeforeReview)

  const approvalResponse = await review(
    {decision: 'APPROVED', reason: 'Reviewed.'},
    {headers: {'idempotency-key': '019fcf35-48fe-7d93-bb95-3304a2732969'}},
  )
  assert.equal(approvalResponse.status, 201)
  assert.equal(readFileSync(join(fixture.project, '_workspace', '01_plan', 'feature-plan.md'), 'utf8'), '# FEAT-001 Preview\n\n- TC-001-1 works\n\nCandidate revision\n')
  const approvedDetail = await fetch(`${origin}/api/projects/${project.id}`).then(response => response.json())
  assert.equal(approvedDetail.features[0].approvedChanges[0].changeRequestId, requestId)
  assert.equal(approvedDetail.features[0].approvedChanges[0].applyRunId, approvedDetail.changeRequests[0].latestReviewDecision.applyRunId)
  const terminalRun = await start(
    {phase: 'impact'},
    {headers: {'idempotency-key': '019fcf35-48fe-7d93-bb95-3304a2732970'}},
  )
  assert.equal(terminalRun.status, 409)
  assert.equal((await terminalRun.json()).error.code, 'CHANGE_REQUEST_REVIEW_TERMINAL')
})

test('executor model flags wire into the run manager and unsafe values fail closed', async () => {
  const fixture = fixtureRoot()
  try {
    const routed = createConsoleServers({repositoryRoot: fixture.root, port: 0, previewPort: 0, executorModels: {impact: 'small-1', apply: 'strong-1'}})
    assert.deepEqual(routed.codexRunManager.models, {impact: 'small-1', apply: 'strong-1'})
    await routed.close()
    const defaulted = createConsoleServers({repositoryRoot: fixture.root, port: 0, previewPort: 0})
    assert.deepEqual(defaulted.codexRunManager.models, {impact: null, apply: null})
    await defaulted.close()
    assert.throws(
      () => createConsoleServers({repositoryRoot: fixture.root, port: 0, previewPort: 0, executorModels: {impact: '--danger'}}),
      error => error.code === 'EXECUTOR_MODEL_INVALID',
    )
  } finally {
    rmSync(fixture.root, {recursive: true, force: true})
  }
})

const previewFixtureRoot = () => {
  const fixture = fixtureRoot()
  const plan = join(fixture.project, '_workspace', '01_plan')
  const design = join(fixture.project, '_workspace', '02_design')
  const preview = join(design, 'preview')
  writeFileSync(join(plan, 'feature-plan.md'), '# Feature List\n\n## FEAT-001 Save item\n\n- TC-001-1: saves a valid item\n')
  writeFileSync(join(preview, 'index.html'), '<!doctype html><html><body><script type="module" src="app.js"></script></body></html>\n')
  writeFileSync(join(preview, 'tokens.css'), ':root { --primary: blue; }\n')
  writeFileSync(join(preview, 'app.css'), '.badge { color: var(--primary); }\n')
  writeFileSync(join(preview, 'store.js'), 'export const state = {}\n')
  writeFileSync(join(preview, 'router.js'), 'export const route = "#/items"\n')
  writeFileSync(join(preview, 'app.js'), 'document.body.innerHTML = `<button data-wh-anchor="wh-feat-001-save" data-wh-feature="FEAT-001" data-wh-tests="TC-001-1">Save</button>`\n')
  writeFileSync(join(preview, 'behaviors.md'), '| TC ID | Result |\n| --- | --- |\n| TC-001-1 | PASS |\n')
  writeFileSync(join(preview, 'traceability.json'), `${JSON.stringify({
    schemaVersion: 1,
    features: [{featureId: 'FEAT-001', title: 'Save item', testCaseIds: ['TC-001-1'], anchorIds: ['wh-feat-001-save']}],
    anchors: [{
      anchorId: 'wh-feat-001-save',
      featureId: 'FEAT-001',
      testCaseIds: ['TC-001-1'],
      label: 'Save button',
      route: '#/items',
      selector: '[data-wh-anchor="wh-feat-001-save"]',
      fixtureId: 'canonical-seed',
      fixtureMode: 'isolated-reset',
    }],
  }, null, 2)}\n`)
  writeSourceSnapshot(fixture.project)
  return fixture
}

test('preview approval endpoint records console-attested approval behind a digest race guard', async t => {
  const fixture = previewFixtureRoot()
  const servers = createConsoleServers({repositoryRoot: fixture.root, port: 0, previewPort: 0})
  const addresses = await servers.listen()
  t.after(async () => {
    await servers.close()
    rmSync(fixture.root, {recursive: true, force: true})
  })
  const consoleOrigin = `http://127.0.0.1:${addresses.consolePort}`
  const project = (await fetch(`${consoleOrigin}/api/projects`).then(response => response.json())).projects[0]
  assert.equal(project.preview.status, 'UNAPPROVED')
  const detail = await fetch(`${consoleOrigin}/api/projects/${project.id}`).then(response => response.json())
  const {sourceDigest, previewDigest} = detail.preview
  assert.match(sourceDigest, /^[0-9a-f]{64}$/)
  assert.match(previewDigest, /^[0-9a-f]{64}$/)
  const post = (body, headers = {}) => fetch(`${consoleOrigin}/api/projects/${project.id}/preview-approval`, {
    method: 'POST',
    headers: {'content-type': 'application/json', origin: consoleOrigin, 'x-web-harness-intent': 'record-preview-approval', ...headers},
    body: JSON.stringify(body),
  })
  const reviewPath = join(fixture.project, '_workspace', '02_design', 'design-review.md')

  assert.equal((await post({approvalText: 'ok', sourceDigest, previewDigest}, {origin: 'http://malicious.example'})).status, 403)
  assert.equal((await post({approvalText: 'ok', sourceDigest, previewDigest}, {'x-web-harness-intent': 'create-change-request'})).status, 403)
  assert.equal((await post({approvalText: '', sourceDigest, previewDigest})).status, 400)
  assert.equal((await post({approvalText: 'ok', sourceDigest: 'not-a-digest', previewDigest})).status, 400)
  const mismatch = await post({approvalText: '확인했습니다', sourceDigest: '0'.repeat(64), previewDigest})
  assert.equal(mismatch.status, 409)
  assert.equal((await mismatch.json()).error.code, 'PREVIEW_DIGEST_MISMATCH')
  assert.equal(existsSync(reviewPath), false)

  const approved = await post({approvalText: '프리뷰 동작을 확인했고 이 디자인으로 진행합니다', sourceDigest, previewDigest})
  assert.equal(approved.status, 201)
  const approvedBody = await approved.json()
  assert.equal(approvedBody.status, 'APPROVED')
  assert.equal(approvedBody.approval.recordedVia, 'console-user-attested')
  const review = readFileSync(reviewPath, 'utf8')
  assert.match(review, /console-user-attested/)
  assert.match(review, /web-harness-preview-approval/)

  const replay = await post({approvalText: '프리뷰 동작을 확인했고 이 디자인으로 진행합니다', sourceDigest, previewDigest})
  assert.equal(replay.status, 200)
  assert.equal((await replay.json()).status, 'APPROVED')
  assert.equal(review, readFileSync(reviewPath, 'utf8'))

  const conflicting = await post({approvalText: '다른 승인 문구', sourceDigest, previewDigest})
  assert.equal(conflicting.status, 409)
  assert.equal((await conflicting.json()).error.code, 'PREVIEW_NOT_APPROVABLE')

  const after = await fetch(`${consoleOrigin}/api/projects/${project.id}`).then(response => response.json())
  assert.equal(after.preview.status, 'APPROVED')
})

test('preview approval is rejected for STALE previews without writing a new record', async t => {
  const fixture = previewFixtureRoot()
  const servers = createConsoleServers({repositoryRoot: fixture.root, port: 0, previewPort: 0})
  const addresses = await servers.listen()
  t.after(async () => {
    await servers.close()
    rmSync(fixture.root, {recursive: true, force: true})
  })
  const consoleOrigin = `http://127.0.0.1:${addresses.consolePort}`
  const project = (await fetch(`${consoleOrigin}/api/projects`).then(response => response.json())).projects[0]
  const detail = await fetch(`${consoleOrigin}/api/projects/${project.id}`).then(response => response.json())
  const {sourceDigest, previewDigest} = detail.preview
  const post = body => fetch(`${consoleOrigin}/api/projects/${project.id}/preview-approval`, {
    method: 'POST',
    headers: {'content-type': 'application/json', origin: consoleOrigin, 'x-web-harness-intent': 'record-preview-approval'},
    body: JSON.stringify(body),
  })
  assert.equal((await post({approvalText: '승인합니다', sourceDigest, previewDigest})).status, 201)
  const reviewPath = join(fixture.project, '_workspace', '02_design', 'design-review.md')
  const reviewAfterApproval = readFileSync(reviewPath, 'utf8')

  const planPath = join(fixture.project, '_workspace', '01_plan', 'feature-plan.md')
  writeFileSync(planPath, '# Feature List changed\n\n## FEAT-001 Save item\n\n- TC-001-1: saves a valid item\n')
  await fetch(`${consoleOrigin}/api/projects?refresh=1`)
  const staleDetail = await fetch(`${consoleOrigin}/api/projects/${project.id}`).then(response => response.json())
  assert.equal(staleDetail.preview.status, 'STALE')

  const staleAttempt = await post({approvalText: '승인합니다', sourceDigest: staleDetail.preview.sourceDigest, previewDigest: staleDetail.preview.previewDigest})
  assert.equal(staleAttempt.status, 409)
  assert.equal((await staleAttempt.json()).error.code, 'PREVIEW_NOT_APPROVABLE')
  assert.equal(readFileSync(reviewPath, 'utf8'), reviewAfterApproval)
})

test('live-base start/stop is approval-gated, launch.json-scoped, and confirms child exit', async t => {
  const {createServer: createNetServer} = await import('node:net')
  const freePort = await new Promise(resolvePort => {
    const probe = createNetServer()
    probe.listen(0, '127.0.0.1', () => {
      const {port} = probe.address()
      probe.close(() => resolvePort(port))
    })
  })

  const fixture = fixtureRoot()
  // 라이브 대상 선언의 정본은 live.json이다 — 델타 킷 레거시 manifest 폴백은 제거됐다(2026-08-28).
  const previewDir = join(fixture.project, '_workspace', '02_design', 'preview')
  writeFileSync(join(previewDir, 'live.json'), JSON.stringify({target: `http://127.0.0.1:${freePort}`}))
  mkdirSync(join(fixture.root, '.claude'), {recursive: true})
  writeFileSync(join(fixture.root, '.claude', 'launch.json'), JSON.stringify({
    version: '0.0.1',
    configurations: [
      {name: 'test-base', runtimeExecutable: process.execPath, runtimeArgs: ['-e', `require('http').createServer((q, s) => s.end('ok')).listen(${freePort}, '127.0.0.1'); setInterval(() => {}, 1000)`], port: freePort},
      {name: 'wrong-port', runtimeExecutable: process.execPath, runtimeArgs: ['-e', ''], port: freePort + 1},
    ],
  }))

  const servers = createConsoleServers({repositoryRoot: fixture.root, port: 0, previewPort: 0})
  const addresses = await servers.listen()
  t.after(async () => {
    await servers.close()
    rmSync(fixture.root, {recursive: true, force: true})
  })
  const consoleOrigin = `http://127.0.0.1:${addresses.consolePort}`
  const projects = await fetch(`${consoleOrigin}/api/projects`).then(response => response.json())
  const projectId = projects.projects[0].id
  const control = (action, body, headers = {}) => fetch(`${consoleOrigin}/api/live-base/${action}`, {
    method: 'POST',
    headers: {'content-type': 'application/json', origin: consoleOrigin, 'x-web-harness-intent': `${action}-live-base`, ...headers},
    body: JSON.stringify(body),
  })

  // origin/intent 없는 blind POST는 프로세스 스폰 경로에 닿지 못한다.
  const blind = await fetch(`${consoleOrigin}/api/live-base/start`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({project: projectId, entry: 'test-base'}),
  })
  assert.equal(blind.status, 403)
  assert.equal((await blind.json()).error.code, 'LIVE_BASE_FORBIDDEN')

  // launch 항목 포트와 manifest target 포트가 다르면 거부된다.
  const mismatch = await control('start', {project: projectId, entry: 'wrong-port'})
  assert.equal(mismatch.status, 403)
  assert.equal((await mismatch.json()).error.code, 'ENTRY_PORT_MISMATCH')

  // 콘솔이 시작하지 않은 프로세스는 중지할 수 없다.
  const stopUnmanaged = await control('stop', {project: projectId})
  assert.equal(stopUnmanaged.status, 409)
  assert.equal((await stopUnmanaged.json()).error.code, 'NOT_CONSOLE_MANAGED')

  // 해피패스: 시작 → 대상 응답 + managed 노출 → 중지(종료 확인) → 대상 다운.
  const started = await control('start', {project: projectId, entry: 'test-base'})
  assert.equal(started.status, 202)
  assert.equal((await started.json()).entry, 'test-base')
  let healthy = false
  for (let attempt = 0; attempt < 20 && !healthy; attempt += 1) {
    await new Promise(resolveDelay => setTimeout(resolveDelay, 150))
    healthy = await fetch(`http://127.0.0.1:${freePort}/`).then(response => response.ok, () => false)
  }
  assert.equal(healthy, true)
  const health = await fetch(`${consoleOrigin}/api/live-base/health?project=${projectId}`).then(response => response.json())
  assert.equal(health.managed?.entry, 'test-base')
  const stopped = await control('stop', {project: projectId})
  assert.equal(stopped.status, 200)
  assert.equal((await stopped.json()).stopped, true)
  const downAgain = await fetch(`http://127.0.0.1:${freePort}/`).then(() => false, () => true)
  assert.equal(downAgain, true)
})


// 라이브 델타 승인 표면 제거(2026-08-28) 이후 남는 계약: live.json은 **운영 대상 선언**이며
// 깨진 JSON은 조용히 레거시로 대체되지 않는다. 종전에는 detail.livePreview로 관측했으나
// 그 필드가 사라져 health 엔드포인트로 옮긴다.
test('깨진 live.json은 침묵 강등하지 않고 loud fail한다', async t => {
  const fixture = fixtureRoot()
  const previewDir = join(fixture.project, '_workspace', '02_design', 'preview')
  mkdirSync(previewDir, {recursive: true})
  writeFileSync(join(previewDir, 'live.json'), '{ broken json')

  const servers = createConsoleServers({repositoryRoot: fixture.root, port: 0, previewPort: 0})
  const addresses = await servers.listen()
  t.after(() => servers.close())
  const consoleOrigin = `http://127.0.0.1:${addresses.consolePort}`
  const projectId = (await fetch(`${consoleOrigin}/api/projects`).then(response => response.json()))
    .projects[0].id

  const health = await fetch(`${consoleOrigin}/api/live-base/health?project=${projectId}`)
    .then(response => response.json())
  assert.equal(health.configured, false)
  assert.equal(health.error, 'INVALID_LIVE_CONFIG')
})

// preview-resnapshot — 신설 mutating endpoint. harness-change-reviewer HIGH(테스트 0건) 반영.
test('preview resnapshot requires origin, intent, attestation, a matching digest, and real changes', async t => {
  const fixture = previewFixtureRoot()
  const servers = createConsoleServers({repositoryRoot: fixture.root, port: 0, previewPort: 0})
  const addresses = await servers.listen()
  t.after(async () => {
    await servers.close()
    rmSync(fixture.root, {recursive: true, force: true})
  })
  const consoleOrigin = `http://127.0.0.1:${addresses.consolePort}`
  const project = (await fetch(`${consoleOrigin}/api/projects`).then(response => response.json())).projects[0]
  const url = `${consoleOrigin}/api/projects/${project.id}/preview-resnapshot`
  const post = (body, {origin = consoleOrigin, intent = 'resnapshot-preview'} = {}) => fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(origin ? {origin} : {}),
      ...(intent ? {'x-web-harness-intent': intent} : {}),
    },
    body: JSON.stringify(body),
  })
  const digestNow = async () => {
    await fetch(`${consoleOrigin}/api/projects?refresh=1`)
    return (await fetch(`${consoleOrigin}/api/projects/${project.id}`).then(response => response.json())).preview.sourceDigest
  }

  // 스냅샷이 방금 고정됐으므로 아직 STALE이 아니다.
  const fresh = await post({attested: true, sourceDigest: await digestNow()})
  assert.equal(fresh.status, 409)
  assert.equal((await fresh.json()).error.code, 'PREVIEW_NOT_RESNAPSHOTTABLE')

  // 스펙을 바꿔 SOURCE_CHANGED를 만든다.
  writeFileSync(join(fixture.project, '_workspace', '01_plan', 'feature-plan.md'),
    '# Feature List\n\n## FEAT-001 Save item\n\n- TC-001-1: saves a valid item and shows a toast\n')
  // 목록은 캐시된 스캔이라 디스크 변경 뒤에는 rescan이 필요하다(콘솔의 '디스크 새로고침').
  await fetch(`${consoleOrigin}/api/projects?refresh=1`)
  const detail = await fetch(`${consoleOrigin}/api/projects/${project.id}`).then(response => response.json())
  assert.equal(detail.preview.status, 'STALE')
  assert.equal(detail.preview.reason, 'SOURCE_CHANGED')
  assert.equal(detail.preview.changedSources.length, 1)
  const sourceDigest = detail.preview.sourceDigest

  assert.equal((await post({attested: true, sourceDigest}, {intent: null})).status, 403)
  assert.equal((await post({attested: true, sourceDigest}, {origin: 'http://evil.example'})).status, 403)
  const notAttested = await post({sourceDigest})
  assert.equal(notAttested.status, 400)
  assert.equal((await notAttested.json()).error.code, 'PREVIEW_RESNAPSHOT_NOT_ATTESTED')
  const mismatch = await post({attested: true, sourceDigest: 'a'.repeat(64)})
  assert.equal(mismatch.status, 409)
  assert.equal((await mismatch.json()).error.code, 'PREVIEW_SOURCE_DIGEST_MISMATCH')

  // 여기까지 어떤 거절도 상태를 바꾸지 않았다.
  await fetch(`${consoleOrigin}/api/projects?refresh=1`)
  assert.equal((await fetch(`${consoleOrigin}/api/projects/${project.id}`).then(r => r.json())).preview.status, 'STALE')

  const ok = await post({attested: true, sourceDigest})
  assert.equal(ok.status, 201)
  const body = await ok.json()
  assert.equal(body.status, 'UNAPPROVED')
  assert.equal(body.attestedChangedFiles, 1)

  // 재고정 뒤에는 제시할 변경이 없으므로 증언을 수리하지 않는다(공허 통과 차단).
  const empty = await post({attested: true, sourceDigest: await digestNow()})
  assert.equal(empty.status, 409)
  assert.ok(['PREVIEW_NOT_RESNAPSHOTTABLE', 'PREVIEW_NO_SOURCE_CHANGES'].includes((await empty.json()).error.code))
})
