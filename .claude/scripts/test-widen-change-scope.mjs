#!/usr/bin/env node
// test-widen-change-scope.mjs — 이번 라운드 쓰기 범위를 넓히는 유일한 길을 고정한다.
//   - layerMap 안·범위 밖 경로만 넓힌다(밖이면 스팩 변경이라 거부) · 계획 패스에서는 넓히지 않는다
//   - 미리보기는 쓰기 0, --apply는 새 항목을 끝에 덧붙이고 소유권 훅이 그 경로를 허용한다
//   - 소유권 거부 메시지가 이 명령(layerMap 안) 또는 스팩 변경(밖)을 가리킨다
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {parseChangeScopeAllowedPaths} from './change-scope-lib.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const cli = join(here, 'widen-change-scope.mjs')
const hook = join(here, 'enforce-agent-ownership.mjs')
const spec = {schemaVersion: 2, layerMap: {app: 'apps/user/src/app', pages: 'apps/user/src/pages'}, testLayers: {unit: 'apps/user/src'}}

const withProject = (run, {phase = null} = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'wh-widen-scope-'))
  try {
    mkdirSync(join(root, '_workspace/03_dev'), {recursive: true})
    writeFileSync(join(root, '_workspace/03_dev/spec.json'), JSON.stringify(spec))
    const fence = {ALLOWED_PATHS: ['apps/user/src/pages/home/'], ...(phase ? {PHASE: phase} : {})}
    writeFileSync(join(root, '_workspace/03_dev/change-scope.md'), '# 범위\n\n```json change-scope\n' + JSON.stringify(fence) + '\n```\n')
    return run(root)
  } finally { rmSync(root, {recursive: true, force: true}) }
}
const widen = (root, ...args) => spawnSync(process.execPath, [cli, '--project-root', root, ...args], {encoding: 'utf8'})
const developerEdits = (root, path) => spawnSync(process.execPath, [hook], {encoding: 'utf8', cwd: root,
  env: {...process.env, CLAUDE_PROJECT_DIR: root},
  input: JSON.stringify({tool_name: 'Edit', agent_type: 'developer', cwd: root, tool_input: {file_path: join(root, path)}})})
const TOKENS = 'apps/user/src/app/styles/tokens.css'

test('범위 밖·layerMap 안 파일: 훅이 이 명령을 안내하고, 적용하면 그 파일을 쓸 수 있다', () => {
  withProject(root => {
    const blocked = developerEdits(root, TOKENS)
    assert.equal(blocked.status, 2)
    assert.match(blocked.stderr, /widen-change-scope\.mjs --project-root \. --add apps\/user\/src\/app\/styles\/tokens\.css/)
    const preview = widen(root, '--add', TOKENS, '--reason', '모바일 최대 폭 토큰')
    assert.equal(preview.status, 0, preview.stdout)
    assert.equal(JSON.parse(preview.stdout).action, 'preview')
    assert.deepEqual(parseChangeScopeAllowedPaths(readFileSync(join(root, '_workspace/03_dev/change-scope.md'), 'utf8')).paths, ['apps/user/src/pages/home/'], '미리보기가 썼다')
    const applied = widen(root, '--add', TOKENS, '--reason', '모바일 최대 폭 토큰', '--apply')
    assert.equal(applied.status, 0, applied.stdout)
    const scope = parseChangeScopeAllowedPaths(readFileSync(join(root, '_workspace/03_dev/change-scope.md'), 'utf8'))
    assert.deepEqual(scope.paths, ['apps/user/src/pages/home/', TOKENS])
    assert.match(readFileSync(join(root, '_workspace/03_dev/change-scope.md'), 'utf8'), /사유: 모바일 최대 폭 토큰/)
    assert.equal(developerEdits(root, TOKENS).status, 0, '넓힌 범위를 훅이 허용하지 않았다')
  })
})

test('layerMap 밖은 넓히지 않고 스팩 변경으로 보낸다 — 훅 메시지도 같다', () => {
  withProject(root => {
    const result = widen(root, '--add', 'scripts/deploy.mjs', '--reason', 'x', '--apply')
    assert.equal(result.status, 1)
    assert.equal(JSON.parse(result.stdout).code, 'OUTSIDE_LAYER_MAP')
    assert.match(developerEdits(root, 'scripts/deploy.mjs').stderr, /spec change/)
  })
})

test('계획 패스 범위는 넓히지 않는다 — source는 ✋ 뒤 구현 범위에서 쓴다', () => {
  withProject(root => {
    const result = widen(root, '--add', TOKENS, '--reason', 'x', '--apply')
    assert.equal(result.status, 1)
    assert.equal(JSON.parse(result.stdout).code, 'PLAN_PHASE')
  }, {phase: 'plan'})
})

test('사유 없이는 넓히지 않고, 이미 범위 안이면 할 일 없음', () => {
  withProject(root => {
    assert.equal(JSON.parse(widen(root, '--add', TOKENS).stdout).code, 'REASON_REQUIRED')
    assert.equal(JSON.parse(widen(root, '--add', 'apps/user/src/pages/home/', '--reason', 'x').stdout).action, 'none')
  })
})

test('승인 훅: --apply는 사용자 확인을 묻고 미리보기는 묻지 않는다', () => {
  const approval = join(here, 'enforce-human-approval.mjs')
  const decide = command => spawnSync(process.execPath, [approval], {encoding: 'utf8', input: JSON.stringify({tool_name: 'Bash', tool_input: {command}})}).stdout
  assert.match(decide(`node .claude/scripts/widen-change-scope.mjs --project-root . --add ${TOKENS} --reason x --apply`), /"permissionDecision":"ask"/)
  assert.equal(decide(`node .claude/scripts/widen-change-scope.mjs --project-root . --add ${TOKENS} --reason x`), '')
})
