// 통합 빌드 5단계 회귀 — 권한 감지·라우팅 순수 코어 + runner 권한 게이팅.
//
// 고정하는 사실: (1) viewerPermission → 등급 매핑(write-capable/triage/read, 미지=보수 read),
// (2) parseViewerPermission 파싱·실패 보수 폴백, (3) claimCapability 등급별 모델 라우팅,
// (4) classifyGhError가 403/404/401/미지 분류, (5) runner가 쓰기 불가 등급이면 시도 없이
// 라우팅(blocked+model+guidance), (6) runner가 createIssue 403을 친절한 결과로 전환.
import assert from 'node:assert/strict'
import test from 'node:test'
import {permissionTier, parseViewerPermission, claimCapability, classifyGhError, permissionGuidance} from './ticket/permissions.mjs'
import {claimFeature} from './ticket/runner.mjs'

test('permissionTier: viewerPermission → 등급(미지=보수 read)', () => {
  assert.equal(permissionTier('ADMIN'), 'write')
  assert.equal(permissionTier('write'), 'write') // 대소문자 무관
  assert.equal(permissionTier('MAINTAIN'), 'write')
  assert.equal(permissionTier('TRIAGE'), 'triage')
  assert.equal(permissionTier('READ'), 'read')
  assert.equal(permissionTier('NONE'), 'read')
  assert.equal(permissionTier(undefined), 'read') // 미지 → 보수
})

test('parseViewerPermission: gh 출력 파싱·실패 보수 폴백', () => {
  assert.equal(parseViewerPermission('{"viewerPermission":"WRITE"}'), 'write')
  assert.equal(parseViewerPermission('{not json'), 'read') // 보수
})

test('claimCapability: 등급별 모델 라우팅', () => {
  assert.deepEqual(claimCapability('write'), {canCreateIssue: true, canAssign: true, model: 'lazy-claim'})
  assert.deepEqual(claimCapability('triage'), {canCreateIssue: false, canAssign: true, model: 'lead-emit-self-assign'})
  assert.deepEqual(claimCapability('read'), {canCreateIssue: false, canAssign: false, model: 'fork-lead-driven'})
})

test('classifyGhError: 403/404/401/미지 분류', () => {
  assert.equal(classifyGhError('gh exit 1: HTTP 403: Resource not accessible').kind, 'forbidden')
  assert.equal(classifyGhError('could not resolve to a Repository').kind, 'not-found')
  assert.equal(classifyGhError('HTTP 401: authentication required').kind, 'auth')
  assert.equal(classifyGhError('some other failure').kind, 'unknown')
})

test('permissionGuidance: 등급별 실행 가능 안내', () => {
  assert.match(permissionGuidance('write', 'o/r'), /직접 청구/)
  assert.match(permissionGuidance('triage', 'o/r'), /self-assign/)
  assert.match(permissionGuidance('read', 'o/r'), /fork/)
})

// --- runner 권한 게이팅 ---
const failProvider = {name: 'test', buildFields: (draft, o = {}) => ({title: draft.title, body: draft.body, labels: [], assignee: o.assignee ?? null}), findByFeature(f) { return this.findByLabel('feat:' + f) }, findByLabel: async () => { throw new Error('should not be called') }, createIssue: async () => { throw new Error('should not be called') }}
const forbidProvider = {name: 'test', buildFields: (draft, o = {}) => ({title: draft.title, body: draft.body, labels: [], assignee: o.assignee ?? null}), findByFeature(f) { return this.findByLabel('feat:' + f) }, findByLabel: async () => null, createIssue: async () => { throw new Error('gh exit 1: HTTP 403: Resource not accessible by integration') }, classifyError: classifyGhError}
const ledger = () => ({records: [], append(r){this.records.push(r)}, find(){return null}})
const unit = {featureId: 'FEAT-042', title: 't', body: 'b', testCaseIds: ['TC-042-1']}

test('runner: 쓰기 불가 등급이면 시도 없이 라우팅(blocked+model+guidance)', async () => {
  const r = await claimFeature({unit, provider: failProvider, ledger: ledger(), permission: 'read', repo: 'o/r'})
  assert.equal(r.claimed, false)
  assert.equal(r.blocked, true)
  assert.equal(r.reason, 'insufficient-permission')
  assert.equal(r.model, 'fork-lead-driven')
  assert.match(r.guidance, /fork/)
})

test('runner: 등급 미제공이면 시도(하위 호환) — createIssue 403은 친절한 결과로 전환', async () => {
  const r = await claimFeature({unit, provider: forbidProvider, ledger: ledger(), repo: 'o/r'})
  assert.equal(r.claimed, false)
  assert.equal(r.blocked, true)
  assert.equal(r.reason, 'forbidden')
  assert.match(r.guidance, /403/)
})
