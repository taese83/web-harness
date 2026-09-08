#!/usr/bin/env node
// design-evidence-lib.mjs — 설계 산출물이 남긴 증거를 릴리스 시점에 읽는다.
//
// `release-gate-lib`에서 분리했다(2026-09-08). 이유는 모듈성 게이트 400줄 상한이고,
// **줄을 합쳐 맞추지 않았다** — 그것은 `docs/protected-core.md` §4 「스크립트 400줄 제한」이
// 이미 등록한 우회다. 여기 모은 둘은 성격이 같다: **설계가 선언한 것이 실물로 남았는가**를
// 파일 존재로 대조하고, 판정이 아니라 보고를 낸다.
//
// 경로 대조와 심볼 대조가 여기 함께 있다 — 한계는 §4에 등록돼 있다.
import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {createRequire} from 'node:module'

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
    return {state: 'UNBOUND', declared: declared.length, bound: declared.length - unbound.length, unbound, unrecognized, declaredPaths: declared,
      note: `layout-spec이 선언한 소스 경로 ${unbound.length}/${declared.length}건이 실재하지 않는다: ${unbound.join(', ')}. `
        + '미구현인지 개명인지는 **이 검사가 판정하지 못한다** — 미구현이면 만들고, 개명이면 layout-spec을 고친다'}
  }
  return {state: 'BOUND', declared: declared.length, bound: declared.length, unrecognized, declaredPaths: declared, unbound: [],
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

// ── 심볼 수준 대조 — 경로로 못 풀던 것을 푼다 ────────────────────────────────
// 경로만 보면 **이름이 같은 미구현과 개명이 똑같이 보인다**(2026-09-08 실측, 위 `routeBinding`
// 머리말). 구별하려면 「선언된 심볼이 다른 파일에 있는가」를 봐야 하고, 파서 없이는 안 된다.
//
// **하네스에 의존성을 넣지 않는다.** 생성 프로젝트는 이미 TypeScript를 갖고 있고
// (`validate-environment-closure`가 `typecheck` script를 요구한다) 그것을 **빌려 쓴다**.
// 없으면 `NOT_MEASURED`이며 **통과가 아니다.**
//
// **막지 않는다.** 실측(4개 프로젝트)에서 완주한 두 곳도 미구현 항목을 갖고 있어, 차단하면
// 기존 프로젝트가 소급해 막힌다. 이 단계가 바꾸는 것은 **보고의 결정력**이지 강도가 아니다.
//
// **한계(§4 등록)**: ① 기대 심볼을 **파일명에서 유도**한다 — 이름까지 바뀐 개명은 미구현으로
// 읽힌다(실측: `minicar-laptime`의 `*Page` 3건은 실제로 `*Screen`으로 존재한다)
// ② `index.*` 배럴은 유도하지 않는다 ③ `export * from`을 따라가지 않는다
// ④ **실재하는 파일은 export가 하나라도(타입 포함) 있으면 통과한다** — 파일명과 심볼이 다른 것이 정상인
// 경우가 실측 12건 중 2건(`Routes.tsx` → `AppRouter`)이라 일치를 요구하면 오탐이 된다
// ⑤ 스캔 상한에 걸리면 미구현 판정을 **보류**한다(부분 색인으로 「없다」고 말하지 않는다).
const TS_ENTRY = 'node_modules/typescript/lib/typescript.js'
// 선언 접두(`SOURCE_PATH`)가 받는 확장자와 **같은 집합**이어야 한다 — 어긋나면 선언은
// 받아들이면서 색인은 안 해 그 파일이 영구 미구현으로 읽힌다(`.mjs`가 그랬다).
const SOURCE_EXT = /\.(?:tsx?|jsx?|mjs)$/
const BARREL = /^index\.\w+$/
// 심볼 색인은 전수 파싱이라 비용이 있다. 릴리스 1회 실행이지만 상한을 둔다.
const MAX_SCAN = 1500

export const exportedNames = (ts, source, fileName) => {
  // `.ts`를 TSX로 파싱하면 `<T>expr` 단언이 JSX로 읽혀 복구 파싱에 들어간다 — 확장자로 고른다.
  const kind = /\.[tj]sx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind)
  const names = []
  const modifiersOf = node => ts.getModifiers?.(node) ?? node.modifiers ?? []
  const carries = (node, kind_) => modifiersOf(node).some(modifier => modifier.kind === kind_)
  file.forEachChild(node => {
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      names.push(...node.exportClause.elements.map(element => element.name.text))
      return
    }
    if (ts.isExportAssignment(node)) {
      // `const HomePage = …; export default HomePage`는 Next/CRA의 지배적 관용구다.
      // 로컬 이름을 함께 담지 않으면 그 프로젝트의 개명이 전부 미구현으로 접힌다.
      names.push('default')
      if (ts.isIdentifier(node.expression)) names.push(node.expression.text)
      return
    }
    if (!carries(node, ts.SyntaxKind.ExportKeyword)) return
    if (carries(node, ts.SyntaxKind.DefaultKeyword)) names.push('default')
    // 타입 전용 선언도 export다 — 세지 않으면 타입만 담은 파일이 「껍데기」로 오탐된다.
    const named = ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)
      || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)
    if (named && node.name) names.push(node.name.text)
    else if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text)
      }
    }
  })
  return [...new Set(names)]
}

