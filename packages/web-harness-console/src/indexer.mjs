import {createHash} from 'node:crypto'
import {existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync} from 'node:fs'
import {basename, dirname, extname, join, relative, resolve, sep} from 'node:path'
import {inspectDesignPreview, readPreviewMode} from '../../../.claude/scripts/design-preview-status-lib.mjs'
import {createChangeRequest, listChangeRequests, reviseChangeRequest} from './change-requests.mjs'
import {deleteChangeRequestArtifacts} from './change-request-deletion.mjs'
import {commitChangeRequestReview, listChangeRequestReviews, prepareChangeRequestReview, recordChangeRequestReview} from './change-request-reviews.mjs'
import {summarizeImplementationVerification} from './change-request-implementation.mjs'

const PHASES = [
  {id: 'source', directory: '00_source', label: 'Source'},
  {id: 'plan', directory: '01_plan', label: 'Plan'},
  {id: 'design', directory: '02_design', label: 'Design'},
]
const EXCLUDED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', 'cache', '.next', '.turbo'])
const TEXT_EXTENSIONS = new Set(['.md', '.json', '.txt', '.yaml', '.yml', '.ts', '.tsx', '.js', '.mjs', '.css', '.html', '.svg'])
const MAX_DOCUMENT_BYTES = 768 * 1024
const MAX_DISCOVERY_DEPTH = 4

const sha256 = value => createHash('sha256').update(value).digest('hex')
const toPosix = value => value.split(sep).join('/')
const unique = values => [...new Set(values)]

const approvedChangeProjection = (request, decision) => {
  const links = decision.featureLinks ?? {
    targetFeatureId: request.context.featureId,
    targetSubFeatureId: request.context.subFeatureId ?? null,
    affectedFeatureIds: [request.context.featureId],
    affectedSubFeatureIds: request.context.subFeatureId ? [request.context.subFeatureId] : [],
    affectedTestCaseIds: request.context.testCaseIds ?? [],
    sourceDigest: request.context.sourceDigest ?? null,
    previewDigest: request.context.previewDigest ?? null,
    scopeSource: 'request-context-legacy',
    digestSource: 'request-base',
  }
  return {
    changeRequestId: request.id,
    title: request.title,
    requestedChange: request.requestedChange,
    versionIntent: request.versionIntent,
    approvedAt: decision.createdAt,
    applyRunId: decision.applyRunId,
    ...links,
  }
}

const isSafeDirectory = path => {
  try {
    const stat = lstatSync(path)
    return stat.isDirectory() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

const walkDirectories = (root, depth = 0, output = []) => {
  if (!isSafeDirectory(root) || depth > MAX_DISCOVERY_DEPTH) return output
  if (existsSync(join(root, '_workspace'))) output.push(root)
  if (depth === MAX_DISCOVERY_DEPTH) return output
  for (const entry of readdirSync(root, {withFileTypes: true})) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || EXCLUDED_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue
    walkDirectories(join(root, entry.name), depth + 1, output)
  }
  return output
}

const walkDocuments = (projectRoot, phase) => {
  const phaseRoot = join(projectRoot, '_workspace', phase.directory)
  if (!isSafeDirectory(phaseRoot)) return []
  const output = []
  const visit = directory => {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (phase.id === 'design' && entry.name === 'preview') continue
        visit(path)
        continue
      }
      if (!entry.isFile() || !TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue
      const stat = statSync(path)
      const relativePath = toPosix(relative(projectRoot, path))
      let content = null
      let readError = null
      if (stat.size > MAX_DOCUMENT_BYTES) readError = 'DOCUMENT_TOO_LARGE'
      else {
        try {
          content = readFileSync(path, 'utf8')
        } catch {
          readError = 'DOCUMENT_UNREADABLE'
        }
      }
      output.push({
        phase: phase.id,
        phaseLabel: phase.label,
        path: relativePath,
        name: entry.name,
        title: content?.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? entry.name,
        bytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        hash: content === null ? null : sha256(content),
        lines: content === null ? null : content.split(/\r?\n/).length,
        content,
        readError,
      })
    }
  }
  visit(phaseRoot)
  return output.sort((left, right) => left.path.localeCompare(right.path))
}

