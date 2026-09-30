// ticket-create-run.mjs — 초안에서 개발 티켓을 만든다(`create`). 확인(`--confirm`) 없이는 미리보기다.
//
// 만든 티켓은 손으로 만든 개발 티켓과 같다(마커 없음, 팀의 개발 티켓 분류) — 다음은 `pickup <키>`의 판정이다.
// 결과를 모르는 생성(응답 유실)을 원장에 남기지 않는 대신, 다시 실행하면 같은 제목의 열린 개발 티켓을 찾아 건너뛴다.
import {existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync} from 'node:fs'
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path'
import {canonicalDigest} from './work-analysis.mjs'
import {applyTitlePrefix, devTicketClassification, parseTicketDrafts, renderDevTicketBody, validateTicketDrafts} from './ticket-create.mjs'
import {readDevTickets} from './ticket-work-run.mjs'
import {assessmentPath} from './ticket-work.mjs'
import {buildSeed, draftAssessmentsPath, seededAssessment, seedPath} from './ticket-seed.mjs'

const list = value => (Array.isArray(value) ? value : [])
const keyOf = created => String(created?.ticketKey ?? created?.key ?? created?.number ?? '')

/** 최근 끝난 개발 티켓(읽기만). 못 읽으면 그 사실을 돌려준다 — 「겹침 없음」으로 읽히지 않게. */
async function readRecentDoneDevTickets({provider, config, limit = 20}) {
  if (typeof provider?.listDoneDevTickets !== 'function') return {checked: false, reason: 'provider가 끝난 개발 티켓 목록을 주지 않는다', items: []}
  try {
    const listed = await provider.listDoneDevTickets({config, limit})
    return {checked: true, items: list(listed.items).map(item => ({ticketKey: item.ticketKey, summary: item.summary, status: item.status ?? null})),
      guidance: '최근 끝난 개발 티켓이다(취소·해결 안 함도 섞여 있다 — status로 가린다) — 만들 티켓과 같은 일을 이미 끝낸 것이 있으면 만들지 않고 그 티켓과 코드를 가리킨다'}
  } catch (error) {
    return {checked: false, reason: String(error?.message ?? error).slice(0, 120), items: []}
  }
}

/**
 * 초안 판정(초안 에이전트가 초안 옆에 쓴 `<이름>.assessments.json` — 제목별 판정서). 없으면 빈 목록, 깨졌으면 그 사실.
 * 판정은 pickup이 다시 검증하고 개발자가 확인한다 — 여기서는 모양만 본다.
 */
function readDraftAssessments(root, draftPath) {
  const path = resolve(root, draftAssessmentsPath(draftPath))
  if (!existsSync(path)) return {byTitle: new Map()}
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    const tickets = value?.tickets && typeof value.tickets === 'object' && !Array.isArray(value.tickets) ? value.tickets : null
    if (value?.schemaVersion !== 1 || !tickets) return {byTitle: new Map(), error: '초안 판정의 모양이 맞지 않는다(schemaVersion 1, tickets: {제목: 판정서})'}
    return {byTitle: new Map(Object.entries(tickets).filter(([, item]) => item && typeof item === 'object'))}
  } catch (error) {
    return {byTitle: new Map(), error: `초안 판정을 읽지 못했다: ${String(error?.message ?? error).slice(0, 120)}`}
  }
}

/**
 * 만든 티켓에 초안 판정을 판정서로 미리 둔다 — pickup이 만든 시점의 지문(트래커 본문·스팩·수정 범위 코드)을 대조해 그대로면
 * 판정 에이전트를 다시 부르지 않는다. 이미 판정서가 있으면 덮지 않는다. 실패해도 티켓 생성은 성공이다(pickup이 판정한다).
 */
