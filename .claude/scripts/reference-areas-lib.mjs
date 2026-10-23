// reference-areas-lib.mjs — 이번 변경이 닿는 외부 기준 영역(implementation-references.md의 표)을 고르고, 서브에이전트에 줄 안내를 만든다.
//
// 기준 파일은 에이전트 정의의 조건부 문장만으로는 읽히지 않았다 — 스폰 프롬프트의 「먼저 읽어라」 목록에 없으면 에이전트는 그 목록을
// 전부로 본다. 그래서 SubagentStart 훅이 영역을 골라 읽을 파일을 직접 건넨다. 영역은 change-scope의 `REFERENCE_AREAS`(메인 선언)와
// 범위 경로·변경 파일의 이름·내용 추정의 합집합이다 — 추정은 근사다(protected-core §4 「외부 기준 주입」).
import {spawnSync} from 'node:child_process'
import {existsSync, readFileSync, statSync} from 'node:fs'
import {homedir} from 'node:os'
import {join} from 'node:path'
import {parseChangeScopeAllowedPaths} from './change-scope-lib.mjs'
import {sessionsDirectory} from './harness-session-mode.mjs'

export const AREAS = {
  a11y: {file: 'ref-a11y-components.md', label: '접근성 컴포넌트'},
  security: {file: 'ref-web-security.md', label: '웹 보안'},
  structure: {file: 'ref-react-structure.md', label: '구조·React'},
  'data-fetching': {file: 'ref-data-fetching.md', label: '데이터 패칭'},
}
const HUB = 'implementation-references.md'
const SERVICES = 'implementation-references-services.md'