export const parseFeaturePlan = source => {
  if (!source) return []
  const lines = source.split(/\r?\n/)
  const order = []
  const features = new Map()
  let current = null
  const pageGroups = new Map()
  let pageGroupHeaders = []
  let featureHeaders = []
  let subFeatureHeaders = []
  let testHeaders = []
  const tableCells = line => line.startsWith('|') ? line.split('|').slice(1, -1).map(cell => cell.trim()) : []
  const normalized = value => value.toLowerCase().replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim()
  const fieldFromHeaders = (headers, cells, names) => {
    const index = headers.findIndex(header => names.includes(normalized(header)))
    return index >= 0 ? cells[index]?.trim() ?? '' : ''
  }
  const ensureFeature = (featureId, title = '') => {
    if (!features.has(featureId)) {
      features.set(featureId, {
        featureId,
        title: title.trim() || featureId,
        summary: '',
        priority: '',
        screen: '',
        scope: '',
        description: '',
        pageGroupReference: '',
        testCases: [],
        subFeatures: [],
      })
      order.push(featureId)
    } else if (title.trim() && features.get(featureId).title === featureId) {
      features.get(featureId).title = title.trim()
    }
    return features.get(featureId)
  }
  const addTestCase = (feature, testCase) => {
    const existing = feature.testCases.find(item => item.testCaseId === testCase.testCaseId)
    if (existing) {
      for (const [key, value] of Object.entries(testCase)) if (value && !existing[key]) existing[key] = value
    } else feature.testCases.push(testCase)
  }

  for (const line of lines) {
    const cells = tableCells(line)
    if (cells.length > 0 && cells.some(cell => ['page group id', '페이지 그룹 id'].includes(normalized(cell)))) {
      pageGroupHeaders = cells
      continue
    }
    if (cells.length > 0 && cells.some(cell => /^(?:FEAT\s+)?ID$/i.test(cell)) && cells.some(cell => /^(?:기능|Feature)$/i.test(cell))) {
      featureHeaders = cells
      continue
    }
    if (cells.length > 0 && cells.some(cell => /^Sub Feature ID$/i.test(cell))) {
      subFeatureHeaders = cells
      continue
    }
    if (cells.length > 0 && cells.some(cell => /^Test Case$/i.test(cell)) && cells.some(cell => /^(?:Given|When|Then)$/i.test(cell))) {
      testHeaders = cells
      continue
    }
    const pageGroupId = fieldFromHeaders(pageGroupHeaders, cells, ['page group id', '페이지 그룹 id'])
    if (/^PAGE-\d{3}$/.test(pageGroupId)) {
      const rawOrder = fieldFromHeaders(pageGroupHeaders, cells, ['순서', 'order'])
      const parsedOrder = Number(rawOrder)
      pageGroups.set(pageGroupId, {
        id: pageGroupId,
        label: fieldFromHeaders(pageGroupHeaders, cells, ['페이지', 'page', 'label', 'name']) || pageGroupId,
        route: fieldFromHeaders(pageGroupHeaders, cells, ['route/screen', 'route', 'screen', '화면']),
        order: Number.isInteger(parsedOrder) && parsedOrder > 0 ? parsedOrder : null,
      })
      continue
    }
    const tableSubFeatureId = cells.find(cell => /^FEAT-\d{3}-\d{2}$/.test(cell))
    if (tableSubFeatureId) {
      const parentFeatureId = tableSubFeatureId.match(/^(FEAT-\d{3})-/)?.[1]
      const parent = parentFeatureId ? ensureFeature(parentFeatureId) : null
      if (parent && !parent.subFeatures.some(item => item.subFeatureId === tableSubFeatureId)) {
        const testCaseSource = fieldFromHeaders(subFeatureHeaders, cells, ['관련 test case', 'test cases', 'test case', 'tc'])
        parent.subFeatures.push({
          subFeatureId: tableSubFeatureId,
          title: fieldFromHeaders(subFeatureHeaders, cells, ['동작', '기능', 'feature']) || cells[cells.indexOf(tableSubFeatureId) + 1] || tableSubFeatureId,
          testCaseIds: unique(testCaseSource.match(/TC-\d{3,}-\d+/g) ?? []),
          screen: fieldFromHeaders(subFeatureHeaders, cells, ['화면/영역', '화면', 'screen']),
          scope: fieldFromHeaders(subFeatureHeaders, cells, ['이번 범위', 'scope']),
        })
      }
      current = parent
      continue
    }
    const tableFeatureId = cells.find(cell => /^FEAT-\d{3,}$/.test(cell))
    const tableMatch = tableFeatureId ? [null, tableFeatureId, cells[cells.indexOf(tableFeatureId) + 1] ?? ''] : null
    const headingMatch = line.match(/^#{1,6}\s+(FEAT-\d{3,})\s*(?:[-—:]\s*)?(.*)$/)
    if (tableMatch) {
      current = ensureFeature(tableMatch[1], tableMatch[2])
      current.summary ||= fieldFromHeaders(featureHeaders, cells, ['사용자 가치 (1줄)', '사용자 가치', 'summary', 'value'])
      current.priority ||= fieldFromHeaders(featureHeaders, cells, ['우선순위', 'priority'])
      current.pageGroupReference ||= fieldFromHeaders(featureHeaders, cells, ['페이지 그룹', 'page group', 'page group id', 'primary page'])
      current.screen ||= fieldFromHeaders(featureHeaders, cells, ['화면', 'screen'])
      current.scope ||= fieldFromHeaders(featureHeaders, cells, ['이번 범위', 'scope'])
    } else if (headingMatch) current = ensureFeature(headingMatch[1], headingMatch[2])

    const descriptionMatch = line.match(/^\*\*(?:동작 명세|Behavior|Description)\*\*:\s*(.+)$/i)
    if (descriptionMatch && current) current.description = descriptionMatch[1].trim()

    const featureReferences = [...line.matchAll(/FEAT-\d{3,}/g)].map(match => match[0])
    if (featureReferences.length === 1 && !current) current = ensureFeature(featureReferences[0])

    const tableTest = cells[0]?.match(/^(TC-(\d{3,})-\d+)\s*(.*)$/)
    if (tableTest) {
      const owningFeature = features.get(`FEAT-${tableTest[2]}`) ?? current
      if (owningFeature) addTestCase(owningFeature, {
        testCaseId: tableTest[1],
        label: tableTest[3].replace(/^\((.*)\)$/, '$1').trim(),
        given: fieldFromHeaders(testHeaders, cells, ['given']),
        when: fieldFromHeaders(testHeaders, cells, ['when']),
        then: fieldFromHeaders(testHeaders, cells, ['then']),
        description: '',
      })
      continue
    }
    const plainTest = line.match(/^\s*(?:[-*]\s*)?(TC-(\d{3,})-\d+)\s*(?::\s*(.+))?\s*$/)
    if (plainTest) {
      const owningFeature = features.get(`FEAT-${plainTest[2]}`) ?? current
      if (owningFeature) addTestCase(owningFeature, {testCaseId: plainTest[1], label: '', given: '', when: '', then: '', description: plainTest[3]?.trim() ?? ''})
    }
  }
  return order.map(id => {
    const feature = features.get(id)
    const explicitId = feature.pageGroupReference.match(/PAGE-\d{3}/)?.[0] ?? null
    const explicitGroup = explicitId ? pageGroups.get(explicitId) : null
    const fallbackScreen = feature.screen.split(/\s*(?:,|\/|→|·)\s*/).map(value => value.trim()).find(Boolean) ?? ''
    const pageGroup = explicitId
      ? {...(explicitGroup ?? {id: explicitId, label: explicitId, route: feature.screen, order: null}), source: explicitGroup ? 'explicit' : 'unknown-reference'}
      : fallbackScreen
        ? {id: null, label: fallbackScreen, route: fallbackScreen, order: null, source: 'screen-fallback'}
        : {id: null, label: '미분류', route: '', order: null, source: 'ungrouped'}
    const {pageGroupReference: _pageGroupReference, ...publicFeature} = feature
    return {...publicFeature, pageGroup, testCaseIds: feature.testCases.map(testCase => testCase.testCaseId)}
  })
}

const boundedLineDiff = (before, after) => {
  if (before === after) return null
  const oldLines = before.split(/\r?\n/)
  const newLines = after.split(/\r?\n/)
  let prefix = 0
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < oldLines.length - prefix
    && suffix < newLines.length - prefix
    && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) suffix += 1
  const removed = oldLines.slice(prefix, oldLines.length - suffix)
  const added = newLines.slice(prefix, newLines.length - suffix)
  return {
    startLine: prefix + 1,
    addedLines: added.length,
    removedLines: removed.length,
    addedPreview: added.slice(0, 8),
    removedPreview: removed.slice(0, 8),
    truncated: added.length > 8 || removed.length > 8,
  }
}

