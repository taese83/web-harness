import {existsSync, lstatSync, readFileSync, readdirSync} from 'node:fs'
import {isAbsolute, join, relative, resolve, sep} from 'node:path'
import {loadBuiltinAdapters, RETIRED_ADAPTER_IDS, retiredAdapterError} from './adapter-lib.mjs'
import {readJson, sortedUnique, WebCoreError} from './core-lib.mjs'
import {adapterSha256, resolveAdapterSelection} from './profile-policy-lib.mjs'

const packageNames = packageJson => sortedUnique(
  ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
    .flatMap(key => Object.keys(packageJson[key] ?? {})),
)

// ── 증거 기반 판별 (2026-08-26) ────────────────────────────────────────────────
// 배경(실측 2026-08-26): React 19 + Vite 8 SPA인 모노레포 패키지가 PROFILE_NOT_DETECTED로
// 거부됐다. 원인은 `allPackages: ["react","vite"]`가 **그 패키지의 package.json만** 보는
// AND 게이트인데, `vite`가 **워크스페이스 루트**에 선언돼 있었기 때문이다(모노레포 호이스팅).
// 패키지를 루트로 잡으면 vite가 안 보이고, 저장소 루트를 잡으면 react가 안 보인다 —
// **어느 쪽을 잡아도 실패**가 실측됐다. 정작 `vite.config.ts`가 그 패키지에 있었다.
// 감지기가 통과시키던 형태는 사실상 **하네스가 스스로 생성한 단일 루트 프로젝트**뿐이다(I3).
//
// 근거 확대는 **workspace 하나뿐**이다 — 모노레포 호이스팅(위 실측 사례).
//
// lockfile 근거는 적대 리뷰(2026-08-26)에서 **기각**됐다. lockfile 등재는 "설치됨"의 증거이지
// "이 패키지가 그것으로 빌드된다"의 증거가 아니다 — 모든 lockfile 형식이 전이 의존을 평탄하게
// 등재하고 워크스페이스 lockfile은 형제 패키지 것까지 공유한다. 구체 반례:
//   · webpack/CRA React 앱이 vitest를 쓰면 vite가 lockfile에 들어와 react-vite-spa로 오탐
//   · 모노레포의 Vue+Vite 패키지가 형제의 react를 근거로 react-vite-spa에 매칭
// AMBIGUOUS_PROFILE은 2개+ 매칭에서만 발화하므로 이 오탐은 **조용하다**. 실측 사건은
// workspace 근거만으로 해소되므로 lock은 무실측 가설이었고, 도입하지 않는다.
const WORKSPACE_MARKERS = ['pnpm-workspace.yaml', 'pnpm-workspace.yml']
const WORKSPACE_SEARCH_DEPTH = 6

// 워크스페이스 루트를 위로 탐색한다. pnpm-workspace 마커 또는 package.json의 workspaces 필드.
export const findWorkspaceRoot = start => {
  let current = resolve(start)
  for (let depth = 0; depth <= WORKSPACE_SEARCH_DEPTH; depth += 1) {
    if (WORKSPACE_MARKERS.some(marker => existsSync(join(current, marker)))) return current
    const manifest = join(current, 'package.json')
    if (existsSync(manifest)) {
      try {
        if (readJson(manifest).workspaces) return current
      } catch {}
    }
    // 저장소 경계에서 멈춘다(리뷰 F4) — 없으면 얕은 프로젝트가 사용자 홈의 잔존
    // package.json(workspaces 필드)이나 무관한 상위 저장소를 근거로 삼을 수 있다.
    if (existsSync(join(current, '.git'))) break
    const parent = resolve(current, '..')
    if (parent === current) break
    current = parent
  }
  return null
}

