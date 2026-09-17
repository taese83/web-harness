// ticket-work-run.mjs — 사람이 만든 개발 티켓의 픽업 실행부. `pickup`이 부른다(입구는 하나다).
//
// 순서: 개발 티켓인가(팀이 선언한 분류) → 계획 WORK가 아닌가 → 인젝션 스캔(fail-closed) → 판정서가 있는가 → CLI 검증 → 착수 불가면 기록·요청 코멘트 →
// 착수 가능이면 **미리보기**(외부 쓰기 0) → 개발자가 판정서 지문으로 확인 → 티켓 완성(원문 보존) · 역할 라벨 ·
// 원장 등록 · AI 맥락 첨부 → 기존 WORK 픽업으로 이어진다. 확인 전에는 트래커에 쓰지 않는다.
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {canonicalDigest} from './work-analysis.mjs'
import {appendWorkEvent, WORK_EVENTS_PATH} from './work-events.mjs'
import {buildWorkMarker, classifyTicketKind, normalizeDocBody, parseWorkMarker, stripWorkMarker} from './work-refs.mjs'
import {quarantineExcerpt, scanUntrustedIssue} from './pickup.mjs'
import {classifyByComponent, DEV_TICKET} from './intake.mjs'
import {computeAssignmentPlan} from './assign.mjs'
import {compareWorkDoc, normalizeDocItem, parseWorkDocSections, renderWorkContext, workContextName} from './work-ticket-doc.mjs'
import {resolveCommentLanguage} from './readiness.mjs'
import {readDeclaredLanguage} from './ticket-config.mjs'
import {assessmentDigest, assessmentPath, assessmentSnapshotPath, originalBodyOf, renderTicketWorkBody, ticketPlanId, ticketVirtualPlan,
  ticketWorkDefinition, ticketWorkId, validateTicketAssessment} from './ticket-work.mjs'

const list = value => (Array.isArray(value) ? value : [])
const readJson = (root, relative) => {
  const path = join(root, relative)
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}
const keyOf = issue => issue?.ticketKey ?? issue?.key ?? (issue?.number != null ? String(issue.number) : null)

/** 팀이 선언한 분류로 개발 티켓인가(순수) — Jira 컴포넌트 축, GitHub 라벨 축. 선언이 없으면 판단하지 않는다. */
export function isDevTicket(issue, config) {
  const byComponent = classifyByComponent(issue?.components ?? [], config?.jira?.componentAxis ?? config?.componentAxis ?? null)
  if (byComponent?.role === DEV_TICKET) return {dev: true, by: byComponent.by}
  const byLabel = classifyByComponent(issue?.labels ?? [], config?.github?.labelAxis ?? config?.labelAxis ?? null)
  if (byLabel?.role === DEV_TICKET) return {dev: true, by: byLabel.by.replace(/^component:/, 'label:')}
  return {dev: false}
}

/** 개발 티켓 분류가 선언돼 있는가(순수) — 없으면 사람 티켓 경로를 쓸 수 없다. */
export function hasDevTicketAxis(config) {
  const axes = [config?.jira?.componentAxis, config?.componentAxis, config?.github?.labelAxis, config?.labelAxis]
  return axes.some(axis => axis && typeof axis === 'object' && Object.values(axis).includes(DEV_TICKET))
}

/** 티켓 작업의 픽업 문맥(순수) — 계획 WORK 픽업과 같은 코드가 탄다. */
export function ticketPickupContext(registered) {
  const definition = registered.definition
  return {plan: ticketVirtualPlan(definition, registered.planId), planDigest: registered.planDigest, view: null,
    testCaseTexts: new Map(list(definition.testCases).map(item => [item.id, item.text]))}
}

/** 수정 범위가 겹치는지 볼 진행 중 작업(순수) — 발행·등록됐고 머지로 끝나지 않은 계획·티켓 작업. */
export function activeWorksFrom({plan, state, exceptWorkId}) {
  const planWorks = new Map(list(plan?.workItems).map(work => [work.workId, work]))
  return [...(state?.works?.entries() ?? [])]
    .filter(([workId, item]) => workId !== exceptWorkId && item.status === 'published' && !item.completed && !item.withdrawn)
    .map(([workId, item]) => ({workId, writePaths: list(item.origin === 'ticket' ? item.definition?.writePaths : planWorks.get(workId)?.writePaths)}))
    .filter(work => work.writePaths.length > 0)
}

