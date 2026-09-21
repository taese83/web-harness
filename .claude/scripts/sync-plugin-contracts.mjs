#!/usr/bin/env node
// sync-plugin-contracts.mjs — 플러그인 계약 문서를 프로젝트 안 `_workspace/.contracts/`로 옮긴다.
//
// 서브에이전트는 플러그인 캐시 경로를 모르므로, 배포본의 문서 참조는 이 사본을 가리킨다(build-plugin).
// 플러그인 밖(소스 checkout·deploy 사본)에서는 참조가 `.claude/...` 그대로라 아무것도 하지 않는다.
// 사본은 payload와 사본 양쪽 digest가 같을 때만 건드리지 않는다 — 사본을 손으로 고쳐도 다음 동기화가 되돌린다.
// 다르면 통째로 바꾼다 — 낡은 판본의 파일이 남지 않는다.
// 사본 폴더는 자기 `.gitignore`를 가진다(다른 저장소의 문서 사본이라 커밋하지 않는다).
import {createHash} from 'node:crypto'
import {cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync} from 'node:fs'
import {join, relative, resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {DEFAULT_PAYLOAD_ROOT, harnessVersion} from './harness-version.mjs'

export const CONTRACT_ROOTS = ['skills', 'agents', 'adapters', 'schemas']
export const CONTRACTS_DIR = '_workspace/.contracts'
const STAMP = '.source.json'

const listFiles = (root, current = root) => readdirSync(current, {withFileTypes: true})
  .sort((left, right) => left.name.localeCompare(right.name))
  .flatMap(entry => {
    const path = join(current, entry.name)
    if (entry.isSymbolicLink()) return []
    return entry.isDirectory() ? listFiles(root, path) : [relative(root, path)]
  })

export const payloadDigest = payloadRoot => {
  const hash = createHash('sha256')
  for (const name of CONTRACT_ROOTS) {
    const root = join(payloadRoot, name)
    if (!existsSync(root)) continue
    for (const file of listFiles(root)) {
      hash.update(`${name}/${file}\0`)
      hash.update(readFileSync(join(root, file)))
      hash.update('\0')
    }
  }
  return hash.digest('hex')
}

const readStamp = path => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

export const syncContracts = ({projectRoot, payloadRoot = DEFAULT_PAYLOAD_ROOT}) => {
  const project = realpathSync(resolve(projectRoot))
  const payload = realpathSync(resolve(payloadRoot))
  const version = harnessVersion(payload)
  if (version === null || project === payload) return {state: 'not-plugin'}
  const target = join(project, CONTRACTS_DIR)
  const digest = payloadDigest(payload)
  const current = () => readStamp(join(target, STAMP))?.digest === digest && payloadDigest(target) === digest
  if (current()) return {state: 'unchanged', version, path: CONTRACTS_DIR}

  const suffix = `${process.pid}-${Date.now()}`
  const staging = `${target}.tmp-${suffix}`
  const retired = `${target}.old-${suffix}`
  try {
    mkdirSync(staging, {recursive: true})
    // 자기 .gitignore가 먼저다 — 복사 중에 죽어도 남은 폴더가 커밋 대상으로 보이지 않는다.
    writeFileSync(join(staging, '.gitignore'), '*\n')
    for (const name of CONTRACT_ROOTS) {
      const source = join(payload, name)
      if (existsSync(source)) cpSync(source, join(staging, name), {recursive: true, verbatimSymlinks: true})
    }
    writeFileSync(join(staging, STAMP), `${JSON.stringify({harnessVersion: version, digest}, null, 2)}\n`)
    if (existsSync(target)) renameSync(target, retired)
    try {
      renameSync(staging, target)
    } catch (error) {
      // 동시에 돈 다른 세션이 먼저 같은 판본을 놓았으면 그것으로 됐다. 아니면 옛 사본이라도 되돌려 둔다.
      if (!existsSync(target) && existsSync(retired)) renameSync(retired, target)
      if (current()) return {state: 'unchanged', version, path: CONTRACTS_DIR}
      throw error
    }
    return {state: 'synced', version, path: CONTRACTS_DIR}
  } finally {
    rmSync(staging, {recursive: true, force: true})
    rmSync(retired, {recursive: true, force: true})
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  const index = argv.indexOf('--project-root')
  const projectRoot = index >= 0 ? argv[index + 1] : undefined
  if (!projectRoot) {
    process.stderr.write('사용법: sync-plugin-contracts --project-root <path>\n')
    process.exit(2)
  }
  try {
    process.stdout.write(`${JSON.stringify(syncContracts({projectRoot}))}\n`)
  } catch (error) {
    process.stderr.write(`계약 사본을 만들지 못했다: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
