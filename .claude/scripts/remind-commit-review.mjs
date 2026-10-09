#!/usr/bin/env node
// remind-commit-review.mjs — PreToolUse(Bash): 하네스 모드 세션에서 `git commit` 직전에, 커밋될 수 있는 **코드 파일**이
// 하네스 code-reviewer가 리뷰한 내용과 같은지 리뷰 묶음 이력으로 대조한다(team-flow 3·qa-evidence Iterate 「커밋 전 리뷰」).
//
// 규칙을 문서로만 두면 메인이 레인 카드를 읽지 않은 채 고치고 커밋한다(실사용 2026-10-09). 그래서 커밋하는 순간에 알린다.
// **한 번 알린다** — 리뷰 안 된 코드가 있으면 그 커밋 시도를 한 번 돌려보내며 이유를 준다. 같은 내용으로 다시 시도하면 통과한다
// (사용자가 리뷰 없이 커밋하라고 한 경우 등 — 그 사실을 보고에 적는 것은 메인의 몫이다). 막는 게이트가 아니라 상기 장치다.
// 대상: 사용자가 `/wh`로 켠 세션(harness-session-mode 표시)의 그 프로젝트만. 문서·`_workspace`·이미지·lockfile은 대상이 아니다(isCodeReviewTarget).
// 커밋될 수 있는 파일 = HEAD 대비 바뀐 파일 + 추적 안 된 파일(같은 명령에서 `git add`하고 커밋하는 경우도 잡는다).
// 어떤 오류도 커밋을 막지 않는다(침묵하고 통과).
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {sessionsDirectory} from './harness-session-mode.mjs'
import {isCodeReviewTarget, reviewedPackets, wasReviewed} from './ticket/work-link.mjs'

