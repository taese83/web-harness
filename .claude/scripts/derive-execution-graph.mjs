#!/usr/bin/env node
// derive-execution-graph.mjs — 실행 DAG를 규칙에서 도출한다.
//
// 종전에는 `.claude/adapters/{id}/adapter.json`의 `tasks`가 프로필마다 그래프를 선언했다
// (11·13·32 tasks). 실측(2026-08-26): 공통 8개 중 7개가 완전히 동일하고, 다른 하나
// (`release.assemble`)는 evidence 합집합이라 자동 도출된다. 고유 task도 전부 아래 네 규칙의
// 인스턴스였다 — 즉 프로필마다 다른 것은 **어느 검사가 빌드 산출물을 쓰는가** 한 비트뿐이다.
//
//   1. 정적 검사      requires=[dependencies.installed]        provides=[evidence.<id>]
//   2. 빌드           requires=[dependencies.installed, evidence.typecheck] provides=[artifact.built]
//   3. 산출물 소비 검사 requires=[artifact.built]                provides=[evidence.<id>]
//   4. release.assemble requires= 모든 evidence.* 합집합         provides=[release.candidate]
//
// 그 한 비트는 `shape-checks.json`의 `needsArtifact`가 선언한다. 프로필 파일이 아니라
// 형태 카탈로그에 있어야 하는 값이다 — 빌드 산출물을 쓰는지는 검사의 성질이지 스택의 성질이 아니다.
//
// 2026-08-27 확장 — `next-app-fullstack`(32 tasks)까지 덮으려고 네 규칙을 일반화했다. 종전
// 기록은 "Next는 형태 어휘 밖"이라고 적었으나 **틀렸다**: `next.*` 22종의 실행 명령이 전부
// `pnpm run <script>`였다(하네스 고유 명령 0건). 프레임워크 지식이 아니라 script 이름표다.
// 없던 것은 어휘가 아니라 **조건 기구**였다:
//
//   5. 능력 게이팅     `requires: [capability]`  — 배포 타깃·아키텍처 속성으로 검사를 켠다
//   6. 이름 있는 산출물 `producesArtifact` / `needsArtifact: '<name>'` — 빌드가 하나가 아니다
//                     (Next: artifact.built → artifact.next.docker / artifact.next.static-export)
//   7. 타깃별 릴리스   배포 타깃마다 release 노드가 서고, 그 타깃에서 활성인 검사만 요구한다
//   8. 릴리스 게이팅   `gatesRelease: false` — smoke는 생존 확인이지 릴리스 게이트가 아니다
//                     (어댑터의 release.* requires에서 smoke가 빠져 있던 것을 명시로 옮겼다)
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'

const SHAPE_CHECKS_PATH = new URL('../shape-checks.json', import.meta.url)
export const BOOTSTRAP = ['requirements.locked']
export const TARGET = 'release.candidate'
export const BUILD_CHECK_SUFFIX = '.build'

export const readShapeChecks = () => JSON.parse(readFileSync(SHAPE_CHECKS_PATH, 'utf8'))

// evidence 이름은 receipt 이름을 따른다. 접두만 떼면 `api.unit`과 `quality.unit`이 둘 다
// `evidence.unit`으로 충돌한다(도출 초안의 실제 버그) — 어댑터는 `evidence.api-unit`으로
// 구분하고 있었다. 충돌은 조용히 합쳐지면 안 되므로 아래에서 loud fail한다.
export const RECEIPT_ALIASES = Object.freeze({
  'quality.lint': 'lint', 'quality.typecheck': 'typecheck', 'quality.unit': 'unit',
  'vite.build': 'build', 'vite.browser': 'browser',
  'vite.production-mock-boundary': 'production-boundary',
  'api.unit': 'api-unit', 'api.guards': 'api-guards',
  'ingestion.validate': 'ingestion',
})
// receipt 이름에는 단일 규칙이 없다 — 어댑터 실측: `quality.lint`→`evidence.lint`(접두 제거),
// `api.unit`→`evidence.api-unit`(점→대시), `next.route-contract`→`evidence.next.route-contract`
// (점 유지). 구조로 가를 수 없으므로 카탈로그가 실제 이름을 적을 수 있게 한다. 규칙을 지어내면
// receipt 이름이 바뀌고 기존 receipt가 전부 낡는다.
export const evidenceNameOf = check => {
  if (typeof check === 'string') return `evidence.${RECEIPT_ALIASES[check] ?? check.replace(/\./g, '-')}`
  if (typeof check.evidenceName === 'string' && check.evidenceName.trim() !== '') return check.evidenceName
  return `evidence.${RECEIPT_ALIASES[check.id] ?? check.id.replace(/\./g, '-')}`
}

