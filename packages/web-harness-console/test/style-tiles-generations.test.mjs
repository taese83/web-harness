// 시안 아카이브 2세대 회귀 (2026-08-24 드리프트 수정).
// 고정하는 사실: (1) 자유 렌더 세대(candidates/, index.html만 — tokens.css 없음)를 읽는다,
// (2) 구 타일 세대(style-tiles/)는 tokens.css **완비**가 계속 조건이다(그 세대의 계약), (3) 두 세대가
// 공존하면 신세대가 앞선다, (4) 후보 성립은 index.html 존재로 판정한다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {WorkspaceCatalog} from '../src/indexer.mjs'

const makeProject = build => {
  const root = mkdtempSync(join(tmpdir(), 'wh-tiles-'))
  const project = join(root, 'demo')
  mkdirSync(join(project, '_workspace', '01_plan'), {recursive: true})
  writeFileSync(join(project, '_workspace', '01_plan', 'feature-plan.md'), '# plan\n')
  build(project)
  return {root, project}
}
const tilesOf = root => {
  const catalog = new WorkspaceCatalog(root)
  const project = catalog.list().projects[0]
  return catalog.detail(project.id)
}

test('자유 렌더 세대(candidates/) — index.html만으로 후보 성립(tokens.css 불요)', () => {
  const {root} = makeProject(project => {
    const dir = join(project, '_workspace', '02_design', 'design-system', 'candidates', 'round-1')
    for (const name of ['candidate-a', 'candidate-b']) {
      mkdirSync(join(dir, name), {recursive: true})
      writeFileSync(join(dir, name, 'index.html'), '<!doctype html><title>c</title>')
    }
    writeFileSync(join(dir, 'README.md'), '# 후보\n')
  })
  try {
    const detail = tilesOf(root)
    assert.equal(detail.styleTiles.length, 1)
    const round = detail.styleTiles[0]
    assert.equal(round.base, 'candidates')
    assert.deepEqual(round.candidates, ['candidate-a', 'candidate-b'])
    assert.equal(round.selectedCandidate, null)         // 자유 렌더 라운드엔 마커 규약 없음
    assert.match(round.readmePath, /candidates\/round-1\/README\.md$/)
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('구 타일 세대(style-tiles/) 하위 호환 + SELECTED_CANDIDATE 마커', () => {
  const {root} = makeProject(project => {
    const dir = join(project, '_workspace', '02_design', 'design-system', 'style-tiles', '2026-08-19-x')
    for (const name of ['candidate-a', 'candidate-b']) {
      mkdirSync(join(dir, name), {recursive: true})
      writeFileSync(join(dir, name, 'index.html'), '<!doctype html>')
      writeFileSync(join(dir, name, 'tokens.css'), ':root{}')
    }
    writeFileSync(join(dir, 'RENDER-VERDICT.md'), 'SELECTED_CANDIDATE: candidate-b\n')
  })
  try {
    const round = tilesOf(root).styleTiles[0]
    assert.equal(round.base, 'style-tiles')
    assert.equal(round.selectedCandidate, 'candidate-b')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('두 세대 공존 — 신세대(candidates)가 앞선다 + approvedRender 존재 사실', () => {
  const {root} = makeProject(project => {
    const design = join(project, '_workspace', '02_design')
    for (const [base, roundName] of [['candidates', 'round-1'], ['style-tiles', '2026-08-19-x']]) {
      const dir = join(design, 'design-system', base, roundName, 'candidate-a')
      mkdirSync(dir, {recursive: true})
      writeFileSync(join(dir, 'index.html'), '<!doctype html>')
      // 구세대는 tokens.css 완비가 후보 성립 조건(세대별 계약이 다르다)
      if (base === 'style-tiles') writeFileSync(join(dir, 'tokens.css'), ':root{}')
    }
    writeFileSync(join(design, 'approved-render.html'), '<!doctype html><title>approved</title>')
  })
  try {
    const detail = tilesOf(root)
    assert.equal(detail.styleTiles[0].base, 'candidates')
    assert.equal(detail.styleTiles[1].base, 'style-tiles')
    assert.equal(detail.approvedRender, true)
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('index.html 없는 디렉터리는 후보가 아니다(빈 라운드는 제외)', () => {
  const {root} = makeProject(project => {
    const dir = join(project, '_workspace', '02_design', 'design-system', 'candidates', 'round-1', 'candidate-a')
    mkdirSync(dir, {recursive: true})
    writeFileSync(join(dir, 'notes.md'), 'no render')
  })
  try {
    const detail = tilesOf(root)
    assert.deepEqual(detail.styleTiles, [])
    assert.equal(detail.approvedRender, false)
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('세대별 후보 성립 조건 — 구세대는 tokens.css 완비 요구가 유지된다', () => {
  const {root} = makeProject(project => {
    const dir = join(project, '_workspace', '02_design', 'design-system', 'style-tiles', '2026-08-19-x')
    mkdirSync(join(dir, 'candidate-a'), {recursive: true})
    writeFileSync(join(dir, 'candidate-a', 'index.html'), '<!doctype html>')
    writeFileSync(join(dir, 'candidate-a', 'tokens.css'), ':root{}')
    mkdirSync(join(dir, 'candidate-b'), {recursive: true})   // tokens.css 없음 — 미완
    writeFileSync(join(dir, 'candidate-b', 'index.html'), '<!doctype html>')
  })
  try {
    assert.deepEqual(tilesOf(root).styleTiles[0].candidates, ['candidate-a'])
  } finally { rmSync(root, {recursive: true, force: true}) }
})