// 프로젝트가 가진 TypeScript로 export 추출기를 만든다. **동기다** — `typescript.js`는
// CommonJS라 `createRequire`로 불러올 수 있고, 그래야 매니페스트 조립(동기)에 그대로 들어간다.
const requireFromHere = createRequire(import.meta.url)
export const projectExportReader = projectRoot => {
  const entry = join(projectRoot, TS_ENTRY)
  if (!existsSync(entry)) return null
  let ts
  try { ts = requireFromHere(entry) } catch { return null }
  const read = (source, fileName) => exportedNames(ts, source, fileName)
  read.parser = `TypeScript ${ts.version}`
  return read
}

const sourceFiles = (projectRoot, relative, limit, collected = []) => {
  if (collected.length >= limit) return collected
  const directory = join(projectRoot, relative)
  if (!existsSync(directory)) return collected
  let entries
  try { entries = readdirSync(directory, {withFileTypes: true}) } catch { return collected }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    if (collected.length >= limit) break
    const next = `${relative}/${entry.name}`
    if (entry.isDirectory()) sourceFiles(projectRoot, next, limit, collected)
    else if (SOURCE_EXT.test(entry.name)) collected.push(next)
  }
  return collected
}

// 선언된 경로에서 기대 심볼을 유도한다. 배럴은 유도하지 않는다 — `index`는 심볼이 아니다.
export const expectedSymbol = relativePath => {
  const base = relativePath.split('/').pop() ?? ''
  if (BARREL.test(base)) return null
  return base.replace(SOURCE_EXT, '') || null
}

// `home-page.tsx`처럼 파일명이 식별자가 아닌 관용구가 있다 — PascalCase 변환을 함께 본다.
// **넓히는 방향으로만 틀린다**: 더 찾으면 「개명」(약한 판정)이 되고, 못 찾아야 「미구현」이다.
const candidatesOf = symbol => [...new Set([
  symbol, symbol.split(/[-_.]/).filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join(''),
])]

