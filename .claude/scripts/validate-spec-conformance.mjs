#!/usr/bin/env node
// validate-spec-conformance.mjs — 잠긴 스팩이 실제와 맞는지 검사한다 (Stage 2a).
//
// 순서에 대한 판단: Stage 2의 목표는 "게이트를 프로필 적합성 → 스팩 적합성으로" 바꾸는 것이다.
// 그런데 **스팩이 게이트를 고르게 하려면 스팩 자체가 먼저 검증돼야 한다** — 검증되지 않은
// 자기보고에 게이트 선택을 맡기는 것이 정확히 검증 약화다. 그래서 2a는 게이트 선택을 바꾸지
// 않고 스팩의 주장을 실측과 대조하는 것만 한다. 게이트 선택 전환(2b)은 이것이 선다는 전제 위에
// 얹는다.
//
// 이 검사가 §4 이월 전제조건에 대해 실제로 한 일(**부분 이행**이며 과장하지 않는다):
//   · `isSpecLockStale` 배선 — **이행**
//   · layerMap 경로 실존·루트 이탈 — **이행**
//   · libraries·substrate의 `measured` 실존 대조 — **이행**, 단 대조 불가한 형태는
//     unverifiable로 보고된다(도구명이 npm 패키지명과 다르고 aliases 미등록인 경우 등)
//   · substrate ↔ toolchain pin 정합 — **부분**. 7키 중 packageManager 1키만 대조하며
//     나머지 6키는 pin과 결속되지 않는다. 기준값은 substrate-defaults에서 파생한다
//
// 판정:
//   NOT_LOCKED  spec-lock이 없다. 실패가 아니다 — 잠금은 아직 선택이다
//   FAIL        위조·모순·stale. measured 주장이 실측과 어긋나면 여기다(I1)
//   PASS        검증 가능한 주장이 전부 실측과 맞다
// 어느 경우든 검증할 수 **없었던** 것을 함께 보고한다 — 침묵한 미검증은 통과로 읽힌다.
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs'
import {isAbsolute, join, relative, resolve, sep} from 'node:path'
import {findWorkspaceRoot} from './web-core/profile-lib.mjs'
import {COMMON_RECEIPT_ALIASES} from './web-core/profile-policy-lib.mjs'
import {inspectSpecLockLedger, isSpecLockStale, readSubstrateDefaults} from './lock-spec.mjs'

const SPEC_LOCK_PATH = '_workspace/03_dev/spec-lock.json'
const EVIDENCE_DIR = '_workspace/04_qa/evidence'
const SHAPE_CHECKS_PATH = new URL('../shape-checks.json', import.meta.url)
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

