#!/usr/bin/env node
// .claude(canonical) → adapter 사본 재생성.
//   1. .agents/            — skills/adapters/evals/ai-harness.json verbatim 미러
//   2. .codex/agents/*.toml — agent 정의의 Codex 런타임 형식 (frontmatter + 본문 verbatim)
//
// 배경: adapter 사본을 손으로 관리하면 canonical과 drift한다 (실제로 .agents가 23/29 스킬,
// 구버전 내용, 해석 불가 경로 참조 상태로 방치됐었고, .codex/agents는 88개 중 78개만 있는
// 상태에서 `.Codex/` 오염 경로까지 포함하고 있었다). 이 스크립트가 유일한 갱신 수단이며,
// validate-harness가 --check로 drift를 회귀 차단한다.
//
// 미러 범위: 스킬 문서의 상대 참조(../../)가 닿는 경계까지.
//   skills/ + adapters/ + evals/ + ai-harness.json
// 변환 없음(verbatim) — canonical의 .claude/... 저장소 경로 참조는 어느 도구에서 읽어도
// repo 루트 기준으로 해석 가능하므로 치환하지 않는다 (.codex/hooks.json도 .claude/ 경로를
// 그대로 참조한다).
//
// 사용법:
//   node .claude/scripts/build-adapters.mjs           # .agents + .codex/agents 재생성
//   node .claude/scripts/build-adapters.mjs --check   # drift 검사만 (0 = 일치, 1 = drift)

import {cpSync, rmSync, mkdirSync, existsSync, readdirSync, statSync, readFileSync, writeFileSync} from 'node:fs'
import {dirname, join, resolve, relative} from 'node:path'
import {fileURLToPath} from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const claudeDirectory = resolve(scriptDirectory, '..')
const repositoryRoot = resolve(claudeDirectory, '..')
const agentsDirectory = join(repositoryRoot, '.agents')
const codexAgentsDirectory = join(repositoryRoot, '.codex', 'agents')

const MIRROR_SET = ['skills', 'adapters', 'evals', 'ai-harness.json']

const listFiles = (root, out = [], base = root) => {
  if (!existsSync(root)) return out
  if (statSync(root).isDirectory()) {
    for (const name of readdirSync(root)) listFiles(join(root, name), out, base)
  } else {
    out.push(relative(base, root))
  }
  return out
}

// canonical agent .md → Codex .toml 변환. 본문은 verbatim이며 TOML literal multi-line
// string(''')을 사용해 이스케이프 처리를 배제한다. 본문에 '''가 등장하면 조용히 깨진
// 사본을 만들지 않고 생성을 실패시킨다.
const renderCodexAgentToml = relativeName => {
  const source = readFileSync(join(claudeDirectory, 'agents', relativeName), 'utf8')
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) throw new Error(`${relativeName}: YAML frontmatter is missing`)
  const frontmatter = Object.fromEntries(
    match[1]
      .split(/\r?\n/)
      .map(line => line.match(/^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.replace(/^['"]|['"]$/g, '')]),
  )
  if (!frontmatter.name || !frontmatter.description) {
    throw new Error(`${relativeName}: frontmatter name and description are required`)
  }
  const body = match[2].replace(/^\r?\n+/, '').replace(/\s+$/, '')
  if (body.includes("'''")) throw new Error(`${relativeName}: body contains ''' and cannot be a TOML literal string`)
  const escapeBasicString = value => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return [
    `name = "${escapeBasicString(frontmatter.name)}"`,
    `description = "${escapeBasicString(frontmatter.description)}"`,
    `developer_instructions = '''`,
    body,
    `'''`,
    '',
  ].join('\n')
}

const listCanonicalAgentFiles = () =>
  readdirSync(join(claudeDirectory, 'agents')).filter(name => name.endsWith('.md')).sort()

export const checkCodexAgentsDrift = () => {
  const problems = []
  const canonicalNames = listCanonicalAgentFiles()
  const expectedTomls = new Set(canonicalNames.map(name => name.replace(/\.md$/, '.toml')))
  for (const name of canonicalNames) {
    const tomlName = name.replace(/\.md$/, '.toml')
    const tomlPath = join(codexAgentsDirectory, tomlName)
    const label = join('.codex/agents', tomlName)
    if (!existsSync(tomlPath)) {
      problems.push(`missing in adapter: ${label}`)
      continue
    }
    if (readFileSync(tomlPath, 'utf8') !== renderCodexAgentToml(name)) problems.push(`content drift: ${label}`)
  }
  if (existsSync(codexAgentsDirectory)) {
    for (const name of readdirSync(codexAgentsDirectory)) {
      if (!expectedTomls.has(name)) problems.push(`extra in adapter (canonical에 없음): ${join('.codex/agents', name)}`)
    }
  }
  return problems
}

const buildCodexAgents = () => {
  rmSync(codexAgentsDirectory, {recursive: true, force: true})
  mkdirSync(codexAgentsDirectory, {recursive: true})
  const canonicalNames = listCanonicalAgentFiles()
  for (const name of canonicalNames) {
    writeFileSync(join(codexAgentsDirectory, name.replace(/\.md$/, '.toml')), renderCodexAgentToml(name))
  }
  return canonicalNames.length
}

export const checkAdapterDrift = () => {
  const problems = []
  for (const entry of MIRROR_SET) {
    const source = join(claudeDirectory, entry)
    const target = join(agentsDirectory, entry)
    const sourceFiles = new Set(listFiles(source))
    const targetFiles = new Set(listFiles(target))
    for (const file of sourceFiles) {
      const label = join('.agents', entry, file)
      if (!targetFiles.has(file)) {
        problems.push(`missing in adapter: ${label}`)
        continue
      }
      const a = readFileSync(join(source, file))
      const b = readFileSync(join(target, file))
      if (!a.equals(b)) problems.push(`content drift: ${label}`)
    }
    for (const file of targetFiles) {
      if (!sourceFiles.has(file)) problems.push(`extra in adapter (canonical에 없음): ${join('.agents', entry, file)}`)
    }
  }
  problems.push(...checkCodexAgentsDrift())
  return problems
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  if (process.argv.includes('--check')) {
    const problems = checkAdapterDrift()
    if (problems.length) {
      console.error(`adapter drift ${problems.length}건 — node .claude/scripts/build-adapters.mjs 로 재생성할 것:`)
      for (const problem of problems) console.error(`- ${problem}`)
      process.exit(1)
    }
    console.log('adapter 사본이 canonical과 일치한다.')
  } else {
    for (const entry of MIRROR_SET) {
      const source = join(claudeDirectory, entry)
      const target = join(agentsDirectory, entry)
      if (!existsSync(source)) continue
      rmSync(target, {recursive: true, force: true})
      mkdirSync(dirname(target), {recursive: true})
      cpSync(source, target, {recursive: true})
    }
    const codexAgentCount = buildCodexAgents()
    console.log(`.agents 재생성 완료 (${MIRROR_SET.join(', ')}) + .codex/agents ${codexAgentCount}개 재생성 완료`)
  }
}
