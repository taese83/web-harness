#!/usr/bin/env node
// validate-falsification.mjs — 게이트가 실제로 발화하는지 기계로 확인한다.
//
// 실측(2026-08-26, 2회): 검증 호출을 지워도 CI가 exit 0이었다. 테스트가 lib을 직접 부르고
// **배선 지점을 지나가지 않아서**다. 게이트를 만들어도 호출부가 끊기면 아무도 모른다 —
// 이 repo가 하루 종일 남의 코드에서 잡아낸 실패 클래스를 자기 테스트가 앓고 있었다.
//
// 방식: 등록부의 각 항목마다 게이트를 무력화하는 **최소 변형**을 적용하고 짝지어진 테스트를
// 돌린다. 실패해야 정상이다. 통과하면 그 게이트는 **반증되지 않는 게이트**이며 언제든 조용히
// 끊길 수 있다.
//
// 이것은 오늘까지 손으로 하던 반증을 기계화한 것이다. 손으로 하면 잊는다.
import {execFileSync} from 'node:child_process'
import {readFileSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = join(scriptDir, '..', '..')
const REGISTRY = join(scriptDir, 'validators/falsification-registry.json')

export const readRegistry = () => JSON.parse(readFileSync(REGISTRY, 'utf8'))

const runTest = testPath => {
  try {
    execFileSync('node', ['--test', testPath], {cwd: repositoryRoot, stdio: 'pipe', env: {...process.env, CI: 'true'}})
    return 0
  } catch (error) {
    return error.status ?? 1
  }
}

// 한 항목을 반증한다. 원본은 반드시 복원한다 — 실패 경로에서도.
export const falsifyOne = entry => {
  const absolute = join(repositoryRoot, entry.file)
  const original = readFileSync(absolute, 'utf8')
  if (!original.includes(entry.find)) {
    return {id: entry.id, status: 'STALE', reason: `변형 지점을 찾지 못했다: ${entry.find.trim().slice(0, 60)}`}
  }
  if (original.split(entry.find).length - 1 !== 1) {
    return {id: entry.id, status: 'STALE', reason: '변형 지점이 유일하지 않다 — 어느 것을 끄는지 모호하다'}
  }
  try {
    writeFileSync(absolute, original.replace(entry.find, entry.replace))
    const exitCode = runTest(entry.test)
    return exitCode === 0
      ? {id: entry.id, status: 'NOT_FALSIFIED', reason: `게이트를 껐는데 ${entry.test}가 통과했다 — 이 게이트는 회귀에 결박되지 않았다`}
      : {id: entry.id, status: 'OK', reason: ''}
  } finally {
    writeFileSync(absolute, original)
  }
}

export const validateFalsification = ({pass, fail}) => {
  const registry = readRegistry()
  if (!Array.isArray(registry.entries) || registry.entries.length === 0) {
    fail('falsification: 등록부가 비어 있다 — 반증 0건을 통과로 만들지 않는다')
    return
  }
  let ok = 0
  for (const entry of registry.entries) {
    const result = falsifyOne(entry)
    if (result.status === 'OK') { ok++; continue }
    fail(`falsification [${result.id}]: ${result.reason}`)
  }
  if (ok === registry.entries.length) pass(`falsification: ${ok}건 전부 반증됨 — 게이트가 실제로 발화한다`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let failed = 0
  validateFalsification({
    pass: message => process.stdout.write(`✅ ${message}\n`),
    fail: message => { failed++; process.stdout.write(`❌ ${message}\n`) },
  })
  process.exit(failed === 0 ? 0 : 1)
}