// substrate 키별 실측 근거. 여기 없는 키는 "검증 불가"로 보고한다 — 조용히 통과시키지 않는다.
// value는 도구 이름이므로 의존성 선언이 1차 근거이고, 설정 파일 존재가 보조 근거다.
export const SUBSTRATE_EVIDENCE = {
  packageManager: {kind: 'packageManagerField'},
  // 도구명과 npm 패키지명이 다른 것들은 aliases로 잇는다 — 없으면 정당한 실측이 오탐 FAIL 난다.
  bundler: {
    kind: 'dependency',
    aliases: {rspack: ['@rspack/core'], rolldown: ['rolldown', '@rolldown/binding'], turbopack: ['next']},
    configs: {vite: ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'], rspack: ['rspack.config.ts', 'rspack.config.js']},
  },
  testRunner: {kind: 'dependency'},
  lint: {kind: 'dependency', aliases: {biome: ['@biomejs/biome'], oxlint: ['oxlint']}},
  formatter: {kind: 'dependency', aliases: {biome: ['@biomejs/biome']}},
  e2e: {kind: 'dependency', aliases: {playwright: ['@playwright/test', 'playwright'], cypress: ['cypress']}},
  language: {kind: 'dependency', aliases: {typescript: ['typescript']}},
}

const readJsonIfExists = path => {
  if (!existsSync(path) || !statSync(path).isFile()) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

// 프로젝트와 워크스페이스 루트의 선언을 합친다 — 모노레포 호이스팅을 포섭한다.
export const collectDeclaredPackages = projectRoot => {
  const root = resolve(projectRoot)
  const roots = [root]
  const workspaceRoot = findWorkspaceRoot(root)
  if (workspaceRoot && workspaceRoot !== root) roots.push(workspaceRoot)
  const names = new Set()
  let packageManagerField = null
  for (const dir of roots) {
    const manifest = readJsonIfExists(join(dir, 'package.json'))
    if (!manifest) continue
    if (packageManagerField === null && typeof manifest.packageManager === 'string') {
      packageManagerField = manifest.packageManager
    }
    for (const field of DEPENDENCY_FIELDS) {
      for (const name of Object.keys(manifest[field] ?? {})) names.add(name)
    }
  }
  return {names, packageManagerField}
}

const withinRoot = (root, relativePath) => {
  const candidate = resolve(root, relativePath)
  const offset = relative(root, candidate)
  return !(offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset))
}

// layerMap이 가리키는 경로가 실제로 있는가. 없는 경로를 measured로 적었다면 위조다.
export const checkLayerMap = (specLock, projectRoot) => {
  const root = resolve(projectRoot)
  const failures = []
  for (const [layer, path] of Object.entries(specLock.layerMap ?? {})) {
    // 괄호 주석으로 부재를 표기한 경우는 경로 주장이 아니다.
    if (/^\(.*\)$/.test(path.trim())) continue
    if (!withinRoot(root, path)) {
      failures.push({layer, path, reason: '프로젝트 루트를 벗어난다'})
      continue
    }
    if (!existsSync(resolve(root, path))) failures.push({layer, path, reason: '경로가 존재하지 않는다'})
  }
  return failures
}

// ── 형태 → 요구 검증 (Stage 2b) ──────────────────────────────────────────────
// 형태가 검증을 고른다. targetShapes가 배열이므로 요구 세트는 **합집합**이다 —
// 라이브러리이면서 CLI인 패키지는 두 세트를 모두 요구받는다.
export const readShapeChecks = () => JSON.parse(readFileSync(SHAPE_CHECKS_PATH, 'utf8'))

// 요구 검사를 구현 여부로 가른다.
// **하네스가 못 하는 것을 프로젝트 실패로 보고하지 않는다** — implemented: false는 요구되지만
// 수행할 방법이 없는 것이고, 그것을 FAIL로 내면 "프로젝트가 뭔가 잘못했다"는 뜻이 된다.
// 잘못한 건 하네스다. 그래서 별도 상태로 보고한다.
export const resolveRequiredChecks = (targetShapes, catalog = readShapeChecks()) => {
  const entries = new Map()
  const unknownShapes = []
  for (const entry of catalog.common?.checks ?? []) entries.set(entry.id, entry)
  for (const shape of targetShapes ?? []) {
    const definition = catalog.shapes?.[shape]
    if (!definition) {
      unknownShapes.push(shape)
      continue
    }
    for (const entry of definition.checks ?? []) entries.set(entry.id, entry)
  }
  const all = [...entries.values()]
  return {
    required: all.filter(entry => entry.implemented !== false).map(entry => entry.id).sort(),
    unimplemented: all.filter(entry => entry.implemented === false).map(entry => entry.id).sort(),
    unknownShapes,
  }
}

// 수행된 검증을 evidence receipt에서 읽는다. receipt는 evidence/{id}.json이고 status를 갖는다.
// 요구 id를 실제 receipt 파일명으로 옮긴다. 러너는 quality.lint를 lint.json으로 쓴다 —
// 이 정합이 없으면 잠근 프로젝트 전원이 "receipt가 없다"로 오탐 블록된다(적대 리뷰 실측).
export const receiptNameFor = checkId => COMMON_RECEIPT_ALIASES[checkId] ?? checkId

export const readEvidence = projectRoot => {
  const dir = resolve(projectRoot, EVIDENCE_DIR)
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return null
  const receipts = new Map()
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const receipt = readJsonIfExists(join(dir, entry.name))
    if (receipt === null) continue
    receipts.set(receipt.id ?? entry.name.replace(/\.json$/, ''), receipt.status ?? null)
  }
  return receipts
}

// 요구된 검증이 실제로 수행됐는가. **이것이 2b가 게이트가 되는 지점이다.**
// evidence 디렉토리 자체가 없으면 아직 검증 단계가 아니므로 판정하지 않는다(NOT_RUN).
export const checkShapeEvidence = (specLock, projectRoot) => {
  const {required, unimplemented, unknownShapes} = resolveRequiredChecks(specLock.targetShapes)
  const receipts = readEvidence(projectRoot)
  if (receipts === null) {
    return {evidenceState: 'NOT_RUN', required, unimplemented, missing: [], failing: [], unknownShapes}
  }
  const missing = required.filter(check => !receipts.has(receiptNameFor(check)))
  const failing = required.filter(check =>
    receipts.has(receiptNameFor(check)) && receipts.get(receiptNameFor(check)) !== 'PASS')
  return {evidenceState: 'RUN', required, unimplemented, missing, failing, unknownShapes}
}

