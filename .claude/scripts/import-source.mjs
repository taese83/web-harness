#!/usr/bin/env node
// import-source.mjs — 사용자가 준 파일(프로젝트 밖 경로의 PDF·문서 등)을 `_workspace/00_source/`로 들인다.
//
// 에이전트의 파일 도구는 프로젝트 밖을 읽지 못한다(비밀 경로 보호). 사용자가 대화에서 경로를 주면 사용자가 손으로 옮기거나,
// 에이전트가 훅을 우회하는 수밖에 없었다. 이 명령이 그 들이기의 길이다:
//   - 사람 승인 훅이 실행 전에 사용자 확인을 묻는다(사용자가 준 파일인지 사람이 확인한다)
//   - 비밀로 보이는 경로(.env·키·자격 증명)와 링크·디렉터리는 들이지 않는다 · 크기 상한 50MB
//   - 들인 뒤에는 `_workspace/00_source/imported/<이름>`을 읽는다. 원본은 건드리지 않는다
//
// 사용법: node .claude/scripts/import-source.mjs --project-root <path> --from <절대 경로> [--as <이름>]
// 종료 코드: 0 = 들였다, 1 = 들이지 않았다(비밀 경로·링크·크기·없음), 2 = 사용법 오류.
import {copyFileSync, existsSync, lstatSync, mkdirSync, realpathSync} from 'node:fs'
import {basename, isAbsolute, join, resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {answerHelp} from './cli-help-lib.mjs'

export const IMPORT_DIR = '_workspace/00_source/imported'
const MAX_BYTES = 50 * 1024 * 1024
const SECRET = /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.pypirc|\.git-credentials|id_(?:rsa|ed25519|ecdsa|dsa))$|\.(?:pem|key|p12|pfx|jks|keystore)$|(?:^|\/)(?:\.ssh|\.aws|\.azure|\.gnupg|\.kube|\.docker|\.config|\.claude|\.git|Library\/Keychains|secrets?|credentials?)(?:\/|$)/i

export function planImport({root, from, as}) {
  if (!isAbsolute(String(from ?? ''))) return {ok: false, code: 'FROM_NOT_ABSOLUTE', guidance: '--from은 사용자가 준 절대 경로다'}
  const source = resolve(from)
  if (SECRET.test(source.replaceAll('\\', '/'))) return {ok: false, code: 'SECRET_PATH', guidance: '비밀로 보이는 경로는 들이지 않는다'}
  if (!existsSync(source)) return {ok: false, code: 'NOT_FOUND', guidance: `파일이 없다: ${source}`}
  // 링크를 푼 실제 경로도 본다 — 평범한 이름의 디렉터리 링크가 비밀 디렉터리를 가리킬 수 있다.
  let real
  try { real = realpathSync(source) } catch { return {ok: false, code: 'NOT_FOUND', guidance: `경로를 풀 수 없다: ${source}`} }
  if (SECRET.test(real.replaceAll('\\', '/'))) return {ok: false, code: 'SECRET_PATH', guidance: '비밀로 보이는 경로(실제 경로 기준)는 들이지 않는다'}
  const stats = lstatSync(source)
  if (stats.isSymbolicLink() || !stats.isFile()) return {ok: false, code: 'NOT_REGULAR_FILE', guidance: '링크·디렉터리는 들이지 않는다 — 파일 하나를 준다'}
  if (stats.size > MAX_BYTES) return {ok: false, code: 'TOO_LARGE', guidance: '50MB를 넘는 파일은 들이지 않는다'}
  const name = String(as ?? basename(source)).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120)
  if (!name || name.startsWith('.')) return {ok: false, code: 'BAD_NAME', guidance: '--as로 이름을 준다'}
  const target = `${IMPORT_DIR}/${name}`
  if (existsSync(join(root, target))) return {ok: false, code: 'EXISTS', guidance: `이미 있다: ${target} — --as로 다른 이름을 준다`}
  return {ok: true, source, target, bytes: stats.size}
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  answerHelp(import.meta.url)
  const argv = process.argv.slice(2)
  const value = name => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined }
  const root = value('--project-root')
  const from = value('--from')
  if (!root || !from) {
    process.stderr.write('사용법: node .claude/scripts/import-source.mjs --project-root <path> --from <절대 경로> [--as <이름>]\n')
    process.exit(2)
  }
  const plan = planImport({root: resolve(root), from, as: value('--as')})
  if (!plan.ok) { process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`); process.exit(1) }
  mkdirSync(join(resolve(root), IMPORT_DIR), {recursive: true})
  copyFileSync(plan.source, join(resolve(root), plan.target))
  process.stdout.write(`${JSON.stringify({...plan, imported: true, guidance: `이제 ${plan.target}를 읽는다`}, null, 2)}\n`)
}
