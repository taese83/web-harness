import {createHash} from 'node:crypto'
import {mkdirSync, lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync} from 'node:fs'
import {join, sep} from 'node:path'

const CHANGE_REQUEST_DIRECTORY = 'change-requests'
const CHANGE_REQUEST_REVISION_DIRECTORY = 'change-request-revisions'
const CHANGE_REQUEST_FILE = /^CHG-(\d{8})-(\d{3})\.md$/
const CHANGE_REQUEST_REVISION_FILE = /^(CHG-\d{8}-\d{3})-REV-(\d{3})\.md$/
const METADATA_MARKER = /<!-- web-harness-change-request:([A-Za-z0-9_-]+) -->/
const REVISION_METADATA_MARKER = /<!-- web-harness-change-request-revision:([A-Za-z0-9_-]+) -->/
const MAX_REQUEST_FILES = 999
const MAX_REQUEST_REVISIONS = 999
const MAX_FIELD_LENGTH = 2000
const ID_PATTERN = /^CHG-\d{8}-\d{3}$/
const FEATURE_PATTERN = /^FEAT-\d{3,}$/
const SUB_FEATURE_PATTERN = /^FEAT-\d{3,}-\d{2}$/
const ANCHOR_PATTERN = /^wh-feat-[a-z0-9-]+$/
const IDEMPOTENCY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const VERSION_INTENTS = new Set(['patch', 'minor', 'major'])
const REVISION_FIELDS = new Set(['title', 'requestedChange', 'reason', 'expectedBehavior', 'versionIntent'])

export class ChangeRequestError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'ChangeRequestError'
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

const assertContainedDirectory = (path, projectRoot, code) => {
  if (!safeDirectory(path)) throw new ChangeRequestError(code, 'Required planning directory is unavailable', 409)
  const real = realpathSync(path)
  if (real !== projectRoot && !real.startsWith(projectRoot + sep)) throw new ChangeRequestError('UNSAFE_CHANGE_REQUEST_PATH', 'Change request directory is outside the project boundary', 409)
  return real
}

const changeRequestRoot = (projectRoot, {create = false} = {}) => {
  const workspacePath = join(projectRoot, '_workspace')
  const planPath = join(workspacePath, '01_plan')
  if (!create && (!safeDirectory(workspacePath) || !safeDirectory(planPath))) return null
  const workspace = assertContainedDirectory(workspacePath, projectRoot, 'WORKSPACE_DIRECTORY_NOT_FOUND')
  const plan = assertContainedDirectory(planPath, projectRoot, 'PLAN_DIRECTORY_NOT_FOUND')
  const directory = join(plan, CHANGE_REQUEST_DIRECTORY)
  if (create) {
    try {
      mkdirSync(directory, {mode: 0o700})
    } catch (error) {
      if (error.code !== 'EEXIST') throw new ChangeRequestError('CHANGE_REQUEST_DIRECTORY_FAILED', 'Change request directory could not be created', 409)
    }
    if (!safeDirectory(directory)) throw new ChangeRequestError('UNSAFE_CHANGE_REQUEST_PATH', 'Change request directory is not a safe directory', 409)
  }
  return safeDirectory(directory) ? assertContainedDirectory(directory, projectRoot, 'UNSAFE_CHANGE_REQUEST_PATH') : null
}

const changeRequestRevisionRoot = (projectRoot, {create = false} = {}) => {
  const workspacePath = join(projectRoot, '_workspace')
  const planPath = join(workspacePath, '01_plan')
  if (!create && (!safeDirectory(workspacePath) || !safeDirectory(planPath))) return null
  assertContainedDirectory(workspacePath, projectRoot, 'WORKSPACE_DIRECTORY_NOT_FOUND')
  const plan = assertContainedDirectory(planPath, projectRoot, 'PLAN_DIRECTORY_NOT_FOUND')
  const directory = join(plan, CHANGE_REQUEST_REVISION_DIRECTORY)
  if (create) {
    try {
      mkdirSync(directory, {mode: 0o700})
    } catch (error) {
      if (error.code !== 'EEXIST') throw new ChangeRequestError('CHANGE_REQUEST_REVISION_DIRECTORY_FAILED', 'Change request revision directory could not be created', 409)
    }
    if (!safeDirectory(directory)) throw new ChangeRequestError('UNSAFE_CHANGE_REQUEST_PATH', 'Change request revision directory is not a safe directory', 409)
  }
  return safeDirectory(directory) ? assertContainedDirectory(directory, projectRoot, 'UNSAFE_CHANGE_REQUEST_PATH') : null
}

