#!/usr/bin/env node
import {inspectDesignPreview, recordPreviewApproval, writeSourceSnapshot} from './design-preview-status-lib.mjs'

const parseArguments = argv => {
  const values = {project: null, writeSourceSnapshot: false, recordApproval: false, approvalText: null, anchorReceipt: null, json: false, allowUnapproved: false}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (key === '--project') values.project = argv[++index]
    else if (key === '--write-source-snapshot') values.writeSourceSnapshot = true
    else if (key === '--record-approval') values.recordApproval = true
    else if (key === '--approval-text') values.approvalText = argv[++index]
    else if (key === '--anchor-receipt') values.anchorReceipt = argv[++index]
    else if (key === '--json') values.json = true
    else if (key === '--allow-unapproved') values.allowUnapproved = true
    else throw new Error(`Unknown argument: ${key}`)
  }
  if (!values.project) throw new Error('--project is required')
  if (values.writeSourceSnapshot && values.recordApproval) throw new Error('snapshot and approval operations are mutually exclusive')
  if (values.recordApproval && !values.approvalText) throw new Error('--approval-text is required with --record-approval')
  return values
}

try {
  const options = parseArguments(process.argv.slice(2))
  const result = options.writeSourceSnapshot
    ? writeSourceSnapshot(options.project)
    : options.recordApproval
      ? recordPreviewApproval(options.project, options.approvalText, {anchorReceipt: options.anchorReceipt})
      : inspectDesignPreview(options.project)
  process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : `design preview status: ${result.status}${result.reason ? ` (${result.reason})` : ''}\n`)
  if (result.errors?.length) process.stderr.write(`${result.errors.join('\n')}\n`)
  const accepted = result.status === 'APPROVED'
    || (options.writeSourceSnapshot && result.status === 'UNAPPROVED')
    || (options.recordApproval && result.status === 'APPROVED')
    || (options.allowUnapproved && result.status === 'UNAPPROVED')
  process.exit(accepted ? 0 : 1)
} catch (error) {
  process.stderr.write(`design preview validation failed: ${error.message}\n`)
  process.exit(2)
}
