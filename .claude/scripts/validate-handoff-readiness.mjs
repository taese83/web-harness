#!/usr/bin/env node
// validate-handoff-readiness.mjs — 단계 인계 판정: **다음 단계가 이 문서만으로 질문 없이
// 진행 가능한가.**
//
// 왜 이것이 승인 기준이어야 하나(2026-08-30): 상류 승인은 "화면·기능 목록을 보여주고
// 확인받는다"였다. 사람이 보기에 충분한 문서면 통과한다. 그런데 개발은 사람이 아니라
// **기계가 읽는다.** 오늘 개발 중에 터진 구멍이 전부 그 간극이었다 — 정보는 있었는데
// 산문이거나 기계가 안 보는 자리에 있었다:
//
//   병렬 작업 순서    data-model.md 산문 한 줄     → 보드가 못 읽어 11건이 착수 가능으로 보임
//   FEAT별 쓰기 경로   어디에도 없음                 → 충돌 검사가 통째로 미수행
//   캔버스 5중 공유    solution-design 산문 경고     → 기계가 못 봄
//   확정 라이브러리    스팩엔 있고 매니페스트엔 없음  → 쓰는 첫 티켓에서 터짐
//
// 그래서 판정 기준을 바꾼다: **다음 단계의 기계가 필요로 하는 입력이 기계가 읽을 수 있는
// 형태로 있는가.** 없으면 승인이 `BLOCKED`다 — 사람이 "괜찮아 보인다"고 통과시키면 그 대가는
// 개발 중의 질문으로 돌아온다.
//
// 사용법:
//   node .claude/scripts/validate-handoff-readiness.mjs --project <root> --to design|development [--json]
// 종료 코드: 0 = 인계 가능, 1 = 미해결, 2 = 사용법 오류.
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {parseFeaturePlanUnits} from './ticket/plan-units.mjs'
import {claimScopeReadiness, findPathCollisions} from './ticket/claim-scope.mjs'
import {extractDecisionBlock} from './spec.mjs'
import {checkDecisionsApplied} from './validate-development-readiness.mjs'
import {readSpecAt} from './validate-spawn-plan.mjs'

const ok = (id, detail) => ({id, state: 'PASS', detail})
const hole = (id, detail, remedy) => ({id, state: 'HOLE', detail, remedy})
const skip = (id, detail) => ({id, state: 'SKIPPED', detail})

// feature-plan은 flat·sharded 두 형태다(artifact-sharding 계약).
export function loadPlanUnits(root) {
  const flat = join(root, '_workspace/01_plan/feature-plan.md')
  if (existsSync(flat) && statSync(flat).isFile()) return parseFeaturePlanUnits(readFileSync(flat, 'utf8'))
  const dir = join(root, '_workspace/01_plan/feature-plan')
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return null
  return readdirSync(dir).filter(name => name.endsWith('.md')).sort()
    .flatMap(name => parseFeaturePlanUnits(readFileSync(join(dir, name), 'utf8')))
}

// ── 개발이 기획에게 요구하는 것 ─────────────────────────────────────────────
// 개발은 "무엇을 먼저 해야 하는가"와 "누가 어디에 쓰는가"를 **기계로** 알아야 병렬 진행이
// 가능하다. 산문에 있으면 사람은 읽고 기계는 못 읽는다.
export function checkPlanDeclarations(units) {
  if (units === null) return hole('plan', 'feature-plan이 없다', '기획을 먼저 확정한다')
  if (units.length === 0) return hole('plan', 'feature-plan에서 FEAT 단위를 하나도 읽지 못했다(표 형식일 수 있다)',
    'FEAT 헤딩 형식으로 쓴다 — 표만 있으면 티켓 파이프라인이 단위를 못 만든다')
  const noDeps = units.filter(u => u.dependsOn === undefined).map(u => u.featureId)
  const noPaths = units.filter(u => u.paths === undefined).map(u => u.featureId)
  const broken = units.filter(u => u.declarationError).map(u => `${u.featureId}(${u.declarationError})`)
  const problems = []
  if (broken.length > 0) problems.push(`마커를 읽지 못함: ${broken.join(', ')}`)
  if (noDeps.length > 0) problems.push(`의존 미선언 ${noDeps.length}/${units.length}: ${noDeps.slice(0, 6).join(', ')}${noDeps.length > 6 ? ' …' : ''}`)
  if (noPaths.length > 0) problems.push(`경로 미선언 ${noPaths.length}/${units.length}`)
  if (problems.length === 0) return ok('plan', `FEAT ${units.length}건 전부 의존·경로 선언됨`)
  return hole('plan', problems.join(' · '),
    '각 FEAT 섹션에 `<!-- web-harness:unit feat=… dependsOn=… paths=… -->`를 넣는다. 의존이 없으면 dependsOn=none으로 **명시**한다 — 생략은 "없음"이 아니라 "선언 안 함"이고, 개발 중에 순서를 되묻게 된다')
}

