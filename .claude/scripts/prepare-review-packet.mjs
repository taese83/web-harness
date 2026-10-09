#!/usr/bin/env node
// prepare-review-packet.mjs — 읽기 전용 리뷰어에게 넘길 증거 묶음을 메인이 한 번에 만든다.
//
// 리뷰어(code-reviewer·security-reviewer·api-contract-verifier 등)는 Bash가 없다 — 변경과 기계 판정을 스스로
// 실행해 얻지 않고 이 묶음을 Read로 읽는다. 묶음에 없거나 exit가 0이 아닌 항목은 리뷰어가 「확인 불가」로 적는다.
//
// 사용법:
//   node .claude/scripts/prepare-review-packet.mjs --project-root <path> [--base <ref>] [--handoff design|development]
// 산출: <project>/_workspace/04_qa/review-packet/ — INDEX.json(항목별 명령·exit·sha256)과 항목 파일.
// 종료 코드: 0 = 묶음 작성(항목 실패는 INDEX에 기록), 2 = 사용법 오류·경계 밖.
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {existsSync, lstatSync, realpathSync, rmSync, statSync} from 'node:fs'
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {answerHelp} from './cli-help-lib.mjs'
import {atomicWriteProjectFile} from './safe-project-file-lib.mjs'
import {appendReviewHistory} from './ticket/work-link.mjs'
import {computeImpact, parseDiffNames, renderImpact} from './review-impact-lib.mjs'

answerHelp(import.meta.url)

const usage = () => {
  process.stderr.write('Usage: prepare-review-packet.mjs --project-root <path> [--base <ref>] [--handoff design|development]\n')
  process.exit(2)
}
const argv = process.argv.slice(2)
const values = new Map()
for (let index = 0; index < argv.length; index += 2) {
  const option = argv[index]
  const value = argv[index + 1]
  if (!['--project-root', '--base', '--handoff'].includes(option) || value === undefined || values.has(option)) usage()
  values.set(option, value)
}
if (!values.has('--project-root')) usage()
const handoff = values.get('--handoff')
if (handoff !== undefined && !['design', 'development'].includes(handoff)) usage()
const base = values.get('--base')

const scripts = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = realpathSync(resolve(scripts, '..', '..'))
let projectRoot
try {
  projectRoot = realpathSync(resolve(values.get('--project-root')))
  if (!statSync(projectRoot).isDirectory()) throw new Error('not a directory')
} catch {
  process.stderr.write('Review packet project must be an existing directory.\n')
  process.exit(2)
}
// 경계는 run-git-inspection과 같다 — 하니스 저장소 내부 또는 세션 프로젝트(CLAUDE_PROJECT_DIR, Bash 도구에는 없으므로
// 작업 디렉터리). 쓰기는 그 프로젝트의 고정 경로 하나(`_workspace/04_qa/review-packet/`)뿐이고 링크를 따라가지 않는다.
const inside = root => {
  if (!root) return false
  let realRoot
  try { realRoot = realpathSync(resolve(root)) } catch { return false }
  const offset = relative(realRoot, projectRoot)
  if (offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)) return false
  return !['.claude', '.git', '_workspace'].includes(offset.split(sep)[0])
}
if (!inside(repositoryRoot) && !inside(process.env.CLAUDE_PROJECT_DIR || process.cwd())) {
  process.stderr.write('Review packet project must stay inside the harness repository or the current session project.\n')
  process.exit(2)
}

const PACKET = '_workspace/04_qa/review-packet'
const MAX_BYTES = 2 * 1024 * 1024
const node = (script, args) => ({command: ['node', `.claude/scripts/${script}`, ...args], script, args})
const git = operation => node('run-git-inspection.mjs', [
  '--project', projectRoot, '--operation', operation,
  ...(base !== undefined && operation !== 'status' && operation !== 'ls-files' ? ['--base', base] : []),
])
const items = [
  {file: 'status.txt', ...git('status')},
  {file: 'diff-stat.txt', ...git('diff-stat')},
  {file: 'diff-names.txt', ...git('diff-names')},
  {file: 'diff.patch', ...git('diff')},
  {file: 'ls-files.txt', ...git('ls-files')},
  {file: 'layer-boundaries.json', ...node('validate-layer-boundaries.mjs', ['--project-root', projectRoot, '--json'])},
  {file: 'reuse-inventory.txt', ...node('reuse-inventory.mjs', ['--project-root', projectRoot])},
  ...(handoff ? [{file: `handoff-${handoff}.json`, ...node('validate-handoff-readiness.mjs', ['--project', projectRoot, '--to', handoff, '--json'])}] : []),
]
const OPTIONAL = ['handoff-design.json', 'handoff-development.json']

