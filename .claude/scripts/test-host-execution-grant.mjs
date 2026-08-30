#!/usr/bin/env node
// test-host-execution-grant.mjs — "한 번 승인하면 다시 묻지 않는다"의 회귀.
//
// quality runner는 생성된 프로젝트의 package script를 사용자 머신에서 실행한다. 처음 한 번
// 묻는 것은 안전 하한이고, **매번** 묻는 것은 의식이다(Gate A·B·C·재시도마다 반복 —
// 2026-08-30 사용자 지적). 여기서 고정하는 것: 승인은 기억되고, 그 기억이 **번지지 않는다.**
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtempSync, readFileSync, realpathSync, rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {evaluateHostExecutionGrant, grantPath, recordHostExecutionGrant} from './host-execution-grant.mjs'

const withProject = fn => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-grant-')))
  try { return fn(root) } finally { rmSync(root, {recursive: true, force: true}) }
}

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

test('기록에 언제·어디서 승인했는지 남는다 — 되돌릴 수 있어야 한다', () => {
  withProject(root => {
    const record = recordHostExecutionGrant(root, {host: 'box-a', now: () => '2026-08-30T00:00:00.000Z'})
    assert.equal(record.projectRoot, root)
    assert.equal(record.host, 'box-a')
    assert.equal(record.grantedAt, '2026-08-30T00:00:00.000Z')
    assert.match(readFileSync(grantPath(root), 'utf8'), /지운다/, '되돌리는 법이 파일 안에 있어야 한다')
  })
})