const decodeMetadata = source => {
  const encoded = source.match(METADATA_MARKER)?.[1]
  if (!encoded) return null
  try {
    const metadata = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    if (metadata?.schemaVersion !== 1 || !ID_PATTERN.test(metadata.id) || metadata.status !== 'PROPOSED') return null
    return metadata
  } catch {
    return null
  }
}

const decodeRevisionMetadata = source => {
  const encoded = source.match(REVISION_METADATA_MARKER)?.[1]
  if (!encoded) return null
  try {
    const metadata = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    if (metadata?.schemaVersion !== 1 || !ID_PATTERN.test(metadata.changeRequestId) || !CHANGE_REQUEST_REVISION_FILE.test(`${metadata.revisionId}.md`)) return null
    return metadata
  } catch {
    return null
  }
}

const publicRecord = record => {
  const {requestKey: _requestKey, ...value} = record
  return value
}

const publicRevision = revision => {
  const {revisionKey: _revisionKey, ...value} = revision
  return value
}

const digestRecord = record => createHash('sha256').update(JSON.stringify({
  id: record.id,
  title: record.title,
  requestedChange: record.requestedChange,
  reason: record.reason,
  expectedBehavior: record.expectedBehavior,
  versionIntent: record.versionIntent,
  context: record.context,
})).digest('hex')

const listInternalRevisions = (projectRoot, changeRequestId = null) => {
  const directory = changeRequestRevisionRoot(projectRoot)
  if (!directory) return []
  return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const match = entry.name.match(CHANGE_REQUEST_REVISION_FILE)
    if (!entry.isFile() || entry.isSymbolicLink() || !match || (changeRequestId && match[1] !== changeRequestId)) return []
    try {
      const source = readFileSync(join(directory, entry.name), 'utf8')
      if (Buffer.byteLength(source) > 64 * 1024) return []
      const record = decodeRevisionMetadata(source)
      const expectedId = entry.name.replace(/\.md$/, '')
      const expectedPath = `_workspace/01_plan/${CHANGE_REQUEST_REVISION_DIRECTORY}/${entry.name}`
      const validFields = record && [...REVISION_FIELDS].every(field => typeof record[field] === 'string') && VERSION_INTENTS.has(record.versionIntent)
      const validBinding = record?.revisionId === expectedId
        && record.changeRequestId === match[1]
        && record.revisionNumber === Number(match[2])
        && record.path === expectedPath
        && /^[0-9a-f]{64}$/.test(record.previousDigest ?? '')
      return validFields && validBinding ? [record] : []
    } catch {
      return []
    }
  }).sort((left, right) => left.revisionNumber - right.revisionNumber)
}

const effectiveRecord = (record, revisions) => {
  const publicRevisions = revisions.map(publicRevision)
  const latest = publicRevisions.at(-1) ?? null
  const effective = latest ? {...record, ...Object.fromEntries([...REVISION_FIELDS].map(field => [field, latest[field]]))} : record
  return {
    ...publicRecord(effective),
    currentDigest: digestRecord(effective),
    revisionCount: publicRevisions.length,
    currentRevision: latest,
    revisions: publicRevisions,
  }
}

export const listChangeRequests = projectRoot => {
  const root = realpathSync(projectRoot)
  const directory = changeRequestRoot(root)
  if (!directory) return []
  const records = []
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    if (!entry.isFile() || entry.isSymbolicLink() || !CHANGE_REQUEST_FILE.test(entry.name)) continue
    try {
      const source = readFileSync(join(directory, entry.name), 'utf8')
      if (Buffer.byteLength(source) > 64 * 1024) continue
      const record = decodeMetadata(source)
      if (record?.id === entry.name.replace(/\.md$/, '')) records.push(record)
    } catch {
      // An unreadable or malformed request is omitted instead of weakening the index boundary.
    }
  }
  return records.sort((left, right) => right.id.localeCompare(left.id)).map(record => effectiveRecord(record, listInternalRevisions(root, record.id)))
}

const listInternalChangeRequests = projectRoot => {
  const directory = changeRequestRoot(projectRoot)
  if (!directory) return []
  return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    if (!entry.isFile() || entry.isSymbolicLink() || !CHANGE_REQUEST_FILE.test(entry.name)) return []
    try {
      const record = decodeMetadata(readFileSync(join(directory, entry.name), 'utf8'))
      return record?.id === entry.name.replace(/\.md$/, '') ? [record] : []
    } catch {
      return []
    }
  })
}

