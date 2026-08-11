#!/usr/bin/env node

import {resolve} from 'node:path'
import {buildReleaseManifest} from './release-gate-lib.mjs'
import {
  buildQualityAttestationRequest,
  readProtectedQualityContext,
  readQualityAttesterTrustSha256,
} from './quality-attestation-lib.mjs'
import {parseArgv, runCli, WebCoreError} from './web-core/core-lib.mjs'

runCli(() => {
  const args = parseArgv(process.argv.slice(2), {
    '--issuer-run-id': 'value',
    '--project': 'value',
  })
  const issuerRunId = args['issuer-run-id']
  if (!args.project || !issuerRunId) {
    throw new WebCoreError('INVALID_ARGUMENT', '--project and --issuer-run-id are required')
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(issuerRunId)) {
    throw new WebCoreError('INVALID_ARGUMENT', '--issuer-run-id has an unsafe format')
  }
  const protectedContext = readProtectedQualityContext()
  if (issuerRunId !== protectedContext.provenance.issuerRunId) {
    throw new WebCoreError('PROTECTED_CI_IDENTITY_MISMATCH', '--issuer-run-id does not match protected CI context')
  }

  const projectRoot = resolve(args.project)
  const {errors, manifest} = buildReleaseManifest(projectRoot, {phase: 'attestation-request'})
  if (errors.length > 0) {
    throw new WebCoreError(
      'QUALITY_EVIDENCE_INVALID',
      'Quality evidence must pass before an attestation request can be prepared',
      {errors},
    )
  }
  if (manifest.receipts.length === 0) {
    throw new WebCoreError('QUALITY_RECEIPTS_MISSING', 'No quality receipts are available for attestation')
  }
  if (manifest.receipts.some(receipt => receipt.executionContext !== 'isolated-ci-declared')) {
    throw new WebCoreError('QUALITY_EXECUTION_NOT_ISOLATED', 'Only isolated-CI receipts may be attested')
  }
  const cohortIds = new Set(manifest.receipts.map(receipt => receipt.qualityCohortId))
  if (cohortIds.size !== 1) {
    throw new WebCoreError('QUALITY_COHORT_INVALID', 'Attestation requires exactly one quality cohort')
  }

  return buildQualityAttestationRequest({
    qualityCohortId: [...cohortIds][0],
    sourceFingerprint: manifest.sourceFingerprint,
    receipts: manifest.receipts,
    trustConfigSha256: readQualityAttesterTrustSha256(projectRoot, protectedContext),
    issuedAt: new Date().toISOString(),
    provenance: protectedContext.provenance,
  })
})
