import {existsSync} from 'node:fs'
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
const AI_REPORTS = [
  ['ai-evals', 'qa-ai-evals.md'],
  ['ai-security', 'qa-ai-security.md'],
  ['data-access', 'qa-data-access.md'],
  ['ai-cost-latency', 'qa-ai-cost-latency.md'],
  ['agent-traces', 'qa-agent-traces.md'],
]
const LOCAL_STATE_REPORTS = [['state', 'qa-state.md']]
const INGESTION_REPORTS = [['data-quality', 'qa-data-quality.md']]
const ANALYTICS_REPORTS = [['analytics', 'qa-analytics.md']]
const VISUAL_REPORTS = [['visual', 'qa-visual.md']]
const PERFORMANCE_REPORTS = [['performance', 'qa-perf.md']]
const SEO_REPORTS = [['seo', 'qa-seo.md']]
const TIMESERIES_REPORTS = [['timeseries', 'qa-timeseries.md']]

const hasArtifact = (projectRoot, relativePath) => existsSync(join(projectRoot, relativePath))
const isAiProject = projectRoot =>
  hasArtifact(projectRoot, '_workspace/01_plan/ai-requirements.md') ||
  hasArtifact(projectRoot, '_workspace/02_design/ai-architecture.md')
const isLocalDomainStateProject = projectRoot =>
  hasArtifact(projectRoot, '_workspace/02_design/state-contract.md')
const isAnalyticsProject = projectRoot =>
  hasArtifact(projectRoot, '_workspace/02_design/analytics-architecture.md')
export const isVisualProject = projectRoot =>
  hasArtifact(projectRoot, '_workspace/02_design/visual-qa-contract.json')
const isPerformanceProject = projectRoot =>
  hasArtifact(projectRoot, '_workspace/02_design/performance-budget.md')
const isSeoProject = projectRoot =>
  hasArtifact(projectRoot, '_workspace/02_design/seo-spec.md')
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
  ...(isAiProject(projectRoot) ? AI_REPORTS : []),
  ...profileReportRequirements(lockedProfile),
].filter(([id]) => phase === 'final' || !ATTESTATION_DEPENDENT_REPORT_IDS.has(id))
