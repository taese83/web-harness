import {existsSync, lstatSync, readFileSync, readdirSync} from 'node:fs'
import {isAbsolute, join, relative, resolve, sep} from 'node:path'
import {loadBuiltinAdapters} from './adapter-lib.mjs'
import {readJson, sortedUnique, WebCoreError} from './core-lib.mjs'
import {
  EXTERNAL_INGESTION_CAPABILITY,
  inspectExternalIngestion,
  SCHEDULED_STATIC_INGESTION_CAPABILITY,
} from './ingestion-detection-lib.mjs'
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

const nextAppRoots = root => ['app', 'src/app'].filter(appRoot =>
  ['js', 'jsx', 'ts', 'tsx'].some(extension => markerExists(root, `${appRoot}/layout.${extension}`)),
)

const containsEdgeRuntime = (root, appRoots) => {
  const pending = appRoots.map(appRoot => join(root, appRoot))
  let inspected = 0
  while (pending.length > 0 && inspected < 1000) {
    const directory = pending.pop()
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) pending.push(path)
      else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name)) {
        inspected += 1
        if (/\bexport\s+const\s+runtime\s*=\s*['"]edge['"]/.test(readFileSync(path, 'utf8'))) return true
      }
    }
  }
  return false
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
  const detectedNextRoots = adapter.id === 'next-app-fullstack' ? nextAppRoots(project.root) : []
  const edgeRuntime = adapter.id === 'next-app-fullstack' && containsEdgeRuntime(project.root, detectedNextRoots)
  const anyPaths = adapter.id === 'next-app-fullstack'
    ? detectedNextRoots.length > 0
    : detection.anyPaths.length === 0 || detection.anyPaths.some(path => markerExists(project.root, path))
  // forbidden도 workspace 선언까지 본다(리뷰 F3) — required가 워크스페이스 근거를 인정하는데
  // forbidden만 패키지 선언에 한정하면, forbidden을 루트로 호이스트해 경계를 우회할 수 있다.
  const forbiddenPackages = detection.forbiddenPackages
    .filter(name => packages.has(name) || workspacePackages.has(name))
  const forbiddenPaths = detection.forbiddenPaths.filter(path => markerExists(project.root, path))
  const candidate = allPackages && anyPackages && allPaths && anyPaths
  const blockers = sortedUnique([
    ...forbiddenPackages.map(name => `package:${name}`),
    ...forbiddenPaths.map(path => `path:${path}`),
    ...(detectedNextRoots.length > 1 ? ['path:app+src/app'] : []),
    ...(edgeRuntime ? ['source:edge-runtime'] : []),
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
        ...(adapter.id === 'next-app-fullstack'
          ? detectedNextRoots.map(path => `path:${path}/layout`)
          : detection.anyPaths.filter(path => markerExists(project.root, path)).map(path => `path:${path}`)),
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
  includeAncestorIngestion = true,
}) => {
  if (!projectRoot) throw new WebCoreError('PROJECT_ROOT_REQUIRED', '--project-root is required')
  const project = inspectProject(projectRoot)
  const adapterById = new Map(adapters.map(adapter => [adapter.id, adapter]))
  if (adapterById.size !== adapters.length) throw new WebCoreError('DUPLICATE_PROFILE', 'Adapter profile ids must be unique')
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
  const ingestion = inspectExternalIngestion(project.root, {
    includeAncestorRepositories: includeAncestorIngestion,
  })
  // 감지 결과가 **식별을 막지 않는다**(2026-08-27). "이 프로젝트가 무엇인가"와 "빌드할 준비가
  // 됐는가"는 다른 질문이다. 종전에는 둘이 한 지점에 묶여 있어, 배포 알림 하나로 프로필 해석
  // 자체가 실패했다 — 실측: 이웃 repo 5개 중 4개가 여기서 막혔고 원인이 전부
  // `scripts/deploy.js`류의 **나가는 호출**이었다(`fetch(url,{method:'POST',body})`,
  // CDN 업로드, Jira/Slack 알림).
  //
  // 감지 강도는 **그대로 둔다** — 좁히면 진짜 수집을 놓친다(I2).
  //
  // **게이트는 어디로 갔나**: 식별 → 릴리스. `ingestion.detected`이면 아래에서
  // `external-ingestion` capability가 여전히 강제 선택되고(이 코드는 바뀌지 않았다),
  // 그 capability가 세 곳에서 발화한다:
  //   · run-quality-gates      — `ingestion.validate` receipt 요구(shape-checks, requires)
  //   · release-report-policy  — `qa-data-quality.md` 리포트 요구
  //   · release-gate-lib       — Vercel static ingestion 릴리스 차단
  // 계약이 없으면 **릴리스가 막힌다**. 통과하는 것은 식별뿐이다.
  //
  // `ingestionReadiness`는 게이트가 아니라 **보고**다 — 왜 그렇게 판정됐는지 프로필에 남긴다.
  // 게이트 노릇을 하는 필드를 여기 두면 실제로 강제되지 않는 가짜 게이트가 된다.
  const ingestionReadiness = {
    detected: ingestion.detected,
    contractsComplete: ingestion.contractsComplete,
    evidence: ingestion.evidence,
    inspectionErrors: ingestion.errors,
  }
  const requestedIngestion = capabilities?.some(capability =>
    [EXTERNAL_INGESTION_CAPABILITY, SCHEDULED_STATIC_INGESTION_CAPABILITY].includes(capability),
  ) === true
  // 사용자가 ingestion capability를 **명시적으로 요청**했는데 계약이 없으면 그건 모순이므로
  // 여전히 fail-close한다 — 자기가 켠 것을 뒷받침하지 않는 상태다. 감지만으로는 막지 않는다.
  if (requestedIngestion && !ingestion.contractsComplete) {
    throw new WebCoreError(
      'INGESTION_CONTRACT_MISSING',
      'Requested external ingestion capability requires both ingestion-contract.md and runtime-data-contract.json',
      {evidence: ingestion.evidence},
    )
  }
  // 감지는 **capability를 강제하지 않는다**(2026-08-27). 강제하면 오탐 하나가 그 프로젝트의
  // 릴리스를 영구히 막는다 — 실측: 이웃 repo 4개가 배포 알림·CDN 업로드·Jira 조회 때문에
  // `external-ingestion`을 강제 선택당하고, 그 capability는 `ingestion.validate` receipt와
  // `qa-data-quality.md`를 요구하는데 그 프로젝트엔 `validate:ingestion` script가 없다.
  // 만족시킬 수 없는 요구는 게이트가 아니라 벽이다.
  //
  // 능력은 스팩이 확정한다 — 형태(무엇을 만드는가)와 능력(무엇을 켰는가)을 가르는 같은 원칙이다.
  // 선언하면 아래 세 게이트가 **전부 그대로** 발화한다: `ingestion.validate` receipt ·
  // `qa-data-quality.md` · Vercel static ingestion 릴리스 차단.
  //
  // **약화 방향 표기(I2)**: 진짜로 수집하는데 선언하지 않으면 ingestion QA가 돌지 않는다.
  // 그래서 감지 결과를 `ingestionReadiness`로 프로필에 **크게 남긴다** — 오케스트레이터가
  // intake에서 물어야 할 근거다. 조용히 사라지지 않는다. protected-core §4 등록.
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
      evidence: sortedUnique([...(detected?.evidence ?? []), ...ingestion.evidence]),
    },
    adapter: {
      id: adapter.id,
      version: adapter.version,
      sha256: adapterSha256(adapter),
      supportLevel: adapter.supportLevel,
      trustTier: adapter.trust.tier,
    },
    // 감지 결과를 프로필에 남긴다 — 게이트가 아니라 **근거**다. 오케스트레이터가 intake에서
    // "이 프로젝트가 외부 데이터를 수집하나요?"를 물어야 할 자리이며, 사용자가 그렇다고 하면
    // `external-ingestion` capability를 선언하고 그때 모든 ingestion 게이트가 발화한다.
    ingestion: ingestionReadiness,
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
        .filter(targetId => !(adapter.id === 'next-app-fullstack' && targetId === 'docker-standalone'))
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
