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
  return `${head} 프로젝트 규약이 먼저이고, 보안 항목 전부와 WCAG 하한은 규약으로도 내리지 않는다. `
    + '반환 끝(`SPAWN_RESULT` 블록이 있으면 그 바로 앞)에 줄 머리부터 `REFERENCES_USED: <근거로 쓴 항목 ID들>` 또는 `REFERENCES_USED: none(이유)`를 적는다 — 이 줄과 항목 ID·레퍼런스 이름은 '
    + '반환에만 두고 코드·주석·노트·보고서 파일·커밋·PR에는 쓰지 않는다(기준 자체를 문장으로 쓴다).'
}

/** 주입한 스폰의 표시 — 짝 훅(SubagentStop)이 이 스폰만 확인한다. */
export const markerPath = (agentId, home = homedir()) => join(sessionsDirectory(home), `refs-${String(agentId).replace(/[^A-Za-z0-9_-]/g, '_')}.json`)

/** 최종 반환에 REFERENCES_USED 줄이 있는가 — 줄 머리에서 시작하고 값이 항목 ID나 none이어야 한다(안내를 되뇐 문장은 아니다). */
export const hasReferencesUsed = text => /^[\s>*`-]*REFERENCES_USED[`*]*\s*[:：]\s*`?(?:none\b|[A-Z][A-Z0-9]*-\d+)/m.test(String(text ?? ''))
/** 기준 파일 경로인가 — 텔레메트리가 실제로 연 파일을 센다. */
export const isReferenceFile = path => /(?:^|\/)(?:implementation-references(?:-services)?|ref-(?:a11y-components|web-security|react-structure|data-fetching))\.md$/.test(String(path ?? ''))
