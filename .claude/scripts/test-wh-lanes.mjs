#!/usr/bin/env node
// test-wh-lanes.mjs — `/wh`의 레인 선언이 실제 위임 대상과 맞는가.
//
// 계기(2026-09-10 독립 감사): `web-plan`의 description은 "`/wh`가 호출한다"고 적었는데
// `/wh`도 `web-orchestrator`도 그 스킬을 **호출한 적이 없다** — 참조 계약(`references/*.md`)만
// 읽었다. 선언이 거짓인 채로 기획 전용 흐름이 단일 진입점에서 도달 불가였고, 아무 기계도
// 그것을 재지 않았다.
//
// 여기서 고정하는 사실:
//   (1) 레인 표의 모든 레인이 강제 지정 목록에 있다 — 표에만 있고 못 부르는 레인이 없다
//   (2) 레인이 위임하는 스킬이 실재한다 — 이름을 지어내지 않는다
//   (3) `plan` 레인이 `web-plan`을 위임한다 — description의 주장이 참이다
//   (4) 레인 정본(`request-type-contract.md`)과 `/wh`의 레인 집합이 일치한다
//   (5) 검증 스킬이 소스를 쓰는 agent를 부르면 진입점과 무관하게 착수 전 승인을 적는다
import assert from 'node:assert/strict'
import test from 'node:test'
import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {AGENT_OWNERSHIP, DEVELOPER_AGENT} from './agent-registry.mjs'
import {declaredLanes} from './validators/validate-entry-points.mjs'

const root = new URL('../..', import.meta.url).pathname
// 스킬 **본문**만 읽는다 — frontmatter changelog의 「착수 전 승인을 요구한다」가 본문의 승인 부재를
// 가렸다(2026-09-11: 기존 web-verify 단언이 그 문구로 통과하고 있었다).
const skillBody = name => readFileSync(join(root, '.claude/skills', name, 'SKILL.md'), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '')
// source writer 판정은 **소유 레지스트리 하나**에서 나온다 — 소유가 `_workspace/` 밖에 닿는 agent
// (developer는 layerMap이 source를 공급한다). agent의 `tools:`로 가르면 `_workspace` 산출물만 쓰는
// 설계 agent까지 writer가 되어 두 검사가 갈라진다.
const writesSource = name => name === DEVELOPER_AGENT
  || (AGENT_OWNERSHIP[name] ?? []).some(pattern => !pattern.source.startsWith('^_workspace'))
const wh = readFileSync(join(root, '.claude/skills/wh/SKILL.md'), 'utf8')
const contract = readFileSync(join(root,
  '.claude/skills/web-orchestrator/references/request-type-contract.md'), 'utf8')

/**
 * 레인별 실행 표에서 (레인, 위임 대상, 게이트)를 뽑는다. 산문이 아니라 표를 읽는다.
 * **이스케이프된 `\\|`는 열 구분자가 아니다** — 첫 판은 그것도 잘라서 `new` 행의 위임 대상이
 * `` `supplied`) ``로 읽혔고, 「위임 스킬 실재」가 핵심 `new` 위임을 검사하지 않은 채 통과했다
 * (교차 모델 커밋 리뷰 2026-09-10).
 */
const CELL = '((?:\\\\\\||[^|])*)'
const LANE_ROW = new RegExp(`^\\|\\s*\`([a-z]+)\`${CELL}\\|${CELL}\\|${CELL}\\|`, 'gm')
const laneRows = text => [...text.matchAll(LANE_ROW)]
  .map(match => ({lane: match[1], target: match[3], gate: match[4]}))

test('강제 지정 목록과 레인 표가 같은 집합이다', () => {
  // validator와 **같은 파서**를 쓴다 — 한 문장을 두 정규식이 따로 읽으면 문장이 바뀔 때 하나만 깨진다.
  const declared = new Set(declaredLanes(root))
  assert.ok(declared.size > 0, '강제 지정 문장을 찾지 못했다')
  const tabled = new Set(laneRows(wh).map(row => row.lane))
  for (const lane of tabled) {
    assert.ok(declared.has(lane), `레인 표에 '${lane}'이 있는데 강제 지정으로 부를 수 없다`)
  }
  for (const lane of declared) {
    assert.ok(tabled.has(lane), `'${lane}'을 강제 지정할 수 있는데 레인 표에 실행이 없다`)
  }
})

test('파서가 new 행의 실제 위임 대상을 읽는다 — 이스케이프 \\| 에 잘리지 않는다', () => {
  const rows = laneRows(wh).filter(row => row.lane === 'new')
  assert.ok(rows.length >= 1, 'new 행을 못 읽었다')
  // 첫 판의 증상은 위임 대상이 `` `supplied`) ``로 잘리는 것이었다 — 그 조각이 남으면 안 된다.
  for (const row of rows) {
    assert.doesNotMatch(row.target, /^\s*`supplied`\)/,
      `new 행이 이스케이프 \\| 에서 잘렸다: ${JSON.stringify(row.target)}`)
  }
  // 첫 new 행이 실제 위임 스킬을 이름으로 댄다(둘째 행은 「같은 SKILL」로 첫 행을 가리킨다).
  assert.match(rows[0].target, /web-orchestrator\/SKILL\.md/,
    `new 위임 대상을 못 읽었다: ${JSON.stringify(rows[0].target)} — 「위임 스킬 실재」가 공허해진다`)
})

