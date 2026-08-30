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
//   node .claude/scripts/validate-handoff-readiness.mjs --project <root> --to development [--json]
// 종료 코드: 0 = 인계 가능, 1 = 미해결, 2 = 사용법 오류.
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {parseFeaturePlanUnits} from './ticket/plan-units.mjs'
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

export const HANDOFFS = ['development']

export function analyzeHandoffReadiness(root, {to = 'development'} = {}) {
  if (!HANDOFFS.includes(to)) throw new Error(`UNKNOWN_HANDOFF: ${to} — ${HANDOFFS.join('|')}`)
  const units = loadPlanUnits(root)
  const spec = readSpecAt(root)
  const results = [
    checkPlanDeclarations(units),
    checkProseOnlyOrdering(root, units),
    checkDesignDecisionsClosed(root),
    checkSpecReady(root),
    spec ? checkDecisionsApplied(root, spec) : skip('decisions', '스팩이 없어 대조할 수 없다'),
  ]
  const holes = results.filter(r => r.state === 'HOLE' || r.state === 'FAIL')
  return {schemaVersion: 1, to, verdict: holes.length === 0 ? 'READY' : 'HOLES', results, holes}
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
    process.stdout.write(`인계 점검 → ${to}: 다음 단계가 이 문서만으로 질문 없이 진행 가능한가\n`)
    for (const result of report.results) {
      const mark = result.state === 'PASS' ? '✅' : result.state === 'SKIPPED' ? '· ' : '🕳'
      process.stdout.write(`  ${mark} ${result.id}: ${result.detail}\n`)
      if (result.remedy) process.stdout.write(`      → ${result.remedy}\n`)
    }
    process.stdout.write(report.verdict === 'READY'
      ? '\nREADY ✅ — 개발이 이 문서만으로 진행할 수 있다.\n'
      : `\nHOLES ⛔ — 구멍 ${report.holes.length}건. 지금 메우지 않으면 개발 중의 질문으로 돌아온다.\n`)
  }
  process.exit(report.verdict === 'READY' ? 0 : 1)
}