/**
 * @returns {Promise<{result?: object, context?: object, issue?: object, extra?: object}>}
 *   result: 여기서 끝났다(판정 요구·검증 실패·착수 불가·미리보기·쓰기 실패) · context: 계획 WORK 픽업으로 이어간다 · 둘 다 없으면 이 경로가 아니다
 */
export async function resolveTicketPickup({root, ticketKey, developer, issue, state, plan, flags = {}, io = {}}) {
  const provider = io.provider
  const config = io.ticketConfig ?? {}
  const providerName = provider?.name
  const works = [...(state?.works?.entries() ?? [])]
  const registeredEntry = works.find(([, item]) => item.origin === 'ticket' && String(item.ticketKey) === String(ticketKey))
  const kind = classifyTicketKind(issue?.body ?? '')
  const marker = kind.kind === 'work' ? parseWorkMarker(issue.body) : null
  const registered = registeredEntry?.[1] ?? null
  if (!registered && marker?.workId && state?.works?.get(marker.workId)?.origin !== 'ticket') return {} // 계획 WORK다
  const dev = isDevTicket(issue, config)
  if (!registered && !dev.dev) return {}
  // **하네스가 만든 다른 모델의 티켓**(집계·공급 원문·옛 FEAT·마커 충돌)은 개발 분류가 붙어도 판정하지 않는다 —
  // 흘려보내면 집계 본문이 WORK로 덮이고 다음 발행이 다시 덮는다(intake가 같은 경우를 막는 것과 같은 축).
  const foreignKind = kind.error ? kind.kind : ['aggregate', 'source', 'legacy', 'conflict'].includes(kind.kind) ? kind.kind : null
  const aggregateKey = [...(state?.aggregates?.values() ?? [])].some(item => item.ticketKey && String(item.ticketKey) === String(ticketKey))
  if (!registered && (foreignKind || aggregateKey)) {
    return {result: {ok: false, mode: 'work', phase: 'TICKET_NOT_DEV_WORK', ticketKey, externalWrites: 0,
      bounce: {reason: `${foreignKind ?? 'aggregate'}-ticket-not-dev`, ...(kind.error ? {detail: kind.error} : {})}}}
  }
  // **마커를 못 읽은 계획 WORK**(속성 읽기 실패·사람이 지운 마커)에 개발 분류가 붙어 있어도 사람 티켓으로 다시 등록하지 않는다 —
  // 원장은 이 키를 계획 작업으로 발행했다고 안다. 여기서 흘려보내면 계획 WORK 본문이 판정서로 덮인다.
  const planWork = works.find(([, item]) => item.status === 'published' && item.origin !== 'ticket' && String(item.ticketKey) === String(ticketKey))
  if (planWork) {
    return {result: {ok: false, mode: 'work', phase: 'TICKET_IS_PLAN_WORK', ticketKey, externalWrites: 0,
      bounce: {reason: 'work-marker-missing', workId: planWork[0], ticketKey: String(ticketKey)}}}
  }
  // **비신뢰 원문 스캔이 먼저다** — 판정 요청 스냅샷·미리보기·트래커 쓰기·원장 기록 모두 이 뒤에 온다(fail-closed).
  const injection = scanUntrustedIssue(issue)
  if (injection.injectionSuspect) {
    return {result: {ok: false, mode: 'work', phase: 'TICKET_INJECTION_SUSPECT', ticketKey, externalWrites: 0, injection,
      bounce: {reason: 'injection-suspect', markers: injection.markers, sources: injection.sources}}}
  }

  const path = assessmentPath(ticketKey)
  let assessment = null
  try { assessment = readJson(root, path) } catch (error) {
    // 등록된 작업은 판정서 없이도 이어간다 — 파손된 판정서 파일이 확인된 작업의 픽업까지 막지 않는다.
    if (registered && !registered.withdrawn) return {context: ticketPickupContext(registered), extra: {ticketWork: {note: `판정서를 읽지 못해 등록된 판정으로 이어간다: ${String(error?.message ?? error).slice(0, 120)}`}}}
    return {result: {ok: false, mode: 'work', phase: 'TICKET_ASSESSMENT_INVALID', ticketKey, path, errors: [`판정서를 읽지 못했다: ${String(error?.message ?? error).slice(0, 160)}`]}}
  }
  // 등록된 작업이고 판정서가 그대로면(또는 없으면) 계획 WORK처럼 이어서 픽업한다. 판정으로 거둔 작업은 다시 판정을 탄다.
  if (registered && !registered.withdrawn && (!assessment || assessmentDigest(assessment) === registered.planDigest)) {
    return {context: ticketPickupContext(registered)}
  }
  if (!assessment) {
    // 판정할 에이전트에게 원문을 **격리 스냅샷**으로 준다 — 트래커 본문을 지시로 읽지 않게(에이전트가 쓸 수 없는 자리).
    const snapshot = assessmentSnapshotPath(ticketKey)
    if (!flags['dry-run']) {
      mkdirSync(dirname(join(root, snapshot)), {recursive: true})
      writeFileSync(join(root, snapshot), `${quarantineExcerpt({...issue, body: stripWorkMarker(issue?.body ?? '')})}\n`)
    }
    return {result: {ok: false, mode: 'work', phase: 'TICKET_ASSESSMENT_REQUIRED', ticketKey, externalWrites: 0,
      bounce: {reason: 'ticket-assessment-required', by: registered?.withdrawn ? 'withdrawn' : dev.by},
      next: {agent: 'system-architect', mode: 'ticket-assessment', writes: path,
        contract: '.claude/skills/team-flow/references/ticket-work-contract.md',
        reads: [flags['dry-run'] ? '(dry-run — 격리 스냅샷을 쓰지 않았다)' : snapshot, '_workspace/03_dev/spec.json', '현재 코드', '_workspace/03_dev/work-plan.json(있으면)']},
      guidance: `사람이 만든 개발 티켓입니다(${dev.by ?? '등록된 티켓 작업'}). 기획이나 디자인이 더 필요한지 먼저 판정합니다. system-architect가 ${path}를 쓴 뒤 다시 pickup을 부르세요.`}}
  }

  const workId = ticketWorkId(providerName, ticketKey)
  const planWorkIds = list(plan?.workItems).map(work => work.workId)
  const ticketIds = works.filter(([, item]) => item.origin === 'ticket').map(([id]) => id)
  const originalBody = originalBodyOf(issue?.body ?? '', {completed: Boolean(registered) || kind.kind === 'work'})
  const spec = (() => { try { return readJson(root, '_workspace/03_dev/spec.json') } catch { return null } })()
  const checked = validateTicketAssessment({assessment, ticketKey, provider: providerName, originalBody, spec,
    activeWorks: activeWorksFrom({plan, state, exceptWorkId: workId}), knownWorkIds: new Set([...planWorkIds, ...ticketIds])})
  if (!checked.ok) return {result: {ok: false, mode: 'work', phase: 'TICKET_ASSESSMENT_INVALID', ticketKey, path, errors: checked.errors}}
  // 격리 사본은 판정 한 번을 위한 것이다 — 판정서가 검증을 통과하면 지운다(실패하면 다시 판정해야 하므로 남긴다).
  if (!flags['dry-run']) rmSync(join(root, assessmentSnapshotPath(ticketKey)), {force: true})
  const digest = checked.digest
  // 겹침은 판정보다 먼저 본다 — 착수할 수 없는 판정을 「착수 가능」으로 원장에 남기지 않는다.
  if (assessment.verdict === 'startable' && checked.bounce) {
    return {result: {ok: false, mode: 'work', phase: 'TICKET_NOT_STARTABLE', ticketKey, externalWrites: 0, bounce: checked.bounce}}
  }
  const record = event => appendWorkEvent(join(root, WORK_EVENTS_PATH),
    {schemaVersion: 1, eventId: randomUUID(), planId: ticketPlanId(providerName, ticketKey), workId, at: new Date().toISOString(), ...event})
  // 판정은 원장에 남긴다(같은 판정서면 다시 쓰지 않는다) — 보드가 「판정 전·착수 가능·필요」를 이것으로 그린다.
  const needs = assessment.verdict === 'needs-planning' ? list(assessment.planningNeeds)
    : assessment.verdict === 'needs-design' ? list(assessment.designNeeds) : list(assessment.reasons).map(reason => ({what: reason, why: ''}))
  const newJudgment = state?.tickets?.get(String(ticketKey))?.assessmentDigest !== digest
  if (!flags['dry-run'] && newJudgment) {
    record({eventType: 'ticket-assessed', payload: {ticketKey: String(ticketKey), verdict: assessment.verdict, assessmentDigest: digest,
      ...(assessment.verdict === 'startable' ? {} : {needs: needs.map(item => ({what: item.what, why: item.why ?? ''}))})}})
  }
  if (assessment.verdict !== 'startable') {
    // 착수 불가 — 무엇이 왜 필요한지를 티켓에 남긴다(개발자 터미널에서 끝나면 기획·디자인하는 사람이 모른다).
    // **새 판정일 때만** 단다 — 같은 판정서로 pickup을 다시 부를 때마다 같은 코멘트가 쌓이지 않게.
    // 등록된 작업이면 원장이 그 작업을 거둔다(수정 범위를 놓는다) — 링크는 `work-cancelled`로 막는다.
    return {result: {ok: false, mode: 'work', phase: 'TICKET_NOT_STARTABLE', ticketKey, verdict: assessment.verdict, assessmentDigest: digest,
      bounce: {reason: `ticket-${assessment.verdict}`, workId,
        // 티켓 코멘트는 `needs`를 번호 목록으로 적는다. `missing`은 한 줄 요약으로 남긴다(옛 소비자 호환).
        needs: needs.map(item => ({what: item.what, why: item.why ?? ''})),
        missing: needs.map(item => (item.why ? `${item.what} — ${item.why}` : item.what))},
      guidance: '정해야 할 것을 이 티켓에 적은 뒤 다시 pickup을 부르면 새 내용으로 다시 판정합니다. 같은 내용을 다시 부르면 판정 결과만 보여 줍니다.',
      ...(registered ? {withdrawn: !flags['dry-run']} : {}),
      notify: newJudgment, ...(newJudgment ? {} : {notified: {done: false, reason: 'same-assessment-already-notified'}})}}
  }

  // ── 보강안(외부 쓰기 전) ──
  const definition = ticketWorkDefinition({assessment, ticketKey, provider: providerName, title: issue?.title})
  const lang = resolveCommentLanguage({declared: readDeclaredLanguage(root), text: definition.title})
  const keys = new Map(works.filter(([, item]) => item.status === 'published').map(([id, item]) => [id, item.ticketKey]))
  const dependsOn = definition.dependsOn.map(dep => ({workId: dep, ticketKey: keys.get(dep) ?? null,
    title: list(plan?.workItems).find(work => work.workId === dep)?.title ?? state?.works?.get(dep)?.definition?.title ?? null}))
  const contextName = workContextName(workId)
  const format = provider?.docFormat ?? 'markdown'
  const body = renderTicketWorkBody({definition, originalBody, format, lang, contextName, dependsOn})
  // **재등록은 본문을 새 판정서로 다시 쓴다** — 사람이 더한 항목이 새 판정서에 없으면 멈춘다(덮어써 잃지 않는다).
  // 표지만 옮기면 본문은 옛 정의로 남아 픽업이 영원히 「계획과 다르다」로 막힌다.
  let carriedAdditions = 0
  if (registered) {
    const edits = compareWorkDoc({body: issue?.body ?? '', work: registered.definition, testCases: list(registered.definition?.testCases), lang})
    const sections = parseWorkDocSections(body)
    // 테스트 항목은 `TT-… 문장`으로 렌더된다 — 사람이 더한 줄은 ID 없이 대조한다.
    const kept = new Set([...list(sections.acceptance), ...list(sections.tests), ...list(sections.tests).map(text => text.replace(/^TT-\S+\s+/, ''))].map(normalizeDocItem))
    const dropped = edits.additions.filter(item => !kept.has(normalizeDocItem(item.text)))
    if (dropped.length > 0) {
      return {result: {ok: false, mode: 'work', phase: 'TICKET_EDITS_NOT_IN_ASSESSMENT', ticketKey, externalWrites: 0,
        bounce: {reason: 'ticket-edits-not-in-assessment', workId, missing: dropped.map(item => item.text)},
        guidance: '누군가 티켓에 더한 항목이 새 판정서에 없습니다. 티켓 내용을 다시 쓰면 그 항목이 사라지니, 판정서에 옮긴 뒤 다시 확인하세요.'}}
    }
    carriedAdditions = edits.additions.length
  }
  const planId = ticketPlanId(providerName, ticketKey)
  const markerText = buildWorkMarker({planId, workId, featureIds: [], testCaseIds: definition.testCases.map(item => item.id), planDigest: digest})
  const labelsToAdd = definition.roles.filter(role => !list(issue?.labels).includes(role))
  // 미리보기에는 **비신뢰 원문을 싣지 않는다** — 쓸 때 그대로 보존한다는 사실과 크기만 적는다.
  const withheld = lang === 'en' ? `(original description preserved verbatim on write — ${originalBody.length} chars, not shown: untrusted)`
    : `(원문 ${originalBody.length}자를 쓸 때 그대로 보존한다 — 비신뢰 원문이라 미리보기에 싣지 않는다)`
  const preview = {mode: 'work', ticketKey, workId, lane: assessment.lane, assessmentDigest: digest, writePaths: definition.writePaths,
    acceptance: assessment.acceptance, testItems: assessment.testItems, labels: {add: labelsToAdd},
    body: renderTicketWorkBody({definition, originalBody: withheld, format, lang, contextName, dependsOn}),
    reregister: Boolean(registered), ...(registered ? {carriedAdditions} : {}), externalWrites: 0}
  if (!flags.assessment || flags['dry-run']) {
    return {result: {...preview, ok: true, phase: 'TICKET_WORK_PREVIEW',
      guidance: `이대로 진행하려면 --assessment ${digest}를 붙여 다시 부르세요. 확인 전에는 티켓을 고치지 않습니다.`
        + (assessment.lane === 'change' ? ' 새 동작을 더하는 작업이라, 구현 전에 /wh change로 스팩 승인을 받습니다.' : '')}}
  }
  if (String(flags.assessment) !== digest) {
    return {result: {ok: false, mode: 'work', phase: 'TICKET_ASSESSMENT_MISMATCH', ticketKey, expected: digest,
      guidance: '확인한 판정서가 지금 판정서와 다릅니다. 미리보기를 다시 보고 확인하세요.'}}
  }
  const missing = ['updateBody', 'updateLabels', 'attachContext'].filter(name => typeof provider?.[name] !== 'function')
  if (missing.length > 0) return {result: {ok: false, mode: 'work', phase: 'PROVIDER_NOT_READY', missing: missing.map(name => `provider.${name}`)}}
  // 남이 잡고 있으면 티켓을 고치지 않는다 — 착수할 수 없는 사람이 남의 티켓 모양을 바꾸면 안 된다.
  if (computeAssignmentPlan({issue, developer}).status === 'taken') {
    return {result: {ok: false, mode: 'work', bounce: {reason: 'assigned-to-other', by: issue.assignees?.[0] ?? null}}}
  }

  // ── 티켓 완성 → 등록 → 첨부 ──
  let externalWrites = 0
  const docDigest = canonicalDigest(normalizeDocBody(body))
  try {
    externalWrites += 1
    await provider.updateBody(ticketKey, body, {marker: markerText})
    if (labelsToAdd.length > 0) { externalWrites += 1; await provider.updateLabels(ticketKey, {add: labelsToAdd, remove: []}) }
  } catch (error) {
    return {result: {ok: false, mode: 'work', phase: 'TICKET_WORK_WRITE_FAILED', ticketKey, externalWrites,
      guidance: `티켓을 고치지 못했습니다. 등록도 하지 않았으니 다시 부르면 같은 작업으로 재시도합니다: ${String(error?.message ?? error).slice(0, 160)}`}}
  }
  try {
    record({eventType: 'ticket-work-registered', operationId: randomUUID(), planDigest: digest,
      payload: {ticketKey: String(ticketKey), provider: providerName, assessmentDigest: digest, definition, labels: definition.roles, docDigest}})
  } catch (error) {
    return {result: {ok: false, mode: 'work', phase: 'TICKET_WORK_WRITE_FAILED', ticketKey, externalWrites,
      guidance: `티켓은 고쳤지만 기록에 남기지 못했습니다. 기록 파일을 고친 뒤 다시 부르세요: ${String(error?.message ?? error).slice(0, 160)}`}}
  }
  let contextNote = null
  try {
    externalWrites += 1
    const content = renderWorkContext({work: definition, plan: {planId}, planDigest: digest, featureIds: [], testCases: definition.testCases, dependsOn})
    const attached = await provider.attachContext(ticketKey, {name: contextName, content, previous: registered?.context?.ref ?? null})
    record({eventType: 'context-attached', operationId: randomUUID(), planDigest: digest,
      payload: {ticketKey: String(ticketKey), ref: attached.ref, contentDigest: canonicalDigest(content), name: contextName}})
  } catch (error) { contextNote = `AI 맥락 첨부 실패 — 등록은 됐다: ${String(error?.message ?? error).slice(0, 120)}` }

  const fresh = await (io.resolveIssue ? io.resolveIssue({number: ticketKey}) : provider.resolveIssue(ticketKey))
  const registeredNow = {planId, planDigest: digest, definition}
  return {context: ticketPickupContext(registeredNow), issue: fresh,
    extra: {ticketWork: {registered: true, reregistered: Boolean(registered), workId, assessmentDigest: digest, lane: assessment.lane,
      externalWrites, ...(registered ? {carriedAdditions} : {}), ...(contextNote ? {note: contextNote} : {})}}}
}

export {keyOf}