// 순서를 **산문으로만** 말하고 있는가. 선언이 있는데 산문도 있는 것은 정상(설명)이고,
// 선언이 없는데 산문만 있는 것이 구멍이다 — 오늘 실제로 그랬다.
const ORDERING_PROSE = /(병렬|선행|먼저|이후|순차|→)/
export function checkProseOnlyOrdering(root, units) {
  if (!units || units.length === 0) return skip('prose-ordering', '단위를 읽지 못해 대조할 수 없다')
  const declared = units.filter(u => Array.isArray(u.dependsOn) && u.dependsOn.length > 0).length
  if (declared > 0) return ok('prose-ordering', `의존 엣지가 ${declared}건 선언돼 있다`)
  const dir = join(root, '_workspace/01_plan/feature-plan')
  const sources = existsSync(dir) && statSync(dir).isDirectory()
    ? readdirSync(dir).filter(n => n.endsWith('.md')).map(n => readFileSync(join(dir, n), 'utf8'))
    : []
  const proseHit = sources.some(text => ORDERING_PROSE.test(text) && /FEAT-\d{3,}/.test(text))
  if (!proseHit) return ok('prose-ordering', '순서를 주장하는 산문이 없다 — 정말 전부 독립일 수 있다')
  return hole('prose-ordering', '기획 산문이 순서를 말하는데 선언된 의존 엣지가 0건이다',
    '산문의 순서를 dependsOn으로 옮긴다 — 기계가 못 읽으면 보드가 전부 착수 가능으로 보이고, 개발이 그 위에서 시작한다')
}

// ── 개발이 설계에게 요구하는 것 ─────────────────────────────────────────────
// 미결정이 남아 있으면 개발이 그것을 만나 멈춘다. 결정은 설계 단계에서 끝나야 한다.
export function checkDesignDecisionsClosed(root) {
  const path = join(root, '_workspace/02_design/solution-design.md')
  if (!existsSync(path)) return hole('design-decisions', 'solution-design.md가 없다', 'system-architect로 구현 설계 결정을 기록한다')
  let decision
  try {
    decision = extractDecisionBlock(readFileSync(path, 'utf8'))
  } catch (error) {
    return hole('design-decisions', `결정 블록을 읽지 못했다: ${error.message}`, 'solution-design.md의 기계 블록을 고친다')
  }
  const open = (decision.openDecisions ?? []).filter(item => (item?.status ?? 'open') === 'open')
  if (open.length === 0) return ok('design-decisions', '미결정 0건')
  return hole('design-decisions', `미결정 ${open.length}건이 열려 있다: ${open.map(i => i.id).join(', ')}`,
    '설계 단계에서 닫는다 — 여기서 안 닫으면 개발 중에 사용자에게 되묻게 된다')
}

// ── 개발이 스팩에게 요구하는 것 ─────────────────────────────────────────────
export function checkSpecReady(root) {
  const spec = readSpecAt(root)
  if (!spec) return hole('spec', '_workspace/03_dev/spec.json이 없다', 'spec.mjs로 확정한다 — developer 소유권의 유일한 공급원이다')
  if (spec.specTier === 'unverifiable') {
    return hole('spec', '스팩이 unverifiable이다 — 무엇이 완료인지 판정할 기준이 없다',
      'feature-plan의 FEAT/TC를 acceptanceRefs로 참조해 재확정한다')
  }
  return ok('spec', `확정됨 · ${spec.specTier}`)
}

