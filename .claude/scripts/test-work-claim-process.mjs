#!/usr/bin/env node
// test-work-claim-process.mjs — `claim --work`를 **실제 CLI 프로세스**로 돌린다: 생산(system-architect 대역
// fixture) → 파일 → 소비(CLI) → exit·phase → 산출 파일. 함수 단위 통과만으로 배선이 됐다고 하지 않는다.
//
// 고정하는 사실:
//   T57  work-plan이 없어도 첫 호출이 준비를 시작한다 — 대상 FEAT 목록과 다음 작성자를 돌려준다, 외부 쓰기 0
//   T61  --confirm이 와도 발행하지 않고 FEAT 발행으로 되돌아가지 않는다(원장·트래커 무접촉)
//   T05  한 번 검토한 판본의 작업을 지우면 다음 호출이 exit 2로 막는다
//   T39  검토 뒤 입력 파일이 바뀌면 알린다(CLI가 계산한 실제 지문)
//   T42  분석이 바뀌었는데 계획이 옛 판본을 가리키면 막는다
import assert from 'node:assert/strict'
import test from 'node:test'
import {cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {spawnSync} from 'node:child_process'
import {canonicalDigest} from './ticket/work-analysis.mjs'
import {evaluateGlobalBashPolicy} from './global-bash-policy-lib.mjs'

const repo = new URL('../..', import.meta.url).pathname
const CLI = join(repo, '.claude/scripts/ticket/cli.mjs')
const LEDGER = '_workspace/03_dev/identity-ledger.jsonl'

const copyFixture = (name, {drop = []} = {}) => {
  const root = mkdtempSync(join(tmpdir(), `wh-work-${name}-`))
  cpSync(join(repo, '.claude/evals/fixtures/work-plan', name), root, {recursive: true})
  for (const relative of drop) rmSync(join(root, relative), {force: true})
  return root
}
// 트래커 설정·토큰이 없는 환경에서 돈다 — 무엇이든 트래커를 부르려 하면 실패로 드러난다.
const claim = (root, ...extra) => {
  const run = spawnSync(process.execPath, [CLI, 'claim', '--work', '--root', root, ...extra], {encoding: 'utf8',
    env: {PATH: process.env.PATH, HOME: process.env.HOME}, timeout: 30000})
  let result = null
  try { result = JSON.parse(run.stdout) } catch { /* stderr로 판단 */ }
  return {status: run.status, result, stderr: run.stderr}
}
const within = (root, fn) => { try { return fn(root) } finally { rmSync(root, {recursive: true, force: true}) } }

test('T57: 분석·계획 파일이 없어도 준비가 시작된다 — 대상 FEAT 전부와 다음 작성자, 외부 쓰기 0', () => {
  within(copyFixture('crud', {drop: ['_workspace/03_dev/work-analysis.json', '_workspace/03_dev/work-plan.json']}), root => {
    const {status, result} = claim(root)
    assert.equal(status, 0, '준비 단계를 오류로 끝냈다')
    assert.equal(result.phase, 'P0_ANALYSIS_REQUIRED')
    assert.equal(result.next.author, 'system-architect')
    assert.deepEqual(result.inventory.map(item => item.featureId), ['FEAT-001', 'FEAT-002', 'FEAT-003', 'FEAT-004', 'FEAT-005'], '대상 FEAT 목록이 빠졌다')
    assert.ok(result.inventory.every(item => /^[0-9a-f]{64}$/.test(item.sourceDigest)), 'FEAT 명세 digest를 알려 주지 않는다 — 작성 에이전트는 해시를 계산할 수 없다')
    assert.equal(result.externalWrites, 0)
    assert.equal(existsSync(join(root, LEDGER)), false, '준비 단계가 원장을 썼다')
  })
})

test('P1_PLAN_REQUIRED → P1_REVIEW: 분석을 소비해 계획을 검증하고 검토표·판본·입력 지문을 남긴다', () => {
  within(copyFixture('crud', {drop: ['_workspace/03_dev/work-plan.json']}), root => {
    const first = claim(root)
    assert.equal(first.result.phase, 'P1_PLAN_REQUIRED')
    const analysis = JSON.parse(readFileSync(join(root, '_workspace/03_dev/work-analysis.json'), 'utf8'))
    assert.equal(first.result.next.analysisRef.digest, canonicalDigest(analysis), '계획이 가리킬 분석 digest를 틀리게 알려 준다')
    cpSync(join(repo, '.claude/evals/fixtures/work-plan/crud/_workspace/03_dev/work-plan.json'), join(root, '_workspace/03_dev/work-plan.json'))
    const review = claim(root)
    assert.equal(review.status, 0, review.stderr || JSON.stringify(review.result?.errors))
    assert.equal(review.result.phase, 'P1_REVIEW')
    assert.equal(review.result.confirmable, true)
    assert.deepEqual(review.result.ready.map(id => id.slice(0, 13)), ['WORK-00000001', 'WORK-00000003'])
    const table = readFileSync(join(root, '_workspace/03_dev/work-plan-review.md'), 'utf8')
    assert.match(table, /FEAT-004 \| 회원 일괄 삭제 \| deferred\(product-deferral\)/, '유예 FEAT가 검토표에서 사라졌다 — 분모를 줄이지 않는다')
    assert.match(table, /결정 대기/, '미결로 막힌 작업이 표시되지 않는다')
    for (const path of Object.values(review.result.revisions)) assert.ok(existsSync(join(root, path)), `검토 판본 ${path}가 없다`)
    const pointer = JSON.parse(readFileSync(join(root, '_workspace/03_dev/work-plan-reviewed.json'), 'utf8'))
    assert.ok(Object.keys(pointer.inputs).length >= 3, 'CLI가 입력 파일 지문을 남기지 않았다')
    assert.equal(existsSync(join(root, LEDGER)), false, '검토 단계가 원장을 썼다')
  })
})

test('T61: --confirm이 와도 발행하지 않고 FEAT 발행으로 되돌아가지 않는다', () => {
  within(copyFixture('crud'), root => {
    const {status, result} = claim(root, '--confirm')
    assert.equal(status, 2, '확인 플래그로 무언가를 실행했다')
    assert.equal(result.phase, 'PUBLISH_NOT_AVAILABLE')
    assert.equal(existsSync(join(root, LEDGER)), false, 'WORK 준비 요청이 FEAT 청구로 폴백했다')
  })
})

test('T05·T39: 검토 뒤 작업을 지우면 막고, 입력 파일이 바뀌면 알린다', () => {
  within(copyFixture('crud'), root => {
    assert.equal(claim(root).result.phase, 'P1_REVIEW')
    // 입력 변경: 공용 표 컴포넌트가 바뀌었다.
    writeFileSync(join(root, 'src/shared/ui/DataTable.tsx'), '// 바뀐 공용 표\nexport function DataTable() { return null }\n')
    const changed = claim(root)
    assert.ok(changed.result.changedInputs.includes('src/shared/ui/DataTable.tsx'), '바뀐 입력을 알리지 않았다')
    assert.ok(changed.result.warnings.some(warning => /stale|바뀌었다/.test(warning)))
    // 알림은 계획이 다시 검토될 때까지 남는다 — 한 번 알리고 포인터를 덮어쓰면 다음 호출은 깨끗해 보인다.
    const again = claim(root)
    assert.deepEqual(again.result.staleInputs, ['src/shared/ui/DataTable.tsx'], '바뀐 입력 알림이 한 번 뒤 사라졌다')
    assert.match(readFileSync(join(root, '_workspace/03_dev/work-plan-review.md'), 'utf8'), /검토 뒤 바뀐 입력\n\n- `src\/shared\/ui\/DataTable\.tsx`/, '검토표가 바뀐 입력을 싣지 않는다')
    // 작업 삭제: 검토한 판본의 검색·필터 작업을 배열에서 지운다.
    const planPath = join(root, '_workspace/03_dev/work-plan.json')
    const plan = JSON.parse(readFileSync(planPath, 'utf8'))
    plan.workItems = plan.workItems.filter(item => item.title !== '검색·필터')
    writeFileSync(planPath, JSON.stringify(plan))
    const removed = claim(root)
    assert.equal(removed.status, 2)
    assert.ok(removed.result.errors.some(error => /사라졌다/.test(error)), '검토한 작업의 삭제를 통과시켰다')
  })
})

test('T42: 분석을 고치고 계획을 그대로 두면 막는다', () => {
  within(copyFixture('editor'), root => {
    const path = join(root, '_workspace/03_dev/work-analysis.json')
    const analysis = JSON.parse(readFileSync(path, 'utf8'))
    analysis.findings[0].capability = '바뀐 판정'
    writeFileSync(path, JSON.stringify(analysis))
    const {status, result} = claim(root)
    assert.equal(status, 2)
    assert.equal(result.phase, 'P1_PLAN_INVALID')
    assert.ok(result.errors.some(error => /analysisRef\.digest/.test(error)))
  })
})

test('편집기 fixture: 공유 문서 기반 하나가 먼저 열리고 나머지는 선행 대기다', () => {
  within(copyFixture('editor'), root => {
    const {status, result} = claim(root)
    assert.equal(status, 0, JSON.stringify(result?.errors))
    assert.deepEqual(result.ready.map(id => id.slice(0, 13)), ['WORK-00000001'])
    assert.ok(result.view.filter(row => row.workId !== result.ready[0]).every(row => row.status === 'waiting-deps'))
  })
})

test('범위를 지정하면 그 FEAT만 대상이고, 계획에 없는 FEAT는 거부한다', () => {
  within(copyFixture('crud', {drop: ['_workspace/03_dev/work-analysis.json']}), root => {
    assert.deepEqual(claim(root, '--features', 'FEAT-001,FEAT-003').result.scope.featureIds, ['FEAT-001', 'FEAT-003'])
    const unknown = claim(root, '--features', 'FEAT-777')
    assert.equal(unknown.status, 2)
    assert.equal(unknown.result.phase, 'SCOPE_UNKNOWN')
  })
})

test('배선: 에이전트 경로의 bash 정책이 claim --work를 연다', () => {
  const allowed = evaluateGlobalBashPolicy({agent_type: 'claude', tool_name: 'Bash',
    tool_input: {command: 'node .claude/scripts/ticket/cli.mjs claim --work --features FEAT-001,FEAT-002'}})
  assert.equal(allowed.allowed, true, 'WORK 준비 명령이 에이전트 경로에서 막힌다')
})

test('프로젝트 밖을 가리키는 symlink와 사라진 보존본은 읽지 않는다 — 호스트 파일의 해시가 공유 산출물에 실리지 않는다', () => {
  const outside = mkdtempSync(join(tmpdir(), 'wh-outside-'))
  try {
    writeFileSync(join(outside, 'secret.env'), 'TOKEN=abc\n')
    within(copyFixture('crud'), root => {
      rmSync(join(root, '_workspace/00_source/impl/member-api.md'))
      symlinkSync(join(outside, 'secret.env'), join(root, '_workspace/00_source/impl/member-api.md'))
      const {status, result} = claim(root)
      assert.equal(status, 2, 'symlink 원문을 읽었다')
      assert.ok(result.errors.some(error => /member-api\.md가 없다/.test(error)), JSON.stringify(result.errors))
      assert.equal(existsSync(join(root, '_workspace/03_dev/work-plan-reviewed.json')), false, '거부했는데 포인터를 썼다')
    })
    within(copyFixture('crud'), root => {
      rmSync(join(root, '_workspace/00_source/impl/member-admin-design.md'))
      const {status, result} = claim(root)
      assert.equal(status, 2)
      assert.equal(result.phase, 'P0_ANALYSIS_INVALID', '보존본이 사라졌는데 분석을 통과시켰다')
    })
  } finally {
    rmSync(outside, {recursive: true, force: true})
  }
})

test('취소한 작업은 검토표에 남고, 검토 계보는 포인터에 쌓인다', () => {
  within(copyFixture('crud'), root => {
    assert.equal(claim(root).result.phase, 'P1_REVIEW')
    const planPath = join(root, '_workspace/03_dev/work-plan.json')
    const plan = JSON.parse(readFileSync(planPath, 'utf8'))
    const search = plan.workItems.find(item => item.title === '검색·필터')
    search.lifecycle = 'cancelled'
    const feat2 = plan.featureBindings.find(binding => binding.featureId === 'FEAT-002')
    feat2.requiredWorkIds = feat2.requiredWorkIds.filter(id => id !== search.workId)
    feat2.acceptanceOwners = [{testCaseId: 'TC-002-1', workId: feat2.requiredWorkIds.find(id => id.startsWith('WORK-00000004'))}]
    // 취소한 작업에 기대던 통합 작업의 의존도 옮긴다 — 검증기는 취소된 작업에 대한 의존을 막는다.
    const integration = plan.workItems.find(item => item.title === '검색·선택·수정 통합')
    integration.dependsOn = integration.dependsOn.map(id => (id === search.workId ? feat2.acceptanceOwners[0].workId : id))
    writeFileSync(planPath, JSON.stringify(plan))
    const review = claim(root)
    assert.equal(review.status, 0, JSON.stringify(review.result?.errors))
    assert.match(readFileSync(join(root, '_workspace/03_dev/work-plan-review.md'), 'utf8'), /취소·대체된 작업[\s\S]*검색·필터 — cancelled/, '취소한 작업이 검토표에서 사라졌다')
    const pointer = JSON.parse(readFileSync(join(root, '_workspace/03_dev/work-plan-reviewed.json'), 'utf8'))
    assert.ok(pointer.knownWorkIds.includes(search.workId), '검토 계보에 작업이 남지 않았다 — 다음에 배열에서 지워도 모른다')
  })
})
