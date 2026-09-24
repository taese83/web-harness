// ticket-create-run.mjs — 초안에서 개발 티켓을 만든다(`create`). 확인(`--confirm`) 없이는 미리보기다.
//
// 만든 티켓은 손으로 만든 개발 티켓과 같다(마커 없음, 팀의 개발 티켓 분류) — 다음은 `pickup <키>`의 판정이다.
// 결과를 모르는 생성(응답 유실)을 원장에 남기지 않는 대신, 다시 실행하면 같은 제목의 열린 개발 티켓을 찾아 건너뛴다.
import {existsSync, readFileSync, realpathSync} from 'node:fs'
import {isAbsolute, relative, resolve, sep} from 'node:path'
import {canonicalDigest} from './work-analysis.mjs'
import {applyTitlePrefix, devTicketClassification, parseTicketDrafts, renderDevTicketBody, validateTicketDrafts} from './ticket-create.mjs'
import {readDevTickets} from './ticket-work-run.mjs'

const list = value => (Array.isArray(value) ? value : [])
const keyOf = created => String(created?.ticketKey ?? created?.key ?? created?.number ?? '')

export async function runTicketCreate({root, flags = {}, io = {}}) {
  const provider = io.provider
  const config = io.ticketConfig ?? {}
  if (typeof flags.draft !== 'string' || !flags.draft) {
    return {ok: false, mode: 'create', phase: 'DRAFT_REQUIRED', externalWrites: 0,
      guidance: '`--draft <파일>`로 초안을 준다 — `## 제목` 아래 네 절(목적·작업 내용·완료 조건·선행·협의, 선택: 수정 범위·하지 않는 것).'}
  }
  const path = resolve(root, flags.draft)
  const outside = target => { const offset = relative(realpathSync(resolve(root)), target); return isAbsolute(offset) || offset === '..' || offset.startsWith(`..${sep}`) }
  // 링크를 따라간 실제 경로도 프로젝트 안이어야 한다.
  if (!existsSync(path) || outside(realpathSync(path))) {
    return {ok: false, mode: 'create', phase: 'DRAFT_UNREADABLE', externalWrites: 0, guidance: `초안을 프로젝트 안에서 찾지 못했다: ${flags.draft}`}
  }
  if (!provider) return {ok: false, mode: 'create', phase: 'PROVIDER_NOT_READY', externalWrites: 0, guidance: '트래커 설정이 없다 — `configure`로 먼저 정한다'}
  const {components, labels: devLabels} = devTicketClassification(config)
  const axis = provider.name === 'github' ? devLabels : components
  if (axis.length === 0) {
    return {ok: false, mode: 'create', phase: 'DEV_TICKET_AXIS_REQUIRED', externalWrites: 0,
      guidance: '어떤 분류가 개발 티켓인지 팀 설정에 없다 — `configure`로 개발 티켓 컴포넌트(GitHub은 라벨)를 먼저 정한다. 분류가 없으면 만든 티켓을 pickup이 개발 티켓으로 알아보지 못한다.'}
  }
  const drafts = parseTicketDrafts(readFileSync(path, 'utf8'))
  const open = await readDevTickets({provider, config})
  // 팀이 손 티켓 제목에 붙이는 접두어(예: `[FE]`) — 하네스 티켓도 같은 제목 규칙을 따른다.
  const titlePrefix = String((provider.name === 'github' ? config.github?.titlePrefix : config.jira?.titlePrefix) ?? '')
  const checked = validateTicketDrafts({drafts, openTickets: open.items, titlePrefix})
  if (!checked.ok) return {ok: false, mode: 'create', phase: 'DRAFT_INVALID', errors: checked.errors, externalWrites: 0}
  // Jira Cloud는 평문을 ADF로 감쌀 뿐 서식을 해석하지 않는다 — 절 이름만 적는 평문으로 낸다.
  const format = provider.name === 'jira' && provider.docFormat === 'markdown' ? 'plain' : provider.docFormat ?? 'markdown'
  const labels = provider.name === 'github' ? [...devLabels, ...list(config.github?.labels)] : list(config.jira?.labels ?? config.labels)
  const items = checked.create.map(draft => ({title: applyTitlePrefix(draft.title, titlePrefix), body: renderDevTicketBody(draft, {format}),
    labels, ...(provider.name === 'github' ? {} : {components})}))
  const existing = checked.existing
  // 확인은 **미리본 판본**에 묶는다 — 미리보기 뒤 초안을 고치면 다시 보게 한다(하네스가 쓴 완료 조건을 사람이 보는 유일한 자리다).
  const digest = canonicalDigest({items, existing})
  if (!flags.confirm) {
    return {ok: true, mode: 'create', phase: 'CREATE_PREVIEW', externalWrites: 0, create: items, existing, confirmWith: {flags: ['--confirm', '--digest', digest]},
      ...(open.checked ? {} : {openCheck: {guidance: `열린 개발 티켓을 모두 읽지 못했다${open.reason ? `: ${open.reason}` : ''} — 확인하면 같은 제목 검사 없이 만들 수 없어 멈춘다.`}}),
      guidance: `개발 티켓 ${items.length}건을 만든다${existing.length ? `(이미 있는 ${existing.length}건은 건너뛴다)` : ''}. 확인하면 --confirm으로 다시 부른다. 만든 뒤에는 pickup으로 판정·착수한다.`}
  }
  // 틀린 확인에는 기대 지문을 돌려주지 않는다 — 미리보기를 다시 보게 한다.
  if (String(flags.digest ?? '') !== digest) {
    return {ok: false, mode: 'create', phase: 'CREATE_PREVIEW_MISMATCH', externalWrites: 0,
      guidance: '확인한 미리보기와 지금 초안이 다르다(또는 미리보기 지문이 없다). 미리보기를 다시 보고 확인한다.'}
  }
  // 같은 제목 검사를 못 했으면 만들지 않는다 — 다시 실행이 중복을 만드는 길이 된다.
  if (!open.checked) {
    return {ok: false, mode: 'create', phase: 'DEV_TICKETS_UNREADABLE', externalWrites: 0,
      guidance: `열린 개발 티켓을 모두 읽지 못해 같은 제목 검사를 할 수 없다${open.reason ? `: ${open.reason}` : ''}. 트래커 접근을 확인한 뒤 다시 실행한다.`}
  }
  const created = []
  for (const item of items) {
    try {
      const result = await provider.createIssue(provider.buildWorkFields({title: item.title, body: item.body, labels: item.labels, components: item.components}))
      created.push({title: item.title, ticketKey: keyOf(result), url: result?.url ?? null})
    } catch (error) {
      return {ok: false, mode: 'create', phase: 'CREATE_PARTIAL', externalWrites: created.length, created, existing,
        failed: {title: item.title, reason: String(error?.message ?? error).slice(0, 200)},
        guidance: '일부만 만들었다. 다시 실행하면 이미 만든 것은 같은 제목으로 찾아 건너뛴다 — 응답만 끊긴 경우에도 두 번 만들지 않는다.'}
    }
  }
  return {ok: true, mode: 'create', phase: 'CREATED', externalWrites: created.length, created, existing,
    guidance: `개발 티켓 ${created.length}건을 만들었다. 다음은 티켓마다 pickup으로 판정·착수한다.`}
}
