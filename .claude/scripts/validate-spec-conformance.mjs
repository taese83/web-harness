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
import {existsSync, readFileSync, statSync} from 'node:fs'
import {isAbsolute, join, relative, resolve, sep} from 'node:path'
import {findWorkspaceRoot} from './web-core/profile-lib.mjs'
import {isSpecLockStale, readSubstrateDefaults} from './lock-spec.mjs'

const SPEC_LOCK_PATH = '_workspace/03_dev/spec-lock.json'
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
  const specLock = readJsonIfExists(lockPath)
  if (specLock === null) {
    return {status: 'NOT_LOCKED', failures: [], unverifiable: [], notes: [`${SPEC_LOCK_PATH}가 없다 — 잠금은 아직 선택이다`]}
  }

  const declared = collectDeclaredPackages(root)
  const failures = []
  const unverifiable = []
  const notes = []

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

  if (specLock.specTier === 'unverifiable') {
    notes.push('specTier가 unverifiable이다 — 수용 기준이 없어 이 설계가 옳은지는 판정할 수 없다. 형식 정합만 확인했다')
  }
  notes.push(`targetShape: ${specLock.targetShape} — 형태별 게이트 선택은 아직 배선되지 않았다(Stage 2b)`)

  return {status: failures.length > 0 ? 'FAIL' : 'PASS', failures, unverifiable, notes}
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
