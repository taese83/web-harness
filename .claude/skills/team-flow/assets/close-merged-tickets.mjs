#!/usr/bin/env node
// web-harness:ticket-close v4 — 티켓의 연결 기록 기반. 머지된 PR에 연결된 **하네스 작업 이슈**를 닫는다. ticket-close.yml이 실행한다.
//
// **근거는 이슈의 연결 기록 코멘트다**(`link`가 남긴 `web-harness:link pr=… base=…`). PR 본문의 `#N`은 작성자가 아무
// 숫자나 적을 수 있어 **후보일 뿐**이다 — 후보 이슈가 하네스 작업 이슈(`web-harness:work` 표지)이고, 그 이슈의 **가장 최근**
// 연결 기록이 바로 이 PR과 이 머지의 base일 때만 닫는다. 기대 base가 다르거나 기록이 없으면 닫지 않는다(fail-closed).
// 신뢰 경계: 저장소 관계자(OWNER·MEMBER·COLLABORATOR)의 코멘트만 센다 — 작성자·시각이 이슈 이력에 남는다(protected-core §4).
//
// 닫지 않는 것: 집계 티켓(부모 자동 닫기는 기본 비활성 — 사람이 판단한다) · GitHub이 아닌 트래커(본문에 `#N`이 없다).
//
// 이 파일은 대상 프로젝트의 CI에서 **단독으로** 돈다 — 하네스 모듈을 import하지 않는다. 멱등: 이미 CLOSED면 건너뛴다.
import {execFileSync} from 'node:child_process'

const repo = process.env.TICKET_REPO ?? ''
const prUrl = process.env.TICKET_PR_URL ?? ''
const baseRef = process.env.TICKET_BASE_REF ?? ''
const prBody = process.env.TICKET_PR_BODY ?? ''
const MAX_CANDIDATES = 20
const log = message => process.stdout.write(`${message}\n`)
const gh = args => execFileSync('gh', args, {encoding: 'utf8'})
const field = (name, text) => text.match(new RegExp(`\\b${name}=(\\S+)`))?.[1] ?? null

if (!repo || !prUrl || !baseRef) {
  log(`skip: 필수 입력 누락 (repo=${repo || '-'} pr=${prUrl || '-'} base=${baseRef || '-'})`)
  process.exit(0)
}
const candidates = [...new Set([...prBody.matchAll(/(?<![\w/])#(\d+)\b/g)].map(match => match[1]))]
if (candidates.length === 0) {
  log('skip: PR 본문에 이슈 번호(#N)가 없다 — 닫을 후보가 없다')
  process.exit(0)
}
if (candidates.length > MAX_CANDIDATES) log(`⚠️ 후보 ${candidates.length}건 중 앞 ${MAX_CANDIDATES}건만 확인한다.`)

/** 가장 최근 연결 기록(시각은 GitHub이 붙인 코멘트 작성 시각). 시각 없는 기록은 세지 않는다. */
const TRUSTED = ['OWNER', 'MEMBER', 'COLLABORATOR']
const latestLink = comments => comments
  // 공개 저장소에서는 아무 계정이나 코멘트를 단다 — 저장소 관계자가 남긴 기록만 센다.
  .filter(comment => TRUSTED.includes(comment?.authorAssociation))
  .flatMap(comment => [...String(comment?.body ?? '').matchAll(/<!--\s*web-harness:link\b([^>]*?)-->/g)]
    .map(match => ({pr: field('pr', match[1]), base: field('base', match[1]), at: Date.parse(comment?.createdAt)})))
  .filter(record => record.pr && record.base && Number.isFinite(record.at))
  .sort((a, b) => b.at - a.at)[0] ?? null

let closed = 0
let bound = 0
const failures = []
for (const number of candidates.slice(0, MAX_CANDIDATES)) {
  let issue
  try {
    issue = JSON.parse(gh(['issue', 'view', number, '--repo', repo, '--json', 'state,body,comments']))
  } catch (error) {
    log(`skip #${number}: 조회 실패 — ${String(error.message).split('\n')[0]}`)
    continue
  }
  const body = String(issue.body ?? '')
  if (!/<!--\s*web-harness:work\s/.test(body) || body.includes('web-harness:aggregate')) { log(`skip #${number}: 하네스 작업 이슈가 아니다 — 닫지 않는다`); continue }
  const link = latestLink(Array.isArray(issue.comments) ? issue.comments : [])
  if (!link) { log(`skip #${number}: 연결 기록이 없다 — link를 거치지 않았다`); continue }
  if (link.pr !== prUrl) { log(`skip #${number}: 가장 최근 연결은 다른 PR(${link.pr})이다 — 닫지 않는다`); continue }
  if (link.base !== baseRef) { log(`skip #${number}: 기대 base ${link.base} ≠ 머지 base ${baseRef} — 닫지 않는다`); continue }
  bound += 1
  if (issue.state !== 'OPEN') { log(`skip #${number}: 이미 ${issue.state}`); continue }
  // 왜 닫혔는지 되짚을 수 있어야 한다 — 근거를 코멘트로 남긴다.
  const comment = `${prUrl} 이(가) 기대 base \`${baseRef}\`에 머지됐습니다. 이 이슈의 연결 기록을 근거로 \`ticket-close\` 워크플로우가 닫았습니다.`
  // 한 건 실패로 나머지를 버리지 않는다 — 모아서 끝에 알린다(fork PR은 토큰이 읽기 전용이라 여기서 실패한다).
  try {
    gh(['issue', 'close', number, '--repo', repo, '--comment', comment])
  } catch (error) {
    failures.push(`#${number}: ${String(error.message).split('\n')[0]}`)
    continue
  }
  log(`closed #${number}`)
  closed += 1
}
log(`done: ${closed}/${bound} closed`)
if (failures.length > 0) {
  log(`failed ${failures.length}: ${failures.join(' · ')}`)
  process.exit(1)
}
