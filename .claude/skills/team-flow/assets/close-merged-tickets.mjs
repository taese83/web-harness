#!/usr/bin/env node
// web-harness:ticket-close v5 — 머지된 PR의 **제목에 적힌 티켓**을 닫는다. ticket-close.yml이 실행한다.
//
// **근거는 PR 제목의 티켓 키**(`[#12] …`·`#12 …`)와 **기대 base**다 — 하네스는 티켓에 연결 기록을 쓰지 않는다. 제목은 PR과 함께
// 리뷰되고 머지 승인을 거친다(신뢰 경계는 머지 승인). 기대 base는 커밋된 계획의 `baseBranch`, 없으면 저장소 기본 브랜치다 —
// 다른 브랜치로의 머지는 닫지 않는다(fail-closed). 되돌림 PR(`Revert "…"`)·키 없는 제목은 닫지 않는다.
//
// 닫지 않는 것: 집계 티켓(부모 자동 닫기는 기본 비활성 — 사람이 판단한다) · GitHub이 아닌 트래커(제목의 키가 이슈 번호가 아니다).
//
// 이 파일은 대상 프로젝트의 CI에서 **단독으로** 돈다 — 하네스 모듈을 import하지 않는다. 멱등: 이미 CLOSED면 건너뛴다.
import {execFileSync} from 'node:child_process'
import {existsSync, readFileSync} from 'node:fs'

const PLAN = '_workspace/03_dev/work-plan.json'
const repo = process.env.TICKET_REPO ?? ''
const prUrl = process.env.TICKET_PR_URL ?? ''
const baseRef = process.env.TICKET_BASE_REF ?? ''
const title = process.env.TICKET_PR_TITLE ?? ''
const defaultBranch = process.env.TICKET_DEFAULT_BRANCH ?? ''
const log = message => process.stdout.write(`${message}\n`)
const gh = args => execFileSync('gh', args, {encoding: 'utf8'})

if (!repo || !prUrl || !baseRef) {
  log(`skip: 필수 입력 누락 (repo=${repo || '-'} pr=${prUrl || '-'} base=${baseRef || '-'})`)
  process.exit(0)
}
// `Revert "…"`를 벗긴다 — 홀수 겹은 되돌림(닫지 않는다), 짝수 겹은 되돌림을 되돌린 재착륙(닫는다).
let subject = title.trim()
let depth = 0
for (let match = subject.match(/^Revert "(.*)"\s*$/); match; match = subject.match(/^Revert "(.*)"\s*$/)) { subject = match[1]; depth += 1 }
if (depth % 2 === 1) {
  log('skip: 되돌림 PR이다 — 닫지 않는다(완료는 되돌림 뒤의 머지로 다시 센다)')
  process.exit(0)
}
const number = subject.match(/^(?:\[#?(\d+)\]|#?(\d+)(?![\w-]))/)?.slice(1).find(Boolean) ?? null
if (!number) {
  log('skip: PR 제목이 이슈 번호로 시작하지 않는다 — 어느 티켓의 작업인지 모른다')
  process.exit(0)
}
let expected = defaultBranch
if (existsSync(PLAN)) {
  try { expected = JSON.parse(readFileSync(PLAN, 'utf8'))?.baseBranch || defaultBranch } catch {
    log(`stop: ${PLAN}을 읽지 못했다 — 기대 base를 모른 채 닫지 않는다`)
    process.exit(1)
  }
}
if (!expected || expected !== baseRef) {
  log(`skip #${number}: 기대 base ${expected || '(모름)'} ≠ 머지 base ${baseRef} — 닫지 않는다`)
  process.exit(0)
}
let issue
try {
  issue = JSON.parse(gh(['issue', 'view', number, '--repo', repo, '--json', 'state,body']))
} catch (error) {
  log(`skip #${number}: 조회 실패 — ${String(error.message).split('\n')[0]}`)
  process.exit(0)
}
if (String(issue.body ?? '').includes('web-harness:aggregate')) {
  log(`skip #${number}: 집계 티켓이다 — 닫지 않는다`)
  process.exit(0)
}
if (issue.state !== 'OPEN') {
  log(`skip #${number}: 이미 ${issue.state}`)
  process.exit(0)
}
// 왜 닫혔는지 되짚을 수 있어야 한다 — 근거를 코멘트로 남긴다. 한 PR은 한 티켓이다(제목의 키 하나).
const comment = `${prUrl} 이(가) \`${baseRef}\`에 머지됐습니다. PR 제목의 티켓 키를 근거로 \`ticket-close\` 워크플로우가 닫았습니다.`
try {
  gh(['issue', 'close', number, '--repo', repo, '--comment', comment])
} catch (error) {
  // fork PR은 토큰이 읽기 전용이라 여기서 실패한다 — 사람이 닫는다.
  log(`failed #${number}: ${String(error.message).split('\n')[0]}`)
  process.exit(1)
}
log(`closed #${number}`)
log('done: 1/1 closed')
