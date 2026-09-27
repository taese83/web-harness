#!/usr/bin/env node
// test-workflow-security-acceptance.mjs — 기존 저장소 워크플로 finding의 명시적 인수.
//
// 고정하는 것: 인수는 개발 게이트(--check)에서만 효력이 있고, 워크플로 내용 digest·finding 코드에
// 결박되며, 바뀐 워크플로를 flag로 다시 인수할 수 없고, 배포 증거에는 실리지 못한다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {
  acceptanceCovers,
  acceptancePath,
  readWorkflowSecurityAcceptance,
  recordWorkflowSecurityAcceptance,
} from './workflow-security-acceptance.mjs'
import {readReceipt} from './receipt-validation-lib.mjs'
import {validateWorkflowSecurityProjects} from './workflow-security-lib.mjs'

const runner = fileURLToPath(new URL('./run-quality-gates.mjs', import.meta.url))
const fixture = fileURLToPath(new URL('../../golden/vite-serverless-hybrid', import.meta.url))

const withProject = fn => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-wf-accept-')))
  try { return fn(root) } finally { rmSync(root, {recursive: true, force: true}) }
}
const finding = (overrides = {}) => ({workflowPath: '.github/workflows/ci.yml', sha256: 'sha256:aa', code: 'ACTION_NOT_IMMUTABLE', ...overrides})

test('인수가 없으면 none — 인수는 명시적으로만 생긴다', () => {
  withProject(root => assert.equal(readWorkflowSecurityAcceptance(root).state, 'none'))
})

test('인수는 경로·내용 digest·코드가 모두 같을 때만 덮는다', () => {
  withProject(root => {
    recordWorkflowSecurityAcceptance(root, [finding(), finding({code: 'JOB_TIMEOUT_REQUIRED'})])
    const {state, record} = readWorkflowSecurityAcceptance(root)
    assert.equal(state, 'valid')
    assert.deepEqual(record.workflows, [{path: '.github/workflows/ci.yml', sha256: 'sha256:aa', codes: ['ACTION_NOT_IMMUTABLE', 'JOB_TIMEOUT_REQUIRED']}])
    assert.equal(acceptanceCovers(record, finding()), true)
    assert.equal(acceptanceCovers(record, finding({sha256: 'sha256:bb'})), false, '바뀐 워크플로를 덮었다')
    assert.equal(acceptanceCovers(record, finding({code: 'DEFAULT_PERMISSIONS_REQUIRED'})), false, '인수하지 않은 코드를 덮었다')
    assert.equal(acceptanceCovers(record, finding({workflowPath: '.github/workflows/deploy.yml'})), false, '다른 워크플로를 덮었다')
    assert.match(readFileSync(acceptancePath(root), 'utf8'), /지운다/, '되돌리는 법이 파일 안에 있어야 한다')
  })
})

test('깨진·다른 프로젝트·다른 형식의 인수는 부재가 아니라 무효다', () => {
  withProject(root => {
    assert.equal(readWorkflowSecurityAcceptance(root, {read: () => '{ "workflows": '}).state, 'unreadable')
    const foreign = JSON.stringify({schemaVersion: 1, projectRoot: '/elsewhere', workflows: []})
    assert.equal(readWorkflowSecurityAcceptance(root, {read: () => foreign}).state, 'other-project')
    const legacy = JSON.stringify({schemaVersion: 0, projectRoot: root, workflows: []})
    assert.equal(readWorkflowSecurityAcceptance(root, {read: () => legacy}).state, 'schema-outdated')
  })
})

test('배포 증거 검증: 인수된 finding을 실은 영수증과 그 필드가 없는 영수증은 거부한다', () => {
  withProject(root => {
    const evidence = join(root, '_workspace/04_qa/evidence')
    mkdirSync(evidence, {recursive: true})
    const check = (receipt) => {
      writeFileSync(join(evidence, 'typecheck.json'), JSON.stringify({schemaVersion: 2, ...receipt}))
      const errors = []
      readReceipt(root, 'typecheck', 'fp', errors)
      return errors.filter(error => /workflow (security findings|finding acceptance)/.test(error))
    }
    assert.match(check({workflowSecurityAccepted: [{path: '.github/workflows/ci.yml', code: 'ACTION_NOT_IMMUTABLE', line: 7}]}).join(), /cannot carry accepted/)
    assert.match(check({}).join(), /field is missing/, '필드를 빼서 인수 사실을 숨길 수 있다')
    assert.deepEqual(check({workflowSecurityAccepted: []}), [])
  })
})