// 선언된 형태를 package.json 필드와 대조한다(조사 2026-08-26).
// 형태가 게이트를 고르게 되면(2b) **형태 자기보고 하나로 검증 세트 전체를 회피**할 수 있다 —
// `library`라고 적어서 웹앱 검증 22종을 건너뛰는 식이다. 그래서 형태가 게이트를 고르기 전에
// 대조가 먼저 서야 한다. 잠금의 verifiable 라벨을 feature-plan 실존에 결박한 것과 같은 이유다.
//
// 대조 근거는 npm 관례 그대로다: `bin`이 있으면 CLI, `exports`/`main`이 있고 private이 아니면
// 배포 라이브러리. 모순만 FAIL로 잡고 근거 부재는 unverifiable로 보고한다 — 근거가 없다는 것이
// 거짓이라는 뜻은 아니다.
export const checkTargetShapes = (specLock, projectRoot) => {
  const manifest = readJsonIfExists(join(resolve(projectRoot), 'package.json'))
  const shapes = Array.isArray(specLock.targetShapes) ? specLock.targetShapes : []
  const failures = []
  const unverifiable = []
  const notes = []
  if (manifest === null) {
    unverifiable.push({kind: 'targetShapes', reason: 'package.json이 없어 형태를 대조할 수 없다'})
    return {failures, unverifiable, notes}
  }
  const hasBin = manifest.bin !== undefined && manifest.bin !== null
  const hasEntry = manifest.exports !== undefined || typeof manifest.main === 'string'
  const isPrivate = manifest.private === true

  if (shapes.includes('cli') && !hasBin) {
    failures.push({kind: 'targetShapes', reason: 'cli를 주장하나 package.json에 bin 필드가 없다 — bin이 CLI의 정의다'})
  }
  if (shapes.includes('library')) {
    if (isPrivate) {
      failures.push({kind: 'targetShapes', reason: 'library를 주장하나 private: true다 — 배포할 수 없는 패키지다'})
    } else if (!hasEntry) {
      failures.push({kind: 'targetShapes', reason: 'library를 주장하나 exports도 main도 없다 — 소비 진입점이 없다'})
    }
  }
  // 반대 방향: 신호가 있는데 선언하지 않으면 그 형태의 검사가 돌지 않는다.
  // 배포되는 패키지에서 신호를 선언하지 않으면 그 형태의 검증이 조용히 빠진다. 소비자에게
  // 노출되는 표면이므로 note가 아니라 FAIL이다 — 실사용 잠금(2026-08-26)에서 드러난 우회다.
  if (hasBin && !shapes.includes('cli')) {
    if (isPrivate) {
      notes.push('package.json에 bin이 있는데 targetShapes에 cli가 없다 — private 패키지라 내부 스크립트일 수 있으나 CLI 검증은 선택되지 않는다')
    } else {
      failures.push({kind: 'targetShapes', reason: '배포되는 패키지에 bin이 있는데 targetShapes에 cli가 없다 — 소비자에게 명령으로 노출되는데 CLI 검증이 선택되지 않는다'})
    }
  }
  if (hasEntry && !shapes.includes('library')) {
    if (isPrivate) {
      // 리뷰 반영(2026-08-26): 여기가 완전 침묵이었다. private이어도 워크스페이스 형제 패키지가
      // 진입점을 소비하면 실소비자가 있다 — 배포되지 않을 뿐 검증이 빠진 사실은 같다.
      notes.push('진입점이 있는데 targetShapes에 library가 없다 — private 패키지라 배포되지는 않으나 패키지 검증은 선택되지 않는다')
    } else {
      failures.push({kind: 'targetShapes', reason: '배포되는 패키지에 진입점이 있는데 targetShapes에 library가 없다 — 패키지 검증이 선택되지 않는다'})
    }
  }
  for (const shape of shapes) {
    if (!['cli', 'library'].includes(shape)) {
      unverifiable.push({kind: 'targetShapes', reason: `'${shape}' 형태의 기계 대조 규칙이 없다`})
    }
  }
  return {failures, unverifiable, notes}
}