const summarizePreview = projectRoot => {
  const previewRoot = join(projectRoot, '_workspace', '02_design', 'preview')
  const {mode} = isSafeDirectory(previewRoot) ? readPreviewMode(projectRoot) : {mode: 'prototype'}
  const present = isSafeDirectory(previewRoot) && (mode === 'live-delta'
    ? existsSync(join(previewRoot, 'delta', 'bootstrap.mjs'))
    : existsSync(join(previewRoot, 'index.html')))
  if (!present) {
    return {exists: false, mode, status: 'ABSENT', reason: null, errors: [], featureCount: 0, testCaseCount: 0, features: [], anchors: []}
  }
  const status = inspectDesignPreview(projectRoot)
  const features = status.traceability?.features ?? []
  return {
    exists: true,
    mode: status.mode ?? 'prototype',
    status: status.status,
    reason: status.reason ?? null,
    errors: status.errors ?? [],
    featureCount: features.length,
    testCaseCount: unique(features.flatMap(feature => feature.testCaseIds ?? [])).length,
    sourceDigest: status.source?.digest ?? null,
    previewDigest: status.preview?.digest ?? null,
    features: features.map(feature => ({
      featureId: feature.featureId,
      anchorIds: feature.anchorIds ?? [],
      unmappedReason: feature.unmappedReason ?? null,
      subFeatures: (feature.subFeatures ?? []).map(subFeature => ({
        subFeatureId: subFeature.subFeatureId,
        title: subFeature.title,
        description: subFeature.description ?? '',
        testCaseIds: subFeature.testCaseIds ?? [],
        anchorIds: subFeature.anchorIds ?? [],
        unmappedReason: subFeature.unmappedReason ?? null,
      })),
    })),
    anchors: (status.traceability?.anchors ?? []).map(anchor => ({
      anchorId: anchor.anchorId,
      featureId: anchor.featureId,
      subFeatureId: anchor.subFeatureId ?? null,
      label: anchor.label,
      route: anchor.previewRoute ?? anchor.route,
      selector: anchor.selector,
      testCaseIds: anchor.testCaseIds ?? [],
      fixtureId: anchor.fixtureId ?? null,
      fixtureMode: anchor.fixtureMode ?? null,
    })),
  }
}

