import {createPublicKey, verify} from 'node:crypto'
import {existsSync} from 'node:fs'
import {join} from 'node:path'
import {sha256} from './evidence-lib.mjs'
import {readProjectRegularFile} from './safe-project-file-lib.mjs'
import {stableStringify} from './web-core/core-lib.mjs'

export const QUALITY_ATTESTATION_PATH = '_workspace/04_qa/evidence/quality-attestation.json'
export const QUALITY_ATTESTER_TRUST_PATH = '.claude/quality-attesters.json'

const MAX_ATTESTATION_AGE_MS = 24 * 60 * 60 * 1000
const PROTECTED_CONTEXT_ENVIRONMENT = Object.freeze({
  trustConfigSha256: 'WEB_HARNESS_EXPECTED_TRUST_CONFIG_SHA256',
  repositoryId: 'WEB_HARNESS_REPOSITORY_ID',
  revision: 'WEB_HARNESS_REVISION',
  workflowRef: 'WEB_HARNESS_WORKFLOW_REF',
  ciIssuer: 'WEB_HARNESS_CI_ISSUER',
  issuerRunId: 'WEB_HARNESS_CI_RUN_ID',
})
const SAFE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,511}$/
const exactKeys = (value, expected) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  return JSON.stringify(actual) === JSON.stringify([...expected].sort())
}

const canonicalEd25519PublicKey = pem => {
  if (
    typeof pem !== 'string' ||
    pem.length > 8192 ||
    !pem.startsWith('-----BEGIN PUBLIC KEY-----\n') ||
    !pem.endsWith('-----END PUBLIC KEY-----\n') ||
    pem.includes('\r')
  ) throw new Error('key must be canonical SPKI PEM')
  const publicKey = createPublicKey(pem)
  if (publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('key must be an Ed25519 public key')
  }
  const canonicalPem = publicKey.export({format: 'pem', type: 'spki'}).toString()
  if (canonicalPem !== pem) throw new Error('key must be canonical SPKI PEM')
  return publicKey
}

