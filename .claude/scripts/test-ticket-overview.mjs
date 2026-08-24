// 통합 빌드 증분 2 회귀 — feature-plan 파서·크로스-브랜치 리더·오버뷰 조립.
//
// 고정: (1) parseFeaturePlanUnits가 FEAT 헤딩 섹션만 unit으로(발명 없음)·자기 번호 TC만
// 수집(오귀속 차단)·중복 헤딩은 병합하지 않음(하류 loud-fail 보존), (2) showFileArgs/
// readBranchFile이 체크아웃 없이 읽고 부재는 null, (3) discoverBranchRegistry가 라벨-마커
// union + 소스 태그 + 불일치 노출(리뷰 조건), (4) buildBranchCard 상태 분포·병목 역집계·
// 소실 브랜치 표기.
import assert from 'node:assert/strict'
import test from 'node:test'
import {parseFeaturePlanUnits} from './ticket/plan-units.mjs'
import {showFileArgs, readBranchFile} from './ticket/git-origin.mjs'
import {discoverBranchRegistry, buildBranchCard} from './ticket/overview.mjs'
import {buildIssueFields, parseBranchFromLabels} from './ticket/provider-github.mjs'
import {buildTicketDraft, unitContentHash, computeEmitPlan} from './ticket/emit.mjs'
import {ledgerState} from './ticket/ledger.mjs'

const PLAN = `# 모터 대시보드 계획

## 개요
전체 설명. TC-999-1 같은 규격 밖 언급은 어떤 unit에도 안 붙는다.

### FEAT-001 — 모터 상세
모터 선택 시 상세 표시.
- TC-001-1 상세 렌더
- TC-001-2 미선택 빈 상태

#### 참고
FEAT-002의 TC-002-1을 언급해도 FEAT-001 unit에는 미수집(자기 번호만).

### FEAT-002: 주행 기록
기록 목록.
- TC-002-1 목록 표시
`

test('parseFeaturePlanUnits: FEAT 섹션만·자기 번호 TC만·제목 구분자 처리', () => {
  const units = parseFeaturePlanUnits(PLAN)
  assert.deepEqual(units.map(u => u.featureId), ['FEAT-001', 'FEAT-002'])
  const [f1, f2] = units
  assert.equal(f1.title, '모터 상세')
  assert.deepEqual(f1.testCaseIds, ['TC-001-1', 'TC-001-2']) // 타 FEAT TC 미수집
  assert.equal(f2.title, '주행 기록')                          // ':' 구분자
  assert.deepEqual(f2.testCaseIds, ['TC-002-1'])
  assert.ok(unitContentHash(f1).length === 64)                 // 청구 형상 해시 입력으로 안전
  assert.deepEqual(parseFeaturePlanUnits(''), [])
  // 다른 FEAT를 사이에 둔 같은 ID 재등장 → 병합하지 않고 두 unit(하류 DUPLICATE loud-fail 보존)
  const dup = parseFeaturePlanUnits('### FEAT-003 a\n\n### FEAT-004 x\n\n### FEAT-003 b')
  assert.equal(dup.filter(u => u.featureId === 'FEAT-003').length, 2)
  // 서브피처 헤딩(FEAT-NNN-NN)은 unit이 아님 — 부모 ID 절단·제목 오염 오수집 방지(리뷰 지적)
  const sub = parseFeaturePlanUnits('### FEAT-001-01 — 서브피처\n본문 TC-001-1')
  assert.deepEqual(sub, [])
  // 같은 FEAT ID의 섹션 내 소제목 헤딩("FEAT-012 Sub Features")은 흡수 — 별도 unit 아님
  // (실측: search-portal 샤드에서 중복 3건). 소제목 아래 TC도 같은 unit에 귀속.
  const absorbed = parseFeaturePlanUnits('### FEAT-012 — 실패 처리\n본문 TC-012-1\n\n#### FEAT-012 Sub Features\n- TC-012-2')
  assert.equal(absorbed.length, 1)
  assert.deepEqual(absorbed[0].testCaseIds, ['TC-012-1', 'TC-012-2'])
})

test('EMPTY_UNITS_CLOSE_ALL: unit 0개 + 열린 청구 → loud fail(전 티켓 닫기 방지, 리뷰 HIGH)', () => {
  const ledger = ledgerState([{schemaVersion: 1, featureId: 'FEAT-001', ticketKey: '5', contentHash: 'h', createdAt: 't'}])
  // 표 형식 계획(헤딩 없음) → 파서 0 unit → emit이 close-all 대신 loud
  assert.throws(() => computeEmitPlan(parseFeaturePlanUnits('| FEAT ID | 기능 |\n| FEAT-001 | 모터 |'), ledger), /EMPTY_UNITS_CLOSE_ALL/)
  // 원장이 비었으면(초기 상태) 빈 units는 정상(닫을 게 없음)
  assert.deepEqual(computeEmitPlan([], ledgerState([])).close, [])
})

