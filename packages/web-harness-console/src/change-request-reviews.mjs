import {constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {join, sep} from 'node:path'

const REVIEW_DIRECTORY = 'change-request-decisions'
const REQUEST_ID_PATTERN = /^CHG-\d{8}-\d{3}$/
const RUN_ID_PATTERN = /^RUN-CHG-\d{8}-\d{3}-apply-[0-9a-f-]{36}$/i
const IDEMPOTENCY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const FEATURE_PATTERN = /^FEAT-\d{3,}$/
const SUB_FEATURE_PATTERN = /^FEAT-\d{3,}-\d{2}$/
const TEST_CASE_PATTERN = /^TC-\d{3,}-\d+$/
const DIGEST_PATTERN = /^[0-9a-f]{64}$/
const DECISIONS = new Set(['APPROVED', 'REVISION_REQUESTED', 'DISCARDED'])
const TERMINAL_DECISIONS = new Set(['APPROVED', 'DISCARDED'])
const MAX_REASON_LENGTH = 2000
const MAX_EVENT_FILE_BYTES = 128 * 1024
const MAX_EVENTS = 64

export class ChangeRequestReviewError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'ChangeRequestReviewError'
    this.code = code
    this.status = status
  }
}

const safeDirectory = path => {
  try {
    const stat = lstatSync(path)
    return stat.isDirectory() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

const assertContained = (path, projectRoot) => {
  const real = realpathSync(path)
  if (real !== projectRoot && !real.startsWith(projectRoot + sep)) throw new ChangeRequestReviewError('UNSAFE_REVIEW_PATH', 'Review decision path is outside the project boundary', 409)
  return real
}

const reviewRoot = (projectRoot, {create = false} = {}) => {
  const root = realpathSync(projectRoot)
  const workspace = join(root, '_workspace')
  const development = join(workspace, '03_dev')
  if (create) {
    if (!safeDirectory(workspace)) throw new ChangeRequestReviewError('WORKSPACE_DIRECTORY_NOT_FOUND', 'Project workspace is unavailable', 409)
    assertContained(workspace, root)
    for (const directory of [development, join(development, REVIEW_DIRECTORY)]) {
      try {
        mkdirSync(directory, {mode: 0o700})
      } catch (error) {
        if (error.code !== 'EEXIST') throw new ChangeRequestReviewError('REVIEW_DIRECTORY_FAILED', 'Review decision directory could not be created', 409)
      }
      if (!safeDirectory(directory)) throw new ChangeRequestReviewError('UNSAFE_REVIEW_PATH', 'Review decision directory is unsafe', 409)
      assertContained(directory, root)
    }
  }
  const directory = join(development, REVIEW_DIRECTORY)
  return safeDirectory(directory) ? assertContained(directory, root) : null
}

const publicDecision = value => {
  const {idempotencyKey: _idempotencyKey, ...decision} = value
  return decision
}

const validIdentifierList = (value, pattern, maxItems) => Array.isArray(value)
  && value.length <= maxItems
  && value.every(item => typeof item === 'string' && pattern.test(item))

const validFeatureLinks = value => value && typeof value === 'object'
  // targetless CR(bootstrap·newFeature)의 승인은 targetFeatureId가 null이다 — 읽기
  // 검증이 이를 거부하면 기록된 종결 이벤트가 조용히 탈락해 재승인 차단이 무력화된다
  // (2026-08-11 실측 결함). null은 targetSubFeatureId도 null일 때만 허용한다.
  && (value.targetFeatureId === null ? value.targetSubFeatureId === null : FEATURE_PATTERN.test(value.targetFeatureId ?? ''))
  && (value.targetSubFeatureId === null || SUB_FEATURE_PATTERN.test(value.targetSubFeatureId ?? ''))
  && validIdentifierList(value.affectedFeatureIds, FEATURE_PATTERN, 64)
  && validIdentifierList(value.affectedSubFeatureIds, SUB_FEATURE_PATTERN, 64)
  && validIdentifierList(value.affectedTestCaseIds, TEST_CASE_PATTERN, 128)
  && ['apply-result', 'request-context-legacy'].includes(value.scopeSource)
  && ['current-catalog', 'apply-result', 'request-base', 'unavailable'].includes(value.digestSource)
  && (value.sourceDigest === null || DIGEST_PATTERN.test(value.sourceDigest ?? ''))
  && (value.previewDigest === null || DIGEST_PATTERN.test(value.previewDigest ?? ''))

const readDecisionFile = (projectRoot, changeRequestId, {strict = false} = {}) => {
  if (!REQUEST_ID_PATTERN.test(changeRequestId)) return []
  const directory = reviewRoot(projectRoot)
  if (!directory) return []
  const path = join(directory, `${changeRequestId}.jsonl`)
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_EVENT_FILE_BYTES) {
      if (strict) throw new ChangeRequestReviewError('REVIEW_HISTORY_INVALID', 'Review decision history is unsafe or oversized', 409)
      return []
    }
    assertContained(path, realpathSync(projectRoot))
    return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).slice(0, MAX_EVENTS).flatMap(line => {
      try {
        const event = JSON.parse(line)
        const valid = event?.schemaVersion === 1
          && event.changeRequestId === changeRequestId
          && typeof event.eventId === 'string'
          && DECISIONS.has(event.decision)
          && RUN_ID_PATTERN.test(event.applyRunId ?? '')
          && IDEMPOTENCY_PATTERN.test(event.idempotencyKey ?? '')
          && typeof event.reason === 'string'
          && event.reason.length <= MAX_REASON_LENGTH
          && Number.isFinite(Date.parse(event.createdAt))
          && (event.featureLinks === undefined || validFeatureLinks(event.featureLinks))
        if (!valid) {
          if (strict) throw new ChangeRequestReviewError('REVIEW_HISTORY_INVALID', 'Review decision history contains an invalid event', 409)
          return []
        }
        return [event]
      } catch (error) {
        if (strict) throw error instanceof ChangeRequestReviewError ? error : new ChangeRequestReviewError('REVIEW_HISTORY_INVALID', 'Review decision history contains malformed JSON', 409)
        return []
      }
    })
  } catch (error) {
    if (error.code === 'ENOENT') return []
    if (strict) throw error instanceof ChangeRequestReviewError ? error : new ChangeRequestReviewError('REVIEW_HISTORY_INVALID', 'Review decision history could not be verified', 409)
    return []
  }
}

