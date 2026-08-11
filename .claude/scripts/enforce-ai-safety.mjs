#!/usr/bin/env node

import {existsSync, readFileSync} from 'node:fs'
import {relative, resolve, sep} from 'node:path'

const readInput = async () => {
  let source = ''
  for await (const chunk of process.stdin) source += chunk
  return JSON.parse(source)
}

const block = message => {
  process.stderr.write(message + '\n')
  process.exit(2)
}

const normalizePath = (projectRoot, filePath) => {
  const absolutePath = resolve(filePath)
  return relative(projectRoot, absolutePath).split(sep).join('/')
}

try {
  const input = await readInput()
  if (!['Write', 'Edit'].includes(input.tool_name)) process.exit(0)

  const filePath = input.tool_input?.file_path
  if (typeof filePath !== 'string') process.exit(0)

  const projectRoot = resolve(process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd())
  const relativePath = normalizePath(projectRoot, filePath)
  if (relativePath.startsWith('../') || relativePath === '..') process.exit(0)
  if (!/\.(?:[cm]?[jt]sx?|json|ya?ml)$/.test(relativePath)) process.exit(0)

  let proposedSource = ''
  if (input.tool_name === 'Write') {
    proposedSource = typeof input.tool_input?.content === 'string' ? input.tool_input.content : ''
  } else {
    const currentSource = existsSync(resolve(filePath)) ? readFileSync(resolve(filePath), 'utf8') : ''
    const oldSource = input.tool_input?.old_string
    const newSource = input.tool_input?.new_string
    proposedSource =
      typeof oldSource === 'string' &&
      typeof newSource === 'string' &&
      currentSource.includes(oldSource)
        ? currentSource.replace(oldSource, newSource)
        : typeof newSource === 'string'
          ? newSource
          : currentSource
  }

  const browserRuntimePath =
    /^(?:apps\/[^/]+\/)?src\//.test(relativePath) ||
    /^apps\/web\//.test(relativePath)

  const browserSecretPatterns = [
    /\bVITE_(?:OPENAI|ANTHROPIC|GEMINI|GOOGLE)_API_KEY\b/,
    /\bdangerouslyAllowBrowser\s*:\s*true\b/,
  ]
  if (browserRuntimePath && browserSecretPatterns.some(pattern => pattern.test(proposedSource))) {
    block('Blocked: ' + relativePath + ' exposes a model credential or enables a provider SDK in the browser.')
  }

  const directProviderPatterns = [
    /https:\/\/api\.openai\.com\//,
    /https:\/\/api\.anthropic\.com\//,
    /https:\/\/generativelanguage\.googleapis\.com\//,
  ]
  if (browserRuntimePath && directProviderPatterns.some(pattern => pattern.test(proposedSource))) {
    block('Blocked: ' + relativePath + ' calls a model provider directly from browser-owned source.')
  }

  const toolContractChange =
    /^packages\/ai-contracts\/.*\.(?:[cm]?[jt]s|json)$/.test(relativePath) &&
    /\bsideEffect["']?\s*:\s*true\b/.test(proposedSource)

  if (
    toolContractChange &&
    (!/\brequiresApproval["']?\s*:\s*true\b/.test(proposedSource) ||
      !/\bidempotencyRequired["']?\s*:\s*true\b/.test(proposedSource))
  ) {
    block('Blocked: ' + relativePath + ' declares a side-effect tool without approval and idempotency.')
  }
} catch (error) {
  block('Blocked: AI safety hook could not validate the operation: ' + (error instanceof Error ? error.message : String(error)))
}