export function resolveSymbols(projectPath, binding, {readExports, maxScan = MAX_SCAN} = {}) {
  const projectRoot = resolve(projectPath)
  if (!binding || !['BOUND', 'UNBOUND'].includes(binding.state)) {
    return {state: 'NOT_APPLICABLE', note: '경로 결속이 서지 않아 심볼을 볼 수 없다'}
  }
  // 추출기를 주입받을 수 있다. 회귀가 **CI에서 실제로 발화하려면** 분류 로직이 저장소 밖
  // (gitignore된 `workspace/`)의 파서에 결박되면 안 된다 — 그 결박이 vacuous green을 만든다.
  const read = readExports ?? projectExportReader(projectRoot)
  if (!read) {
    // **통과가 아니다.** 파싱 수단이 없으면 없는 것을 있다고 하지 않는다.
    return {state: 'NOT_MEASURED', note: `${TS_ENTRY}가 없어 심볼을 파싱하지 못했다 — 미수행이며 통과가 아니다`}
  }
  const namesOf = relative => {
    try { return read(readFileSync(join(projectRoot, relative), 'utf8'), relative) } catch { return null }
  }
  const files = sourceFiles(projectRoot, 'src', maxScan).concat(sourceFiles(projectRoot, 'api', maxScan))
  const truncated = files.length >= maxScan
  const index = new Map()
  for (const relative of files) {
    for (const name of namesOf(relative) ?? []) {
      if (!index.has(name)) index.set(name, [])
      index.get(name).push(relative)
    }
  }
  // 실재하는데 **아무것도 export하지 않는** 파일. 경로 검사가 통과시키던 구멍이다.
  // 여기까지가 이 단계가 실재 파일에 대해 말할 수 있는 전부다 — 기대 심볼 일치는 요구하지
  // 않는다(위 한계 ④).
  const hollow = (binding.declaredPaths ?? []).filter(relative => (namesOf(relative) ?? null)?.length === 0)
  const renamed = []
  const unbuilt = []
  const unresolved = []
  for (const relative of binding.unbound ?? []) {
    const symbol = expectedSymbol(relative)
    if (symbol === null) { unresolved.push(relative); continue }
    const found = candidatesOf(symbol).map(name => index.get(name)).find(hit => hit && hit.length > 0)
    if (found) renamed.push({declared: relative, actual: found[0], symbol})
    else unbuilt.push(relative)
  }
  // 색인이 잘렸으면 「어디에도 없다」고 말할 근거가 없다 — 판정을 보류로 넘긴다.
  const deferred = truncated ? unbuilt.splice(0) : []
  unresolved.push(...deferred)
  const parts = []
  if (renamed.length > 0) parts.push(`개명 ${renamed.length}건`)
  if (unbuilt.length > 0) parts.push(`그 이름이 어디에도 없음 ${unbuilt.length}건`)
  if (hollow.length > 0) parts.push(`export 없는 파일 ${hollow.length}건`)
  if (unresolved.length > 0) parts.push(`판정 보류 ${unresolved.length}건(배럴·색인 절단)`)
  // **보류를 RESOLVED로 접지 않는다.** 절단·배럴로 판정하지 못한 것이 있으면 `PARTIAL`이다 —
  // 접으면 「전부 제자리」라는 라벨이 실제로 안 본 것을 덮는다.
  const state = unbuilt.length > 0 ? 'UNBUILT'
    : (renamed.length > 0 || hollow.length > 0 ? 'DIVERGED' : (unresolved.length > 0 ? 'PARTIAL' : 'RESOLVED'))
  const cut = truncated ? ` — 스캔 상한 ${maxScan} 도달, 부분 색인이며 「어디에도 없음」 판정을 보류했다` : ''
  return {
    state, renamed, unbuilt, hollow, unresolved, scanned: files.length, truncated, parser: read.parser ?? '주입된 추출기',
    note: parts.length === 0
      ? `선언된 경로가 전부 실재하고 그 파일들이 export를 갖는다 (소스 ${files.length}개, ${read.parser ?? '주입된 추출기'})${cut}`
      : `${parts.join(' · ')} — ${[
        ...renamed.slice(0, 4).map(item => `${item.declared} → ${item.actual}`),
        ...(unbuilt.length > 0 ? [`이름 없음: ${unbuilt.slice(0, 4).join(', ')}`] : []),
        ...(unresolved.length > 0 ? [`보류: ${unresolved.slice(0, 4).join(', ')}`] : []),
      ].join(' / ')}${cut}`,
  }
}
