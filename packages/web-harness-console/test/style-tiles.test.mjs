// 발산 시안 아카이브(발산 기계화 §보존) — 콘솔 열람 회귀.
//
// 고정하는 사실: (1) 라운드 디렉터리의 후보(index.html+tokens.css 완비)만 카탈로그에
// 오르고 최신 라운드가 앞이다, (2) 후보 렌더 자산(html/css 사본)은 문서 트리에
// 인덱싱되지 않되 라운드의 README/판정 MD는 인덱싱된다, (3) 프리뷰 서버의
// __style-tiles 경로는 read-only로 타일을 서빙하고 경로 탈출·미지 프로젝트는 404다.
import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {createConsoleServers} from '../server.mjs'
import {WorkspaceCatalog} from '../src/indexer.mjs'

const fixtureRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-console-tiles-'))
  const project = join(root, 'workspace', 'tiles-project')
  const round = join(project, '_workspace', '02_design', 'design-system', 'style-tiles', '2026-08-19-refresh')
  mkdirSync(join(project, '_workspace', '01_plan'), {recursive: true})
  mkdirSync(join(round, 'candidate-a'), {recursive: true})
  mkdirSync(join(round, 'candidate-b'), {recursive: true})
  mkdirSync(join(round, 'not-a-candidate'), {recursive: true})
  writeFileSync(join(project, '_workspace', '01_plan', 'ux-brief.md'), '# UX\n')
  writeFileSync(join(round, 'candidate-a', 'index.html'), '<!doctype html><title>tile a</title>\n')
  writeFileSync(join(round, 'candidate-a', 'tokens.css'), ':root { --st-bg: #111; }\n')
  writeFileSync(join(round, 'candidate-b', 'index.html'), '<!doctype html><title>tile b</title>\n')
  // candidate-b는 tokens.css가 없어 미완 — 후보로 세지 않는다
  writeFileSync(join(round, 'README.md'), '# 발산 후보\n')
  writeFileSync(join(round, 'RENDER-VERDICT.md'), '# 렌더 판정\n\nSELECTED_CANDIDATE: candidate-a\n')
  return {root, project}
}

test('시안 아카이브: 라운드·후보 카탈로그와 문서 인덱싱 경계', t => {
  const fixture = fixtureRoot()
  t.after(() => rmSync(fixture.root, {recursive: true, force: true}))
  const catalog = new WorkspaceCatalog(fixture.root)
  const [project] = catalog.list().projects
  const detail = catalog.detail(project.id)
  assert.equal(detail.styleTiles.length, 1)
  const round = detail.styleTiles[0]
  assert.equal(round.round, '2026-08-19-refresh')
  assert.deepEqual(round.candidates, ['candidate-a'])
  assert.match(round.readmePath, /style-tiles\/2026-08-19-refresh\/README\.md$/)
  assert.match(round.renderVerdictPath, /RENDER-VERDICT\.md$/)
  assert.equal(round.implementationVerdictPath, null)
  // 선정 식별은 판정 기록의 기계 마커가 유일 근거 — 후보 목록 안 값만 인정
  assert.equal(round.selectedCandidate, 'candidate-a')
  // 렌더 자산은 문서 트리 밖, 라운드 MD는 문서 트리 안
  const designPaths = detail.documents.design.map(document => document.path)
  assert.ok(!designPaths.some(path => path.includes('candidate-a')))
  assert.ok(designPaths.some(path => path.endsWith('style-tiles/2026-08-19-refresh/README.md')))
})

test('시안 아카이브: 프리뷰 서버 __style-tiles read-only 서빙과 경계', async t => {
  const fixture = fixtureRoot()
  const servers = createConsoleServers({repositoryRoot: fixture.root, port: 0, previewPort: 0})
  const addresses = await servers.listen()
  t.after(async () => {
    await servers.close()
    rmSync(fixture.root, {recursive: true, force: true})
  })
  const previewOrigin = `http://127.0.0.1:${addresses.previewPort}`
  const consoleOrigin = `http://127.0.0.1:${addresses.consolePort}`
  const projects = await fetch(`${consoleOrigin}/api/projects`).then(response => response.json())
  const projectId = projects.projects[0].id

  const tile = await fetch(`${previewOrigin}/${projectId}/__style-tiles/style-tiles/2026-08-19-refresh/candidate-a/index.html`)
  assert.equal(tile.status, 200)
  assert.match(await tile.text(), /tile a/)
  const tokens = await fetch(`${previewOrigin}/${projectId}/__style-tiles/style-tiles/2026-08-19-refresh/candidate-a/tokens.css`)
  assert.equal(tokens.status, 200)

  const traversal = await fetch(`${previewOrigin}/${projectId}/__style-tiles/..%2F..%2F..%2F01_plan/ux-brief.md`)
  assert.notEqual(traversal.status, 200)
  // 루트를 design-system으로 올린 뒤에도 서빙 표면은 시안 두 세대뿐 — 설계 문서는 열리지 않는다
  const outsideBase = await fetch(`${previewOrigin}/${projectId}/__style-tiles/design-system.md`)
  assert.equal(outsideBase.status, 404)
  const escapeWithinRoot = await fetch(`${previewOrigin}/${projectId}/__style-tiles/style-tiles/..%2F..%2Flayout-spec.md`)
  assert.notEqual(escapeWithinRoot.status, 200)
  const unknownProject = await fetch(`${previewOrigin}/no-such-project/__style-tiles/style-tiles/2026-08-19-refresh/candidate-a/index.html`)
  assert.equal(unknownProject.status, 404)
  const mutation = await fetch(`${previewOrigin}/${projectId}/__style-tiles/style-tiles/2026-08-19-refresh/candidate-a/index.html`, {method: 'POST'})
  assert.equal(mutation.status, 405)
})

test('시안 선정 마커 음성 경로: 부재→null, 후보 목록 밖 값→null (추정 금지)', t => {
  const fixture = fixtureRoot()
  t.after(() => rmSync(fixture.root, {recursive: true, force: true}))
  const tilesRoot = join(fixture.project, '_workspace', '02_design', 'design-system', 'style-tiles')
  // 라운드 2: 판정 기록 자체가 없음 → null
  const bare = join(tilesRoot, '2026-08-20-bare')
  mkdirSync(join(bare, 'candidate-a'), {recursive: true})
  writeFileSync(join(bare, 'candidate-a', 'index.html'), '<!doctype html>\n')
  writeFileSync(join(bare, 'candidate-a', 'tokens.css'), ':root {}\n')
  // 라운드 3: 마커가 후보 목록 밖(미완성 후보 지정) → null — candidates.includes 방어선 회귀
  const rogue = join(tilesRoot, '2026-08-21-rogue')
  mkdirSync(join(rogue, 'candidate-a'), {recursive: true})
  writeFileSync(join(rogue, 'candidate-a', 'index.html'), '<!doctype html>\n')
  writeFileSync(join(rogue, 'candidate-a', 'tokens.css'), ':root {}\n')
  writeFileSync(join(rogue, 'RENDER-VERDICT.md'), 'SELECTED_CANDIDATE: candidate-zz\n')
  const catalog = new WorkspaceCatalog(fixture.root)
  const [project] = catalog.list().projects
  const rounds = catalog.detail(project.id).styleTiles
  assert.equal(rounds.find(r => r.round === '2026-08-20-bare').selectedCandidate, null)
  assert.equal(rounds.find(r => r.round === '2026-08-21-rogue').selectedCandidate, null)
})