const WORKFLOW = 'name: ci\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n'

test('실제 러너: 개발 게이트에서만 인수하고, 바뀐 워크플로는 flag로 다시 인수하지 못한다', () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-wf-accept-run-'))
  const project = join(root, 'p')
  try {
    cpSync(fixture, project, {recursive: true, filter: source => !source.includes('/node_modules')})
    mkdirSync(join(project, '.github/workflows'), {recursive: true})
    const workflowPath = join(project, '.github/workflows/ci.yml')
    writeFileSync(workflowPath, WORKFLOW)
    const acceptanceFile = join(project, '_workspace/03_dev/workflow-security-acceptance.json')
    const receiptFile = join(project, '_workspace/04_qa/evidence/typecheck.json')
    const run = (...extra) => spawnSync(process.execPath, [runner, '--project', project, ...extra], {
      encoding: 'utf8', env: {...process.env, WEB_HARNESS_ISOLATED_EXECUTION: '1'},
    })
    const blocked = result => result.stderr.includes('Workflow security validation failed')

    const plain = run('--check', 'typecheck')
    assert.ok(blocked(plain), plain.stderr)
    assert.match(plain.stderr, /--accept-workflow-findings/, '사람이 무엇을 할 수 있는지 알려야 한다')

    const release = run('--all', '--accept-workflow-findings')
    assert.equal(release.status, 2)
    assert.match(release.stderr, /--check only/)
    assert.equal(existsSync(acceptanceFile), false, '배포 증거 실행이 인수를 기록했다')

    const accepted = run('--check', 'typecheck', '--accept-workflow-findings')
    assert.ok(!blocked(accepted), accepted.stderr)
    assert.ok(existsSync(acceptanceFile), '인수가 기록되지 않았다')
    const receipt = JSON.parse(readFileSync(receiptFile, 'utf8'))
    assert.ok(receipt.workflowSecurityAccepted.some(entry => entry.code === 'ACTION_NOT_IMMUTABLE'), '영수증에 인수 사실이 없다')

    const standing = run('--check', 'typecheck')
    assert.ok(!blocked(standing), `기록된 인수를 쓰지 않았다:\n${standing.stderr}`)

    const releaseWithStanding = run('--all')
    assert.ok(blocked(releaseWithStanding), '기록된 인수가 배포 증거 실행에 적용됐다')

    const recorded = readFileSync(acceptanceFile, 'utf8')
    writeFileSync(workflowPath, `${WORKFLOW}# changed after acceptance\n`)
    const stale = run('--check', 'typecheck', '--accept-workflow-findings')
    assert.ok(blocked(stale), '인수 뒤 바뀐 워크플로가 통과했다')
    assert.match(stale.stderr, /지우고/, '사람이 무엇을 해야 하는지 알려야 한다')
    assert.equal(readFileSync(acceptanceFile, 'utf8'), recorded, 'flag가 낡은 인수를 덮어썼다')

  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

// 검사하지 못한 항목(정규 파일이 아닌 워크플로)은 인수 대상이 아니다 — 무엇을 인수했는지 알 수 없다.
test('구조 실패는 acceptFinding이 모두 받아도 실패로 남는다', () => {
  withProject(root => {
    mkdirSync(join(root, '.github/workflows/not-a-file.yml'), {recursive: true})
    writeFileSync(join(root, '.github/workflows/ci.yml'), WORKFLOW)
    const failures = []
    const offered = []
    validateWorkflowSecurityProjects({
      repositoryRoot: root,
      manifest: {schemaVersion: 1, projects: [{root: '.'}]},
      pass: () => {},
      fail: message => failures.push(message),
      acceptFinding: candidate => { offered.push(candidate); return true },
    })
    assert.deepEqual(failures.map(message => message.split(':')[0]), ['.github/workflows/not-a-file.yml'])
    assert.ok(offered.length > 0 && offered.every(candidate => /^sha256:[0-9a-f]{64}$/.test(candidate.sha256)), '내용 finding에 digest가 없다')
  })
})
