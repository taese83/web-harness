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
// **원장이 어느 트래커인지 안다.** `provider` 필드는 2026-09-02에 생겼고 그 전 레코드는 전부
// GitHub이다(그래서 기본값이 github다). GitHub이 아닌 트래커는 `gh issue close`로 닫히지 않는다 —
// PR 본문의 키 언급으로 자동 닫히지도 않으므로 **능동 전이가 필요하다.**
//
// 이 워크플로우는 그 전이를 여기서 수행하지 않는다. 인증(토큰)과 전이 매핑이 CI 시크릿·설정에
// 있어야 하는데, 그것을 갖추지 못한 채 도는 것이 흔하기 때문이다. **대신 조용히 건너뛰지 않고
// 남길 일을 남긴다** — 건너뛴 것과 닫은 것이 로그에서 구분되지 않으면, 보드는 완료라는데 티켓은
// 열린 채인 그 상태가 원인 없이 재현된다(이 파일이 존재하는 이유와 같은 실패다).
const nonGithub = bound.filter(record => (record.provider ?? 'github') !== 'github')
if (nonGithub.length > 0) {
  for (const record of nonGithub) {
    log(`PENDING ${record.featureId} ${record.ticketKey}: provider=${record.provider} — 이 트래커는 자동 닫기가 없다. `
      + `상태 전이가 필요하다(전이 매핑은 _workspace/03_dev/ticket-provider.json).`)
  }
  log(`⚠️ ${nonGithub.length}건이 자동으로 닫히지 않았다 — 위 목록을 확인하라.`)
}

for (const record of bound.filter(r => (r.provider ?? 'github') === 'github')) {
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