// 이름(경로)과 내용 신호. 근사다 — 넓게 잡는 쪽으로 틀린다(기준 파일 하나를 더 읽는 비용이 놓치는 비용보다 작다).
const PATH_WORDS = {
  a11y: ['dialog', 'modal', 'menu', 'tab', 'tabs', 'tablist', 'toast', 'sheet', 'popover', 'tooltip', 'listbox', 'combobox', 'dropdown', 'drawer', 'form', 'input', 'alert', 'notice'],
  security: ['auth', 'login', 'logout', 'token', 'session', 'cookie', 'csrf', 'oauth', 'sanitize', 'redirect'],
  structure: ['provider', 'providers', 'store', 'context'],
  'data-fetching': ['query', 'queries', 'mutation', 'fetch', 'api'],
}
// 경로를 단어로 쪼갠다(구분자·camelCase) — `platform`·`format`이 `form`으로 걸리지 않게.
const pathWords = path => new Set(path.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z]+/).filter(Boolean))
const CONTENT_SIGNALS = {
  a11y: /role=["'{](?:dialog|alertdialog|menu|menuitem|tab|tablist|tabpanel|listbox|combobox|status|alert|log)|aria-(?:modal|haspopup|expanded|live|controls)|<dialog\b|<form\b|<input\b|<select\b|<textarea\b/,
  security: /dangerouslySetInnerHTML|\.innerHTML\s*=|window\.open\(|location\.(?:href|assign|replace)|document\.cookie|Authorization|access_?token|refresh_?token|accessToken|refreshToken|postMessage\(/,
  structure: /\buse(?:Layout)?Effect\(|\bcreateContext\(|\buseSyncExternalStore\(/,
  'data-fetching': /\buse(?:Suspense)?Query\(|\buseMutation\(|invalidateQueries|\bfetch\(|\baxios\b/,
}
const CODE = /\.(?:[cm]?[jt]sx?|vue|svelte|html)$/
const MAX_FILES = 200
const MAX_BYTES = 256 * 1024

const git = (root, args) => {
  const result = spawnSync('git', ['-C', root, '-c', 'core.quotePath=false', ...args], {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024})
  return result.status === 0 ? result.stdout : null
}

/** change-scope 마지막 항목의 `REFERENCE_AREAS:` 선언. 없으면 null, `none`이면 빈 배열. */
export function declaredAreas(source) {
  const line = [...String(source).matchAll(/^[-*\s]*["*]{0,2}REFERENCE_AREAS["*]{0,2}\s*[:：]\s*(.+)$/gmi)].at(-1)?.[1]
  if (line === undefined) return null
  if (/^\s*[`"]?none/i.test(line)) return []
  // 템플릿 자리표시자(`… 중 … | none`)를 그대로 옮긴 줄은 선언이 아니다 — 네 영역 전부로 읽지 않는다.
  if (/\s중\b|\|/.test(line)) return null
  return line.split(/[,·\s]+/).map(value => value.replace(/[`"]/g, '').toLowerCase()).filter(value => Object.hasOwn(AREAS, value))
}

/** 경로 목록과 그 내용에서 추정한 영역. 새로 추가된 파일이 있으면 구조(새 모듈) 영역이다. */
export function inferredAreas(root, paths, {added = []} = {}) {
  const found = new Set()
  if (added.some(path => CODE.test(path))) found.add('structure')
  for (const path of paths) {
    const words = pathWords(path)
    for (const [area, list] of Object.entries(PATH_WORDS)) if (list.some(word => words.has(word))) found.add(area)
  }
  const files = []
  for (const path of paths) {
    const absolute = join(root, path)
    try {
      const stat = statSync(absolute)
      if (stat.isFile() && CODE.test(path)) files.push(path)
      else if (stat.isDirectory()) {
        const listed = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', path]) ?? ''
        files.push(...listed.split('\0').filter(file => CODE.test(file)))
      }
    } catch { /* 아직 없는 경로 — 이름 신호만 */ }
    if (files.length >= MAX_FILES) break
  }
  for (const file of files.slice(0, MAX_FILES)) {
    let text
    try { if (statSync(join(root, file)).size > MAX_BYTES) continue; text = readFileSync(join(root, file), 'utf8') } catch { continue }
    for (const [area, pattern] of Object.entries(CONTENT_SIGNALS)) if (pattern.test(text)) found.add(area)
  }
  return found
}

/** 이번 변경의 영역 — 선언 ∪ (범위 경로 + 작업 트리 변경 파일) 추정. */
export function changeAreas(root) {
  let scope = ''
  try { scope = readFileSync(join(root, '_workspace/03_dev/change-scope.md'), 'utf8') } catch { /* 범위 없음 */ }
  const declared = declaredAreas(scope)
  const allowed = scope ? parseChangeScopeAllowedPaths(scope) : {paths: []}
  const changed = (git(root, ['diff', '--name-only', '-z', 'HEAD']) ?? '').split('\0').filter(Boolean)
  const added = (git(root, ['ls-files', '-z', '--others', '--exclude-standard']) ?? '').split('\0').filter(Boolean)
  const paths = [...new Set([...(allowed.paths ?? []), ...changed, ...added])].filter(path => !path.startsWith('_workspace/'))
  const areas = new Set([...(declared ?? []), ...inferredAreas(root, paths, {added: added.filter(path => !path.startsWith('_workspace/'))})])
  return Object.keys(AREAS).filter(area => areas.has(area))
}

// 에이전트마다 보는 영역 — 보안 리뷰는 보안만, 설계는 허브에서 스스로 고른다(판정 시점엔 범위가 아직 없다).
const CONSUMERS = {
  developer: 'change',
  'code-reviewer': 'change',
  'security-reviewer': 'security',
  'system-architect': 'hub',
}
export const isReferenceConsumer = name => Object.hasOwn(CONSUMERS, name)

/** 기준 파일이 있는 디렉터리 — 플러그인 판본은 계약 사본, 원본 저장소는 `.claude/skills`. 없으면 null. */
export function referencesDirectory(root, {pluginBuild}) {
  const relative = pluginBuild ? '_workspace/.contracts/skills/web-orchestrator/references' : '.claude/skills/web-orchestrator/references'
  return existsSync(join(root, relative, HUB)) ? relative : null
}

/** 소비자에게 건넬 영역 — 보안 리뷰는 추정과 무관하게 보안 기준을 받는다(그 항목은 전부 하한이다, I6). 설계는 허브만. */
export function consumerAreas(root, agentName) {
  const kind = CONSUMERS[agentName]
  if (kind === 'hub' || kind === undefined) return []
  return kind === 'security' ? ['security'] : changeAreas(root)
}

/** SubagentStart에 줄 안내(문자열) 또는 null(소비자가 아니거나 기준 파일이 없다). */
export function referenceContext(root, agentName, {pluginBuild}) {
  if (!isReferenceConsumer(agentName)) return null
  const directory = referencesDirectory(root, {pluginBuild})
  if (!directory) return null
  const kind = CONSUMERS[agentName]
  const areas = consumerAreas(root, agentName)
  const files = areas.map(area => `\`${directory}/${AREAS[area].file}\`(${AREAS[area].label})`)
  const head = kind === 'hub'
    ? `[web-harness] 외부 기준 — 설계 결정은 \`${directory}/${HUB}\`의 표에서 결정이 닿는 영역 파일을 골라 읽고 근거로 삼는다. `
      + `구조를 실제 서비스와 비교할 때는 \`${directory}/${SERVICES}\`를 연다.`
    : files.length
      ? `[web-harness] 외부 기준 — 이번 변경이 닿는 영역의 기준 파일을 작업 전에 읽는다: ${files.join(', ')}. 판단 순서·하한은 \`${directory}/${HUB}\`.`
      : `[web-harness] 외부 기준 — 이번 변경에서 기준 영역을 찾지 못했다. 대화상자·메뉴·알림, 인증·토큰·외부 입력 출력, 새 모듈·Effect·상태 위치, 서버 상태 조회·변경을 만들거나 바꾸면 \`${directory}/${HUB}\`의 표에서 그 영역 파일을 읽는다.`
  // 설계·구현은 목록 밖 결정을 추측하지 않고 리서치를 요청한다(메인이 tech-advisor 구현 리서치 모드로 답을 구한다).
  const research = agentName === 'developer' || agentName === 'system-architect'
    ? '기준 목록과 저장소로 확인되지 않는 결정(플랫폼·웹뷰·외부 SDK·브라우저 API·라이브러리 동작)은 추측으로 정하지 않고 반환에 '
      + '`RESEARCH_NEEDED: <질문>`(최대 5)을 올린다 — 메인이 구현 리서치로 답을 구해 온다. 스폰 프롬프트에 리서치 답이 있으면 그것을 따른다. '
    : ''
  return `${head} ${research}프로젝트 규약이 먼저이고, 보안 항목 전부와 WCAG 하한은 규약·리서치 답으로도 내리지 않는다. `
    + '반환 끝(`SPAWN_RESULT` 블록이 있으면 그 바로 앞)에 줄 머리부터 `REFERENCES_USED: <근거로 쓴 항목 ID들>` 또는 `REFERENCES_USED: none(이유)`를 적는다 — 이 줄과 항목 ID·레퍼런스 이름은 '
    + '반환에만 두고 코드·주석·노트·보고서 파일·커밋·PR에는 쓰지 않는다(기준 자체를 문장으로 쓴다).'
}

// 구현은 기존 코드를 보존한다 — 보존 지시 하나로 초과 수정·추가 복잡도가 줄고 정답률은 오른다는 측정이 있다(최소 수정 과제 400개).
// 지시를 에이전트 정의 문장으로만 두면 읽히지 않는다(외부 기준과 같은 교훈) — 시작 훅이 건넨다.
export const PRESERVATION = '[web-harness] 수정 범위 — 기존 코드를 보존한다. 요청과 승인된 범위에 필요한 줄만 바꾸고, 이름 변경·리포맷·옮기기, '
  + '요청에 없는 추상화·방어 코드·fallback·일어날 수 없는 경우의 처리를 더하지 않는다(✋에서 승인된 덧붙일 것만 예외). '
  + '보안 항목·WCAG 하한·요청된 오류 처리는 덧붙임이 아니라 요구다 — 빼지 않는다. '
  + '넣고 싶은 것이 있으면 코드에 넣지 말고 반환에 `EXTRAS: <목록>`으로 올린다. '
  + '반환 전에 이번 변경만 다시 보고, 이번 변경으로 생긴 중복·안 쓰게 된 코드·임시 이름을 정리한다 — 이번 변경과 무관한 줄은 건드리지 않고, 지운 고아 코드는 반환에 적는다.'
export const implementationGuidance = agentName => (agentName === 'developer' ? PRESERVATION : null)

// 턴 한도는 응답 수로 센다 — 독립 조회를 한 응답에 하나씩 부르면 쓰기 전에 한도가 찬다(실사용 2026-10 실측). 하네스가 배포한 에이전트 모두에 건넨다.
// 구간 읽기는 구현에만 — 리뷰어는 리뷰 대상(diff.patch)을 끝까지 읽어야 한다.
export const BATCHING = '[web-harness] 턴 — 턴 한도는 응답 수로 센다. 서로 기대지 않는 조회(Read·Grep·Glob)는 한 응답에 여러 개를 함께 부르고, '
  + '다음 조회가 앞 결과에 기댈 때만 나눈다. 이미 읽은 구간은 다시 넘기지 않는다.'
const DEVELOPER_RANGE = ' 큰 소스·테스트 파일은 Grep -n으로 줄을 찾아 그 구간만 읽는다.'
// 하네스가 배포한 에이전트만 — 이름 판별(agent-identity)은 개발 판본에서 접두 없는 모든 이름을 하네스로 보므로 정의 파일로 좁힌다
// (플러그인에서는 build-plugin의 .claude/agents 호환 사본에 기댄다).
const shipsAgent = name => /^[a-z][a-z0-9-]*$/.test(String(name ?? '')) && existsSync(new URL(`../agents/${name}.md`, import.meta.url))
export const turnGuidance = agentName => (agentName === 'developer' ? `${BATCHING}${DEVELOPER_RANGE}` : shipsAgent(agentName) ? BATCHING : null)

/** 주입한 스폰의 표시 — 짝 훅(SubagentStop)이 이 스폰만 확인한다. */
export const markerPath = (agentId, home = homedir()) => join(sessionsDirectory(home), `refs-${String(agentId).replace(/[^A-Za-z0-9_-]/g, '_')}.json`)

/** 최종 반환에 REFERENCES_USED 줄이 있는가 — 줄 머리에서 시작하고 값이 항목 ID나 none이어야 한다(안내를 되뇐 문장은 아니다). */
export const hasReferencesUsed = text => /^[\s>*`-]*REFERENCES_USED[`*]*\s*[:：]\s*`?(?:none\b|[A-Z][A-Z0-9]*-\d+)/m.test(String(text ?? ''))
/** 기준 파일 경로인가 — 텔레메트리가 실제로 연 파일을 센다. */
export const isReferenceFile = path => /(?:^|\/)(?:implementation-references(?:-services)?|ref-(?:a11y-components|web-security|react-structure|data-fetching))\.md$/.test(String(path ?? ''))