const requiredText = (value, field, max = MAX_FIELD_LENGTH) => {
  if (typeof value !== 'string') throw new ChangeRequestError('INVALID_CHANGE_REQUEST', `${field} must be a string`)
  const text = value.trim()
  if (!text || text.length > max || text.includes('\0')) throw new ChangeRequestError('INVALID_CHANGE_REQUEST', `${field} must be between 1 and ${max} characters`)
  if (field === 'title' && /[\r\n]/.test(text)) throw new ChangeRequestError('INVALID_CHANGE_REQUEST', 'title must be a single line')
  return text
}

const optionalIdentifier = (value, pattern, field) => {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !pattern.test(value)) throw new ChangeRequestError('INVALID_CHANGE_REQUEST', `${field} is invalid`)
  return value
}

const seoulDate = date => {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(date)
  const value = name => parts.find(part => part.type === name)?.value
  return `${value('year')}${value('month')}${value('day')}`
}

const quote = value => value.split(/\r?\n/).map(line => `> ${line || ' '}`).join('\n')

const markdown = record => {
  const metadata = Buffer.from(JSON.stringify(record), 'utf8').toString('base64url')
  const context = record.context
  return `# ${record.id} — ${record.title}\n\n<!-- web-harness-change-request:${metadata} -->\n\n## Status\n\n- Status: ${record.status}\n- Created at: ${record.createdAt}\n- Version intent: ${record.versionIntent}\n- Target: ${context.subFeatureId ?? context.featureId ?? (context.newFeature ? 'NEW_FEATURE' : 'PROJECT_BOOTSTRAP')}\n- Preview anchor: ${context.anchorId ?? 'none'}\n- Preview route: ${context.route ?? 'none'}\n- Base preview: ${context.previewStatus} / source \`${context.sourceDigest ?? 'unavailable'}\` / preview \`${context.previewDigest ?? 'unavailable'}\`\n- Test cases: ${context.testCaseIds.join(', ') || 'none'}\n- Related documents: ${context.relatedDocuments.map(document => document.path).join(', ') || 'none'}\n\n## Requested change\n\n${quote(record.requestedChange)}\n\n## Reason\n\n${quote(record.reason)}\n\n## Expected behavior\n\n${quote(record.expectedBehavior)}\n\n## Processing boundary\n\nThis file records a PROPOSED request only. Canonical planning, test, design, and preview artifacts remain unchanged until a separate approved change cycle processes this request.\n`
}

const revisionMarkdown = record => {
  const metadata = Buffer.from(JSON.stringify(record), 'utf8').toString('base64url')
  return `# ${record.revisionId} — ${record.title}\n\n<!-- web-harness-change-request-revision:${metadata} -->\n\n## Revision\n\n- Change Request: ${record.changeRequestId}\n- Revision: ${record.revisionNumber}\n- Created at: ${record.createdAt}\n- Previous request digest: \`${record.previousDigest}\`\n\n## Requested change\n\n${quote(record.requestedChange)}\n\n## Reason\n\n${quote(record.reason)}\n\n## Expected behavior\n\n${quote(record.expectedBehavior)}\n\n## Processing boundary\n\nThis append-only revision supersedes the editable request fields for future impact/apply runs. The original Change Request and its target context remain immutable. Existing impact results are stale until rerun against this revision.\n`
}

