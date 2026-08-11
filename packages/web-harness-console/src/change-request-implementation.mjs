// 구현 검증 레코드 — 원칙 4(승인 충실, docs/brownfield-adoption.md)의 마지막 고리.
// 승인(APPROVED)된 Change Request의 featureLinks.affectedTestCaseIds와 **같은 TC ID**의
// 구현 테스트 통과 증거를 append-only로 기록한다. 증거는 자기진술 프록시다
// (protected-core §4) — 명령·요약·시각을 담을 의무는 기록자 몫이며, 실질 진실은
// 증거가 가리키는 테스트 실행이다.
import {constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {join, sep} from 'node:path'

const IMPLEMENTATION_DIRECTORY = 'change-request-implementation'
const REQUEST_ID_PATTERN = /^CHG-\d{8}-\d{3}$/
const TEST_CASE_PATTERN = /^TC-\d{3,}-\d+$/
const IDEMPOTENCY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_EVIDENCE_LENGTH = 300
const MAX_COMMAND_LENGTH = 300
const MAX_EVENT_FILE_BYTES = 128 * 1024
const MAX_EVENTS = 64
const MAX_TEST_CASES = 128

export class ImplementationVerificationError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'ImplementationVerificationError'
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
  if (real !== projectRoot && !real.startsWith(projectRoot + sep)) {
    throw new ImplementationVerificationError('UNSAFE_IMPLEMENTATION_PATH', 'Implementation verification path is outside the project boundary', 409)
  }
  return real
}

const implementationRoot = (projectRoot, {create = false} = {}) => {
  const root = realpathSync(projectRoot)
  const workspace = join(root, '_workspace')
  const development = join(workspace, '03_dev')
  if (create) {
    if (!safeDirectory(workspace)) throw new ImplementationVerificationError('WORKSPACE_DIRECTORY_NOT_FOUND', 'Project workspace is unavailable', 409)
    assertContained(workspace, root)
    for (const directory of [development, join(development, IMPLEMENTATION_DIRECTORY)]) {
      try {
        mkdirSync(directory, {mode: 0o700})
      } catch (error) {
        if (error.code !== 'EEXIST') throw new ImplementationVerificationError('IMPLEMENTATION_DIRECTORY_FAILED', 'Implementation verification directory could not be created', 409)
      }
      if (!safeDirectory(directory)) throw new ImplementationVerificationError('UNSAFE_IMPLEMENTATION_PATH', 'Implementation verification directory is unsafe', 409)
      assertContained(directory, root)
    }
  }
  const directory = join(development, IMPLEMENTATION_DIRECTORY)
  return safeDirectory(directory) ? assertContained(directory, root) : null
}

const boundedLine = (value, field, max) => {
  if (typeof value !== 'string') throw new ImplementationVerificationError('INVALID_IMPLEMENTATION_VERIFICATION', `${field} is required`)
  const line = value.trim()
  if (!line || line.includes('\n') || line.length > max) {
    throw new ImplementationVerificationError('INVALID_IMPLEMENTATION_VERIFICATION', `${field} must be a single line of at most ${max} characters`)
  }
  return line
}