const publicPreview = preview => {
  const {features: _features, anchors: _anchors, ...summary} = preview
  return summary
}

const projectId = relativePath => `${basename(relativePath || 'root').replace(/[^a-zA-Z0-9-]+/g, '-').toLowerCase()}-${sha256(relativePath || '.').slice(0, 8)}`

const scanProject = (repositoryRoot, root) => {
  const relativePath = toPosix(relative(repositoryRoot, root)) || '.'
  const documents = PHASES.flatMap(phase => walkDocuments(root, phase))
  // feature-plan은 sharding 계약상 flat(.md) 또는 디렉토리(feature-plan/) 형태다
  // (search-portal 파일럿 실측 — flat 완전 일치만 찾으면 sharded 프로젝트에서 FEAT 0으로 보임).
  // 디렉토리 형태면 절 파일들을 이어붙여 파싱한다: feature-list.md(FEAT 표)를 앞에 두어
  // FEAT 정의 순서를 보존하고, INDEX.md는 절 목록 표뿐이라 파서 헤더에 매칭되지 않는다.
  const featurePlanShards = documents
    .filter(document => document.path.startsWith('_workspace/01_plan/feature-plan/'))
    .sort((left, right) => Number(right.path.endsWith('/feature-list.md')) - Number(left.path.endsWith('/feature-list.md')) || left.path.localeCompare(right.path))
  const featurePlan = documents.find(document => document.path === '_workspace/01_plan/feature-plan.md')
  const featurePlanSource = featurePlan?.content
    ?? (featurePlanShards.length ? featurePlanShards.map(document => document.content ?? '').join('\n\n') : undefined)
  const preview = summarizePreview(root)
  const features = parseFeaturePlan(featurePlanSource).map(feature => {
    const previewFeature = preview.features.find(item => item.featureId === feature.featureId)
    const subFeatures = feature.subFeatures.map(subFeature => {
      const previewSubFeature = previewFeature?.subFeatures.find(item => item.subFeatureId === subFeature.subFeatureId)
      return {
        ...subFeature,
        description: previewSubFeature?.description ?? '',
        previewMapping: {
          available: Boolean(previewSubFeature),
          unmappedReason: previewSubFeature?.unmappedReason ?? null,
          anchors: previewSubFeature
            ? preview.anchors.filter(anchor => previewSubFeature.anchorIds.includes(anchor.anchorId))
            : [],
        },
      }
    })
    return {
      ...feature,
      subFeatures,
      relatedDocuments: documents
        .filter(document => document.content?.includes(feature.featureId))
        .map(document => ({phase: document.phase, path: document.path, title: document.title}))
        .sort((left, right) => Number(right.path.endsWith('/feature-plan.md')) - Number(left.path.endsWith('/feature-plan.md')) || left.path.localeCompare(right.path))
        .slice(0, 12),
      previewMapping: {
        available: Boolean(previewFeature),
        unmappedReason: previewFeature?.unmappedReason ?? null,
        anchors: previewFeature
          ? preview.anchors.filter(anchor => previewFeature.anchorIds.includes(anchor.anchorId))
          : [],
      },
    }
  })
  const changeRequests = listChangeRequests(root).map(request => {
    const reviewDecisions = listChangeRequestReviews(root, request.id)
    const merged = {...request, reviewDecisions, latestReviewDecision: reviewDecisions.at(-1) ?? null}
    // 원칙 4: 승인된 CR의 구현 검증 커버리지(같은 TC ID) 파생 요약 — 승인 전에는 null.
    merged.implementationVerification = summarizeImplementationVerification(root, merged)
    return merged
  })
  const approvedChanges = changeRequests.flatMap(request => request.latestReviewDecision?.decision === 'APPROVED'
    ? [approvedChangeProjection(request, request.latestReviewDecision)]
    : [])
  for (const feature of features) {
    feature.approvedChanges = approvedChanges
      .filter(change => change.affectedFeatureIds.includes(feature.featureId))
      .sort((left, right) => right.approvedAt.localeCompare(left.approvedAt))
    for (const subFeature of feature.subFeatures) {
      subFeature.approvedChanges = feature.approvedChanges.filter(change => change.affectedSubFeatureIds.includes(subFeature.subFeatureId))
    }
  }
  return {
    id: projectId(relativePath),
    name: relativePath === '.' ? basename(repositoryRoot) : basename(root),
    relativePath,
    root,
    documents,
    features,
    preview,
    changeRequests,
  }
}