// ── 디자인이 기획에게 요구하는 것 ───────────────────────────────────────────
// `design-readiness-contract.md`가 필수로 규정한 절들이 실제로 있는가. 없으면 디자인이
// 추론으로 채우고, 그 추론이 개발까지 흘러가 "왜 이렇게 됐지"가 된다.
//
// **한계(정직)**: 헤딩 존재만 본다 — 내용이 채워졌는지는 못 본다. 그 판정은 사람의 승인
// 몫이고, 이 검사는 **없는 것을 없다고 말하는 것**까지다(§4 등록).
const REQUIRED_PLAN_SECTIONS = [
  {file: '_workspace/01_plan/ux-brief', heading: '화면별 정보 위계', why: '레이아웃을 정할 근거'},
  {file: '_workspace/01_plan/ux-brief', heading: '디자인 방향', why: '시각 위계를 정할 근거'},
]

const readPlanArtifact = (root, base) => {
  const flat = join(root, `${base}.md`)
  if (existsSync(flat) && statSync(flat).isFile()) return readFileSync(flat, 'utf8')
  const dir = join(root, base)
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return null
  return readdirSync(dir).filter(n => n.endsWith('.md')).sort()
    .map(n => readFileSync(join(dir, n), 'utf8')).join('\n')
}

export function checkDesignInputs(root) {
  const missing = []
  for (const section of REQUIRED_PLAN_SECTIONS) {
    const text = readPlanArtifact(root, section.file)
    if (text === null) { missing.push(`${section.file} 없음`); continue }
    if (!text.includes(section.heading)) missing.push(`${section.heading}(${section.why})`)
  }
  if (missing.length === 0) return ok('design-inputs', '디자인이 요구하는 기획 절이 전부 있다')
  return hole('design-inputs', `디자인 입력 누락: ${missing.join(' · ')}`,
    'design-readiness-contract.md의 필수 절을 채운다 — 없으면 디자인이 추론으로 메우고 그 추론이 개발까지 흘러간다')
}

// FEAT마다 검증 기준이 있는가. 없으면 나중에 스팩이 unverifiable로 잠기고, 무엇이 완료인지
// 개발이 스스로 판단하게 된다 — 그 원인은 여기다.
export function checkAcceptanceCoverage(units) {
  if (!units || units.length === 0) return skip('acceptance', '단위를 읽지 못해 대조할 수 없다')
  const bare = units.filter(u => (u.testCaseIds?.length ?? 0) === 0).map(u => u.featureId)
  if (bare.length === 0) return ok('acceptance', `FEAT ${units.length}건 전부 TC를 갖는다`)
  return hole('acceptance', `검증 기준 없는 FEAT ${bare.length}건: ${bare.slice(0, 6).join(', ')}${bare.length > 6 ? ' …' : ''}`,
    '각 FEAT에 TC를 적는다 — 없으면 스팩이 unverifiable로 잠기고 "무엇이 완료인가"를 개발이 판단하게 된다')
}

// rationale의 FEAT 표기를 읽는다. `FEAT-006/007/008` 축약을 지원한다 — 사람이 자연스럽게
// 쓰는 형태인데 `FEAT-\d+`만 보면 **첫 번째만 읽고 나머지를 남의 것으로 오탐**한다
// (자체 실측 2026-08-30: track의 track-canvas 경계가 다섯을 명시하는데 넷이 오탐으로 나왔다).
export function featureIdsIn(text) {
  const source = String(text ?? '')
  const ids = new Set()
  for (const match of source.matchAll(/FEAT-(\d{3,})((?:\/\d{3,})*)/g)) {
    ids.add(`FEAT-${match[1]}`)
    for (const tail of match[2].split('/').filter(Boolean)) ids.add(`FEAT-${tail}`)
  }
  return [...ids]
}

