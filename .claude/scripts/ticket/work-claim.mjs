// work-claim.mjs — `claim`: WORK 분해의 준비(P0)·검토(P1) 진입점.
//
// 사용자 진입점은 `/wh plan → team-flow claim → team-flow pickup` 그대로다. 이 CLI는 **의미를 이해하지
// 않는다** — 분석·계획은 `system-architect`가 쓰고(스킬이 조정), CLI는 준비도·참조·그래프를 검증하고
// 검토용 표를 만든다. work-plan 파일이 없어도 첫 호출이 진행된다: 무엇이 필요한지와 대상 FEAT 목록을
// 돌려준다(T57). **외부 쓰기는 하나도 하지 않는다** — 트래커·원장을 건드리지 않고, 로컬 판본 스냅샷과
// 생성된 검토표만 쓴다. `--confirm`이 와도 발행하지 않으며 FEAT 발행으로 되돌아가지 않는다(T61) —
// WORK 발행은 P2에서 연결된다.
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {createHash, randomUUID} from 'node:crypto'
import {join} from 'node:path'
import {canonicalDigest, safeRelativePath, validateWorkAnalysis, WORK_ANALYSIS_PATH} from './work-analysis.mjs'
import {computeWorkView, validateWorkPlan, WORK_PLAN_PATH} from './work-plan.mjs'
import {deferredTestCases} from './completion.mjs'
import {unitContentHash} from './emit.mjs'
import {loadPlanText, loadUnits} from './cli.mjs'
import {collectDesignBinding, DESIGN_BINDING_PATH} from '../design-binding-lib.mjs'
import {readProjectRegularFile} from '../safe-project-file-lib.mjs'
import {appendWorkEvent, foldWorkState, readWorkEvents, WORK_EVENTS_PATH} from './work-events.mjs'

export const WORK_REVIEW_PATH = '_workspace/03_dev/work-plan-review.md'
export const WORK_REVIEWED_POINTER = '_workspace/03_dev/work-plan-reviewed.json'
const REVISION_DIRS = {analysis: '_workspace/03_dev/work-analysis-revisions', plan: '_workspace/03_dev/work-plan-revisions'}
const SOURCE_INDEX = '_workspace/00_source/source-index.md'
const CONTRACT = '.claude/skills/team-flow/references/work-plan-contract.md'
const short = id => `W-${String(id).slice(5, 13)}`
const list = value => (Array.isArray(value) ? value : [])

const readJson = (root, relative) => {
  const path = join(root, relative)
  if (!existsSync(path)) return {present: false, value: null}
  try { return {present: true, value: JSON.parse(readFileSync(path, 'utf8'))} } catch (error) { return {present: true, error: `${relative}: ${error.message}`} }
}
// 분석·계획이 가리키는 파일은 **프로젝트 안의 일반 파일**만 읽는다 — symlink·루트 탈출은 없는 것으로 본다.
// 저장소가 공급한 링크(`00_source/x -> ~/.env`)로 호스트 파일의 해시가 공유 산출물에 실리지 않게 한다.
const readInside = (root, relative) => {
  if (!safeRelativePath(relative)) return null
  try { return readProjectRegularFile(root, relative, {maxBytes: 64 * 1024 * 1024}) } catch { return null }
}
const fileIo = root => ({
  exists: relative => readInside(root, relative) !== null,
  digestOf: relative => {
    const content = readInside(root, relative)
    return content === null ? null : createHash('sha256').update(content).digest('hex')
  },
})

/**
 * 검토 포인터: 직전 검토 판본의 digest, 그때의 입력 지문, 지금까지 검토한 작업 ID 계보, 아직 풀리지 않은
 * 입력 변경. 계보는 취소 뒤 배열에서 지우는 2단 삭제까지 잡으려는 것이다(판본 하나만 보면 놓친다).
 */
function readReviewed(root) {
  const pointer = readJson(root, WORK_REVIEWED_POINTER).value ?? {}
  const valid = typeof pointer.planDigest === 'string' && /^[0-9a-f]{64}$/.test(pointer.planDigest)
  return {planDigest: valid ? pointer.planDigest : null, inputs: pointer.inputs ?? {},
    knownWorkIds: new Set(list(pointer.knownWorkIds)), staleInputs: list(pointer.staleInputs)}
}