async function seedTicketAssessment({root, provider, ticketKey, draftAssessment, fallbackBody}) {
  if (!draftAssessment || !ticketKey) return null
  const target = join(root, assessmentPath(ticketKey))
  if (existsSync(target)) return {seeded: false, reason: 'assessment-exists'}
  try {
    // 트래커가 저장한 본문으로 지문을 뜬다 — 서식 변환(Jira 등)이 있어도 pickup이 읽을 본문과 같게.
    const stored = typeof provider?.resolveIssue === 'function' ? await provider.resolveIssue(ticketKey).catch(() => null) : null
    const body = stored?.body ?? fallbackBody
    let spec = null
    try { spec = JSON.parse(readFileSync(join(root, '_workspace/03_dev/spec.json'), 'utf8')) } catch { /* 스팩이 없으면 지문이 어긋나 pickup이 판정한다 */ }
    const assessment = seededAssessment({draftAssessment, ticketKey, provider: provider.name})
    const seed = buildSeed({root, ticketKey, provider: provider.name, body, spec, assessment})
    mkdirSync(dirname(target), {recursive: true})
    writeFileSync(target, `${JSON.stringify(assessment, null, 2)}\n`)
    writeFileSync(join(root, seedPath(ticketKey)), `${JSON.stringify(seed, null, 2)}\n`)
    return {seeded: true}
  } catch (error) {
    return {seeded: false, reason: String(error?.message ?? error).slice(0, 120)}
  }
}

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
  if (flags.epic && provider.name !== 'jira') {
    return {ok: false, mode: 'create', phase: 'EPIC_UNSUPPORTED', externalWrites: 0,
      guidance: `${provider.name}에는 에픽 필드가 없다 — 선행·협의 절에 상위 이슈를 적는다`}
  }
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
    labels, ...(provider.name === 'github' ? {} : {components}), draftTitle: draft.title}))
  const draftAssessments = readDraftAssessments(root, flags.draft)
  const seedable = items.filter(item => draftAssessments.byTitle.has(item.draftTitle)).length
  const seedNote = {seededAssessments: {count: seedable, ...(draftAssessments.error ? {error: draftAssessments.error} : {}),
    guidance: seedable > 0 ? `초안 판정 ${seedable}건을 만든 티켓에 미리 둔다 — pickup이 트래커 본문·스팩·수정 범위 코드가 그대로인지 대조해 그대로면 판정을 다시 하지 않는다.`
      : '초안 판정이 없다 — 만든 뒤 pickup이 티켓마다 판정한다.'}}
  const existing = checked.existing
  // 확인은 **미리본 판본**에 묶는다 — 미리보기 뒤 초안을 고치면 다시 보게 한다(하네스가 쓴 완료 조건을 사람이 보는 유일한 자리다).
  const digest = canonicalDigest({items, existing, ...(flags.epic ? {epic: String(flags.epic)} : {})})
  if (!flags.confirm) {
    // 최근 끝난 개발 티켓 — 같은 제목 대조는 열린 티켓만 본다. 이미 끝낸 작업을 다른 제목으로 다시 만드는 것은 사람이 이 목록으로 가린다.
    // 확인 지문에는 넣지 않는다(시간이 지나면 바뀌는 목록이라 미리본 판본과 무관하게 확인이 어긋난다).
    const recentDone = await readRecentDoneDevTickets({provider, config})
    return {ok: true, mode: 'create', phase: 'CREATE_PREVIEW', externalWrites: 0, create: items, existing, recentDone, confirmWith: {flags: ['--confirm', '--digest', digest]}, ...seedNote,
      ...(flags.epic ? {epic: String(flags.epic)} : {}),
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
      const result = await provider.createIssue(provider.buildWorkFields({title: item.title, body: item.body, labels: item.labels, components: item.components,
        ...(flags.epic ? {epicKey: String(flags.epic)} : {})}))
      const ticketKey = keyOf(result)
      const seeded = await seedTicketAssessment({root, provider, ticketKey, draftAssessment: draftAssessments.byTitle.get(item.draftTitle), fallbackBody: item.body})
      created.push({title: item.title, ticketKey, url: result?.url ?? null, ...(seeded ? {assessmentSeeded: seeded.seeded, ...(seeded.reason ? {seedNote: seeded.reason} : {})} : {})})
    } catch (error) {
      return {ok: false, mode: 'create', phase: 'CREATE_PARTIAL', externalWrites: created.length, created, existing,
        failed: {title: item.title, reason: String(error?.message ?? error).slice(0, 200)},
        guidance: '일부만 만들었다. 다시 실행하면 이미 만든 것은 같은 제목으로 찾아 건너뛴다 — 응답만 끊긴 경우에도 두 번 만들지 않는다.'}
    }
  }
  return {ok: true, mode: 'create', phase: 'CREATED', externalWrites: created.length, created, existing,
    guidance: `개발 티켓 ${created.length}건을 만들었다. 다음은 티켓마다 pickup으로 판정·착수한다.`}
}
