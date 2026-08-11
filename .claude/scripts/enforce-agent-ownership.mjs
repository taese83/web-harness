#!/usr/bin/env node

import {existsSync, realpathSync} from 'node:fs'
import {dirname, isAbsolute, relative, resolve, sep} from 'node:path'
import {AGENT_OWNERSHIP} from './agent-registry.mjs'

const readInput = async () => {
  let source = ''
  for await (const chunk of process.stdin) source += chunk
  return JSON.parse(source)
}

const nearestExistingPath = targetPath => {
  let currentPath = targetPath
  while (!existsSync(currentPath)) {
    const parentPath = dirname(currentPath)
    if (parentPath === currentPath) return currentPath
    currentPath = parentPath
  }
  return currentPath
}

const block = message => {
  process.stderr.write(`${message}\n`)
  process.exit(2)
}

try {
  const input = await readInput()
  if (!['Edit', 'Write'].includes(input.tool_name) || !input.agent_type) process.exit(0)

  const filePath = input.tool_input?.file_path
  if (typeof filePath !== 'string' || !isAbsolute(filePath)) block('Blocked: Write/Edit requires an absolute file_path.')

  const projectRoot = realpathSync(process.env.CLAUDE_PROJECT_DIR ?? input.cwd)
  const requestedPath = resolve(filePath)
  const existingPath = nearestExistingPath(requestedPath)
  const realExistingPath = realpathSync(existingPath)
  const realRelativePath = relative(projectRoot, realExistingPath)
  const outsideThroughSymlink = realRelativePath === '..' || realRelativePath.startsWith(`..${sep}`)
  if (outsideThroughSymlink) block(`Blocked: ${input.agent_type} cannot write outside the project root.`)

  const relativePath = relative(projectRoot, requestedPath).split(sep).join('/')
  if (relativePath.startsWith('../') || relativePath === '..') block(`Blocked: ${input.agent_type} cannot write outside the project root.`)

  // 프로젝트 root가 workspace/<project>/로 중첩된 경우 ownership은 프로젝트 root 기준으로 판정한다
  const ownershipPath = relativePath.replace(/^workspace\/[^/]+\//, '')

  // 플러그인 설치 시 agent_type은 `web-harness:<agent>`로 네임스페이스가 붙는다 — ownership
  // 등록부는 bare 이름 기준이므로 자기 플러그인 접두만 벗겨 판정한다. 임의 접두를 벗기면
  // 이름이 겹치는 서드파티 플러그인 에이전트가 ownership을 상속받으므로 반드시 고정한다.
  const agentType = String(input.agent_type).replace(/^web-harness:/, '')
  const allowedPatterns = AGENT_OWNERSHIP[agentType]
  if (!allowedPatterns) block(`Blocked: no write ownership is defined for ${input.agent_type}.`)
  const ownJournalPath = `_workspace/03_dev/change-journal/${agentType}.md`
  if (ownershipPath === ownJournalPath) process.exit(0)
  if (!allowedPatterns.some(pattern => pattern.test(ownershipPath))) {
    block(`Blocked: ${input.agent_type} does not own ${ownershipPath}. Route the change to the owning agent.`)
  }
} catch (error) {
  block(`Blocked: ownership hook could not validate the operation: ${error instanceof Error ? error.message : String(error)}`)
}
