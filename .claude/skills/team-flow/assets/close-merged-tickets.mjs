#!/usr/bin/env node
// web-harness:ticket-close v3 — WORK 원장 기반. 머지된 PR에 묶인 **WORK 티켓**을 닫는다. ticket-close.yml이 실행한다.
//
// **근거는 WORK 원장 하나뿐이다.** PR 본문의 `#N`은 작성자가 아무 숫자나 적을 수 있어 남의 티켓을 닫는 경로가
// 된다. 원장 줄도 PR이 가져오는 것이지만 **PR diff에 실려 리뷰를 거친다** — 그것이 차이이며 신뢰 경계는 머지
// 승인이다. 위조 비용을 한 줄 더 올리려고 **검토 계보(`plan-reviewed`)에 있는 작업만** 닫는다. `_workspace/03_dev/work-item-events.jsonl`에서 이 PR이 `work-linked`로 결속된 작업만, 그것도 링크 때
// 기록한 **기대 base가 이 머지의 base와 같을 때만** 닫는다 — `link`를 거친 PR만이다. 기대 base가 없는 링크는
// 닫지 않는다(fail-closed — 아무 브랜치 머지로 작업이 닫히지 않게).
//
// 닫지 않는 것: **집계 티켓**(부모 자동 닫기는 기본 비활성 — 사람이 판단한다) · GitHub이 아닌 트래커(능동 전이가
// 필요한데 CI에 인증·전이 매핑이 없는 경우가 흔하다 — 건너뛰지 않고 PENDING으로 남긴다).
//
// 이 파일은 대상 프로젝트의 CI에서 **단독으로** 돈다 — 하네스 모듈을 import하지 않는다. 원장 판독은 여기서
// 최소로 다시 한다: 깨진 줄은 **멈춘다**(버리고 진행하면 지나간 상태로 티켓을 닫을 수 있다).
// 멱등: 이미 CLOSED면 건너뛴다.
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {existsSync, readFileSync} from 'node:fs'

