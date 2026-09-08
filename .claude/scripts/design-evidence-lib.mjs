#!/usr/bin/env node
// design-evidence-lib.mjs — 설계 산출물이 남긴 증거를 릴리스 시점에 읽는다.
//
// `release-gate-lib`에서 분리했다(2026-09-08). 이유는 모듈성 게이트 400줄 상한이고,
// **줄을 합쳐 맞추지 않았다** — 그것은 `docs/protected-core.md` §4 「스크립트 400줄 제한」이
// 이미 등록한 우회다. 여기 모은 둘은 성격이 같다: **설계가 선언한 것이 실물로 남았는가**를
// 파일 존재로 대조하고, 판정이 아니라 보고를 낸다.
//
// 둘 다 심볼 수준을 보지 않는다 — 한계는 §4에 등록돼 있다.
import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {join, resolve} from 'node:path'

// ── 시안 구현 축별 대조표 ─────────────────────────────────────────────────────
// **계기(실측)**: motor-lab v4에서 **색상만 적용된 리컬러**가 "시안 구현"으로 완료 선언되고
// 릴리스까지 통과했다 — 사용자가 발견했다(`docs/efficacy/receipts/`).
// `design-principles-research.md` §2가 그 뒤로 대조표를 요구하지만 **존재·형식을 검사하는
// 기계가 없었다**(`docs/protected-core.md` §4 「시안 구현 축별 대조표」 — "순수 자기 기록").
//
// 활성 조건은 `RENDER-VERDICT.md`의 `SELECTED_CANDIDATE:` 마커다 — 시안이 선정되지 않았으면
// 구현할 시안도 없다. `visual-qa-contract.json` 존재가 시각 QA를 활성화하는 것과 같은 관용구다.
//
// **강도를 나눈다.** 표가 **아예 없는 것**은 계약 의무 불이행이고 모호하지 않으므로 errors다
// (그리고 그것이 motor-lab 사고 당시의 상태였다). **행 수·빈 칸**은 부실 기재의 *신호*이지
// 판정이 아니므로 note로 남긴다 — 5행을 그럴듯한 문장으로 채우면 통과하며 그 한계는 §4에 있다.
const STYLE_TILES = '_workspace/02_design/design-system/style-tiles'
const SELECTED_CANDIDATE = /^SELECTED_CANDIDATE:\s*\S+/m
const IMPLEMENTATION_VERDICT = 'IMPLEMENTATION-VERDICT.md'
// 계약이 요구하는 최소 대조 항목 수(폰트·radius·spacing·그림자·액센트).
// **축 이름은 검사하지 않는다** — 실측(tamiya v4.1)에서 정당한 표가 색·타이포·밀도·형태·위계로
// 적었다. 이름으로 재면 잘 만든 표가 오탐으로 걸린다.
const MINIMUM_AXES = 5

const tableRows = text => {
  const rows = []
  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) { if (rows.length > 0) break; continue }
    const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
    if (cells.every(cell => /^:?-{2,}:?$/.test(cell))) continue
    rows.push(cells)
  }
  return rows
}

