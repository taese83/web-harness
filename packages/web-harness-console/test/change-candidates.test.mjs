import assert from 'node:assert/strict'
import {existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {
  inspectCandidateBase,
  beginCandidatePromotion,
  createCandidateWorkspace,
  finalizeCandidateWorkspace,
  removeCandidateWorkspace,
} from '../src/change-candidates.mjs'

const RUN_ID = 'RUN-CHG-20260806-001-apply-019fcf35-48fe-7d93-bb95-3304a2732950'

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-change-candidate-'))
  mkdirSync(join(root, '_workspace', '01_plan'), {recursive: true})
  mkdirSync(join(root, '_workspace', '03_dev'), {recursive: true})
  writeFileSync(join(root, '_workspace', '01_plan', 'feature-plan.md'), '# Baseline\n')
  writeFileSync(join(root, 'remove-me.txt'), 'remove me\n')
  return root
}

test('candidate changes stay isolated until promotion and rollback restores the baseline', t => {
  const root = fixture()
  t.after(() => rmSync(root, {recursive: true, force: true}))
  const session = createCandidateWorkspace(root)
  writeFileSync(join(session.worktreeRoot, '_workspace', '01_plan', 'feature-plan.md'), '# Candidate\n')
  writeFileSync(join(session.worktreeRoot, 'added.txt'), 'candidate only\n')
  rmSync(join(session.worktreeRoot, 'remove-me.txt'))

  const candidate = finalizeCandidateWorkspace(root, RUN_ID, session)
  assert.equal(readFileSync(join(root, '_workspace', '01_plan', 'feature-plan.md'), 'utf8'), '# Baseline\n')
  assert.equal(existsSync(join(root, 'added.txt')), false)
  assert.equal(existsSync(join(root, 'remove-me.txt')), true)
  assert.deepEqual(candidate.changedFiles.map(change => [change.path, change.kind]), [
    ['_workspace/01_plan/feature-plan.md', 'modified'],
    ['added.txt', 'added'],
    ['remove-me.txt', 'deleted'],
  ])

  const firstPromotion = beginCandidatePromotion(root, RUN_ID)
  assert.equal(readFileSync(join(root, '_workspace', '01_plan', 'feature-plan.md'), 'utf8'), '# Candidate\n')
  assert.equal(readFileSync(join(root, 'added.txt'), 'utf8'), 'candidate only\n')
  assert.equal(existsSync(join(root, 'remove-me.txt')), false)
  firstPromotion.rollback()
  assert.equal(readFileSync(join(root, '_workspace', '01_plan', 'feature-plan.md'), 'utf8'), '# Baseline\n')
  assert.equal(existsSync(join(root, 'added.txt')), false)
  assert.equal(readFileSync(join(root, 'remove-me.txt'), 'utf8'), 'remove me\n')

  const secondPromotion = beginCandidatePromotion(root, RUN_ID)
  secondPromotion.commit()
  assert.equal(readFileSync(join(root, '_workspace', '01_plan', 'feature-plan.md'), 'utf8'), '# Candidate\n')
  assert.equal(readFileSync(join(root, 'added.txt'), 'utf8'), 'candidate only\n')
  assert.equal(existsSync(join(root, 'remove-me.txt')), false)
  assert.equal(beginCandidatePromotion(root, RUN_ID).alreadyApplied, true)
})

test('promotion fails closed when canonical files changed after candidate creation', t => {
  const root = fixture()
  t.after(() => rmSync(root, {recursive: true, force: true}))
  const session = createCandidateWorkspace(root)
  writeFileSync(join(session.worktreeRoot, '_workspace', '01_plan', 'feature-plan.md'), '# Candidate\n')
  finalizeCandidateWorkspace(root, RUN_ID, session)
  writeFileSync(join(root, '_workspace', '01_plan', 'feature-plan.md'), '# User edit\n')

  assert.throws(
    () => beginCandidatePromotion(root, RUN_ID),
    error => error.code === 'CANDIDATE_BASE_STALE',
  )
  assert.equal(readFileSync(join(root, '_workspace', '01_plan', 'feature-plan.md'), 'utf8'), '# User edit\n')
})