export const listChangeRequestReviews = (projectRoot, changeRequestId, {strict = false} = {}) => readDecisionFile(projectRoot, changeRequestId, {strict})
  .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  .map(publicDecision)

const normalizeReason = (value, decision) => {
  if (value === undefined || value === null) value = ''
  if (typeof value !== 'string' || value.includes('\0')) throw new ChangeRequestReviewError('INVALID_REVIEW_DECISION', 'reason must be a string')
  const reason = value.trim()
  if (reason.length > MAX_REASON_LENGTH) throw new ChangeRequestReviewError('INVALID_REVIEW_DECISION', `reason must be at most ${MAX_REASON_LENGTH} characters`)
  if (decision !== 'APPROVED' && !reason) throw new ChangeRequestReviewError('INVALID_REVIEW_DECISION', 'reason is required for revision or discard')
  return reason
}

const normalizeIdentifiers = (value, pattern, field, maxItems) => {
  if (!Array.isArray(value) || value.length > maxItems || value.some(item => typeof item !== 'string' || !pattern.test(item))) {
    throw new ChangeRequestReviewError('REVIEW_SCOPE_INVALID', `${field} contains an invalid identifier`, 409)
  }
  return [...new Set(value)]
}

const normalizeDigest = (value, field) => {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) throw new ChangeRequestReviewError('REVIEW_SCOPE_INVALID', `${field} is invalid`, 409)
  return value
}