export const designRoundSummary = projectPath => {
  const projectRoot = resolve(projectPath)
  const tilesRoot = join(projectRoot, STYLE_TILES)
  if (!existsSync(tilesRoot)) return {state: 'NO_ROUND', note: '시안 라운드가 없다 — 구현 대조표를 요구하지 않는다'}
  let rounds
  try {
    rounds = readdirSync(tilesRoot, {withFileTypes: true}).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  } catch { return {state: 'NO_ROUND', note: '시안 라운드 디렉터리를 읽을 수 없다'} }

  const selected = []
  for (const round of rounds) {
    const renderVerdict = join(tilesRoot, round, 'RENDER-VERDICT.md')
    if (!existsSync(renderVerdict)) continue
    let text
    try { text = readFileSync(renderVerdict, 'utf8') } catch { continue }
    if (SELECTED_CANDIDATE.test(text)) selected.push(round)
  }
  if (selected.length === 0) {
    return {state: 'NO_SELECTION', rounds: rounds.length, note: '선정된 시안이 없다 — 구현 대조표를 요구하지 않는다'}
  }

  const missing = []
  const thin = []
  for (const round of selected) {
    const verdictPath = join(tilesRoot, round, IMPLEMENTATION_VERDICT)
    if (!existsSync(verdictPath)) { missing.push(round); continue }
    let text
    try { text = readFileSync(verdictPath, 'utf8') } catch { missing.push(round); continue }
    const rows = tableRows(text)
    const header = rows[0] ?? []
    const data = rows.slice(1)
    if (data.length < MINIMUM_AXES) {
      thin.push(`${round}: 대조 행 ${data.length}건 (계약 최소 ${MINIMUM_AXES})`)
      continue
    }
    // 기준·실측 칸이 비어 있으면 그 축은 대조된 것이 아니다. 이름 대신 **칸이 찼는가**만 본다.
    const blank = data.filter(row => row.slice(1, Math.max(3, header.length - 1)).some(cell => cell === ''))
    if (blank.length > 0) thin.push(`${round}: 빈 대조 칸이 있는 행 ${blank.length}건`)
  }
  if (missing.length > 0) {
    return {state: 'MISSING', selected, missing,
      note: `선정된 시안이 있는데 ${IMPLEMENTATION_VERDICT}가 없다: ${missing.join(', ')}`}
  }
  if (thin.length > 0) {
    return {state: 'THIN', selected, signals: thin,
      note: `대조표가 있으나 부실 기재 신호가 있다 — ${thin.join(' · ')}. **판정이 아니라 신호다**(축 이름은 검사하지 않는다)`}
  }
  return {state: 'PASS', selected,
    note: `선정 시안 ${selected.length}건 전부 구현 대조표를 갖는다 · 최소 ${MINIMUM_AXES}축`}
}

// ── 설계 → 코드 결속 ──────────────────────────────────────────────────────────
// **이 저장소의 가장 큰 공백이었다.** 계약은 Gate B에서 「route ↔ page/widget/component
// public export」를 요구하지만 그것을 보는 **기계 소비자가 0건**이었다(전수 grep) —
// `integration-verifier` 에이전트의 자기 수행 지시뿐이다.
//
// 학계가 이 자리를 어떻게 채우는지가 근거다: TraceDev(arXiv 2607.18886)는 요구→설계는
// LLM 의미 매칭으로, **설계→코드는 AST 구문 대조**로 잇는다. 그 ablation에서 이 연결을
// 유지하는 Validator를 빼면 semantic-coverage가 71.72% → 39.91%로 **가장 크게** 떨어진다.
// 즉 **연결 유지가 파이프라인에서 값이 가장 크다.**
//
// **AST를 쓰지 않는다.** 이 저장소의 `layout-spec`은 컴포넌트를 심볼이 아니라 **파일 경로**로
// 선언한다(실측: 4개 프로젝트의 라우팅 표 32행이 전부 백틱 경로). 그러면 물어야 할 것은
// 「선언된 경로가 실재하는가」이고, 그 답에 파서가 필요 없다 — 런타임 의존성 0개인 이 저장소에
// 첫 의존성을 들이는 것은 이 질문에 대해 과잉이다. 심볼 수준 대조가 필요해지면 그때 다시 본다.
//
// **차단하지 않는다 — 그리고 그 이유가 이 검사의 한계 자체다.**
// 초안은 「레이어가 없으면 미구현(차단) / 레이어는 있는데 파일이 없으면 개명(기록)」으로
// 강도를 나눴다. 그런데 **경로만으로는 그 둘을 구별할 수 없다는 것이 실측됐다**
// (2026-09-08): `api/handlers/x.ts` 선언에 실제 파일이 `api/x.ts`인 개명이
// 「레이어(`api/handlers`) 없음」으로 읽혀 미구현으로 차단됐다. 어느 조상까지 보는지를
// 바꿔도 얕은 경로와 깊은 경로 중 한쪽이 항상 틀렸다 — **파일시스템에는 미구현과 개명이
// 똑같이 보인다.**
//
// 구별하려면 **심볼 수준**이 필요하다(선언된 컴포넌트가 다른 파일에 있는가). 그때 파서
// 의존성이 정당해지며, 그 전에는 아니다. 그래서 지금은 **한 상태로 보고만 한다** —
// 오탐 0을 만들지 못한 게이트는 차단하지 않는다는 이 저장소의 규율 그대로다.
//
// 정본을 고치는 것이 계약이다 — `phase-3-development.md`가 이미 그렇게 적는다:
// "없거나 맞지 않으면 적정한 값을 판단해 정한 뒤 **정본에 추가·수정한다**."
// 이 검사는 아무것도 막지 않는다 — **낡은 정본을 릴리스 매니페스트에 드러낼 뿐이다.**
const LAYOUT_SPEC = '_workspace/02_design/layout-spec'
// 표 행 안의 백틱 소스 경로만 본다. 산문의 경로는 반례·설명일 수 있어 세지 않는다
// (실측에서 표 행만 보면 오탐 0이었다).
const SOURCE_PATH = /`((?:src|api)\/[A-Za-z0-9_@./-]+\.(?:tsx?|jsx?|mjs))`/
// 접두에 안 걸리는 백틱 경로 — Next.js `app/`·모노레포 `packages/*/src`가 여기 걸린다.
// 세지 않으면 「선언이 없다」와 「읽지 못했다」가 같은 상태로 보고돼 커버리지 0이 안 보인다.
const ANY_SOURCE_PATH = /`([A-Za-z0-9_@./-]+\.(?:tsx?|jsx?|mjs))`/

