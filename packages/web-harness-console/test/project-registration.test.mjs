// 브라운필드 관측 등록 회귀 (2026-08-24).
// 고정하는 사실: (1) 서버 기동·스캔은 아무것도 쓰지 않는다, (2) 후보는 프로젝트 0건일 때만
// 계산되고 마커(.git/package.json) 실측으로만 판별한다, (3) 등록은 후보 화이트리스트 안에서만
// 되고 임의 경로·경로 탈출은 거부한다, (4) 문서는 **복사하지 않고** 경로 선언(sources.json)으로
// 제자리 인덱싱되며 원본이 정본이다, (5) 선언 경로가 프로젝트 밖이면 인덱싱하지 않는다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {WorkspaceCatalog} from '../src/indexer.mjs'

const makeRoot = build => {
  const root = mkdtempSync(join(tmpdir(), 'wh-register-'))
  build(root)
  return root
}
const service = (root, name, {docs = true} = {}) => {
  const dir = join(root, name)
  mkdirSync(dir, {recursive: true})
  writeFileSync(join(dir, 'package.json'), '{"name":"svc"}')
  if (docs) {
    writeFileSync(join(dir, 'README.md'), '# 서비스 개요\n원본 문서입니다.\n')
    mkdirSync(join(dir, 'docs'), {recursive: true})
    writeFileSync(join(dir, 'docs', 'architecture.md'), '# 아키텍처\n')
  }
  return dir
}

test('스캔은 아무것도 쓰지 않는다 + 후보는 마커 실측으로만 판별', () => {
  const root = makeRoot(base => { service(base, 'legacy-svc'); mkdirSync(join(base, 'not-a-project')) })
  try {
    const catalog = new WorkspaceCatalog(root)
    const listed = catalog.list()
    assert.deepEqual(listed.projects, [])                               // _workspace 없음 → 프로젝트 0
    assert.equal(existsSync(join(root, 'legacy-svc', '_workspace')), false) // 기동은 쓰지 않는다
    assert.deepEqual(listed.candidates.map(c => c.path), ['legacy-svc'])   // 마커 없는 디렉터리는 후보 아님
    assert.equal(listed.candidates[0].existingDocs, 2)                  // README + docs/architecture
    assert.equal(typeof listed.scanRoot, 'string')                      // 실행 위치를 화면이 말할 수 있게
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('등록: _workspace/00_source + sources.json(경로 선언) — 문서 복사 없음', () => {
  const root = makeRoot(base => service(base, 'legacy-svc'))
  try {
    const catalog = new WorkspaceCatalog(root)
    const result = catalog.registerProject('legacy-svc')
    assert.equal(result.registered, true)
    assert.equal(result.declaredDocs, 2)
    const sourceRoot = join(root, 'legacy-svc', '_workspace', '00_source')
    const declared = JSON.parse(readFileSync(join(sourceRoot, 'sources.json'), 'utf8'))
    assert.deepEqual(declared, {schemaVersion: 1, paths: ['README.md', 'docs/architecture.md']})
    // 복사본이 생기지 않았다 — 원본이 정본(정본 이원화 금지)
    assert.equal(existsSync(join(sourceRoot, 'README.md')), false)
    // 등록 직후 문서가 Source에서 보인다(제자리 인덱싱)
    const detail = catalog.detail(result.projectId)
    assert.deepEqual(detail.documents.source.map(d => d.path).sort(), ['README.md', 'docs/architecture.md'])
    assert.equal(detail.documents.source.find(d => d.path === 'README.md').title, '서비스 개요')
    assert.equal(detail.documents.source.every(d => d.declared === true), true)
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('등록 거부: 후보 화이트리스트 밖·경로 탈출·이미 등록됨', () => {
  const root = makeRoot(base => service(base, 'legacy-svc'))
  try {
    const catalog = new WorkspaceCatalog(root)
    assert.equal(catalog.registerProject('../outside').error, 'PROJECT_NOT_A_CANDIDATE')
    assert.equal(catalog.registerProject('/etc').error, 'PROJECT_NOT_A_CANDIDATE')
    assert.equal(catalog.registerProject('no-such-dir').error, 'PROJECT_NOT_A_CANDIDATE')
    assert.equal(catalog.registerProject(null).error, 'INVALID_PROJECT_PATH')
    catalog.registerProject('legacy-svc')
    // 이미 _workspace가 있으면 후보가 아니다 → 재등록이 조용히 덮어쓰지 않는다
    assert.equal(catalog.registerProject('legacy-svc').error, 'PROJECT_NOT_A_CANDIDATE')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('선언 경로 경계: 프로젝트 밖·심볼릭 링크·미존재는 인덱싱하지 않는다', () => {
  const root = makeRoot(base => {
    const dir = service(base, 'legacy-svc', {docs: false})
    writeFileSync(join(base, 'secret.md'), '# 밖의 문서\n')
    mkdirSync(join(dir, '_workspace', '00_source'), {recursive: true})
    writeFileSync(join(dir, '_workspace', '00_source', 'sources.json'),
      JSON.stringify({schemaVersion: 1, paths: ['../secret.md', 'missing.md', 'README.md']}))
    writeFileSync(join(dir, 'README.md'), '# 안의 문서\n')
  })
  try {
    const catalog = new WorkspaceCatalog(root)
    const project = catalog.list().projects[0]
    const detail = catalog.detail(project.id)
    assert.deepEqual(detail.documents.source.map(d => d.path), ['README.md']) // 밖·미존재 제외
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('프로젝트가 하나라도 있으면 후보를 계산하지 않는다(정상 상태 노이즈 금지)', () => {
  const root = makeRoot(base => {
    const dir = service(base, 'registered', {docs: false})
    mkdirSync(join(dir, '_workspace', '01_plan'), {recursive: true})
    service(base, 'unregistered', {docs: false})
  })
  try {
    const listed = new WorkspaceCatalog(root).list()
    assert.equal(listed.projects.length, 1)
    assert.deepEqual(listed.candidates, [])
  } finally { rmSync(root, {recursive: true, force: true}) }
})
