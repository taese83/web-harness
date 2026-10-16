#!/usr/bin/env node
// prepare-review-packet.mjs — 읽기 전용 리뷰어에게 넘길 증거 묶음을 메인이 한 번에 만든다.
//
// 리뷰어(code-reviewer·security-reviewer·api-contract-verifier 등)는 Bash가 없다 — 변경과 기계 판정을 스스로
// 실행해 얻지 않고 이 묶음을 Read로 읽는다. 묶음에 없거나 exit가 0이 아닌 항목은 리뷰어가 「확인 불가」로 적는다.
//
// 사용법:
//   node .claude/scripts/prepare-review-packet.mjs --project-root <path> [--base <ref>] [--handoff design|development]
//        [--allow-host-execution]
// 산출: <project>/_workspace/04_qa/review-packet/ — INDEX.json(항목별 명령·exit·sha256)과 항목 파일.
// 코드 리뷰 묶음(handoff 아님)은 typecheck·lint를 이 트리에서 돌려 판정을 `gates/`에만 싣는다 — 따로 남기는 검사 기록은 없다.
// INDEX.scope: 바뀐 줄·파일이 적고 레이어 FAIL·merge가 없으면 `small`(리뷰어는 diff와 바뀐 파일만 본다).
// 종료 코드: 0 = 묶음 작성(항목 실패는 INDEX에 기록), 2 = 사용법 오류·경계 밖.
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {existsSync, lstatSync, readFileSync, realpathSync, rmSync, statSync} from 'node:fs'
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {answerHelp} from './cli-help-lib.mjs'
import {atomicWriteProjectFile} from './safe-project-file-lib.mjs'
import {appendReviewHistory} from './ticket/work-link.mjs'
import {readLocalReviewSettings} from './ticket/local-settings.mjs'
import {computeImpact, parseDiffNames, renderImpact} from './review-impact-lib.mjs'
import {computeMergeFocus, mergeFocusPatch, renderMergeFocus} from './review-merge-lib.mjs'

answerHelp(import.meta.url)

const usage = () => {
  process.stderr.write('Usage: prepare-review-packet.mjs --project-root <path> [--base <ref>] [--handoff design|development] [--allow-host-execution]\n')
  process.exit(2)
}
const rawArgv = process.argv.slice(2)
// 호스트 실행 승인은 품질 실행기로 그대로 넘긴다 — 첫 실행만 사용자 승인 뒤 붙이고 이후엔 기록된 승인을 쓴다.
const allowHostExecution = rawArgv.includes('--allow-host-execution')
const argv = rawArgv.filter(value => value !== '--allow-host-execution')
if (rawArgv.length - argv.length > 1) usage()
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
const OPTIONAL = ['handoff-design.json', 'handoff-development.json', 'merge-focus.txt', 'merge-focus.patch']