// 실행 계획 노드의 `phase`는 receiptKind에서 도출한다 — 어댑터 실측 규칙이다.
// (레거시 어댑터에는 security를 verify로도 runtime으로도 적은 비일관이 3건 있었다. 계획 노드의
//  phase를 분기에 쓰는 소비자는 없어 — 통과 메타데이터다 — 규칙으로 정규화했다.)
export const PHASE_OF_KIND = Object.freeze({
  static: 'verify', unit: 'verify', contract: 'verify', security: 'verify',
  build: 'build', artifact: 'build',
  browser: 'runtime', runtime: 'runtime',
})
const phaseOf = check => PHASE_OF_KIND[check.receiptKind] ?? 'verify'

// 골격 — 모든 프로필에서 동일했다(실측).
const skeleton = () => [
  {id: 'core.resolve-profile', phase: 'plan', requires: [...BOOTSTRAP], provides: ['profile.resolved'], commandIds: []},
  {id: 'adapter.scaffold', phase: 'scaffold', requires: ['profile.resolved'], provides: ['source.ready'], commandIds: []},
  {id: 'dependencies.install', phase: 'install', requires: ['source.ready'], provides: ['dependencies.installed'], commandIds: ['dependencies.install']},
]

// 검사가 주어진 능력 집합에서 활성인가. `requires`가 없으면 항상 활성이다(기존 동작 보존).
const isActive = (check, active) => (check.requires ?? []).every(requirement => active.has(requirement))

// 검사가 만드는 산출물 이름(없으면 null). 빌드/2차 산출물 검사는 evidence가 아니라 artifact를 낸다.
// 원문: 빌드 검사는 관례상 `.build`로 끝나고 `artifact.built`를 만든다.
export const artifactOf = check =>
  check.producesArtifact ?? (check.id.endsWith(BUILD_CHECK_SUFFIX) ? 'artifact.built' : null)

// 검사가 소비하는 산출물 이름. `true`는 기본 빌드 산출물을 뜻한다(기존 표기 보존).
const consumedArtifact = check =>
  check.needsArtifact === true ? 'artifact.built' : typeof check.needsArtifact === 'string' ? check.needsArtifact : null

