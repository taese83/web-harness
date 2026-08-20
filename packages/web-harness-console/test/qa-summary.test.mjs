// QA 탭(단계 탭 2단계) — 읽기 전용 파생 뷰 회귀.
//
// 고정하는 사실: (1) receipt는 04_qa/evidence/*.json의 표기를 그대로 나르고 손상
// JSON은 제외한다(지어내지 않음), (2) qa-*.md의 "## Result" 첫 토큰만 상태로 읽고
// 미표기는 null이다, (3) 구현 테스트 스캔은 같은-ID TC 토큰의 "발견 사실"만 기록하며
// node_modules/_workspace 등 제외 디렉터리는 걷지 않는다, (4) 04_qa가 없으면
// exists:false로 정직 보고한다.
import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {WorkspaceCatalog} from '../src/indexer.mjs'

const fixtureRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-console-qa-'))
  const project = join(root, 'workspace', 'qa-project')
  const qa = join(project, '_workspace', '04_qa')
  mkdirSync(join(project, '_workspace', '01_plan'), {recursive: true})
  mkdirSync(join(qa, 'evidence'), {recursive: true})
  mkdirSync(join(project, 'src'), {recursive: true})
  mkdirSync(join(project, 'node_modules', 'dep'), {recursive: true})
  writeFileSync(join(project, '_workspace', '01_plan', 'ux-brief.md'), '# UX\n')
  writeFileSync(join(qa, 'evidence', 'test.json'), JSON.stringify({
    id: 'test',
    command: 'pnpm run test',
    status: 'PASS',
    exitCode: 0,
    startedAt: '2026-08-20T00:38:42.730Z',
    durationMs: 4793,
    qualityCohortId: 'cohort-1',
    sourceFingerprint: 'abcdef0123456789',
  }))
  writeFileSync(join(qa, 'evidence', 'broken.json'), '{not json')
  writeFileSync(join(qa, 'qa-test.md'), '## Result\nWARN\n\n본문\n')
  writeFileSync(join(qa, 'qa-ux.md'), '# 결과 표기 없음\n')
  writeFileSync(join(project, 'src', 'sample.test.ts'), '// TC-001-1 성공 경로\n// TC-001-1 재확인\n// TC-002-3 실패 경로\n')
  writeFileSync(join(project, 'node_modules', 'dep', 'skip.test.ts'), '// TC-999-9 제외 대상\n')
  return {root, project}
}

test('QA 요약: receipt·리포트·구현 테스트 스캔의 정직 경계', t => {
  const fixture = fixtureRoot()
  t.after(() => rmSync(fixture.root, {recursive: true, force: true}))
  const catalog = new WorkspaceCatalog(fixture.root)
  const [project] = catalog.list().projects
  const detail = catalog.detail(project.id)
  assert.equal(detail.qa.exists, true)
  // 손상 JSON은 제외 — 유효 receipt 1건만, 표기 그대로
  assert.equal(detail.qa.receipts.length, 1)
  const receipt = detail.qa.receipts[0]
  assert.equal(receipt.check, 'test')
  assert.equal(receipt.status, 'PASS')
  assert.equal(receipt.exitCode, 0)
  assert.equal(receipt.sourceFingerprint, 'abcdef012345')
  // Result 첫 토큰만 상태로, 미표기는 null
  assert.deepEqual(detail.qa.reports.map(report => [report.name, report.status]), [
    ['qa-test.md', 'WARN'],
    ['qa-ux.md', null],
  ])
  // 같은-ID 토큰 발견 사실(파일 중복 없이), 제외 디렉터리는 걷지 않음
  assert.deepEqual(detail.qa.implementedTestCases['TC-001-1'], ['src/sample.test.ts'])
  assert.deepEqual(detail.qa.implementedTestCases['TC-002-3'], ['src/sample.test.ts'])
  assert.equal(detail.qa.implementedTestCases['TC-999-9'], undefined)
})

test('QA 요약: 04_qa 부재는 exists:false로 정직 보고', t => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-console-qa-none-'))
  t.after(() => rmSync(root, {recursive: true, force: true}))
  const project = join(root, 'workspace', 'bare-project')
  mkdirSync(join(project, '_workspace', '01_plan'), {recursive: true})
  writeFileSync(join(project, '_workspace', '01_plan', 'ux-brief.md'), '# UX\n')
  const catalog = new WorkspaceCatalog(root)
  const [entry] = catalog.list().projects
  const detail = catalog.detail(entry.id)
  assert.equal(detail.qa.exists, false)
  assert.deepEqual(detail.qa.receipts, [])
  assert.deepEqual(detail.qa.reports, [])
})