const featureLinksForApproval = (request, applyRun, {features = [], preview = null} = {}) => {
  const targetFeatureId = request.context?.featureId
  const targetSubFeatureId = request.context?.subFeatureId ?? null
  // 대상 없는 CR(bootstrap·newFeature)의 승인은 "신설 FEAT" 연결이다 — apply 결과의
  // 구조화 범위가 필수이며, 신설 id(canonical 밖)가 최소 1개 있어야 한다. 일반 CR의
  // 검증(대상 실존·포함·unknown 거부)은 아래에서 문자 그대로 유지된다.
  const targetless = !targetFeatureId && (request.context?.bootstrap === true || request.context?.newFeature === true)
  if (!targetless && (!FEATURE_PATTERN.test(targetFeatureId ?? '') || (targetSubFeatureId && !SUB_FEATURE_PATTERN.test(targetSubFeatureId)))) {
    throw new ChangeRequestReviewError('REVIEW_SCOPE_INVALID', 'Change Request target context is invalid', 409)
  }
  const result = applyRun.result ?? {}
  const hasStructuredScope = Array.isArray(result.affectedFeatureIds) && result.affectedFeatureIds.length > 0
  if (targetless && !hasStructuredScope) {
    throw new ChangeRequestReviewError('REVIEW_SCOPE_INVALID', 'Targetless approval requires structured affectedFeatureIds from the apply result', 409)
  }
  const affectedFeatureIds = hasStructuredScope
    ? normalizeIdentifiers(result.affectedFeatureIds, FEATURE_PATTERN, 'affectedFeatureIds', 64)
    : [targetFeatureId]
  const affectedSubFeatureIds = hasStructuredScope
    ? normalizeIdentifiers(result.affectedSubFeatureIds ?? [], SUB_FEATURE_PATTERN, 'affectedSubFeatureIds', 64)
    : targetSubFeatureId ? [targetSubFeatureId] : []
  const affectedTestCaseIds = hasStructuredScope
    ? normalizeIdentifiers(result.affectedTestCaseIds ?? [], TEST_CASE_PATTERN, 'affectedTestCaseIds', 128)
    : normalizeIdentifiers(request.context?.testCaseIds ?? [], TEST_CASE_PATTERN, 'context.testCaseIds', 128)
  if (!targetless && !affectedFeatureIds.includes(targetFeatureId)) {
    throw new ChangeRequestReviewError('REVIEW_TARGET_MISMATCH', 'Apply result does not include the Change Request target Feature', 409)
  }
  // 이 검증은 승격(promotion) 이후의 재인덱스된 canonical을 기준으로 실행된다 —
  // targetless의 신설 FEAT도 승격 뒤에는 canonical에 존재해야 하므로 unknown/소유
  // 검사는 일반 CR과 동일하게 적용한다(신설 여부 자체는 승격 diff의 인간 검토 몫).
  const featureMap = new Map(features.map(feature => [feature.featureId, feature]))
  if (featureMap.size > 0 && affectedFeatureIds.some(featureId => !featureMap.has(featureId))) {
    throw new ChangeRequestReviewError('REVIEW_SCOPE_INVALID', 'Apply result references an unknown Feature', 409)
  }
  for (const subFeatureId of affectedSubFeatureIds) {
    const parentId = subFeatureId.match(/^(FEAT-\d{3,})-/)?.[1]
    const known = featureMap.size === 0 || featureMap.get(parentId)?.subFeatures?.some(item => item.subFeatureId === subFeatureId)
    if (!affectedFeatureIds.includes(parentId) || !known) throw new ChangeRequestReviewError('REVIEW_SCOPE_INVALID', 'Apply result references an unknown or unowned Sub Feature', 409)
  }

  const resultSourceDigest = normalizeDigest(result.sourceDigest, 'sourceDigest')
  const resultPreviewDigest = normalizeDigest(result.previewDigest, 'previewDigest')
  const catalogSourceDigest = normalizeDigest(preview?.sourceDigest, 'catalog sourceDigest')
  const catalogPreviewDigest = normalizeDigest(preview?.previewDigest, 'catalog previewDigest')
  if (resultSourceDigest && catalogSourceDigest && resultSourceDigest !== catalogSourceDigest) {
    throw new ChangeRequestReviewError('REVIEW_DIGEST_MISMATCH', 'Apply source digest does not match the current catalog', 409)
  }
  if (resultPreviewDigest && catalogPreviewDigest && resultPreviewDigest !== catalogPreviewDigest) {
    throw new ChangeRequestReviewError('REVIEW_DIGEST_MISMATCH', 'Apply preview digest does not match the current catalog', 409)
  }
  const requestSourceDigest = normalizeDigest(request.context?.sourceDigest, 'request sourceDigest')
  const requestPreviewDigest = normalizeDigest(request.context?.previewDigest, 'request previewDigest')
  const digestSource = catalogSourceDigest || catalogPreviewDigest
    ? 'current-catalog'
    : resultSourceDigest || resultPreviewDigest
      ? 'apply-result'
      : requestSourceDigest || requestPreviewDigest
        ? 'request-base'
        : 'unavailable'
  return {
    targetFeatureId,
    targetSubFeatureId,
    affectedFeatureIds,
    affectedSubFeatureIds,
    affectedTestCaseIds,
    sourceDigest: catalogSourceDigest ?? resultSourceDigest ?? requestSourceDigest,
    previewDigest: catalogPreviewDigest ?? resultPreviewDigest ?? requestPreviewDigest,
    scopeSource: hasStructuredScope ? 'apply-result' : 'request-context-legacy',
    digestSource,
  }
}

