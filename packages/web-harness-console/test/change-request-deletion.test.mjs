import assert from 'node:assert/strict'
import {existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {deleteChangeRequestArtifacts} from '../src/change-request-deletion.mjs'

const TARGET_ID = 'CHG-20260807-001'
const OTHER_ID = 'CHG-20260807-002'
const TARGET_RUN = `RUN-${TARGET_ID}-apply-019fcf35-48fe-7d93-bb95-3304a2732950`
const OTHER_RUN = `RUN-${OTHER_ID}-impact-019fcf35-48fe-7d93-bb95-3304a2732951`

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-change-delete-'))
  const plan = join(root, '_workspace', '01_plan')
  const development = join(root, '_workspace', '03_dev')
  const requests = join(plan, 'change-requests')
  const revisions = join(plan, 'change-request-revisions')
  const runs = join(development, 'codex-runs')
  const decisions = join(development, 'change-request-decisions')
  const candidates = join(development, 'change-candidates')
  for (const directory of [requests, revisions, runs, decisions, candidates]) mkdirSync(directory, {recursive: true})
  writeFileSync(join(requests, `${TARGET_ID}.md`), 'target request\n')
  writeFileSync(join(requests, `${OTHER_ID}.md`), 'other request\n')
  writeFileSync(join(revisions, `${TARGET_ID}-REV-001.md`), 'target revision\n')
  writeFileSync(join(revisions, `${OTHER_ID}-REV-001.md`), 'other revision\n')
  writeFileSync(join(runs, `${TARGET_RUN}.jsonl`), '{}\n')
  writeFileSync(join(runs, `${OTHER_RUN}.jsonl`), '{}\n')
  writeFileSync(join(decisions, `${TARGET_ID}.jsonl`), '{}\n')
  writeFileSync(join(decisions, `${OTHER_ID}.jsonl`), '{}\n')
  mkdirSync(join(candidates, TARGET_RUN))
  mkdirSync(join(candidates, OTHER_RUN))
  writeFileSync(join(candidates, TARGET_RUN, 'manifest.json'), '{}\n')
  writeFileSync(join(candidates, OTHER_RUN, 'manifest.json'), '{}\n')
  return {root, plan, requests, revisions, runs, decisions, candidates}
}

test('physical deletion removes every artifact owned by one Change Request and preserves others', t => {
  const paths = fixture()
  t.after(() => rmSync(paths.root, {recursive: true, force: true}))

  const result = deleteChangeRequestArtifacts(paths.root, TARGET_ID)

  assert.deepEqual(result, {deleted: true, artifactCount: 5})
  assert.equal(existsSync(join(paths.requests, `${TARGET_ID}.md`)), false)
  assert.equal(existsSync(join(paths.revisions, `${TARGET_ID}-REV-001.md`)), false)
  assert.equal(existsSync(join(paths.runs, `${TARGET_RUN}.jsonl`)), false)
  assert.equal(existsSync(join(paths.decisions, `${TARGET_ID}.jsonl`)), false)
  assert.equal(existsSync(join(paths.candidates, TARGET_RUN)), false)
  assert.equal(existsSync(join(paths.requests, `${OTHER_ID}.md`)), true)
  assert.equal(existsSync(join(paths.revisions, `${OTHER_ID}-REV-001.md`)), true)
  assert.equal(existsSync(join(paths.runs, `${OTHER_RUN}.jsonl`)), true)
  assert.equal(existsSync(join(paths.decisions, `${OTHER_ID}.jsonl`)), true)
  assert.equal(existsSync(join(paths.candidates, OTHER_RUN)), true)
  assert.equal(readdirSync(paths.plan).some(name => name.startsWith('.change-request-delete-')), false)
})

test('physical deletion is idempotent when the base request is already absent', t => {
  const paths = fixture()
  t.after(() => rmSync(paths.root, {recursive: true, force: true}))
  rmSync(join(paths.requests, `${TARGET_ID}.md`))

  assert.deepEqual(deleteChangeRequestArtifacts(paths.root, TARGET_ID), {deleted: false, artifactCount: 0})
  assert.equal(existsSync(join(paths.revisions, `${TARGET_ID}-REV-001.md`)), true)
})

test('physical deletion rolls staged artifacts back when a move fails', t => {
  const paths = fixture()
  t.after(() => rmSync(paths.root, {recursive: true, force: true}))

  assert.throws(() => deleteChangeRequestArtifacts(paths.root, TARGET_ID, {
    beforeMove: (_path, index) => { if (index === 2) throw new Error('injected move failure') },
  }), error => error.code === 'CHANGE_REQUEST_DELETE_FAILED')

  assert.equal(existsSync(join(paths.requests, `${TARGET_ID}.md`)), true)
  assert.equal(existsSync(join(paths.revisions, `${TARGET_ID}-REV-001.md`)), true)
  assert.equal(existsSync(join(paths.runs, `${TARGET_RUN}.jsonl`)), true)
  assert.equal(existsSync(join(paths.decisions, `${TARGET_ID}.jsonl`)), true)
  assert.equal(existsSync(join(paths.candidates, TARGET_RUN)), true)
  assert.equal(readdirSync(paths.plan).some(name => name.startsWith('.change-request-delete-')), false)
})

test('physical deletion rejects a matching symlink without moving the base request', t => {
  const paths = fixture()
  const outside = join(paths.root, 'outside')
  mkdirSync(outside)
  t.after(() => rmSync(paths.root, {recursive: true, force: true}))
  rmSync(join(paths.candidates, TARGET_RUN), {recursive: true})
  symlinkSync(outside, join(paths.candidates, TARGET_RUN))

  assert.throws(() => deleteChangeRequestArtifacts(paths.root, TARGET_ID), error => error.code === 'CHANGE_REQUEST_DELETE_UNSAFE')
  assert.equal(existsSync(join(paths.requests, `${TARGET_ID}.md`)), true)
})
