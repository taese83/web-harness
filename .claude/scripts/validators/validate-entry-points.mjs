// validate-entry-points.mjs — 사용자 문서가 **내부 스킬을 진입점으로 안내하지 않는가.**
//
// 계기(2026-09-10 독립 감사): `/wh`가 "사용자 진입점은 하나"라고 선언하고 22개 스킬이
// description을 `[내부]`로 시작하는데, README·Quickstart는 `/web-harness:web-orchestrator`·
// `/web-harness:web-plan`·`/web-harness:web-verify`를 계속 안내했다. **보호가 있는 길과
// 안내되는 길이 갈라져 있었고** — `/wh`가 존재하는 이유가 정확히 그 문제였다 — 아무 기계도
// 그것을 재지 않았다.
//
// 판정은 **`[내부]` 선언 자체**를 분모로 쓴다. 스킬 목록을 여기 적으면 두 곳이 갈라진다.
import {readFileSync, readdirSync, existsSync} from 'node:fs'
import {join} from 'node:path'

// 사용자가 "무엇을 칠지" 배우는 문서들. 인벤토리·계약 문서는 대상이 아니다 — 거기서는
// 내부 스킬을 이름으로 다루는 것이 정상이다.
// `build-plugin.mjs`는 **배포되는 마켓플레이스 README를 생성하는 템플릿**을 담는다 — 사용자가 실제로
// 설치하는 경로의 안내가 여기서 나온다. 생성물(`dist/README.md`)은 CI 끝에서야 만들어져 이 검사
// 시점엔 낡은 판이므로 **생성기 소스**를 본다(교차 모델 커밋 리뷰 2026-09-10: 저장소 문서는 고쳤는데
// 배포 README는 여전히 내부 스킬 셋을 진입점으로 게시했다).
const USER_DOCS = ['README.md', 'README.ko.md', 'docs/quickstart.md', '.claude/README.md',
  '.claude/scripts/build-plugin.mjs']

/** description이 `[내부]`로 시작하는 스킬 이름들(순수 판정 + 파일 읽기). */
export function internalSkills(repositoryRoot) {
  const skillsDir = join(repositoryRoot, '.claude/skills')
  if (!existsSync(skillsDir)) return []
  const found = []
  for (const name of readdirSync(skillsDir)) {
    const path = join(skillsDir, name, 'SKILL.md')
    if (!existsSync(path)) continue
    const description = /^description:\s*(.*)$/m.exec(readFileSync(path, 'utf8'))
    if (description && description[1].trimStart().startsWith('[내부]')) found.push(name)
  }
  return found.sort()
}

/**
 * 사용자 문서가 내부 스킬을 슬래시 명령으로 안내하면 위반이다.
 * 산문에서 스킬을 **언급**하는 것은 막지 않는다 — `/`가 붙은 호출 형태만 본다.
 */