// layerMap이 실제 트리를 얼마나 덮는가(Stage 3c).
// 실측 근거: 한 브라운필드 패키지에서 hooks·stores·consts·styles가 소유자 없음으로 막혔다.
// 설계자가 레이어를 빠뜨리면 그 디렉토리는 **아무 에이전트도 쓸 수 없게** 되는데, 지금은
// 아무도 그 사실을 알려주지 않는다. FAIL은 아니다 — public/ 처럼 소유자가 없어도 되는
// 디렉토리가 있다. 대신 이름을 들어 보고한다: 침묵한 공백은 개발 중에야 드러난다.
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte|css|scss)$/
const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', '.git', '_workspace'])

const hasSourceFiles = directory => {
  try {
    return readdirSync(directory, {withFileTypes: true})
      .some(entry => entry.isFile() && SOURCE_FILE.test(entry.name))
  } catch {
    return false
  }
}

export const checkLayerMapCoverage = (specLock, projectRoot, appRoot = 'src') => {
  const root = resolve(projectRoot)
  const base = resolve(root, appRoot)
  if (!existsSync(base) || !statSync(base).isDirectory()) return []
  const covered = Object.values(specLock.layerMap ?? {})
    .filter(value => typeof value === 'string' && !/^\(.*\)$/.test(value.trim()))
    .map(value => resolve(root, value.trim()))
  const uncovered = []
  for (const entry of readdirSync(base, {withFileTypes: true})) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || IGNORED_DIRECTORIES.has(entry.name)) continue
    const path = join(base, entry.name)
    // 이 디렉토리나 그 상위가 어떤 레이어에 덮이는가
    if (covered.some(layer => path === layer || path.startsWith(`${layer}${sep}`) || layer.startsWith(`${path}${sep}`))) continue
    if (!hasSourceFiles(path)) continue
    uncovered.push(relative(root, path))
  }
  return uncovered
}

