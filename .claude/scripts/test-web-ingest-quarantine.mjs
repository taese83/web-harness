#!/usr/bin/env node
// test-web-ingest-quarantine.mjs — 웹 인입 격리 배선 회귀.
//
// 왜 이 테스트가 있나: 원래 결손이 "계약은 있는데 아무도 참조하지 않는다"였다. 그 결손을 잡는
// 검사가 다시 조용해지면(정규식 오타·프론트매터 키 변경·목록 하드코딩 회귀) 같은 자리로 돌아온다.
// 여기서 고정하는 사실:
//   (1) 웹 도구를 들었는데 계약 참조가 없으면 잡는다 — 검사가 무장돼 있다(음성 통제)
//   (2) 참조가 있으면 통과하고, 웹 도구가 없는 에이전트는 대상이 아니다(오탐 경계)
//   (3) 실제 트리의 웹 인입 에이전트가 0건이 아니다 — 대상 0이면 검사는 vacuous하게 통과한다
//   (4) 실제 트리에 미참조 에이전트가 없다(현행 상태 고정)
import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync, readdirSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {
  QUARANTINE_CONTRACT_FILE,
  findUnquarantinedWebAgents,
} from './validators/validate-agent-boundaries.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..', '..')
const agentDirectory = join(repositoryRoot, '.claude', 'agents')

const readRealAgents = () =>
  readdirSync(agentDirectory)
    .filter(fileName => fileName.endsWith('.md'))
    .map(fileName => {
      const source = readFileSync(join(agentDirectory, fileName), 'utf8')
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1] ?? ''
      const tools = /^tools:\s*(.+)$/m.exec(frontmatter)?.[1] ?? ''
      return {name: fileName.replace(/\.md$/, ''), tools, body: source}
    })

test('음성 통제: 웹 도구를 들었는데 계약 참조가 없으면 잡는다', () => {
  const flagged = findUnquarantinedWebAgents([
    {name: 'fetcher', tools: 'Read, Glob, WebFetch', body: '# Fetcher\n외부 문서를 읽는다.\n'},
    {name: 'searcher', tools: 'Read, WebSearch', body: '# Searcher\n검색한다.\n'},
  ])
  assert.deepEqual(flagged, ['fetcher', 'searcher'])
})

test('참조가 있으면 통과하고, 웹 도구가 없으면 대상이 아니다', () => {
  const flagged = findUnquarantinedWebAgents([
    {
      name: 'quarantined',
      tools: 'Read, Write, WebSearch, WebFetch',
      body: `본문에서 \`.claude/skills/web-orchestrator/references/${QUARANTINE_CONTRACT_FILE}\`를 따른다.`,
    },
    {name: 'offline-writer', tools: 'Read, Glob, Grep, Write, Edit', body: '# Writer\n계약 언급 없음.\n'},
    {name: 'verifier', tools: 'Read, Glob, Grep, Bash', body: '# Verifier\n읽기 전용.\n'},
  ])
  assert.deepEqual(flagged, [])
})

test('부분 일치로 새지 않는다 — 이름이 비슷한 도구는 웹 인입이 아니다', () => {
  const flagged = findUnquarantinedWebAgents([
    {name: 'not-web', tools: 'Read, NotebookEdit, WebViewer', body: '계약 언급 없음.\n'},
  ])
  assert.deepEqual(flagged, [], 'WebSearch/WebFetch 정확 매칭만 대상이다')
  const caught = findUnquarantinedWebAgents([
    {name: 'web', tools: 'Read, WebFetch, NotebookEdit', body: '계약 언급 없음.\n'},
  ])
  assert.deepEqual(caught, ['web'])
})

test('실제 트리: 웹 인입 에이전트가 존재하고(대상 0 아님), 전부 계약을 참조한다', () => {
  const agents = readRealAgents()
  const webAgents = agents.filter(agent => /\b(?:WebSearch|WebFetch)\b/.test(agent.tools))
  assert.ok(
    webAgents.length > 0,
    '웹 인입 에이전트가 0이면 이 검사는 vacuous하다 — 0이 된 것이 의도라면 이 회귀를 함께 고친다',
  )
  assert.deepEqual(
    findUnquarantinedWebAgents(agents),
    [],
    '웹 도구를 든 에이전트는 격리 계약을 계약 본문에서 참조해야 한다',
  )
})