test('레인이 위임하는 스킬이 실재한다 — 이름을 지어내지 않는다', () => {
  for (const {lane, target} of laneRows(wh)) {
    for (const match of target.matchAll(/\.\.\/([a-z-]+)\/SKILL\.md/g)) {
      const skill = join(root, '.claude/skills', match[1], 'SKILL.md')
      assert.ok(existsSync(skill), `'${lane}' 레인이 없는 스킬 '${match[1]}'을 위임한다`)
    }
  }
})

test('plan 레인이 web-plan을 위임한다 — description의 주장이 참이어야 한다', () => {
  const plan = laneRows(wh).find(row => row.lane === 'plan')
  assert.ok(plan, '`plan` 레인이 없다 — web-plan은 단일 진입점에서 도달 불가다')
  assert.match(plan.target, /web-plan\/SKILL\.md/, 'plan 레인이 web-plan을 위임하지 않는다')
  // description이 스스로 그 레인을 가리켜야 한다 — 두 방향이 맞아야 선언이 참이다.
  const description = readFileSync(join(root, '.claude/skills/web-plan/SKILL.md'), 'utf8')
  assert.match(description, /\/wh plan/,
    'web-plan이 자기를 부르는 레인을 말하지 않는다 — 어느 경로로 오는지 모른 채 남는다')
})

test('레인 정본과 /wh의 레인 집합이 일치한다 — 두 곳에 적으면 갈라진다', () => {
  const contractLanes = new Set(laneRows(contract).map(row => row.lane))
  const whLanes = new Set(laneRows(wh).map(row => row.lane))
  for (const lane of whLanes) {
    assert.ok(contractLanes.has(lane), `'${lane}'이 /wh에만 있고 레인 정본에 없다`)
  }
})

// 계기(2026-09-10 감사 FINDING-002): `/wh`는 verify의 게이트를 `read-only 경계`라고 적었는데
// `web-verify`는 준비 단계에서 `environment-scaffolder`·`developer`(둘 다 Write/Edit 보유)를
// 실행한다. **검증자가 read-only인 것과 레인 전체가 불변인 것은 다르다** — 사용자는 "검증만"
// 이라고 믿고 들어왔다가 소스가 바뀐다.
test('verify 레인이 쓰기 agent를 실행하면 그 사실을 표시한다', () => {
  const verify = laneRows(wh).find(row => row.lane === 'verify')
  assert.ok(verify, 'verify 레인이 없다')
  const target = skillBody('web-verify')
  // 준비 단계가 부르는 agent 중 source를 쓰는 것이 있는가 — 이름 목록이 아니라 소유 레지스트리로
  // 판정한다(목록을 여기 적으면 갈라진다).
  const prepares = [...target.matchAll(/^\s*-\s+([a-z][a-z0-9-]*)\s*$/gm)].map(m => m[1])
  const writers = prepares.filter(name => existsSync(join(root, '.claude/agents', `${name}.md`)) && writesSource(name))
  if (writers.length === 0) return // 준비가 read-only가 되면 이 검사는 할 일이 없다
  assert.doesNotMatch(verify.gate, /^\s*read-only 경계\s*$/,
    `verify 게이트가 'read-only 경계'뿐인데 준비 단계가 쓰기 agent(${writers.join(', ')})를 실행한다`)
  assert.match(verify.gate, /승인/,
    'verify가 source를 만들 수 있는데 게이트 열이 승인을 요구하지 않는다')
  assert.match(target, /착수 전 승인/,
    'web-verify가 준비 단계에서 승인을 요구하지 않는다 — 조용히 소스를 만든다')
})

// 계기(FINDING-002 후속, 2026-09-11): 승인은 `web-verify` 준비 단계에만 있었다. `visual-design-verify`도
// 테스트 준비에서 `developer`에게 source를 쓰게 하는데 그 스킬 안의 승인은 baseline에 관한 것뿐이라,
// 그 스킬로 바로 들어오면 쓰기 전 승인이 없었다. **프록시 세 겹이다**(protected-core §4 등록):
// 「검증 스킬」은 디렉터리 이름(`*-verify`), 「부른다」는 이름 언급, 승인 문구는 본문 어디든 있으면 된다
// (writer를 부르는 단계에 결속되지 않는다).

test('검증 스킬이 source를 쓰는 agent를 부르면 착수 전 승인을 적는다 — 어느 진입점이든', () => {
  const skills = readdirSync(join(root, '.claude/skills')).filter(name => name.endsWith('-verify'))
  // 추출 건강성: 선택자와 이름 추출이 살아 있는가. writer **수**는 단언하지 않는다 — 준비를 정당하게
  // read-only로 바꾸면 그 수가 줄고, 숫자를 내리는 것이 대응이 되면 게이트 완화 유인이 된다.
  assert.ok(skills.length >= 2, `검증 스킬이 ${skills.length}개로 읽혔다 — 선택자가 무너졌다`)
  for (const skill of skills) {
    const body = skillBody(skill)
    // 부르는 agent: 백틱 이름과 목록 항목 이름 — 둘 다 agent 파일이 실재하는 것만.
    const named = [...body.matchAll(/`([a-z][a-z0-9-]*)`/g), ...body.matchAll(/^\s*-\s+([a-z][a-z0-9-]*)\s*$/gm)]
      .map(m => m[1]).filter(name => existsSync(join(root, '.claude/agents', `${name}.md`)))
    assert.ok(named.length > 0, `${skill}에서 부르는 agent를 하나도 읽지 못했다 — 추출이 무너졌다`)
    const writers = [...new Set(named)].filter(writesSource)
    if (writers.length === 0) continue
    assert.match(body, /착수 전 승인/,
      `${skill}이 source를 쓰는 agent(${writers.join(', ')})를 부르는데 착수 전 승인을 적지 않는다 — 조용히 source를 만든다`)
  }
})
