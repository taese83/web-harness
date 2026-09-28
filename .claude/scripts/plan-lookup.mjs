#!/usr/bin/env node
// plan-lookup.mjs — 기획·설계 산출물에서 ID(TC·SD·FEAT·REQ·PC 등)가 적힌 행만 꺼낸다(문서를 통째로 읽지 않는다).
// 사용법: node .claude/scripts/plan-lookup.mjs --project <root> --id <ID>[,<ID>...] [--context <0-20>] [--all]
//   찾는 곳: _workspace/01_plan·02_design 아래 .md(샤드 디렉터리 포함). ID는 토큰 단위로 맞춘다(TC-002-1은 TC-002-10과 다르다).
//   기본은 ID를 **정의한 행**만 낸다 — 그 ID로 시작하는 표 행(`| ID |`)·목록 항목(`- [ ] ID …`)이나 그 ID를 담은 제목.
//   정의 행이 없으면 첫 언급 한 행.
//   --all이면 모든 언급(ID당 20행). 제목 행은 --context 줄만큼 뒤 행을 함께 낸다. 출력은 `경로:줄: 원문`, 전체 16KB까지.
// 종료 코드: 0 = 모든 ID를 찾음, 1 = 못 찾은 ID가 있음(목록 출력), 2 = 사용법 오류.
import {existsSync, lstatSync, readdirSync, readFileSync, realpathSync} from 'node:fs'
import {join, relative, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {answerHelp} from './cli-help-lib.mjs'

answerHelp(import.meta.url)

const ID_PATTERN = /^[A-Z][A-Z0-9_]*(?:-[A-Z0-9]+)+$/
const ROOTS = ['_workspace/01_plan', '_workspace/02_design']
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_ROWS_PER_ID = 20
const MAX_LINE_CHARS = 300
const MAX_OUTPUT_BYTES = 16 * 1024

const usage = message => {
  process.stderr.write(`${message}\n사용법: node .claude/scripts/plan-lookup.mjs --project <root> --id <ID>[,<ID>...] [--context <0-20>] [--all]\n`)
  process.exit(2)
}

export const markdownFiles = projectRoot => {
  const files = []
  const walk = directory => {
    for (const entry of readdirSync(directory, {withFileTypes: true}).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && entry.name.endsWith('.md') && lstatSync(path).size <= MAX_FILE_BYTES) files.push(path)
    }
  }
  for (const root of ROOTS) {
    const directory = join(projectRoot, root)
    if (existsSync(directory) && lstatSync(directory).isDirectory()) walk(directory)
  }
  return files
}

const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export const lookup = (projectRoot, ids, {context = 0, all = false} = {}) => {
  const files = markdownFiles(projectRoot).map(path => ({path, lines: readFileSync(path, 'utf8').split(/\r?\n/)}))
  return ids.map(id => {
    const token = new RegExp(`(?<![A-Za-z0-9_-])${escape(id)}(?![A-Za-z0-9_-])`)
    const defines = new RegExp(`^\\|\\s*\\**${escape(id)}\\**\\s*\\||^\\s*[-*]\\s*(?:\\[[ xX]\\]\\s*)?\\**${escape(id)}\\**(?![A-Za-z0-9_-])|^#{1,6}\\s.*(?<![A-Za-z0-9_-])${escape(id)}(?![A-Za-z0-9_-])`)
    const matches = []
    for (const {path, lines} of files) {
      lines.forEach((line, index) => { if (token.test(line)) matches.push({path, lines, index, definition: defines.test(line)}) })
    }
    const definitions = matches.filter(match => match.definition)
    const chosen = all ? matches.slice(0, MAX_ROWS_PER_ID) : (definitions.length ? definitions : matches.slice(0, 1))
    const rows = []
    for (const {path, lines, index} of chosen) {
      const span = lines[index].startsWith('#') ? context : 0
      for (let offset = 0; offset <= span && index + offset < lines.length; offset += 1) {
        const text = lines[index + offset]
        rows.push(`${relative(projectRoot, path).split(sep).join('/')}:${index + offset + 1}: ${text.length > MAX_LINE_CHARS ? `${text.slice(0, MAX_LINE_CHARS)}…` : text}`)
      }
    }
    return {id, rows, mentions: matches.length}
  })
}

const invokedDirectly = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false } }
if (process.argv[1] !== undefined && invokedDirectly()) {
  const args = process.argv.slice(2)
  const value = option => {
    const index = args.indexOf(option)
    return index === -1 ? undefined : args[index + 1]
  }
  const project = value('--project')
  const idList = value('--id')
  const context = Number(value('--context') ?? 0)
  const all = args.includes('--all')
  if (!project || !idList) usage('--project와 --id가 필요하다')
  if (!Number.isInteger(context) || context < 0 || context > 20) usage('--context는 0-20 정수다')
  const ids = idList.split(',').map(id => id.trim()).filter(Boolean)
  const invalid = ids.filter(id => !ID_PATTERN.test(id))
  if (ids.length === 0 || invalid.length > 0) usage(`ID 형식이 아니다: ${invalid.join(', ') || '(없음)'}`)
  const results = lookup(resolve(project), ids, {context, all})
  let written = 0
  for (const {id, rows, mentions} of results) {
    const extra = !all && mentions > rows.length ? ` (언급 ${mentions}곳 — 전부 보려면 --all)`
      : all && mentions > MAX_ROWS_PER_ID ? ` (언급 ${mentions}곳 중 ${MAX_ROWS_PER_ID}곳만)` : ''
    const block = `## ${id}${extra}\n${rows.length ? rows.join('\n') : '(없음)'}\n`
    if (written + Buffer.byteLength(block) > MAX_OUTPUT_BYTES) {
      process.stdout.write(`… 출력 상한 ${MAX_OUTPUT_BYTES}B — 남은 ID는 나눠서 조회한다\n`)
      process.stderr.write(`출력 상한에 걸려 일부 ID를 싣지 못했다 — 나눠서 조회한다.\n`)
      break
    }
    process.stdout.write(block)
    written += Buffer.byteLength(block)
  }
  const missing = results.filter(result => result.rows.length === 0).map(result => result.id)
  if (missing.length) {
    process.stderr.write(`찾지 못한 ID: ${missing.join(', ')} — 반환이 준 ID인지 확인하고, 그래도 없으면 해당 문서의 그 절만 읽는다.\n`)
    process.exit(1)
  }
}