export const createChangeRequest = (project, input, {idempotencyKey, now = new Date()} = {}) => {
  if (!IDEMPOTENCY_PATTERN.test(idempotencyKey ?? '')) throw new ChangeRequestError('INVALID_IDEMPOTENCY_KEY', 'A UUID Idempotency-Key is required')
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ChangeRequestError('INVALID_CHANGE_REQUEST', 'Request body must be an object')

  // 대상 없는 CR 두 종류 — 실행기·승인 게이트는 featureId null로 두 종류 모두 차단된다
  // (기획 초안 생성 의미론은 P2-b): ① bootstrap — FEAT가 아직 없는 프로젝트의 첫 변경
  // 요청(A안 진입점, 미니 기획 전체 생성의 입력). ② newFeature — FEAT 보유 프로젝트에서
  // 어떤 기존 FEAT와도 무관한 신규 기능 요청(feature-plan에 FEAT 추가의 입력).
  const bootstrap = input.bootstrap === true
  const newFeature = input.newFeature === true
  if (bootstrap && newFeature) throw new ChangeRequestError('INVALID_CHANGE_REQUEST', 'bootstrap and newFeature are mutually exclusive')
  const targetless = bootstrap || newFeature
  const targetFeatureId = optionalIdentifier(input.targetFeatureId, FEATURE_PATTERN, 'targetFeatureId')
  if (!targetless && !targetFeatureId) throw new ChangeRequestError('INVALID_CHANGE_REQUEST', 'targetFeatureId is required')
  const subFeatureId = optionalIdentifier(input.subFeatureId, SUB_FEATURE_PATTERN, 'subFeatureId')
  const anchorId = optionalIdentifier(input.anchorId, ANCHOR_PATTERN, 'anchorId')
  if (targetless && (targetFeatureId || subFeatureId || anchorId)) throw new ChangeRequestError('INVALID_CHANGE_REQUEST', 'targetless request cannot target a feature')
  // 종류별 프로젝트 조건 = UI 노출 조건(의식적 결정 — 리뷰 반영): bootstrap은 빈
  // 프로젝트 전용, newFeature는 FEAT 보유 프로젝트 전용(빈 프로젝트는 bootstrap 사용).
  if (bootstrap && project.features.length > 0) throw new ChangeRequestError('INVALID_CHANGE_REQUEST', 'bootstrap request is only for projects without features')
  if (newFeature && project.features.length === 0) throw new ChangeRequestError('INVALID_CHANGE_REQUEST', 'newFeature request requires an existing feature plan — use bootstrap')
  const title = requiredText(input.title, 'title', 120)
  const requestedChange = requiredText(input.requestedChange, 'requestedChange')
  const reason = requiredText(input.reason, 'reason')
  const expectedBehavior = requiredText(input.expectedBehavior, 'expectedBehavior')
  if (!VERSION_INTENTS.has(input.versionIntent)) throw new ChangeRequestError('INVALID_CHANGE_REQUEST', 'versionIntent must be patch, minor, or major')

  const feature = targetless ? null : project.features.find(candidate => candidate.featureId === targetFeatureId)
  if (!targetless && !feature) throw new ChangeRequestError('CHANGE_REQUEST_TARGET_NOT_FOUND', 'Target Feature was not found', 400)
  const subFeature = subFeatureId ? feature.subFeatures.find(candidate => candidate.subFeatureId === subFeatureId) : null
  if (subFeatureId && !subFeature) throw new ChangeRequestError('CHANGE_REQUEST_TARGET_NOT_FOUND', 'Target Sub Feature does not belong to the Feature', 400)
  const mapping = subFeature?.previewMapping ?? feature?.previewMapping
  const anchor = anchorId ? mapping.anchors.find(candidate => candidate.anchorId === anchorId) : null
  if (anchorId && !anchor) throw new ChangeRequestError('CHANGE_REQUEST_TARGET_NOT_FOUND', 'Preview anchor does not belong to the selected target', 400)

  const projectRoot = realpathSync(project.root)
  const existing = listInternalChangeRequests(projectRoot).find(record => record.requestKey === idempotencyKey)
  if (existing) return {created: false, changeRequest: effectiveRecord(existing, listInternalRevisions(projectRoot, existing.id))}

  const directory = changeRequestRoot(projectRoot, {create: true})
  const date = seoulDate(now)
  const sequences = readdirSync(directory).flatMap(name => {
    const match = name.match(CHANGE_REQUEST_FILE)
    return match?.[1] === date ? [Number(match[2])] : []
  })
  let sequence = sequences.length ? Math.max(...sequences) + 1 : 1
  if (sequence > MAX_REQUEST_FILES) throw new ChangeRequestError('CHANGE_REQUEST_SEQUENCE_EXHAUSTED', 'Daily change request sequence is exhausted', 409)

  const testCaseIds = anchor?.testCaseIds?.length
    ? anchor.testCaseIds
    : subFeature?.testCaseIds?.length
      ? subFeature.testCaseIds
      : feature?.testCaseIds ?? []
  const recordBase = {
    schemaVersion: 1,
    status: 'PROPOSED',
    createdAt: now.toISOString(),
    requestKey: idempotencyKey,
    title,
    requestedChange,
    reason,
    expectedBehavior,
    versionIntent: input.versionIntent,
    context: {
      bootstrap,
      newFeature,
      featureId: feature?.featureId ?? null,
      subFeatureId: subFeature?.subFeatureId ?? null,
      anchorId: anchor?.anchorId ?? null,
      route: anchor?.route ?? null,
      testCaseIds: [...testCaseIds],
      relatedDocuments: (feature?.relatedDocuments ?? []).map(document => ({phase: document.phase, path: document.path, title: document.title})),
      previewStatus: project.preview.status,
      sourceDigest: project.preview.sourceDigest ?? null,
      previewDigest: project.preview.previewDigest ?? null,
    },
  }

  for (; sequence <= MAX_REQUEST_FILES; sequence += 1) {
    const id = `CHG-${date}-${String(sequence).padStart(3, '0')}`
    const record = {...recordBase, id}
    try {
      writeFileSync(join(directory, `${id}.md`), markdown(record), {encoding: 'utf8', flag: 'wx', mode: 0o600})
      return {created: true, changeRequest: effectiveRecord(record, [])}
    } catch (error) {
      if (error.code !== 'EEXIST') throw new ChangeRequestError('CHANGE_REQUEST_WRITE_FAILED', 'Change request could not be created', 409)
    }
  }
  throw new ChangeRequestError('CHANGE_REQUEST_SEQUENCE_EXHAUSTED', 'Daily change request sequence is exhausted', 409)
}