const documentSnapshot = projects => new Map(
  projects.flatMap(project => project.documents.map(document => [
    `${project.id}:${document.path}`,
    {projectId: project.id, path: document.path, hash: document.hash, lines: document.lines, content: document.content},
  ])),
)

const computeChanges = (baseline, projects) => {
  const current = documentSnapshot(projects)
  const byProject = new Map(projects.map(project => [project.id, []]))
  for (const [key, document] of current) {
    const previous = baseline.get(key)
    const projectChanges = byProject.get(document.projectId)
    if (!previous) projectChanges.push({kind: 'added', path: document.path, lines: document.lines, diff: null})
    else if (previous.hash !== document.hash) {
      projectChanges.push({
        kind: 'modified',
        path: document.path,
        beforeLines: previous.lines,
        lines: document.lines,
        diff: previous.content !== null && document.content !== null ? boundedLineDiff(previous.content, document.content) : null,
      })
    }
  }
  for (const [key, previous] of baseline) {
    if (current.has(key)) continue
    if (!byProject.has(previous.projectId)) byProject.set(previous.projectId, [])
    byProject.get(previous.projectId).push({kind: 'removed', path: previous.path, beforeLines: previous.lines, diff: null})
  }
  return byProject
}

const publicDocument = document => {
  const {content: _content, ...metadata} = document
  return metadata
}

