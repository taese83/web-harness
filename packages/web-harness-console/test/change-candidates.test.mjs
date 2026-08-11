import assert from 'node:assert/strict'
import {existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {
  beginCandidatePromotion,
  createCandidateWorkspace,
  finalizeCandidateWorkspace,
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
