import {spawnSync} from 'node:child_process'
import {resolveProfileCommands} from '../resolve-commands.mjs'
import {generateKeyPairSync, randomUUID, sign} from 'node:crypto'
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {collectDeploymentArtifacts} from '../artifact-inventory-lib.mjs'
import {computeSourceFingerprint, sha256} from '../evidence-lib.mjs'
import {
  buildReleaseManifest,
  releaseReportRequirements,
  requiresProtectedPrebuiltDeployment,
  validateReleaseGate,
} from '../release-gate-lib.mjs'
import {
  INGESTION_RECEIPT_ID,
  ingestionReceiptEvidence,
  validateRuntimeDataArtifacts,
} from '../runtime-data-contract-lib.mjs'
import {buildQualityAttestationSubject, readProtectedQualityContext} from '../quality-attestation-lib.mjs'
import {analyzePackageScript, readDependencyBinding, readExecutionTargetBinding} from '../quality-policy-lib.mjs'
import {resolveReleaseProfile} from '../release-profile-lib.mjs'
import {resolveProjectProfile} from '../web-core/profile-lib.mjs'
import {
  adapterCheckBindings,
  projectProfileSha256,
  readLockedExecutionPlan,
  readLockedProjectProfile,
} from '../web-core/profile-policy-lib.mjs'
import {validateNextProject} from '../web-core/next-project-lib.mjs'
import {stableStringify} from '../web-core/core-lib.mjs'

const emptyPnpmLock = "lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n\nimporters:\n\n  .: {}\n"