const publicProject = (project, changes) => ({
  id: project.id,
  name: project.name,
  relativePath: project.relativePath,
  phaseCounts: Object.fromEntries(PHASES.map(phase => [phase.id, project.documents.filter(document => document.phase === phase.id).length])),
  featureCount: project.features.length,
  testCaseCount: unique(project.features.flatMap(feature => feature.testCaseIds)).length,
  changeRequestCount: project.changeRequests.length,
  preview: publicPreview(project.preview),
  changeSummary: {
    total: changes.length,
    added: changes.filter(change => change.kind === 'added').length,
    modified: changes.filter(change => change.kind === 'modified').length,
    removed: changes.filter(change => change.kind === 'removed').length,
  },
})

export class WorkspaceCatalog {
  constructor(repositoryRoot) {
    this.repositoryRoot = realpathSync(resolve(repositoryRoot))
    this.baselineAt = new Date().toISOString()
    this.projects = this.#scan()
    this.baseline = documentSnapshot(this.projects)
    this.changes = computeChanges(this.baseline, this.projects)
    this.scannedAt = this.baselineAt
  }

  #scan() {
    // 루트부터 depth 제한 재귀 탐색으로 `_workspace`를 가진 모든 디렉터리를 프로젝트로
    // 발견한다. 고정 하위 목록(workspace/, packages/)만 보던 방식은 플러그인 모드의
    // 사용자 프로젝트 배치(예: apps/web/_workspace)를 놓친다.
    return unique(walkDirectories(this.repositoryRoot).map(root => realpathSync(root)))
      .map(root => scanProject(this.repositoryRoot, root))
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  refresh() {
    this.projects = this.#scan()
    this.changes = computeChanges(this.baseline, this.projects)
    this.scannedAt = new Date().toISOString()
    return this.list()
  }

  list() {
    return {
      scannedAt: this.scannedAt,
      baselineAt: this.baselineAt,
      scanRoot: this.repositoryRoot,
      roots: [`**/_workspace (최대 깊이 ${MAX_DISCOVERY_DEPTH})`],
      projects: this.projects.map(project => publicProject(project, this.changes.get(project.id) ?? [])),
    }
  }

  project(id) {
    return this.projects.find(project => project.id === id) ?? null
  }

  detail(id) {
    const project = this.project(id)
    if (!project) return null
    const changes = this.changes.get(id) ?? []
    return {
      ...publicProject(project, changes),
      scannedAt: this.scannedAt,
      baselineAt: this.baselineAt,
      documents: Object.fromEntries(PHASES.map(phase => [
        phase.id,
        project.documents.filter(document => document.phase === phase.id).map(publicDocument),
      ])),
      features: project.features,
      preview: project.preview,
      changeRequests: project.changeRequests,
      changes,
    }
  }

  document(id, requestedPath) {
    const project = this.project(id)
    if (!project) return {error: 'PROJECT_NOT_FOUND'}
    if (typeof requestedPath !== 'string' || requestedPath.includes('\0')) return {error: 'INVALID_DOCUMENT_PATH'}
    const document = project.documents.find(candidate => candidate.path === requestedPath)
    if (!document) return {error: 'DOCUMENT_NOT_FOUND'}
    if (document.readError) return {error: document.readError}
    return {
      ...publicDocument(document),
      content: document.content,
      change: (this.changes.get(id) ?? []).find(change => change.path === document.path) ?? null,
    }
  }

  createChangeRequest(id, input, options) {
    const project = this.project(id)
    if (!project) throw Object.assign(new Error('Project was not found'), {code: 'PROJECT_NOT_FOUND', status: 404})
    const result = createChangeRequest(project, input, options)
    this.refresh()
    return result
  }