/**
 * 분석·계획이 가리키는 입력 파일(원문 스냅샷·코드 관찰·계약)의 **실제 지문**. 작성 에이전트는 해시를
 * 계산할 수 없으므로 CLI가 계산해 검토 판본에 남긴다. 다음 호출에서 달라진 입력을 알린다(T39).
 */
function inputFingerprints(io, analysis, plan) {
  const paths = new Set([
    ...list(analysis.sourceRefs).filter(ref => ref.accessState !== 'unreadable').map(ref => ref.snapshotRef),
    ...list(analysis.codeEvidence).map(item => item.path),
    ...list(plan.workItems).flatMap(work => list(work.contractRefs).map(ref => ref.path)),
  ].filter(path => safeRelativePath(path)))
  return Object.fromEntries([...paths].sort().map(path => [path, io.digestOf(path)]).filter(([, digest]) => digest))
}
const writeRevision = (root, kind, digest, value) => {
  mkdirSync(join(root, REVISION_DIRS[kind]), {recursive: true})
  const path = join(root, REVISION_DIRS[kind], `${digest}.json`)
  if (!existsSync(path)) writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
  return `${REVISION_DIRS[kind]}/${digest}.json`
}

/**
 * @param {{root: string, flags: object}} args  flags.features: 범위 FEAT 목록(쉼표) — 없으면 계획의 FEAT 전체
 */