test('append-only Change Request records are excluded from candidates and promotion rejects them', t => {
  const root = fixture()
  t.after(() => rmSync(root, {recursive: true, force: true}))
  const requestDirectory = join(root, '_workspace', '01_plan', 'change-requests')
  mkdirSync(requestDirectory, {recursive: true})
  writeFileSync(join(requestDirectory, 'CHG-20260806-001.md'), '# Original request\n')

  const session = createCandidateWorkspace(root)
  assert.equal(existsSync(join(session.worktreeRoot, '_workspace', '01_plan', 'change-requests')), false)
  writeFileSync(join(session.worktreeRoot, '_workspace', '01_plan', 'feature-plan.md'), '# Candidate\n')
  finalizeCandidateWorkspace(root, RUN_ID, session)

  const manifestPath = join(root, '_workspace', '03_dev', 'change-candidates', RUN_ID, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.changedFiles[0].path = '_workspace/01_plan/change-requests/CHG-20260806-001.md'
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`)
  assert.throws(
    () => beginCandidatePromotion(root, RUN_ID),
    error => error.code === 'CANDIDATE_PATH_UNSAFE',
  )
  assert.equal(readFileSync(join(requestDirectory, 'CHG-20260806-001.md'), 'utf8'), '# Original request\n')
})

test('new append-only records created after the candidate do not stale its promotion', t => {
  const root = fixture()
  t.after(() => rmSync(root, {recursive: true, force: true}))
  const session = createCandidateWorkspace(root)
  writeFileSync(join(session.worktreeRoot, '_workspace', '01_plan', 'feature-plan.md'), '# Candidate\n')
  finalizeCandidateWorkspace(root, RUN_ID, session)

  const requestDirectory = join(root, '_workspace', '01_plan', 'change-requests')
  mkdirSync(requestDirectory, {recursive: true})
  writeFileSync(join(requestDirectory, 'CHG-20260806-002.md'), '# Follow-up request\n')

  const promotion = beginCandidatePromotion(root, RUN_ID)
  promotion.commit()
  assert.equal(readFileSync(join(root, '_workspace', '01_plan', 'feature-plan.md'), 'utf8'), '# Candidate\n')
  assert.equal(readFileSync(join(requestDirectory, 'CHG-20260806-002.md'), 'utf8'), '# Follow-up request\n')
})

test('candidate snapshot rejects symlinks and promotion rejects a tampered traversal path', t => {
  const symlinkRoot = fixture()
  const outside = mkdtempSync(join(tmpdir(), 'web-harness-candidate-outside-'))
  t.after(() => {
    rmSync(symlinkRoot, {recursive: true, force: true})
    rmSync(outside, {recursive: true, force: true})
  })
  writeFileSync(join(outside, 'outside.txt'), 'outside\n')
  symlinkSync(join(outside, 'outside.txt'), join(symlinkRoot, 'unsafe-link'))
  assert.throws(
    () => createCandidateWorkspace(symlinkRoot),
    error => error.code === 'CANDIDATE_SYMLINK_UNSUPPORTED',
  )
  rmSync(join(symlinkRoot, 'unsafe-link'))

  const session = createCandidateWorkspace(symlinkRoot)
  writeFileSync(join(session.worktreeRoot, '_workspace', '01_plan', 'feature-plan.md'), '# Candidate\n')
  finalizeCandidateWorkspace(symlinkRoot, RUN_ID, session)
  const manifestPath = join(symlinkRoot, '_workspace', '03_dev', 'change-candidates', RUN_ID, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.changedFiles[0].path = '../outside.txt'
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`)
  assert.throws(
    () => beginCandidatePromotion(symlinkRoot, RUN_ID),
    error => error.code === 'CANDIDATE_PATH_UNSAFE',
  )
  assert.equal(readFileSync(join(outside, 'outside.txt'), 'utf8'), 'outside\n')
  assert.equal(readFileSync(join(symlinkRoot, '_workspace', '01_plan', 'feature-plan.md'), 'utf8'), '# Baseline\n')
})