// ── (1) 선언된 경로 ↔ 스팩 귀속 대조 ────────────────────────────────────────
// 선언은 자기보고다. 아무도 원문서와 대조하지 않으면 **지어낸 귀속**이 그대로 통과한다
// (2026-08-30 실측: `src/entities/track/model`의 rationale은 어느 FEAT도 명시하지 않는
// 공유 정본인데 네 FEAT의 paths에 들어가, 004↔005 거짓 충돌을 만들어 착수를 막았다).
//
// 스팩 `moduleBoundaries`의 rationale이 FEAT를 명시하면 그것이 귀속이다. 규칙 둘:
//   · 남의 FEAT에 귀속된 경계를 선언하면 지적한다
//   · **아무에게도 귀속되지 않은 경계**를 특정 FEAT가 선언하면 지적한다 — 공유 정본에
//     단일 소유자를 지어내는 것이고, 그 순간 거짓 충돌이 생긴다
export function checkPathsAgainstSpec(units, spec) {
  if (!units || units.length === 0) return skip('paths-attribution', '단위를 읽지 못해 대조할 수 없다')
  const boundaries = (Array.isArray(spec?.moduleBoundaries) ? spec.moduleBoundaries : [])
    .filter(entry => typeof entry?.scope === 'string' && entry.scope.trim())
  if (boundaries.length === 0) return skip('paths-attribution', '스팩에 moduleBoundaries가 없어 대조할 수 없다')
  const attribution = new Map(boundaries.map(entry => [
    entry.scope.replace(/\/+$/, ''),
    new Set(featureIdsIn(entry.rationale)),
  ]))
  const problems = []
  for (const unit of units) {
    for (const declared of unit.paths ?? []) {
      const clean = declared.replace(/\/+\*+$/, '').replace(/\/+$/, '')
      const owners = attribution.get(clean)
      if (owners === undefined) continue // 스팩이 모르는 경계 — 대조 대상 아님(정직)
      if (owners.size === 0) {
        problems.push(`${unit.featureId}: ${clean}은 어느 FEAT에도 귀속되지 않은 공유 경계다`)
      } else if (!owners.has(unit.featureId)) {
        problems.push(`${unit.featureId}: ${clean}은 ${[...owners].join('·')}에 귀속된 경계다`)
      }
    }
  }
  if (problems.length === 0) return ok('paths-attribution', '선언된 경로가 스팩 귀속과 일치한다')
  return hole('paths-attribution', problems.slice(0, 6).join(' · ') + (problems.length > 6 ? ` … 외 ${problems.length - 6}건` : ''),
    '스팩 moduleBoundaries의 rationale이 FEAT를 명시한 경계만 그 FEAT의 paths로 적는다 — 공유 정본에 단일 소유자를 지어내면 거짓 충돌이 생겨 착수가 막힌다')
}

// ── (3) 진행 중 픽업 보호 ───────────────────────────────────────────────────
// 계획을 고치면 그것을 읽고 작업 중인 개발자 밑에서 순서가 바뀐다. 오늘 내가 그렇게 했다 —
// FEAT-009를 픽업한 상태에서 그 FEAT의 dependsOn을 고쳐 진행 불가로 만들었다(코드 손실은
// 없었지만 옳은 순서가 아니었다). 활성 change-scope가 있으면 그 FEAT가 **지금 계획으로도
// 착수 가능한지** 확인한다.
export function checkActivePickupIntact(root, units, {readiness = null} = {}) {
  const scopePath = join(root, '_workspace/03_dev/change-scope.md')
  if (!existsSync(scopePath)) return skip('active-pickup', '진행 중인 픽업이 없다')
  let featureId = null
  try {
    const fence = readFileSync(scopePath, 'utf8').match(/```json\s+change-scope\s*\n([\s\S]*?)\n```/)
    featureId = fence ? JSON.parse(fence[1])?.featureId ?? null : null
  } catch { return skip('active-pickup', 'change-scope를 읽지 못했다') }
  if (!featureId) return skip('active-pickup', 'change-scope에 featureId가 없다')
  const unit = (units ?? []).find(entry => entry.featureId === featureId)
  if (!unit) {
    return hole('active-pickup', `진행 중인 ${featureId}가 계획에서 사라졌다`,
      '픽업 중인 FEAT를 계획에서 지우면 그 작업의 근거가 없어진다 — 되돌리거나 픽업을 정리한다')
  }
  const verdict = (readiness ?? defaultReadiness)(unit, units)
  if (verdict.pickupable) return ok('active-pickup', `진행 중인 ${featureId}가 현재 계획으로도 착수 가능하다`)
  return hole('active-pickup', `진행 중인 ${featureId}가 현재 계획으로는 착수 불가다(${verdict.blockedReason})`,
    '계획이 진행 중인 픽업 밑에서 바뀌었다 — 계획을 되돌리거나, 개발자에게 알리고 픽업을 정리한 뒤 바꾼다')
}

