#!/usr/bin/env node
// validate-requirements-notation.mjs — Must 요구사항이 **의무를 진술하는지** 검사한다 (EARS 착안).
//
// 왜: 실측(seminar-booking) 기준 REQ 헤드라인은 `- [ ] REQ-F-001 세션 목록/검색 (참가자)`처럼
// **명사구 라벨**이다. 그 아래 AC는 Given/Then으로 구조화돼 있지만, "이 요구사항이 무엇을
// 보장해야 하는가"를 진술하는 문장이 **하나도 없어도 아무도 잡지 않았다**. NFR은 더해서
// `REQ-NFR-003 접근성: WCAG 2.2 AA`처럼 라벨만 있는 경우가 흔하다.
//
// EARS(Easy Approach to Requirements Syntax)는 요구사항을 6패턴으로 제약한다:
//   ubiquitous(항상) · event(When) · state(While) · unwanted(If-Then) · optional(Where) · complex
// 이 스크립트는 EARS 문법을 강제하지 않는다 — 한국어/영어 어느 쪽이든 **의무 진술이 존재하는지**를
// 필요조건으로 검사하고, 있으면 어떤 패턴인지 분류해 분포를 보고한다. 문법 강제는 오탐이 크고
// (자연어), 분류는 작성자가 빠뜨린 범주(특히 unwanted/state)를 드러내는 데 실익이 있다.
//
// 언어 독립(0단계 교훈): 마커를 한 언어에 묶지 않는다. 한국어 서술체(`~된다`, `~해야 한다`)와
// 영어(`shall`, `must`)를 모두 의무 진술로 인정한다.
//
// 사용법:
//   node .claude/scripts/validate-requirements-notation.mjs --project <root> [--json]
// 종료 코드: 0 = 전 Must 요구사항이 의무를 진술함, 1 = 진술 없는 요구사항 존재, 2 = 사용법 오류.

import {existsSync, readFileSync} from 'node:fs'
import {join, resolve} from 'node:path'

// 의무 진술 — 이것이 **필요조건**이다. 없으면 라벨일 뿐 요구사항이 아니다.
// 줄 끝 앵커를 쓰지 않는다 — 실측에서 AC 줄이 `` `[LOCAL_VERIFIABLE]` `` 같은 마커로 끝나
// $ 매칭이 전부 실패했고, **문서가 아니라 검사가 틀린** 100% 오탐이 났다(2026-08-12).
// 한국어 서술체는 종결 어미 `~다` 뒤에 구두점·괄호·마커가 오는 것이 정상이다.
// 종결 어미 `다` 뒤에 무엇이 오는지 열거하려다 두 번 놓쳤다(줄끝 마커, 여는 괄호).
// 열거 대신 **`다` 다음이 한글 음절이 아니면 종결**로 본다 — `표시된다.` `트리거된다(` 모두
// 잡고, `다른`·`다양한` 같은 어두 `다`는 뒤가 한글이라 제외된다.
const OBLIGATION = /\b(?:shall|must)\b|(?:해야|하여야)\s*한다|[가-힣]{2,}다(?![가-힣])/m

// EARS 6패턴 분류(한국어·영어). 분류 실패는 위반이 아니라 `ubiquitous`로 본다 —
// 키워드 없는 상시 요구사항이 EARS의 정당한 한 패턴이기 때문이다.
const PATTERNS = [
  {name: 'complex', re: /(?:while\b[\s\S]{0,120}?\bwhen\b)|(?:인\s*동안[\s\S]{0,60}?할\s*때)/i},
  // unwanted는 **의미**로 잡는다. EARS의 If-Then은 영어에서 구문으로 구분되지만 한국어는
  // `실패했을 때`처럼 event와 같은 형태를 쓴다 — 구문만 보면 한국어 프로젝트에서 이 범주가
  // 영원히 0으로 나와 경고가 상시 오탐이 된다(실측: 파일럿에 오류·경계 AC가 있는데도 0).
  {name: 'unwanted', re: /\bif\b[\s\S]{0,120}?\bthen\b|만약[\s\S]{0,60}?(?:면|으면)|실패|오류|에러|없을\s*때|없으면|초과|거부|차단|불가|중복|잘못|비활성/i},
  {name: 'state', re: /\bwhile\b|인\s*동안|상태에서/i},
  {name: 'event', re: /\bwhen\b|할\s*때|하면|진입하면/i},
  {name: 'optional', re: /\bwhere\b|인\s*경우|해당하는\s*경우/i},
]