export async function runClaimWork({root, flags = {}}) {
  const units = loadUnits(root, flags)
  const planText = loadPlanText(root, flags)
  const seen = new Set()
  const duplicates = units.map(unit => unit.featureId).filter(id => (seen.has(id) ? true : (seen.add(id), false)))
  if (duplicates.length > 0) return {ok: false, mode: 'work', phase: 'PLAN_DEFECT', errors: [`계획에 같은 FEAT가 둘 이상 있다: ${[...new Set(duplicates)].join(', ')}`]}
  const requested = flags.features ? String(flags.features).split(',').map(value => value.trim()).filter(Boolean) : null
  const unknown = (requested ?? []).filter(id => !seen.has(id))
  if (unknown.length > 0) return {ok: false, mode: 'work', phase: 'SCOPE_UNKNOWN', errors: [`계획에 없는 FEAT를 범위로 지정했다: ${unknown.join(', ')}`]}
  const scopeIds = requested ?? units.map(unit => unit.featureId)
  const deferredTcs = deferredTestCases(planText)
  const inventory = scopeIds.map(id => {
    const unit = units.find(item => item.featureId === id)
    // sourceDigest는 CLI가 계산해 알려 준다 — 작성 에이전트는 해시를 계산할 수단이 없고, 계산하지 않은 값은 위조다.
    return {featureId: id, title: unit.title, sourceDigest: unitContentHash(unit), testCases: list(unit.testCaseIds).length,
      deferredTestCases: list(unit.testCaseIds).filter(tc => deferredTcs.has(tc))}
  })
  const design = collectDesignBinding(root)
  const base = {
    mode: 'work', externalWrites: 0,
    scope: {featureIds: scopeIds, selectedBy: requested ? 'explicit' : 'whole-plan'},
    inventory,
    inputs: {sourceIndex: existsSync(join(root, SOURCE_INDEX)) ? SOURCE_INDEX : null,
      designBinding: design.present ? {path: DESIGN_BINDING_PATH, errors: design.errors} : null},
  }
  // 이 흐름은 발행하지 않는다 — 확인 플래그가 와도 FEAT 발행으로 되돌아가지 않는다(T61).
  // 발행은 별도 입구(`--work --publish`)이고, 그 입구의 미리보기가 `--confirm`의 대상이다.
  const publishNote = {available: false, reason: 'WORK 발행은 `claim --publish`다 — 이 흐름은 준비·검토까지다'}
  if (flags.confirm) return {...base, ok: false, phase: 'PUBLISH_NOT_AVAILABLE', publish: publishNote,
    guidance: '검토한 계획을 발행하려면 `claim --publish`로 미리보기를 보고, 같은 요청에 --confirm을 붙인다'}

  const analysisFile = readJson(root, WORK_ANALYSIS_PATH)
  if (analysisFile.error) return {...base, ok: false, phase: 'P0_ANALYSIS_INVALID', errors: [analysisFile.error]}
  if (!analysisFile.present) {
    return {...base, ok: true, phase: 'P0_ANALYSIS_REQUIRED', publish: publishNote,
      next: {author: 'system-architect', writes: WORK_ANALYSIS_PATH, contract: CONTRACT,
        reads: ['_workspace/01_plan/feature-plan.md', SOURCE_INDEX, DESIGN_BINDING_PATH, '_workspace/02_design/']},
      guidance: '선행 분석이 없다 — system-architect가 범위 FEAT 전체·개발 설계 원문·현재 코드·디자인 연결을 대조해 분석을 쓴다. 쓴 뒤 다시 `claim`을 부른다'}
  }
  const io = fileIo(root)
  const analysis = analysisFile.value
  const analysisResult = validateWorkAnalysis(analysis, {scopeFeatureIds: scopeIds, io})
  const analysisDigest = canonicalDigest(analysis)
  if (analysisResult.errors.length > 0) {
    return {...base, ok: false, phase: 'P0_ANALYSIS_INVALID', errors: analysisResult.errors, warnings: analysisResult.warnings}
  }
  const planFile = readJson(root, WORK_PLAN_PATH)
  if (planFile.error) return {...base, ok: false, phase: 'P1_PLAN_INVALID', errors: [planFile.error]}
  if (!planFile.present) {
    return {...base, ok: true, phase: 'P1_PLAN_REQUIRED', publish: publishNote, warnings: analysisResult.warnings,
      scopeBlocked: analysisResult.scopeBlocked, analysis: {path: WORK_ANALYSIS_PATH, digest: analysisDigest},
      next: {author: 'system-architect', writes: WORK_PLAN_PATH, contract: CONTRACT, analysisRef: {path: WORK_ANALYSIS_PATH, digest: analysisDigest}},
      guidance: '분석은 유효하다 — system-architect가 이 분석을 근거로 WORK 계획을 쓴다(analysisRef.digest에 위 값을 적는다)'}
  }
  const plan = planFile.value
  const designBindingDigest = design.present && design.document ? canonicalDigest(design.document) : null
  const reviewed = readReviewed(root)
  // 계보는 이벤트 원장(append-only)과 포인터를 합쳐 본다 — 포인터는 지울 수 있고 원장은 덜 지워진다.
  const events = readWorkEvents(join(root, WORK_EVENTS_PATH))
  const folded = foldWorkState(events)
  const knownWorkIds = new Set([...reviewed.knownWorkIds, ...folded.knownWorkIds])
  const planResult = validateWorkPlan(plan, {analysis, analysisIds: analysisResult.ids, units, deferredTcs,
    unitDigest: unitContentHash, designBinding: design.present ? design.document : null, designBindingDigest,
    knownWorkIds, io})
  const inputs = inputFingerprints(io, analysis, plan)
  const changedInputs = Object.keys(reviewed.inputs).filter(path => reviewed.inputs[path] !== (inputs[path] ?? null))
  const planDigestNow = canonicalDigest(plan)
  // 바뀐 입력은 **계획이 다시 검토될 때까지** 남는다 — 한 번 알리고 포인터를 덮어쓰면 다음 호출은 깨끗해 보인다.
  // 계획이 바뀌었다(= 작성자가 반영했다)면 그때 비운다.
  const staleInputs = [...new Set([...(reviewed.planDigest === planDigestNow ? reviewed.staleInputs : []), ...changedInputs])].sort()
  const warnings = [...analysisResult.warnings, ...planResult.warnings,
    ...(staleInputs.length > 0 ? [`검토 뒤 입력이 바뀌었다: ${staleInputs.join(', ')} — 연결된 판정·WORK를 재검토하고 계획에 반영한다(stale). WORK ID는 유지한다`] : [])]
  if (planResult.errors.length > 0) return {...base, ok: false, phase: 'P1_PLAN_INVALID', errors: planResult.errors, warnings}

  const view = computeWorkView(plan, analysis)
  const planDigest = planDigestNow
  const revisions = {analysis: writeRevision(root, 'analysis', analysisDigest, analysis), plan: writeRevision(root, 'plan', planDigest, plan)}
  mkdirSync(join(root, '_workspace/03_dev'), {recursive: true})
  writeFileSync(join(root, WORK_REVIEW_PATH), renderWorkReview({inventory, analysis, analysisResult, plan, planResult, view, units, analysisDigest, planDigest, staleInputs}))
  const workIds = [...new Set([...knownWorkIds, ...list(plan.workItems).map(item => item.workId)])].sort()
  const reviewedAt = new Date().toISOString()
  // 검토 사실을 이벤트로 남긴다 — 발행(P2-c)·픽업이 「어느 판본을 검토했는가」를 같은 축에서 읽는다.
  // **같은 판본을 다시 검토하면 쓰지 않는다** — 재실행마다 붙이면 원장이 상한까지 자라 claim이 영원히 막힌다.
  const unchanged = folded.lastReviewed?.planId === plan.planId
    && folded.lastReviewed.planDigest === planDigest && folded.lastReviewed.analysisDigest === analysisDigest
  if (!unchanged) {
    appendWorkEvent(join(root, WORK_EVENTS_PATH), {
      schemaVersion: 1, eventId: randomUUID(), planId: plan.planId,
      eventType: 'plan-reviewed', at: reviewedAt, planDigest,
      payload: {analysisDigest, workIds},
    })
  }
  writeFileSync(join(root, WORK_REVIEWED_POINTER), `${JSON.stringify({planDigest, analysisDigest, reviewedAt, inputs, knownWorkIds: workIds, staleInputs}, null, 2)}\n`)
  return {...base, ok: true, phase: 'P1_REVIEW', publish: publishNote, warnings,
    confirmable: analysisResult.scopeBlocked.length === 0, scopeBlocked: analysisResult.scopeBlocked,
    digests: {analysis: analysisDigest, plan: planDigest}, revisions, review: WORK_REVIEW_PATH, changedInputs, staleInputs,
    events: WORK_EVENTS_PATH,
    view: view.rows.map(row => ({...row, label: short(row.workId)})), ready: view.ready}
}