const sha256 = content => createHash('sha256').update(content).digest('hex')
const entries = []
let diffNames = null
for (const item of items) {
  const result = spawnSync(process.execPath, [join(scripts, item.script), ...item.args], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout: 120_000,
  })
  let content = result.stdout ?? ''
  const truncated = Buffer.byteLength(content) > MAX_BYTES
  if (truncated) content = Buffer.from(content).subarray(0, MAX_BYTES).toString('utf8')
  atomicWriteProjectFile(projectRoot, `${PACKET}/${item.file}`, content)
  if (item.file === 'diff-names.txt' && result.status === 0) diffNames = content
  entries.push({
    file: item.file,
    command: item.command.map(part => (part === projectRoot ? '{project-root}' : part)).join(' '),
    exitCode: Number.isInteger(result.status) ? result.status : null,
    ...(result.stderr ? {stderr: result.stderr.slice(0, 2000)} : {}),
    ...(result.error ? {error: result.error.message} : {}),
    bytes: Buffer.byteLength(content),
    truncated,
    sha256: sha256(content),
  })
}
// 영향 범위 — 바뀐 소스 파일의 사용처. 리뷰가 diff 밖의 호출부까지 열어 보게 한다(diff-names를 못 읽었으면 확인 불가).
{
  let content
  let exitCode = 0
  try {
    content = diffNames === null ? '바뀐 파일 목록(diff-names)을 읽지 못해 영향 범위를 계산하지 않았다 — 확인 불가.\n'
      : renderImpact(computeImpact(projectRoot, parseDiffNames(diffNames)))
    if (diffNames === null) exitCode = 2
  } catch (error) {
    content = `영향 범위 계산 실패: ${String(error?.message ?? error).slice(0, 200)}\n`
    exitCode = 2
  }
  atomicWriteProjectFile(projectRoot, `${PACKET}/impact.txt`, content)
  entries.push({file: 'impact.txt', command: 'review-impact-lib (diff-names 기반)', exitCode, bytes: Buffer.byteLength(content), truncated: false, sha256: sha256(content)})
}
// 리뷰한 내용의 지문 — 바뀐 파일마다 작업 트리 내용의 git blob id(지운 파일은 null). `link`가 커밋마다 「그 커밋의 파일 내용이
// 하네스 리뷰가 뒤따른 묶음에 같은 내용으로 있었는가」를 대조한다(커밋 전 리뷰·커밋 여러 개). `_workspace`는 산출물이라 뺀다.
const reviewedFiles = {}
if (diffNames !== null) {
  for (const path of parseDiffNames(diffNames)) {
    if (path.startsWith('_workspace/')) continue
    const absolute = join(projectRoot, path)
    if (!existsSync(absolute)) { reviewedFiles[path] = null; continue }
    const blob = spawnSync('git', ['-C', projectRoot, 'hash-object', '--', path], {encoding: 'utf8'})
    if (blob.status === 0) reviewedFiles[path] = blob.stdout.trim()
  }
}
// 이번에 만들지 않은 선택 항목은 지운다 — 지난 라운드 파일이 현재 판정처럼 읽히지 않게.
for (const file of OPTIONAL) {
  if (entries.some(entry => entry.file === file)) continue
  const path = join(projectRoot, PACKET, file)
  if (existsSync(path) && lstatSync(path).isFile()) rmSync(path)
}
const generatedAt = new Date().toISOString()
const index = {
  schemaVersion: 1,
  generatedAt,
  base: base ?? null,
  files: reviewedFiles,
  exitMeaning: {
    git: '0 = 조회됨, 그 밖 = 확인 불가',
    'layer-boundaries.json': '0 = PASS, 1 = FAIL(방향 위반), 3 = 미판정(확인 불가 — 통과가 아니다), 2 = 확인 불가',
    'reuse-inventory.txt': '0 = 보고됨, 그 밖 = 확인 불가',
    'impact.txt': '0 = 사용처 목록(근사), 2 = 확인 불가',
    'handoff-*.json': '0 = HOLE 없음, 1 = HOLES(파일의 JSON을 그대로 옮긴다), 2 = 기계 판정 미수행',
  },
  note: '묶음은 generatedAt 시점의 트리만 담는다 — 수정 뒤 재확인이면 메인이 다시 만든다.',
  entries,
}
// 묶음은 산출물이지 소스가 아니다 — 프로젝트 설정을 건드리지 않고 폴더 안 규칙으로 커밋에서 뺀다.
atomicWriteProjectFile(projectRoot, `${PACKET}/.gitignore`, '*\n')
// 이력은 묶음을 새로 만들어도 남는다 — 커밋마다 리뷰한 내용을 나중에 대조한다.
appendReviewHistory(projectRoot, {generatedAt, base: base ?? null, files: reviewedFiles})
atomicWriteProjectFile(projectRoot, `${PACKET}/INDEX.json`, `${JSON.stringify(index, null, 2)}\n`)
const failed = entries.filter(entry => entry.exitCode !== 0).map(entry => `${entry.file}=${entry.exitCode}`)
process.stdout.write(`review packet: ${PACKET}/ (${entries.length} items${failed.length ? `; non-zero: ${failed.join(', ')}` : ''})\n`)