// 병렬 실행이 열리면서(codex-runs 요청별 직렬화) 새로 도달 가능해진 경로 —
// 서로 다른 Change Request의 candidate가 **서로를 쓰지 않는지** 고정한다.
test('parallel candidates stay isolated and the second promotion fails loudly instead of overwriting', () => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-candidate-parallel-'))
  try {
    mkdirSync(join(root, '_workspace', '01_plan'), {recursive: true})
    writeFileSync(join(root, '_workspace', '01_plan', 'shared.md'), 'base\n')

    // 두 실행이 같은 시점의 라이브 트리를 baseline으로 뜬다(병렬).
    const sessionA = createCandidateWorkspace(root)
    const sessionB = createCandidateWorkspace(root)
    assert.equal(sessionA.baseline.digest, sessionB.baseline.digest)
    assert.notEqual(sessionA.worktreeRoot, sessionB.worktreeRoot)

    // 각자 격리된 워크트리에서 같은 파일을 다르게 고친다.
    writeFileSync(join(sessionA.worktreeRoot, '_workspace', '01_plan', 'shared.md'), 'from A\n')
    writeFileSync(join(sessionB.worktreeRoot, '_workspace', '01_plan', 'shared.md'), 'from B\n')

    const runA = 'RUN-CHG-20260829-001-apply-019fcf35-48fe-7d93-bb95-3304a2732a01'
    const runB = 'RUN-CHG-20260829-002-apply-019fcf35-48fe-7d93-bb95-3304a2732b01'
    const resultA = finalizeCandidateWorkspace(root, runA, sessionA)
    const resultB = finalizeCandidateWorkspace(root, runB, sessionB)

    // candidate는 실행별 디렉터리에 따로 남고 서로의 내용을 덮지 않는다.
    assert.notEqual(resultA.candidateDigest, resultB.candidateDigest)
    assert.equal(readFileSync(join(root, '_workspace', '03_dev', 'change-candidates', runA, 'files', '_workspace', '01_plan', 'shared.md'), 'utf8'), 'from A\n')
    assert.equal(readFileSync(join(root, '_workspace', '03_dev', 'change-candidates', runB, 'files', '_workspace', '01_plan', 'shared.md'), 'utf8'), 'from B\n')

    // 감사 디렉터리는 baseline에서 제외되므로 B의 baseline에 A의 산출물이 섞이지 않는다.
    assert.equal(resultA.baseDigest, resultB.baseDigest)

    // 먼저 승격한 쪽이 라이브 트리를 바꾸면, 나머지는 조용히 덮지 않고 STALE로 거절된다.
    beginCandidatePromotion(root, runA).commit()
    assert.equal(readFileSync(join(root, '_workspace', '01_plan', 'shared.md'), 'utf8'), 'from A\n')
    assert.throws(() => beginCandidatePromotion(root, runB), error => error.code === 'CANDIDATE_BASE_STALE')
    assert.equal(readFileSync(join(root, '_workspace', '01_plan', 'shared.md'), 'utf8'), 'from A\n')

    removeCandidateWorkspace(sessionA)
    removeCandidateWorkspace(sessionB)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

// 승인 장부는 프로젝트 내용이 아니다. 프리뷰 승인이 대기 중인 candidate 전부를
// CANDIDATE_BASE_STALE로 죽이던 결함을 고정한다.
test('recording a preview approval does not invalidate outstanding candidates', () => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-candidate-ledger-'))
  try {
    mkdirSync(join(root, '_workspace', '02_design'), {recursive: true})
    writeFileSync(join(root, '_workspace', '02_design', 'spec.md'), 'content\n')
    const before = createCandidateWorkspace(root)
    removeCandidateWorkspace(before)

    // recordPreviewApproval이 하는 일 — append-only 승인 기록
    writeFileSync(join(root, '_workspace', '02_design', 'design-review.md'), '## Preview Approval\n### 2026-08-29\n')
    const after = createCandidateWorkspace(root)
    removeCandidateWorkspace(after)
    assert.equal(after.baseline.digest, before.baseline.digest)

    // 반면 실제 설계 문서가 바뀌면 여전히 baseline이 달라진다 — 게이트는 살아 있다.
    writeFileSync(join(root, '_workspace', '02_design', 'spec.md'), 'changed\n')
    const changed = createCandidateWorkspace(root)
    removeCandidateWorkspace(changed)
    assert.notEqual(changed.baseline.digest, before.baseline.digest)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

// 승격 가능 여부를 부작용 없이 미리 읽는다 — 승인 버튼을 누른 뒤에야 알면 막다른 길이다.
test('inspectCandidateBase reports READY, STALE, and ALREADY_APPLIED without side effects', () => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-candidate-inspect-'))
  const runId = 'RUN-CHG-20260829-001-apply-019fcf35-48fe-7d93-bb95-3304a2732c01'
  try {
    mkdirSync(join(root, '_workspace', '01_plan'), {recursive: true})
    writeFileSync(join(root, '_workspace', '01_plan', 'spec.md'), 'base\n')
    const session = createCandidateWorkspace(root)
    writeFileSync(join(session.worktreeRoot, '_workspace', '01_plan', 'spec.md'), 'candidate\n')
    finalizeCandidateWorkspace(root, runId, session)
    removeCandidateWorkspace(session)
    assert.equal(inspectCandidateBase(root, runId), 'READY')

    // 다른 변경이 먼저 승격된 상황
    writeFileSync(join(root, '_workspace', '01_plan', 'spec.md'), 'promoted by someone else\n')
    assert.equal(inspectCandidateBase(root, runId), 'STALE')

    // 이 후보가 이미 적용된 상황
    writeFileSync(join(root, '_workspace', '01_plan', 'spec.md'), 'candidate\n')
    assert.equal(inspectCandidateBase(root, runId), 'ALREADY_APPLIED')

    // 없는 실행은 판정하지 않는다(지어내지 않는다)
    assert.equal(inspectCandidateBase(root, 'RUN-CHG-20260829-001-apply-019fcf35-48fe-7d93-bb95-3304a2732c99'), null)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})
