// Minimal committed fixture for the isolated-reset contract used by preview mapping.
const STORAGE_KEY = 'web-harness-console:test-preview-state'

function seedState() {
  return {
    tables: [{id: 'table_seed_loan', name: '대여 신청'}],
  }
}

const search = globalThis.location?.search ?? ''
const params = new URLSearchParams(search)
const fixtureId = params.get('whFixture')
const fixtureMode = params.get('whFixtureMode')
const isolated = fixtureId === 'canonical-seed' && fixtureMode === 'isolated-reset'

function loadState() {
  if (isolated) return seedState()
  const persisted = globalThis.localStorage?.getItem(STORAGE_KEY)
  return persisted ? JSON.parse(persisted) : seedState()
}

let state = loadState()

function persist() {
  if (isolated) return
  globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state))
}

export const store = {
  getTraceFixture() {
    return isolated ? {fixtureId, fixtureMode} : null
  },

  getTable(tableId) {
    return state.tables.find(table => table.id === tableId) ?? null
  },

  renameTable(tableId, name) {
    const table = this.getTable(tableId)
    if (!table) return false
    table.name = name
    persist()
    return true
  },

  deleteTable(tableId) {
    state.tables = state.tables.filter(table => table.id !== tableId)
    persist()
  },

  debugResetToSeed() {
    state = seedState()
    persist()
  },
}