const validateTrustedPublicKeys = (trust, localErrors) => {
  const trustedKeys = Array.isArray(trust?.keys) ? trust.keys : []
  const publicKeys = new Map()
  if (!exactKeys(trust, ['schemaVersion', 'keys']) || trust.schemaVersion !== 1 || !Array.isArray(trust.keys)) {
    localErrors.push(`${QUALITY_ATTESTER_TRUST_PATH}: schemaVersion 1 and keys[] are required`)
  }
  if (trustedKeys.length === 0) localErrors.push(`${QUALITY_ATTESTER_TRUST_PATH}: at least one trusted key is required`)
  const ids = new Set()
  for (const [index, key] of trustedKeys.entries()) {
    const duplicate = ids.has(key?.id)
    const shapeIsValid =
      exactKeys(key, ['id', 'algorithm', 'publicKeyPem']) &&
      typeof key.id === 'string' &&
      /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(key.id) &&
      key.algorithm === 'ed25519' &&
      typeof key.publicKeyPem === 'string' &&
      key.publicKeyPem.length <= 8192 &&
      !duplicate
    if (!shapeIsValid) {
      localErrors.push(`${QUALITY_ATTESTER_TRUST_PATH}: invalid or duplicate key at index ${index}`)
    } else {
      try {
        publicKeys.set(key.id, canonicalEd25519PublicKey(key.publicKeyPem))
      } catch (error) {
        localErrors.push(
          `${QUALITY_ATTESTER_TRUST_PATH}: invalid public key at index ${index}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    ids.add(key?.id)
  }
  return {trustedKeys, publicKeys}
}

const readRegularJson = (projectRoot, relativePath, localErrors) => {
  const absolutePath = join(projectRoot, relativePath)
  if (!existsSync(absolutePath)) {
    localErrors.push(`Required trusted quality evidence is missing: ${relativePath}`)
    return null
  }
  let content
  try {
    content = readProjectRegularFile(projectRoot, relativePath, {maxBytes: 128 * 1024})
  } catch (error) {
    localErrors.push(
      `Trusted quality evidence cannot be inspected: ${relativePath}: ` +
      `${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
  const source = content.toString('utf8')
  try {
    return {source, value: JSON.parse(source)}
  } catch (error) {
    localErrors.push(`${relativePath}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

const qualityAttestationEvidence = ({
  qualityCohortId,
  sourceFingerprint,
  receipts,
  trustConfigSha256,
  issuedAt,
}) => ({
  issuedAt,
  qualityCohortId,
  receiptDigests: receipts
    .map(receipt => ({id: receipt.id, sha256: receipt.sha256}))
    .sort((left, right) => left.id.localeCompare(right.id)),
  sourceFingerprint,
  trustConfigSha256,
})

const REQUIRED_EXECUTION_CLAIMS = Object.freeze({
  environment: 'isolated-ci',
  frozenLockfileInstallVerified: true,
  hostFilesystemIsolated: true,
  lifecycleScriptsDisabled: true,
  networkIsolated: true,
  nodeModulesCreatedInRun: true,
  processBoundaryVerified: true,
})

export const buildQualityAttestationRequest = ({provenance, ...evidenceInput}) => ({
  schemaVersion: 1,
  requestType: 'web-harness-quality-attestation',
  evidence: qualityAttestationEvidence(evidenceInput),
  expectedProvenance: provenance,
  requiredExecutionClaims: REQUIRED_EXECUTION_CLAIMS,
})

export const buildQualityAttestationSubject = ({provenance, ...evidenceInput}) => ({
  execution: REQUIRED_EXECUTION_CLAIMS,
  provenance,
  ...qualityAttestationEvidence(evidenceInput),
})

export const readProtectedQualityContext = (environment = process.env) => {
  const values = Object.fromEntries(
    Object.entries(PROTECTED_CONTEXT_ENVIRONMENT).map(([key, name]) => [key, environment[name]]),
  )
  if (!/^[0-9a-f]{64}$/.test(values.trustConfigSha256 ?? '')) {
    throw new Error(`${PROTECTED_CONTEXT_ENVIRONMENT.trustConfigSha256} must be a protected 64-character lowercase SHA-256 digest`)
  }
  for (const key of ['repositoryId', 'revision', 'workflowRef', 'ciIssuer', 'issuerRunId']) {
    if (typeof values[key] !== 'string' || !SAFE_IDENTITY.test(values[key])) {
      throw new Error(`${PROTECTED_CONTEXT_ENVIRONMENT[key]} is missing or unsafe`)
    }
  }
  return {
    trustConfigSha256: values.trustConfigSha256,
    provenance: {
      repositoryId: values.repositoryId,
      revision: values.revision,
      workflowRef: values.workflowRef,
      ciIssuer: values.ciIssuer,
      issuerRunId: values.issuerRunId,
    },
  }
}

export const readQualityAttesterTrustSha256 = (projectRoot, protectedContext = readProtectedQualityContext()) => {
  const errors = []
  const document = readRegularJson(projectRoot, QUALITY_ATTESTER_TRUST_PATH, errors)
  if (document) validateTrustedPublicKeys(document.value, errors)
  if (!document || errors.length > 0) throw new Error(errors.join('; ') || 'Trusted attester config is unavailable')
  const digest = sha256(document.source)
  if (digest !== protectedContext.trustConfigSha256) {
    throw new Error(`${QUALITY_ATTESTER_TRUST_PATH} does not match the checkout-external protected trust digest`)
  }
  return digest
}

export const verifyQualityAttestation = ({
  projectRoot,
  receipts,
  sourceFingerprint,
  errors,
  allowAdditionalReceiptDigests = false,
}) => {
  const localErrors = []
  let protectedContext = null
  try {
    protectedContext = readProtectedQualityContext()
  } catch (error) {
    localErrors.push(`Protected quality context is unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
  const trustDocument = readRegularJson(projectRoot, QUALITY_ATTESTER_TRUST_PATH, localErrors)
  const attestationDocument = readRegularJson(projectRoot, QUALITY_ATTESTATION_PATH, localErrors)
  let attestation = null
  let publicKeyFingerprint = null
  let subjectSha256 = null
  let trustedKeys = []
  let trustedPublicKeys = new Map()

  if (trustDocument) {
    const trust = trustDocument.value
    const validatedKeys = validateTrustedPublicKeys(trust, localErrors)
    trustedKeys = validatedKeys.trustedKeys
    trustedPublicKeys = validatedKeys.publicKeys
    if (protectedContext && sha256(trustDocument.source) !== protectedContext.trustConfigSha256) {
      localErrors.push(`${QUALITY_ATTESTER_TRUST_PATH}: checkout trust config does not match the protected external digest`)
    }
  }

  if (attestationDocument) {
    attestation = attestationDocument.value
    if (
      !exactKeys(attestation, ['schemaVersion', 'keyId', 'algorithm', 'subject', 'signature']) ||
      attestation.schemaVersion !== 1 ||
      attestation.algorithm !== 'ed25519' ||
      typeof attestation.keyId !== 'string' ||
      typeof attestation.signature !== 'string'
    ) localErrors.push(`${QUALITY_ATTESTATION_PATH}: invalid attestation envelope`)

    const subject = attestation && typeof attestation === 'object' ? attestation.subject : null
    subjectSha256 = subject && typeof subject === 'object' ? sha256(stableStringify(subject)) : null
    if (!exactKeys(subject, [
      'execution',
      'issuedAt',
      'provenance',
      'qualityCohortId',
      'receiptDigests',
      'sourceFingerprint',
      'trustConfigSha256',
    ])) {
      localErrors.push(`${QUALITY_ATTESTATION_PATH}: invalid attestation subject`)
    } else {
      const execution = subject.execution
      if (
        !exactKeys(execution, [
          'environment',
          'frozenLockfileInstallVerified',
          'hostFilesystemIsolated',
          'lifecycleScriptsDisabled',
          'networkIsolated',
          'nodeModulesCreatedInRun',
          'processBoundaryVerified',
        ]) ||
        execution.environment !== 'isolated-ci' ||
        execution.frozenLockfileInstallVerified !== true ||
        execution.hostFilesystemIsolated !== true ||
        execution.lifecycleScriptsDisabled !== true ||
        execution.networkIsolated !== true ||
        execution.nodeModulesCreatedInRun !== true ||
        execution.processBoundaryVerified !== true
      ) localErrors.push(`${QUALITY_ATTESTATION_PATH}: verified isolated execution claims are required`)

      const provenance = subject.provenance
      if (
        !exactKeys(provenance, ['repositoryId', 'revision', 'workflowRef', 'ciIssuer', 'issuerRunId']) ||
        ['repositoryId', 'revision', 'workflowRef', 'ciIssuer', 'issuerRunId']
          .some(key => typeof provenance?.[key] !== 'string' || !SAFE_IDENTITY.test(provenance[key]))
      ) {
        localErrors.push(`${QUALITY_ATTESTATION_PATH}: protected CI provenance is missing or invalid`)
      } else if (protectedContext && stableStringify(provenance) !== stableStringify(protectedContext.provenance)) {
        localErrors.push(`${QUALITY_ATTESTATION_PATH}: signed provenance does not match the protected CI identity`)
      }

      const issuedAt = Date.parse(subject.issuedAt ?? '')
      if (
        !Number.isFinite(issuedAt) ||
        issuedAt > Date.now() + 5 * 60 * 1000 ||
        Date.now() - issuedAt > MAX_ATTESTATION_AGE_MS
      ) localErrors.push(`${QUALITY_ATTESTATION_PATH}: attestation is missing, future-dated, or older than 24 hours`)

      const receiptCohorts = new Set(receipts.map(receipt => receipt.qualityCohortId).filter(Boolean))
      if (receiptCohorts.size !== 1 || subject.qualityCohortId !== [...receiptCohorts][0]) {
        localErrors.push(`${QUALITY_ATTESTATION_PATH}: quality cohort does not match the receipts`)
      }
      if (receipts.some(receipt => receipt.executionContext !== 'isolated-ci-declared')) {
        localErrors.push(`${QUALITY_ATTESTATION_PATH}: only isolated-CI receipts may be release-attested`)
      }
      if (subject.sourceFingerprint !== sourceFingerprint) {
        localErrors.push(`${QUALITY_ATTESTATION_PATH}: source fingerprint does not match the current source`)
      }
      if (
        subject.trustConfigSha256 !== sha256(trustDocument?.source ?? '') ||
        (protectedContext && subject.trustConfigSha256 !== protectedContext.trustConfigSha256)
      ) {
        localErrors.push(`${QUALITY_ATTESTATION_PATH}: trusted attester configuration digest does not match`)
      }
      const expectedDigests = receipts
        .map(receipt => ({id: receipt.id, sha256: receipt.sha256}))
        .sort((left, right) => left.id.localeCompare(right.id))
      const signedDigests = Array.isArray(subject.receiptDigests) ? subject.receiptDigests : []
      const ids = new Set(signedDigests.map(receipt => receipt?.id))
      const signedDigestMap = new Map(signedDigests.map(receipt => [receipt?.id, receipt?.sha256]))
      const signedDigestShapeIsValid = signedDigests.every(receipt =>
        exactKeys(receipt, ['id', 'sha256']) &&
        typeof receipt.id === 'string' &&
        /^[a-z0-9][a-z0-9._-]{0,127}$/i.test(receipt.id) &&
        typeof receipt.sha256 === 'string' &&
        /^[0-9a-f]{64}$/.test(receipt.sha256),
      )
      const expectedDigestsMatch = allowAdditionalReceiptDigests
        ? expectedDigests.every(receipt => signedDigestMap.get(receipt.id) === receipt.sha256)
        : JSON.stringify(signedDigests) === JSON.stringify(expectedDigests)
      if (
        !Array.isArray(subject.receiptDigests) ||
        !signedDigestShapeIsValid ||
        ids.size !== signedDigests.length ||
        !expectedDigestsMatch
      ) localErrors.push(`${QUALITY_ATTESTATION_PATH}: signed receipt digests do not match current evidence`)
    }

    const trustedKey = trustedKeys.find(key => key?.id === attestation?.keyId)
    if (!trustedKey) {
      localErrors.push(`${QUALITY_ATTESTATION_PATH}: signing key is not trusted`)
    } else if (!trustedPublicKeys.has(trustedKey.id)) {
      // The trust-document validation above records the precise key format error.
    } else {
      try {
        const publicKey = trustedPublicKeys.get(trustedKey.id)
        publicKeyFingerprint = sha256(publicKey.export({format: 'der', type: 'spki'}))
        if (!/^[A-Za-z0-9+/]{86}==$/.test(attestation?.signature ?? '')) {
          throw new Error('signature must be canonical base64 Ed25519 bytes')
        }
        const signature = Buffer.from(attestation.signature, 'base64')
        if (signature.length !== 64 || !verify(null, Buffer.from(stableStringify(subject)), publicKey, signature)) {
          throw new Error('signature verification failed')
        }
      } catch (error) {
        localErrors.push(`${QUALITY_ATTESTATION_PATH}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  errors.push(...localErrors)
  return attestationDocument ? {
    algorithm: attestation?.algorithm ?? null,
    keyId: attestation?.keyId ?? null,
    path: QUALITY_ATTESTATION_PATH,
    publicKeyFingerprint,
    sha256: sha256(attestationDocument.source),
    status: localErrors.length === 0 ? 'PASS' : 'BLOCKED',
    subjectSha256,
  } : null
}
