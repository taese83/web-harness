import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {join} from 'node:path'

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
const PERFORMANCE_REPORTS = [['performance', 'qa-perf.md']]
const SEO_REPORTS = [['seo', 'qa-seo.md']]

const hasArtifact = (projectRoot, relativePath) => existsSync(join(projectRoot, relativePath))
// 설계 산출물은 분할 디렉터리(`<name>/`)도 같은 산출물이다(artifact-sharding-contract) — 파일만 보면 분할하는 순간
// 그 QA 보고서 요구가 조용히 사라진다.
const hasDesignArtifact = (projectRoot, name) =>
  hasArtifact(projectRoot, `_workspace/02_design/${name}.md`) || hasArtifact(projectRoot, `_workspace/02_design/${name}`)
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
// requirements.md `## Modes`의 모드 선언 줄을 읽는다. 분할 산출물(`requirements/`)도 읽고, 템플릿 그대로의
// `true | false`는 선언이 아니다.
export const declaresMode = (projectRoot, mode) => {
  const pattern = new RegExp(`^[\\s>*-]*\\**${mode}\\**:\\s*[\`*]*true\\b(?![\`*]*[ \\t]*[|/])`, 'im')
  const plan = join(projectRoot, '_workspace/01_plan')
  const shard = join(plan, 'requirements')
  const files = [join(plan, 'requirements.md')]
  try {
    if (existsSync(shard)) files.push(...readdirSync(shard).filter(name => name.endsWith('.md')).map(name => join(shard, name)))
  } catch {
    // 읽지 못한 분할 디렉터리는 선언이 없는 것과 같게 본다 — 설계 산출물 트리거는 그대로 남는다
  }
  return files.some(file => {
    try {
      return existsSync(file) && pattern.test(readFileSync(file, 'utf8'))
    } catch {
      return false
    }
  })
}
const isPerformanceProject = projectRoot => hasDesignArtifact(projectRoot, 'performance-budget')
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
  hasDesignArtifact(projectRoot, 'seo-spec') || declaresPublicExposure(projectRoot)
// 은퇴한 모드 — 선언·설계 산출물이 남은 프로젝트에 더 이상 QA를 요구하지 않는다는 사실을 조용히 넘기지 않고 알린다.
const RETIRED_MODES = [
  ['ANALYTICS_BUILDER_MODE', ['analytics-architecture'], 'qa-analytics.md'],
  ['TIMESERIES_MODE', ['timeseries-architecture'], 'qa-timeseries.md'],
  ['LOCAL_DOMAIN_STATE_MODE', ['state-contract'], 'qa-state.md'],
  ['EXTERNAL_DATA_INGESTION_MODE', ['ingestion-contract', 'runtime-data-contract.json'], 'qa-data-quality.md'],
  ['VISUAL_QA_MODE', ['visual-qa-contract.json', 'visual-baseline-manifest.json'], 'qa-visual.md'],
]
const hasRetiredArtifact = (projectRoot, names) => names.some(name =>
  name.includes('.') ? hasArtifact(projectRoot, `_workspace/02_design/${name}`) : hasDesignArtifact(projectRoot, name))
export const retiredModeDeclarations = projectRoot =>
  RETIRED_MODES.filter(([mode, artifacts]) => declaresMode(projectRoot, mode) || hasRetiredArtifact(projectRoot, artifacts))
    .map(([mode, , report]) => `${mode}는 이 하네스가 더 이상 다루지 않는다 — ${report}를 요구하지 않고 전용 설계·검증도 돌지 않는다`)

export const releaseReportRequirements = projectRoot => [
  ...BASE_REPORTS,
  ...(isPerformanceProject(projectRoot) ? PERFORMANCE_REPORTS : []),
  ...(isSeoProject(projectRoot) ? SEO_REPORTS : []),
  ...(isServerOwnedDataProject(projectRoot) ? DATA_ACCESS_REPORTS : []),
]
