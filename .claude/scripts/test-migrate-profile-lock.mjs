#!/usr/bin/env node
// test-migrate-profile-lock.mjs — 루트에서 잠근 옛 프로필을 걷어내는 명령을 고정한다(미리보기는 쓰기 0, 대상 밖은 거부,
// 적용은 프로필 삭제 + 스팩 재확정, 재확정이 실패하면 프로필을 되돌린다).
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {PROFILE_PATH} from './migrate-profile-lock.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const cli = join(here, 'migrate-profile-lock.mjs')
const run = (root, ...args) => spawnSync(process.execPath, [cli, '--project-root', root, ...args], {encoding: 'utf8'})

// 루트 매니페스트에는 react·vite가 없고 멤버에만 있는 모노레포 + 루트에서 잠근 react-vite-spa 프로필.
const withMonorepo = (run, {profile = true, spec = true} = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'wh-migrate-profile-'))
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({name: 'mono', private: true, workspaces: ['apps/*']}))
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n')
    mkdirSync(join(root, 'apps/web'), {recursive: true})
    writeFileSync(join(root, 'apps/web/package.json'), JSON.stringify({name: 'web', dependencies: {react: '19.0.0'}, devDependencies: {vite: '6.0.0'}}))
    mkdirSync(join(root, '_workspace/01_plan'), {recursive: true})
    mkdirSync(join(root, '_workspace/02_design'), {recursive: true})
    mkdirSync(join(root, '_workspace/03_dev'), {recursive: true})
    const fixture = join(here, '../evals/fixtures/legacy-brownfield-0.28/_workspace')
    writeFileSync(join(root, '_workspace/02_design/solution-design.md'), readFileSync(join(fixture, '02_design/solution-design.md')))
    if (profile) writeFileSync(join(root, PROFILE_PATH), readFileSync(join(here, '../evals/fixtures/migrate-profile-lock/root-locked-profile.json')))
    if (spec) {
      const locked = spawnSync(process.execPath, [join(here, 'spec.mjs'), '--project-root', root], {encoding: 'utf8'})
      assert.equal(locked.status, 0, locked.stderr)
      writeFileSync(join(root, '_workspace/03_dev/spec.json'), locked.stdout)
    }
    return run(root)
  } finally { rmSync(root, {recursive: true, force: true}) }
}

test('미리보기: 멤버를 짚고 아무것도 쓰지 않는다', () => {
  withMonorepo(root => {
    const spec = readFileSync(join(root, '_workspace/03_dev/spec.json'), 'utf8')
    const result = run(root)
    assert.equal(result.status, 0, result.stderr)
    const plan = JSON.parse(result.stdout.slice(0, result.stdout.lastIndexOf('}') + 1))
    assert.equal(plan.action, 'migrate')
    assert.deepEqual(plan.members, ['apps/web'])
    assert.ok(existsSync(join(root, PROFILE_PATH)), '미리보기가 프로필을 지웠다')
    assert.equal(readFileSync(join(root, '_workspace/03_dev/spec.json'), 'utf8'), spec)
  })
})

test('적용: 프로필을 지우고 스팩을 다시 확정해 stale이 아니게 한다(원장에 남는다)', async () => {
  const {isSpecStale} = await import('./spec.mjs')
  withMonorepo(root => {
    const ledger = readFileSync(join(root, '_workspace/03_dev/spec-ledger.jsonl'), 'utf8').trim().split('\n').length
    const result = run(root, '--apply')
    assert.equal(result.status, 0, result.stderr)
    assert.ok(!existsSync(join(root, PROFILE_PATH)))
    const spec = JSON.parse(readFileSync(join(root, '_workspace/03_dev/spec.json'), 'utf8'))
    assert.equal(isSpecStale(spec, root), false, '프로필을 지운 뒤 스팩이 stale로 남았다')
    assert.equal(readFileSync(join(root, '_workspace/03_dev/spec-ledger.jsonl'), 'utf8').trim().split('\n').length, ledger + 1)
    assert.match(result.stdout, /커밋할 파일/)
  })
})

test('재확정이 실패하면 프로필을 되돌리고 exit 1 — 반쯤 옮긴 상태를 남기지 않는다', () => {
  withMonorepo(root => {
    writeFileSync(join(root, '_workspace/02_design/solution-design.md'), '# 결정 블록 없음\n')
    const result = run(root, '--apply')
    assert.equal(result.status, 1)
    assert.ok(existsSync(join(root, PROFILE_PATH)), '실패했는데 프로필이 사라졌다')
    assert.match(result.stdout, /되돌렸다/)
  })
})

test('대상 밖: 프로필이 맞거나 없으면 할 일 없음, 멤버에도 없는 무효 잠금은 거부', () => {
  withMonorepo(root => {
    assert.equal(JSON.parse(run(root).stdout).action, 'none')
  }, {profile: false, spec: false})
  withMonorepo(root => {
    rmSync(join(root, 'apps/web/package.json'))
    const result = run(root, '--apply')
    assert.equal(result.status, 1)
    assert.equal(JSON.parse(result.stdout).action, 'refuse')
    assert.ok(existsSync(join(root, PROFILE_PATH)))
  }, {spec: false})
})

test('사용법: 모르는 인자는 exit 2', () => {
  const result = spawnSync(process.execPath, [cli, '--project-root', '.', '--force'], {encoding: 'utf8'})
  assert.equal(result.status, 2)
})

test('어댑터 판본이 바뀌어 다른 오류가 먼저 나도 루트 잠금으로 진단한다', async () => {
  const {diagnoseRootLock} = await import('./migrate-profile-lock.mjs')
  withMonorepo(root => {
    const raw = JSON.parse(readFileSync(join(root, PROFILE_PATH), 'utf8'))
    raw.adapter.sha256 = '0'.repeat(64)
    writeFileSync(join(root, PROFILE_PATH), JSON.stringify(raw))
    assert.deepEqual(diagnoseRootLock(root, raw)?.members, ['apps/web'])
    assert.equal(JSON.parse(run(root).stdout.slice(0, run(root).stdout.lastIndexOf('}') + 1)).action, 'migrate')
  }, {spec: false})
})

test('적용이 중간에 끊긴 파킹 파일을 미리보기가 알린다', () => {
  withMonorepo(root => {
    writeFileSync(join(root, `${PROFILE_PATH}.migrating-12345`), '{}')
    const plan = JSON.parse(run(root).stdout.slice(0, run(root).stdout.lastIndexOf('}') + 1))
    assert.deepEqual(plan.leftovers, ['_workspace/01_plan/project-profile.json.migrating-12345'])
  }, {spec: false})
})