const defaultReadiness = (unit, units) => claimScopeReadiness({
  unit,
  foundationComplete: true,
  // 머지 목록을 모르므로 **의존을 보지 않는다** — 여기서 묻는 것은 "계획 변경으로 구조가
  // 깨졌는가"이지 "지금 순서가 왔는가"가 아니다. 충돌·미선언만 본다.
  mergedFeatureIds: (unit.dependsOn ?? []),
  collisions: findPathCollisions(units),
})

// ── 산문이 말한 의존 간선이 선언에 있는가 ───────────────────────────────────
// 오늘 세 번 같은 실수를 했다: 산문의 **웨이브 목록**을 간선으로 옮기면서 같은 문서가 네 줄
// 위에서 준 **명시적 간선**을 안 읽었다(FEAT-008은 "FEAT-005와 FEAT-006 둘 다에 의존하지만"
// 이라고 적혀 있는데 선언에서 006이 빠졌고, 그 한 줄이 잔여 8건 중 7건을 막았다).
//
// 웨이브는 묶음이지 간선이 아니다. 산문이 "A는 B에 의존한다"고 말하면 그것은 간선이다.
//
// **탐지 방식과 그 한계(프록시, §4 등록)**: `의존`이 나오는 자리 앞 창(80자)에서 FEAT ID를
// 모아 첫 번째를 주체로, 나머지를 피의존으로 읽는다. 부정(`의존하지 않`)·독립 표현이 창에
// 있으면 건너뛴다. 이것은 문장 구조 분석이 아니라 근접성 휴리스틱이다 —
//   · 다른 말로 의존을 표현하면(“재사용한다”·“전제로 한다”) **놓친다**(과소 탐지, 정직한 방향)
//   · 한 문장에 여러 절이 겹치면 주체를 잘못 집을 수 있다 — 그래서 판정에 **원문을 함께 싣는다**
// 트리거를 `…에 의존` **절 형태**로 좁힌다. 단순히 `의존`만 보면 "파이프라인은 순차
// 의존이므로"·웨이브 나열 같은 자리에서 엉뚱한 주체를 집는다(자체 실측: 오탐 4건).
const DEPENDENCY_CLAUSE = /에\s*의존/g
// 주체는 **주격·주제 조사가 붙은 FEAT**다. `FEAT-008(레인체인지)은`처럼 괄호가 끼어도 잡는다.
// `\b`는 ASCII 단어 경계라 한글 조사 뒤에서 성립하지 않는다 — 붙이면 아무것도 안 잡힌다.
const SUBJECT_MARKED = /FEAT-(\d{3,})(?:\([^)]*\))?\s*(?:은|는|이|가)/g
const NEGATION = /(의존하지\s*않|독립적?으로|무관하)/

