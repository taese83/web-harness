#!/usr/bin/env node
// test-falsification-depth.mjs — 반증 안에서 반증을 도는 재귀를 막는 판정(순수).
//
// **러너를 스폰하지 않는다.** 이 판정을 끄는 seed를 러너 스폰 테스트로 결박하면, 그 seed가 적용된
// 사본의 러너가 재귀를 막지 못해 seed 자체가 폭주한다. 실측(2026-09-11): 락 seed 하나로 53분 ·
// 약 130층까지 내려갔다. 배선(러너 CLI가 이 판정을 부르는가)은 `test-falsification-lock.mjs`의
// 「재귀를 막는다」 프로세스 회귀가 무변형 기준 실행에서 잰다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {MAX_NESTED_DEPTH, refusesNestedRun} from './validate-falsification.mjs'

test('깊이 0·1은 돈다 — 락 회귀가 부른 러너는 락으로 거부해야 하므로 깊이로 막지 않는다', () => {
  assert.equal(refusesNestedRun(0), false)
  assert.equal(refusesNestedRun(1), false, '깊이 1을 막으면 락 회귀가 락이 아니라 깊이 때문에 통과한다')
})

test('깊이 2 이상은 거부한다 — 모든 층이 변형을 싣고 가는 재귀를 끊는다', () => {
  assert.equal(MAX_NESTED_DEPTH, 2)
  assert.equal(refusesNestedRun(2), true)
  assert.equal(refusesNestedRun(7), true)
})
