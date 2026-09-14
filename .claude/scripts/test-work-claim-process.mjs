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
//   T58  `--publish`가 실제로 발행 입구로 배선돼 있고, 검토·설정 없이는 외부 쓰기 0으로 멈춘다
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

test('검토는 이벤트 원장에 남고 계보가 쌓인다 — 포인터를 지워도 작업 삭제 대조가 살아 있다', () => {
  within(copyFixture('crud'), root => {
    assert.equal(claim(root).result.phase, 'P1_REVIEW')
    const eventsPath = join(root, '_workspace/03_dev/work-item-events.jsonl')
    const events = readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
    assert.equal(events.length, 1)
    assert.equal(events[0].eventType, 'plan-reviewed')
    assert.ok(events[0].payload.workIds.length >= 6, '검토한 작업 계보가 이벤트에 없다')
    // 포인터를 지운다(로컬 파일이라 지울 수 있다) — 계보는 append-only 원장에 남아 삭제를 여전히 잡는다.
    rmSync(join(root, '_workspace/03_dev/work-plan-reviewed.json'))
    const planPath = join(root, '_workspace/03_dev/work-plan.json')
    const plan = JSON.parse(readFileSync(planPath, 'utf8'))
    plan.workItems = plan.workItems.filter(item => item.title !== '검색·필터')
    writeFileSync(planPath, JSON.stringify(plan))
    const removed = claim(root)
    assert.equal(removed.status, 2, '포인터를 지우자 작업 삭제가 통과했다')
    assert.ok(removed.result.errors.some(error => /사라졌다/.test(error)))
  })
})

test('같은 판본을 다시 검토해도 이벤트는 한 줄이다 — 원장이 재실행으로 자라지 않는다', () => {
  within(copyFixture('editor'), root => {
    for (let round = 0; round < 3; round += 1) assert.equal(claim(root).result.phase, 'P1_REVIEW')
    const lines = readFileSync(join(root, '_workspace/03_dev/work-item-events.jsonl'), 'utf8').split('\n').filter(Boolean)
    assert.equal(lines.length, 1, `같은 판본 재검토가 이벤트를 ${lines.length}줄 남겼다 — 상한까지 자라면 claim이 막힌다`)
  })
})