// 워크스페이스 루트에서 요구 패키지를 모두 선언한 멤버 패키지(상대 경로). pnpm-workspace의 목록 항목 중 `dir`·`dir/*`만
// 읽는다 — 그 밖의 항목(부정·중첩 glob)은 보지 않는다. 목록 항목이 멤버가 아니면(package.json 없음) 건너뛴다.
export const workspaceMembersDeclaring = (root, requiredPackages) => {
  const manifestPath = WORKSPACE_MARKERS.map(marker => join(root, marker)).find(path => existsSync(path))
  if (!manifestPath || requiredPackages.length === 0) return []
  const members = new Set()
  for (const [, glob] of readFileSync(manifestPath, 'utf8').matchAll(/^\s*-\s*['"]?([^'"\s#!][^'"\s#]*)['"]?\s*$/gm)) {
    const starred = glob.endsWith('/*')
    const base = starred ? glob.slice(0, -2) : glob
    if (base.includes('*') || base.includes('..')) continue
    const candidates = starred
      ? (existsSync(join(root, base)) ? readdirSync(join(root, base), {withFileTypes: true}).filter(entry => entry.isDirectory()).map(entry => `${base}/${entry.name}`) : [])
      : [base]
    for (const candidate of candidates) {
      const manifest = join(root, candidate, 'package.json')
      if (!existsSync(manifest)) continue
      let names
      try { names = new Set(packageNames(readJson(manifest))) } catch { continue }
      if (requiredPackages.every(name => names.has(name))) members.add(candidate)
    }
  }
  return [...members].sort()
}

const inspectProject = projectRoot => {
  const root = resolve(projectRoot)
  if (!existsSync(root) || !lstatSync(root).isDirectory()) {
    throw new WebCoreError('PROJECT_ROOT_INVALID', `Project root must be an existing directory: ${root}`)
  }
  const packagePath = join(root, 'package.json')
  const packageJson = existsSync(packagePath) ? readJson(packagePath) : {}
  const workspaceRoot = findWorkspaceRoot(root)
  const workspaceIsAncestor = workspaceRoot !== null && workspaceRoot !== root
  const workspaceManifest = workspaceIsAncestor ? join(workspaceRoot, 'package.json') : null
  const workspacePackages = workspaceManifest && existsSync(workspaceManifest)
    ? packageNames(readJson(workspaceManifest))
    : []
  return {
    root,
    packageJson,
    packages: packageNames(packageJson),
    workspaceRoot,
    workspacePackages,
  }
}

const markerExists = (root, marker) => {
  const candidate = resolve(root, marker)
  const offset = relative(root, candidate)
  if (offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)) return false
  return existsSync(candidate)
}

export const detectAdapter = (adapter, project) => {
  const detection = adapter.detection
  const packages = new Set(project.packages)
  const workspacePackages = new Set(project.workspacePackages ?? [])
  // 요구 패키지의 충족 근거를 셋 중 하나로 인정하고, **어느 근거였는지 이름을 남긴다**(I1).
  //   declared   — 이 패키지의 package.json 선언 (기존 동작)
  //   workspace  — 워크스페이스 루트 package.json 선언 (모노레포 호이스팅)
  //   lock       — lockfile 등재 = 실제 설치됨
  const requiredEvidence = name => {
    if (packages.has(name)) return 'declared'
    if (workspacePackages.has(name)) return 'workspace'
    return null
  }
  const requiredSources = new Map(detection.allPackages.map(name => [name, requiredEvidence(name)]))
  const anyRequiredSources = new Map(detection.anyPackages.map(name => [name, requiredEvidence(name)]))
  const allPackages = [...requiredSources.values()].every(source => source !== null)
  const anyPackages = detection.anyPackages.length === 0
    || [...anyRequiredSources.values()].some(source => source !== null)
  const allPaths = detection.allPaths.every(path => markerExists(project.root, path))
  const anyPaths = detection.anyPaths.length === 0 || detection.anyPaths.some(path => markerExists(project.root, path))
  // forbidden도 workspace 선언까지 본다(리뷰 F3) — required가 워크스페이스 근거를 인정하는데
  // forbidden만 패키지 선언에 한정하면, forbidden을 루트로 호이스트해 경계를 우회할 수 있다.
  const forbiddenPackages = detection.forbiddenPackages
    .filter(name => packages.has(name) || workspacePackages.has(name))
  const forbiddenPaths = detection.forbiddenPaths.filter(path => markerExists(project.root, path))
  const candidate = allPackages && anyPackages && allPaths && anyPaths
  const blockers = sortedUnique([
    ...forbiddenPackages.map(name => `package:${name}`),
    ...forbiddenPaths.map(path => `path:${path}`),
  ])
  const matched = candidate && blockers.length === 0
  // 근거 출처를 문자열에 박는다 — `package:vite@lock`처럼. 어떤 증거가 판정을 만들었는지
  // 보이지 않으면 감지 자체가 새 self-attestation 표면이 된다(I1).
  const evidence = matched
    ? sortedUnique([
        ...[...requiredSources].map(([name, source]) => `package:${name}@${source}`),
        ...[...anyRequiredSources].filter(([, source]) => source !== null)
          .map(([name, source]) => `package:${name}@${source}`),
        ...detection.allPaths.map(path => `path:${path}`),
        ...detection.anyPaths.filter(path => markerExists(project.root, path)).map(path => `path:${path}`),
      ])
    : []
  return {id: adapter.id, matched, candidate, incompatibleCandidate: allPackages && anyPackages && blockers.length > 0, evidence, blockers}
}

export const resolveProjectProfile = ({
  projectRoot,
  requested = 'auto',
  deploymentProvider,
  deploymentTarget,
  capabilities,
  adapters = loadBuiltinAdapters(),
}) => {
  if (!projectRoot) throw new WebCoreError('PROJECT_ROOT_REQUIRED', '--project-root is required')
  const project = inspectProject(projectRoot)
  const adapterById = new Map(adapters.map(adapter => [adapter.id, adapter]))
  if (adapterById.size !== adapters.length) throw new WebCoreError('DUPLICATE_PROFILE', 'Adapter profile ids must be unique')
  if (RETIRED_ADAPTER_IDS.includes(requested)) throw retiredAdapterError(requested)
  if (requested !== 'auto' && !adapterById.has(requested)) {
    throw new WebCoreError('UNKNOWN_PROFILE', `Unknown requested profile: ${requested}`, {available: [...adapterById.keys()].sort()})
  }

  const inspection = adapters.map(adapter => detectAdapter(adapter, project))
  const detections = inspection.filter(result => result.matched)
  if (detections.length > 1) {
    throw new WebCoreError('AMBIGUOUS_PROFILE', 'Project matches more than one built-in profile', {matches: detections.map(item => item.id).sort()})
  }
  const detected = detections[0] ?? null
  if (requested === 'auto' && !detected) {
    const incompatible = inspection.filter(result => result.incompatibleCandidate)
    if (incompatible.length > 0) {
      throw new WebCoreError('PROFILE_INCOMPATIBLE', 'Project contains markers outside the supported profile boundary', {
        candidates: incompatible.map(result => ({id: result.id, blockers: result.blockers})),
      })
    }
    // 지원 profile 후보가 없는 Next.js 프로젝트만 은퇴로 알린다 — `next`를 함께 선언한 Vite 앱은 위의 INCOMPATIBLE이다.
    if (project.packages.includes('next') || (project.workspacePackages ?? []).includes('next')) throw retiredAdapterError('next-app-fullstack')
    throw new WebCoreError('PROFILE_NOT_DETECTED', 'No built-in profile matched the project', {available: [...adapterById.keys()].sort()})
  }
  if (requested !== 'auto' && detected && detected.id !== requested) {
    throw new WebCoreError('PROFILE_CONFLICT', `Requested profile ${requested} conflicts with detected profile ${detected.id}`, {requested, detected: detected.id})
  }

  if (requested !== 'auto') {
    const requestedInspection = inspection.find(result => result.id === requested)
    if (requestedInspection?.blockers.length > 0) {
      throw new WebCoreError('PROFILE_INCOMPATIBLE', `Requested profile ${requested} contains forbidden project markers`, {
        requested,
        blockers: requestedInspection.blockers,
      })
    }
  }

  const selectedId = requested === 'auto' ? detected.id : requested
  const adapter = adapterById.get(selectedId)
  // 워크스페이스 루트에서 강제 지정했는데 요구 패키지가 멤버에만 있으면 잘못 잡은 루트다 — 그대로 잠그면 이 루트에서는
  // 영영 충족되지 않는 패키지 계약이 된다(러너가 PROJECT_PROFILE_PACKAGE_MISSING으로 막힌다). 앱 패키지를 가리킨다.
  // 멤버가 없으면(그린필드 — scaffold 전) 막지 않는다.
  if (requested !== 'auto' && !detected && project.workspaceRoot === project.root) {
    const missing = adapter.detection.allPackages.filter(name => !project.packages.includes(name))
    const members = missing.length > 0 ? workspaceMembersDeclaring(project.root, adapter.detection.allPackages) : []
    if (members.length > 0) {
      throw new WebCoreError('PROFILE_AT_WORKSPACE_ROOT',
        `Requested profile ${selectedId} declares its packages in workspace members, not at this workspace root — resolve the profile for the app package`,
        {missing, members})
    }
  }
  const selectedCapabilities = capabilities
  const selection = resolveAdapterSelection({
    adapter,
    deploymentProvider,
    deploymentTarget,
    capabilities: selectedCapabilities,
  })
  const source = detected && requested !== 'auto' ? 'requested-and-detected' : requested === 'auto' ? 'detected' : 'requested'
  const packageDeclarations = Object.fromEntries(
    sortedUnique([...adapter.detection.allPackages, ...adapter.detection.anyPackages])
      .filter(name => project.packageJson.dependencies?.[name] || project.packageJson.devDependencies?.[name])
      .map(name => [name, project.packageJson.dependencies?.[name] ?? project.packageJson.devDependencies?.[name]]),
  )
  return {
    $schema: 'https://web-harness.local/schemas/web-core/project-profile.schema.json',
    schemaVersion: 1,
    profileId: adapter.id,
    resolution: {
      source,
      requested: requested === 'auto' ? null : requested,
      detected: detected?.id ?? null,
      evidence: sortedUnique(detected?.evidence ?? []),
    },
    adapter: {
      id: adapter.id,
      version: adapter.version,
      sha256: adapterSha256(adapter),
      supportLevel: adapter.supportLevel,
      trustTier: adapter.trust.tier,
    },
    product: {kind: adapter.profileDefaults.productKind},
    frontend: {
      framework: adapter.project.framework,
      variant: adapter.project.variant,
      router: adapter.project.router,
      rendering: [...adapter.project.rendering].sort(),
      packageManager: adapter.project.packageManager,
    },
    backend: {shape: adapter.profileDefaults.backendShape},
    runtime: {primary: adapter.runtime.primary, supported: [...adapter.runtime.supported].sort()},
    capabilities: selection.selectedCapabilities,
    deployment: {
      provider: selection.provider.id,
      availableProviders: adapter.deploymentProviders
        .filter(provider => provider.deploymentTargets.includes(selection.target.id))
        .map(provider => provider.id)
        .sort(),
      target: selection.target.id,
      availableTargets: adapter.deploymentTargets
        .map(target => target.id)
        .sort(),
      releaseTarget: selection.releaseTarget,
      artifacts: selection.artifacts,
    },
    risk: {
      level: selection.target.id === 'static-export' ||
        !selection.selectedCapabilities.some(capability => ['auth', 'cookie-auth', 'route-handler-mutation', 'server-actions'].includes(capability))
        ? 'public'
        : adapter.profileDefaults.riskLevel,
    },
    toolchain: {
      nodeEngine: project.packageJson.engines?.node ?? null,
      packageManager: project.packageJson.packageManager ?? null,
      packageDeclarations,
      exactFrameworkVersions: Object.values(packageDeclarations).length > 0 &&
        Object.values(packageDeclarations).every(value => /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)),
    },
  }
}
