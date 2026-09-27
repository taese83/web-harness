#!/usr/bin/env node
// plan-lookup.mjs — 기획·설계 산출물에서 ID(TC·SD·FEAT·REQ·PC 등)가 적힌 행만 꺼낸다(문서를 통째로 읽지 않는다).
// 사용법: node .claude/scripts/plan-lookup.mjs --project <root> --id <ID>[,<ID>...] [--context <0-20>]
//   찾는 곳: _workspace/01_plan·02_design 아래 .md(샤드 디렉터리 포함). ID는 토큰 단위로 맞춘다(TC-002-1은 TC-002-10과 다르다).
//   제목 행(#)에 걸리면 --context 줄만큼 뒤 행을 함께 낸다. 출력은 `경로:줄: 원문`이고 ID당 50행까지다.
// 종료 코드: 0 = 모든 ID를 찾음, 1 = 못 찾은 ID가 있음(목록 출력), 2 = 사용법 오류.
import {existsSync, lstatSync, readdirSync, readFileSync, realpathSync} from 'node:fs'
import {join, relative, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {answerHelp} from './cli-help-lib.mjs'

answerHelp(import.meta.url)

const ID_PATTERN = /^[A-Z][A-Z0-9_]*(?:-[A-Z0-9]+)+$/
const ROOTS = ['_workspace/01_plan', '_workspace/02_design']
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_ROWS_PER_ID = 50
const MAX_LINE_CHARS = 400

const usage = message => {
  process.stderr.write(`${message}\n사용법: node .claude/scripts/plan-lookup.mjs --project <root> --id <ID>[,<ID>...] [--context <0-20>]\n`)
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
export const lookup = (projectRoot, ids, {context = 0} = {}) => {
  const files = markdownFiles(projectRoot).map(path => ({path, lines: readFileSync(path, 'utf8').split(/\r?\n/)}))
  return ids.map(id => {
    const token = new RegExp(`(?<![A-Za-z0-9_-])${escape(id)}(?![A-Za-z0-9_-])`)
    const rows = []
    for (const {path, lines} of files) {
      for (let index = 0; index < lines.length && rows.length < MAX_ROWS_PER_ID; index += 1) {
        if (!token.test(lines[index])) continue
        const span = lines[index].startsWith('#') ? context : 0
        for (let offset = 0; offset <= span && index + offset < lines.length; offset += 1) {
          const text = lines[index + offset]
          rows.push(`${relative(projectRoot, path).split(sep).join('/')}:${index + offset + 1}: ${text.length > MAX_LINE_CHARS ? `${text.slice(0, MAX_LINE_CHARS)}…` : text}`)
        }
      }
    }
    return {id, rows}
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
  if (!project || !idList) usage('--project와 --id가 필요하다')
  if (!Number.isInteger(context) || context < 0 || context > 20) usage('--context는 0-20 정수다')
  const ids = idList.split(',').map(id => id.trim()).filter(Boolean)
  const invalid = ids.filter(id => !ID_PATTERN.test(id))
  if (ids.length === 0 || invalid.length > 0) usage(`ID 형식이 아니다: ${invalid.join(', ') || '(없음)'}`)
  const results = lookup(resolve(project), ids, {context})
  for (const {id, rows} of results) {
    process.stdout.write(`## ${id}\n${rows.length ? rows.join('\n') : '(없음)'}\n`)
  }
  const missing = results.filter(result => result.rows.length === 0).map(result => result.id)
  if (missing.length) {
    process.stderr.write(`찾지 못한 ID: ${missing.join(', ')} — 반환이 준 ID인지 확인하고, 그래도 없으면 해당 문서의 그 절만 읽는다.\n`)
    process.exit(1)
  }
}