  reviseChangeRequest(id, changeRequestId, input, options = {}) {
    const project = this.project(id)
    if (!project) throw Object.assign(new Error('Project was not found'), {code: 'PROJECT_NOT_FOUND', status: 404})
    const request = project.changeRequests.find(candidate => candidate.id === changeRequestId)
    if (!request) throw Object.assign(new Error('Change Request was not found'), {code: 'CHANGE_REQUEST_NOT_FOUND', status: 404})
    const requestRuns = (options.codexRuns ?? []).filter(run => run.changeRequestId === changeRequestId)
    if (requestRuns.some(run => ['PENDING', 'RUNNING'].includes(run.status))) {
      throw Object.assign(new Error('Wait for the active executor run to finish before revising the request'), {code: 'CHANGE_REQUEST_REVISION_RUN_ACTIVE', status: 409})
    }
    if (requestRuns.some(run => run.phase === 'apply')) {
      throw Object.assign(new Error('The request cannot be revised after change application has started; use the candidate review flow'), {code: 'CHANGE_REQUEST_REVISION_APPLY_STARTED', status: 409})
    }
    if (request.reviewDecisions?.length > 0) {
      throw Object.assign(new Error('The request cannot be revised after a candidate review decision'), {code: 'CHANGE_REQUEST_REVISION_REVIEWED', status: 409})
    }
    const result = reviseChangeRequest(project.root, changeRequestId, input, options)
    this.refresh()
    return result
  }

  deleteChangeRequest(id, changeRequestId, {codexRuns = []} = {}) {
    const project = this.project(id)
    if (!project) throw Object.assign(new Error('Project was not found'), {code: 'PROJECT_NOT_FOUND', status: 404})
    const request = project.changeRequests.find(candidate => candidate.id === changeRequestId)
    if (!request) return {deleted: false, artifactCount: 0}
    const requestRuns = codexRuns.filter(run => run.changeRequestId === changeRequestId)
    if (requestRuns.some(run => ['PENDING', 'RUNNING'].includes(run.status))) {
      throw Object.assign(new Error('Wait for the active executor run to finish before deleting the request'), {code: 'CHANGE_REQUEST_DELETE_RUN_ACTIVE', status: 409})
    }
    const verifiedReviews = listChangeRequestReviews(project.root, changeRequestId, {strict: true})
    if (verifiedReviews.some(decision => decision.decision === 'APPROVED')) {
      throw Object.assign(new Error('An approved Change Request is permanent and cannot be deleted'), {code: 'CHANGE_REQUEST_DELETE_APPROVED', status: 409})
    }
    const result = deleteChangeRequestArtifacts(project.root, changeRequestId)
    if (result.deleted) this.refresh()
    return result
  }

  #reviewTarget(id, changeRequestId) {
    const project = this.project(id)
    if (!project) throw Object.assign(new Error('Project was not found'), {code: 'PROJECT_NOT_FOUND', status: 404})
    const request = project.changeRequests.find(candidate => candidate.id === changeRequestId)
    if (!request) throw Object.assign(new Error('Change Request was not found'), {code: 'CHANGE_REQUEST_NOT_FOUND', status: 404})
    return {project, request}
  }

  prepareChangeRequestReview(id, changeRequestId, input, options) {
    const {project, request} = this.#reviewTarget(id, changeRequestId)
    return prepareChangeRequestReview(project.root, request, input, options)
  }

  commitChangeRequestReview(id, changeRequestId, event, options) {
    const {project, request} = this.#reviewTarget(id, changeRequestId)
    const result = commitChangeRequestReview(project.root, event, {...options, request, features: project.features, preview: project.preview})
    this.refresh()
    return result
  }

  recordChangeRequestReview(id, changeRequestId, input, options) {
    const {project, request} = this.#reviewTarget(id, changeRequestId)
    const result = recordChangeRequestReview(project.root, request, input, {...options, features: project.features, preview: project.preview})
    this.refresh()
    return result
  }
}

export const consoleConstants = {MAX_DOCUMENT_BYTES, PHASES}
