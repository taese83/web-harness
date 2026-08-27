#!/usr/bin/env node
// test-adapter-derivation.mjs — 어댑터 선언 ↔ 형태 도출 등가 게이트의 회귀.
//
// 여기서 고정하는 사실:
//   (1) 실제 repo에서 shape-covered 프로필 2종은 등가다 — 어긋나면 어댑터 삭제가 불가능하다
//   (2) 검사 id가 빠지면 잡는다 (도출로 전환할 때 검사가 조용히 사라지는 것을 막는다)
//   (3) receiptKind가 어긋나면 잡는다 — build가 runtime이 되면 clean-build 단언이 죽는다
//   (4) 명령 대조가 공회전하면(해석 0건) 통과가 아니라 FAIL이다 — 공허한 PASS 금지
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {inspectAdapterDerivation} from './validators/validate-adapter-derivation.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('실제 repo: 내장 프로필 3종이 도출과 등가다 (노드와 간선)', async () => {
  const {errors, unverified} = await inspectAdapterDerivation({repositoryRoot})
  assert.deepEqual(errors, [], `등가가 깨졌다:\n${errors.join('\n')}`)
  // 미판정은 통과가 아니다 — 있다면 이름으로 남아야 한다(조용한 스킵 금지).
  for (const note of unverified) assert.match(note, /미판정/)
})

// 변형 트리를 만들어 게이트가 실제로 발화하는지 본다. adapter-lib은 repo 고정 경로에서
// 어댑터를 읽으므로, 변형은 shape-checks.json 쪽(도출 입력)에 가한다.
const withMutatedCatalog = async (mutate, run) => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-derivation-'))
  const catalogPath = join(repositoryRoot, '.claude', 'shape-checks.json')
  const original = readFileSync(catalogPath, 'utf8')
  try {
    const catalog = JSON.parse(original)
    mutate(catalog)
    writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n')
    await run()
  } finally {
    writeFileSync(catalogPath, original)
    rmSync(root, {recursive: true, force: true})
  }
}

test('검사가 도출에서 빠지면 FAIL한다', async () => {
  await withMutatedCatalog(
    catalog => {
      catalog.shapes['web-app'].checks = catalog.shapes['web-app'].checks.filter(check => check.id !== 'vite.browser')
    },
    async () => {
      const {errors} = await inspectAdapterDerivation({repositoryRoot})
      assert.ok(
        errors.some(message => message.includes('vite.browser')),
        `검사 누락을 잡지 못했다: ${errors.join(' / ')}`,
      )
    },
  )
})

test('receiptKind가 어긋나면 FAIL한다', async () => {
  await withMutatedCatalog(
    catalog => {
      for (const check of catalog.shapes['web-app'].checks) if (check.id === 'vite.build') check.receiptKind = 'runtime'
    },
    async () => {
      const {errors} = await inspectAdapterDerivation({repositoryRoot})
      assert.ok(
        errors.some(message => message.includes('receiptKind')),
        `receiptKind 불일치를 잡지 못했다: ${errors.join(' / ')}`,
      )
    },
  )
})

test('명령 대조가 공회전하면 통과가 아니라 FAIL이다', async () => {
  // golden에 없는 검사만 남기면 resolve가 0건이 된다 — 종전 구현은 이 경우 조용히 통과했다.
  await withMutatedCatalog(
    catalog => {
      catalog.common.checks = []
      for (const shape of Object.values(catalog.shapes)) shape.checks = []
    },
    async () => {
      const {errors} = await inspectAdapterDerivation({repositoryRoot})
      assert.ok(
        errors.some(message => message.includes('공회전')),
        `공허한 통과를 막지 못했다: ${errors.join(' / ')}`,
      )
    },
  )
})

test('릴리스 간선이 어긋나면 FAIL한다 — 노드가 같아도 게이트는 다르다', async () => {
  await withMutatedCatalog(
    catalog => {
      // typecheck가 릴리스를 직접 게이트하게 만들면 release 노드의 requires가 달라진다.
      for (const check of catalog.common.checks) if (check.id === 'quality.typecheck') delete check.gatesRelease
    },
    async () => {
      const {errors} = await inspectAdapterDerivation({repositoryRoot})
      assert.ok(
        errors.some(message => message.includes('requires 불일치')),
        `간선 불일치를 잡지 못했다: ${errors.join(' / ')}`,
      )
    },
  )
})

test('게이트가 validate-harness 배선을 실제로 지나간다', () => {
  // lib을 직접 부르는 테스트만 있으면 배선을 지워도 CI가 green이다 — 이 repo가 두 번 겪은
  // 실패 클래스다(2026-08-26). 실행 경로를 통째로 지나가서 pass 줄을 확인한다.
  const result = spawnSync(process.execPath, ['.claude/scripts/validate-harness.mjs'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {...process.env, CI: 'true'},
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  assert.ok(
    output.includes('adapter derivation equivalence checked'),
    'validate-harness가 등가 게이트를 호출하지 않는다 — 배선이 끊겼다',
  )
})
