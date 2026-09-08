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
import {ledgerState, parseLedger} from './ticket/ledger.mjs'
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {parseFeaturePlanUnits} from './ticket/plan-units.mjs'
import {claimScopeReadiness, findPathCollisions} from './ticket/claim-scope.mjs'
import {extractDecisionBlock} from './spec.mjs'
import {checkDecisionsApplied} from './validate-development-readiness.mjs'
import {readSpecAt} from './validate-spawn-plan.mjs'
import {hasUserInterface} from './spec.mjs'
import {DESIGN_BINDING_PATH, collectDesignBinding, conditionKey, conditionLabel} from './design-binding-lib.mjs'

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

/** 계획 산문 — flat `feature-plan.md`와 sharded `feature-plan/` 양형을 모두 읽는다. */
export function planSources(root) {
  const out = []
  const flat = join(root, '_workspace/01_plan/feature-plan.md')
  if (existsSync(flat) && statSync(flat).isFile()) out.push(readFileSync(flat, 'utf8'))
  const dir = join(root, '_workspace/01_plan/feature-plan')
  if (existsSync(dir) && statSync(dir).isDirectory()) {
    for (const name of readdirSync(dir).filter(n => n.endsWith('.md'))) {
      out.push(readFileSync(join(dir, name), 'utf8'))
    }
  }
  return out
}