export function findAdvertisedInternals(repositoryRoot, {docs = USER_DOCS} = {}) {
  const internals = new Set(internalSkills(repositoryRoot))
  const violations = []
  for (const doc of docs) {
    const path = join(repositoryRoot, doc)
    if (!existsSync(path)) continue
    const text = readFileSync(path, 'utf8')
    text.split(/\r?\n/).forEach((line, index) => {
      // **토큰 경계에서만 본다.** 처음에는 `/이름`을 아무 데서나 찾았고 실측에서 오탐 3건이
      // 나왔다 — `golden/vite-serverless-hybrid/...` 같은 **경로 조각**이 슬래시 명령으로
      // 읽혔다(2026-09-10). 이 저장소 규율상 오탐이 있는 검사는 막을 자격이 없으므로,
      // 줄 시작·공백·백틱·괄호 뒤의 `/`만 명령으로 본다.
      for (const match of line.matchAll(/(?:^|[\s`("'])\/(?:web-harness:|\$\{PLUGIN_NAME\}:)?([a-z][a-z0-9-]*)/g)) {
        if (internals.has(match[1])) violations.push({doc, line: index + 1, skill: match[1]})
      }
    })
  }
  return violations
}

/** `/wh`가 받는 레인. **`wh/SKILL.md`의 선언을 읽는다** — 여기 목록을 적으면 두 곳이 갈라진다. */
export function declaredLanes(repositoryRoot) {
  const path = join(repositoryRoot, '.claude/skills/wh/SKILL.md')
  if (!existsSync(path)) return []
  const line = /^첫 단어가 (.+?) 중 하나면/m.exec(readFileSync(path, 'utf8'))
  return line ? [...line[1].matchAll(/`([a-z]+)`/g)].map(match => match[1]) : []
}

/**
 * eval 시나리오의 진입점을 사용자 경로와 대조한다(2026-09-11).
 *
 * 계기: 48개 중 43개가 `[내부]` 스킬로 곧장 들어갔다 — 사용자에게 "직접 부르지 말라"고 한
 * 경로다. 그래서 레인 판정·배너·게이트를 시험하는 시나리오가 2건뿐이었고, 문서만 보는 이
 * 검사는 그것을 한 번도 잡지 못했다.
 *
 * **내부 직행을 금지하지 않는다.** 컴패니언(모드로 골라 쓰는 부품)은 직접 시험해야 실패 원인이
 * 갈린다 — `/wh`로 넣으면 「라우팅이 그 모드를 골랐는가」와 「컴패니언이 계약을 지켰는가」가 한
 * 시험에 섞인다. 대신 **`entryKind: "internal-unit"`으로 의도를 드러내야** 한다.
 */
export function findEvalEntryViolations(repositoryRoot, {scenarios = null} = {}) {
  const internals = new Set(internalSkills(repositoryRoot))
  const lanes = new Set(declaredLanes(repositoryRoot))
  const skillsDir = join(repositoryRoot, '.claude/skills')
  const exists = name => existsSync(join(skillsDir, name, 'SKILL.md'))
  let list = scenarios
  if (list === null) {
    const path = join(repositoryRoot, '.claude/evals/scenarios.json')
    if (!existsSync(path)) return []
    list = JSON.parse(readFileSync(path, 'utf8'))
  }
  const violations = []
  for (const scenario of list) {
    const [command, lane] = String(scenario?.entrySkill ?? '').trim().split(/\s+/)
    const skill = command.replace(/^\//, '')
    if (skill === 'wh') {
      // `/wh` 단독은 자동 판정이라 허용한다. 레인을 적었으면 **선언된 레인**이어야 한다.
      if (lane !== undefined && !lanes.has(lane)) violations.push({id: scenario.id, kind: 'unknown-lane', detail: lane})
    } else if (internals.has(skill) && scenario.entryKind !== 'internal-unit') {
      violations.push({id: scenario.id, kind: 'internal-entry', detail: skill})
    } else if (!internals.has(skill) && scenario.entryKind === 'internal-unit') {
      // 표시가 거짓이면 표시의 의미가 사라진다.
      violations.push({id: scenario.id, kind: 'label-misuse', detail: skill})
    }
    const covers = Array.isArray(scenario?.covers) ? scenario.covers : []
    if (covers.length === 0) violations.push({id: scenario.id, kind: 'no-covers', detail: ''})
    for (const covered of covers) if (!exists(covered)) violations.push({id: scenario.id, kind: 'unknown-covers', detail: covered})
  }
  return violations
}

const EVAL_REASONS = {
  'unknown-lane': '`/wh`가 선언하지 않은 레인',
  'internal-entry': '내부 스킬 직행 — `/wh <lane>`으로 들어가거나 컴패니언 단위 시험이면 `entryKind: "internal-unit"`을 선언하라',
  'label-misuse': '공개 스킬에 `internal-unit` 표시 — 표시가 거짓이면 의미가 사라진다',
  'no-covers': '`covers`가 없다 — 이 시나리오가 무엇을 증명하려는지 선언하라(`eval-covered`의 근거다)',
  'unknown-covers': '존재하지 않는 스킬을 covers에 적었다',
}

export function validateEntryPoints({repositoryRoot, pass, fail}) {
  const internals = internalSkills(repositoryRoot)
  if (internals.length === 0) {
    // 분모가 0이면 이 검사는 아무것도 재지 못한다 — 통과로 세지 않는다.
    fail('entry-points: `[내부]` 선언 스킬이 0개다 — 분모가 없어 진입점 안내를 잴 수 없다')
    return
  }
  const violations = findAdvertisedInternals(repositoryRoot)
  if (violations.length > 0) {
    for (const item of violations) {
      fail(`entry-points: ${item.doc}:${item.line}가 내부 스킬 '/${item.skill}'을 진입점으로 안내한다 — `
        + '사용자 문서는 `/wh`만 안내한다(직접 호출은 레인 표시와 게이트를 건너뛴다)')
    }
    return
  }
  if (declaredLanes(repositoryRoot).length === 0) {
    fail('entry-points: `wh/SKILL.md`에서 레인 선언을 읽지 못했다 — 분모가 없어 eval 진입점을 잴 수 없다')
    return
  }
  let evalViolations
  try { evalViolations = findEvalEntryViolations(repositoryRoot) } catch (error) {
    fail(`entry-points: eval 시나리오를 읽지 못했다 — ${error.message}`)
    return
  }
  if (evalViolations.length > 0) {
    for (const item of evalViolations) {
      fail(`entry-points: eval '${item.id}' — ${EVAL_REASONS[item.kind]}${item.detail ? ` (${item.detail})` : ''}`)
    }
    return
  }
  pass(`entry point advertising checked (${internals.length} internal skills, ${USER_DOCS.length} user docs, eval entries aligned)`)
}
