#!/usr/bin/env node
// harness-session-mode.mjs — `UserPromptSubmit`: 사용자가 `/wh`(또는 `/team-flow`)로 켠 세션을 「하네스 모드」로 유지한다(안내 층).
//
// 하네스 스킬은 모델이 스스로 부르지 못한다(disable-model-invocation) — 슬래시 없이 온 요청은 하네스 게이트를 거치지 않는다.
// 사용자가 한 번 명시적으로 켠 세션에서만, 켠 뒤 첫 요청에 `/wh` 라우팅 문서 경로를 담은 안내 한 문장을 붙이고 이후 요청에는
// 짧은 한 줄만 붙인다(매 요청 전문은 문맥을 키우고 같은 문서를 거듭 다시 읽게 한다). 대화가 요약되거나(compact) 비워지면(clear)
// SessionStart가 표시의 `briefed`를 지워 다음 요청에 전문을 다시 붙인다(clear가 새 session_id를 주면 표시가 없어 모드가 꺼진 것과 같다). 강제가 아니라 안내다 — 모델이 따르는 방식이라 보장은 아니다.
// 전제(실측): 이 훅은 슬래시 명령의 원문(`prompt`)과 `session_id`를 받고, 표준 출력은 그 턴의 문맥에 붙으며,
// `--resume`은 같은 session_id를 쓴다.
//
// 표시는 저장소 밖(홈의 `.claude/web-harness/sessions/<session_id>.json`)에 둔다 — 저장소를 더럽히지 않고 세션마다 갈린다.
// **막지 않는다** — 어떤 실패도 요청을 막지 않고 침묵한다.
import {existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {isAbsolute, join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {DEFAULT_PAYLOAD_ROOT, harnessVersion} from './harness-version.mjs'
import {CONTRACTS_DIR} from './sync-plugin-contracts.mjs'

// `/wh`·`/web-harness:wh`·`/team-flow`·`/web-harness:team-flow` — 뒤따르는 인자는 `off` 판정에만 쓴다.
const ENTRY = /^\s*\/(?:web-harness:)?(wh|team-flow)(?:\s+([\s\S]*))?$/
const STALE_MS = 7 * 24 * 60 * 60 * 1000

export const sessionsDirectory = (home = homedir()) => join(home, '.claude', 'web-harness', 'sessions')
const markerPath = (home, sessionId) => join(sessionsDirectory(home), `${String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_')}.json`)
const realOrSelf = path => { try { return realpathSync(path) } catch { return resolve(path) } }
const readMarker = marker => { try { return JSON.parse(readFileSync(marker, 'utf8')) } catch { return null } }
const writeMarker = (marker, record) => writeFileSync(marker, `${JSON.stringify(record)}\n`)

// 모델이 Read로 열 수 있는 스킬 문서 — 읽기 정책(enforce-sensitive-access)은 플러그인의 `.claude/skills` 사본을 열지 않는다.
// 플러그인이면 프로젝트 안 계약 사본, 없으면(`_workspace/` 없는 프로젝트) 플러그인 문서 루트 `skills/`. 아니면 `.claude/skills`.
const skillDocument = (name, projectRoot, payloadRoot) => {
  const tail = join('skills', name, 'SKILL.md')
  const candidates = harnessVersion(payloadRoot) === null
    ? [join(payloadRoot, '.claude', tail)]
    : [join(projectRoot, CONTRACTS_DIR, tail), join(payloadRoot, tail)]
  const path = candidates.find(candidate => existsSync(candidate)) ?? candidates.at(-1)
  const fromProject = relative(projectRoot, path)
  return fromProject.startsWith('..') || isAbsolute(fromProject) ? path : fromProject
}

/**
 * 한 턴의 판정(파일 조회·기록). 문맥에 붙일 줄을 돌려준다(없으면 빈 문자열).
 * @param {{session_id?: string, prompt?: string, cwd?: string}} input
 */
export function handlePrompt(input, {home = homedir(), projectDir = process.env.CLAUDE_PROJECT_DIR, now = Date.now(), payloadRoot = DEFAULT_PAYLOAD_ROOT} = {}) {
  const sessionId = typeof input?.session_id === 'string' && input.session_id ? input.session_id : null
  if (!sessionId) return ''
  const projectRoot = realOrSelf(projectDir ?? input.cwd ?? process.cwd())
  const marker = markerPath(home, sessionId)
  const entry = name => (harnessVersion(payloadRoot) === null ? `/${name}` : `/web-harness:${name}`)
  const matched = String(input.prompt ?? '').match(ENTRY)
  if (matched) {
    if (matched[1] === 'wh' && /^\s*off\s*$/i.test(matched[2] ?? '')) {
      rmSync(marker, {force: true})
      return `[web-harness] 하네스 모드를 끝냈다 — 이후 요청은 슬래시 명령 없이는 하네스 흐름으로 처리하지 않는다.\n`
    }
    mkdirSync(sessionsDirectory(home), {recursive: true})
    writeMarker(marker, {projectRoot, since: new Date(now).toISOString()})
    pruneStale(home, now)
    return ''
  }
  const recorded = readMarker(marker)
  // 켠 프로젝트에서만 — 같은 세션이 다른 디렉터리로 옮겨 가면 붙이지 않는다.
  if (recorded?.projectRoot !== projectRoot) return ''
  if (recorded.briefed) return `[web-harness] harness mode on (${entry('wh')} off to end)\n`
  try { writeMarker(marker, {...recorded, briefed: true}) } catch { /* 기록 실패면 다음 요청에도 전문을 붙인다 */ }
  const router = skillDocument('wh', projectRoot, payloadRoot)
  const teamFlow = skillDocument('team-flow', projectRoot, payloadRoot)
  return `[web-harness] 이 세션은 하네스 모드다(${entry('wh')}로 켰다). 개발·티켓 요청은 슬래시 명령 없이도 ${router}의 라우팅`
    + `(레인 판정·티켓 의도)으로 판정해 그 흐름으로 처리하라. 티켓 작업이면 ${teamFlow}를 Read로 읽어 그 절차를 따른다 — `
    + `하네스 스킬은 Skill 도구로 부르지 않는다(모델 호출이 막혀 있어 오류가 난다). 이 세션에서 읽은 내용이 문맥에 남아 있으면 다시 읽지 않는다. `
    + `커밋 전 리뷰는 리뷰 묶음(prepare-review-packet, Bash timeout 600000) 뒤 하네스 code-reviewer 한 번이다(팀이 선언한 reviewAgents는 같은 묶음 뒤 함께 — 묶음 전 리뷰는 커밋 훅이 인정하지 않는다). `
    + `하네스와 무관한 질문은 그대로 답한다. 끝내려면 ${entry('wh')} off.\n`
}

/**
 * SessionStart — 요약(compact)·비우기(clear)로 문맥에서 안내가 빠졌으면 다음 요청에 전문을 다시 붙이게 한다. 출력은 없다.
 * @param {{session_id?: string, source?: string}} input
 */
export function handleSessionStart(input, {home = homedir()} = {}) {
  if (!['compact', 'clear'].includes(input?.source)) return
  if (typeof input.session_id !== 'string' || !input.session_id) return
  const marker = markerPath(home, input.session_id)
  const recorded = readMarker(marker)
  if (!recorded?.briefed) return
  const {briefed, ...rest} = recorded
  writeMarker(marker, rest)
}

// 오래된 표시를 치운다 — 세션이 끝나도 표시가 남으므로, 켤 때 한 번 7일 넘은 것을 지운다.
function pruneStale(home, now) {
  try {
    for (const name of readdirSync(sessionsDirectory(home))) {
      const path = join(sessionsDirectory(home), name)
      if (now - statSync(path).mtimeMs > STALE_MS) rmSync(path, {force: true})
    }
  } catch { /* 정리 실패는 무시한다 */ }
}

// 실경로로 대조한다 — 플러그인 경로에 링크가 끼면 문자열 대조가 거짓이 되어 훅이 조용히 빠진다. realOrSelf는 던지지 않는다.
if (process.argv[1] && realOrSelf(process.argv[1]) === realOrSelf(fileURLToPath(import.meta.url))) {
  try {
    let source = ''
    for await (const chunk of process.stdin) source += chunk
    const input = JSON.parse(source)
    if (input?.hook_event_name === 'SessionStart') handleSessionStart(input)
    else {
      const line = handlePrompt(input)
      if (line) process.stdout.write(line)
    }
  } catch { /* 안내 층 — 어떤 오류도 요청을 막지 않는다 */ }
  process.exit(0)
}
