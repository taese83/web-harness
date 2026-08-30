#!/usr/bin/env node
// 머지된 PR에 묶인 티켓 이슈를 닫는다. ticket-close.yml이 실행한다.
//
// **근거는 원장 하나뿐이다.** PR 본문의 `#N`은 작성자가 아무 숫자나 적을 수 있어 남의 티켓을
// 닫는 경로가 된다. `_workspace/03_dev/identity-ledger.jsonl`에서 이 PR의 URL이 기록된
// 레코드만, 그것도 `branch`가 이 PR의 base와 같을 때만 닫는다 — 즉 `link`를 거친 PR만이다.
// `link`를 안 거쳤으면 아무것도 닫지 않는다(fail-closed, 조용히 추측하지 않는다).
//
// 멱등: 이미 CLOSED면 건너뛴다. 기본 브랜치 머지에서는 GitHub가 먼저 닫으므로 실제로 생긴다.
import {execFileSync} from 'node:child_process'
import {existsSync, readFileSync} from 'node:fs'

const LEDGER = '_workspace/03_dev/identity-ledger.jsonl'
const repo = process.env.TICKET_REPO ?? ''
const prUrl = process.env.TICKET_PR_URL ?? ''
const baseRef = process.env.TICKET_BASE_REF ?? ''
const log = message => process.stdout.write(`${message}\n`)
const gh = args => execFileSync('gh', args, {encoding: 'utf8'})

if (!repo || !prUrl || !baseRef) {
  log(`skip: 필수 입력 누락 (repo=${repo || '-'} pr=${prUrl || '-'} base=${baseRef || '-'})`)
  process.exit(0)
}
if (!existsSync(LEDGER)) {
  log(`skip: ${LEDGER} 없음 — 이 브랜치는 티켓 청구 대상이 아니다`)
  process.exit(0)
}

// 원장은 append-only라 같은 featureId가 여러 줄일 수 있다. 뒤에 온 것이 최신이다.
const latest = new Map()
for (const line of readFileSync(LEDGER, 'utf8').split('\n')) {
  const trimmed = line.trim()
  if (!trimmed) continue
  let record
  try { record = JSON.parse(trimmed) } catch { continue }
  if (!record?.featureId) continue
  latest.set(record.featureId, {...(latest.get(record.featureId) ?? {}), ...record})
}

const bound = [...latest.values()].filter(record =>
  record.prUrl === prUrl && record.branch === baseRef && record.ticketKey)
if (bound.length === 0) {
  log(`skip: 원장에 이 PR(${prUrl})이 base ${baseRef}로 묶인 티켓이 없다 — link를 거치지 않았거나 다른 브랜치다`)
  process.exit(0)
}

let closed = 0
for (const record of bound) {
  const number = String(record.ticketKey)
  let state = null
  try {
    state = JSON.parse(gh(['issue', 'view', number, '--repo', repo, '--json', 'state'])).state
  } catch (error) {
    log(`skip ${record.featureId} #${number}: 상태 조회 실패 — ${error.message.split('\n')[0]}`)
    continue
  }
  if (state !== 'OPEN') {
    log(`skip ${record.featureId} #${number}: 이미 ${state}`)
    continue
  }
  // 왜 닫혔는지 되짚을 수 있어야 한다 — 근거를 코멘트로 남긴다.
  const comment = `${record.featureId} 완료 — ${prUrl} 이(가) \`${baseRef}\`에 머지됐습니다.\n\n`
    + `이 닫힘은 청구 원장(\`${LEDGER}\`)의 PR 결속을 근거로 \`ticket-close\` 워크플로우가 기록했습니다.`
  gh(['issue', 'close', number, '--repo', repo, '--comment', comment])
  log(`closed ${record.featureId} #${number}`)
  closed += 1
}
log(`done: ${closed}/${bound.length} closed`)