export function extractProseEdges(text) {
  const source = String(text ?? '')
  const edges = new Map()
  for (const match of source.matchAll(DEPENDENCY_CLAUSE)) {
    const start = Math.max(0, match.index - 120)
    const clause = source.slice(start, match.index)
    if (NEGATION.test(source.slice(start, Math.min(source.length, match.index + 24)))) continue
    // 주체: 창 안에서 **마지막으로** 조사가 붙은 FEAT(가장 가까운 절의 주어).
    const marked = [...clause.matchAll(SUBJECT_MARKED)]
    if (marked.length === 0) continue
    const subjectMatch = marked[marked.length - 1]
    const subject = `FEAT-${subjectMatch[1]}`
    // 피의존: 주체 뒤부터 `에 의존` 사이에 나오는 FEAT들.
    const tail = clause.slice(subjectMatch.index + subjectMatch[0].length)
    for (const dep of new Set(tail.match(/FEAT-\d{3,}/g) ?? [])) {
      if (dep === subject) continue
      const key = `${subject}→${dep}`
      if (!edges.has(key)) {
        edges.set(key, {
          subject, dep,
          quote: source.slice(start + subjectMatch.index, Math.min(source.length, match.index + 12)).replace(/\s+/g, ' ').trim(),
        })
      }
    }
  }
  return [...edges.values()]
}

export function checkProseEdgesDeclared(root, units) {
  if (!units || units.length === 0) return skip('prose-edges', '단위를 읽지 못해 대조할 수 없다')
  const dir = join(root, '_workspace/01_plan/feature-plan')
  const text = existsSync(dir) && statSync(dir).isDirectory()
    ? readdirSync(dir).filter(n => n.endsWith('.md')).sort().map(n => readFileSync(join(dir, n), 'utf8')).join('\n')
    : (existsSync(join(root, '_workspace/01_plan/feature-plan.md')) ? readFileSync(join(root, '_workspace/01_plan/feature-plan.md'), 'utf8') : '')
  const edges = extractProseEdges(text)
  if (edges.length === 0) return skip('prose-edges', '산문에서 의존 진술을 찾지 못했다 — 없거나 다른 표현이다')
  const declared = new Map(units.map(u => [u.featureId, new Set(u.dependsOn ?? [])]))
  const known = new Set(units.map(u => u.featureId))
  const missing = edges.filter(edge =>
    known.has(edge.subject) && known.has(edge.dep) && !(declared.get(edge.subject)?.has(edge.dep)))
  if (missing.length === 0) return ok('prose-edges', `산문이 말한 의존 ${edges.length}건이 전부 선언돼 있다`)
  return hole('prose-edges',
    missing.map(edge => `${edge.subject}→${edge.dep}: "${edge.quote}"`).join(' · '),
    '산문이 명시한 간선을 dependsOn에 옮긴다 — 웨이브 목록은 묶음이지 간선이 아니다. 산문이 틀렸다면 산문을 고친다(둘 중 하나는 거짓이다)')
}

// ── 병렬성 지표 ─────────────────────────────────────────────────────────────
// 나눔의 목표는 "몇 조각인가"가 아니라 **"몇 개를 동시에 진행할 수 있나"**다
// (`feature-planner` 작업 원칙 4). 규칙만 있고 재는 것이 없으면 지켜졌는지 알 수 없다.
//
// **실패로 만들지 않는다** — 의존이 많은 것이 항상 잘못은 아니다(파이프라인은 본래 순차다).
// 재서 보여주기만 한다. 판단은 사람이 하고, 이 숫자는 그 판단의 입력이다.
export function measureParallelism(units) {
  const list = units ?? []
  if (list.length === 0) return null
  const deps = new Map(list.map(u => [u.featureId, (u.dependsOn ?? []).filter(id => list.some(v => v.featureId === id))]))
  const edges = [...deps.values()].reduce((sum, list_) => sum + list_.length, 0)
  // 가장 긴 의존 사슬 — 이론상 최소 웨이브 수다.
  const depth = new Map()
  const chain = id => {
    if (depth.has(id)) return depth.get(id)
    depth.set(id, 1) // 순환 방어(순환은 computeClaimOrder가 보고한다)
    const value = 1 + Math.max(0, ...(deps.get(id) ?? []).map(chain))
    depth.set(id, value)
    return value
  }
  for (const id of deps.keys()) chain(id)
  // 병목: 자기를 기다리는 FEAT가 가장 많은 것.
  const dependents = new Map([...deps.keys()].map(id => [id, 0]))
  for (const [, list_] of deps) for (const id of list_) dependents.set(id, (dependents.get(id) ?? 0) + 1)
  const top = [...dependents.entries()].sort((a, b) => b[1] - a[1])[0]
  return {
    units: list.length,
    edges,
    longestChain: Math.max(...depth.values()),
    independent: [...deps.entries()].filter(([, list_]) => list_.length === 0).length,
    bottleneck: top && top[1] > 0 ? {featureId: top[0], blocks: top[1]} : null,
  }
}