const sha256 = content => createHash('sha256').update(content).digest('hex')
// 묶음 디렉터리가 진짜 디렉터리일 때만 지운다 — 링크를 따라 묶음 밖을 지우지 않는다(실행기도 링크면 거부한다).
const packetIsDirectory = () => existsSync(join(projectRoot, PACKET)) && lstatSync(join(projectRoot, PACKET)).isDirectory()
// 지난 목록은 먼저 지운다 — 도중에 끊긴 묶음이 지난 scope·sha를 이번 것처럼 보이지 않게(목록이 없으면 리뷰어는 「확인 불가」).
if (packetIsDirectory()) rmSync(join(projectRoot, PACKET, 'INDEX.json'), {force: true})
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
// merge 범위 — 진행 중인 merge면 리뷰가 볼 파일(충돌·양쪽이 바꾼 파일·결과에서 고친 파일)만 따로 싣는다.
// 들어온 쪽을 그대로 받은 파일까지 보면 리뷰가 들어온 브랜치 전체를 다시 읽다 턴 한도에 걸린다.
let mergeFocus = null
{
  let focus = null
  let failure = null
  try { focus = computeMergeFocus(projectRoot, diffNames === null ? [] : parseDiffNames(diffNames)) } catch (error) { failure = error }
  if (focus || failure) {
    const write = (file, content, exitCode) => {
      const truncated = Buffer.byteLength(content) > MAX_BYTES
      if (truncated) content = Buffer.from(content).subarray(0, MAX_BYTES).toString('utf8')
      atomicWriteProjectFile(projectRoot, `${PACKET}/${file}`, content)
      entries.push({file, command: 'review-merge-lib (MERGE_HEAD 기준)', exitCode, bytes: Buffer.byteLength(content), truncated, sha256: sha256(content)})
    }
    if (failure) {
      write('merge-focus.txt', `merge 범위 계산 실패: ${String(failure?.message ?? failure).slice(0, 200)} — 확인 불가, diff.patch 전체가 범위다.\n`, 2)
    } else {
      write('merge-focus.txt', renderMergeFocus(focus), 0)
      let patch = ''
      let exitCode = 0
      try { patch = mergeFocusPatch(projectRoot, focus.focus) } catch (error) {
        patch = `볼 파일 diff 실패: ${String(error?.message ?? error).slice(0, 200)} — 확인 불가\n`
        exitCode = 2
      }
      write('merge-focus.patch', patch, exitCode)
      mergeFocus = focus
    }
  }
}
// 리뷰한 내용의 지문 — 바뀐 파일마다 작업 트리 내용의 git blob id(지운 파일은 null). `link`가 커밋마다 「그 커밋의 파일 내용이
// 하네스 리뷰가 뒤따른 묶음에 같은 내용으로 있었는가」를 대조한다(커밋 전 리뷰·커밋 여러 개). `_workspace`는 산출물이라 뺀다.
const reviewedFiles = {}
if (diffNames !== null) {
  for (const path of parseDiffNames(diffNames)) {
    if (path.startsWith('_workspace/')) continue
    // merge로 그대로 받은 파일은 이번 리뷰가 보지 않는다 — 리뷰했다고 적지 않는다(커밋별 대조가 리뷰됨으로 읽지 않게).
    if (mergeFocus && Object.hasOwn(mergeFocus.incomingAsIs, path)) continue
    const absolute = join(projectRoot, path)
    if (!existsSync(absolute)) { reviewedFiles[path] = null; continue }
    const blob = spawnSync('git', ['-C', projectRoot, 'hash-object', '--', path], {encoding: 'utf8'})
    if (blob.status === 0) reviewedFiles[path] = blob.stdout.trim()
  }
}
// 검사 판정 — 코드 리뷰 묶음이면 이 트리에서 typecheck·lint를 돌려 `gates/<id>.json`에만 둔다. 이번에 돌릴 판정은 먼저 지운다
// (묶음 밖 기록을 읽어 오래된 판정으로 막히는 일이 없게). 스크립트가 없거나 승인이 없으면 실행기 판정(BLOCKED·exit 2)을 그대로 싣는다.
// 지문(reviewedFiles)을 잡은 뒤에 돈다 — 검사 도중 바뀐 내용을 리뷰했다고 적지 않게. 두 검사 합이 Bash 도구 상한(600초) 안에 든다.
const GATES = handoff ? [] : ['typecheck', 'lint']
for (const check of GATES) {
  if (packetIsDirectory()) rmSync(join(projectRoot, PACKET, 'gates', `${check}.json`), {force: true})
  const args = ['--project', projectRoot, '--check', check, '--review-packet', ...(allowHostExecution ? ['--allow-host-execution'] : [])]
  const result = spawnSync(process.execPath, [join(scripts, 'run-quality-gates.mjs'), ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout: 280_000,
  })
  const file = `gates/${check}.json`
  const path = join(projectRoot, PACKET, file)
  const content = existsSync(path) && lstatSync(path).isFile() ? readFileSync(path, 'utf8') : ''
  entries.push({
    file,
    command: ['node', '.claude/scripts/run-quality-gates.mjs', ...args].map(part => (part === projectRoot ? '{project-root}' : part)).join(' '),
    exitCode: Number.isInteger(result.status) ? result.status : null,
    ...(result.stdout ? {stdout: result.stdout.slice(0, 2000)} : {}),
    ...(result.stderr ? {stderr: result.stderr.slice(0, 2000)} : {}),
    ...(result.error ? {error: result.error.message} : {}),
    bytes: Buffer.byteLength(content),
    truncated: false,
    sha256: sha256(content),
  })
}
// 이번에 만들지 않은 선택 항목은 지운다 — 지난 라운드 파일이 현재 판정처럼 읽히지 않게.
for (const file of OPTIONAL) {
  if (entries.some(entry => entry.file === file)) continue
  const path = join(projectRoot, PACKET, file)
  if (existsSync(path) && lstatSync(path).isFile()) rmSync(path)
}
// 작은 변경 — 리뷰 깊이를 변경 크기에 맞춘다. 바뀐 줄은 diff.patch의 +/- 줄(머리 제외), 파일은 `_workspace` 밖.
const SMALL_MAX_LINES = 40
const SMALL_MAX_FILES = 3
const changedLines = (() => {
  const path = join(projectRoot, PACKET, 'diff.patch')
  if (!existsSync(path)) return null
  return readFileSync(path, 'utf8').split('\n').filter(line => /^[+-]/.test(line) && !/^(\+\+\+|---)( |$)/.test(line)).length
})()
const changedFiles = diffNames === null ? null : parseDiffNames(diffNames).filter(path => !path.startsWith('_workspace/')).length
const layerExit = entries.find(entry => entry.file === 'layer-boundaries.json')?.exitCode
// 조회가 온전할 때만 센다 — 실패·잘림·생략 표식(큰·바이너리 untracked)이 있으면 줄 수가 적게 나오므로 full이다.
const gitComplete = ['diff.patch', 'diff-names.txt'].every(file => {
  const entry = entries.find(item => item.file === file)
  return entry && entry.exitCode === 0 && !entry.truncated
}) && !readFileSync(join(projectRoot, PACKET, 'diff.patch'), 'utf8').includes('content omitted]')
// 승격(CAPABILITY_ESCALATION: detected)인 라운드는 작게 보지 않는다 — 승격 QA 대조를 빼지 않게.
const escalated = (() => {
  const path = join(projectRoot, '_workspace/03_dev/change-scope.md')
  if (!existsSync(path)) return false
  const lines = readFileSync(path, 'utf8').split('\n').filter(line => /^\s*CAPABILITY_ESCALATION\s*:/.test(line))
  return lines.length > 0 && /detected/.test(lines.at(-1))
})()
const small = !handoff && !mergeFocus && !escalated && gitComplete && changedLines !== null && changedFiles !== null &&
  changedLines <= SMALL_MAX_LINES && changedFiles <= SMALL_MAX_FILES && layerExit !== 1
