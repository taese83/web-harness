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
  pass(`entry point advertising checked (${internals.length} internal skills, ${USER_DOCS.length} user docs)`)
}