export const HANDOFFS = ['design', 'development']

export function analyzeHandoffReadiness(root, {to = 'development'} = {}) {
  if (!HANDOFFS.includes(to)) throw new Error(`UNKNOWN_HANDOFF: ${to} — ${HANDOFFS.join('|')}`)
  const units = loadPlanUnits(root)
  // 의존·경로는 **기획 산출물**이다. 디자인 인계에서 먼저 잡고, 개발 인계에서 다시 확인한다
  // (사이에 지워질 수 있다). 늦게 잡을수록 되돌리는 비용이 커진다.
  const planChecks = [checkPlanDeclarations(units), checkProseOnlyOrdering(root, units), checkProseEdgesDeclared(root, units),
    checkAcceptanceCoverage(units), checkActivePickupIntact(root, units)]
  if (to === 'design') {
    const results = [...planChecks, checkDesignInputs(root)]
    const holes = results.filter(r => r.state === 'HOLE')
    return {schemaVersion: 1, to, verdict: holes.length === 0 ? 'READY' : 'HOLES', results, holes, parallelism: measureParallelism(units)}
  }
  const spec = readSpecAt(root)
  const results = [
    ...planChecks,
    checkPathsAgainstSpec(units, spec),
    checkDesignDecisionsClosed(root),
    checkSpecReady(root),
    spec ? checkDecisionsApplied(root, spec) : skip('decisions', '스팩이 없어 대조할 수 없다'),
  ]
  const holes = results.filter(r => r.state === 'HOLE' || r.state === 'FAIL')
  return {schemaVersion: 1, to, verdict: holes.length === 0 ? 'READY' : 'HOLES', results, holes, parallelism: measureParallelism(units)}
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  const projectIndex = argv.indexOf('--project')
  const toIndex = argv.indexOf('--to')
  const projectRoot = projectIndex >= 0 ? argv[projectIndex + 1] : undefined
  const to = toIndex >= 0 ? argv[toIndex + 1] : 'development'
  if (!projectRoot || !HANDOFFS.includes(to)) {
    process.stderr.write(`사용법: node .claude/scripts/validate-handoff-readiness.mjs --project <root> --to ${HANDOFFS.join('|')} [--json]\n`)
    process.exit(2)
  }
  const report = analyzeHandoffReadiness(resolve(projectRoot), {to})
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    process.stdout.write(`인계 점검 → ${to === 'design' ? '디자인' : '개발'}: 다음 단계가 이 문서만으로 질문 없이 진행 가능한가\n`)
    for (const result of report.results) {
      const mark = result.state === 'PASS' ? '✅' : result.state === 'SKIPPED' ? '· ' : '🕳'
      process.stdout.write(`  ${mark} ${result.id}: ${result.detail}\n`)
      if (result.remedy) process.stdout.write(`      → ${result.remedy}\n`)
    }
    if (report.parallelism) {
      const p = report.parallelism
      process.stdout.write(`\n  병렬성: FEAT ${p.units} · 의존 간선 ${p.edges} · 최장 사슬 ${p.longestChain}웨이브 · 선행 없는 단위 ${p.independent}개`
        + `${p.bottleneck ? ` · 병목 ${p.bottleneck.featureId}(${p.bottleneck.blocks}건이 대기)` : ''}\n`)
    }
    process.stdout.write(report.verdict === 'READY'
      ? `\nREADY ✅ — ${to === 'design' ? '디자인' : '개발'}이 이 문서만으로 진행할 수 있다.\n`
      : `\nHOLES ⛔ — 구멍 ${report.holes.length}건. 지금 메우지 않으면 뒤 단계의 질문으로 돌아온다.\n`)
  }
  process.exit(report.verdict === 'READY' ? 0 : 1)
}
