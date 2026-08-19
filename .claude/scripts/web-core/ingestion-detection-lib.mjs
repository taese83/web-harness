import {existsSync, lstatSync, readFileSync, readdirSync, realpathSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {inspectRuntimeDataContractMetadata} from '../runtime-data-contract-lib.mjs'

const CONTRACT_PATHS = Object.freeze([
  '_workspace/02_design/ingestion-contract.md',
  '_workspace/02_design/runtime-data-contract.json',
])
const INGESTION_PATH_MARKERS = Object.freeze([
  'packages/ingestion',
  'scripts/ingestion',
  'workers/ingestion',
  'scripts/crawl.js',
  'scripts/crawl.mjs',
  'scripts/crawl.cjs',
  'scripts/crawl.ts',
  'scripts/crawl.mts',
  'scripts/scrape.js',
  'scripts/scrape.mjs',
  'scripts/scrape.ts',
])
const INGESTION_TERM = /(?:^|[-_:/.])(?:crawl|crawler|scrape|scraper|harvest|ingest|ingestion|generate-data|refresh(?:[-_:/.][a-z0-9]+)*|sync(?:[-_:/.][a-z0-9]+)*|(?:download|fetch|import|mirror|pull|update)(?:[-_:/.](?:catalog|content|data|events?|feed|races?|snapshot)))(?:$|[-_:/.])/i
const MAX_INSPECTED_FILE_BYTES = 2 * 1024 * 1024
const MAX_INSPECTED_SOURCE_FILES = 1024
const NETWORK_INGESTION_SOURCE = /\bfetch\s*\(|\b(?:globalThis|window|self)\s*\.\s*fetch\b|\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*fetch\b|\b(?:axios|got)\s*\(|\bhttps?\s*\.\s*(?:get|request)\s*\(|\bfrom\s*['"](?:axios|got|node:https?|undici)['"]|\brequire\s*\(\s*['"](?:axios|got|node:https?|undici)['"]\s*\)/
const SOURCE_SCAN_EXCLUDED_DIRECTORIES = new Set([
  '.claude', '.git', '.github', '.next', '.pnpm-store', '_workspace', 'build', 'coverage', 'dist',
  'e2e', 'fixtures', 'node_modules', 'out', 'public', 'static', 'test', 'tests',
])
const OPERATIONAL_SOURCE_SEGMENTS = new Set([
  'functions', 'jobs', 'scripts', 'server', 'tools', 'workers',
])
const pathEntryExists = path => {
  try { lstatSync(path); return true } catch { return false }
}

const readBoundedRegularFile = path => {
  if (!existsSync(path)) return null
  const stats = lstatSync(path)
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_INSPECTED_FILE_BYTES) return null
  return readFileSync(path, 'utf8')
}

const isValidGitBoundary = directory => {
  const marker = join(directory, '.git')
  if (!pathEntryExists(marker)) return false
  try {
    const stats = lstatSync(marker)
    if (stats.isSymbolicLink()) return false
    if (stats.isFile()) {
      const source = readBoundedRegularFile(marker)
      return typeof source === 'string' && /^gitdir:\s*\S+/m.test(source)
    }
    if (!stats.isDirectory()) return false
    const head = readBoundedRegularFile(join(marker, 'HEAD'))
    const config = readBoundedRegularFile(join(marker, 'config'))
    return (
      typeof head === 'string' &&
      /^(?:ref:\s+refs\/|[0-9a-f]{40,64}\s*$)/m.test(head) &&
      typeof config === 'string' &&
      /^\s*\[core\]\s*$/m.test(config)
    )
  } catch {
    return false
  }
}

const inspectPackageScripts = (projectRoot, evidence) => {
  const packagePath = join(projectRoot, 'package.json')
  const source = readBoundedRegularFile(packagePath)
  if (source === null && pathEntryExists(packagePath)) {
    evidence.push('uninspectable-package:package.json')
    return
  }
  if (source === null) return
  try {
    const packageJson = JSON.parse(source)
    for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
      if (INGESTION_TERM.test(name) || INGESTION_TERM.test(String(command))) {
        evidence.push(`package-script:${name}`)
      }
    }
  } catch {
    evidence.push('uninspectable-package:package.json')
  }
}

const inspectWorkflows = (projectRoot, evidence) => {
  const directory = join(projectRoot, '.github', 'workflows')
  if (!existsSync(directory)) return
  const stats = lstatSync(directory)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    evidence.push('uninspectable-workflow-root:.github/workflows')
    return
  }
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    if (!/\.ya?ml$/i.test(entry.name)) continue
    if (!entry.isFile() || entry.isSymbolicLink?.()) {
      evidence.push(`uninspectable-workflow:.github/workflows/${entry.name}`)
      continue
    }
    const source = readBoundedRegularFile(join(directory, entry.name))
    if (source === null) {
      evidence.push(`uninspectable-workflow:.github/workflows/${entry.name}`)
      continue
    }
    const scheduled = /^\s*schedule\s*:/m.test(source) || /^\s*-?\s*cron\s*:/m.test(source)
    const ingestionNamed = INGESTION_TERM.test(entry.name) || INGESTION_TERM.test(source)
    if (scheduled && ingestionNamed) evidence.push(`workflow:${entry.name}`)
  }
}

const inspectNetworkIngestionSources = (projectRoot, evidence, excludeHarnessProjectChildren = false) => {
  let inspected = 0
  const inspectFile = relativePath => {
    if (!/\.(?:c?js|mjs|[cm]?ts|tsx)$/i.test(relativePath)) return
    const segments = relativePath.toLowerCase().split('/')
    const operational =
      segments.some(segment => OPERATIONAL_SOURCE_SEGMENTS.has(segment)) ||
      segments[0] === 'api' ||
      INGESTION_TERM.test(relativePath) ||
      /^(?:next|vite)\.config\.(?:c?js|mjs|[cm]?ts)$/i.test(relativePath) ||
      /(?:^|\/)app\/api\/.+\/route\.(?:c?js|mjs|[cm]?ts|tsx)$/i.test(relativePath) ||
      /(?:^|\/)pages\/api\//i.test(relativePath)
    if (!operational) return
    inspected += 1
    if (inspected > MAX_INSPECTED_SOURCE_FILES) return
    const source = readBoundedRegularFile(join(projectRoot, relativePath))
    if (source === null) {
      evidence.push(`uninspectable-source:${relativePath}`)
    } else if (NETWORK_INGESTION_SOURCE.test(source)) {
      evidence.push(`network-source:${relativePath}`)
    }
  }
  const walk = (relativeDirectory = '', depth = 0) => {
    if (depth > 12 || inspected > MAX_INSPECTED_SOURCE_FILES) return
    const directory = relativeDirectory ? join(projectRoot, relativeDirectory) : projectRoot
    if (!pathEntryExists(directory)) return
    const stats = lstatSync(directory)
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      evidence.push(`uninspectable-source-root:${relativeDirectory || '.'}`)
      return
    }
    for (const entry of readdirSync(directory, {withFileTypes: true}).sort((left, right) => left.name.localeCompare(right.name))) {
      if (inspected > MAX_INSPECTED_SOURCE_FILES) break
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) evidence.push(`uninspectable-source:${relativePath}`)
      else if (entry.isDirectory() && !SOURCE_SCAN_EXCLUDED_DIRECTORIES.has(entry.name)) {
        // ancestor 스캔 한정: 자체 하니스 release root(사촌 프로젝트)는 이 프로젝트의 조상
        // 운영 표면이 아니다 — search-portal 파일럿 실측(형제 파일럿의 crawler가 ancestor
        // 증거로 오탐, 결함 11호). 판정 마커는 존재-only `_workspace`가 아니라 **실질 구조**
        // `_workspace/01_plan`(하니스 init이 반드시 만드는 하위)이다 — 빈 `_workspace` 위장
        // 우회를 막는다(리뷰 HIGH 반영). 마커 없는 wrapper crawler 패키지는 계속 스캔되므로
        // split-root 방어는 유지된다. 잔여 한계(구조까지 위조한 decoy)는 protected-core §4 등록.
        if (excludeHarnessProjectChildren && pathEntryExists(join(directory, entry.name, '_workspace', '01_plan'))) continue
        walk(relativePath, depth + 1)
      }
      else if (entry.isFile()) inspectFile(relativePath)
    }
  }
  walk()
  if (inspected > MAX_INSPECTED_SOURCE_FILES) evidence.push('source-scan-budget-exceeded')
}

