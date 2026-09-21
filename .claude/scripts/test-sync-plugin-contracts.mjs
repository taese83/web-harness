#!/usr/bin/env node
// test-sync-plugin-contracts.mjs — 배포본에서 계약 문서가 읽히는지 고정한다.
//
// 배포본의 문서 참조는 `_workspace/.contracts/`를 가리킨다(build-plugin). 사본이 없거나 낡으면 서브에이전트가
// 지시받은 계약을 못 읽고, 플러그인 문서 루트를 막으면 메인 스레드도 스킬의 상대 참조를 못 읽는다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {CONTRACTS_DIR, syncContracts} from './sync-plugin-contracts.mjs'
import {evaluateSensitiveAccess} from './sensitive-access-policy-lib.mjs'
import {listSourceFiles} from './evidence-lib.mjs'

const here = dirname(fileURLToPath(import.meta.url))

const withPayload = (run, {name = 'web-harness'} = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-contracts-'))
  try {
    const payload = join(root, 'payload')
    const project = join(root, 'project')
    mkdirSync(join(payload, '.claude-plugin'), {recursive: true})
    writeFileSync(join(payload, '.claude-plugin/plugin.json'), JSON.stringify({name, version: '9.9.9'}))
    mkdirSync(join(payload, 'skills/web-orchestrator/references'), {recursive: true})
    writeFileSync(join(payload, 'skills/web-orchestrator/references/reentry-map.md'), 'reentry\n')
    mkdirSync(join(payload, 'schemas'))
    writeFileSync(join(payload, 'schemas/spec.schema.json'), '{}\n')
    mkdirSync(join(payload, '.claude/scripts'), {recursive: true})
    writeFileSync(join(payload, '.claude/scripts/gate.mjs'), '// gate internals\n')
    mkdirSync(join(project, '_workspace'), {recursive: true})
    return run({payload, project})
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
}

test('플러그인이면 문서 루트를 사본으로 옮기고 자기 .gitignore를 둔다', () => {
  withPayload(({payload, project}) => {
    const result = syncContracts({projectRoot: project, payloadRoot: payload})
    assert.equal(result.state, 'synced')
    assert.equal(result.version, '9.9.9')
    assert.ok(existsSync(join(project, CONTRACTS_DIR, 'skills/web-orchestrator/references/reentry-map.md')))
    assert.ok(existsSync(join(project, CONTRACTS_DIR, 'schemas/spec.schema.json')))
    assert.equal(readFileSync(join(project, CONTRACTS_DIR, '.gitignore'), 'utf8'), '*\n')
    assert.ok(!existsSync(join(project, CONTRACTS_DIR, '.claude')), '스크립트 폴더는 계약이 아니다')
  })
})

test('payload가 같으면 다시 쓰지 않고, 바뀌면 통째로 바꿔 낡은 파일을 남기지 않는다', () => {
  withPayload(({payload, project}) => {
    syncContracts({projectRoot: project, payloadRoot: payload})
    assert.equal(syncContracts({projectRoot: project, payloadRoot: payload}).state, 'unchanged')
    rmSync(join(payload, 'schemas/spec.schema.json'))
    writeFileSync(join(payload, 'schemas/new.schema.json'), '{}\n')
    assert.equal(syncContracts({projectRoot: project, payloadRoot: payload}).state, 'synced')
    assert.ok(!existsSync(join(project, CONTRACTS_DIR, 'schemas/spec.schema.json')), '옛 판본 파일이 남으면 없는 계약을 읽는다')
    assert.ok(existsSync(join(project, CONTRACTS_DIR, 'schemas/new.schema.json')))
    assert.deepEqual(readdirSync(join(project, '_workspace')), ['.contracts'], '임시·퇴역 폴더가 남지 않는다')
  })
})

test('web-harness 플러그인이 아니면 아무것도 쓰지 않는다', () => {
  withPayload(({payload, project}) => {
    assert.equal(syncContracts({projectRoot: project, payloadRoot: payload}).state, 'not-plugin')
    assert.ok(!existsSync(join(project, CONTRACTS_DIR)))
  }, {name: 'consumer-plugin'})
  withPayload(({payload}) => {
    assert.equal(syncContracts({projectRoot: payload, payloadRoot: payload}).state, 'not-plugin', '소스 checkout 자신에는 사본을 만들지 않는다')
  })
})

const readDecision = (payload, project, file) => evaluateSensitiveAccess(
  {tool_name: 'Read', tool_input: {file_path: file}, cwd: project}, {CLAUDE_PROJECT_DIR: project}, {payloadRoot: payload})

test('회귀 반증: 플러그인 문서 루트는 읽히고, 스크립트 폴더는 여전히 막힌다', () => {
  withPayload(({payload, project}) => {
    assert.equal(readDecision(payload, project, join(payload, 'skills/web-orchestrator/references/reentry-map.md')).allowed, true,
      '막으면 메인 스레드가 스킬의 상대 참조 계약을 못 읽는다')
    assert.equal(readDecision(payload, project, join(payload, '.claude/scripts/gate.mjs')).code, 'DENY_PATH_OUTSIDE')
    writeFileSync(join(payload, 'skills/.env'), 'TOKEN=x\n')
    assert.equal(readDecision(payload, project, join(payload, 'skills/.env')).code, 'DENY_SECRET_PATH', '연 루트 안에서도 비밀은 막는다')
  })
  withPayload(({payload, project}) => {
    assert.equal(readDecision(payload, project, join(payload, 'skills/web-orchestrator/references/reentry-map.md')).code, 'DENY_PATH_OUTSIDE',
      'web-harness가 아닌 매니페스트로 루트를 열지 않는다')
  }, {name: 'consumer-plugin'})
})

test('세션 시작 훅이 사본을 맞추고 재진입 안내를 사본 경로로 가리킨다', () => {
  withPayload(({payload, project}) => {
    for (const script of ['detect-harness-project.mjs', 'sync-plugin-contracts.mjs', 'harness-version.mjs']) {
      copyFileSync(join(here, script), join(payload, '.claude/scripts', script))
    }
    const result = spawnSync(process.execPath, [join(payload, '.claude/scripts/detect-harness-project.mjs')],
      {env: {...process.env, CLAUDE_PROJECT_DIR: project}, encoding: 'utf8'})
    assert.equal(result.status, 0)
    assert.ok(existsSync(join(project, CONTRACTS_DIR, 'skills/web-orchestrator/references/reentry-map.md')))
    assert.match(result.stdout, /_workspace\/\.contracts\/skills\/web-orchestrator\/references\/reentry-map\.md/)
  })
})

test('회귀 반증: 사본을 손으로 고치면 다음 동기화가 되돌린다', () => {
  withPayload(({payload, project}) => {
    syncContracts({projectRoot: project, payloadRoot: payload})
    const copy = join(project, CONTRACTS_DIR, 'skills/web-orchestrator/references/reentry-map.md')
    writeFileSync(copy, 'poisoned\n')
    assert.equal(syncContracts({projectRoot: project, payloadRoot: payload}).state, 'synced')
    assert.equal(readFileSync(copy, 'utf8'), 'reentry\n', '고친 계약이 남으면 이후 서브에이전트가 그것을 읽는다')
  })
})

test('회귀 반증: 계약 사본과 동기화 임시 폴더는 소스 지문에 들어가지 않는다', () => {
  withPayload(({payload, project}) => {
    writeFileSync(join(project, 'index.ts'), 'export {}\n')
    const before = listSourceFiles(project)
    syncContracts({projectRoot: project, payloadRoot: payload})
    mkdirSync(join(project, '_workspace/.contracts.tmp-1-1'))
    writeFileSync(join(project, '_workspace/.contracts.tmp-1-1/x.md'), 'x\n')
    assert.deepEqual(listSourceFiles(project), before, '들어가면 플러그인 버전마다 QA receipt가 stale이 된다')
  })
})

test('복사가 실패하면 임시 폴더를 남기지 않고 옛 사본을 지킨다', {skip: process.getuid?.() === 0}, () => {
  withPayload(({payload, project}) => {
    syncContracts({projectRoot: project, payloadRoot: payload})
    const locked = join(payload, 'schemas/locked.json')
    writeFileSync(locked, '{}\n')
    chmodSync(locked, 0o000)
    try {
      assert.throws(() => syncContracts({projectRoot: project, payloadRoot: payload}))
    } finally {
      chmodSync(locked, 0o644)
    }
    assert.deepEqual(readdirSync(join(project, '_workspace')), ['.contracts'])
    assert.ok(existsSync(join(project, CONTRACTS_DIR, 'skills/web-orchestrator/references/reentry-map.md')))
  })
})
