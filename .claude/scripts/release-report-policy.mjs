import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {join} from 'node:path'
import {profileReportRequirements} from './release-profile-lib.mjs'

const BASE_REPORTS = [
  ['code', 'qa-code.md'],
  ['ux', 'qa-ux.md'],
  ['integration', 'qa-integration.md'],
  ['security', 'qa-security.md'],
  ['api-contract', 'qa-api-contract.md'],
  ['test', 'qa-test.md'],
  ['browser', 'qa-browser.md'],
]
const DATA_ACCESS_REPORTS = [['data-access', 'qa-data-access.md']]
const LOCAL_STATE_REPORTS = [['state', 'qa-state.md']]
const INGESTION_REPORTS = [['data-quality', 'qa-data-quality.md']]
const ANALYTICS_REPORTS = [['analytics', 'qa-analytics.md']]
const VISUAL_REPORTS = [['visual', 'qa-visual.md']]
const PERFORMANCE_REPORTS = [['performance', 'qa-perf.md']]
const SEO_REPORTS = [['seo', 'qa-seo.md']]
const TIMESERIES_REPORTS = [['timeseries', 'qa-timeseries.md']]

const hasArtifact = (projectRoot, relativePath) => existsSync(join(projectRoot, relativePath))
// 서버가 데이터를 소유하면 tenant/row-level 인가는 client 코드 리뷰로 증명되지 않는다 —
// migration 디렉터리(= /server-db-migration 산출)가 그 조건의 관측 가능한 신호다.
// 경로 모델은 `agent-registry`의 소유권 정규식(`(?:[^/]+/)+?migrations/`)과 정합해야 한다 —
// `/server-db-migration`이 `client/migrations/`를 **기존 관습**으로 문서화하므로 루트만 보면
// 하네스가 스스로 권한 관습을 따른 프로젝트가 조용히 이 요구에서 빠진다(2026-08-27 적대 검토).
const IGNORED_ROOTS = new Set(['node_modules', '.git', 'dist', 'build', '_workspace', '.next'])
const isServerOwnedDataProject = projectRoot => {
  if (hasArtifact(projectRoot, 'migrations')) return true
  let entries
  try {
    entries = readdirSync(projectRoot, {withFileTypes: true})
  } catch {
    return false
  }
  return entries.some(
    entry =>
      entry.isDirectory() &&
      !entry.name.startsWith('.') &&
      !IGNORED_ROOTS.has(entry.name) &&
      existsSync(join(projectRoot, entry.name, 'migrations')),
  )
}
const isLocalDomainStateProject = projectRoot =>
  hasArtifact(projectRoot, '_workspace/02_design/state-contract.md')
const isAnalyticsProject = projectRoot =>
  hasArtifact(projectRoot, '_workspace/02_design/analytics-architecture.md')
export const isVisualProject = projectRoot =>
  hasArtifact(projectRoot, '_workspace/02_design/visual-qa-contract.json')
const isPerformanceProject = projectRoot =>
  hasArtifact(projectRoot, '_workspace/02_design/performance-budget.md')
// 공개 노출은 tech-stack.md의 `PUBLIC_EXPOSURE: yes` 선언으로도 켠다. 스펙 파일만 트리거로 쓰면 생산자가
// 빠졌을 때 SEO QA가 조용히 사라진다 — 선언이 있으면 qa-seo가 필수이고, 스펙이 없으면 seo-verifier가 BLOCKED다.
// 분할 산출물(`tech-stack/`)도 읽는다. 템플릿 그대로의 `yes | no`는 선언이 아니다.
const PUBLIC_EXPOSURE_YES = /^[\s>*-]*\**PUBLIC_EXPOSURE\**:\s*[`*]*yes\b(?![`*]*[ \t]*\|)/im
export const declaresPublicExposure = projectRoot => {
  const plan = join(projectRoot, '_workspace/01_plan')
  const shard = join(plan, 'tech-stack')
  const files = [join(plan, 'tech-stack.md')]
  try {
    if (existsSync(shard)) files.push(...readdirSync(shard).filter(name => name.endsWith('.md')).map(name => join(shard, name)))
  } catch {
    // 읽지 못한 분할 디렉터리는 선언이 없는 것과 같게 본다 — 스펙 파일 트리거는 그대로 남는다
  }
  return files.some(file => {
    try {
      return existsSync(file) && PUBLIC_EXPOSURE_YES.test(readFileSync(file, 'utf8'))
    } catch {
      return false
    }
  })
}
const isSeoProject = projectRoot =>
  hasArtifact(projectRoot, '_workspace/02_design/seo-spec.md') || declaresPublicExposure(projectRoot)
const isTimeseriesProject = projectRoot =>
  hasArtifact(projectRoot, '_workspace/02_design/timeseries-architecture.md')

const ATTESTATION_DEPENDENT_REPORT_IDS = new Set(['next-contract'])

export const releaseReportRequirements = (projectRoot, lockedProfile, phase, externalIngestion) => [
  ...BASE_REPORTS,
  ...(isLocalDomainStateProject(projectRoot) ? LOCAL_STATE_REPORTS : []),
  ...(isAnalyticsProject(projectRoot) ? ANALYTICS_REPORTS : []),
  ...(isVisualProject(projectRoot) ? VISUAL_REPORTS : []),
  ...(isPerformanceProject(projectRoot) ? PERFORMANCE_REPORTS : []),
  ...(isSeoProject(projectRoot) ? SEO_REPORTS : []),
  ...(isTimeseriesProject(projectRoot) ? TIMESERIES_REPORTS : []),
  ...(externalIngestion ? INGESTION_REPORTS : []),
  ...(isServerOwnedDataProject(projectRoot) ? DATA_ACCESS_REPORTS : []),
  ...profileReportRequirements(lockedProfile),
].filter(([id]) => phase === 'final' || !ATTESTATION_DEPENDENT_REPORT_IDS.has(id))