// 선언이 없는데 산문만 있는 것이 구멍이다 — 오늘 실제로 그랬다.
const ORDERING_PROSE = /(병렬|선행|먼저|이후|순차|→)/
export function checkProseOnlyOrdering(root, units) {
  if (!units || units.length === 0) return skip('prose-ordering', '단위를 읽지 못해 대조할 수 없다')
  const declared = units.filter(u => Array.isArray(u.dependsOn) && u.dependsOn.length > 0).length
  if (declared > 0) return ok('prose-ordering', `의존 엣지가 ${declared}건 선언돼 있다`)
  // 계획은 flat(`feature-plan.md`)일 수도 sharded(`feature-plan/`)일 수도 있다 — 한쪽만
  // 읽으면 다른 쪽에서 "산문이 없다"는 **거짓 PASS**가 난다(SKIP도 아니다). 이 저장소가
  // 계획 로더에서 이미 겪은 flat/sharded 비대칭 클래스의 잔존이었다(2026-08-30 리뷰).
  const sources = planSources(root)
  const proseHit = sources.some(text => ORDERING_PROSE.test(text) && /FEAT-\d{3,}/.test(text))
  if (sources.length === 0) return skip('prose-ordering', '계획 문서를 찾지 못해 대조할 수 없다')
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
// 앵커는 **파서와 같은 언어 집합**이어야 한다. 종전에는 이 검사가 한국어 헤딩만 인정하고
// 파서는 영어도 받아, 영어로 산출하는 생산자 템플릿의 정상 출력이 여기서 먼저 막혔다
// (교차 모델 리뷰 2026-09-04). 두 판정이 어긋나면 어느 쪽이 진실인지 아무도 모른다.
const REQUIRED_PLAN_SECTIONS = [
  {file: '_workspace/01_plan/ux-brief', anchor: /(?:^|\n)#{1,6}[^\S\n]*(?:화면별 정보 위계|Information hierarchy)/i, heading: '화면별 정보 위계', why: '레이아웃을 정할 근거'},
  {file: '_workspace/01_plan/ux-brief', anchor: /(?:^|\n)#{1,6}[^\S\n]*(?:디자인 방향|Design direction)/i, heading: '디자인 방향', why: '시각 위계를 정할 근거'},
]

const readPlanArtifact = (root, base) => {
  const flat = join(root, `${base}.md`)
  if (existsSync(flat) && statSync(flat).isFile()) return readFileSync(flat, 'utf8')
  const dir = join(root, base)
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return null
  return readdirSync(dir).filter(n => n.endsWith('.md')).sort()
    .map(n => readFileSync(join(dir, n), 'utf8')).join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// 공급물의 소비 대조 — 받았다는 기록과 썼다는 기록을 맞춘다
//
// `supplied`는 자기보고였다. `00_source/`에 인벤토리를 남기고도 그 내용이 정규화 산출물에
// 실제로 반영됐는지는 아무도 대조하지 않았고, `PLAN_SOURCE: supplied`가 완료 보고에 사실처럼
// 실렸다(`provenance-contract.md` §2 「`supplied`의 한계」가 그렇게 적는다).
//
// 대조 가능하려면 인벤토리가 기계가 읽는 형식이어야 한다. 실측(2026-09-08)에서 두 프로브의
// `source-index.md`는 **형식이 서로 완전히 달랐다**(가로 인벤토리 표 / 세로 key-value 표) —
// 계약이 「기록한다」까지만 정하고 형태를 고정하지 않았기 때문이다.
const SOURCE_INDEX = '_workspace/00_source/source-index.md'
const CONSUMED_HEADER = /^(소비 지점|consumed by)$/i
const SNAPSHOT_HEADER = /^(스냅샷 경로|스냅샷|snapshot)$/i
const CONSUMED_NONE = /^없음\s*\(/

// 인벤토리 행이 가리키는 산출물은 flat(`x.md`)일 수도 분할(`x/`)일 수도 있다 —
// `readPlanArtifact`와 같은 규율이다(`artifact-sharding-contract.md`).
const readWorkspaceArtifact = (root, rel) => {
  const clean = rel.replace(/^\.?\/*/, '').replace(/^_workspace\//, '')
  const flat = join(root, '_workspace', clean.endsWith('.md') ? clean : `${clean}.md`)
  if (existsSync(flat) && statSync(flat).isFile()) return readFileSync(flat, 'utf8')
  const dir = join(root, '_workspace', clean.replace(/\.md$/, ''))
  if (existsSync(dir) && statSync(dir).isDirectory()) {
    return readdirSync(dir).filter(n => n.endsWith('.md')).sort()
      .map(n => readFileSync(join(dir, n), 'utf8')).join('\n')
  }
  return null
}

export function parseSourceInventory(text) {
  const lines = String(text ?? '').split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].trim().startsWith('|')) continue
    const headers = tableCells(lines[i])
    const consumedAt = headers.findIndex(h => CONSUMED_HEADER.test(h))
    if (consumedAt === -1) continue
    const snapshotAt = headers.findIndex(h => SNAPSHOT_HEADER.test(h))
    const rows = []
    for (let j = i + 1; j < lines.length && lines[j].trim().startsWith('|'); j += 1) {
      const cells = tableCells(lines[j])
      if (isSeparatorRow(cells, headers.length)) continue
      rows.push({
        label: (cells[0] ?? '').replace(/`/g, '').trim() || `행 ${rows.length + 1}`,
        consumed: (cells[consumedAt] ?? '').trim(),
        snapshot: snapshotAt === -1 ? '' : (cells[snapshotAt] ?? '').trim(),
      })
    }
    return {found: true, rows}
  }
  return {found: false, rows: []}
}

// 소비 지점 칸에서 산출물 경로만 뽑는다. 산문이 섞여도(`01_plan/requirements.md 3절`) 읽힌다.
const consumedPaths = cell => [...String(cell).matchAll(/(?:_workspace\/)?(0[12]_[a-z]+\/[A-Za-z0-9_\-.]+)/g)]
  .map(m => m[1].replace(/\.md$/, ''))

export function checkSourceConsumption(root) {
  const indexPath = join(root, SOURCE_INDEX)
  if (!existsSync(indexPath)) {
    return skip('source-consumption', '공급 원문 인벤토리가 없다 — 이 프로젝트는 공급 경로를 쓰지 않았다')
  }
  const inventory = parseSourceInventory(readFileSync(indexPath, 'utf8'))
  if (!inventory.found) {
    return hole('source-consumption', `${SOURCE_INDEX}에 「소비 지점」 열을 가진 인벤토리 표가 없다`,
      'source-artifacts.md 「인벤토리 표」 형식으로 적는다 — 열이 없으면 무엇이 어디로 갔는지 기계가 읽지 못하고 공급원 라벨은 자기보고로 남는다')
  }
  if (inventory.rows.length === 0) {
    return hole('source-consumption', `${SOURCE_INDEX}의 인벤토리 표에 행이 없다`,
      '받은 원문을 행으로 적는다 — 표만 있고 행이 없으면 "받은 것이 없다"와 "적지 않았다"를 구별할 수 없다')
  }
  const problems = []
  let traced = 0
  for (const row of inventory.rows) {
    if (row.consumed === '') { problems.push(`${row.label}: 소비 지점 빈 칸`); continue }
    if (CONSUMED_NONE.test(row.consumed)) continue   // `없음(사유)` — 받았으나 쓰지 않았다는 **결정**
    const targets = consumedPaths(row.consumed)
    if (targets.length === 0) { problems.push(`${row.label}: 소비 지점에 산출물 경로가 없다`); continue }
    for (const target of targets) {
      const text = readWorkspaceArtifact(root, target)
      if (text === null) { problems.push(`${row.label} → ${target} 없음`); continue }
      if (!/^#{2,3}\s*Source Trace/m.test(text)) { problems.push(`${row.label} → ${target}에 Source Trace 절이 없다`); continue }
      // **역방향.** 산출물이 그 원문을 되짚는가. 스냅샷 파일명으로 맞춘다 — 경로 표기가
      // 문서마다 달라도(`_workspace/00_source/…` vs `00_source/…`) 파일명은 같다.
      const snapshotName = (row.snapshot.replace(/`/g, '').trim().split('/').pop() ?? '').trim()
      if (snapshotName !== '' && !text.includes(snapshotName)) {
        problems.push(`${row.label} → ${target}의 Source Trace가 ${snapshotName}을 되짚지 않는다`)
        continue
      }
      traced += 1
    }
  }
  if (problems.length > 0) {
    return hole('source-consumption', `공급물 소비 대조 실패 ${problems.length}건: ${problems.join(' · ')}`,
      '인벤토리의 각 원문이 어느 산출물로 갔는지 적고, 그 산출물의 Source Trace가 같은 스냅샷을 되짚게 한다. 쓰지 않았으면 `없음(사유)`로 **명시**한다 — 빈 칸은 결정이 아니라 미기록이다')
  }
  return ok('source-consumption', `공급 원문 ${inventory.rows.length}건이 산출물로 이어진다 · 양방향 대조 ${traced}건`)
}

export function checkDesignInputs(root) {
  const missing = []
  for (const section of REQUIRED_PLAN_SECTIONS) {
    const text = readPlanArtifact(root, section.file)
    if (text === null) { missing.push(`${section.file} 없음`); continue }
    if (!section.anchor.test(text)) missing.push(`${section.heading}(${section.why})`)
  }
  if (missing.length > 0) {
    return hole('design-inputs', `디자인 입력 누락: ${missing.join(' · ')}`,
      'design-readiness-contract.md의 필수 절을 채운다 — 없으면 디자인이 추론으로 메우고 그 추론이 개발까지 흘러간다')
  }
  // 절이 있는 것과 채워진 것은 다르다. 종전에는 헤딩 존재만 봤고, 그래서 표를 만들고 상태
  // 칸을 비워두면 통과했다 — 조건 분모가 0이면 커버리지도 0/0으로 서고, **조건을 안 적는
  // 것이 통과하는 길**이 된다(protected-core §4 등록 항목의 부분 해소).
  const table = parseInformationHierarchy(readPlanArtifact(root, '_workspace/01_plan/ux-brief'))
  const problems = denominatorProblems(table, planSources(root).flatMap(parsePageGroups))
  if (problems.length > 0) {
    return hole('design-inputs', problems.join(' · '),
      '내용을 적거나, 그 조건이 이 화면에 없으면 `해당 없음(사유)`로 **명시**한다. 조건 열의 헤더에는 축 접두를 붙인다(`state:empty`·`variant:권한 없음`) — 접두가 없으면 그 열은 서술로 읽혀 분모에서 빠지고, 커버리지가 조용히 default 하나로 줄어든다(design-readiness-contract §1)')
  }
  return ok('design-inputs', `디자인이 요구하는 기획 절이 전부 있다 · 화면 ${table.rows.length}개 · 조건 열 ${table.axes.length}개`)
}

// 분모 자체가 서 있는가. `design-inputs`와 `design-binding`이 **같은 함수**를 부른다 —
// 판정을 복제하면 문구가 갈라지고, 같은 사실이 구멍 둘로 보고된다(적대 리뷰 2026-09-04).
// 중복 보고는 호출부에서 막는다(`analyzeHandoffReadiness`가 design 인계에서만 design-inputs를
// 세우고, 개발 인계에서는 design-binding이 든다).
export function denominatorProblems(table, groups = []) {
  // 절을 **헤딩으로** 찾지 못한 것도 분모 부재다. 필수 절 검사는 `includes`라 산문에 그
  // 문구만 있어도 통과하는데, 파서는 헤딩을 요구한다 — 두 판정이 어긋나면 표가 전혀 없는
  // 문서가 통과한다(교차 모델 리뷰 2026-09-04).
  if (!table.present) return ['「화면별 정보 위계」를 헤딩으로 찾지 못했다 — 산문에 문구만 있으면 조건 분모가 서지 않는다']
  const problems = []
  if (table.malformed) {
    problems.push('정보 위계 표에 구분선(`|---|`)이 없다 — 마크다운 표가 아니면 헤더가 데이터 행으로 읽혀 판정이 통째로 어긋난다')
  } else if (table.rows.length === 0) {
    problems.push('정보 위계 절에 표가 없다 — 헤딩만 있으면 조건 분모가 서지 않는다')
  }
  if (table.blanks.length > 0) {
    problems.push(`정보 위계 표의 빈 칸 ${table.blanks.length}건: ${table.blanks.slice(0, 6).join(', ')} — 빈 칸은 결정이 아니라 미결이고, 그 자리는 조건 분모에서 빠진다`)
  }
  // 형 없는 열은 **유효한 축이 함께 있어도** 보고한다. `state:empty` 하나만 형을 붙이고
  // 나머지를 그대로 두면 그 나머지가 분모에서 빠지던 자리다(교차 모델 리뷰 2026-09-04).
  if (table.untypedHeaders.length > 0) {
    const hint = table.untypedHeaders.filter(header => LEGACY_CONDITION_HEADER.test(header))
    problems.push(`형이 없는 열 ${table.untypedHeaders.length}개: ${table.untypedHeaders.slice(0, 6).join(', ')} — 조건이면 \`state:empty\`·\`variant:권한 없음\`, 서술이면 \`info:밀도\` 형식으로 적는다. 형이 없으면 조건인지 서술인지 알 수 없어 분모에서 빠진다`
      + (hint.length > 0 ? ` (조건으로 보이는 것: ${hint.slice(0, 4).join(', ')})` : ''))
  }
  if (table.rows.length > 0 && table.axes.length === 0 && table.untypedHeaders.length === 0) {
    problems.push('조건 열이 하나도 없다 — 화면마다 기본 조건 하나만 분모에 서고, 권한 없음·빈 상태는 아무도 요구하지 않게 된다')
  }
  // 기본 조건(`state:default`)을 요구하는 근거는 Primary·Secondary 서술이다. 그 열이 없으면
  // 서술하지 않은 것을 서술했다고 가정하는 셈이고, 정보 위계가 비어 있는 문서가 통과한다
  // (교차 모델 리뷰 2026-09-04).
  if (table.rows.length > 0 && table.infoHeaders.length === 0) {
    problems.push('서술 열(`info:`)이 하나도 없다 — Primary·Secondary가 없으면 기본 조건을 무엇으로 서술했다고 볼 근거가 없다')
  }
  // 행이 어느 화면의 것인지 여기서 판정한다. 종전에는 바인딩 문서가 있을 때만 봤는데,
  // 그러면 디자인 근거가 붙기 전에는 해소되지 않는 행이 조용히 통과했다 — 계약이 loud라고
  // 적어둔 자리다(교차 모델 리뷰 2026-09-04).
  // Page Groups가 없으면 **판정을 생략하지 않고 그 사실을 올린다.** 종전에는 조용히
  // 넘겼는데, 그러면 Page Groups만 빠뜨리는 것으로 조건 커버리지 전체를 끌 수 있었다
  // (교차 모델 리뷰 2026-09-04). 못 재는 것과 잴 것이 없는 것은 다르고, 못 재면 말한다.
  if (groups.length === 0) {
    return [...problems, 'Page Groups 표를 읽지 못했다 — 정보 위계 행이 어느 화면인지 해소할 수 없어 조건 커버리지를 잴 수 없다']
  }
  const unresolved = table.rows.map(row => row.key).filter(key => resolvePageGroup(groups, key) === null)
  if (unresolved.length > 0) {
    problems.push(`Page Groups로 해소되지 않는 정보 위계 행 ${unresolved.length}건: ${unresolved.slice(0, 6).join(', ')} — 첫 열은 PAGE-NNN이거나 Page Groups의 Page·Route/Screen과 정확히 같아야 한다`)
  }
  // 반대 방향도 본다. 한쪽만 보면 **행을 통째로 빼는 것**이 분모를 줄이는 길이 된다 —
  // PAGE-002를 선언해놓고 정보 위계에 적지 않으면 그 화면의 조건이 아무도 요구하지 않는
  // 상태가 됐다(교차 모델 리뷰 2026-09-04, 유령 화면 대조와 같은 클래스).
  const described = new Set(table.rows.map(row => resolvePageGroup(groups, row.key)))
  const undescribed = groups.map(row => row.id).filter(id => id !== 'PAGE-000' && !described.has(id))
  if (undescribed.length > 0) {
    problems.push(`정보 위계 행이 없는 화면 ${undescribed.length}건: ${[...new Set(undescribed)].slice(0, 6).join(', ')} — 표에 없는 화면은 조건 분모가 서지 않아 권한 없음·빈 상태를 아무도 요구하지 않게 된다`)
  }
  return problems
}

// 정보 위계 행의 첫 열을 PAGE-NNN으로 해소한다 — ID 자체이거나, Page Groups의
// `Page`·`Route/Screen`과 정확히 일치하는 이름이다.
const resolvePageGroup = (groups, key) => groups.find(row =>
  row.id === key || normalizeKey(row.page) === key || normalizeKey(row.route) === key)?.id ?? null

// ── 조건의 분모 — ux-brief 「화면별 정보 위계」 표 ───────────────────────────
// 하나의 화면은 조건에 따라 여러 디자인을 갖는다. 그 조건 목록의 정본이 이 표이며
// (`design-readiness-contract.md` §1), `design-binding`이 이것을 분모로 커버리지를 판정한다.
//
// 조건 열은 헤더가 `축:값`이다(`state:empty`·`variant:권한 없음`). 접두 없는 열은 서술이다.
// `state:default`는 열로 두지 않는다 — Primary·Secondary가 그것을 서술하므로 표에 오른 모든
// 화면이 기본 조건을 갖는 것으로 본다.
//
// **한계(정직)**: 절 앵커가 한국어·영어 헤딩 문자열이라 다른 언어로 옮기면 발화하지 않는다
// (산문 간선 대조와 같은 클래스, protected-core §4).
const HIERARCHY_SECTION = /(?:^|\n)#{1,6}[^\S\n]*(?:화면별 정보 위계|Information hierarchy)[^\n]*\n([\s\S]*?)(?=\n#{1,6}[^\S\n]|$)/gi
// 표의 열은 **전부 형이 붙는다** — 조건은 `state|modeId|variant`, 서술은 `info`.
// 종전에는 접두 없는 열을 키워드 휴리스틱으로 골라냈는데, 그것은 완전할 수 없다:
// `무료 플랜 시` 같은 임의의 variant 조건이 목록에 없으면 조용히 서술로 버려졌다
// (교차 모델 리뷰 2026-09-04). 형을 전부 요구하면 판정이 **전역 함수**가 된다 — 형이 없는
// 열은 조건인지 서술인지 하네스가 알 수 없고, 알 수 없는 것을 통과시키지 않는다.
const COLUMN_HEADER = /^(state|modeId|variant|info)[^\S\n]*:[^\S\n]*(.+)$/
const CONDITION_AXES = ['state', 'modeId', 'variant']
// `\b`를 쓰지 않는다 — 한글은 JS 정규식에서 비단어 문자라 `없음(` 사이에 경계가 서지 않고
// `해당 없음(사유)`가 통째로 안 잡혔다(자체 실측). 경계가 필요한 것은 라틴 표기뿐이다.
// 어휘는 실제 코퍼스에 맞춰 넓혔다 — `비적용`·`—`를 이미 쓰고 있었다(적대 리뷰 2026-09-04
// 실측 5개 워크스페이스). **어휘 결박은 남는다**: 목록 밖 낱말로 적으면 조건이 있는 것으로
// 세어져 근거를 요구한다(protected-core §4 등록).
// **칸 전체**가 N/A 표기여야 한다. 접두만 보면 `해당 없음 안내와 문의 CTA` 같은 실제 화면
// 내용이 N/A로 오인돼 그 조건이 분모에서 빠진다 — 조건 분모 축소가 다시 열리는 자리다
// (교차 모델 리뷰 2026-09-04). 괄호 안 사유는 계약이 요구하는 형식이므로 함께 받는다.
const NOT_APPLICABLE = /^(?:(?:해당\s*없음|비적용|not\s*applicable|n\/a)\s*(?:[(（][^)）]*[)）])?|[-—–]+)$/i
// 형 없는 열이 조건이었을 가능성을 **문구로만** 쓴다(판정이 아니라 안내). 실측 5/5
// 워크스페이스가 종전 형식이었으므로 이행 대상을 이름으로 짚어준다.
const LEGACY_CONDITION_HEADER = /(?:empty|error|권한|permission|모바일|mobile|다크|dark|상태|state|시 내용|플랜|역할|role|plan)/i
const tableCells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
// Page Groups의 Route는 관행상 백틱으로 감싸 적는다(`` `/sessions` ``). 정규화하지 않으면
// 정보 위계 행이 정당한데도 해소되지 않는다(적대 리뷰 2026-09-04, 실측).
const normalizeKey = value => String(value ?? '').replace(/`/g, '').trim()
const isSeparatorRow = (cells, columns) => cells.length === columns && cells.every(cell => /^:?-{2,}:?$/.test(cell))

// `ux-brief`는 sharding을 지원하고 `readPlanArtifact`가 shard를 이어 붙인다. 절을 **하나만**
// 읽으면 두 번째 shard 이후의 화면이 통째로 검사에서 빠진다 — 나눠 적는 것이 게이트를 끄는
// 길이 된다(교차 모델 리뷰 2026-09-04). 그래서 모든 절을 읽어 합친다.
export function parseInformationHierarchy(text) {
  const empty = {present: false, malformed: false, rows: [], axes: [], infoHeaders: [], blanks: [], untypedHeaders: []}
  const sections = [...String(text ?? '').matchAll(HIERARCHY_SECTION)]
  if (sections.length === 0) return empty
  const parsed = sections.map(section => parseHierarchySection(section[1]))
  // 열은 절의 **합집합**이고, 그 합집합을 **모든 행에 적용한다** — 조건 열이든 서술 열이든
  // 같다. 절마다 따로 보면 한 절에 화면 행을 몰아넣고 다른 절에 데이터 없는 열만 두는 것으로
  // 분모를 비울 수 있었다(교차 모델 리뷰 2026-09-04, 조건 열에서 한 번·서술 열에서 한 번).
  // 어떤 절이든 열을 선언했으면 모든 화면이 그것에 답한다 — 해당하지 않으면 `해당 없음(사유)`로.
  const columns = [...new Map(parsed.flatMap(part => part.columns).map(column => [`${column.axis}:${column.value}`, column])).values()]
  const rows = parsed.flatMap(part => part.rows)
  const blanks = parsed.flatMap(part => part.blanks)
  for (const row of rows) {
    for (const column of columns) {
      if (!row.addressed.has(`${column.axis}:${column.value}`)) blanks.push(`${row.key}/${column.label}`)
    }
  }
  return {
    present: true,
    malformed: parsed.some(part => part.malformed),
    rows,
    axes: columns.filter(column => CONDITION_AXES.includes(column.axis)),
    infoHeaders: columns.filter(column => column.axis === 'info').map(column => column.label),
    untypedHeaders: [...new Set(parsed.flatMap(part => part.untypedHeaders))],
    blanks: [...new Set(blanks)].sort(),
  }
}

function parseHierarchySection(body) {
  const empty = {malformed: false, rows: [], columns: [], blanks: [], untypedHeaders: []}
  const lines = body.split('\n').filter(line => line.trim().startsWith('|'))
  // 절이 있는데 표가 없다. 이것을 `{rows: []}`로 조용히 돌려주면 **헤딩만 쓰면 통과**가 된다 —
  // 빈 칸 우회를 닫으면서 그 옆에 같은 우회를 열어두는 셈이다(적대 리뷰 2026-09-04).
  if (lines.length < 2) return empty
  // 구분선을 **요구한다.** 없으면 마크다운 표가 아니고, 표가 아닌 것을 표로 읽으면 헤더가
  // 데이터 행이 되어 판정이 통째로 어긋난다(교차 모델 리뷰 2026-09-04).
  if (!isSeparatorRow(tableCells(lines[1]), tableCells(lines[0]).length)) return {...empty, malformed: true}
  const headers = tableCells(lines[0])
  // 조건 열의 위치와 조건 값. 접두 없는 열은 서술이므로 분모에 들어가지 않는다.
  const typed = headers.map((header, index) => {
    const match = index === 0 ? null : header.match(COLUMN_HEADER)
    return match === null ? null : {index, axis: match[1], value: match[2].trim(), label: header}
  })
  const columns = typed.filter(column => column !== null)
  const axes = columns.filter(column => CONDITION_AXES.includes(column.axis))
  // 형이 없는 열. 조건인지 서술인지 알 수 없으므로 **전부** 이름을 들고 나온다 — 어느 것이
  // 조건이었는지 고르는 것은 사람이고, 하네스가 골라주면 그 고름이 곧 프록시다.
  const untypedHeaders = headers.filter((header, index) => index !== 0 && typed[index] === null)
  const rows = []
  const blanks = []
  // 0번은 헤더, 1번은 구분선(`|---|`). 데이터는 2번부터다.
  for (const line of lines.slice(1)) {
    const cells = tableCells(line)
    if (isSeparatorRow(cells, headers.length)) continue
    // **인용을 걷어낸 뒤 해소한다.** 이름 칸에 `(ack:PC-011)`을 적는 것이 계약이 요구하는 형태인데
    // 그대로 해소하면 Page Groups와 안 맞아 그 행이 통째로 미해소가 된다 — 계약을 따르는 것이
    // 곧 실패가 되는 자리다(자체 실측 2026-09-04).
    const key = normalizeKey(stripAcknowledgements(cells[0] ?? ''))
    if (!key) { blanks.push('<이름 없는 행>'); continue }
    // **헤더 수를 기준으로 돈다.** `cells`만 순회하면 뒤쪽 칸을 아예 생략한 짧은 행에서
    // 그 칸들이 검사 대상에서 빠진다 — 빈 칸을 미결로 잡겠다고 해놓고 가장 흔한 형태의
    // 빈 칸을 놓치는 자리였다(교차 모델 리뷰 2026-09-04).
    const conditions = []
    // 이 행이 **답한** 조건. 합침 단계에서 다른 절의 조건까지 요구하려면 무엇에 답했는지를
    // 알아야 한다 — 빈 칸이면 답한 것이 아니다.
    const addressed = new Set()
    // 인수 토큰(`ack:<ID>`). **접두를 박지 않는다** — 어느 체계인지는 결정 로그가 스스로
    // 선언하고(`declaredDecisions`) 여기서는 형태만 걷어 위에서 대조한다(`PC`·`D` 양쪽 성립).
    // 조건 칸의 토큰은 그 조건, 그 밖(이름 칸·서술 칸)의 토큰은 그 행 전체를 가리킨다.
    const cellDecisions = new Map()
    const rowDecisions = new Set()
    for (const id of citedAcknowledgements(cells[0])) rowDecisions.add(id)
    for (const [index, header] of headers.entries()) {
      if (index === 0) continue
      const cell = cells[index] ?? ''
      const column = columns.find(candidate => candidate.index === index)
      const cited = citedAcknowledgements(cell)
      if (column !== undefined && CONDITION_AXES.includes(column.axis)) {
        if (cited.length > 0) cellDecisions.set(`${column.axis}:${column.value}`, cited)
      } else {
        for (const id of cited) rowDecisions.add(id)
      }
      if (cell === '') { blanks.push(`${key}/${column?.label ?? header}`); continue }
      if (column === undefined) continue
      addressed.add(`${column.axis}:${column.value}`)
      if (!CONDITION_AXES.includes(column.axis) || NOT_APPLICABLE.test(cell)) continue
      conditions.push({[column.axis]: column.value})
    }
    rows.push({key, conditions, addressed, cellDecisions, rowDecisions: [...rowDecisions]})
  }
  return {malformed: false, rows, columns, untypedHeaders, blanks: [...new Set(blanks)].sort()}
}

// Page Groups 표의 행. 정보 위계 표의 첫 열을 PAGE-NNN으로 해소하는 데 쓴다.
export function parsePageGroups(text) {
  const rows = []
  for (const section of String(text ?? '').matchAll(/(?:^|\n)#{1,6}[^\S\n]*Page Groups[^\n]*\n([\s\S]*?)(?=\n#{1,6}[^\S\n]|$)/gi)) {
    for (const line of section[1].split('\n').filter(line => line.trim().startsWith('|'))) {
      const cells = tableCells(line)
      if (/^PAGE-\d{3,}$/.test(cells[0] ?? '')) rows.push({id: cells[0], page: cells[1] ?? '', route: cells[2] ?? ''})
    }
  }
  return rows
}

// 선언된 Page Group 집합. 정본은 `## Page Groups` **표**이지 산문의 언급이 아니다
// (design-readiness-contract §3). 문서 전체에서 `PAGE-\d+`를 긁으면 FEAT 설명이나 주석에
// 한 번 적힌 이름이 선언으로 승격되고, 그 이름에 근거를 붙여 미바인딩 검사를 우회할 수 있다
// (교차 모델 리뷰 2026-09-03). `PAGE-000`은 단일 페이지에 귀속되지 않는 전역 책임의 예약
// ID이므로 화면 근거를 요구하지 않는다.
export function pageGroupIdsIn(text) {
  const ids = new Set(parsePageGroups(text).map(row => row.id))
  ids.delete('PAGE-000')
  return [...ids]
}

// ── 공급된 디자인 근거가 기획 단위에 붙었는가 ───────────────────────────────
// 파일이 없는 것은 정상이다 — 디자인 `generated`·`absent` 경로에는 공급된 근거가 없다.
// 있으면 묻는 것은 둘이다: (1) 기록 자체가 유효한가 (2) **미결이 남아 있지 않은가.**
//
// `unbound`는 "아직 정하지 않았다"는 뜻이고, 이 자리에서 메우는 비용이 디자인·구현 중에
// 메우는 비용보다 싸다. 근거가 없다고 결정하는 것은 미결이 아니다 — 그때는 조건 행에
// `resolution: derive|reuse:`를 적으면 되고, 그것으로 `unbound`에서 빠진다.
//
// 조건 커버리지 — 기획이 선언한 조건 중 디자인 근거가 없는 것.
//
// 1차 커밋에서는 **정보성 보고**였다. 분모인 정보 위계 표가 헤딩 존재만 검사돼 빈 칸이
// 통과했고, 그 위에 게이트를 올리면 조건을 **안 적는 것이 통과하는 길**이 되기 때문이다(I5).
// 이제 분모가 서므로 게이트로 올린다.
//
// 분모의 문제는 **한 검사만** 보고한다. `design-inputs`가 서는 인계에서는 그쪽이 맡고
// (`reportDenominator: false`), 그것이 없는 개발 인계에서는 여기가 맡는다 — 같은 사실을 둘이
// 각자 보고하면 사용자는 구멍이 둘이라고 읽는다. 어느 쪽이든 분모가 깨졌으면 커버리지는
// 재지 않는다: 깨진 분모로 잰 숫자는 사실이 아니다.
//
// 절 자체의 부재도 같은 규칙이되, 보고를 아무도 안 하는 상태를 만들지 않는다. 개발 인계에서
// 이것을 빈 배열로 돌려주면 **디자인 인계를 통과한 뒤 절을 지우는 것**이 우회가 된다 —
// 개발 인계는 `design-inputs`를 다시 세우지 않기 때문이다(교차 모델 리뷰 2026-09-04).
export function conditionCoverageProblems(root, document, {reportDenominator = true} = {}) {
  const table = parseInformationHierarchy(readPlanArtifact(root, '_workspace/01_plan/ux-brief'))
  const groups = planSources(root).flatMap(parsePageGroups)
  const denominator = denominatorProblems(table, groups)
  if (!reportDenominator) return denominator.length > 0 ? [] : coverageProblems(groups, table, document)
  if (denominator.length > 0) return denominator
  return coverageProblems(groups, table, document)
}

// 분모가 선 뒤의 실제 대조. 표의 각 행이 선언한 조건마다 바인딩 행이 있는가.
function coverageProblems(groups, table, document) {
  // Page Groups를 못 읽었으면 대조하지 않는다 — 없는 것과 못 읽은 것은 다르다.
  if (table.rows.length === 0 || groups.length === 0) return []
  const resolve = key => resolvePageGroup(groups, key)
  const covered = new Map()
  for (const binding of document.bindings) {
    if (!covered.has(binding.pageGroup)) covered.set(binding.pageGroup, new Set())
    covered.get(binding.pageGroup).add(conditionKey(binding.condition))
  }
  const problems = []
  const uncovered = []
  for (const row of table.rows) {
    // 해소 실패는 `denominatorProblems`가 이미 보고했다 — 여기서 다시 세지 않는다.
    const pageGroup = resolve(row.key)
    if (pageGroup === null) continue
    if (pageGroup === 'PAGE-000') continue
    const have = covered.get(pageGroup) ?? new Set()
    // Primary·Secondary가 기본 조건을 서술하므로 표에 오른 화면은 모두 그것을 요구한다.
    for (const condition of [{state: 'default'}, ...row.conditions]) {
      if (!have.has(conditionKey(condition))) uncovered.push(`${pageGroup}[${conditionLabel(condition)}]`)
    }
  }
  if (uncovered.length > 0) {
    problems.push(`기획이 선언했으나 디자인 근거가 없는 조건 ${uncovered.length}건: ${uncovered.slice(0, 6).join(', ')}`)
  }
  return problems
}

// ── 디자인 부채 — 개발 시점에 청구할 내용 ───────────────────────────────────
// `DESIGN_SOURCE: absent`는 "디자인이 필요 없다"가 아니라 "지금 만들지 않는다"다. 그러면
// 그 결정은 사라지는 것이 아니라 **구현하는 사람에게 넘어간다** — 실측(2026-09-04)에서
// 디자인 부재는 인계 판정에 흔적을 남기지 않았고(양쪽 인계 READY, 판정 변화 0건), 그래서
// 권한 없음·빈 상태 화면이 아무도 모르게 즉흥으로 결정됐다.
//
// 이 보고는 **막지 않는다.** 막으면 `absent`를 고를 수 없게 되고, 고를 수 없으면 사용자는
// 우회로 돌아간다(`provenance-contract.md` §3이 존재하는 이유). 대신 개발이 실제로 그 화면에
// 부딪히는 자리에서 **무엇이 미결인지 이름으로** 제시해 사람이 결정하게 한다.
//
// 분모는 디자인이 아니라 **기획**이 소유한다 — `ux-brief`의 「화면별 정보 위계」 표는
// `PLAN_SOURCE`의 산출물이라 디자인이 없어도 선다. 디자인이 없을 때야말로 그 표가 조건의
// 유일한 근거다.
export function designDebtReport(root) {
  const sources = planSources(root)
  const table = parseInformationHierarchy(readPlanArtifact(root, '_workspace/01_plan/ux-brief'))
  const groups = sources.flatMap(parsePageGroups)
  const binding = collectDesignBinding(root)
  const denominator = denominatorProblems(table, groups)
  const declared = new Map()
  // **문서는 아직 검증 전이다.** `binding-invalid` 판정보다 이 순회가 먼저 돌므로 여기서
  // 형태를 가정하면 `"bindings":[null]` 같은 유효 JSON이 TypeError를 낸다 — 항상 exit 0을
  // 약속한 보고가 비정상 종료한다(교차 모델 리뷰 2026-09-04). 읽을 수 있는 행만 읽는다.
  for (const row of Array.isArray(binding.document?.bindings) ? binding.document.bindings : []) {
    if (!row || typeof row !== 'object' || typeof row.pageGroup !== 'string') continue
    if (!declared.has(row.pageGroup)) declared.set(row.pageGroup, new Map())
    declared.get(row.pageGroup).set(conditionKey(row.condition),
      Array.isArray(row.referenceIds) && row.referenceIds.length > 0 ? 'supplied' : (row.resolution ?? 'pending'))
  }
  // 인수 기록. **인용은 로그와 대조한 뒤에만 인수로 센다** — 없는 ID를 적어 미결을 지우는
  // 것은 자기신고보다 나쁘다(파일에 거짓이 남는다). 어느 ID 체계인지는 로그가 선언한다.
  const {ids: loggedDecisions} = declaredDecisions(readDecisionLog(root))
  const screens = []
  const dangling = []
  for (const row of table.rows) {
    const pageGroup = resolvePageGroup(groups, row.key)
    if (pageGroup === null || pageGroup === 'PAGE-000') continue
    const have = declared.get(pageGroup) ?? new Map()
    const verify = (cited, label) => {
      const known = cited.filter(id => loggedDecisions.has(id))
      for (const id of cited) {
        if (!loggedDecisions.has(id)) dangling.push({pageGroup, label, id})
      }
      return known[0] ?? null
    }
    const rowAck = verify(row.rowDecisions ?? [], null)
    screens.push({
      pageGroup,
      conditions: [{state: 'default'}, ...row.conditions].map(condition => {
        const label = conditionLabel(condition)
        // 근거는 두 층이다. 바인딩 행이 있으면 그것이 근거고, 없어도 정보 위계 표에 **내용**이
        // 있으면 구현이 무엇을 보여줄지는 안다 — 모르는 것은 그것을 **어떻게 그리는가**뿐이다.
        // 이 둘을 한 낱말로 부르면 청구서가 과장된다(적대 리뷰 2026-09-04): 표가 다 채워진
        // 프로젝트에 "무엇으로 그릴지 정해진 바가 없다"고 말하게 된다.
        const basis = have.get(conditionKey(condition)) ?? 'plan'
        const cellAck = verify(row.cellDecisions?.get(`${Object.keys(condition)[0]}:${Object.values(condition)[0]}`) ?? [], label)
        return {condition, label, basis, acknowledgedBy: cellAck ?? rowAck}
      }),
    })
  }
  const pick = (...values) => screens.flatMap(screen =>
    screen.conditions.filter(item => values.includes(item.basis) && item.acknowledgedBy === null)
      .map(item => ({pageGroup: screen.pageGroup, label: item.label, basis: item.basis})))
  const acknowledged = screens.flatMap(screen =>
    // **부채였던 것만 센다.** `derive`·`reuse:*`는 이미 결정된 조건이라 인수 대상이 아니다.
    screen.conditions.filter(item => ['plan', 'pending'].includes(item.basis) && item.acknowledgedBy !== null)
      .map(item => ({pageGroup: screen.pageGroup, label: item.label, acknowledgedBy: item.acknowledgedBy})))
  return {
    schemaVersion: 1,
    // **"기획이 없다"를 "화면이 없다"로 말하지 않는다.** 둘을 한 분기로 뭉개면 부채가 최대인
    // 상태(기획·디자인 둘 다 absent, 브라운필드 첫 작업)에서 "청구할 것이 없다"가 나온다 —
    // 이 저장소가 Page Groups 부재에서 이미 닫은 클래스가 보고에서 다시 열린 것이었다
    // (적대 리뷰 2026-09-04, 실제 트리 2곳에서 재현).
    status: designDebtStatus({root, sources, table, groups, denominator, screens, binding}),
    bindingPresent: binding.present,
    // 공급원 선언. `null`은 **모른다**이지 `generated`가 아니다 — 마커가 없으면 단정하지 않는다.
    designSource: declaredDesignSource(root),
    denominatorProblems: denominator,
    bindingProblems: binding.errors,
    screens,
    deferred: pick('pending'),
    planOnly: pick('plan'),
    // 인수된 미결 — 시각 근거는 없고 **결정만 있다**. 인용된 ID가 결정 로그에 실재할 때만
    // 여기 들어온다(파일 대조). 이것이 자기신고를 파일 대조로 바꾸는 자리다.
    acknowledged,
    // 한 결정이 몇 조건을 인수했는가. **값을 검사하지 않고 낼 수 있는 정직한 신호**다 —
    // 결정 하나로 전건을 인수하는 것은 허용 형태이지만(범위 없는 인수), 그 사실이 숫자로
    // 보이면 사람이 판단할 수 있다(적대 리뷰 2026-09-04).
    acknowledgementFanOut: Object.fromEntries(
      [...acknowledged.reduce((counts, item) =>
        counts.set(item.acknowledgedBy, (counts.get(item.acknowledgedBy) ?? 0) + 1), new Map())]),
    // 실재하지 않는 결정을 인용해 미결을 지운 자리. **인수보다 나쁘다** — 파일에 거짓이 남는다.
    danglingCitations: dangling,
  }
}

// 스팩이 화면을 기대하는가. 형태 카탈로그가 아는 형태면 `userInterface`가 답하고, **모르는
// 형태면 `testLayers.e2e`가 답한다** — `spec.mjs`가 미등록 형태에 대해 "경로를 적거나
// `(absent — 이유)`로 명시하라"고 이미 요구하고 있기 때문이다(`E2E_TEST_LAYER_UNDECIDED`).
// 그 선언을 안 보고 Page Groups로 넘어가면, 미등록 UI 형태가 PAGE-000뿐일 때 불완전한 기획이
// "화면 없음"으로 통과한다(교차 모델 리뷰 2026-09-04).
// 디자인 단계가 산출물을 냈는가. flat·sharded 두 형태를 본다.
const DESIGN_ARTIFACTS = ['design-system', 'layout-spec', 'component-spec']
const hasDesignArtifacts = root => DESIGN_ARTIFACTS.some(name => {
  const base = join(root, '_workspace/02_design', name)
  return (existsSync(`${base}.md`) && statSync(`${base}.md`).isFile()) ||
    (existsSync(base) && statSync(base).isDirectory())
})

// 디자인이 **공급**됐는가. 마커(`provenance-contract.md` §5)가 있으면 그것이 정본이고,
// 없으면 `00_source/` 인벤토리의 존재로 판정한다 — 마커는 어떤 validator도 검사하지 않아
// 없을 수 있지만(§5 한계), ingestor는 공급 경로에서 반드시 인벤토리를 남긴다.
// 판정 불가는 `null`이다. **`00_source/source-index.md`의 존재를 신호로 쓰지 않는다** —
// 그 인벤토리는 기획·API·설계 공급에도 생기며, 실제로 기획만 공급받고 디자인은 생성한
// 프로젝트가 존재한다(교차 모델 리뷰 2026-09-04, `workspace/minicar-laptime` 실측).
// 그것으로 공급을 단정하면 정상 프로젝트에 없는 귀속 기록을 요구하게 된다.
const declaredDesignSource = root => {
  const marker = join(root, '_workspace/web-harness.md')
  if (!existsSync(marker) || !statSync(marker).isFile()) return null
  const declared = readFileSync(marker, 'utf8').match(/DESIGN_SOURCE\s*:\s*(generated|supplied|absent)/i)
  return declared ? declared[1].toLowerCase() : null
}

// 결정 ID의 **형태**만 안다. 어느 접두가 유효한지는 결정 로그가 선언한다(`declaredDecisions`).
// 인수는 **명시 토큰**으로만 표시한다: `ack:PC-007`.
//
// 맨 ID를 인수로 읽으면 안 된다. `checkDecisionsLanded`가 정본(`01_plan` — `ux-brief` 포함)에
// 결정 ID를 **내용 근거로** 인용하라고 이미 밀고 있고, 실제 트리에 그 습관이 있다
// (`workspace/nocode-builder/…/ux-brief.md`의 "decision-log PC-002 연계"). 그 인용을 인수로
// 세면 하네스의 다른 게이트를 따르는 것이 곧 부채를 지우는 행위가 된다 — 이 보고가 막으려던
// 바로 그 fail-open이다(적대 리뷰 2026-09-04).
//
// 토큰을 쓰면 ID 네임스페이스를 열거할 필요도 없어진다. 종전에는 `PAGE|FEAT|TC|REQ`를 뺐는데
// `REQ-F-001`의 `F-001`이 그 전방탐색을 빠져나가 오탐이 났다(실측: `'REQ-F-001'.match(…)`
// → `['F-001']`). `ack:` 뒤만 읽으면 그 문제가 성립하지 않는다.
const ACK_CITATION = /\back:\s*([A-Z]{1,4}-\d{3,})\b/gi
const citedAcknowledgements = value =>
  [...String(value ?? '').matchAll(ACK_CITATION)].map(match => match[1].toUpperCase())
// 이름 칸에서 인수 토큰만 걷어낸다 — 화면 ID(`PAGE-002`)는 건드리지 않는다.
const stripAcknowledgements = value => String(value ?? '')
  .replace(/[([（]\s*(?:ack:\s*[A-Z]{1,4}-\d{3,}[\s,·]*)+[)\]）]/gi, ' ')
  .replace(ACK_CITATION, ' ')

const E2E_ABSENT = /^\(\s*absent\b/i
export const resolveScreenExpectation = spec => {
  // **스팩도 검증 전 문서다.** `{"targetShapes":"web-app"}` 같은 유효 JSON이 그대로 들어오면
  // `hasUserInterface`가 `shapes.some is not a function`으로 죽고, 항상 exit 0을 약속한 보고가
  // 비정상 종료한다(교차 모델 리뷰 2026-09-04 — 바인딩 문서에서 이미 한 번 물린 클래스다).
  // 비어 있거나 형태가 아닌 것은 `false`가 아니라 **모른다**다 — 화면이 없다고 단정하면
  // 기획에 화면이 있는데도 청구가 통째로 빠진다.
  if (!Array.isArray(spec?.targetShapes) || spec.targetShapes.length === 0) return null
  const ui = hasUserInterface(spec.targetShapes)
  if (ui !== 'unknown') return ui
  const e2e = spec?.testLayers?.e2e
  if (typeof e2e !== 'string' || e2e.trim() === '') return null // 스팩이 말하지 않았다 — 모른다
  return !E2E_ABSENT.test(e2e.trim())
}

// 화면이 있는 형태인가를 **기획 부재와 구분해서** 판정한다. 형태 정보는 스팩의
// `targetShapes`가 정본이며(`hasUserInterface` — 카탈로그 밖 이름은 `unknown`으로 돌아온다),
// 스팩이 아직 없으면 Page Groups 표로 판정한다. 어느 쪽도 없으면 **모른다고 말한다.**
const designDebtStatus = ({root, sources, table, groups, denominator, screens, binding}) => {
  // 형태 판정이 **가장 먼저**다. 기획 부재를 먼저 보면 화면 없는 형태(library·cli)가 기획을
  // 세우지 않은 정상 경로인데도 "부채가 최대"로 나온다(교차 모델 리뷰 2026-09-04).
  const spec = readSpecAt(root)
  const ui = spec ? resolveScreenExpectation(spec) : null
  if (ui === false) return 'no-screens'
  // 바인딩 기록이 깨졌으면 그것을 근거로 센 숫자는 사실이 아니다. `checkDesignBinding`이
  // HOLE을 내는 상태에서 이 보고만 `clear`를 내면 **막지 않는 보고가 거짓말을 한다**.
  if (binding.present && binding.errors.length > 0) return 'binding-invalid'
  if (sources.length === 0) return 'no-plan'
  // Page Groups가 **있는데** 전역 책임뿐이면 화면이 없다. 이 판정은 분모 검사보다 앞에
  // 서야 한다 — 화면이 없는 프로젝트에 정보 위계 표를 요구하는 것은 틀린 요구다.
  // 단 **스팩이 UI 있음으로 확정한 경우에는 적용하지 않는다** — 그때 PAGE-000뿐인 것은
  // 화면이 없는 것이 아니라 기획이 불완전한 것이고, 그것을 "그대로 진행"으로 보고하면
  // 청구가 통째로 빠진다(교차 모델 리뷰 2026-09-04). Page Groups 추론은 형태를 모를 때만이다.
  if (ui !== true && groups.length > 0 && !groups.some(row => row.id !== 'PAGE-000')) return 'no-screens'
  if (groups.length === 0 || denominator.length > 0 || table.rows.length === 0) return 'denominator-broken'
  // 여기까지 왔는데 잴 화면이 하나도 없으면 `clear`가 아니다 — 앞의 분기들이 "화면이 없는
  // 형태"를 이미 걸렀으므로, 남은 0건은 **화면이 있어야 하는데 표에 없는 것**이다.
  // `clear`로 내면 "부채 없음 — 화면 0개"라는 공허한 통과가 된다(교차 모델 리뷰 2026-09-04).
  if (screens.length === 0) return 'denominator-broken'
  // 디자인 산출물이 있으면 청구하지 않는다 — 단 **분모를 확인한 뒤에** 면제한다.
  // `design-binding.json`은 공급된 근거의 귀속 기록이라 `generated` 경로에는 애초에 생기지
  // 않으므로, 그것만 보고 판정하면 정상적으로 디자인을 만든 프로젝트가 전건 부채로 나온다.
  // 그러나 이 면제를 기획·분모 검사보다 **앞에** 두면 반대 방향으로 샌다 — 중단 과정에서
  // 남은 `layout-spec.md` 하나가 깨진 기획을 통째로 면제했다(교차 모델 리뷰 2026-09-04).
  // 산출물의 존재는 "디자인 단계가 돌았다"는 신호일 뿐 분모가 성립한다는 뜻이 아니다.
  if (!binding.present && hasDesignArtifacts(root)) {
    const source = declaredDesignSource(root)
    // **공급된 디자인인데 귀속 기록이 없는 것**은 다른 사연이다 — 시안을 받아놓고 어느
    // 화면의 것인지 적지 않은 상태이며, `protected-core.md` §4의 「무문서 SKIP」 그 자체다.
    if (source === 'supplied') return 'binding-missing'
    // **`absent`는 면제하지 않는다.** 그 경로는 Phase 2 체크포인트를 수행하지 않았으므로
    // "이미 확인했다"가 사실이 아니다 — 중단된 실행이 남긴 산출물 하나로 청구가 사라진다
    // (교차 모델 리뷰 2026-09-04). 면제의 근거는 파일의 존재가 아니라 **그 단계가 돌았다는
    // 선언**이다. 마커가 없으면 판정 불가이며 그 사실을 출력에 적는다.
    if (source !== 'absent') return 'design-present'
  }
  const unbacked = screens.flatMap(screen => screen.conditions.filter(item => item.basis === 'pending' || item.basis === 'plan'))
  if (unbacked.length === 0) return 'clear'
  // **전부 인수됐으면 미결이 아니다.** 다만 `clear`("전부 시각 근거를 갖는다")도 아니다 —
  // 근거가 아니라 결정이 있는 상태이고, 두 낱말을 섞으면 보고가 사실보다 강해진다.
  return unbacked.every(item => item.acknowledgedBy !== null) ? 'acknowledged' : 'debt'
}

export function checkDesignBinding(root, {reportDenominator = true} = {}) {
  const binding = collectDesignBinding(root)
  if (!binding.present) return skip('design-binding', `${DESIGN_BINDING_PATH}이 없다 — 공급된 디자인 근거가 없는 경로다`)
  if (binding.errors.length > 0) {
    return hole('design-binding', `디자인 근거 기록이 유효하지 않다: ${binding.errors.slice(0, 3).join(' · ')}${binding.errors.length > 3 ? ` 외 ${binding.errors.length - 3}건` : ''}`,
      'design-binding-contract.md의 형식으로 고친다 — 이 기록이 깨지면 시안이 어느 화면의 것인지 아무도 승계하지 못한다')
  }
  const document = binding.document
  const declaredPages = new Set(planSources(root).flatMap(pageGroupIdsIn))
  const accounted = new Set([...binding.boundPageGroups, ...document.unbound.pageGroups])
  const missing = [...declaredPages].filter(id => !accounted.has(id)).sort()
  const problems = []
  if (document.unbound.references.length > 0) {
    problems.push(`어느 조건에도 붙지 않은 근거 ${document.unbound.references.length}건: ${document.unbound.references.slice(0, 6).join(', ')}`)
  }
  if (document.unbound.pageGroups.length > 0) {
    problems.push(`디자인 근거가 미결인 화면 ${document.unbound.pageGroups.length}건: ${document.unbound.pageGroups.slice(0, 6).join(', ')}`)
  }
  if (missing.length > 0) {
    problems.push(`기획에 있으나 기록에 없는 화면 ${missing.length}건: ${missing.slice(0, 6).join(', ')}`)
  }
  // 역방향도 본다. 한쪽만 보면 **유령 화면**이 우회로가 된다 — 기획에 없는 PAGE-999를 만들어
  // 근거를 거기 붙이면 `unbound.references`가 비어 통과하고, layout-designer는 라우팅 맵에
  // 없는 화면을 입력으로 받는다(교차 모델 리뷰 2026-09-03). 기획을 못 읽었으면 대조하지
  // 않는다 — 없는 것과 못 읽은 것은 다르다.
  if (declaredPages.size > 0) {
    const ghosts = [...accounted].filter(id => !declaredPages.has(id)).sort()
    if (ghosts.length > 0) problems.push(`기획에 없는 화면에 붙은 기록 ${ghosts.length}건: ${ghosts.slice(0, 6).join(', ')}`)
  }
  // `pending`은 행이 있을 뿐 결정이 아니다. `unbound`를 비우려고 `pending`을 적는 우회를
  // 막는다 — 그 우회를 허용하면 이 검사는 "행이 있는가"만 세는 프록시가 된다.
  const pending = document.bindings.filter(b => b.resolution === 'pending')
    .map(b => `${b.pageGroup}[${conditionLabel(b.condition)}]`)
  if (pending.length > 0) problems.push(`결정이 미뤄진 조건 ${pending.length}건: ${pending.slice(0, 6).join(', ')}`)
  problems.push(...conditionCoverageProblems(root, document, {reportDenominator}))
  const c = binding.coverage
  const summary = `근거 ${c.references}건 · 바인딩 ${c.bindings}건(공급 ${c.resolutions.supplied} · 파생 ${c.resolutions.derive} · 재사용 ${c.resolutions.reuse} · 미정 ${c.resolutions.pending}) · 화면 ${c.pageGroups}개`
  if (problems.length === 0) return ok('design-binding', summary)
  return hole('design-binding', `${problems.join(' · ')} [${summary}]`,
    '각 화면·조건에 근거를 붙이거나, 근거가 없다고 **결정**해 resolution(derive|reuse:<id>)을 적는다 — 빈 칸으로 두면 그 결정은 구현 중에 즉흥으로 내려진다')
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
    '그 FEAT가 그 경계를 정말 써야 하면 **스팩을 고친다** — moduleBoundaries의 rationale에 그 FEAT를 더한다. 쓰지 않아도 되면 paths에서 뺀다. **`none`으로 비우는 것은 답이 아니다** — 자기 TC를 검증할 수 없어져 paths-sufficiency가 막는다(둘은 같은 결함의 양면이다)')
}

// ── (2) 선언된 경로가 자기 TC를 검증하기에 충분한가 ─────────────────────────
// **개발 중에 문서를 고치게 되면 그것은 인계 실패다.** 그런데 귀속 대조(위)는 공유 경계를
// 선언하면 지적하므로, 저자가 게이트를 통과하는 **가장 쉬운 길이 `paths=none`**이 된다.
// 그리고 `paths=none`은 지금까지 아무도 보지 않았다 — TC가 5개인 FEAT가 소유 경로 0개로
// 통과했고, 그 결함은 **개발자가 픽업해서 ALLOWED_PATHS가 비어 있는 것을 발견할 때** 처음
// 드러났다(2026-08-30 실측, track FEAT-010). 그 시점의 해법은 계획 수정뿐이고, 그것이
// 정확히 "개발 중 문서 변경"이다.
//
// **판정**: TC를 가진 FEAT는 소유 경로를 하나 이상 선언해야 한다. 아무것도 소유하지 않는
// 단위는 자기 수용 기준을 검증할 수 없다.
//
// 공유 표면이라 쓸 경계가 없다면 그것은 **스팩의 결함**이다 — moduleBoundaries의 rationale이
// 그 FEAT를 명시하도록 고쳐야 하며, 계획에서 `none`으로 회피할 문제가 아니다.
export function checkPathsSufficient(units) {
  if (!units || units.length === 0) return skip('paths-sufficiency', '단위를 읽지 못해 대조할 수 없다')
  const empty = units
    .filter(unit => (unit.testCaseIds?.length ?? 0) > 0)
    .filter(unit => Array.isArray(unit.paths) && unit.paths.length === 0)
    .map(unit => unit.featureId)
    .sort()
  if (empty.length === 0) return ok('paths-sufficiency', 'TC를 가진 단위가 전부 소유 경로를 선언했다')
  return hole('paths-sufficiency', `TC가 있는데 소유 경로가 없다: ${empty.join(', ')}`,
    '그 FEAT가 실제로 쓸 경로를 선언한다 — 아무것도 소유하지 않으면 자기 TC를 검증할 수 없고, '
    + '픽업 시점에 ALLOWED_PATHS가 비어 개발이 계획을 고치게 된다. 공유 표면이라 쓸 경계가 '
    + '없다면 스팩 moduleBoundaries의 rationale이 그 FEAT를 명시하도록 고친다 — 계획에서 '
    + '`none`으로 회피할 문제가 아니다')
}

/** 디렉터리 아래 확장자 일치 파일을 전부 이어 읽는다(재귀). 읽기 실패는 빈 문자열이다. */
export function readTree(dir, extensions = ['.md']) {
  let out = ''
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return out
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out += readTree(path, extensions)
    else if (extensions.some(ext => entry.name.endsWith(ext))) {
      try { out += `\n${readFileSync(path, 'utf8')}` } catch { /* 읽기 실패는 미인용으로 둔다 */ }
    }
  }
  return out
}
const readTreeMd = dir => readTree(dir, ['.md'])

/** 결정 로그 — 계약상 flat `decision-log.md`이고 분할 프로젝트는 디렉터리다. 둘 다 읽는다. */
export function readDecisionLog(root) {
  let out = ''
  const flat = join(root, '_workspace/01_plan/decision-log.md')
  if (existsSync(flat) && statSync(flat).isFile()) out += readFileSync(flat, 'utf8')
  out += readTreeMd(join(root, '_workspace/01_plan/decision-log'))
  return out
}

/** 구현이 읽는 정본 — 계획과 설계. **프리뷰는 제외한다**(Phase 3의 구현 입력이 아니다). */
export function readCanon(root) {
  let out = planSources(root).join('\n')
  const designDir = join(root, '_workspace/02_design')
  if (!existsSync(designDir) || !statSync(designDir).isDirectory()) return out
  for (const entry of readdirSync(designDir, {withFileTypes: true})) {
    if (entry.name === 'preview') continue
    const path = join(designDir, entry.name)
    if (entry.isDirectory()) out += readTreeMd(path)
    else if (entry.name.endsWith('.md')) {
      try { out += `\n${readFileSync(path, 'utf8')}` } catch { /* 무시 */ }
    }
  }
  return out
}


// ── (5) 논의가 산출물에 도달했는가 · 요구가 계획에 도달했는가 ────────────────
// 앞의 `upstream-decisions`는 **프리뷰가 인용한** 결정만 본다. 그러나 프리뷰를 거치지 않고
// 결정 로그에만 남은 조정도 있고, 요구가 계획에 매핑되지 않은 채 남기도 한다.
//
// 2026-08-30 실측(track): 결정 57건 중 **25건**을 정본이 한 번도 인용하지 않았고, 요구 28건 중
// **13건**을 계획이 한 번도 언급하지 않았다. 그중 상당수는 내용이 다른 낱말로 반영돼 있으나,
// ID 흔적이 없으면 "이 티켓이 어느 요구를 닫는가"에 답할 수 없다.
//
// **래칫으로 잰다.** 이미 쌓인 것을 한 번에 메우라고 하면 게이트가 통과 불가가 되어 우회를
// 부른다 — 현재를 baseline으로 고정하고 **새로 새는 것만** 막는다(이 저장소의 always-read
// 바이트·배선 커버리지와 같은 방식). baseline 갱신은 의식적 행위다.
const COVERAGE_BASELINE = '_workspace/01_plan/coverage-baseline.json'

export function readCoverageBaseline(root) {
  const path = join(root, COVERAGE_BASELINE)
  if (!existsSync(path)) return {decisions: [], requirements: []}
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return {
      decisions: Array.isArray(parsed?.decisions) ? parsed.decisions : [],
      requirements: Array.isArray(parsed?.requirements) ? parsed.requirements : [],
    }
  } catch {
    return {decisions: [], requirements: []} // 깨진 baseline은 면제 0 — fail-closed
  }
}

/** 정본이 한 번도 인용하지 않은 결정(대체분은 후속이 도달했으면 제외). */
export function strandedDecisions(root) {
  const log = readDecisionLog(root)
  const {ids: declared, prefixes} = declaredDecisions(log)
  if (prefixes.size === 0) return null // 로그가 없거나 표제 규약 밖 — 판정 불가
  const canon = readCanon(root)
  const reached = new Set(canon.match(idPattern(prefixes)) ?? [])
  const supersession = supersessionMap(log)
  return [...declared]
    .filter(id => !reached.has(id) && !supersededAndReached(id, supersession, reached))
    .sort()
}

export function checkDecisionsLanded(root) {
  const stranded = strandedDecisions(root)
  if (stranded === null) return skip('decisions-landed', '결정 로그가 없거나 표제 규약 밖이다')
  const known = new Set(readCoverageBaseline(root).decisions)
  const fresh = stranded.filter(id => !known.has(id))
  if (fresh.length === 0) {
    const carried = stranded.length > 0 ? ` (baseline에 등록된 미도달 ${stranded.length}건은 그대로 남아 있다)` : ''
    return ok('decisions-landed', `정본이 인용하지 않은 결정이 새로 늘지 않았다${carried}`)
  }
  return hole('decisions-landed', `정본이 인용하지 않는 새 결정 ${fresh.length}건: ${fresh.slice(0, 8).join(', ')}`,
    '그 결정을 FEAT 스펙·설계 정본에서 ID로 인용한다 — 내용만 옮기면 "이 티켓이 어느 결정을 구현하는가"에 답할 수 없다. '
    + `과정 기록이라 산출물이 없으면 ${COVERAGE_BASELINE}에 등록한다(의식적 행위다)`)
}

/** 요구 문서가 선언했는데 계획이 한 번도 언급하지 않은 요구. */
export function uncoveredRequirements(root) {
  const dir = join(root, '_workspace/01_plan/requirements')
  const flat = join(root, '_workspace/01_plan/requirements.md')
  let text = ''
  if (existsSync(flat) && statSync(flat).isFile()) text += readFileSync(flat, 'utf8')
  if (existsSync(dir) && statSync(dir).isDirectory()) text += readTreeMd(dir)
  if (text === '') return null
  const ids = [...new Set(text.match(/\bREQ-[A-Z]{1,4}-\d+\b/g) ?? [])]
  if (ids.length === 0) return null
  const plan = planSources(root).join('\n')
  const mentioned = new Set(plan.match(/\bREQ-[A-Z]{1,4}-\d+\b/g) ?? [])
  return ids.filter(id => !mentioned.has(id)).sort()
}

export function checkRequirementsCovered(root) {
  const uncovered = uncoveredRequirements(root)
  if (uncovered === null) return skip('requirements-covered', '요구 문서를 찾지 못했거나 ID가 없다')
  const known = new Set(readCoverageBaseline(root).requirements)
  const fresh = uncovered.filter(id => !known.has(id))
  if (fresh.length === 0) {
    const carried = uncovered.length > 0 ? ` (baseline에 등록된 미매핑 ${uncovered.length}건은 그대로 남아 있다)` : ''
    return ok('requirements-covered', `계획이 다루지 않는 요구가 새로 늘지 않았다${carried}`)
  }
  return hole('requirements-covered', `계획이 언급하지 않는 새 요구 ${fresh.length}건: ${fresh.slice(0, 8).join(', ')}`,
    '그 요구를 담당할 FEAT의 명세나 traceability 표에 ID로 적는다 — 담당이 없으면 티켓으로도 나가지 않고, '
    + `어느 티켓이 그것을 닫는지 아무도 모른다. 의식적으로 범위 밖이면 ${COVERAGE_BASELINE}에 등록한다`)
}

/** 계획에 있는데 티켓이 발행되지 않은 FEAT. 원장이 있을 때만 잰다. */
export function checkTicketsCoverPlan(root, units) {
  if (!units || units.length === 0) return skip('tickets-cover-plan', '단위를 읽지 못해 대조할 수 없다')
  const ledgerPath = join(root, '_workspace/03_dev/identity-ledger.jsonl')
  if (!existsSync(ledgerPath)) return skip('tickets-cover-plan', '아직 티켓이 발행되지 않았다')
  let issued
  try {
    issued = new Set(ledgerState(parseLedger(readFileSync(ledgerPath, 'utf8'))).keys())
  } catch {
    return skip('tickets-cover-plan', '원장을 읽지 못했다')
  }
  if (issued.size === 0) return skip('tickets-cover-plan', '원장에 유효한 티켓 기록이 없다')
  const missing = units.map(unit => unit.featureId).filter(id => !issued.has(id)).sort()
  if (missing.length === 0) return ok('tickets-cover-plan', `계획의 ${units.length}개 단위가 전부 티켓으로 발행됐다`)
  return hole('tickets-cover-plan', `티켓이 없는 계획 단위 ${missing.length}건: ${missing.join(', ')}`,
    'claim으로 발행한다 — 계획에 있는데 티켓이 없으면 보드에 안 보이고, 아무도 집지 않은 채 릴리스로 간다')
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
  const text = planSources(root).join('\n')
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

// ── 상류 조정이 개발에 도달하는가 ───────────────────────────────────────────
// 기획·디자인·스팩·설계에서 조정한 결정(D-xxx)은 **결정 로그**에 남는다. 그런데 결정 로그는
// 이력이지 구현 입력이 아니다 — 개발이 읽는 것은 FEAT 스펙과 `piece-geometry.md` 같은 정본
// 문서다. 조정이 로그와 **프리뷰 코드에만** 남으면 개발은 그것을 못 본다.
//
// 2026-08-30 실측: 뱅크·레인 기하(D-033·034·035)가 FEAT-005 본문과 `preview/geom3d.js`에만
// 있었고, 그것을 실제로 구현할 FEAT-008 본문은 "시각적으로 구분해 표현한다" 두 줄이었다 —
// **티켓만 읽고 개발하면 3레인 순환도 12cm 면도 8cm 육교도 모른다.** Phase 3은 preview 코드를
// 구현 입력으로 전달하는 것을 금지하므로, 그 경로로는 도달할 수도 없다.
//
// **판정**: 프리뷰 코드가 인용하는 결정 ID가 구현이 읽는 문서(FEAT 스펙·설계 정본)에도
// 있는가. 없으면 그 조정은 개발에 도달하지 못한다.
//
// **한계(프록시)**: ID 인용의 존재만 본다 — 인용됐다고 그 수치가 옮겨졌다는 보장은 없다.
// 반대로 ID 없이 내용만 옮긴 경우는 놓친다(과소 탐지, 정직한 방향).
// **ID 체계를 하드코딩하지 않는다**(I3). 하네스 계약(`plan-history-contract.md`)의 결정 ID는
// `PC-NNN`이고 track은 `D-NNN`을 쓴다 — 둘 중 하나를 박으면 다른 쪽에서 이 검사가 영구
// 무의미해지거나 전건 오탐이 된다(2026-08-30 리뷰 BLOCK). 그래서 **로그가 스스로 선언한
// 표제에서 접두사를 읽어** 그 체계로만 검색한다. 표제가 없으면 검색할 것이 없으므로 SKIP이다.
const DECISION_HEADING = /^#{1,6}\s*([A-Z]{1,4})-(\d{3,})\b/gm

/** 로그가 선언한 결정 ID와 접두사. 로그 밖에서는 이 집합으로만 검색한다. */
export function declaredDecisions(logText) {
  const ids = new Set()
  const prefixes = new Set()
  for (const [, prefix, number] of String(logText ?? '').matchAll(DECISION_HEADING)) {
    ids.add(`${prefix}-${number}`)
    prefixes.add(prefix)
  }
  return {ids, prefixes}
}

const idPattern = prefixes => new RegExp(String.raw`\b(?:${[...prefixes].join('|')})-\d{3,}\b`, 'g')

// 결정 로그에서 **대체·정정·해소된** 결정 ID.
//
// 방향이 핵심이고, 방향 판정은 산문에서 신뢰할 수 없다. 첫 시도는 "주격 조사 `이/가` = 행위자"
// 규칙이었는데 리뷰가 **피동문에서 정확히 뒤집히는** 반례를 냈다 — `D-024가 D-042로 대체됐다`
// 에서 살아 있는 D-042를 대체된 것으로 등록한다. 제외는 stranded를 **줄이는** 방향으로만
// 작동하므로 그 오판은 전부 fail-open이다.
//
// 그래서 범위를 **계약된 표제 형태 한 줄**로 좁혔다: `## <자기 ID> · 제목 — <다른 ID> 대체`.
// 표제 밖 산문은 보지 않는다(과소 제외 = 더 많이 보고 = fail-closed). 피동(`로`·`에 의해`)과
// 부정(`않`)이 섞인 표제는 방향을 단정할 수 없으므로 **제외하지 않는다**.
const PASSIVE = /(으?로|에\s*의해)\s*$/

/**
 * 대체 관계를 **dead → successor** 맵으로 읽는다.
 *
 * 이전 판은 "대체됐으니 면제"로 끝냈는데, 면제의 논거는 *"후속이 정본에 있으면 그 조정은
 * 도달한 것"*이다 — 그런데 후속이 정본에 도달했는지를 검사하지 않았다. 그러면 옛 결정도
 * 후속도 정본에 없는, **이 검사가 잡으려던 바로 그 상황**이 PASS로 나온다(2026-08-30 리뷰
 * HIGH). 면제하려면 그 논거를 기계가 확인해야 한다.
 */
export function supersessionMap(logText) {
  const map = new Map()
  const {prefixes} = declaredDecisions(logText)
  if (prefixes.size === 0) return map
  const ID = idPattern(prefixes)
  for (const line of String(logText ?? '').split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s*([A-Z]{1,4}-\d{3,})\b/)?.[1]
    if (heading === undefined) continue // 표제 줄만 본다
    if (/않/.test(line)) continue // 부정문은 방향을 단정하지 않는다
    let cursor = 0
    for (const keyword of [...line.matchAll(/대체|정정|해소/g)]) {
      // 키워드마다 **직전 키워드 이후**만 본다 — 한 줄에 진술이 둘이면 앞 진술의 행위자가
      // 뒤 진술의 목적어로 새는 fail-open이 생긴다(리뷰 LOW).
      const segment = line.slice(cursor, keyword.index)
      cursor = keyword.index + keyword[0].length
      for (const match of segment.matchAll(ID)) {
        if (match[0] === heading) continue // 자기 자신은 대체하는 쪽이다
        const after = segment.slice(match.index + match[0].length)
        if (PASSIVE.test(after)) continue // `D-042로 대체` — 그쪽이 행위자다
        if (!map.has(match[0])) map.set(match[0], new Set())
        map.get(match[0]).add(heading)
      }
    }
  }
  return map
}

/** 대체된 결정 ID(방향만). 도달 판정에는 쓰지 않는다 — `supersessionMap`을 쓴다. */
export function supersededDecisionIds(logText) {
  return new Set(supersessionMap(logText).keys())
}

/** 후속(사슬 포함)이 정본에 도달했으면 면제한다. 순환 로그에서도 멈춘다. */
export function supersededAndReached(id, map, reached, seen = new Set()) {
  if (seen.has(id)) return false
  seen.add(id)
  for (const successor of map.get(id) ?? []) {
    if (reached.has(successor)) return true
    if (supersededAndReached(successor, map, reached, seen)) return true
  }
  return false
}

export function checkUpstreamDecisionsReachable(root) {
  const previewDir = join(root, '_workspace/02_design/preview')
  if (!existsSync(previewDir) || !statSync(previewDir).isDirectory()) {
    return skip('upstream-decisions', '프리뷰가 없어 대조할 수 없다')
  }
  // 로그·정본 판독은 공용 reader를 쓴다 — 같은 파일 안에서 두 벌을 두면 한쪽만 고쳐진다.
  const log = readDecisionLog(root)
  const {ids: declared, prefixes} = declaredDecisions(log)
  if (prefixes.size === 0) {
    return skip('upstream-decisions', '결정 로그에 `## <ID>-<3자리 이상>` 표제가 없어 ID 체계를 알 수 없다')
  }
  const ID = idPattern(prefixes)
  const inPreview = new Set(readTree(previewDir, ['.js', '.ts', '.css', '.html']).match(ID) ?? [])
  if (inPreview.size === 0) return skip('upstream-decisions', '프리뷰가 인용하는 결정이 없다')
  const canon = readCanon(root)
  const reached = new Set(canon.match(ID) ?? [])
  const supersession = supersessionMap(log)
  // 로그에 **표제가 없는** ID는 존재하지 않는 결정을 가리키는 것이다 — 다른 종류의 결함이라
  // 따로 보고한다(옮길 대상이 없으므로 "옮겨라"는 처방이 틀린다).
  const dangling = [...inPreview].filter(id => !declared.has(id)).sort()
  const stranded = [...inPreview]
    .filter(id => declared.has(id) && !reached.has(id)
      && !supersededAndReached(id, supersession, reached)).sort()
  if (stranded.length === 0 && dangling.length === 0) {
    return ok('upstream-decisions', `프리뷰가 인용한 결정 ${inPreview.size}건이 전부 구현 정본에 도달한다(대체분은 후속이 도달한 것만 면제)`)
  }
  const parts = []
  if (stranded.length > 0) parts.push(`프리뷰에만 남은 결정 ${stranded.length}건: ${stranded.join(', ')}`)
  if (dangling.length > 0) parts.push(`결정 로그에 없는 ID를 인용 ${dangling.length}건: ${dangling.join(', ')}`)
  return hole('upstream-decisions', parts.join(' · '),
    stranded.length > 0
      ? '그 조정을 정본으로 옮기거나, 이미 옮겼다면 **정본에서 그 ID를 인용**한다 — Phase 3은 preview를 구현 입력으로 전달하지 않으므로 ID 없이는 개발이 근거를 되짚을 경로가 없다(이 축은 ID 인용을 보는 프록시다 — 내용이 다른 낱말로 도달했을 수 있으나, 그 경우에도 인용을 붙이는 것이 해소다)'
      : '프리뷰·구현이 존재하지 않는 결정을 가리킨다 — 결정을 기록하거나 인용을 고친다')
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
    const results = [...planChecks, checkSourceConsumption(root), checkDesignInputs(root), checkDesignBinding(root, {reportDenominator: false}), checkUpstreamDecisionsReachable(root)]
    const holes = results.filter(r => r.state === 'HOLE')
    return {schemaVersion: 1, to, verdict: holes.length === 0 ? 'READY' : 'HOLES', results, holes, parallelism: measureParallelism(units)}
  }
  const spec = readSpecAt(root)
  const results = [
    ...planChecks,
    checkSourceConsumption(root),
    checkPathsAgainstSpec(units, spec),
    checkPathsSufficient(units),
    checkTicketsCoverPlan(root, units),
    // 디자인 인계에서 통과한 기록이 그 사이에 지워지거나 어긋날 수 있다 — 늦게 잡을수록
    // 되돌리는 비용이 커진다(planChecks가 두 인계에 모두 서는 것과 같은 판단).
    checkDesignBinding(root),
    checkDecisionsLanded(root),
    checkRequirementsCovered(root),
    checkUpstreamDecisionsReachable(root),
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
    process.stderr.write(`사용법: node .claude/scripts/validate-handoff-readiness.mjs --project <root> [--to ${HANDOFFS.join('|')} | --design-debt] [--json]\n`)
    process.exit(2)
  }
  // 디자인 부채 청구서. **판정이 아니라 보고이므로 항상 exit 0이다** — 이 출력으로 진행을
  // 막지 않는다(`provenance-contract.md` §3). 결정은 사람이 하고 인수는 decision-log에 남는다.
  if (argv.includes('--design-debt')) {
    const debt = designDebtReport(resolve(projectRoot))
    if (argv.includes('--json')) {
      process.stdout.write(`${JSON.stringify(debt, null, 2)}\n`)
      process.exit(0)
    }
    if (debt.danglingCitations.length > 0) {
      // 상태와 무관하게 **먼저** 말한다. 없는 결정을 인용해 미결을 지운 것은 자기신고보다
      // 나쁘다 — 파일에 거짓이 남고, 그것을 근거로 다음 사람이 넘어간다.
      process.stdout.write(`결정 로그에 없는 ID를 인용한 자리 ${debt.danglingCitations.length}건 — 인수로 세지 않았다\n`)
      for (const item of debt.danglingCitations) {
        process.stdout.write(`  · ${item.pageGroup}${item.label ? `[${item.label}]` : ''} → ${item.id}\n`)
      }
      process.stdout.write('\n')
    }
    if (debt.status === 'binding-missing') {
      process.stdout.write('디자인 부채: 공급된 디자인인데 귀속 기록이 없다 — 어느 화면의 시안인지 아무도 승계하지 못한다\n')
      process.stdout.write('  디자인을 다시 만드는 것이 아니라 `00_source/design-binding.json`에 귀속을 적는다(design-binding-contract.md).\n')
    } else if (debt.status === 'design-present') {
      process.stdout.write('디자인 부채: 디자인 단계 산출물이 있다 — 청구하지 않는다\n')
      process.stdout.write('  조건별 귀속(`design-binding.json`)은 공급된 근거가 있을 때만 재며, 여기서는 재지 않았다.\n')
      if (debt.designSource === null) {
        process.stdout.write('  공급원을 판정할 수 없다(마커에 `DESIGN_SOURCE`가 없다) — 시안을 받아 만든 것이라면 귀속 기록이 필요하다.\n')
      }
    } else if (debt.status === 'binding-invalid') {
      process.stdout.write('디자인 부채: 근거 기록이 유효하지 않다 — 그것을 근거로 센 숫자는 사실이 아니다\n')
      for (const problem of debt.bindingProblems.slice(0, 6)) process.stdout.write(`  · ${problem}\n`)
    } else if (debt.status === 'no-plan') {
      process.stdout.write('디자인 부채: 기획 문서를 찾지 못했다 — 무엇이 미결인지 셀 분모가 없다\n')
      process.stdout.write('  이것은 "청구할 것이 없다"가 아니다. 기획·디자인이 둘 다 없으면 부채는 최대다.\n')
    } else if (debt.status === 'no-screens') {
      process.stdout.write('디자인 부채: 화면이 없는 형태다 — 청구할 것이 없다\n')
    } else if (debt.status === 'denominator-broken') {
      process.stdout.write('디자인 부채: 조건 분모를 읽지 못했다 — 무엇이 미결인지 셀 수 없다\n')
      for (const problem of debt.denominatorProblems) process.stdout.write(`  · ${problem}\n`)
      if (debt.denominatorProblems.length === 0) process.stdout.write('  · Page Groups 표 또는 정보 위계 행이 없다\n')
    } else if (debt.status === 'clear') {
      process.stdout.write(`디자인 부채 없음 — 화면 ${debt.screens.length}개의 조건이 전부 시각 근거를 갖는다\n`)
    } else if (debt.status === 'acknowledged') {
      // `clear`와 섞지 않는다 — 근거가 아니라 **결정**이 있는 상태다.
      process.stdout.write(`인수된 부채 ${debt.acknowledged.length}건 — 시각 근거는 없고 결정이 있다\n`)
      for (const item of debt.acknowledged) process.stdout.write(`  · ${item.pageGroup}[${item.label}] ← ${item.acknowledgedBy}\n`)
      for (const [id, count] of Object.entries(debt.acknowledgementFanOut)) {
        if (count > 1) process.stdout.write(`  (${id} 하나가 ${count}건을 인수했다 — 범위가 넓다면 나눠 적는다)\n`)
      }
    } else {
      // `pending`은 **내용이 없는 것이 아니라** 근거 방식을 명시적으로 미룬 것이다
      // (`design-binding-contract.md` §3). 내용은 정보 위계 표에 있다 — 빈 칸이면 분모
      // 검사가 먼저 잡는다. 두 부류를 "내용 유무"로 가르면 잘못된 결정을 요구하게 된다
      // (교차 모델 리뷰 2026-09-04).
      if (debt.deferred.length > 0) {
        process.stdout.write(`결정이 보류된 조건 ${debt.deferred.length}건 — 근거 방식을 미뤄둔 자리다(인계 검사도 구멍으로 잡는다)\n`)
        for (const item of debt.deferred) process.stdout.write(`  · ${item.pageGroup}[${item.label}]\n`)
      }
      if (debt.planOnly.length > 0) {
        process.stdout.write(`시각 근거가 없는 조건 ${debt.planOnly.length}건 — 무엇을 보여줄지는 기획에 있고, 어떻게 그릴지가 없다\n`)
        for (const item of debt.planOnly) process.stdout.write(`  · ${item.pageGroup}[${item.label}]\n`)
      }
      // **시점 중립으로 쓴다.** 이 출력은 기획 발행 직후(보여주기)와 개발 착수 직전(결정)
      // 두 자리에서 쓰인다 — "지금 정하라"고 쓰면 결정을 요구하지 않는 자리에서 산문과
      // 충돌한다(적대 리뷰 2026-09-04). 결정 시점은 부르는 쪽이 말한다.
      if (debt.acknowledged.length > 0) {
        process.stdout.write(`인수된 조건 ${debt.acknowledged.length}건 — 결정이 기록돼 있다\n`)
        for (const item of debt.acknowledged) process.stdout.write(`  · ${item.pageGroup}[${item.label}] ← ${item.acknowledgedBy}\n`)
      }
      process.stdout.write('\n정하지 않은 조건은 구현하는 사람이 그 자리에서 정하게 된다.\n')
    }
    process.exit(0)
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
