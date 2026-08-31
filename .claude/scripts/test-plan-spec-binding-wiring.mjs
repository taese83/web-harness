#!/usr/bin/env node
// test-plan-spec-binding-wiring.mjs — 계획↔스팩 결속의 **배선** 회귀.
//
// 왜 별도 파일인가: 순수 코어(`checkPlanAgainstSpec`·`inspectPlanSpecBinding`)는 각 테스트가
// 직접 부른다. 그러나 `--lock`이 원장에 `specDigest`를 실제로 append하는지, STALE이 정말
// exit 1을 내는지는 **main()에서만** 일어난다. 이 repo는 "배선을 시험하는 회귀가 없으면
// 배선은 조용히 끊긴다"를 §4에 두 번 등록했고(executionBinding·ownership 훅), 세 번째를
// 만들지 않는다. 두 CLI를 실제 프로세스로 돌린다.
//
// 여기서 고정하는 사실:
//   (1) --lock이 planLock과 **원장 양쪽**에 specDigest를 남긴다
//   (2) 스팩이 그 뒤로 바뀌면 resume이 exit 1로 막는다(COMPLETE를 주지 않는다)
//   (3) **매니페스트의 specDigest를 지워도** 원장이 증거라 강등되지 않는다
//   (4) 결속이 있는데 spec.json이 사라지면 SPEC_GONE으로 막는다 — 부재로 강등하지 않는다
import assert from 'node:assert/strict'
import test from 'node:test'
import {execFileSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'

const SPAWN_PLAN = fileURLToPath(new URL('./validate-spawn-plan.mjs', import.meta.url))
const RESUME = fileURLToPath(new URL('./resume-manifest.mjs', import.meta.url))

const run = (script, args, cwd) => {
  try {
    return {code: 0, out: execFileSync(process.execPath, [script, ...args], {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']})}
  } catch (error) {
    return {code: error.status ?? 1, out: `${error.stdout ?? ''}${error.stderr ?? ''}`}
  }
}

const SPEC = {
  schemaVersion: 2,
  layerMap: {domain: 'src/entities'},
  testLayers: {unit: 'src'},
  moduleBoundaries: [{scope: 'src/entities/track', rationale: 'FEAT-002'}],
}

const MANIFEST_REL = '_workspace/03_dev/build-manifest/task.json'

// 완결된 산출물을 함께 놓는다 — 결속이 아닌 이유(미완결)로 exit 1이 나면 무엇을 재는
// 테스트인지 흐려진다.
const withProject = (run_, {spec = SPEC} = {}) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-binding-')))
  try {
    mkdirSync(join(root, '_workspace/03_dev/build-manifest'), {recursive: true})
    mkdirSync(join(root, 'src/entities/track'), {recursive: true})
    writeFileSync(join(root, 'src/entities/track/a.ts'), 'export const a = 1\n')
    if (spec) writeFileSync(join(root, '_workspace/03_dev/spec.json'), JSON.stringify(spec))
    writeFileSync(join(root, MANIFEST_REL), `${JSON.stringify({
      task: 'task', readMode: 'injected', reads: [], outputs: ['src/entities/track/a.ts'],
    }, null, 2)}\n`)
    return run_(root)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
}

const lockPlan = root => run(SPAWN_PLAN, ['--project', root, '--plan', MANIFEST_REL, '--lock'], root)
const resume = root => run(RESUME, ['--project', root, '--manifest', MANIFEST_REL], root)
const readManifest = root => JSON.parse(readFileSync(join(root, MANIFEST_REL), 'utf8'))
const ledgerRows = root => readFileSync(join(root, '_workspace/03_dev/build-manifest/.plan-locks.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map(line => JSON.parse(line))

test('--lock이 planLock과 원장 양쪽에 specDigest를 남긴다', () => {
  withProject(root => {
    const locked = lockPlan(root)
    assert.equal(locked.code, 0, locked.out)
    assert.match(readManifest(root).planLock.specDigest, /^[0-9a-f]{64}$/)
    const rows = ledgerRows(root)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].specDigest, readManifest(root).planLock.specDigest, '원장과 매니페스트가 같은 스팩을 가리켜야 한다')
  })
})

test('결속이 맞으면 resume은 COMPLETE로 통과한다', () => {
  withProject(root => {
    assert.equal(lockPlan(root).code, 0)
    const result = resume(root)
    assert.equal(result.code, 0, result.out)
    assert.match(result.out, /COMPLETE/)
  })
})

test('스팩이 그 뒤로 바뀌면 resume이 막는다 — 낡은 전제 위의 COMPLETE를 인정하지 않는다', () => {
  withProject(root => {
    assert.equal(lockPlan(root).code, 0)
    writeFileSync(join(root, '_workspace/03_dev/spec.json'),
      JSON.stringify({...SPEC, layerMap: {domain: 'src/entities', extra: 'src/features'}}))
    const result = resume(root)
    assert.equal(result.code, 1, result.out)
    assert.match(result.out, /PLAN_LOCK_SPEC_STALE/)
  })
})

test('매니페스트의 specDigest를 지워도 강등되지 않는다 — 증거는 위조 대상 바깥에 있다', () => {
  withProject(root => {
    assert.equal(lockPlan(root).code, 0)
    // planDigest는 planLock을 대상에서 제외하므로 이 삭제는 계획 digest를 바꾸지 않는다.
    // 종전 구현은 이 한 줄로 STALE → UNBOUND(경고, exit 0)로 내려앉았다.
    const manifest = readManifest(root)
    delete manifest.planLock.specDigest
    writeFileSync(join(root, MANIFEST_REL), `${JSON.stringify(manifest, null, 2)}\n`)
    writeFileSync(join(root, '_workspace/03_dev/spec.json'), JSON.stringify({...SPEC, layerMap: {domain: 'src/entities', extra: 'src/features'}}))
    const result = resume(root)
    assert.equal(result.code, 1, `specDigest 키 삭제로 결박이 꺼졌다:\n${result.out}`)
    assert.match(result.out, /PLAN_LOCK_SPEC_STALE/)
  })
})

test('결속이 있는데 spec.json이 사라지면 막는다 — 부재로 강등하지 않는다', () => {
  withProject(root => {
    assert.equal(lockPlan(root).code, 0)
    rmSync(join(root, '_workspace/03_dev/spec.json'))
    const result = resume(root)
    assert.equal(result.code, 1, result.out)
    assert.match(result.out, /SPEC_GONE/)
  })
})

test('스팩이 깨져도 같은 판정이다 — 한 바이트로 결박을 끄지 못한다', () => {
  withProject(root => {
    assert.equal(lockPlan(root).code, 0)
    writeFileSync(join(root, '_workspace/03_dev/spec.json'), '{ "layerMap": ')
    const result = resume(root)
    assert.equal(result.code, 1, result.out)
    assert.match(result.out, /SPEC_GONE/)
  })
})

test('스팩 없이 소스에 쓰는 계획은 --lock 자체가 거부된다', () => {
  withProject(root => {
    const result = lockPlan(root)
    assert.equal(result.code, 1, result.out)
    assert.match(result.out, /SPEC_REQUIRED/)
    assert.match(result.out, /REFUSE/)
  }, {spec: null})
})

test('스팩과 어긋난 계획은 잠기지 않는다 — REFUSE면 planLock을 찍지 않는다', () => {
  withProject(root => {
    const manifest = {task: 'task', readMode: 'injected', reads: [], outputs: ['src/entities/other-thing.ts']}
    writeFileSync(join(root, MANIFEST_REL), `${JSON.stringify(manifest, null, 2)}\n`)
    const result = lockPlan(root)
    assert.equal(result.code, 1, result.out)
    assert.match(result.out, /PLAN_OUTSIDE_MODULE_BOUNDARY/)
    assert.equal(readManifest(root).planLock, undefined, '거부된 계획에 정당성을 부여하면 안 된다')
  })
})