const realOrSelf = path => { try { return realpathSync(path) } catch { return resolve(path) } }
const lstatExists = path => { try { lstatSync(path); return true } catch { return false } }
const safeId = id => String(id).replace(/[^A-Za-z0-9_-]/g, '_')
// 명령 안의 한 단계가 `git [-C dir | -c k=v ...] commit`인가 — 문자열 안의 `git commit` 언급은 단계 경계로 거른다.
export const COMMIT_STAGE = /(?:^|[;&|({]\s*|\n\s*)(?:(?:env|command)\s+)?(?:[A-Za-z_]\w*=\S*\s+)*(?:\S*\/)?git(?:\s+(?:-C|-c)\s+\S+|\s+--[\w-]+(?:=\S+)?)*\s+commit(?:\s|$)/

/** 하네스 모드로 켠 세션이고 같은 프로젝트인가. */
export function harnessSessionRoot(sessionId, projectRoot, {home = homedir()} = {}) {
  if (!sessionId) return false
  try {
    const marker = JSON.parse(readFileSync(join(sessionsDirectory(home), `${safeId(sessionId)}.json`), 'utf8'))
    return marker?.projectRoot === projectRoot
  } catch { return false }
}

/** 커밋될 수 있는 코드 파일 중 리뷰한 내용과 다른 것({path, blob}). git을 못 읽으면 null(판정 안 함). */
export function unreviewedCodeFiles(root) {
  const git = args => execFileSync('git', ['-C', root, '-c', 'core.quotePath=false', ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 8 * 1024 * 1024})
  let paths
  try {
    const changed = git(['diff', '--name-only', '-z', 'HEAD']).split('\0')
    const untracked = git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0')
    paths = [...new Set([...changed, ...untracked].filter(Boolean))].filter(isCodeReviewTarget).sort()
  } catch { return null }
  if (paths.length === 0) return []
  const packets = reviewedPackets(root)
  // 지문은 한 번의 `hash-object --stdin-paths`로 — 파일마다 git을 띄우지 않는다. 지운 파일은 null.
  // 일반 파일만 해시한다 — 디렉터리를 가리키는 링크 등이 섞이면 한 번의 호출 전체가 실패해 상기가 빠진다. 지운 파일은 null.
  const present = paths.filter(path => { try { return lstatSync(join(root, path)).isFile() } catch { return false } })
  let hashes
  try {
    hashes = present.length ? execFileSync('git', ['-C', root, 'hash-object', '--stdin-paths'], {input: present.join('\n'), encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 8 * 1024 * 1024}).trim().split('\n') : []
  } catch { return null }
  const blobOf = new Map(present.map((path, index) => [path, hashes[index]]))
  return paths.filter(path => blobOf.has(path) || !lstatExists(join(root, path))).map(path => ({path, blob: blobOf.get(path) ?? null})).filter(({path, blob}) => !wasReviewed(packets, path, blob))
}

/** 판정. 돌려보낼 이유(문자열) 또는 null(통과). */
export function decide(input, {home = homedir(), projectDir = process.env.CLAUDE_PROJECT_DIR} = {}) {
  if (input?.tool_name !== 'Bash' || !COMMIT_STAGE.test(String(input?.tool_input?.command ?? ''))) return null
  if (input.agent_type) return null  // 커밋은 메인이 한다 — 서브에이전트 Bash는 다른 정책이 다룬다
  const root = realOrSelf(projectDir ?? input.cwd ?? process.cwd())
  if (!harnessSessionRoot(input.session_id, root, {home})) return null
  const unreviewed = unreviewedCodeFiles(root)
  if (!unreviewed || unreviewed.length === 0) return null
  // 같은 내용으로 이미 한 번 알렸으면 통과한다(상기 장치 — 두 번 막지 않는다).
  const fingerprint = createHash('sha256').update(unreviewed.map(({path, blob}) => `${path}:${blob}`).join('\n')).digest('hex')
  const notice = join(sessionsDirectory(home), `${safeId(input.session_id)}.commit-review.json`)
  try { if (JSON.parse(readFileSync(notice, 'utf8')).fingerprint === fingerprint) return null } catch { /* 처음 */ }
  // 기록에 실패하면 다음에도 알린다 — 상기 장치의 안전한 실패는 「매번 알림」이지 침묵이 아니다.
  try { mkdirSync(sessionsDirectory(home), {recursive: true}); writeFileSync(notice, `${JSON.stringify({fingerprint, at: new Date().toISOString()})}\n`) } catch { /* 다음에도 알린다 */ }
  const shown = unreviewed.slice(0, 10).map(({path}) => `\`${path}\``).join(', ') + (unreviewed.length > 10 ? ` 외 ${unreviewed.length - 10}개` : '')
  return '[web-harness] 하네스 훅의 상기다(사용자가 거부한 것이 아니다). '
    + `커밋 전 코드 리뷰가 없다 — 리뷰한 뒤 바뀌었거나 리뷰하지 않은 코드 파일: ${shown}. `
    + '커밋 전에 리뷰 묶음(`prepare-review-packet.mjs --project-root {root} --base HEAD`)을 만들고 새 문맥 code-reviewer로 리뷰해 지적을 선별·수정한 뒤 커밋하라'
    + '(team-flow 3·5, fix·change는 qa-evidence Iterate 「커밋 전 리뷰」). 묶음 출력에 Codex 교차 리뷰 명령이 나오면(개발자가 켠 프로젝트) 함께 병렬로 돌린다. 문서·`_workspace`·이미지·lockfile만 바꾼 커밋은 대상이 아니다. '
    + '사용자가 리뷰 없이 커밋하라고 했으면 같은 명령을 다시 실행하면 통과한다 — 그 사실을 보고에 적는다.'
}

if (process.argv[1] && realOrSelf(process.argv[1]) === realOrSelf(fileURLToPath(import.meta.url))) {
  try {
    let source = ''
    for await (const chunk of process.stdin) source += chunk
    const reason = decide(JSON.parse(source))
    if (reason) process.stdout.write(`${JSON.stringify({hookSpecificOutput: {hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason}})}\n`)
  } catch { /* 상기 장치 — 어떤 오류도 커밋을 막지 않는다 */ }
  process.exit(0)
}