// 코드펜스 안의 표는 예시다. 걷어내지 않으면 계약 문서의 예시 표가 선언으로 읽힌다
// (실측 2026-09-08: 펜스 안 표의 경로가 미구현으로 차단됐다).
const stripFences = text => {
  const lines = String(text ?? '').split('\n')
  const kept = []
  let inFence = false
  for (const line of lines) {
    if (/^\s*(?:```|~~~)/.test(line)) { inFence = !inFence; continue }
    if (!inFence) kept.push(line)
  }
  return kept.join('\n')
}

const readDesignArtifact = (projectRoot, relative) => {
  const flat = join(projectRoot, `${relative}.md`)
  if (existsSync(flat)) { try { return readFileSync(flat, 'utf8') } catch { return null } }
  const directory = join(projectRoot, relative)
  if (!existsSync(directory)) return null
  try {
    return readdirSync(directory).filter(name => name.endsWith('.md')).sort()
      .map(name => readFileSync(join(directory, name), 'utf8')).join('\n')
  } catch { return null }
}

export const routeBindingSummary = projectPath => {
  const projectRoot = resolve(projectPath)
  const text = readDesignArtifact(projectRoot, LAYOUT_SPEC)
  if (text === null) return {state: 'NO_LAYOUT', note: 'layout-spec이 없다 — 화면 결속을 볼 수 없다'}
  const declared = [...new Set(
    stripFences(text).split('\n')
      .filter(line => line.trim().startsWith('|') && SOURCE_PATH.test(line))
      .map(line => SOURCE_PATH.exec(line)[1]),
  )]
  const rows = stripFences(text).split('\n').filter(line => line.trim().startsWith('|'))
  const unrecognized = [...new Set(
    rows.filter(line => !SOURCE_PATH.test(line) && ANY_SOURCE_PATH.test(line))
      .map(line => ANY_SOURCE_PATH.exec(line)[1]),
  )]
  if (declared.length === 0) {
    // 선언이 없는 형태(library·cli·경로를 안 적는 서피스 맵)와, 접두를 읽지 못한 형태를
    // **구별해서** 보고한다 — 후자는 그 프로필의 커버리지가 0이라는 뜻이다.
    if (unrecognized.length > 0) {
      return {state: 'UNRECOGNIZED', unrecognized,
        note: `표에 소스 경로가 ${unrecognized.length}건 있으나 이 검사가 읽는 접두(\`src/\`·\`api/\`)가 아니다: `
          + `${unrecognized.slice(0, 3).join(', ')}. 이 프로필(Next.js \`app/\`·모노레포 등)에는 커버리지가 없다`}
    }
    return {state: 'NO_DECLARED_PATHS', note: 'layout-spec의 표에 소스 경로 선언이 없다 — 요구하지 않는다'}
  }
  const unbound = declared.filter(relativePath => !existsSync(join(projectRoot, relativePath)))
  if (unbound.length > 0) {
    return {state: 'UNBOUND', declared: declared.length, bound: declared.length - unbound.length, unbound, unrecognized,
      note: `layout-spec이 선언한 소스 경로 ${unbound.length}/${declared.length}건이 실재하지 않는다: ${unbound.join(', ')}. `
        + '미구현인지 개명인지는 **이 검사가 판정하지 못한다** — 미구현이면 만들고, 개명이면 layout-spec을 고친다'}
  }
  return {state: 'BOUND', declared: declared.length, bound: declared.length, unrecognized,
    note: `layout-spec이 선언한 소스 경로 ${declared.length}건이 전부 실재한다`
      + (unrecognized.length > 0 ? ` — 다만 읽지 못한 경로가 ${unrecognized.length}건 있다(접두 밖)` : '')}
}

// 확정된 스팩이 있으면 릴리스가 그 스팩에 묶인다(Stage 2b 배선).
// **스팩이 없으면 발화하지 않는다** — 스팩은 opt-in이고, 한 번 확정하면 구속력을 갖는다.
// visual-qa-contract.json 존재가 시각 QA를 활성화하는 것과 같은 관용구다.
// 정합 검사가 판정하지 못한 것(unverifiable)은 여기서 errors로 올리지 않는다 — 미판정을
// 실패로 바꾸는 것도, 통과로 바꾸는 것도 아니다.
// 릴리스 산출물에 **수용 기준의 상태**를 남긴다.
//
// `specTier: "unverifiable"`은 "설계는 확정됐으나 맞는지 판정할 기준이 없다"는 뜻이다.
// 이것을 FAIL로 바꾸면 기획 없는 브라운필드 개선이 막히고, 조용히 두면 **수용 기준 없이
// 만들어진 결과가 그 사실을 잃은 채 릴리스된다**. 그래서 막지 않되 **표기한다** —
// 나중에 이 릴리스를 보는 사람이 무엇이 검증되지 않았는지 알 수 있어야 한다(2026-08-28).

export const acceptanceSummary = projectRoot => {
  const specPath = join(resolve(projectRoot), '_workspace/03_dev/spec.json')
  if (!existsSync(specPath)) return {state: 'NO_SPEC', note: '확정 스팩이 없다 — 수용 기준 추적 없음'}
  let spec
  try { spec = JSON.parse(readFileSync(specPath, 'utf8')) } catch { return {state: 'INVALID_SPEC', note: 'spec.json을 읽을 수 없다'} }
  const refs = Array.isArray(spec?.acceptanceRefs) ? spec.acceptanceRefs : []
  if (spec?.specTier === 'verifiable') {
    return {state: 'VERIFIABLE', acceptanceRefs: refs, note: `수용 기준 ${refs.length}건에 결박된 릴리스다`}
  }
  return {
    state: 'UNVERIFIABLE',
    acceptanceRefs: refs,
    note: '수용 기준 없이 확정된 스팩이다 — 이 릴리스는 ‘요구를 만족하는가’를 판정할 기준을 갖지 않는다. 검증된 것은 게이트가 본 것(lint·typecheck·test·build)뿐이다',
  }
}
