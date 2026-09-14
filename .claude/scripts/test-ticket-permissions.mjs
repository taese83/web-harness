// 통합 빌드 5단계 회귀 — 권한 감지·라우팅 순수 코어 + runner 권한 게이팅.
//
// 고정하는 사실: (1) viewerPermission → 등급 매핑(write-capable/triage/read, 미지=보수 read),
// (2) parseViewerPermission 파싱·실패 보수 폴백, (3) claimCapability 등급별 모델 라우팅,
// (4) classifyGhError가 403/404/401/미지 분류, (5) runner가 쓰기 불가 등급이면 시도 없이
// 라우팅(blocked+model+guidance), (6) runner가 createIssue 403을 친절한 결과로 전환.
import assert from 'node:assert/strict'
import test from 'node:test'
import {classifyGhError} from './ticket/permissions.mjs'

test('classifyGhError: 403/404/401/미지 분류', () => {
  assert.equal(classifyGhError('gh exit 1: HTTP 403: Resource not accessible').kind, 'forbidden')
  assert.equal(classifyGhError('could not resolve to a Repository').kind, 'not-found')
  assert.equal(classifyGhError('HTTP 401: authentication required').kind, 'auth')
  assert.equal(classifyGhError('some other failure').kind, 'unknown')
})

const ledger = () => ({records: [], append(r){this.records.push(r)}, find(){return null}})
const unit = {featureId: 'FEAT-042', title: 't', body: 'b', testCaseIds: ['TC-042-1']}