const LEDGER = '_workspace/03_dev/work-item-events.jsonl'
const repo = process.env.TICKET_REPO ?? ''
const prUrl = process.env.TICKET_PR_URL ?? ''
const baseRef = process.env.TICKET_BASE_REF ?? ''
const log = message => process.stdout.write(`${message}\n`)
const derivedUuid = seed => {
  const hex = createHash('sha256').update(seed).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
const ticketWorkId = (provider, ticketKey) => `WORK-${derivedUuid(`web-harness:ticket-work:${provider}:${ticketKey}`)}`
const gh = args => execFileSync('gh', args, {encoding: 'utf8'})

if (!repo || !prUrl || !baseRef) {
  log(`skip: 필수 입력 누락 (repo=${repo || '-'} pr=${prUrl || '-'} base=${baseRef || '-'})`)
  process.exit(0)
}
if (!existsSync(LEDGER)) {
  log(`skip: ${LEDGER} 없음 — 이 브랜치에는 발행된 WORK가 없다`)
  process.exit(0)
}

const works = new Map()
const reviewed = new Set()
for (const [index, raw] of readFileSync(LEDGER, 'utf8').split('\n').entries()) {
  const line = raw.trim()
  if (!line) continue
  let event
  try { event = JSON.parse(line) } catch {
    log(`stop: ${LEDGER} ${index + 1}번째 줄을 읽지 못했다 — 원장 파손 위에서 티켓을 닫지 않는다`)
    process.exit(1)
  }
  if (event?.eventType === 'plan-reviewed') { for (const id of event.payload?.workIds ?? []) reviewed.add(id); continue }
  if (!event?.workId) continue // 집계 이벤트는 작업이 아니다
  const current = works.get(event.workId) ?? {}
  if (event.eventType === 'publish-confirmed') works.set(event.workId, {...current, ticketKey: String(event.payload?.ticketKey ?? ''), provider: event.payload?.provider ?? null})
  if (event.eventType === 'work-linked') {
    works.set(event.workId, {...current, prUrl: event.payload?.prUrl ?? null, baseRef: event.payload?.baseRef ?? null})
    // 사람이 만든 개발 티켓 작업 — 티켓이 등록 기록이라 원장에는 연결만 있다. 작업 ID가 그 트래커·키에서 나온 것일 때만
    // 검토 계보로 센다(판정서 확인을 거쳐 등록된 티켓만 이 ID를 갖는다 — ticket-work.mjs `ticketWorkId`와 같은 식).
    const {origin, provider, ticketKey} = event.payload ?? {}
    if (origin === 'ticket' && provider && ticketKey && event.workId === ticketWorkId(provider, ticketKey)) {
      reviewed.add(event.workId)
      works.set(event.workId, {...works.get(event.workId), ticketKey: String(ticketKey), provider})
    }
  }
}

const linked = [...works.entries()].filter(([, work]) => work.prUrl === prUrl)
if (linked.length === 0) {
  log(`skip: 원장에 이 PR(${prUrl})이 결속된 WORK가 없다 — link를 거치지 않았다`)
  process.exit(0)
}
const bound = linked.filter(([workId, work]) => work.baseRef === baseRef && work.ticketKey && reviewed.has(workId))
for (const [workId, work] of linked) {
  if (work.baseRef !== baseRef) log(`skip ${workId}: 기대 base ${work.baseRef ?? '(기록 없음)'} ≠ 머지 base ${baseRef} — 닫지 않는다`)
  else if (!work.ticketKey) log(`skip ${workId}: 원장에 발행 확정(티켓 키)이 없다 — 닫지 않는다`)
  else if (!reviewed.has(workId)) log(`skip ${workId}: 검토 계보에 없는 작업이다 — 닫지 않는다`)
}

let closed = 0
// 트래커를 모르는 발행(provider 기록 이전)은 추측하지 않는다 — 닫지 않고 남긴다.
// GitHub 이슈 번호가 아닌 키(`PF-12`·URL)는 provider가 github로 적혀 있어도 **닫지 않는다** — gh는 URL도 받는다.
const isIssueNumber = key => /^\d+$/.test(String(key))
const notGithub = bound.filter(([, work]) => work.provider !== 'github' || !isIssueNumber(work.ticketKey))
for (const [workId, work] of notGithub) {
  const why = work.provider === 'github' ? 'key-not-issue-number' : `provider=${work.provider ?? '(기록 없음)'}`
  log(`PENDING ${workId} ${work.ticketKey}: ${why} — 이 워크플로우는 닫지 않는다. 사람이 확인·전이한다.`)
}
if (notGithub.length > 0) log(`⚠️ ${notGithub.length}건이 자동으로 닫히지 않았다 — 위 목록을 확인하라.`)

const failures = []
for (const [workId, work] of bound.filter(([, item]) => item.provider === 'github' && isIssueNumber(item.ticketKey))) {
  const number = work.ticketKey
  let state = null
  try {
    state = JSON.parse(gh(['issue', 'view', number, '--repo', repo, '--json', 'state'])).state
  } catch (error) {
    log(`skip ${workId} #${number}: 상태 조회 실패 — ${String(error.message).split('\n')[0]}`)
    continue
  }
  if (state !== 'OPEN') {
    log(`skip ${workId} #${number}: 이미 ${state}`)
    continue
  }
  // 왜 닫혔는지 되짚을 수 있어야 한다 — 근거를 코멘트로 남긴다.
  const comment = `${workId} 완료 — ${prUrl} 이(가) 기대 base \`${baseRef}\`에 머지됐습니다.\n\n`
    + `이 닫힘은 WORK 원장(\`${LEDGER}\`)의 PR 결속을 근거로 \`ticket-close\` 워크플로우가 기록했습니다. `
    + '부모 FEAT·집계 티켓은 닫지 않습니다.'
  // 한 건 실패로 나머지를 버리지 않는다 — 모아서 끝에 알린다(fork PR은 토큰이 읽기 전용이라 여기서 실패한다).
  try {
    gh(['issue', 'close', number, '--repo', repo, '--comment', comment])
  } catch (error) {
    failures.push(`${workId} #${number}: ${String(error.message).split('\n')[0]}`)
    continue
  }
  log(`closed ${workId} #${number}`)
  closed += 1
}
log(`done: ${closed}/${bound.length} closed`)
if (failures.length > 0) {
  log(`failed ${failures.length}: ${failures.join(' · ')}`)
  process.exit(1)
}