test('T58: `--publish`는 발행 입구로 배선돼 있고, 검토·설정 없이는 외부 쓰기 0으로 멈춘다', () => {
  // 배선 회귀다 — 함수 단위로 발행을 돌려도 CLI가 그 문을 부르지 않으면 아무 일도 일어나지 않는다.
  within(copyFixture('crud'), root => {
    const events = join(root, '_workspace/03_dev/work-item-events.jsonl')
    // ① 트래커 설정이 없으면 발행하지 않는다 — 무엇을 정해야 하는지 돌려준다(원장 없는 프로젝트를
    //    「이미 GitHub이다」로 추론하지 않는다).
    const unconfigured = claim(root, '--publish', '--confirm')
    assert.notEqual(unconfigured.result?.phase, 'PUBLISH_NOT_AVAILABLE', '--publish가 발행 입구로 가지 않았다')
    assert.equal(unconfigured.result?.phase, 'PROVIDER_NOT_READY', JSON.stringify(unconfigured.result ?? unconfigured.stderr))
    assert.equal(unconfigured.result.externalWrites, 0)
    // 설정을 기록한다 — 실제 경로로(손으로 JSON을 만들지 않는다).
    const configured = spawnSync(process.execPath, [CLI, 'configure', '--provider', 'jira', '--root', root, '--confirm',
      '--set', 'baseUrl=https://jira.invalid', '--set', 'projectKey=PF', '--set', 'issueType=Task',
      '--set', 'workLink.mode=issue-link', '--set', 'workLink.linkType=Relates'],
    {encoding: 'utf8', env: {PATH: process.env.PATH, HOME: process.env.HOME}, timeout: 30000})
    assert.equal(configured.status, 0, configured.stderr)
    // ② 설정이 있어도 **검토 기록이 없으면** --confirm이 있어도 막힌다.
    const unreviewed = claim(root, '--publish', '--confirm')
    assert.equal(unreviewed.result?.phase, 'PUBLISH_BLOCKED', JSON.stringify(unreviewed.result ?? unreviewed.stderr))
    assert.equal(unreviewed.result.externalWrites, 0)
    assert.ok(unreviewed.result.errors.some(error => /검토한 기록이 없다/.test(error)), JSON.stringify(unreviewed.result.errors))
    // ③ 검토 뒤 확인 없이 부르면 미리보기다 — 트래커를 부르지 않는다(이 환경엔 토큰도 없다).
    assert.equal(claim(root).result.phase, 'P1_REVIEW')
    const preview = claim(root, '--publish')
    assert.equal(preview.result?.phase, 'PUBLISH_PREVIEW', JSON.stringify(preview.result ?? preview.stderr))
    assert.equal(preview.result.externalWrites, 0)
    assert.ok(preview.result.publish.length > 0, '무엇을 낼지 보여주지 않았다')
    // 결정이 안 난 작업과 **그 후손**은 이유와 함께 빠진다 — 배치 전체가 서지도, 조용히 빠지지도 않는다.
    const skippedIds = preview.result.skipped.map(item => item.workId)
    assert.ok(preview.result.skipped.some(item => item.reason === 'blocked-unresolved'),
      '미해결 결정으로 뺀 작업이 목록에서 사라졌다')
    assert.ok(skippedIds.length > 0 && preview.result.skipped.every(item => typeof item.reason === 'string' && item.reason.length > 0),
      '뺀 작업을 이유 없이 뺐다')
    assert.equal(preview.result.publish.some(item => skippedIds.includes(item.workId)), false)
    const ledger = existsSync(events) ? readFileSync(events, 'utf8') : ''
    assert.ok(!ledger.includes('publish-'), '발행하지 않았는데 발행 이벤트를 남겼다')
  })
})

test('I3: GitHub 형태도 설정으로 열린다 — `link-only`를 선언하면 미리보기까지 간다', () => {
  // 트래커 하나에만 배선된 계약은 「두 형태에 성립한다」고 말할 수 없다. GitHub은 확인된 유형
  // 관계가 없어 `link-only`뿐이고, 그 사실을 사람이 선언해야 열린다 — 이름으로 면제되지 않는다.
  within(copyFixture('editor'), root => {
    const configured = spawnSync(process.execPath, [CLI, 'configure', '--provider', 'github', '--root', root, '--confirm',
      '--set', 'workLink.mode=link-only'], {encoding: 'utf8', env: {PATH: process.env.PATH, HOME: process.env.HOME}, timeout: 30000})
    assert.equal(configured.status, 0, configured.stderr)
    assert.equal(claim(root).result.phase, 'P1_REVIEW')
    const preview = claim(root, '--publish', '--repo', 'acme/web')
    assert.equal(preview.result?.phase, 'PUBLISH_PREVIEW', JSON.stringify(preview.result ?? preview.stderr))
    assert.equal(preview.result.provider.name, 'github')
    assert.equal(preview.result.provider.relation.mode, 'link-only')
    assert.equal(preview.result.externalWrites, 0)
    // 선언이 없으면 막힌다 — GitHub이라는 이름이 「관계 없음」을 면제하지 않는다.
    const bare = within(copyFixture('editor'), other => {
      const onlyHost = spawnSync(process.execPath, [CLI, 'configure', '--provider', 'github', '--root', other, '--confirm',
        '--set', 'host=github.example.com'], {encoding: 'utf8', env: {PATH: process.env.PATH, HOME: process.env.HOME}, timeout: 30000})
      assert.equal(onlyHost.status, 0, onlyHost.stderr)
      assert.equal(claim(other).result.phase, 'P1_REVIEW')
      return claim(other, '--publish', '--repo', 'acme/web').result
    })
    assert.equal(bare.phase, 'PROVIDER_NOT_READY')
    assert.ok(bare.provider.missing.some(item => item.startsWith('config.workLink.mode')), JSON.stringify(bare.provider))
  })
})
