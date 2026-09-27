#!/usr/bin/env node
// validate-design-preview.mjs — 디자인 프리뷰가 확정 디자인 문서와 결박돼 있는지·승인이 기록됐는지 검사한다.
// 사용법: node .claude/scripts/validate-design-preview.mjs --project <root> [--json] [--write-source-snapshot | --record-approval --approval-text <원문>] [--allow-unapproved]
// 종료 코드: 0 = 통과, 1 = 위반, 2 = 사용법 오류.

import {inspectDesignPreview, recordPreviewApproval, writeSourceSnapshot} from './design-preview-status-lib.mjs'
import {answerHelp} from './cli-help-lib.mjs'

answerHelp(import.meta.url)

const parseArguments = argv => {
  const values = {project: null, writeSourceSnapshot: false, recordApproval: false, approvalText: null, json: false, allowUnapproved: false}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (key === '--project') values.project = argv[++index]
    else if (key === '--write-source-snapshot') values.writeSourceSnapshot = true
    else if (key === '--record-approval') values.recordApproval = true
    else if (key === '--approval-text') values.approvalText = argv[++index]
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
      ? recordPreviewApproval(options.project, options.approvalText)
      : inspectDesignPreview(options.project)
  process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : `design preview status: ${result.status}${result.reason ? ` (${result.reason})` : ''}\n`)
  if (result.errors?.length) process.stderr.write(`${result.errors.join('\n')}\n`)
  // SKIPPED = 프로젝트가 프리뷰를 만들지 않기로 선언했다(spec.json designPreview.policy).
  // 통과이지 미수행이 아니다 — 미수행은 MISSING이고 그것은 여전히 막는다.
  const accepted = result.status === 'APPROVED'
    || result.status === 'SKIPPED'
    || (options.writeSourceSnapshot && result.status === 'UNAPPROVED')
    || (options.recordApproval && result.status === 'APPROVED')
    || (options.allowUnapproved && result.status === 'UNAPPROVED')
  process.exit(accepted ? 0 : 1)
} catch (error) {
  process.stderr.write(`design preview validation failed: ${error.message}\n`)
  process.exit(2)
}