const scope = {
  value: small ? 'small' : 'full',
  changedLines,
  changedFiles,
  rule: `small = 바뀐 줄 ≤ ${SMALL_MAX_LINES} · 파일 ≤ ${SMALL_MAX_FILES} · layer-boundaries FAIL 아님 · 조회 온전 · 승격 아님 · merge·handoff 아님`,
}
const generatedAt = new Date().toISOString()
const index = {
  schemaVersion: 1,
  generatedAt,
  base: base ?? null,
  scope,
  files: reviewedFiles,
  exitMeaning: {
    git: '0 = 조회됨, 그 밖 = 확인 불가',
    'layer-boundaries.json': '0 = PASS, 1 = FAIL(방향 위반), 3 = 미판정(확인 불가 — 통과가 아니다), 2 = 확인 불가',
    'reuse-inventory.txt': '0 = 보고됨, 그 밖 = 확인 불가',
    'impact.txt': '0 = 사용처 목록(근사), 2 = 확인 불가',
    'merge-focus.*': '진행 중인 merge에만 있다. 0 = 볼 파일 목록·그 diff, 2 = 확인 불가(diff.patch 전체가 범위)',
    'handoff-*.json': '0 = HOLE 없음, 1 = HOLES(파일의 JSON을 그대로 옮긴다), 2 = 기계 판정 미수행',
    'gates/*.json': '이 트리에서 돌린 판정(receipt) — 판정은 파일의 status다: PASS · FAIL(위반) · BLOCKED(환경). 파일 없음·exit 2(실행 전 거부)는 BLOCKED',
  },
  note: '묶음은 generatedAt 시점의 트리만 담는다 — 수정 뒤 재확인이면 메인이 다시 만든다.',
  entries,
}
// 묶음은 산출물이지 소스가 아니다 — 프로젝트 설정을 건드리지 않고 폴더 안 규칙으로 커밋에서 뺀다.
atomicWriteProjectFile(projectRoot, `${PACKET}/.gitignore`, '*\n')
// 이력은 묶음을 새로 만들어도 남는다 — 커밋마다 리뷰한 내용을 나중에 대조한다.
// mergeIncoming은 리뷰 기록이 아니다 — 커밋 상기 훅이 merge 커밋에서 「이 merge의 변경이 아님」을 알아보는 데만 쓴다.
appendReviewHistory(projectRoot, {generatedAt, base: base ?? null, files: reviewedFiles, ...(mergeFocus ? {mergeHead: mergeFocus.mergeHead, mergeIncoming: mergeFocus.incomingAsIs} : {})})
atomicWriteProjectFile(projectRoot, `${PACKET}/INDEX.json`, `${JSON.stringify(index, null, 2)}\n`)
const failed = entries.filter(entry => entry.exitCode !== 0).map(entry => `${entry.file}=${entry.exitCode}`)
process.stdout.write(`review packet: ${PACKET}/ (${entries.length} items${failed.length ? `; non-zero: ${failed.join(', ')}` : ''})\n`)
process.stdout.write(`review scope: ${scope.value} (바뀐 줄 ${changedLines ?? '?'} · 파일 ${changedFiles ?? '?'})${small ? ' — web-harness:code-reviewer를 effort medium으로 한 번 띄운다' : ''}\n`)
if (mergeFocus) {
  process.stdout.write(`merge review: 진행 중인 merge다 — 볼 파일 ${mergeFocus.focus.length}개(들어온 쪽 그대로 ${Object.keys(mergeFocus.incomingAsIs).length}개 제외). `
    + `리뷰어에게 ${PACKET}/merge-focus.txt와 merge-focus.patch만 보라고 넘긴다.\n`)
}
// 개발자가 Codex 교차 리뷰를 켠 프로젝트면 같은 범위의 실행 명령을 여기서 알린다 — 어느 레인이든 리뷰 전에 묶음을 만들므로,
// 레인 문서를 읽지 않아도 리뷰를 띄우는 순간에 Codex를 함께 띄운다(team-flow 5·web-verify 5·qa-evidence Iterate). handoff 묶음은 코드 리뷰가 아니라 뺀다.
if (!handoff && readLocalReviewSettings(projectRoot)?.codexReview === true) {
  const codex = fileURLToPath(new URL('./codex-cross-review.mjs', import.meta.url))
  process.stdout.write(`codex cross-review: 이 프로젝트는 Codex 교차 리뷰가 켜져 있다 — 하네스 리뷰어와 병렬로(Bash 백그라운드) 같은 범위를 돌린다: `
    + `node "${codex}" --project-root "${projectRoot}" --base ${base ?? 'HEAD'} → _workspace/04_qa/codex-review.md(다른 모델의 의견 — 하네스 리뷰 지적과 대조해 선별한다)\n`)
}