export const deriveGraph = ({checks, capabilities = null, deploymentTargets = null, defaultTarget = null}) => {
  const tasks = skeleton()
  const errors = []
  // task는 **카탈로그 전체**를 낸다(어댑터도 그랬다). 능력 필터는 릴리스 요구를 정할 때만 쓴다 —
  // 둘을 섞으면 "선언에는 있는데 도출에는 없는 task"가 생겨 등가가 깨진다.
  const produced = new Set()
  for (const check of checks) {
    const artifact = artifactOf(check)
    if (artifact) produced.add(artifact)
  }

  const evidence = []
  for (const check of checks) {
    const artifact = artifactOf(check)
    const consumes = consumedArtifact(check)
    const requires = consumes ? [consumes] : ['dependencies.installed']
    if (artifact === 'artifact.built') {
      tasks.push({id: check.id, phase: phaseOf(check), requires: ['dependencies.installed', 'evidence.typecheck'], provides: [artifact], commandIds: [check.id]})
      continue
    }
    if (artifact) {
      // 2차 산출물(도커 이미지·정적 export) — 기본 빌드 산출물을 소비해 자기 산출물을 낸다.
      tasks.push({id: check.id, phase: phaseOf(check), requires, provides: [artifact], commandIds: [check.id]})
      continue
    }
    const provides = evidenceNameOf(check)
    evidence.push({name: provides, check})
    tasks.push({id: check.id, phase: phaseOf(check), requires, provides: [provides], commandIds: [check.id]})
  }

  // 소비하는 산출물을 아무도 만들지 않으면 도달 불가능한 그래프다 — 조용히 넘기지 않는다.
  for (const check of checks) {
    const consumes = consumedArtifact(check)
    if (consumes && !produced.has(consumes)) {
      errors.push(`'${check.id}'가 요구하는 산출물 '${consumes}'를 아무 검사도 만들지 않는다`)
    }
  }
  const seen = new Set()
  for (const {name} of evidence) {
    if (seen.has(name)) {
      return {tasks: [], evidence: [], errors: [`evidence 이름이 충돌한다: ${name} — 서로 다른 검사가 같은 증거로 합쳐지면 하나만 돌아도 통과한다`]}
    }
    seen.add(name)
  }
  if (errors.length > 0) return {tasks: [], evidence: [], errors}

  // 릴리스 노드. **배포 타깃별로 활성 검사가 다르면 노드가 갈린다** — 같은 활성 집합을 갖는
  // 타깃끼리는 한 노드를 공유한다(vite 2종은 어느 검사도 타깃을 요구하지 않아 한 노드,
  // Next는 node/docker/static이 서로 다른 검사를 켜 세 노드). 이것이 어댑터가 선언으로
  // 갖고 있던 차이의 전부다.
  const gatingEvidence = active =>
    evidence
      .filter(item => item.check.gatesRelease !== false && isActive(item.check, active))
      .map(item => item.name)
      .sort()

  if (deploymentTargets === null || deploymentTargets.length === 0) {
    tasks.push({id: 'release.assemble', phase: 'release', requires: gatingEvidence(new Set(capabilities ?? [])), provides: [TARGET], commandIds: []})
    return {tasks, evidence: evidence.map(item => item.name), errors: []}
  }

  const base = new Set(capabilities ?? [])
  const groups = new Map()
  for (const target of deploymentTargets) {
    const requires = gatingEvidence(new Set([...base, target]))
    if (requires.length === 0) {
      errors.push(`배포 타깃 '${target}'의 릴리스 요구가 비어 있다 — 아무 검사도 활성이 아니면 릴리스가 공허하다`)
      continue
    }
    const signature = requires.join('|')
    if (!groups.has(signature)) groups.set(signature, {requires, targets: []})
    groups.get(signature).targets.push(target)
  }
  if (errors.length > 0) return {tasks: [], evidence: [], errors}
  for (const {requires, targets} of groups.values()) {
    // 기본 타깃을 품은 그룹이 정본 릴리스 노드다 — `release.candidate`는 거기서만 나온다.
    const isDefault = defaultTarget !== null && targets.includes(defaultTarget)
    tasks.push({
      id: isDefault ? 'release.assemble' : `release.${targets[0]}`,
      phase: 'release',
      requires,
      provides: [...(isDefault ? [TARGET] : []), ...targets.map(target => `release.${target}`)].sort(),
      commandIds: [],
    })
  }
  return {tasks, evidence: evidence.map(item => item.name), errors: []}
}

// main guard: `file://${argv[1]}` 문자열 결합은 POSIX에서만 맞는다 — Windows 경로(D:\…)에서는
// 절대 일치하지 않아 CLI가 통째로 no-op하고 exit 0이 된다(조용한 통과).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  const i = argv.indexOf('--shapes')
  if (i < 0) { process.stderr.write('사용법: --shapes <a,b>\n'); process.exit(2) }
  const shapes = argv[i + 1].split(',').map(v => v.trim()).filter(Boolean)
  const catalog = readShapeChecks()
  const checks = [...(catalog.common?.checks ?? []), ...shapes.flatMap(s => catalog.shapes?.[s]?.checks ?? [])]
  const {tasks, errors} = deriveGraph({checks})
  for (const e of errors) process.stderr.write(`${e}\n`)
  for (const t of tasks) process.stdout.write(`${t.id}\trequires=${t.requires.join(',')}\tprovides=${t.provides.join(',')}\n`)
  process.exit(errors.length === 0 ? 0 : 1)
}