const cell = value => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')

/** 사람용 검토표(생성물). 정본은 분석·계획 JSON이며 이 파일을 되읽지 않는다. */
export function renderWorkReview({inventory, analysis, analysisResult, plan, planResult, view, analysisDigest, planDigest, staleInputs = []}) {
  const dispositions = analysisResult.ids.dispositions
  const findings = new Map(list(analysis.findings).map(item => [item.id, item]))
  const priorities = new Map(list(analysis.priorityInputs).map(item => [item.id, item]))
  const works = new Map(list(plan.workItems).map(work => [work.workId, work]))
  const ownerTcs = new Map()
  for (const [tc, workId] of planResult.tcOwnerOf) ownerTcs.set(workId, [...(ownerTcs.get(workId) ?? []), tc])
  const label = id => `${short(id)} ${works.get(id)?.title ?? ''}`.trim()
  const lines = [
    '# WORK 분해 검토',
    '',
    `> 생성물 — 정본은 \`${WORK_PLAN_PATH}\`·\`${WORK_ANALYSIS_PATH}\`. 이 파일을 고쳐도 계획은 바뀌지 않는다.`,
    `> 분석 ${analysisDigest.slice(0, 12)} · 계획 ${planDigest.slice(0, 12)} · 기준 커밋 ${cell(plan.sourceRevision)}`,
    '> 발행은 아직 없다(외부 쓰기 0). 의존은 제약이고 우선순위는 착수 가능한 작업 안의 순서다.',
    '',
    '## 대상 FEAT — 분모를 줄이지 않는다',
    '',
    '| FEAT | 제목 | 상태 | 사유 | TC(유예) | WORK |',
    '|---|---|---|---|---|---|',
    ...inventory.map(item => {
      const entry = dispositions.get(item.featureId)
      const status = entry?.status === 'deferred' ? `deferred(${entry.deferral})` : entry?.status ?? '?'
      const count = [...planResult.featureOfWork.values()].filter(set => set.has(item.featureId)).length
      return `| ${item.featureId} | ${cell(item.title)} | ${status} | ${cell(entry?.reasonRef ?? '')} | ${item.testCases}(${item.deferredTestCases.length}) | ${count} |`
    }),
    '',
    '## WORK',
    '',
    '| 순서 | 실행 상태 | WORK | 종류 | FEAT · 최종 책임 TC | 선행 | 여는 후속 | 우선순위 근거 | 분석 근거 | 디자인 | 미결 |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...view.rows.slice().sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.workId.localeCompare(b.workId)).map(row => {
      const work = works.get(row.workId)
      const features = [...(planResult.featureOfWork.get(row.workId) ?? [])].join(', ')
      const tcs = (ownerTcs.get(row.workId) ?? []).join(', ')
      const priority = row.priorityRefs.map(ref => priorities.get(ref)?.preference ?? ref).join('; ') + (row.rankInheritedFrom ? ` (${short(row.rankInheritedFrom)}에서 승계)` : '')
      const basis = list(work.basisRefs).map(ref => findings.get(ref) ? `${ref}:${findings.get(ref).disposition}` : ref).join(', ')
      const status = {ready: '지금 가능', 'waiting-deps': '선행 대기', 'blocked-decision': '결정 대기'}[row.status]
      return `| ${row.order ?? '—'} | ${status} | ${cell(label(row.workId))} | ${work.kind} | ${cell(features)}${tcs ? ` · ${cell(tcs)}` : ''} | ${cell(row.waiting.map(short).join(', ') || '없음')} | ${row.unlocks} | ${cell(priority || '—')} | ${cell(basis)} | ${work.designContext?.applicability ?? '?'} | ${cell(row.blockers.join(', ') || '—')} |`
    }),
    '',
    '## 취소·대체된 작업 — 지우지 않고 남긴다',
    '',
    ...(list(plan.workItems).filter(item => (item.lifecycle ?? 'active') !== 'active').length === 0 ? ['없음']
      : list(plan.workItems).filter(item => (item.lifecycle ?? 'active') !== 'active')
        .map(item => `- ${cell(label(item.workId))} — ${item.lifecycle}${list(item.supersededBy).length ? ` → ${list(item.supersededBy).map(short).join(', ')}` : ''}`)),
    '',
    '## 검토 뒤 바뀐 입력',
    '',
    ...(staleInputs.length === 0 ? ['없음'] : staleInputs.map(path => `- \`${path}\` — 연결된 판정·WORK를 재검토하고 계획에 반영한다`)),
    '',
    '## 재사용·신규 판정',
    '',
    '| 판정 | 능력 | 결과 | 부족한 것 | 근거 |',
    '|---|---|---|---|---|',
    ...list(analysis.findings).map(item => `| ${item.id} | ${cell(item.capability)} | ${item.disposition} | ${cell(item.gap ?? '—')} | ${cell(list(item.evidenceRefs).join(', '))} |`),
    '',
    '## 미결',
    '',
    ...(list(analysis.unresolved).length === 0 ? ['없음'] : list(analysis.unresolved).map(item => `- **${item.id}** ${cell(item.topic)} — 답할 역할: ${cell(item.ownerRole)} · 막는 이유: ${cell(item.blockingReason)}`)),
    '',
    '## 조사 한계 · 읽지 못한 자료',
    '',
    ...[...list(analysis.scanCoverage?.incompleteReasons).map(reason => `- 조사 절단: ${cell(reason)}`),
      ...list(analysis.sourceRefs).filter(ref => ref.accessState !== 'read').map(ref => `- ${ref.id}: ${ref.accessState} — ${cell(ref.note ?? ref.locator ?? '')}`),
      ...analysisResult.scopeBlocked.map(reason => `- 범위: ${cell(reason)}`)],
    ...(list(analysis.scanCoverage?.incompleteReasons).length + list(analysis.sourceRefs).filter(ref => ref.accessState !== 'read').length + analysisResult.scopeBlocked.length === 0 ? ['없음'] : []),
    '',
  ]
  return `${lines.join('\n')}\n`
}