export function classifyPattern(text) {
  for (const {name, re} of PATTERNS) if (re.test(text)) return name
  return 'ubiquitous'
}

export function statesObligation(text) {
  return OBLIGATION.test(text)
}

// requirements.md를 REQ 블록으로 자른다. 블록 = 헤드라인 + 다음 REQ 전까지의 하위 줄.
export function splitRequirements(text) {
  const lines = text.split('\n')
  const blocks = []
  let current = null
  for (const line of lines) {
    // 헤드라인 판정: 리스트 항목이 **REQ ID로 시작**해야 한다(체크박스 허용).
    // 단순히 REQ ID를 "포함"하면 안 된다 — 실측에서 `- Given ...(REQ-F-012 참조)` 같은 AC 줄이
    // 헤드라인으로 오인돼 상위 REQ의 본문을 빼앗고 양쪽 다 오탐이 났다(2026-08-12).
    // 강조 마커 허용(실전 오탐 4호, 2026-08-12): 첫 영어 실전 문서가 `- [ ] **REQ-F-001 — …**`
    // 형태를 썼는데 볼드를 인정하지 않아 REQ 0개 → NO_REQUIREMENTS가 났다. 한국어 파일럿의
    // 서식 관행(볼드 없음)에 교정돼 있던 것이다.
    const m = line.match(/^\s*(?:[-*]|\d+\.)\s*(?:\[[ xX]\]\s*)?(?:[*_\`]+\s*)?(REQ-[A-Z]+-\d+)\b/)
    if (m) {
      if (current) blocks.push(current)
      current = {id: m[1], headline: line.trim(), body: []}
      continue
    }
    if (current) {
      // 다음 헤드라인 전까지 들여쓰기된 줄만 블록에 담는다.
      if (/^\s+\S/.test(line) || line.trim() === '') current.body.push(line)
      else { blocks.push(current); current = null }
    }
  }
  if (current) blocks.push(current)
  return blocks
}

// Must 범위 판정 — `### Must Have` 이후 `### Could/Should` 전까지. 없으면 전체를 대상으로 본다.
export function mustSection(text) {
  const start = text.search(/^###\s+Must\b/im)
  if (start === -1) return text
  const rest = text.slice(start)
  const end = rest.slice(1).search(/^###\s+(?!Must)/im)
  return end === -1 ? rest : rest.slice(0, end + 1)
}

// --- AC 층 구조 검사 (EARS 실질 도입, 2026-08-12) ---
//
// EARS의 실제 기여는 "무엇을 한다"가 아니라 **언제/어떤 조건에서 하는가를 명시**하게 만드는
// 것이다. 실측: 파일럿 AC 38개가 이미 Given/When/Then 구조를 갖췄고 EARS와 동형이다
// (Given=상태/전제, When=트리거, Then=응답). 그래서 문서를 바꾸지 않고 검사를 AC 층으로
// 내리는 것으로 이 축을 닫는다.
//
// 대응: Given+When+Then → complex · When+Then → event · Given+Then → state
//       Then만 → ubiquitous(상시 요구사항 — EARS의 정당한 패턴)
const AC_BULLET = /^\s+(?:[-*]|\d+\.)\s+(\S.*)$/
const RESPONSE = /\bthen\b|\bshall\b|\bmust\b|[가-힣]{2,}다(?![가-힣])/i
const TRIGGER = /\bwhen\b|\bif\b|하면|할\s*때|되면|시도하면/i
const PRECONDITION = /\bgiven\b|\bwhile\b|\bwhere\b|인\s*동안|상태에서|경우/i

export function analyzeAcceptanceCriteria(bodyLines) {
  const acs = []
  for (const line of bodyLines) {
    const m = line.match(AC_BULLET)
    if (!m) continue
    const text = m[1]
    acs.push({
      text,
      response: RESPONSE.test(text),
      trigger: TRIGGER.test(text),
      precondition: PRECONDITION.test(text),
    })
  }
  return acs
}

export function earsPatternOf(ac) {
  if (ac.precondition && ac.trigger) return 'complex'
  if (ac.trigger) return 'event'
  if (ac.precondition) return 'state'
  return 'ubiquitous'
}

export function analyzeRequirements(text) {
  const scope = mustSection(text)
  const blocks = splitRequirements(scope)
  const violations = []
  const distribution = {}
  let acTotal = 0
  const results = blocks.map(b => {
    const full = `${b.headline}\n${b.body.join('\n')}`
    const obligation = statesObligation(full)
    if (!obligation) violations.push({code: 'NO_OBLIGATION', id: b.id})
    const acs = analyzeAcceptanceCriteria(b.body)
    // AC가 하나도 없으면 "언제 무엇을 보장하는가"가 검증 가능한 형태로 없다.
    if (obligation && acs.length === 0) violations.push({code: 'NO_ACCEPTANCE_CRITERIA', id: b.id})
    for (const ac of acs) {
      acTotal++
      // 응답(Then/shall) 없는 AC는 결과를 말하지 않는다 — EARS의 최소 요건 미달.
      if (!ac.response) violations.push({code: 'AC_NO_RESPONSE', id: b.id, text: ac.text.slice(0, 60)})
      else {
        const p = /실패|오류|에러|없을\s*때|없으면|초과|거부|차단|불가|중복|잘못|비활성|invalid|error|fail|reject/i.test(ac.text)
          ? 'unwanted' : earsPatternOf(ac)
        distribution[p] = (distribution[p] ?? 0) + 1
      }
    }
    return {id: b.id, obligation, acCount: acs.length}
  })
  return {total: results.length, acTotal, violations, distribution}
}

function parseArgs(argv) {
  const out = {root: null, json: false}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') { out.root = argv[++i]; continue }
    if (argv[i] === '--json') { out.json = true; continue }
  }
  return out
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (!opts.root) { console.error('사용법: --project <root> [--json]'); process.exit(2) }
  const root = resolve(opts.root)
  const path = join(root, '_workspace', '01_plan', 'requirements.md')
  if (!existsSync(path)) { console.error(`requirements.md 없음: ${path}`); process.exit(2) }

  const report = analyzeRequirements(readFileSync(path, 'utf8'))

  if (opts.json) {
    console.log(JSON.stringify({schemaVersion: 1, ...report}, null, 2))
  } else if (report.total === 0) {
    // 요구사항을 하나도 못 찾은 것은 통과가 아니라 검사 미수행이다(vacuous PASS 차단).
    console.log('NO_REQUIREMENTS ⚠️  — Must 범위에서 REQ 블록을 찾지 못했다. 검사를 수행하지 않았다.')
  } else {
    const dist = Object.entries(report.distribution).map(([k, v]) => `${k} ${v}`).join(' · ')
    const reqViolations = report.violations.filter(v => v.code === 'NO_OBLIGATION').length
    console.log(`요구사항 표기: Must ${report.total}개 · 의무 진술 ${report.total - reqViolations}개 · AC ${report.acTotal}개`)
    console.log(`  EARS 패턴 분포: ${dist || '없음'}`)
    if (!report.distribution.unwanted) {
      console.log('  ⚠️  unwanted(If-Then) 패턴이 하나도 없다 — 오류·경계 요구사항을 빠뜨렸을 수 있다.')
    }
    const DESC = {
      NO_OBLIGATION: '라벨만 있고 무엇을 보장하는지 진술이 없다',
      NO_ACCEPTANCE_CRITERIA: '의무는 진술했으나 검증 가능한 AC가 하나도 없다',
      AC_NO_RESPONSE: 'AC가 결과(Then/shall)를 말하지 않는다',
    }
    for (const v of report.violations.slice(0, 20)) console.log(`  ❌ ${v.code} ${v.id} — ${DESC[v.code]}${v.text ? ` :: ${v.text}` : ''}`)
    if (report.violations.length > 20) console.log(`  … 외 ${report.violations.length - 20}건`)
    if (report.violations.length === 0) console.log('PASS ✅ — 모든 Must 요구사항이 의무를 진술한다')
    else console.log(`\nFAIL ❌ — 의무 진술 없는 요구사항 ${report.violations.length}건.`)
  }
  process.exit((report.violations?.length ?? 0) === 0 ? 0 : 1)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
