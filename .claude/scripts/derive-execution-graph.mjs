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
import {readFileSync} from 'node:fs'

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
const evidenceOf = checkId => `evidence.${RECEIPT_ALIASES[checkId] ?? checkId.replace(/\./g, '-')}`

// 골격 — 모든 프로필에서 동일했다(실측).
const skeleton = () => [
  {id: 'core.resolve-profile', requires: [...BOOTSTRAP], provides: ['profile.resolved']},
  {id: 'adapter.scaffold', requires: ['profile.resolved'], provides: ['source.ready']},
  {id: 'dependencies.install', requires: ['source.ready'], provides: ['dependencies.installed']},
]

export const deriveGraph = ({checks}) => {
  const tasks = skeleton()
  const evidence = []
  let hasBuild = false
  for (const check of checks) {
    if (check.id.endsWith(BUILD_CHECK_SUFFIX)) {
      hasBuild = true
      tasks.push({id: check.id, requires: ['dependencies.installed', 'evidence.typecheck'], provides: ['artifact.built']})
      continue
    }
    const provides = evidenceOf(check.id)
    evidence.push(provides)
    tasks.push({
      id: check.id,
      requires: check.needsArtifact === true ? ['artifact.built'] : ['dependencies.installed'],
      provides: [provides],
    })
  }
  // 산출물 소비 검사가 있는데 빌드가 없으면 도달 불가능한 그래프다 — 조용히 넘기지 않는다.
  const seen = new Map()
  for (const name of evidence) {
    if (seen.has(name)) return {tasks: [], evidence: [], errors: [`evidence 이름이 충돌한다: ${name} — 서로 다른 검사가 같은 증거로 합쳐지면 하나만 돌아도 통과한다`]}
    seen.set(name, true)
  }
  const orphaned = checks.filter(c => c.needsArtifact === true).map(c => c.id)
  if (!hasBuild && orphaned.length > 0) {
    return {tasks: [], evidence: [], errors: [`빌드 task가 없는데 artifact를 요구하는 검사가 있다: ${orphaned.join(', ')}`]}
  }
  tasks.push({id: 'release.assemble', requires: [...evidence].sort(), provides: [TARGET]})
  return {tasks, evidence, errors: []}
}

if (import.meta.url === `file://${process.argv[1]}`) {
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