test('readBranchFile: 체크아웃 없이 타 브랜치 파일, 부재는 null', async () => {
  assert.deepEqual(showFileArgs('origin/feat/x', 'p/plan.md'), ['show', 'origin/feat/x:p/plan.md'])
  const content = await readBranchFile({repoRoot: '.', branch: 'feat/x', path: 'p', exec: async args => {
    assert.deepEqual(args, ['show', 'origin/feat/x:p'])
    return {code: 0, out: '# plan'}
  }})
  assert.equal(content, '# plan')
  assert.equal(await readBranchFile({repoRoot: '.', branch: 'gone', path: 'p', exec: async () => { throw new Error('missing') }}), null)
})

test('discoverBranchRegistry: 라벨-마커 union + 소스 태그 + 불일치 노출(리뷰 조건)', () => {
  const draft = buildTicketDraft({featureId: 'FEAT-001', title: 't', body: 'b', testCaseIds: ['TC-001-1']})
  const stamped = buildIssueFields(draft, {branch: 'feature/dash'})
  const issues = [
    {number: 1, body: stamped.body, labels: stamped.labels},                        // 마커+라벨 일치
    {number: 2, body: '<!-- web-harness:refs feat=FEAT-002 tc=TC-002-1 branch=feature/long -->', labels: []}, // 마커만(라벨 생략 케이스)
    {number: 3, body: '구세대 이슈(스탬프 없음)', labels: ['branch:feature/old']},   // 라벨만(구세대/수동)
    {number: 4, body: '<!-- web-harness:refs feat=FEAT-003 tc=TC-003-1 branch=feature/a -->', labels: ['branch:feature/b']}, // 불일치
  ]
  const reg = discoverBranchRegistry(issues, {labelBranchOf: issue => parseBranchFromLabels(issue.labels)})
  const byBranch = Object.fromEntries(reg.branches.map(b => [b.branch, b]))
  assert.deepEqual(byBranch['feature/dash'].sources, ['label', 'marker'])  // union·양소스
  assert.deepEqual(byBranch['feature/long'].sources, ['marker'])          // 라벨 없어도 등록(부분집합 갭 해소)
  assert.deepEqual(byBranch['feature/old'].sources, ['label'])            // 라벨만도 등록(정직 태그)
  assert.deepEqual(reg.mismatches, [{issueNumber: 4, markerBranch: 'feature/a', labelBranch: 'feature/b'}])
})

test('buildBranchCard: 상태 분포·병목 역집계·소실 브랜치', () => {
  const units = [
    {featureId: 'FEAT-000', title: '공유 인프라', layer: 'foundation', body: 'z', testCaseIds: ['TC-000-1']},
    {featureId: 'FEAT-001', title: '모터 상세', body: 'x', testCaseIds: ['TC-001-1'], paths: ['src/features/motor/']},
    {featureId: 'FEAT-002', title: '설정', body: 'y', testCaseIds: ['TC-002-1'], dependsOn: ['FEAT-001'], paths: ['src/features/settings/']},
    {featureId: 'FEAT-003', title: '알림', body: 'w', testCaseIds: ['TC-003-1'], dependsOn: ['FEAT-001'], paths: ['src/features/alerts/']},
  ]
  const card = buildBranchCard({
    branch: 'feature/dash',
    units,
    ledgerState: ledgerState([]),
    issuesByFeature: new Map([['FEAT-001', {number: 2, assignees: ['dev-a']}]]),
    developer: 'me',
    planTitle: '모터 대시보드',
    foundationRoots: ['src/shared/'],
    foundationComplete: true,
  })
  assert.equal(card.title, '모터 대시보드') // 계획 H1은 주입(첫 FEAT 제목으로 발명 안 함)
  assert.equal(card.counts['in-progress'], 1)   // FEAT-001 남이 진행
  assert.equal(card.counts.blocked, 2)          // 002·003 의존 미충족
  assert.deepEqual(card.bottlenecks, [{featureId: 'FEAT-001', blocking: 2}]) // 병목 역집계
  assert.equal(card.exists, true)
  // 청구는 있는데 origin에 브랜치 없음 → 소실 표기(§4-1)
  assert.equal(buildBranchCard({branch: 'gone', units: [], exists: false}).exists, false)
  // 중복 featureId units → 조용한 이중 계산 대신 loud(오버뷰 경로는 emit loud-fail 미경유, 리뷰 지적)
  assert.throws(() => buildBranchCard({branch: 'b', units: [{featureId: 'FEAT-009'}, {featureId: 'FEAT-009'}]}), /DUPLICATE_FEATURE_ID/)
})