// libraries의 measured / measured-absent 주장을 선언과 대조한다.
export const checkLibraries = (specLock, declared) => {
  const failures = []
  const unverifiable = []
  for (const [role, entry] of Object.entries(specLock.libraries ?? {})) {
    if (entry.source === 'proposed') continue
    if (entry.source === 'measured-absent') {
      if (entry.choice !== 'none') {
        unverifiable.push({role, reason: `measured-absent인데 choice가 'none'이 아니라 대조 대상이 모호하다: ${entry.choice}`})
      }
      continue
    }
    // measured — choice에서 패키지 이름을 뽑는다. scoped(@scope/name)를 먼저 시도한다.
    // 이전 구현은 선두 @에서 split해 빈 문자열이 나왔고, 결과적으로 **scoped 패키지 전체가
    // 검증을 건너뛰었다**(fail-open — 위조가 통과). 적대 리뷰 2026-08-26 실측.
    const candidate = (entry.choice.match(/^(@[^/@\s(]+\/[^@\s(]+|[^@\s(]+)/)?.[0] ?? '').trim()
    if (candidate === '' || candidate === 'none') {
      unverifiable.push({role, reason: `measured인데 choice가 패키지 이름 형태가 아니다: ${entry.choice}`})
      continue
    }
    if (!declared.names.has(candidate)) {
      failures.push({role, claim: entry.choice, reason: `measured라 주장하나 의존성 선언에 ${candidate}가 없다`})
    }
  }
  return {failures, unverifiable}
}

// substrate의 measured 주장을 대조한다. 근거 규칙이 없는 키는 검증 불가로 보고한다.
export const checkSubstrate = (specLock, declared, projectRoot) => {
  const root = resolve(projectRoot)
  const failures = []
  const unverifiable = []
  for (const [key, entry] of Object.entries(specLock.constitution?.substrate ?? {})) {
    if (entry.source !== 'measured') continue
    const rule = SUBSTRATE_EVIDENCE[key]
    if (!rule) {
      unverifiable.push({key, reason: '이 키의 실측 근거 규칙이 없다'})
      continue
    }
    if (rule.kind === 'packageManagerField') {
      if (declared.packageManagerField === null) {
        unverifiable.push({key, reason: 'package.json에 packageManager 필드가 없어 대조할 수 없다'})
      } else if (!declared.packageManagerField.startsWith(entry.value)) {
        failures.push({key, claim: entry.value, reason: `measured라 주장하나 packageManager는 ${declared.packageManagerField}다`})
      }
      continue
    }
    const names = rule.aliases?.[entry.value] ?? [entry.value]
    const declaredHit = names.some(name => declared.names.has(name))
    const configHit = (rule.configs?.[entry.value] ?? []).some(file => existsSync(resolve(root, file)))
    if (!declaredHit && !configHit) {
      failures.push({key, claim: entry.value, reason: `measured라 주장하나 ${names.join('|')} 선언도 설정 파일도 없다`})
    }
  }
  return {failures, unverifiable}
}

// substrate가 하네스 toolchain pin과 어긋나는지. 지금은 packageManager만 기계 대조 가능하다.
// 하드코딩 리터럴 대신 substrate-defaults에서 파생한다 — 리터럴은 pin의 N번째 사본이 된다.
export const defaultToolchain = () => ({packageManager: readSubstrateDefaults().packageManager})

export const checkToolchainAlignment = (specLock, toolchain) => {
  const substrate = specLock.constitution?.substrate ?? {}
  const declared = substrate.packageManager?.value
  if (!declared || !toolchain?.packageManager) return []
  return declared === toolchain.packageManager
    ? []
    : [{key: 'packageManager', reason: `스팩은 ${declared}인데 하네스 toolchain은 ${toolchain.packageManager}를 강제한다`}]
}

export const inspectSpecConformance = ({projectRoot, toolchain = defaultToolchain()}) => {
  const root = resolve(projectRoot)
  const lockPath = join(root, SPEC_LOCK_PATH)
  // 부재와 손상을 구분한다(적대 리뷰 2026-08-26). 이전 구현은 파싱 실패를 null로 삼켜
  // **잠금 파일을 한 바이트만 깨뜨리면 결박 전체가 꺼졌고**, 보고까지 거짓이었다(파일이
  // 실존하는데 "없다"고 말했다). 삭제보다 나쁘다 — 삭제는 정직한 opt-out처럼이라도 보인다.
  // 이 repo의 판례와도 배치된다: 깨진 live.json은 침묵 폴백 없이 INVALID_LIVE_CONFIG로 loud fail.
  if (!existsSync(lockPath) || !statSync(lockPath).isFile()) {
    // 원장에 잠금 이력이 있는데 파일이 없으면 삭제다 — opt-out이 아니라 결박 해제 시도다.
    const ledger = inspectSpecLockLedger(root, null)
    if (ledger.state === 'DELETED') {
      return {
        status: 'FAIL',
        failures: [{kind: 'lockLedger', reason: `SPEC_LOCK_DELETED — 원장에 잠금 기록 ${ledger.rows}건이 있는데 ${SPEC_LOCK_PATH}가 없다`}],
        unverifiable: [],
        notes: ['잠금을 지워 결박을 푸는 경로다. 의도적으로 잠금을 해제하려면 원장도 함께 정리하고 그 사실이 커밋에 남아야 한다'],
      }
    }
    return {status: 'NOT_LOCKED', failures: [], unverifiable: [], notes: [`${SPEC_LOCK_PATH}가 없다 — 잠금은 아직 선택이다`]}
  }
  let specLock
  try {
    specLock = JSON.parse(readFileSync(lockPath, 'utf8'))
    if (specLock === null || typeof specLock !== 'object' || Array.isArray(specLock)) throw new Error('객체가 아니다')
  } catch (error) {
    return {
      status: 'FAIL',
      failures: [{kind: 'lock', reason: `INVALID_SPEC_LOCK — ${SPEC_LOCK_PATH}가 존재하나 읽을 수 없다: ${error instanceof Error ? error.message : String(error)}`}],
      unverifiable: [],
      notes: ['손상된 잠금은 잠금 없음으로 강등되지 않는다 — 그러면 파일 하나 깨뜨려 결박을 끌 수 있다'],
    }
  }

  const declared = collectDeclaredPackages(root)
  const failures = []
  const ledger = inspectSpecLockLedger(root, specLock)
  if (ledger.state === 'TAMPERED') {
    failures.push({kind: 'lockLedger', reason: `SPEC_LOCK_TAMPERED — 잠금 해시가 원장의 어떤 기록과도 맞지 않는다(현재 ${ledger.currentDigest.slice(0, 12)}…, 원장 최신 ${ledger.lastDigest.slice(0, 12)}…)`})
  }
  const ledgerNotes = ledger.state === 'NO_LEDGER'
    ? ['잠금 원장이 없다 — 이 잠금은 삭제·사후 수정 탐지에 결박되지 않는다']
    : []
  const unverifiable = []
  const notes = [...ledgerNotes]

  if (isSpecLockStale(specLock, root)) {
    failures.push({kind: 'stale', reason: '잠금 이후 입력이 바뀌었다 — 재잠금이 필요하다'})
  }
  for (const item of checkLayerMap(specLock, root)) failures.push({kind: 'layerMap', ...item})
  const libraries = checkLibraries(specLock, declared)
  for (const item of libraries.failures) failures.push({kind: 'libraries', ...item})
  for (const item of libraries.unverifiable) unverifiable.push({kind: 'libraries', ...item})
  const substrate = checkSubstrate(specLock, declared, root)
  for (const item of substrate.failures) failures.push({kind: 'substrate', ...item})
  for (const item of substrate.unverifiable) unverifiable.push({kind: 'substrate', ...item})
  for (const item of checkToolchainAlignment(specLock, toolchain)) failures.push({kind: 'toolchain', ...item})

  const shapes = checkTargetShapes(specLock, root)
  for (const item of shapes.failures) failures.push(item)
  for (const item of shapes.unverifiable) unverifiable.push(item)
  for (const note of shapes.notes) notes.push(note)

  // 형태가 요구하는 검증이 수행됐는가(2b)
  const evidence = checkShapeEvidence(specLock, root)
  if (evidence.evidenceState === 'RUN') {
    for (const check of evidence.missing) {
      failures.push({kind: 'shapeEvidence', reason: `선언된 형태가 요구하는 검증 '${check}'의 receipt가 없다`})
    }
    for (const check of evidence.failing) {
      failures.push({kind: 'shapeEvidence', reason: `요구 검증 '${check}'이 PASS가 아니다`})
    }
  } else {
    notes.push(`요구 검증 ${evidence.required.length}종(${evidence.required.join(', ')}) — evidence 디렉토리가 없어 아직 판정하지 않는다`)
  }
  for (const check of evidence.unimplemented) {
    unverifiable.push({kind: 'shapeEvidence', reason: `요구 검증 '${check}'은 하네스가 아직 수행할 수 없다 — 프로젝트 실패가 아니다`})
  }
  for (const shape of evidence.unknownShapes) {
    unverifiable.push({kind: 'shapeEvidence', reason: `'${shape}' 형태의 요구 검증 목록이 없다 — 이 형태는 아무것도 요구하지 않는다`})
  }

  const uncovered = checkLayerMapCoverage(specLock, root)
  if (uncovered.length > 0) {
    notes.push(`layerMap이 덮지 않는 소스 디렉토리 ${uncovered.length}개: ${uncovered.join(', ')} — 이 경로는 어떤 에이전트도 쓸 수 없다`)
  }

  if (specLock.specTier === 'unverifiable') {
    notes.push('specTier가 unverifiable이다 — 수용 기준이 없어 이 설계가 옳은지는 판정할 수 없다. 형식 정합만 확인했다')
  }
  notes.push(`targetShapes: ${(specLock.targetShapes ?? []).join(', ')} → 수행 가능 요구 ${evidence.required.length}종`
    + (evidence.unimplemented.length > 0 ? `, 미구현 요구 ${evidence.unimplemented.length}종` : ''))

  return {status: failures.length > 0 ? 'FAIL' : 'PASS', failures, unverifiable, uncoveredPaths: uncovered, requiredChecks: evidence.required, unimplementedChecks: evidence.unimplemented, evidenceState: evidence.evidenceState, notes}
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2)
  const rootIndex = argv.indexOf('--project-root')
  const projectRoot = rootIndex >= 0 ? argv[rootIndex + 1] : undefined
  if (!projectRoot) {
    process.stderr.write('사용법: node .claude/scripts/validate-spec-conformance.mjs --project-root <path> [--json]\n')
    process.exit(2)
  }
  const result = inspectSpecConformance({projectRoot})
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else {
    process.stdout.write(`spec conformance: ${result.status}\n`)
    for (const item of result.failures) process.stdout.write(`  FAIL [${item.kind}] ${item.reason}\n`)
    for (const item of result.unverifiable) process.stdout.write(`  검증 불가 [${item.kind}] ${item.reason}\n`)
    for (const note of result.notes) process.stdout.write(`  · ${note}\n`)
  }
  process.exit(result.status === 'FAIL' ? 1 : 0)
}
