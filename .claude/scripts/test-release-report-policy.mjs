#!/usr/bin/env node
// test-release-report-policy.mjs — data-access QA 요구의 경로 모델 회귀.
//
// 여기서 고정하는 사실:
//   (1) migration 디렉터리가 없으면 data-access 리포트를 요구하지 않는다 — 프론트 전용 앱을 막지 않는다
//   (2) 루트 `migrations/`와 **1단계 하위** `client/migrations/` 둘 다 요구를 발화시킨다 —
//       `/server-db-migration`이 `client/migrations/`를 기존 관습으로 문서화하므로 루트만 보면
//       하네스가 스스로 권장한 관습을 따른 프로젝트가 조용히 빠진다 (2026-08-27 적대 검토 지적)
//   (3) `node_modules/**/migrations/`는 발화시키지 않는다 — 의존성이 게이트를 켜면 안 된다
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {releaseReportRequirements} from './release-report-policy.mjs'

const PROFILE = {adapter: {id: 'react-vite-spa'}}

const withProject = (directories, run) => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-report-policy-'))
  try {
    for (const directory of directories) mkdirSync(join(root, directory), {recursive: true})
    run(root)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
}

const requiresDataAccess = root =>
  releaseReportRequirements(root, PROFILE, 'final', false).some(([id]) => id === 'data-access')

test('migration 디렉터리가 없으면 data-access를 요구하지 않는다', () => {
  withProject(['src'], root => assert.equal(requiresDataAccess(root), false))
})

test('루트 migrations/는 data-access를 요구한다', () => {
  withProject(['migrations'], root => assert.equal(requiresDataAccess(root), true))
})

test('client/migrations/(문서화된 기존 관습)도 data-access를 요구한다', () => {
  withProject(['client/migrations'], root => assert.equal(requiresDataAccess(root), true))
})

test('node_modules 안의 migrations/는 게이트를 켜지 않는다', () => {
  withProject(['node_modules/some-pkg/migrations'], root => assert.equal(requiresDataAccess(root), false))
})
