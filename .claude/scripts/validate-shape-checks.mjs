#!/usr/bin/env node
// validate-shape-checks.mjs — 형태별 정적 검증을 수행하고 evidence receipt를 낸다.
//
// shape-checks.json에서 `kind: "static"`이고 `implemented: true`인 검사만 수행한다.
// runtime 검사(pack.contents·cli.exit-codes·cli.stderr-errors)는 실행이 필요해 quality
// runner에 바인딩돼야 하며 여기서 흉내내지 않는다 — 정적 근사로 PASS를 내면 프록시다.
//
// receipt는 기존 형식과 맞춘다: `_workspace/04_qa/evidence/{id}.json`에 `{id, status, ...}`.
// status는 PASS | FAIL 뿐이다. 판정할 수 없으면 receipt를 쓰지 않는다 — 미판정을 PASS로
// 승격하지 않는다는 것이 이 파일 전체의 규율이다.
import {existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs'
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path'
import {pathToFileURL} from 'node:url'

const EVIDENCE_DIR = '_workspace/04_qa/evidence'
const SHAPE_CHECKS_PATH = new URL('../shape-checks.json', import.meta.url)
const EXECUTABLE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs'])

export const readShapeChecks = () => JSON.parse(readFileSync(SHAPE_CHECKS_PATH, 'utf8'))

const readJsonIfExists = path => {
  if (!existsSync(path) || !statSync(path).isFile()) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

const withinRoot = (root, target) => {
  const offset = relative(root, resolve(root, target))
  return !(offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset))
}

// exports/bin 값에서 파일 경로를 모은다. 조건부 exports는 중첩 객체다.
export const collectTargets = value => {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(collectTargets)
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(collectTargets)
  return []
}

// ── library: 배포 메타데이터 ─────────────────────────────────────────────────
export const checkPublishMetadata = (manifest, projectRoot = '.') => {
  const problems = []
  if (manifest.private === true) problems.push('private: true — 배포할 수 없다')
  for (const field of ['name', 'version', 'license']) {
    if (typeof manifest[field] !== 'string' || manifest[field].trim() === '') {
      problems.push(`${field}이 없다`)
    }
  }
  if (manifest.exports === undefined && typeof manifest.main !== 'string') {
    problems.push('exports도 main도 없다 — 소비 진입점이 없다')
  }
  // files 허용목록이 없으면 의도치 않은 파일이 배포된다. npmignore가 있으면 그것으로 대체된다.
  // 실사용 스팩 확정 2호(2026-08-26)에서 잡힘: 이 줄만 상대 경로라 **하네스 cwd**의 .npmignore를
  // 봤다. 외부 project-root를 검사하면 대상과 무관하게 판정이 갈렸다(오탐·누락 양방향).
  if (!Array.isArray(manifest.files) && !existsSync(resolve(projectRoot, '.npmignore'))) {
    problems.push('files 허용목록도 .npmignore도 없다 — 배포 내용물이 통제되지 않는다')
  }
  return problems
}

// ── library: 공개 API 진입점 실존 ────────────────────────────────────────────
// 실사용 스팩 확정 2호(2026-08-26)에서 잡힘: 이 검사는 kind:"static"인데 **대상이 빌드 산출물**이다.
// 컴파일해 배포하는 정상 라이브러리는 빌드 전에 반드시 FAIL했다 — "미빌드"를 "결함"으로 보고한
// 것이다. 미판정을 PASS로 승격하지 않는 규율의 반대 방향(미판정을 FAIL로 강등)이 뚫려 있었다.
// 선언 정합(루트 이탈·진입점 부재)은 여전히 정적으로 판정하고, 파일 실존은 진입점의 최상위
// 디렉토리가 통째로 없으면 **미빌드로 보고**한다(receipt를 쓰지 않는다).
// 프록시 표기: "최상위 디렉토리 부재 = 미빌드"는 근사다. dist/가 있는데 파일만 빠진 경우는
// 여전히 FAIL이며, 실판정은 runtime pack.contents가 npm pack으로 해야 한다(미구현).
export const checkPublicApi = (manifest, projectRoot) => {
  const root = resolve(projectRoot)
  const targets = [
    ...collectTargets(manifest.exports),
    ...(typeof manifest.main === 'string' ? [manifest.main] : []),
    ...(typeof manifest.types === 'string' ? [manifest.types] : []),
  ].filter(target => target.startsWith('.'))
  const problems = []
  const unbuilt = []
  if (targets.length === 0) problems.push('해석할 진입점이 없다')
  for (const target of new Set(targets)) {
    if (!withinRoot(root, target)) {
      problems.push(`진입점이 패키지 루트를 벗어난다: ${target}`)
      continue
    }
    if (existsSync(resolve(root, target))) continue
    const topLevel = target.replace(/^\.\/+/, '').split('/')[0]
    if (topLevel && !existsSync(resolve(root, topLevel))) {
      unbuilt.push(`${target}(${topLevel}/ 자체가 없다)`)
      continue
    }
    problems.push(`진입점 파일이 없다: ${target}`)
  }
  return {problems, unbuilt}
}

// ── cli: bin 진입점 ─────────────────────────────────────────────────────────
// 관례(조사 2026-08-26): bin이 가리키는 파일이 존재하고 shebang으로 시작해야 npm이 만든
// 심링크가 동작한다. 확장자는 node가 해석할 수 있어야 한다.
export const checkBinEntrypoint = (manifest, projectRoot) => {
  const root = resolve(projectRoot)
  const targets = collectTargets(manifest.bin)
  const problems = []
  if (targets.length === 0) problems.push('bin 필드가 없거나 경로가 없다')
  for (const target of new Set(targets)) {
    if (!withinRoot(root, target)) {
      problems.push(`bin이 패키지 루트를 벗어난다: ${target}`)
      continue
    }
    const path = resolve(root, target)
    if (!existsSync(path) || !statSync(path).isFile()) {
      problems.push(`bin 파일이 없다: ${target}`)
      continue
    }
    const extension = target.slice(target.lastIndexOf('.'))
    if (!EXECUTABLE_EXTENSIONS.has(extension)) {
      problems.push(`bin 확장자를 node가 해석할 수 없다: ${target}`)
    }
    const head = readFileSync(path, 'utf8').slice(0, 200)
    if (!head.startsWith('#!')) problems.push(`bin에 shebang이 없다: ${target}`)
  }
  return problems
}

const STATIC_CHECKS = {
  'pack.publish-metadata': (manifest, root) => checkPublishMetadata(manifest, root),
  'lib.public-api': (manifest, root) => checkPublicApi(manifest, root),
  'cli.bin-entrypoint': (manifest, root) => checkBinEntrypoint(manifest, root),
}

// 선언된 형태가 요구하는 static·implemented 검사만 수행한다.
// 형태 카탈로그 항목의 **키 엄격성**. 어댑터에는 `assertKnownKeys`가 있었는데 2026-08-27
// 실행 명세를 카탈로그로 옮기면서 그 보호가 따라오지 않았다 — 실측: `gatesRelease`·
// `needsArtifact`·`evidenceName` 오타가 전부 조용히 통과했다. 오타는 기본값으로 퇴화하므로
// 게이트가 약해지는 방향이다(예: `gateRelease`로 잘못 적으면 smoke가 릴리스를 막게 된다).
const ENTRY_KEYS = new Set([
  'id', 'kind', 'implemented', '$comment',
  'receiptKind', 'needsArtifact', 'producesArtifact',
  'requires', 'gatesRelease', 'evidenceName', 'scriptCandidates',
])
const SHAPE_KEYS = new Set(['checks', 'userInterface', '$comment'])
const RECEIPT_KINDS = new Set(['build', 'static', 'unit', 'contract', 'browser', 'runtime', 'security', 'artifact'])

export const inspectShapeCatalog = (catalog = readShapeChecks()) => {
  const errors = []
  const groups = [['common', catalog.common?.checks], ...Object.entries(catalog.shapes ?? {}).map(([name, def]) => [name, def?.checks])]
  // 형태 수준 키도 엄격히 본다. `userInterface`는 **UI가 있는가**를 형태가 선언하는 곳이며,
  // 스팩 확정이 e2e 테스트 레이어를 요구할지를 여기서 도출한다(2026-08-28). 누락·오타를 허용하면
  // "UI 없음"으로 조용히 퇴화해 e2e 요구가 사라진다 — 검사 항목 키와 같은 규율이다.
  for (const [name, def] of Object.entries(catalog.shapes ?? {})) {
    for (const key of Object.keys(def ?? {})) {
      if (!SHAPE_KEYS.has(key)) errors.push(`shape-checks: shapes.${name}에 알 수 없는 키 '${key}'`)
    }
    if (typeof def?.userInterface !== 'boolean') {
      errors.push(`shape-checks: shapes.${name}.userInterface가 boolean이 아니다 — UI 여부는 형태가 명시 선언한다(e2e 테스트 레이어 요구가 여기서 도출된다)`)
    }
  }
  for (const [group, checks] of groups) {
    if (!Array.isArray(checks)) {
      errors.push(`shape-checks: '${group}'에 checks 배열이 없다`)
      continue
    }
    for (const [index, entry] of checks.entries()) {
      const label = `shape-checks: ${group}.checks[${index}]`
      for (const key of Object.keys(entry ?? {})) {
        if (!ENTRY_KEYS.has(key)) {
          errors.push(`${label}: 알 수 없는 키 '${key}' — 오타는 기본값으로 퇴화해 게이트를 약화시킨다`)
        }
      }
      if (typeof entry?.id !== 'string' || entry.id.trim() === '') errors.push(`${label}: id가 없다`)
      if (!['static', 'runtime'].includes(entry?.kind)) errors.push(`${label}: kind는 static|runtime이어야 한다`)
      if (entry?.receiptKind !== undefined && !RECEIPT_KINDS.has(entry.receiptKind)) {
        errors.push(`${label}: receiptKind가 유효하지 않다: ${entry.receiptKind}`)
      }
      if (entry?.gatesRelease !== undefined && typeof entry.gatesRelease !== 'boolean') {
        errors.push(`${label}: gatesRelease는 boolean이어야 한다`)
      }
      if (entry?.needsArtifact !== undefined && typeof entry.needsArtifact !== 'boolean' && typeof entry.needsArtifact !== 'string') {
        errors.push(`${label}: needsArtifact는 boolean 또는 산출물 이름이어야 한다`)
      }
      for (const key of ['requires', 'scriptCandidates']) {
        if (entry?.[key] !== undefined && !Array.isArray(entry[key])) errors.push(`${label}: ${key}는 배열이어야 한다`)
      }
      if (entry?.evidenceName !== undefined && !/^evidence\./.test(entry.evidenceName ?? '')) {
        errors.push(`${label}: evidenceName은 'evidence.'로 시작해야 한다`)
      }
      if (entry?.producesArtifact !== undefined && !/^artifact\./.test(entry.producesArtifact ?? '')) {
        errors.push(`${label}: producesArtifact는 'artifact.'로 시작해야 한다`)
      }
    }
  }
  return errors
}

export const runShapeChecks = ({projectRoot, targetShapes, catalog = readShapeChecks()}) => {
  const root = resolve(projectRoot)
  const manifest = readJsonIfExists(join(root, 'package.json'))
  const entries = [
    ...(catalog.common?.checks ?? []),
    ...(targetShapes ?? []).flatMap(shape => catalog.shapes?.[shape]?.checks ?? []),
  ]
  const runnable = entries.filter(entry =>
    entry.kind === 'static' && entry.implemented === true && STATIC_CHECKS[entry.id])
  if (manifest === null) {
    // 매니페스트가 없으면 판정하지 않는다 — receipt를 쓰지 않는 것이 정직하다.
    return {receipts: [], skipped: runnable.map(entry => ({id: entry.id, reason: 'package.json이 없다'}))}
  }
  const receipts = []
  const skipped = []
  for (const entry of runnable) {
    const outcome = STATIC_CHECKS[entry.id](manifest, root)
    // 검사는 배열(문제 목록) 또는 {problems, unbuilt}를 낸다. unbuilt는 하네스가 판정할 수
    // 없는 상태이지 프로젝트의 결함이 아니므로 receipt를 쓰지 않는다 — 미판정을 FAIL로
    // 강등하지 않는다는 규율이며, 미판정을 PASS로 승격하지 않는 것과 같은 규율의 반대 방향이다.
    const problems = Array.isArray(outcome) ? outcome : outcome.problems
    const unbuilt = Array.isArray(outcome) ? [] : (outcome.unbuilt ?? [])
    if (problems.length === 0 && unbuilt.length > 0) {
      skipped.push({id: entry.id, reason: `빌드 산출물이 없다 — 미빌드로 보고한다: ${unbuilt.join(', ')}`})
      continue
    }
    receipts.push({
      schemaVersion: 1,
      runner: 'validate-shape-checks',
      id: entry.id,
      kind: 'static',
      status: problems.length === 0 ? 'PASS' : 'FAIL',
      problems,
    })
  }
  return {receipts, skipped}
}

export const writeReceipts = (projectRoot, receipts) => {
  const dir = resolve(projectRoot, EVIDENCE_DIR)
  mkdirSync(dir, {recursive: true})
  for (const receipt of receipts) {
    writeFileSync(join(dir, `${receipt.id}.json`), `${JSON.stringify(receipt, null, 2)}\n`)
  }
  return receipts.length
}

// main guard: `file://${argv[1]}` 문자열 결합은 POSIX에서만 맞는다 — Windows 경로(D:\…)에서는
// 절대 일치하지 않아 CLI가 통째로 no-op하고 exit 0이 된다(조용한 통과).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  const rootIndex = argv.indexOf('--project-root')
  const shapesIndex = argv.indexOf('--shapes')
  const projectRoot = rootIndex >= 0 ? argv[rootIndex + 1] : undefined
  if (!projectRoot || shapesIndex < 0 || !argv[shapesIndex + 1]) {
    process.stderr.write('사용법: node .claude/scripts/validate-shape-checks.mjs --project-root <path> --shapes <a,b>\n')
    process.exit(2)
  }
  const targetShapes = argv[shapesIndex + 1].split(',').map(value => value.trim()).filter(Boolean)
  const {receipts, skipped} = runShapeChecks({projectRoot, targetShapes})
  writeReceipts(projectRoot, receipts)
  for (const receipt of receipts) {
    process.stdout.write(`${receipt.status === 'PASS' ? 'PASS' : 'FAIL'} ${receipt.id}\n`)
    for (const problem of receipt.problems) process.stdout.write(`  · ${problem}\n`)
  }
  for (const item of skipped) process.stdout.write(`SKIP ${item.id} — ${item.reason}\n`)
  process.exit(receipts.some(receipt => receipt.status === 'FAIL') ? 1 : 0)
}