export const validateReleaseFixtures = ({claudeDirectory, repositoryRoot, pass, fail}) => {
  if (!requiresProtectedPrebuiltDeployment({
    selection: {
      provider: {id: 'vercel'},
      target: {id: 'static-cdn'},
      selectedCapabilities: ['external-ingestion'],
    },
  })) fail('Vercel static external-ingestion was not bound to the protected prebuilt deployment hard stop')
  if (requiresProtectedPrebuiltDeployment({
    selection: {
      provider: {id: 'vercel'},
      target: {id: 'node-server'},
      selectedCapabilities: ['external-ingestion'],
    },
  })) fail('Vercel node-server was incorrectly classified as the static prebuilt deployment hard stop')
  const releaseGateHookPath = join(claudeDirectory, 'scripts', 'enforce-release-gate.mjs')
  const releaseFixtureRoot = mkdtempSync(join(tmpdir(), 'web-harness-release-gate-'))
  const releaseQaDirectory = join(releaseFixtureRoot, '_workspace/04_qa')
  const releaseEvidenceDirectory = join(releaseQaDirectory, 'evidence')
  const releaseDirectory = join(releaseFixtureRoot, '_workspace/RELEASE')
  mkdirSync(releaseQaDirectory, {recursive: true})
  mkdirSync(releaseEvidenceDirectory, {recursive: true})
  mkdirSync(releaseDirectory, {recursive: true})
  mkdirSync(join(releaseFixtureRoot, 'src'), {recursive: true})
  mkdirSync(join(releaseFixtureRoot, 'e2e'), {recursive: true})
  const conditionalDesignDirectory = join(releaseFixtureRoot, '_workspace/02_design')
  mkdirSync(conditionalDesignDirectory, {recursive: true})
  const reportNames = () => new Set(
    releaseReportRequirements(releaseFixtureRoot, null, 'final', false).map(([, fileName]) => fileName),
  )
  const conditionalReports = [
    ['performance-budget.md', 'qa-perf.md'],
    ['seo-spec.md', 'qa-seo.md'],
    ['timeseries-architecture.md', 'qa-timeseries.md'],
  ]
  if (conditionalReports.some(([, report]) => reportNames().has(report))) {
    fail('conditional release reports were required without their design activation artifacts')
  }
  for (const [marker] of conditionalReports) {
    writeFileSync(join(conditionalDesignDirectory, marker), `# ${marker}\n`)
  }
  const activatedReportNames = reportNames()
  for (const [, report] of conditionalReports) {
    if (!activatedReportNames.has(report)) fail(`conditional release report was not activated: ${report}`)
  }
  for (const [marker] of conditionalReports) rmSync(join(conditionalDesignDirectory, marker), {force: true})
  const releasePackageSource = `${JSON.stringify({
    name: 'fixture',
    scripts: {
      build: 'node scripts/build.mjs',
      lint: 'node scripts/lint.mjs',
      test: 'node --test',
      'test:coverage': 'node --test',
      'test:e2e': 'node scripts/browser.mjs',
      typecheck: 'node scripts/typecheck.mjs',
    },
  })}\n`
  writeFileSync(join(releaseFixtureRoot, 'package.json'), releasePackageSource)
  writeFileSync(join(releaseFixtureRoot, 'pnpm-lock.yaml'), emptyPnpmLock)
  writeFileSync(join(releaseFixtureRoot, 'src/example.test.ts'), 'export {}\n')
  writeFileSync(join(releaseFixtureRoot, 'e2e/example.spec.ts'), 'export {}\n')
  const {privateKey: attestationPrivateKey, publicKey: attestationPublicKey} = generateKeyPairSync('ed25519')
  const attestationKeyId = 'fixture-isolated-ci'
  mkdirSync(join(releaseFixtureRoot, '.claude'), {recursive: true})
  writeFileSync(
    join(releaseFixtureRoot, '.claude/quality-attesters.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      keys: [{
        id: attestationKeyId,
        algorithm: 'ed25519',
        publicKeyPem: attestationPublicKey.export({format: 'pem', type: 'spki'}),
      }],
    }, null, 2)}\n`,
  )
  process.env.WEB_HARNESS_EXPECTED_TRUST_CONFIG_SHA256 = sha256(
    readFileSync(join(releaseFixtureRoot, '.claude/quality-attesters.json')),
  )
  process.env.WEB_HARNESS_REPOSITORY_ID = 'example.test/web-harness/release-fixture'
  process.env.WEB_HARNESS_REVISION = 'a'.repeat(40)
  process.env.WEB_HARNESS_WORKFLOW_REF = 'example.test/web-harness/.ci/release.yml@refs/heads/main'
  process.env.WEB_HARNESS_CI_ISSUER = 'https://ci.example.test/oidc'
  process.env.WEB_HARNESS_CI_RUN_ID = 'fixture/release'

  const profileScopeRoot = mkdtempSync(join(tmpdir(), 'web-harness-profile-scope-'))
  const writePackage = (directory, value) => {
    mkdirSync(directory, {recursive: true})
    writeFileSync(join(directory, 'package.json'), `${JSON.stringify(value)}\n`)
  }
  const optionalNextRoot = join(profileScopeRoot, 'optional-next')
  writePackage(optionalNextRoot, {optionalDependencies: {next: '16.0.0', react: '19.1.0'}})
  mkdirSync(join(optionalNextRoot, 'app'), {recursive: true})
  writeFileSync(join(optionalNextRoot, 'app/layout.tsx'), 'export default function Layout({children}) { return children }\n')
  const optionalNextErrors = []
  resolveReleaseProfile(optionalNextRoot, optionalNextErrors)
  if (!optionalNextErrors.some(error => error.includes('missing _workspace/01_plan/project-profile.json'))) {
    fail('release profile discovery ignored a Next app declared through optionalDependencies')
  }

  const workspaceRoot = join(profileScopeRoot, 'workspace-child')
  writePackage(workspaceRoot, {private: true, workspaces: ['apps/*']})
  const workspaceApp = join(workspaceRoot, 'apps/web')
  writePackage(workspaceApp, {dependencies: {react: '19.1.0'}, devDependencies: {vite: '7.0.4'}})
  mkdirSync(join(workspaceApp, 'src'), {recursive: true})
  writeFileSync(join(workspaceApp, 'src/main.tsx'), 'export {}\n')
  const workspaceErrors = []
  resolveReleaseProfile(workspaceRoot, workspaceErrors)
  if (!workspaceErrors.some(error => error.includes('generic root release'))) {
    fail('generic release did not block a supported workspace child app')
  }

  const mixedRoot = join(profileScopeRoot, 'mixed-root')
  writePackage(mixedRoot, {dependencies: {next: '16.0.0', react: '19.1.0'}, devDependencies: {vite: '7.0.4'}})
  mkdirSync(join(mixedRoot, 'app'), {recursive: true})
  writeFileSync(join(mixedRoot, 'app/layout.tsx'), 'export default function Layout({children}) { return children }\n')
  writeFileSync(join(mixedRoot, 'vite.config.ts'), 'export default {}\n')
  const mixedErrors = []
  resolveReleaseProfile(mixedRoot, mixedErrors)
  if (!mixedErrors.some(error => error.includes('mixed or incomplete'))) {
    fail('release profile discovery accepted a mixed Next and React/Vite root')
  }

  const multipleRoot = join(profileScopeRoot, 'multiple-apps')
  writePackage(multipleRoot, {private: true, workspaces: ['apps/*']})
  const multipleNext = join(multipleRoot, 'apps/next')
  writePackage(multipleNext, {dependencies: {next: '16.0.0', react: '19.1.0'}})
  mkdirSync(join(multipleNext, 'app'), {recursive: true})
  writeFileSync(join(multipleNext, 'app/layout.tsx'), 'export default function Layout({children}) { return children }\n')
  const multipleVite = join(multipleRoot, 'apps/vite')
  writePackage(multipleVite, {dependencies: {react: '19.1.0'}, devDependencies: {vite: '7.0.4'}})
  mkdirSync(join(multipleVite, 'src'), {recursive: true})
  writeFileSync(join(multipleVite, 'src/main.tsx'), 'export {}\n')
  const multipleErrors = []
  resolveReleaseProfile(multipleRoot, multipleErrors)
  if (!multipleErrors.some(error => error.includes('multiple supported web apps'))) {
    fail('release profile discovery accepted multiple workspace web apps')
  }
  rmSync(profileScopeRoot, {recursive: true, force: true})

  const fingerprintWithoutSecrets = computeSourceFingerprint(releaseFixtureRoot)
  writeFileSync(join(releaseFixtureRoot, '.env'), 'DATABASE_PASSWORD=do-not-read\n')
  writeFileSync(join(releaseFixtureRoot, '.npmrc'), '//registry.npmjs.org/:_authToken=do-not-read\n')
  if (computeSourceFingerprint(releaseFixtureRoot) !== fingerprintWithoutSecrets) {
    fail('source fingerprint reads or binds secret-bearing local files')
  }
  rmSync(join(releaseFixtureRoot, '.env'), {force: true})
  rmSync(join(releaseFixtureRoot, '.npmrc'), {force: true})
  
  const qaFixtures = {
    'qa-code.md': `# Code QA\n\n## Result\nPASS\n\n## Commands\n| Check | Command | Exit Code | Status |\n|---|---|---:|---|\n| typecheck | \`pnpm typecheck\` | 0 | PASS |\n| lint | \`pnpm lint\` | 0 | PASS |\n`,
    'qa-ux.md': '# UX QA\n\n## Result\nPASS\n',
    'qa-integration.md': `# Integration QA\n\n## Result\nPASS\n\n## Commands\n| Check | Command | Exit Code | Status |\n|---|---|---:|---|\n| build | \`pnpm build\` | 0 | PASS |\n`,
    'qa-security.md': `# Security QA\n\n## Result\nPASS\n\n## Commands\n| Check | Command | Exit Code | Status |\n|---|---|---:|---|\n| audit | \`pnpm audit --prod\` | 0 | PASS |\n`,
    'qa-api-contract.md': '# API QA\n\n## Result\nPASS\n',
    'qa-test.md': `# Test QA\n\n## Result\nWARN\n\n## Commands\n| Check | Command | Exit Code | Status |\n|---|---|---:|---|\n| test | \`pnpm test\` | 0 | PASS |\n| coverage | \`pnpm test:coverage\` | 0 | WARN |\n`,
    'qa-browser.md': `# Browser QA\n\n## Result\nPASS\n\n## Commands\n| Check | Command | Exit Code | Status |\n|---|---|---:|---|\n| browser | \`pnpm test:e2e\` | 0 | PASS |\n`,
  }
  
  for (const [fileName, source] of Object.entries(qaFixtures)) {
    writeFileSync(join(releaseQaDirectory, fileName), source)
  }
  
  const releaseReceiptCommands = {
    typecheck: 'pnpm typecheck',
    lint: 'pnpm lint',
    build: 'pnpm build',
    test: 'pnpm test',
    coverage: 'pnpm test:coverage',
    browser: 'pnpm test:e2e',
    audit: 'pnpm audit --prod',
  }
  const releaseReceiptScripts = {
    typecheck: 'typecheck',
    lint: 'lint',
    build: 'build',
    test: 'test',
    coverage: 'test:coverage',
    browser: 'test:e2e',
    audit: null,
    [INGESTION_RECEIPT_ID]: 'validate:ingestion',
  }
  const ingestionSchemaPath = 'schemas/ingestion-envelope.schema.json'
  const ingestionSchemaFixture = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: ['data', 'count', 'generatedAt', 'coverage'],
    properties: {
      data: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'title'],
          properties: {
            id: {type: 'string', minLength: 1},
            title: {type: 'string', minLength: 1},
          },
        },
      },
      count: {type: 'integer', minimum: 0},
      generatedAt: {type: 'string', format: 'date-time'},
      coverage: {type: 'number', minimum: 0, maximum: 1},
    },
  }
  const writeIngestionSchemaFixture = projectRoot => {
    mkdirSync(join(projectRoot, 'schemas'), {recursive: true})
    writeFileSync(join(projectRoot, ingestionSchemaPath), `${JSON.stringify(ingestionSchemaFixture)}\n`)
  }
  const runtimeDataContractFixture = ({
    artifactPath = 'public/data.json',
    schema = ingestionSchemaPath,
    baselinePath = 'public/last-known-good.json',
  } = {}) => ({
    $schema: '.claude/schemas/runtime-data-contract.schema.json',
    schemaVersion: 1,
    mode: 'static-snapshot',
    authoritativeSource: 'fixture-source',
    buildCwd: '.',
    deploymentRoot: '.',
    generatedArtifacts: [{
      path: artifactPath,
      required: true,
      schema,
      minCount: 1,
      validation: {
        recordsPointer: '/data',
        countPointer: '/count',
        freshnessPointer: '/generatedAt',
        coverage: {
          requiredFields: ['/id', '/title'],
          minimumFieldRatio: 1,
          metricPointer: '/coverage',
          minimumMetric: 1,
        },
        duplicates: {keyPointers: ['/id'], maximumRatio: 0},
        diff: {baselinePath, maximumCountDropRatio: 0.25},
      },
    }],
    freshnessSlo: 'PT24H',
    promotionPolicy: 'reject-invalid',
    servingFallback: 'last-known-good',
    refreshCapabilities: ['manual-recovery', 'scheduled'],
  })
  const ingestionEnvelope = ({
    records = [
      {id: 'fixture-1', title: 'Fixture One'},
      {id: 'fixture-2', title: 'Fixture Two'},
    ],
    count = records.length,
    generatedAt = new Date().toISOString(),
    coverage = 1,
  } = {}) => ({data: records, count, generatedAt, coverage})
  const writeFixtureAttestation = (
    receiptIds,
    sourceFingerprint = computeSourceFingerprint(releaseFixtureRoot),
    {privateKey = attestationPrivateKey, keyId = attestationKeyId} = {},
  ) => {
    const receiptRecords = [...new Set(receiptIds)].sort().map(id => {
      const path = join(releaseEvidenceDirectory, `${id}.json`)
      const source = readFileSync(path, 'utf8')
      return {id, receipt: JSON.parse(source), sha256: sha256(source)}
    })
    const cohortIds = new Set(receiptRecords.map(record => record.receipt.qualityCohortId))
    if (cohortIds.size !== 1) {
      fail('fixture attestation requires exactly one receipt cohort')
      return
    }
    const subject = buildQualityAttestationSubject({
      qualityCohortId: [...cohortIds][0],
      sourceFingerprint,
      receipts: receiptRecords,
      trustConfigSha256: sha256(readFileSync(join(releaseFixtureRoot, '.claude/quality-attesters.json'))),
      issuedAt: new Date().toISOString(),
      provenance: readProtectedQualityContext().provenance,
    })
    const signature = sign(null, Buffer.from(stableStringify(subject)), privateKey).toString('base64')
    writeFileSync(
      join(releaseEvidenceDirectory, 'quality-attestation.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        keyId,
        algorithm: 'ed25519',
        subject,
        signature,
      }, null, 2)}\n`,
    )
  }
  const refreshReleaseReceipts = () => {
    const sourceFingerprint = computeSourceFingerprint(releaseFixtureRoot)
    const qualityCohortId = randomUUID()
    const completedAt = new Date().toISOString()
    const packageMetadata = JSON.parse(readFileSync(join(releaseFixtureRoot, 'package.json'), 'utf8'))
    const dependencyBinding = readDependencyBinding(releaseFixtureRoot, packageMetadata)
    const pnpmExecutable = join(dirname(process.execPath), process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
    const ingestionContractsComplete = [
      '_workspace/02_design/ingestion-contract.md',
      '_workspace/02_design/runtime-data-contract.json',
    ].every(path => existsSync(join(releaseFixtureRoot, path)))
    const activeReceiptCommands = {
      ...releaseReceiptCommands,
      ...(ingestionContractsComplete ? {[INGESTION_RECEIPT_ID]: 'pnpm validate:ingestion'} : {}),
    }
    for (const [id, command] of Object.entries(activeReceiptCommands)) {
      const discoveredTestFiles = id === 'browser'
        ? ['e2e/example.spec.ts']
        : ['test', 'coverage'].includes(id)
          ? ['src/example.test.ts']
          : []
      const packageScriptName = releaseReceiptScripts[id]
      const packageScriptSource = packageScriptName ? packageMetadata.scripts?.[packageScriptName] : null
      const packageScriptAnalysis = packageScriptSource ? analyzePackageScript(packageScriptSource) : null
      const executionTargetBinding = readExecutionTargetBinding({
        projectRoot: releaseFixtureRoot,
        analysis: packageScriptAnalysis,
        pnpmExecutable,
        searchPath: process.env.PATH,
      })
      const ingestionValidation = id === INGESTION_RECEIPT_ID
        ? validateRuntimeDataArtifacts(releaseFixtureRoot)
        : null
      const receipt = {
        schemaVersion: 2,
        runner: 'web-harness-quality-gate',
        id,
        command,
        executionMode: id === 'audit' ? 'pinned-control-plane-argv' : 'verified-package-argv',
        cwd: '.',
        startedAt: '2026-01-01T00:00:00.000Z',
        durationMs: 1,
        completedAt,
        qualityCohortId,
        runMode: 'all',
        nodeVersion: '22.22.0',
        nodeEngine: null,
        engineSatisfied: null,
        pnpmVersion: '11.0.0',
        gitCommit: null,
        sourceFingerprint,
        sourceFingerprintBefore: sourceFingerprint,
        sourceFingerprintAfter: sourceFingerprint,
        sourceMutationDetected: false,
        exitCode: 0,
        signal: null,
        status: ingestionValidation && !ingestionValidation.ok ? 'FAIL' : 'PASS',
        blockedReason: ingestionValidation && !ingestionValidation.ok
          ? `Runtime data artifact validation failed: ${ingestionValidation.errors.join('; ')}`
          : null,
        discoveredTestFiles,
        stdoutSha256: '0'.repeat(64),
        stderrSha256: '0'.repeat(64),
        stdoutTail: '',
        stderrTail: '',
        outputTailPolicy: 'omitted-to-prevent-secret-persistence',
        packageScript: packageScriptName ? {
          name: packageScriptName,
          sha256: sha256(packageScriptSource),
          commandContractSha256: sha256(JSON.stringify(packageScriptAnalysis.commands)),
        } : null,
        dependencyBinding,
        dependencyBindingBefore: dependencyBinding,
        dependencyBindingAfter: dependencyBinding,
        dependencyMutationDetected: false,
        executionTargetBindingBefore: executionTargetBinding,
        executionTargetBindingAfter: executionTargetBinding,
        executionTargetMutationDetected: false,
        environmentPolicy: {
          inheritedKeys: [],
          isolatedHome: true,
          secretVariablesInherited: false,
          declaredPublicVariables: [],
          publicEnvironmentSha256: sha256('{}'),
          executionContext: 'isolated-ci-declared',
          isolationVerifiedByRunner: false,
          hostFilesystemIsolated: null,
          networkIsolated: null,
        },
        // 환경 결속은 어댑터와 무관하게 항상 검증된다(2026-08-26 조건부 스킵 해소).
        // 프로필이 없어도 receipt는 이 둘을 가져야 한다.
        profileBinding: {buildEnvironmentSha256: null, publicEnvironmentSha256: sha256('{}')},
        ...(ingestionValidation ? {ingestionValidation: ingestionReceiptEvidence(ingestionValidation)} : {}),
      }
      writeFileSync(join(releaseEvidenceDirectory, `${id}.json`), `${JSON.stringify(receipt, null, 2)}\n`)
    }
    writeFixtureAttestation(Object.keys(activeReceiptCommands))
  }
  const writeReleaseFixtureManifest = () => {
    const {manifest} = buildReleaseManifest(releaseFixtureRoot)
    writeFileSync(join(releaseQaDirectory, 'qa-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    return manifest
  }
  
  if (!buildReleaseManifest(releaseFixtureRoot).errors.some(error => error.includes('machine receipt'))) {
    fail('release gate trusted Markdown command evidence without machine receipts')
  }
  refreshReleaseReceipts()
  const releaseFixtureManifest = writeReleaseFixtureManifest()
  if (releaseFixtureManifest.schemaVersion !== 3) fail('release manifest is not schemaVersion 3')
  if (validateReleaseGate(releaseFixtureRoot).errors.length > 0) fail('release gate blocked a complete passing fixture')
  process.env.WEB_HARNESS_CI_RUN_ID = 'fixture/prepare-request'
  const attestationRequest = spawnSync(
    process.execPath,
    [
      join(claudeDirectory, 'scripts/prepare-quality-attestation.mjs'),
      '--project',
      releaseFixtureRoot,
      '--issuer-run-id',
      'fixture/prepare-request',
    ],
    {cwd: repositoryRoot, encoding: 'utf8'},
  )
  if (attestationRequest.status !== 0) {
    fail(`trusted attestation request preparation failed: ${attestationRequest.stderr}`)
  } else {
    const request = JSON.parse(attestationRequest.stdout)
    if (
      request.requestType !== 'web-harness-quality-attestation' ||
      request.evidence?.sourceFingerprint !== releaseFixtureManifest.sourceFingerprint ||
      request.evidence?.trustConfigSha256 !== sha256(readFileSync(join(releaseFixtureRoot, '.claude/quality-attesters.json'))) ||
      request.expectedProvenance?.issuerRunId !== 'fixture/prepare-request'
    ) fail('trusted attestation request is not bound to source and trust configuration')
  }
  const trustPath = join(releaseFixtureRoot, '.claude/quality-attesters.json')
  const attestationPath = join(releaseEvidenceDirectory, 'quality-attestation.json')
  const trustSource = readFileSync(trustPath, 'utf8')
  writeFileSync(trustPath, 'null\n')
  let malformedTrustErrors = []
  try {
    malformedTrustErrors = buildReleaseManifest(releaseFixtureRoot).errors
  } catch (error) {
    fail(`malformed attester trust config crashed the release gate: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!malformedTrustErrors.some(error => error.includes('schemaVersion 1 and keys[]'))) {
    fail('malformed attester trust config did not fail closed')
  }
  writeFileSync(trustPath, trustSource)
  const privateKeyTrustSource = `${JSON.stringify({
    schemaVersion: 1,
    keys: [{
      id: attestationKeyId,
      algorithm: 'ed25519',
      publicKeyPem: attestationPrivateKey.export({format: 'pem', type: 'pkcs8'}),
    }],
  }, null, 2)}\n`
  writeFileSync(trustPath, privateKeyTrustSource)
  process.env.WEB_HARNESS_EXPECTED_TRUST_CONFIG_SHA256 = sha256(privateKeyTrustSource)
  if (!buildReleaseManifest(releaseFixtureRoot).errors.some(error => error.includes('canonical SPKI PEM'))) {
    fail('trusted attester configuration accepted a private-key PEM as a public key')
  }
  writeFileSync(trustPath, trustSource)
  process.env.WEB_HARNESS_EXPECTED_TRUST_CONFIG_SHA256 = sha256(trustSource)
  const {privateKey: attackerPrivateKey, publicKey: attackerPublicKey} = generateKeyPairSync('ed25519')
  const attackerKeyId = 'attacker-controlled-key'
  writeFileSync(
    trustPath,
    `${JSON.stringify({
      schemaVersion: 1,
      keys: [{
        id: attackerKeyId,
        algorithm: 'ed25519',
        publicKeyPem: attackerPublicKey.export({format: 'pem', type: 'spki'}),
      }],
    }, null, 2)}\n`,
  )
  writeFixtureAttestation(Object.keys(releaseReceiptCommands), undefined, {
    privateKey: attackerPrivateKey,
    keyId: attackerKeyId,
  })
  if (!buildReleaseManifest(releaseFixtureRoot).errors.some(error => error.includes('protected external digest'))) {
    fail('release gate accepted an attacker-controlled trust root and valid replacement signature')
  }
  writeFileSync(trustPath, trustSource)
  writeFixtureAttestation(Object.keys(releaseReceiptCommands))
  for (const field of ['repositoryId', 'revision', 'workflowRef']) {
    const replayedAttestation = JSON.parse(readFileSync(join(releaseEvidenceDirectory, 'quality-attestation.json'), 'utf8'))
    replayedAttestation.subject.provenance[field] = `${replayedAttestation.subject.provenance[field]}-replayed`
    replayedAttestation.signature = sign(
      null,
      Buffer.from(stableStringify(replayedAttestation.subject)),
      attestationPrivateKey,
    ).toString('base64')
    writeFileSync(attestationPath, `${JSON.stringify(replayedAttestation, null, 2)}\n`)
    if (!buildReleaseManifest(releaseFixtureRoot).errors.some(error => error.includes('protected CI identity'))) {
      fail(`release gate accepted signed ${field} replay against protected CI context`)
    }
    writeFixtureAttestation(Object.keys(releaseReceiptCommands))
  }
  const forgedAttestation = JSON.parse(readFileSync(attestationPath, 'utf8'))
  forgedAttestation.signature = `${forgedAttestation.signature[0] === 'A' ? 'B' : 'A'}${forgedAttestation.signature.slice(1)}`
  writeFileSync(attestationPath, `${JSON.stringify(forgedAttestation, null, 2)}\n`)
  if (!buildReleaseManifest(releaseFixtureRoot).errors.some(error => error.includes('signature verification failed'))) {
    fail('release gate accepted a forged quality attestation signature')
  }
  writeFixtureAttestation(Object.keys(releaseReceiptCommands))
  const signedAuditPath = join(releaseEvidenceDirectory, 'audit.json')
  const signedAuditReceipt = JSON.parse(readFileSync(signedAuditPath, 'utf8'))
  signedAuditReceipt.stdoutTail = 'modified-after-attestation'
  writeFileSync(signedAuditPath, `${JSON.stringify(signedAuditReceipt, null, 2)}\n`)
  if (!buildReleaseManifest(releaseFixtureRoot).errors.some(error => error.includes('signed receipt digests'))) {
    fail('release gate accepted a receipt modified after external attestation')
  }
  refreshReleaseReceipts()
  const staleAuditPath = join(releaseEvidenceDirectory, 'audit.json')
  const staleAuditReceipt = JSON.parse(readFileSync(staleAuditPath, 'utf8'))
  staleAuditReceipt.completedAt = '2000-01-01T00:00:00.000Z'
  writeFileSync(staleAuditPath, `${JSON.stringify(staleAuditReceipt, null, 2)}\n`)
  if (!buildReleaseManifest(releaseFixtureRoot).errors.some(error => error.includes('older than 24 hours'))) {
    fail('release gate accepted an expired quality receipt')
  }
  refreshReleaseReceipts()
  writeReleaseFixtureManifest()

  const releasePlanDirectory = join(releaseFixtureRoot, '_workspace/01_plan')
  mkdirSync(releasePlanDirectory, {recursive: true})
  writeFileSync(
    join(releaseFixtureRoot, 'package.json'),
    `${JSON.stringify({
      name: 'next-release-fixture',
      engines: {node: '>=22.22.0'},
      packageManager: 'pnpm@11.18.0',
      dependencies: {next: '16.0.0', react: '19.1.0'},
      devDependencies: {
        eslint: '9.0.0',
        playwright: '1.0.0',
        typescript: '5.0.0',
        vitest: '3.0.0',
      },
      scripts: {
        lint: 'eslint .',
        typecheck: 'tsc --noEmit',
        test: 'vitest run',
        'test:coverage': 'vitest run --coverage',
        'test:e2e': 'playwright test',
        build: 'next build',
        'test:routes': 'vitest run tests/routes.test.ts',
        'test:client-boundary': 'vitest run tests/client-boundary.test.ts',
        'test:secret-boundary': 'vitest run tests/secret-boundary.test.ts',
        'test:production-start': 'node scripts/production-start.mjs',
        'test:e2e:node': 'playwright test',
        'test:hydration:node': 'playwright test tests/hydration.spec.ts',
        'test:node-smoke': 'vitest run tests/node-smoke.test.ts',
        'test:shutdown:node': 'node scripts/shutdown-node.mjs',
      },
    })}\n`,
  )
  mkdirSync(join(releaseFixtureRoot, 'app'), {recursive: true})
  writeFileSync(join(releaseFixtureRoot, 'app/layout.tsx'), 'export default function Layout({children}) { return children }\n')
  mkdirSync(join(releaseFixtureRoot, 'node_modules/.pnpm'), {recursive: true})
  writeFileSync(join(releaseFixtureRoot, 'node_modules/.pnpm/lock.yaml'), emptyPnpmLock)
  mkdirSync(join(releaseFixtureRoot, 'node_modules/.bin'), {recursive: true})
  const installedPackages = [
    {name: 'eslint', version: '9.0.0', bins: {eslint: 'bin/eslint.js'}},
    {name: 'next', version: '16.0.0', bins: {next: 'dist/bin/next'}},
    {name: 'playwright', version: '1.0.0', bins: {playwright: 'cli.js'}},
    {name: 'react', version: '19.1.0', bins: {}},
    {name: 'typescript', version: '5.0.0', bins: {tsc: 'bin/tsc'}},
    {name: 'vitest', version: '3.0.0', bins: {vitest: 'vitest.mjs'}},
  ]
  for (const installedPackage of installedPackages) {
    const storeRelativePath = `.pnpm/${installedPackage.name}@${installedPackage.version}/node_modules/${installedPackage.name}`
    const packageRoot = join(releaseFixtureRoot, 'node_modules', storeRelativePath)
    mkdirSync(packageRoot, {recursive: true})
    writeFileSync(
      join(packageRoot, 'package.json'),
      `${JSON.stringify({name: installedPackage.name, version: installedPackage.version, bin: installedPackage.bins})}\n`,
    )
    symlinkSync(storeRelativePath, join(releaseFixtureRoot, 'node_modules', installedPackage.name))
    for (const [executable, relativeBinary] of Object.entries(installedPackage.bins)) {
      const binaryPath = join(packageRoot, relativeBinary)
      mkdirSync(dirname(binaryPath), {recursive: true})
      writeFileSync(binaryPath, '#!/usr/bin/env node\nprocess.exit(0)\n')
      chmodSync(binaryPath, 0o755)
      symlinkSync(
        `../${installedPackage.name}/${relativeBinary}`,
        join(releaseFixtureRoot, 'node_modules/.bin', executable),
      )
    }
  }
  const nextReleaseProfile = resolveProjectProfile({projectRoot: releaseFixtureRoot, requested: 'next-app-fullstack'})
  writeFileSync(
    join(releasePlanDirectory, 'project-profile.json'),
    `${JSON.stringify(nextReleaseProfile, null, 2)}\n`,
  )
  mkdirSync(join(releaseFixtureRoot, '_workspace/03_dev'), {recursive: true})
  const nextPlanRun = spawnSync(
    process.execPath,
    [join(claudeDirectory, 'scripts/web-core/compile-execution-plan.mjs'), '--profile-file', '_workspace/01_plan/project-profile.json'],
    {cwd: releaseFixtureRoot, encoding: 'utf8'},
  )
  if (nextPlanRun.status !== 0) fail(`Next release fixture execution plan did not compile: ${nextPlanRun.stderr}`)
  else writeFileSync(join(releaseFixtureRoot, '_workspace/03_dev/web-execution-plan.json'), nextPlanRun.stdout)
  const lockedNextProfile = readLockedProjectProfile(join(releasePlanDirectory, 'project-profile.json'))
  const overstatedNextProfile = JSON.parse(JSON.stringify(nextReleaseProfile))
  overstatedNextProfile.adapter.supportLevel = 'certified'
  writeFileSync(join(releasePlanDirectory, 'overstated-profile.json'), `${JSON.stringify(overstatedNextProfile)}\n`)
  try {
    readLockedProjectProfile(join(releasePlanDirectory, 'overstated-profile.json'))
    fail('locked profile allowed compatible Next support to be overstated as certified')
  } catch (error) {
    if (error?.code !== 'PROJECT_PROFILE_ADAPTER_STALE') fail(`overstated Next support failed with an unexpected reason: ${error?.code}`)
  }
  rmSync(join(releasePlanDirectory, 'overstated-profile.json'))

  try {
    resolveProjectProfile({
      projectRoot: releaseFixtureRoot,
      requested: 'next-app-fullstack',
      deploymentTarget: 'docker-standalone',
    })
    fail('Next Docker profile was enabled without a typed OCI evidence broker')
  } catch (error) {
    if (error?.code !== 'NEXT_DOCKER_OCI_EVIDENCE_BROKER_REQUIRED') {
      fail(`Next Docker profile failed with an unexpected reason: ${error?.code}`)
    }
  }
  mkdirSync(join(releaseFixtureRoot, '.next'), {recursive: true})
  writeFileSync(join(releaseFixtureRoot, '.next/server.js'), 'export {}\n')
  refreshReleaseReceipts()
  const genericOnlyNextErrors = buildReleaseManifest(releaseFixtureRoot).errors
  if (!genericOnlyNextErrors.some(error => error.includes('next.route-contract.json'))) {
    fail('release gate accepted a Next profile with generic receipts only')
  }
  const nextDesignDirectory = join(releaseFixtureRoot, '_workspace/02_design')
  mkdirSync(nextDesignDirectory, {recursive: true})
  writeFileSync(
    join(nextDesignDirectory, 'next-contract-matrices.md'),
    '# Next Contracts\n\n## Route Matrix\n\n## Server Client Boundary Matrix\n\n## Authorization Matrix\n\n## Environment Matrix\n\n## Cache Matrix\n\n## Deployment Matrix\n',
  )
  const nextBuildEnvironmentSource = `${JSON.stringify({schemaVersion: 1, public: []})}\n`
  writeFileSync(join(nextDesignDirectory, 'build-environment.json'), nextBuildEnvironmentSource)
  const nextQaFixtures = {
    ...qaFixtures,
    'qa-code.md': qaFixtures['qa-code.md']
      .replace('pnpm typecheck', 'pnpm run typecheck')
      .replace('pnpm lint', 'pnpm run lint'),
    'qa-integration.md': qaFixtures['qa-integration.md'].replace('pnpm build', 'pnpm run build'),
    'qa-test.md': qaFixtures['qa-test.md'].replace('pnpm test`', 'pnpm run test`'),
    'qa-browser.md': qaFixtures['qa-browser.md'].replace('pnpm test:e2e', 'pnpm run test:e2e:node'),
  }
  for (const [fileName, source] of Object.entries(nextQaFixtures)) {
    writeFileSync(join(releaseQaDirectory, fileName), source)
  }
  refreshReleaseReceipts()
  const lockedNextPlan = readLockedExecutionPlan(
    join(releaseFixtureRoot, '_workspace/03_dev/web-execution-plan.json'),
    lockedNextProfile,
  )
  const nextBindings = adapterCheckBindings({
    adapter: lockedNextProfile.adapter,
    deploymentProvider: lockedNextProfile.selection.provider.id,
    deploymentTarget: lockedNextProfile.selection.target.id,
    capabilities: lockedNextProfile.selection.selectedCapabilities,
  })
  const nextInventory = collectDeploymentArtifacts(releaseFixtureRoot, lockedNextProfile.selection.artifacts, {requireAll: true})
  const nextFingerprint = computeSourceFingerprint(releaseFixtureRoot, {
    excludePaths: lockedNextProfile.selection.artifacts.map(artifact => artifact.path),
  })
  const nextProfileBinding = {
    profileId: lockedNextProfile.adapter.id,
    adapterVersion: lockedNextProfile.adapter.version,
    adapterSha256: lockedNextProfile.profile.adapter.sha256,
    deploymentProvider: lockedNextProfile.selection.provider.id,
    deploymentTarget: lockedNextProfile.selection.target.id,
    profileSha256: projectProfileSha256(lockedNextProfile.profile),
    selectedCapabilities: lockedNextProfile.selection.selectedCapabilities,
    releaseTarget: lockedNextProfile.selection.releaseTarget,
    executionPlanSha256: lockedNextPlan.sha256,
    buildEnvironmentSha256: sha256(nextBuildEnvironmentSource),
    publicEnvironmentSha256: sha256('{}'),
  }
  const nextPackageMetadata = JSON.parse(readFileSync(join(releaseFixtureRoot, 'package.json'), 'utf8'))
  const nextPackageScripts = nextPackageMetadata.scripts
  const nextDependencyBinding = readDependencyBinding(releaseFixtureRoot, nextPackageMetadata)
  const nextPnpmExecutable = join(dirname(process.execPath), process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
  const baseNextReceipt = JSON.parse(readFileSync(join(releaseEvidenceDirectory, 'typecheck.json'), 'utf8'))
  const nextCohortId = baseNextReceipt.qualityCohortId
  const nextCompletedAt = baseNextReceipt.completedAt
  for (const id of Object.keys(releaseReceiptCommands)) {
    const receiptPath = join(releaseEvidenceDirectory, `${id}.json`)
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
    receipt.profileBinding = nextProfileBinding
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
  }
  const nextCommands = resolveProfileCommands({projectRoot: releaseFixtureRoot, adapter: lockedNextProfile.adapter})
  for (const binding of nextBindings) {
    const bindsArtifact = ['artifact', 'browser', 'build', 'runtime'].includes(binding.kind)
    const command = nextCommands.get(binding.commandId)
    if (!command) throw new Error(`resolved command is missing: ${binding.commandId}`)
    const scriptName = command.args[1]
    const scriptAnalysis = analyzePackageScript(nextPackageScripts[scriptName])
    const executionTargetBinding = readExecutionTargetBinding({
      projectRoot: releaseFixtureRoot,
      analysis: scriptAnalysis,
      pnpmExecutable: nextPnpmExecutable,
      searchPath: process.env.PATH,
    })
    const receipt = {
        ...baseNextReceipt,
        id: binding.receiptId,
        adapterCheckId: binding.id,
        adapterCommandId: binding.commandId,
        command: [command.executable, ...command.args].join(' '),
        cwd: '.',
        status: 'PASS',
        exitCode: 0,
        sourceFingerprint: nextFingerprint,
        sourceFingerprintBefore: nextFingerprint,
        sourceFingerprintAfter: nextFingerprint,
        sourceMutationDetected: false,
        qualityCohortId: nextCohortId,
        runMode: 'all',
        completedAt: nextCompletedAt,
        stdoutTail: '',
        stderrTail: '',
        outputTailPolicy: 'omitted-to-prevent-secret-persistence',
        packageScript: {
          name: scriptName,
          sha256: sha256(nextPackageScripts[scriptName]),
          commandContractSha256: sha256(JSON.stringify(scriptAnalysis.commands)),
        },
        dependencyBinding: nextDependencyBinding,
        dependencyBindingBefore: nextDependencyBinding,
        dependencyBindingAfter: nextDependencyBinding,
        dependencyMutationDetected: false,
        executionTargetBindingBefore: executionTargetBinding,
        executionTargetBindingAfter: executionTargetBinding,
        executionTargetMutationDetected: false,
        environmentPolicy: {
          ...baseNextReceipt.environmentPolicy,
          publicEnvironmentSha256: sha256('{}'),
          isolatedHome: true,
          secretVariablesInherited: false,
          executionContext: 'isolated-ci-declared',
        },
        profileBinding: nextProfileBinding,
        discoveredTestFiles: binding.kind === 'browser'
          ? ['e2e/example.spec.ts']
          : binding.kind === 'unit'
            ? ['src/example.test.ts']
            : [],
        artifactInventoryBefore: bindsArtifact ? nextInventory.artifacts : [],
        artifactInventoryAfter: bindsArtifact ? nextInventory.artifacts : [],
        cleanBuildArtifacts: binding.kind === 'build'
          ? lockedNextProfile.selection.artifacts.map(artifact => artifact.path)
          : [],
      }
    writeFileSync(
      join(releaseEvidenceDirectory, `${binding.receiptId}.json`),
      `${JSON.stringify(receipt, null, 2)}\n`,
    )
  }
  rmSync(attestationPath, {force: true})
  process.env.WEB_HARNESS_CI_RUN_ID = 'fixture/next-prepare-request'
  const nextAttestationRequest = spawnSync(
    process.execPath,
    [
      join(claudeDirectory, 'scripts/prepare-quality-attestation.mjs'),
      '--project',
      releaseFixtureRoot,
      '--issuer-run-id',
      'fixture/next-prepare-request',
    ],
    {cwd: repositoryRoot, encoding: 'utf8'},
  )
  if (nextAttestationRequest.status !== 0) {
    fail(`Next attestation request could not be prepared before qa-next-contract.md: ${nextAttestationRequest.stderr}`)
  }
  const expectedNextReceiptIds = [...new Set([
    ...Object.keys(releaseReceiptCommands),
    ...nextBindings.map(binding => binding.receiptId),
  ])].sort()
  if (nextAttestationRequest.status === 0) {
    const request = JSON.parse(nextAttestationRequest.stdout)
    const subjectReceiptIds = request.evidence.receiptDigests.map(receipt => receipt.id).sort()
    if (
      request.evidence.sourceFingerprint !== nextFingerprint ||
      JSON.stringify(subjectReceiptIds) !== JSON.stringify(expectedNextReceiptIds)
    ) fail('Next pre-attestation subject is not bound to all current profile receipts')
  }
  writeFixtureAttestation(expectedNextReceiptIds, nextFingerprint)
  const nextProjectResult = validateNextProject(releaseFixtureRoot)
  if (!nextProjectResult.ok || nextProjectResult.status !== 'VERIFIED_FOR_CURRENT_FINGERPRINT') {
    fail('current Next project validator did not accept complete profile-bound evidence')
  }
  writeFileSync(join(releaseQaDirectory, 'qa-next-contract.md'), '# Next Contract QA\n\n## Result\nPASS\n')
  const completeNextRelease = buildReleaseManifest(releaseFixtureRoot)
  if (completeNextRelease.errors.length > 0) {
    fail(`final Next release manifest blocked the documented attestation flow: ${completeNextRelease.errors.join('; ')}`)
  }
  writeFileSync(join(releaseFixtureRoot, '.next/server.js'), 'export const staleArtifact = true\n')
  try {
    validateNextProject(releaseFixtureRoot)
    fail('current Next project validator accepted a changed deployment artifact')
  } catch (error) {
    if (error?.code !== 'NEXT_ARTIFACT_RECEIPT_STALE') fail(`changed Next artifact failed with an unexpected reason: ${error?.code}`)
  }
  writeFileSync(join(releaseFixtureRoot, '.next/server.js'), 'export {}\n')
  writeFileSync(join(releaseFixtureRoot, 'node_modules/.pnpm/lock.yaml'), 'tampered\n')
  try {
    validateNextProject(releaseFixtureRoot)
    fail('current Next project validator accepted a stale installed dependency graph')
  } catch (error) {
    if (error?.code !== 'NEXT_DEPENDENCY_BINDING_STALE') fail(`stale Next dependencies failed with an unexpected reason: ${error?.code}`)
  }
  writeFileSync(join(releaseFixtureRoot, 'node_modules/.pnpm/lock.yaml'), emptyPnpmLock)
  writeFileSync(join(releaseFixtureRoot, 'src/next-stale.ts'), 'export const staleSource = true\n')
  try {
    validateNextProject(releaseFixtureRoot)
    fail('current Next project validator accepted stale source evidence')
  } catch (error) {
    if (error?.code !== 'NEXT_RECEIPT_STALE') fail(`changed Next source failed with an unexpected reason: ${error?.code}`)
  }
  rmSync(join(releaseFixtureRoot, 'src/next-stale.ts'))
  const reactLinkPath = join(releaseFixtureRoot, 'node_modules/react')
  rmSync(reactLinkPath)
  symlinkSync('.pnpm/next@16.0.0/node_modules/next', reactLinkPath)
  try {
    validateNextProject(releaseFixtureRoot)
    fail('current Next project validator accepted a retargeted top-level runtime package')
  } catch (error) {
    if (error?.code !== 'NEXT_DEPENDENCY_BINDING_STALE') {
      fail(`retargeted runtime package failed with an unexpected reason: ${error?.code}`)
    }
  }
  for (const binding of nextBindings) rmSync(join(releaseEvidenceDirectory, `${binding.receiptId}.json`), {force: true})
  rmSync(join(nextDesignDirectory, 'next-contract-matrices.md'))
  rmSync(join(nextDesignDirectory, 'build-environment.json'))
  rmSync(join(releasePlanDirectory, 'project-profile.json'))
  rmSync(join(releaseFixtureRoot, '_workspace/03_dev'), {recursive: true, force: true})
  rmSync(join(releaseFixtureRoot, '.next'), {recursive: true, force: true})
  rmSync(join(releaseQaDirectory, 'qa-next-contract.md'))
  writeFileSync(join(releaseFixtureRoot, 'package.json'), releasePackageSource)
  for (const [fileName, source] of Object.entries(qaFixtures)) {
    writeFileSync(join(releaseQaDirectory, fileName), source)
  }
  refreshReleaseReceipts()
  writeReleaseFixtureManifest()

  const manifestPath = join(releaseQaDirectory, 'qa-manifest.json')
  const manifestVictimRoot = mkdtempSync(join(tmpdir(), 'web-harness-manifest-victim-'))
  const manifestVictimPath = join(manifestVictimRoot, 'outside.json')
  const manifestVictimSource = readFileSync(manifestPath, 'utf8')
  writeFileSync(manifestVictimPath, manifestVictimSource)
  rmSync(manifestPath)
  symlinkSync(manifestVictimPath, manifestPath)
  if (!validateReleaseGate(releaseFixtureRoot).errors.some(error => error.includes('cannot be inspected safely'))) {
    fail('release gate followed a symlinked QA manifest while reading')
  }
  const symlinkedManifestWrite = spawnSync(
    process.execPath,
    [join(claudeDirectory, 'scripts/validate-release-gate.mjs'), '--project', releaseFixtureRoot, '--write-manifest'],
    {cwd: repositoryRoot, encoding: 'utf8'},
  )
  if (symlinkedManifestWrite.status === 0) fail('release gate overwrote a symlinked QA manifest destination')
  if (readFileSync(manifestVictimPath, 'utf8') !== manifestVictimSource) {
    fail('release gate changed a file outside the project through the QA manifest symlink')
  }
  rmSync(manifestPath)
  rmSync(manifestVictimRoot, {recursive: true, force: true})
  writeReleaseFixtureManifest()
  
  const runReleaseGateHook = (filePath = join(releaseDirectory, 'HANDOFF.md')) =>
    spawnSync(process.execPath, [releaseGateHookPath], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      input: JSON.stringify({
        tool_input: {file_path: filePath},
        tool_name: 'Write',
      }),
    })
  
  if (runReleaseGateHook().status !== 0) fail('release hook blocked a passing fixture')
  if (runReleaseGateHook(join(releaseEvidenceDirectory, 'forged.json')).status !== 2) {
    fail('release hook allowed an agent to forge a machine receipt')
  }
  if (runReleaseGateHook(join(releaseQaDirectory, 'qa-manifest.json')).status !== 2) {
    fail('release hook allowed an agent to write qa-manifest.json directly')
  }
  const releaseEvidenceAlias = join(releaseFixtureRoot, 'evidence-alias')
  symlinkSync(releaseEvidenceDirectory, releaseEvidenceAlias, 'dir')
  if (runReleaseGateHook(join(releaseEvidenceAlias, 'forged.json')).status !== 2) {
    fail('release hook allowed machine receipt forgery through a symlink')
  }
  rmSync(releaseEvidenceAlias)
  rmSync(join(releaseEvidenceDirectory, 'typecheck.json'))
  if (runReleaseGateHook().status !== 2) fail('release hook trusted Markdown PASS without a typecheck receipt')
  refreshReleaseReceipts()
  writeReleaseFixtureManifest()
  
  writeFileSync(join(releaseFixtureRoot, 'src/runtime.ts'), 'export const changed = true\n')
  if (runReleaseGateHook().status !== 2) fail('release hook accepted stale receipts after a source change')
  refreshReleaseReceipts()
  writeReleaseFixtureManifest()
  if (runReleaseGateHook().status !== 0) fail('release hook blocked refreshed source evidence')
  
  const releaseDesignDirectory = join(releaseFixtureRoot, '_workspace/02_design')
  mkdirSync(releaseDesignDirectory, {recursive: true})
  writeFileSync(join(releaseDesignDirectory, 'ingestion-contract.md'), '# Ingestion Contract\n')
  writeFileSync(
    join(releaseDesignDirectory, 'runtime-data-contract.json'),
    `${JSON.stringify(runtimeDataContractFixture({artifactPath: '.claude'}))}\n`,
  )
  if (!buildReleaseManifest(releaseFixtureRoot).errors.some(error => error.includes('generatedArtifacts[0].path'))) {
    fail('release gate allowed an exact protected root as a generated artifact')
  }
  writeFileSync(
    join(releaseDesignDirectory, 'runtime-data-contract.json'),
    `${JSON.stringify(runtimeDataContractFixture({artifactPath: 'public/./data.json'}))}\n`,
  )
  if (!buildReleaseManifest(releaseFixtureRoot).errors.some(error => error.includes('unsafe path segment'))) {
    fail('runtime data parser normalized an internal dot segment in a generated artifact path')
  }
  const missingDiffContract = runtimeDataContractFixture()
  delete missingDiffContract.generatedArtifacts[0].validation.diff
  writeFileSync(
    join(releaseDesignDirectory, 'runtime-data-contract.json'),
    `${JSON.stringify(missingDiffContract)}\n`,
  )
  if (!buildReleaseManifest(releaseFixtureRoot).errors.some(error => error.includes('must declare validation.diff'))) {
    fail('runtime data parser accepted a required artifact without diff validation')
  }
  rmSync(join(releaseDesignDirectory, 'runtime-data-contract.json'))
  rmSync(join(releaseDesignDirectory, 'ingestion-contract.md'))
  writeFileSync(join(releaseDesignDirectory, 'state-contract.md'), '# State Contract\n')
  refreshReleaseReceipts()
  if (runReleaseGateHook().status !== 2) fail('release hook allowed local domain state without qa-state.md')
  writeFileSync(join(releaseQaDirectory, 'qa-state.md'), '# State QA\n\n## Result\nPASS\n')
  writeReleaseFixtureManifest()
  if (runReleaseGateHook().status !== 0) fail('release hook blocked passing local domain state QA')
  rmSync(join(releaseDesignDirectory, 'state-contract.md'))
  rmSync(join(releaseQaDirectory, 'qa-state.md'))
  refreshReleaseReceipts()
  writeReleaseFixtureManifest()

  writeFileSync(join(releaseDesignDirectory, 'analytics-architecture.md'), '# Analytics Architecture\n')
  refreshReleaseReceipts()
  if (runReleaseGateHook().status !== 2) fail('release hook allowed analytics without qa-analytics.md')
  writeFileSync(join(releaseQaDirectory, 'qa-analytics.md'), '# Analytics QA\n\n## Result\nPASS\n')
  writeReleaseFixtureManifest()
  if (runReleaseGateHook().status !== 0) fail('release hook blocked passing analytics QA')
  rmSync(join(releaseDesignDirectory, 'analytics-architecture.md'))
  rmSync(join(releaseQaDirectory, 'qa-analytics.md'))
  refreshReleaseReceipts()
  writeReleaseFixtureManifest()
  
  const releaseIngestionContractPath = join(releaseDesignDirectory, 'runtime-data-contract.json')
  const releaseIngestionArtifactPath = join(releaseFixtureRoot, 'public/data.json')
  const releaseIngestionBaselinePath = join(releaseFixtureRoot, 'public/last-known-good.json')
  const releaseIngestionPackage = JSON.parse(releasePackageSource)
  releaseIngestionPackage.scripts['validate:ingestion'] = 'node scripts/validate-ingestion.mjs'
  writeFileSync(join(releaseFixtureRoot, 'package.json'), `${JSON.stringify(releaseIngestionPackage)}\n`)
  mkdirSync(join(releaseFixtureRoot, 'scripts'), {recursive: true})
  writeFileSync(join(releaseFixtureRoot, 'scripts/validate-ingestion.mjs'), 'process.exit(0)\n')
  writeIngestionSchemaFixture(releaseFixtureRoot)
  mkdirSync(join(releaseFixtureRoot, 'public'), {recursive: true})
  writeFileSync(releaseIngestionBaselinePath, `${JSON.stringify(ingestionEnvelope())}\n`)
  writeFileSync(join(releaseDesignDirectory, 'ingestion-contract.md'), '# Ingestion Contract\n')
  writeFileSync(releaseIngestionContractPath, `${JSON.stringify(runtimeDataContractFixture())}\n`)
  refreshReleaseReceipts()
  if (runReleaseGateHook().status !== 2) fail('release hook allowed external ingestion without qa-data-quality.md')
  writeFileSync(join(releaseQaDirectory, 'qa-data-quality.md'), '# Data Quality QA\n\n## Result\nPASS\n')
  writeReleaseFixtureManifest()
  if (runReleaseGateHook().status !== 2) fail('release hook allowed a missing required generated artifact')
  const validIngestionArtifact = `${JSON.stringify(ingestionEnvelope())}\n`
  writeFileSync(releaseIngestionArtifactPath, validIngestionArtifact)
  refreshReleaseReceipts()
  const passingIngestionManifest = writeReleaseFixtureManifest()
  if (runReleaseGateHook().status !== 0) fail('release hook blocked passing external ingestion QA')
  const ingestionReceipt = JSON.parse(readFileSync(join(releaseEvidenceDirectory, `${INGESTION_RECEIPT_ID}.json`), 'utf8'))
  const ingestionAttestation = JSON.parse(readFileSync(join(releaseEvidenceDirectory, 'quality-attestation.json'), 'utf8'))
  if (
    !passingIngestionManifest.receipts.some(receipt => receipt.id === INGESTION_RECEIPT_ID) ||
    !ingestionAttestation.subject.receiptDigests.some(receipt => receipt.id === INGESTION_RECEIPT_ID) ||
    !/^[0-9a-f]{64}$/.test(ingestionReceipt.ingestionValidation?.sha256 ?? '') ||
    new Set(passingIngestionManifest.receipts.map(receipt => receipt.qualityCohortId)).size !== 1 ||
    passingIngestionManifest.receipts.some(receipt => receipt.runMode !== 'all')
  ) fail('external ingestion receipt is not bound to the final quality cohort and attestation')

  const expectInvalidIngestionArtifact = (source, errorFragment, label) => {
    writeFileSync(releaseIngestionArtifactPath, source)
    refreshReleaseReceipts()
    const errors = buildReleaseManifest(releaseFixtureRoot).errors
    writeReleaseFixtureManifest()
    if (!errors.some(error => error.includes(errorFragment))) {
      fail(`${label} did not produce the expected runtime data validation error`)
    }
    if (runReleaseGateHook().status !== 2) fail(`release hook accepted ${label}`)
  }
  expectInvalidIngestionArtifact('{malformed\n', 'invalid JSON', 'malformed generated JSON')
  expectInvalidIngestionArtifact(
    `${JSON.stringify(ingestionEnvelope({records: [], count: 0}))}\n`,
    'below minCount',
    'an empty generated artifact',
  )
  expectInvalidIngestionArtifact(
    `${JSON.stringify(ingestionEnvelope({count: 1}))}\n`,
    'does not match record count',
    'a mismatched declared count',
  )
  expectInvalidIngestionArtifact(
    `${JSON.stringify(ingestionEnvelope({generatedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()}))}\n`,
    'freshness timestamp exceeds',
    'a stale generated artifact',
  )
  expectInvalidIngestionArtifact(
    `${JSON.stringify(ingestionEnvelope({records: [{id: 'fixture-1'}], coverage: 0.5}))}\n`,
    'field coverage',
    'an artifact below required-field coverage',
  )
  expectInvalidIngestionArtifact(
    `${JSON.stringify(ingestionEnvelope({
      records: [{id: 'duplicate', title: 'One'}, {id: 'duplicate', title: 'Two'}],
    }))}\n`,
    'duplicate ratio',
    'an artifact with duplicate identities',
  )
  expectInvalidIngestionArtifact(
    `${JSON.stringify(ingestionEnvelope({records: [{id: 'fixture-1', title: 'Fixture One'}]}))}\n`,
    'count drop ratio',
    'an artifact with an excessive count drop',
  )

  writeFileSync(releaseIngestionArtifactPath, validIngestionArtifact)
  writeFileSync(releaseIngestionBaselinePath, `${JSON.stringify(ingestionEnvelope({records: [], count: 0}))}\n`)
  refreshReleaseReceipts()
  if (!buildReleaseManifest(releaseFixtureRoot).errors.some(error => error.includes('baseline: record count 0 is below minCount'))) {
    fail('runtime data validation accepted an empty last-known-good baseline')
  }
  writeFileSync(releaseIngestionBaselinePath, `${JSON.stringify(ingestionEnvelope())}\n`)

  const caseAliasedBaselineContract = runtimeDataContractFixture()
  caseAliasedBaselineContract.generatedArtifacts[0].validation.diff.baselinePath = 'PUBLIC/DATA.JSON'
  writeFileSync(releaseIngestionContractPath, `${JSON.stringify(caseAliasedBaselineContract)}\n`)
  refreshReleaseReceipts()
  if (!buildReleaseManifest(releaseFixtureRoot).errors.some(error => error.includes('case-insensitive filesystems'))) {
    fail('runtime data contract accepted a case-aliased current artifact as its baseline')
  }

  const unicodeAliasContract = runtimeDataContractFixture()
  unicodeAliasContract.generatedArtifacts[0].validation.diff.baselinePath = 'public/café.json'
  writeFileSync(releaseIngestionContractPath, `${JSON.stringify(unicodeAliasContract)}\n`)
  refreshReleaseReceipts()
  if (!buildReleaseManifest(releaseFixtureRoot).errors.some(error => error.includes('portable ASCII path segments'))) {
    fail('runtime data contract accepted a Unicode-normalization-sensitive artifact path')
  }
  writeFileSync(releaseIngestionContractPath, `${JSON.stringify(runtimeDataContractFixture())}\n`)

  const schemaDirectory = join(releaseFixtureRoot, 'schemas')
  mkdirSync(schemaDirectory, {recursive: true})
  writeFileSync(join(schemaDirectory, 'real.schema.json'), `${JSON.stringify({type: 'object'})}\n`)
  symlinkSync('real.schema.json', join(schemaDirectory, 'data.schema.json'))
  writeFileSync(
    releaseIngestionContractPath,
    `${JSON.stringify(runtimeDataContractFixture({schema: 'schemas/data.schema.json'}))}\n`,
  )
  refreshReleaseReceipts()
  if (!buildReleaseManifest(releaseFixtureRoot).errors.some(error => error.includes('regular non-symlink'))) {
    fail('runtime data validation followed a symlinked local JSON Schema')
  }
  rmSync(schemaDirectory, {recursive: true, force: true})
  writeFileSync(releaseIngestionArtifactPath, validIngestionArtifact)
  mkdirSync(schemaDirectory, {recursive: true})
  writeFileSync(
    join(schemaDirectory, 'pattern.schema.json'),
    `${JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {value: {type: 'string', pattern: '(a+)+$'}},
    })}\n`,
  )
  writeFileSync(
    releaseIngestionContractPath,
    `${JSON.stringify(runtimeDataContractFixture({schema: 'schemas/pattern.schema.json'}))}\n`,
  )
  refreshReleaseReceipts()
  if (!buildReleaseManifest(releaseFixtureRoot).errors.some(error => error.includes('unsupported JSON Schema keyword pattern'))) {
    fail('runtime data validation accepted a native-RegExp project schema')
  }
  const scheduledWithoutRecovery = runtimeDataContractFixture()
  scheduledWithoutRecovery.refreshCapabilities = ['scheduled']
  writeFileSync(releaseIngestionContractPath, `${JSON.stringify(scheduledWithoutRecovery)}\n`)
  refreshReleaseReceipts()
  if (!buildReleaseManifest(releaseFixtureRoot).errors.some(error => error.includes('scheduled refresh requires manual-recovery'))) {
    fail('runtime data contract accepted scheduled refresh without manual recovery')
  }
  writeFileSync(releaseIngestionContractPath, `${JSON.stringify(runtimeDataContractFixture())}\n`)
  rmSync(schemaDirectory, {recursive: true, force: true})
  writeIngestionSchemaFixture(releaseFixtureRoot)
  refreshReleaseReceipts()
  writeReleaseFixtureManifest()

  writeFileSync(join(releaseQaDirectory, 'qa-data-quality.md'), '# Data Quality QA\n\n## Result\nWARN\n')
  if (!buildReleaseManifest(releaseFixtureRoot).errors.some(error => error.includes('external data quality requires PASS'))) {
    fail('release gate accepted WARN for machine-validated external data quality')
  }
  writeFileSync(join(releaseQaDirectory, 'qa-data-quality.md'), '# Data Quality QA\n\n## Result\nPASS\n')
  refreshReleaseReceipts()
  writeReleaseFixtureManifest()
  rmSync(join(releaseEvidenceDirectory, `${INGESTION_RECEIPT_ID}.json`))
  if (runReleaseGateHook().status !== 2) fail('release hook allowed ingestion without its machine receipt')
  refreshReleaseReceipts()
  writeReleaseFixtureManifest()
  writeFileSync(
    releaseIngestionArtifactPath,
    `${JSON.stringify(ingestionEnvelope({records: [{id: 'fixture-1', title: 'Changed'}]}))}\n`,
  )
  if (runReleaseGateHook().status !== 2) fail('release hook accepted runtime data changed after its receipt')
  writeFileSync(releaseIngestionArtifactPath, validIngestionArtifact)
  refreshReleaseReceipts()
  writeReleaseFixtureManifest()

  writeFileSync(join(releaseFixtureRoot, 'package.json'), releasePackageSource)
  rmSync(join(releaseDesignDirectory, 'ingestion-contract.md'))
  rmSync(releaseIngestionContractPath)
  rmSync(join(releaseQaDirectory, 'qa-data-quality.md'))
  rmSync(releaseIngestionArtifactPath)
  rmSync(releaseIngestionBaselinePath)
  rmSync(join(releaseFixtureRoot, 'schemas'), {recursive: true, force: true})
  rmSync(join(releaseFixtureRoot, 'scripts/validate-ingestion.mjs'))
  rmSync(join(releaseEvidenceDirectory, `${INGESTION_RECEIPT_ID}.json`), {force: true})
  refreshReleaseReceipts()
  writeReleaseFixtureManifest()
  
  rmSync(join(releaseQaDirectory, 'qa-browser.md'))
  if (runReleaseGateHook().status !== 2) fail('release hook allowed HANDOFF with a missing QA report')
  writeFileSync(join(releaseQaDirectory, 'qa-browser.md'), qaFixtures['qa-browser.md'].replace('PASS\n\n## Commands', 'BLOCKED\n\n## Commands'))
  if (runReleaseGateHook().status !== 2) fail('release hook allowed HANDOFF with a BLOCKED QA report')
  rmSync(releaseFixtureRoot, {recursive: true, force: true})
  
  const qualityRunnerPath = join(claudeDirectory, 'scripts', 'run-quality-gates.mjs')
  const qualityFixtureRoot = mkdtempSync(join(tmpdir(), 'web-harness-quality-runner-'))
  writeFileSync(
    join(qualityFixtureRoot, 'package.json'),
    `${JSON.stringify({
      name: 'quality-fixture',
      engines: {node: '>=22.22.0'},
      packageManager: 'pnpm@11.18.0',
      scripts: {
        build: 'node scripts/build.mjs',
        typecheck: 'node -e "process.exit(process.env.WEB_HARNESS_FIXTURE_SECRET || !process.env.VITE_PUBLIC_FIXTURE ? 9 : 0)"',
        lint: 'node -e "require(\'node:fs\').writeFileSync(\'mutated.ts\', \'export {}\\n\')"',
        'validate:ingestion': 'node scripts/validate-ingestion.mjs',
      },
    })}\n`,
  )
  writeFileSync(join(qualityFixtureRoot, 'pnpm-lock.yaml'), emptyPnpmLock)
  writeIngestionSchemaFixture(qualityFixtureRoot)
  mkdirSync(join(qualityFixtureRoot, 'scripts'), {recursive: true})
  writeFileSync(
    join(qualityFixtureRoot, 'scripts/build.mjs'),
    'process.exit(0)\n',
  )
  writeFileSync(join(qualityFixtureRoot, 'scripts/validate-ingestion.mjs'), 'process.exit(0)\n')
  mkdirSync(join(qualityFixtureRoot, '_workspace/02_design'), {recursive: true})
  writeFileSync(join(qualityFixtureRoot, '_workspace/02_design/ingestion-contract.md'), '# Ingestion Contract\n')
  writeFileSync(
    join(qualityFixtureRoot, '_workspace/02_design/build-environment.json'),
    `${JSON.stringify({schemaVersion: 1, public: ['VITE_PUBLIC_FIXTURE']})}\n`,
  )
  writeFileSync(
    join(qualityFixtureRoot, '_workspace/02_design/runtime-data-contract.json'),
    `${JSON.stringify({...runtimeDataContractFixture(), refreshCapabilities: ['on-demand']})}\n`,
  )
  mkdirSync(join(qualityFixtureRoot, 'public'), {recursive: true})
  writeFileSync(join(qualityFixtureRoot, 'public/last-known-good.json'), `${JSON.stringify(ingestionEnvelope())}\n`)
  writeFileSync(join(qualityFixtureRoot, 'public/data.json'), `${JSON.stringify(ingestionEnvelope())}\n`)
  const passingQualityRun = spawnSync(
    process.execPath,
    [qualityRunnerPath, '--project', qualityFixtureRoot, '--check', 'typecheck', '--allow-host-execution'],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        VITE_PUBLIC_FIXTURE: 'visible-by-contract',
        WEB_HARNESS_FIXTURE_SECRET: 'must-not-reach-project-scripts',
      },
    },
  )
  if (passingQualityRun.status !== 0) fail(`quality runner blocked an actual passing process: ${passingQualityRun.stderr}`)
  const typecheckReceiptPath = join(qualityFixtureRoot, '_workspace/04_qa/evidence/typecheck.json')
  if (!existsSync(typecheckReceiptPath)) fail('quality runner did not write the typecheck receipt')
  else {
    const receipt = JSON.parse(readFileSync(typecheckReceiptPath, 'utf8'))
    if (receipt.exitCode !== 0 || receipt.status !== 'PASS') fail('quality runner receipt does not contain the actual passing exit')
    if (receipt.environmentPolicy?.secretVariablesInherited !== false || receipt.environmentPolicy?.isolatedHome !== true) {
      fail('quality runner receipt does not record its isolated environment policy')
    }
  }
  const workflowSecurityFixture = JSON.parse(readFileSync(
    join(claudeDirectory, 'evals/fixtures/workflow-security-cases.json'),
    'utf8',
  ))
  mkdirSync(join(qualityFixtureRoot, '.github/workflows'), {recursive: true})
  writeFileSync(
    join(qualityFixtureRoot, '.github/workflows/refresh-data.yml'),
    workflowSecurityFixture.baseWorkflow.replace(
      'WEB_HARNESS_GENERATED_PATHS: public/data.json',
      'WEB_HARNESS_GENERATED_PATHS: public/not-declared.json',
    ),
  )
  const workflowMismatchRun = spawnSync(
    process.execPath,
    [qualityRunnerPath, '--project', qualityFixtureRoot, '--check', 'typecheck', '--allow-host-execution'],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        WEB_HARNESS_TRUSTED_PROMOTION_ACTIONS: JSON.stringify(workflowSecurityFixture.trustedPromotionActions),
      },
    },
  )
  if (
    workflowMismatchRun.status !== 2 ||
    !workflowMismatchRun.stderr.includes('REFRESH_PATH_MANIFEST_MISMATCH')
  ) fail('quality runner did not preflight workflow generated paths before project code execution')
  rmSync(join(qualityFixtureRoot, '.github'), {recursive: true, force: true})
  const mutatingQualityRun = spawnSync(
    process.execPath,
    [qualityRunnerPath, '--project', qualityFixtureRoot, '--check', 'lint', '--allow-host-execution'],
    {cwd: repositoryRoot, encoding: 'utf8'},
  )
  if (mutatingQualityRun.status !== 1) fail('quality runner did not fail a source-mutating lint command')
  const lintReceipt = JSON.parse(readFileSync(join(qualityFixtureRoot, '_workspace/04_qa/evidence/lint.json'), 'utf8'))
  if (lintReceipt.status !== 'FAIL' || lintReceipt.exitCode !== 0 || lintReceipt.sourceMutationDetected !== true) {
    fail('source-mutating command receipt is not FAIL')
  }
  writeFileSync(
    join(qualityFixtureRoot, 'scripts/build.mjs'),
    `import {writeFileSync} from 'node:fs'\nwriteFileSync('public/data.json', '[]\\n')\n`,
  )
  const runtimeDataMutatingBuildRun = spawnSync(
    process.execPath,
    [qualityRunnerPath, '--project', qualityFixtureRoot, '--check', 'build', '--allow-host-execution'],
    {cwd: repositoryRoot, encoding: 'utf8'},
  )
  const runtimeDataMutatingBuildReceipt = JSON.parse(readFileSync(
    join(qualityFixtureRoot, '_workspace/04_qa/evidence/build.json'),
    'utf8',
  ))
  if (runtimeDataMutatingBuildRun.status !== 1 || runtimeDataMutatingBuildReceipt.sourceMutationDetected !== true) {
    fail('quality runner allowed build to rewrite a promoted runtime data artifact')
  }
  writeFileSync(join(qualityFixtureRoot, 'scripts/build.mjs'), 'process.exit(0)\n')
  writeFileSync(join(qualityFixtureRoot, 'public/data.json'), `${JSON.stringify(ingestionEnvelope())}\n`)
  const allowedBuildRun = spawnSync(
    process.execPath,
    [qualityRunnerPath, '--project', qualityFixtureRoot, '--check', 'build', '--allow-host-execution'],
    {cwd: repositoryRoot, encoding: 'utf8'},
  )
  if (allowedBuildRun.status !== 0) fail(`quality runner blocked a build that preserved promoted runtime data: ${allowedBuildRun.stderr}`)
  const allowedBuildReceipt = JSON.parse(readFileSync(join(qualityFixtureRoot, '_workspace/04_qa/evidence/build.json'), 'utf8'))
  if (allowedBuildReceipt.status !== 'PASS' || allowedBuildReceipt.sourceMutationDetected !== false) {
    fail('runtime-data-preserving build receipt is not PASS')
  }
  const passingIngestionRun = spawnSync(
    process.execPath,
    [qualityRunnerPath, '--project', qualityFixtureRoot, '--check', INGESTION_RECEIPT_ID, '--allow-host-execution'],
    {cwd: repositoryRoot, encoding: 'utf8'},
  )
  if (passingIngestionRun.status !== 0) fail(`quality runner blocked valid runtime data: ${passingIngestionRun.stderr}`)
  const qualityIngestionReceiptPath = join(qualityFixtureRoot, '_workspace/04_qa/evidence/ingestion.json')
  const qualityIngestionReceipt = JSON.parse(readFileSync(qualityIngestionReceiptPath, 'utf8'))
  if (
    qualityIngestionReceipt.status !== 'PASS' ||
    qualityIngestionReceipt.ingestionValidation?.artifacts?.[0]?.count !== 2 ||
    !/^[0-9a-f]{64}$/.test(qualityIngestionReceipt.ingestionValidation?.sha256 ?? '')
  ) fail('quality runner ingestion receipt does not bind validated artifact metrics')
  writeFileSync(
    join(qualityFixtureRoot, 'public/data.json'),
    `${JSON.stringify(ingestionEnvelope({records: [], count: 0}))}\n`,
  )
  const emptyIngestionRun = spawnSync(
    process.execPath,
    [qualityRunnerPath, '--project', qualityFixtureRoot, '--check', INGESTION_RECEIPT_ID, '--allow-host-execution'],
    {cwd: repositoryRoot, encoding: 'utf8'},
  )
  const emptyIngestionReceipt = JSON.parse(readFileSync(qualityIngestionReceiptPath, 'utf8'))
  if (emptyIngestionRun.status !== 1 || emptyIngestionReceipt.status !== 'FAIL') {
    fail('quality runner did not block an empty generated artifact')
  }
  writeFileSync(join(qualityFixtureRoot, 'public/data.json'), `${JSON.stringify(ingestionEnvelope())}\n`)
  const restoreGeneratedArtifactRun = spawnSync(
    process.execPath,
    [qualityRunnerPath, '--project', qualityFixtureRoot, '--check', 'build', '--allow-host-execution'],
    {cwd: repositoryRoot, encoding: 'utf8'},
  )
  if (restoreGeneratedArtifactRun.status !== 0) fail('quality runner could not restore a valid generated artifact')
  writeFileSync(
    join(qualityFixtureRoot, '_workspace/02_design/runtime-data-contract.json'),
    `${JSON.stringify(runtimeDataContractFixture({artifactPath: 'src'}))}\n`,
  )
  const unsafeArtifactRun = spawnSync(
    process.execPath,
    [qualityRunnerPath, '--project', qualityFixtureRoot, '--check', 'build', '--allow-host-execution'],
    {cwd: repositoryRoot, encoding: 'utf8'},
  )
  if (unsafeArtifactRun.status !== 2) fail('quality runner accepted an exact protected root as a generated artifact')
  writeFileSync(
    join(qualityFixtureRoot, '_workspace/02_design/runtime-data-contract.json'),
    `${JSON.stringify({...runtimeDataContractFixture(), refreshCapabilities: ['on-demand']})}\n`,
  )
  const missingScriptRun = spawnSync(
    process.execPath,
    [qualityRunnerPath, '--project', qualityFixtureRoot, '--check', 'coverage', '--allow-host-execution'],
    {cwd: repositoryRoot, encoding: 'utf8'},
  )
  if (missingScriptRun.status !== 1) fail('quality runner did not block a missing package script')
  const coverageReceipt = JSON.parse(readFileSync(join(qualityFixtureRoot, '_workspace/04_qa/evidence/coverage.json'), 'utf8'))
  if (coverageReceipt.status !== 'BLOCKED' || coverageReceipt.exitCode !== null) fail('missing script receipt is not BLOCKED')
  const qualityPackage = JSON.parse(readFileSync(join(qualityFixtureRoot, 'package.json'), 'utf8'))
  qualityPackage.dependencies = {react: '19.1.0'}
  qualityPackage.devDependencies = {vite: '7.0.4'}
  qualityPackage.scripts['test:production-boundary'] = 'true'
  writeFileSync(join(qualityFixtureRoot, 'package.json'), `${JSON.stringify(qualityPackage)}\n`)
  mkdirSync(join(qualityFixtureRoot, '_workspace/01_plan'), {recursive: true})
  const qualityProfile = resolveProjectProfile({projectRoot: qualityFixtureRoot, requested: 'react-vite-spa'})
  writeFileSync(
    join(qualityFixtureRoot, '_workspace/01_plan/project-profile.json'),
    `${JSON.stringify(qualityProfile, null, 2)}\n`,
  )
  mkdirSync(join(qualityFixtureRoot, '_workspace/03_dev'), {recursive: true})
  const qualityPlanRun = spawnSync(
    process.execPath,
    [join(claudeDirectory, 'scripts/web-core/compile-execution-plan.mjs'), '--profile-file', '_workspace/01_plan/project-profile.json'],
    {cwd: qualityFixtureRoot, encoding: 'utf8'},
  )
  if (qualityPlanRun.status !== 0) fail(`quality fixture execution plan did not compile: ${qualityPlanRun.stderr}`)
  else writeFileSync(join(qualityFixtureRoot, '_workspace/03_dev/web-execution-plan.json'), qualityPlanRun.stdout)
  const missingAdapterCheckRun = spawnSync(
    process.execPath,
    [qualityRunnerPath, '--project', qualityFixtureRoot, '--check', 'vite.production-mock-boundary', '--allow-host-execution'],
    {cwd: repositoryRoot, encoding: 'utf8'},
  )
  if (missingAdapterCheckRun.status !== 1) fail('quality runner did not block a trivial adapter check script')
  const adapterReceipt = JSON.parse(readFileSync(join(qualityFixtureRoot, '_workspace/04_qa/evidence/vite.production-mock-boundary.json'), 'utf8'))
  if (
    adapterReceipt.status !== 'BLOCKED' ||
    adapterReceipt.profileBinding?.profileId !== 'react-vite-spa' ||
    !adapterReceipt.blockedReason?.includes('argv command contract')
  ) {
    fail('trivial adapter check receipt is not profile-bound BLOCKED evidence')
  }
  rmSync(qualityFixtureRoot, {recursive: true, force: true})

  const wrapperFixtureRoot = mkdtempSync(join(tmpdir(), 'web-harness-wrapper-provenance-'))
  try {
    writeFileSync(
      join(wrapperFixtureRoot, 'package.json'),
      `${JSON.stringify({
        name: 'wrapper-provenance-fixture',
        dependencies: {typescript: '5.0.0'},
        scripts: {typecheck: 'tsc --noEmit'},
      })}\n`,
    )
    writeFileSync(join(wrapperFixtureRoot, 'pnpm-lock.yaml'), emptyPnpmLock)
    const typescriptRoot = join(wrapperFixtureRoot, 'node_modules/.pnpm/typescript@5.0.0/node_modules/typescript')
    mkdirSync(join(typescriptRoot, 'bin'), {recursive: true})
    mkdirSync(join(wrapperFixtureRoot, 'node_modules/.bin'), {recursive: true})
    writeFileSync(join(wrapperFixtureRoot, 'node_modules/.pnpm/lock.yaml'), emptyPnpmLock)
    writeFileSync(
      join(typescriptRoot, 'package.json'),
      `${JSON.stringify({name: 'typescript', version: '5.0.0', bin: {tsc: 'bin/tsc'}})}\n`,
    )
    writeFileSync(join(typescriptRoot, 'bin/tsc'), '#!/usr/bin/env node\nprocess.exit(7)\n')
    chmodSync(join(typescriptRoot, 'bin/tsc'), 0o755)
    symlinkSync('.pnpm/typescript@5.0.0/node_modules/typescript', join(wrapperFixtureRoot, 'node_modules/typescript'))
    const forgedWrapperPath = join(wrapperFixtureRoot, 'node_modules/.bin/tsc')
    writeFileSync(forgedWrapperPath, '#!/bin/sh\nexit 0\n# ../typescript/bin/tsc\n')
    chmodSync(forgedWrapperPath, 0o755)
    const wrapperRun = spawnSync(
      process.execPath,
      [qualityRunnerPath, '--project', wrapperFixtureRoot, '--check', 'typecheck', '--allow-host-execution'],
      {cwd: repositoryRoot, encoding: 'utf8'},
    )
    if (wrapperRun.status !== 1) fail('quality runner trusted a forged passing .bin wrapper')
    const wrapperReceipt = JSON.parse(readFileSync(
      join(wrapperFixtureRoot, '_workspace/04_qa/evidence/typecheck.json'),
      'utf8',
    ))
    if (
      wrapperReceipt.status !== 'FAIL' ||
      wrapperReceipt.exitCode !== 7 ||
      wrapperReceipt.executionMode !== 'verified-package-argv'
    ) fail('quality runner did not execute the store-bound package binary directly')
  } finally {
    rmSync(wrapperFixtureRoot, {recursive: true, force: true})
  }
  pass('machine receipts, source invalidation, conditional QA, and HANDOFF hard stops checked')
}