const appendEvent = (projectRoot, event) => {
  const directory = reviewRoot(projectRoot, {create: true})
  const path = join(directory, `${event.changeRequestId}.jsonl`)
  let descriptor
  try {
    descriptor = openSync(path, constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
    if (fstatSync(descriptor).size > MAX_EVENT_FILE_BYTES) throw new ChangeRequestReviewError('REVIEW_EVENT_LIMIT', 'Review decision history is full', 409)
    writeSync(descriptor, `${JSON.stringify(event)}\n`, null, 'utf8')
  } catch (error) {
    if (error instanceof ChangeRequestReviewError) throw error
    throw new ChangeRequestReviewError('REVIEW_DECISION_WRITE_FAILED', 'Review decision could not be recorded', 409)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

export const prepareChangeRequestReview = (projectRoot, request, input, {idempotencyKey, applyRun, now = new Date(), uuid = randomUUID} = {}) => {
  if (!IDEMPOTENCY_PATTERN.test(idempotencyKey ?? '')) throw new ChangeRequestReviewError('INVALID_IDEMPOTENCY_KEY', 'A UUID Idempotency-Key is required')
  if (!request || !REQUEST_ID_PATTERN.test(request.id ?? '')) throw new ChangeRequestReviewError('CHANGE_REQUEST_NOT_FOUND', 'Change Request was not found', 404)
  const history = readDecisionFile(projectRoot, request.id, {strict: true})
  const existing = history.find(event => event.idempotencyKey === idempotencyKey)
  if (existing) return {replay: {created: false, reviewDecision: publicDecision(existing)}, event: null}
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(field => !['decision', 'reason'].includes(field))) {
    throw new ChangeRequestReviewError('INVALID_REVIEW_DECISION', 'Review decision body contains unsupported fields')
  }
  if (!DECISIONS.has(input.decision)) throw new ChangeRequestReviewError('INVALID_REVIEW_DECISION', 'decision must be APPROVED, REVISION_REQUESTED, or DISCARDED')
  const reason = normalizeReason(input.reason, input.decision)
  if (!applyRun || applyRun.changeRequestId !== request.id || applyRun.phase !== 'apply' || applyRun.status !== 'COMPLETED' || applyRun.result?.outcome !== 'READY_FOR_REVIEW') {
    throw new ChangeRequestReviewError('REVIEW_NOT_READY', 'A completed READY_FOR_REVIEW apply run is required', 409)
  }
  if (history.length >= MAX_EVENTS) throw new ChangeRequestReviewError('REVIEW_EVENT_LIMIT', 'Review decision history is full', 409)
  if (history.some(event => TERMINAL_DECISIONS.has(event.decision))) throw new ChangeRequestReviewError('REVIEW_ALREADY_TERMINAL', 'This Change Request already has a terminal review decision', 409)
  if (history.some(event => event.applyRunId === applyRun.runId)) throw new ChangeRequestReviewError('REVIEW_ALREADY_RECORDED', 'This apply result already has a review decision', 409)

  return {
    replay: null,
    event: {
      schemaVersion: 1,
      eventId: `DEC-${request.id}-${uuid()}`,
      changeRequestId: request.id,
      applyRunId: applyRun.runId,
      decision: input.decision,
      reason,
      createdAt: now.toISOString(),
      idempotencyKey,
    },
  }
}

export const commitChangeRequestReview = (projectRoot, event, {request, applyRun, features = [], preview = null} = {}) => {
  if (event.decision === 'APPROVED') event.featureLinks = featureLinksForApproval(request, applyRun, {features, preview})
  appendEvent(projectRoot, event)
  return {created: true, reviewDecision: publicDecision(event)}
}

export const recordChangeRequestReview = (projectRoot, request, input, {idempotencyKey, applyRun, features = [], preview = null, now = new Date(), uuid = randomUUID} = {}) => {
  const prepared = prepareChangeRequestReview(projectRoot, request, input, {idempotencyKey, applyRun, now, uuid})
  if (prepared.replay) return prepared.replay
  return commitChangeRequestReview(projectRoot, prepared.event, {request, applyRun, features, preview})
}

export const changeRequestReviewConstants = {DECISIONS, IDEMPOTENCY_PATTERN, MAX_EVENTS, MAX_REASON_LENGTH, TERMINAL_DECISIONS}