const readEventFile = (projectRoot, changeRequestId) => {
  if (!REQUEST_ID_PATTERN.test(changeRequestId)) return []
  const directory = implementationRoot(projectRoot)
  if (!directory) return []
  const path = join(directory, `${changeRequestId}.jsonl`)
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_EVENT_FILE_BYTES) return []
    assertContained(path, realpathSync(projectRoot))
    return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).slice(0, MAX_EVENTS).flatMap(line => {
      try {
        const event = JSON.parse(line)
        const valid = event?.schemaVersion === 1
          && event.changeRequestId === changeRequestId
          && typeof event.eventId === 'string'
          && Array.isArray(event.testCaseIds)
          && event.testCaseIds.length > 0
          && event.testCaseIds.length <= MAX_TEST_CASES
          && event.testCaseIds.every(id => typeof id === 'string' && TEST_CASE_PATTERN.test(id))
          && typeof event.evidence === 'string' && event.evidence.length <= MAX_EVIDENCE_LENGTH
          && (event.command === null || (typeof event.command === 'string' && event.command.length <= MAX_COMMAND_LENGTH))
          && IDEMPOTENCY_PATTERN.test(event.idempotencyKey ?? '')
          && Number.isFinite(Date.parse(event.createdAt))
        return valid ? [event] : []
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

const publicEvent = value => {
  const {idempotencyKey: _idempotencyKey, ...event} = value
  return event
}

export const listImplementationVerifications = (projectRoot, changeRequestId) => readEventFile(projectRoot, changeRequestId)

// 승인된 TC 집합 대비 검증 커버리지 요약 — 콘솔 파생 표시용.
export const summarizeImplementationVerification = (projectRoot, request) => {
  const approval = request.latestReviewDecision?.decision === 'APPROVED' ? request.latestReviewDecision : null
  const approvedTestCaseIds = approval?.featureLinks?.affectedTestCaseIds ?? []
  if (!approval) return null
  const events = readEventFile(projectRoot, request.id)
  const covered = new Set(events.flatMap(event => event.testCaseIds))
  const missing = approvedTestCaseIds.filter(id => !covered.has(id))
  return {
    approvedTestCaseIds,
    coveredTestCaseIds: approvedTestCaseIds.filter(id => covered.has(id)),
    missingTestCaseIds: missing,
    complete: approvedTestCaseIds.length > 0 && missing.length === 0,
    events: events.map(publicEvent),
  }
}

export const recordImplementationVerification = (projectRoot, request, input, {idempotencyKey, now = new Date(), uuid = randomUUID} = {}) => {
  if (!IDEMPOTENCY_PATTERN.test(idempotencyKey ?? '')) throw new ImplementationVerificationError('INVALID_IDEMPOTENCY_KEY', 'A UUID Idempotency-Key is required')
  if (!request || !REQUEST_ID_PATTERN.test(request.id ?? '')) throw new ImplementationVerificationError('CHANGE_REQUEST_NOT_FOUND', 'Change Request was not found', 404)
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ImplementationVerificationError('INVALID_IMPLEMENTATION_VERIFICATION', 'Request body must be an object')
  if (Object.keys(input).some(field => !['testCaseIds', 'evidence', 'command'].includes(field))) {
    throw new ImplementationVerificationError('INVALID_IMPLEMENTATION_VERIFICATION', 'Body contains unsupported fields')
  }

  // 원칙 4의 기계 판정: 승인 없이는 기록 불가, TC는 승인된 ID의 부분집합만.
  const approval = request.latestReviewDecision?.decision === 'APPROVED' ? request.latestReviewDecision : null
  if (!approval) throw new ImplementationVerificationError('IMPLEMENTATION_NOT_APPROVED', 'Implementation verification requires an APPROVED Change Request', 409)
  const approvedTestCaseIds = new Set(approval.featureLinks?.affectedTestCaseIds ?? [])
  if (approvedTestCaseIds.size === 0) throw new ImplementationVerificationError('IMPLEMENTATION_SCOPE_UNAVAILABLE', 'Approved Change Request has no linked test cases', 409)

  const testCaseIds = [...new Set(input.testCaseIds ?? [])]
  if (testCaseIds.length === 0 || testCaseIds.length > MAX_TEST_CASES || testCaseIds.some(id => typeof id !== 'string' || !TEST_CASE_PATTERN.test(id))) {
    throw new ImplementationVerificationError('INVALID_IMPLEMENTATION_VERIFICATION', 'testCaseIds must be a non-empty list of TC IDs')
  }
  const outsideApproval = testCaseIds.filter(id => !approvedTestCaseIds.has(id))
  if (outsideApproval.length > 0) {
    throw new ImplementationVerificationError('IMPLEMENTATION_SCOPE_MISMATCH', `Test cases are not part of the approved scope: ${outsideApproval.join(', ')}`, 409)
  }
  const evidence = boundedLine(input.evidence, 'evidence', MAX_EVIDENCE_LENGTH)
  const command = input.command === undefined || input.command === null ? null : boundedLine(input.command, 'command', MAX_COMMAND_LENGTH)

  const history = readEventFile(projectRoot, request.id)
  const existing = history.find(event => event.idempotencyKey === idempotencyKey)
  if (existing) return {created: false, verification: publicEvent(existing)}
  if (history.length >= MAX_EVENTS) throw new ImplementationVerificationError('IMPLEMENTATION_EVENT_LIMIT', 'Implementation verification history is full', 409)

  const event = {
    schemaVersion: 1,
    eventId: `IMPL-${request.id}-${uuid()}`,
    changeRequestId: request.id,
    testCaseIds,
    evidence,
    command,
    createdAt: now.toISOString(),
    idempotencyKey,
  }
  const directory = implementationRoot(projectRoot, {create: true})
  const path = join(directory, `${event.changeRequestId}.jsonl`)
  let descriptor
  try {
    descriptor = openSync(path, constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
    if (fstatSync(descriptor).size > MAX_EVENT_FILE_BYTES) throw new ImplementationVerificationError('IMPLEMENTATION_EVENT_LIMIT', 'Implementation verification history is full', 409)
    writeSync(descriptor, `${JSON.stringify(event)}\n`, null, 'utf8')
  } catch (error) {
    if (error instanceof ImplementationVerificationError) throw error
    throw new ImplementationVerificationError('IMPLEMENTATION_WRITE_FAILED', 'Implementation verification could not be recorded', 409)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
  return {created: true, verification: publicEvent(event)}
}