const readRuntimeContractMode = projectRoot => {
  const path = join(projectRoot, CONTRACT_PATHS[1])
  if (!pathEntryExists(path)) return {mode: null, scheduled: false, errors: []}
  const inspection = inspectRuntimeDataContractMetadata(projectRoot)
  return {
    mode: inspection.mode,
    scheduled: inspection.scheduled,
    errors: inspection.errors,
  }
}

const collectOperationalEvidence = (projectRoot, {excludeHarnessProjectChildren = false} = {}) => {
  const evidence = []
  for (const path of CONTRACT_PATHS) {
    if (pathEntryExists(join(projectRoot, path))) evidence.push(`contract:${path}`)
  }
  for (const path of INGESTION_PATH_MARKERS) {
    if (pathEntryExists(join(projectRoot, path))) evidence.push(`path:${path}`)
  }
  inspectPackageScripts(projectRoot, evidence)
  inspectWorkflows(projectRoot, evidence)
  inspectNetworkIngestionSources(projectRoot, evidence, excludeHarnessProjectChildren)
  return evidence
}

const inspectAncestorRepositoryIngestion = (projectRoot, includeAncestorRepositories) => {
  if (!includeAncestorRepositories) return []
  let repositoryRoot = null
  for (let directory = projectRoot; ; directory = dirname(directory)) {
    if (isValidGitBoundary(directory)) {
      repositoryRoot = directory
      break
    }
    if (directory === dirname(directory)) break
  }
  if (!repositoryRoot || repositoryRoot === projectRoot) return []

  const evidence = []
  let depth = 0
  for (let directory = dirname(projectRoot); ; directory = dirname(directory)) {
    depth += 1
    evidence.push(...collectOperationalEvidence(directory, {excludeHarnessProjectChildren: true}).map(item => `ancestor[${depth}]:${item}`))
    if (directory === repositoryRoot) break
  }
  return [...new Set(evidence)].sort()
}