export const reviseChangeRequest = (projectRoot, changeRequestId, input, {idempotencyKey, now = new Date()} = {}) => {
  if (!IDEMPOTENCY_PATTERN.test(idempotencyKey ?? '')) throw new ChangeRequestError('INVALID_IDEMPOTENCY_KEY', 'A UUID Idempotency-Key is required')
  if (!ID_PATTERN.test(changeRequestId ?? '')) throw new ChangeRequestError('INVALID_CHANGE_REQUEST', 'changeRequestId is invalid')
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(field => !REVISION_FIELDS.has(field))) {
    throw new ChangeRequestError('INVALID_CHANGE_REQUEST_REVISION', 'Revision body contains unsupported fields')
  }
  const root = realpathSync(projectRoot)
  const base = listInternalChangeRequests(root).find(record => record.id === changeRequestId)
  if (!base) throw new ChangeRequestError('CHANGE_REQUEST_NOT_FOUND', 'Change Request was not found', 404)
  const revisions = listInternalRevisions(root, changeRequestId)
  const existing = revisions.find(record => record.revisionKey === idempotencyKey)
  if (existing) return {created: false, changeRequest: effectiveRecord(base, revisions), revision: publicRevision(existing)}

  const effective = effectiveRecord(base, revisions)
  const values = {
    title: requiredText(input.title, 'title', 120),
    requestedChange: requiredText(input.requestedChange, 'requestedChange'),
    reason: requiredText(input.reason, 'reason'),
    expectedBehavior: requiredText(input.expectedBehavior, 'expectedBehavior'),
    versionIntent: input.versionIntent,
  }
  if (!VERSION_INTENTS.has(values.versionIntent)) throw new ChangeRequestError('INVALID_CHANGE_REQUEST_REVISION', 'versionIntent must be patch, minor, or major')
  if ([...REVISION_FIELDS].every(field => values[field] === effective[field])) throw new ChangeRequestError('CHANGE_REQUEST_REVISION_UNCHANGED', 'At least one request field must change', 409)

  const revisionNumber = revisions.length ? Math.max(...revisions.map(record => record.revisionNumber)) + 1 : 1
  if (revisionNumber > MAX_REQUEST_REVISIONS) throw new ChangeRequestError('CHANGE_REQUEST_REVISION_SEQUENCE_EXHAUSTED', 'Change request revision sequence is exhausted', 409)
  const revisionId = `${changeRequestId}-REV-${String(revisionNumber).padStart(3, '0')}`
  const record = {
    schemaVersion: 1,
    revisionId,
    changeRequestId,
    revisionNumber,
    createdAt: now.toISOString(),
    revisionKey: idempotencyKey,
    previousDigest: effective.currentDigest,
    ...values,
    path: `_workspace/01_plan/${CHANGE_REQUEST_REVISION_DIRECTORY}/${revisionId}.md`,
  }
  const directory = changeRequestRevisionRoot(root, {create: true})
  try {
    writeFileSync(join(directory, `${revisionId}.md`), revisionMarkdown(record), {encoding: 'utf8', flag: 'wx', mode: 0o600})
  } catch (error) {
    if (error.code === 'EEXIST') throw new ChangeRequestError('CHANGE_REQUEST_REVISION_CONFLICT', 'Change request revision sequence conflicted; refresh and retry', 409)
    throw new ChangeRequestError('CHANGE_REQUEST_REVISION_WRITE_FAILED', 'Change request revision could not be created', 409)
  }
  const nextRevisions = [...revisions, record]
  return {created: true, changeRequest: effectiveRecord(base, nextRevisions), revision: publicRevision(record)}
}

export const changeRequestConstants = {IDEMPOTENCY_PATTERN, MAX_REQUEST_FILES, MAX_REQUEST_REVISIONS}
