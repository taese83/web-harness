#!/usr/bin/env node
// harness-session-mode.mjs — `UserPromptSubmit`: 사용자가 `/wh`(또는 `/team-flow`)로 켠 세션을 「하네스 모드」로 유지한다(안내 층).
//
// 하네스 스킬은 모델이 스스로 부르지 못한다(disable-model-invocation) — 슬래시 없이 온 요청은 하네스 게이트를 거치지 않는다.
// 사용자가 한 번 명시적으로 켠 세션에서만, 이후 요청마다 `/wh` 라우팅 문서의 절대 경로를 한 줄 붙인다. 대화가 요약돼 스킬
// 지침이 빠져도 모델이 라우팅을 다시 읽을 수 있게 하려는 것이다. 강제가 아니라 안내다 — 모델이 따르는 방식이라 보장은 아니다.
// 전제(실측): 이 훅은 슬래시 명령의 원문(`prompt`)과 `session_id`를 받고, 표준 출력은 그 턴의 문맥에 붙으며,
// `--resume`은 같은 session_id를 쓴다.
//
// 표시는 저장소 밖(홈의 `.claude/web-harness/sessions/<session_id>.json`)에 둔다 — 저장소를 더럽히지 않고 세션마다 갈린다.
// **막지 않는다** — 어떤 실패도 요청을 막지 않고 침묵한다.
import {existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const PLUGIN = existsSync(new URL('../../.claude-plugin/plugin.json', import.meta.url))
const entry = name => (PLUGIN ? `/web-harness:${name}` : `/${name}`)
const ROUTER = fileURLToPath(new URL('../skills/wh/SKILL.md', import.meta.url))
// `/wh`·`/web-harness:wh`·`/team-flow`·`/web-harness:team-flow` — 뒤따르는 인자는 `off` 판정에만 쓴다.
const ENTRY = /^\s*\/(?:web-harness:)?(wh|team-flow)(?:\s+([\s\S]*))?$/
const STALE_MS = 7 * 24 * 60 * 60 * 1000

export const sessionsDirectory = (home = homedir()) => join(home, '.claude', 'web-harness', 'sessions')
const markerPath = (home, sessionId) => join(sessionsDirectory(home), `${String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_')}.json`)
const realOrSelf = path => { try { return realpathSync(path) } catch { return resolve(path) } }

/**
 * 한 턴의 판정(파일 조회·기록). 문맥에 붙일 줄을 돌려준다(없으면 빈 문자열).
 * @param {{session_id?: string, prompt?: string, cwd?: string}} input
 */
export function handlePrompt(input, {home = homedir(), projectDir = process.env.CLAUDE_PROJECT_DIR, now = Date.now()} = {}) {
  const sessionId = typeof input?.session_id === 'string' && input.session_id ? input.session_id : null
  if (!sessionId) return ''
  const projectRoot = realOrSelf(projectDir ?? input.cwd ?? process.cwd())
  const marker = markerPath(home, sessionId)
  const matched = String(input.prompt ?? '').match(ENTRY)
  if (matched) {
    if (matched[1] === 'wh' && /^\s*off\s*$/i.test(matched[2] ?? '')) {
      rmSync(marker, {force: true})
      return `[web-harness] 하네스 모드를 끝냈다 — 이후 요청은 슬래시 명령 없이는 하네스 흐름으로 처리하지 않는다.\n`
    }
    mkdirSync(sessionsDirectory(home), {recursive: true})
    writeFileSync(marker, `${JSON.stringify({projectRoot, since: new Date(now).toISOString()})}\n`)
    pruneStale(home, now)
    return ''
  }
  if (!existsSync(marker)) return ''
  let recorded = null
  try { recorded = JSON.parse(readFileSync(marker, 'utf8')) } catch { return '' }
  // 켠 프로젝트에서만 — 같은 세션이 다른 디렉터리로 옮겨 가면 붙이지 않는다.
  if (recorded?.projectRoot !== projectRoot) return ''
  return `[web-harness] 이 세션은 하네스 모드다(${entry('wh')}로 켰다). 개발·티켓 요청은 슬래시 명령 없이도 ${ROUTER}의 라우팅`
    + `(레인 판정·티켓 의도)으로 판정해 그 흐름으로 처리하라. 하네스와 무관한 질문은 그대로 답한다. 끝내려면 ${entry('wh')} off.\n`
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
    const line = handlePrompt(JSON.parse(source))
    if (line) process.stdout.write(line)
  } catch { /* 안내 층 — 어떤 오류도 요청을 막지 않는다 */ }
  process.exit(0)
}