export const inspectExternalIngestion = (projectPath, {includeAncestorRepositories = true} = {}) => {
  const requestedRoot = resolve(projectPath)
  let projectRoot
  try {
    projectRoot = realpathSync(requestedRoot)
  } catch (error) {
    return {
      detected: true,
      contractsComplete: false,
      scheduledStatic: false,
      mode: null,
      evidence: ['uninspectable-project-root'],
      errors: [`External ingestion project root cannot be canonicalized: ${error instanceof Error ? error.message : String(error)}`],
    }
  }
  const evidence = collectOperationalEvidence(projectRoot)
  const contractPresence = Object.fromEntries(CONTRACT_PATHS.map(path => [path, pathEntryExists(join(projectRoot, path))]))
  const ancestorEvidence = inspectAncestorRepositoryIngestion(projectRoot, includeAncestorRepositories)
  evidence.push(...ancestorEvidence)
  const runtime = readRuntimeContractMode(projectRoot)
  const contractsComplete = CONTRACT_PATHS.every(path => contractPresence[path] === true)
  return {
    detected: evidence.length > 0,
    contractsComplete,
    scheduledStatic: runtime.mode === 'static-snapshot' && runtime.scheduled,
    mode: runtime.mode,
    evidence: [...new Set(evidence)].sort(),
    errors: [
      ...runtime.errors,
      ...(evidence.some(item => item.startsWith('uninspectable-') || item === 'source-scan-budget-exceeded')
        ? ['External ingestion detection could not safely inspect every security-relevant project file']
        : []),
      ...(ancestorEvidence.length > 0
        ? ['External ingestion markers exist above the selected project root; migrate to one canonical release root or define a reviewed multi-root adapter']
        : []),
    ],
  }
}

export const EXTERNAL_INGESTION_CAPABILITY = 'external-ingestion'
export const SCHEDULED_STATIC_INGESTION_CAPABILITY = 'scheduled-static-ingestion'
