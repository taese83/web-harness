import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import test from 'node:test'

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/design-preview')
const storeModulePath = join(fixtureRoot, 'store.js')

test('sidebar navigation surfaces are mapped to existing feature responsibilities', () => {
  const appSource = readFileSync(join(fixtureRoot, 'app.js'), 'utf8')
  const traceability = JSON.parse(readFileSync(join(fixtureRoot, 'traceability.json'), 'utf8'))
  const anchors = new Map(traceability.anchors.map(anchor => [anchor.anchorId, anchor]))

  const toolSwitch = anchors.get('wh-feat-002-sidebar-tool-switch')
  assert.equal(toolSwitch?.featureId, 'FEAT-002')
  assert.deepEqual(toolSwitch?.testCaseIds, ['TC-002-2', 'TC-002-3'])
  assert.match(appSource, /wh-feat-002-sidebar-tool-switch/)

  const tableEntry = anchors.get('wh-feat-013-sidebar-table-entry')
  assert.equal(tableEntry?.featureId, 'FEAT-013')
  assert.deepEqual(tableEntry?.testCaseIds, ['TC-013-1'])
  assert.match(appSource, /wh-feat-013-sidebar-table-entry/)

  assert.doesNotMatch(appSource, /data-wh-feature[^\n]*(장비 대여 관리|이슈 트래커|버그 리포트)/)
})

test('isolated trace fixture never reads or writes normal localStorage', async t => {
  const previousLocation = globalThis.location
  const previousLocalStorage = globalThis.localStorage
  let reads = 0
  let writes = 0
  globalThis.location = {search: '?whFixture=canonical-seed&whFixtureMode=isolated-reset'}
  globalThis.localStorage = {
    getItem() { reads += 1; return null },
    setItem() { writes += 1 },
  }
  t.after(() => {
    globalThis.location = previousLocation
    globalThis.localStorage = previousLocalStorage
  })

  const source = readFileSync(storeModulePath, 'utf8')
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  const {store} = await import(moduleUrl)
  assert.deepEqual(store.getTraceFixture(), {fixtureId: 'canonical-seed', fixtureMode: 'isolated-reset'})
  assert.equal(store.getTable('table_seed_loan')?.name, '대여 신청')
  store.renameTable('table_seed_loan', '이름 변경 시연')
  store.deleteTable('table_seed_loan', true)
  assert.equal(store.getTable('table_seed_loan'), null)
  store.debugResetToSeed()
  assert.equal(store.getTable('table_seed_loan')?.name, '대여 신청')
  assert.equal(reads, 0)
  assert.equal(writes, 0)
})
