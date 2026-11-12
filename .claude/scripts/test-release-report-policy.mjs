#!/usr/bin/env node
// test-release-report-policy.mjs — data-access QA 요구의 경로 모델 회귀.
//
// 여기서 고정하는 사실:
//   (1) migration 디렉터리가 없으면 data-access 리포트를 요구하지 않는다 — 프론트 전용 앱을 막지 않는다
//   (2) 루트 `migrations/`와 **1단계 하위** `client/migrations/` 둘 다 요구를 발화시킨다 —
//       `/server-db-migration`이 `client/migrations/`를 기존 관습으로 문서화하므로 루트만 보면
//       하네스가 스스로 권장한 관습을 따른 프로젝트가 조용히 빠진다 (2026-08-27 적대 검토 지적)
//   (3) `node_modules/**/migrations/`는 발화시키지 않는다 — 의존성이 게이트를 켜면 안 된다
//   (4) 분할된 설계 산출물(`performance-budget/` 등 디렉터리)도 그 QA 보고서를 요구한다
//   (5) 은퇴한 모드의 선언·설계 산출물은 QA를 요구하지 않고 알림으로 드러난다 — 템플릿·false는 선언이 아니다
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {releaseReportRequirements, retiredModeDeclarations} from './release-report-policy.mjs'

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
  releaseReportRequirements(root, PROFILE, 'final').some(([id]) => id === 'data-access')

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

const requiresSeo = root => releaseReportRequirements(root, PROFILE, 'final').some(([id]) => id === 'seo')

test('공개 노출 선언만 있어도 qa-seo를 요구한다 — seo-spec 생산이 빠져도 조용히 사라지지 않는다', () => {
  withProject(['_workspace/01_plan'], root => {
    assert.equal(requiresSeo(root), false)
    writeFileSync(join(root, '_workspace/01_plan/tech-stack.md'), '## Harness Profile\n- PUBLIC_EXPOSURE: yes — 검색 유입\n')
    assert.equal(requiresSeo(root), true)
    writeFileSync(join(root, '_workspace/01_plan/tech-stack.md'), '## Harness Profile\n- PUBLIC_EXPOSURE: no\n')
    assert.equal(requiresSeo(root), false)
    writeFileSync(join(root, '_workspace/01_plan/tech-stack.md'), '- PUBLIC_EXPOSURE: yes | no — 미기입 템플릿\n')
    assert.equal(requiresSeo(root), false, '자리표시자는 선언이 아니다')
    writeFileSync(join(root, '_workspace/01_plan/tech-stack.md'), '- **PUBLIC_EXPOSURE**: **yes**\n')
    assert.equal(requiresSeo(root), true, '굵은 표기도 선언이다')
    writeFileSync(join(root, '_workspace/01_plan/tech-stack.md'), '- PUBLIC_EXPOSURE: yes\n| Component | Choice |\n')
    assert.equal(requiresSeo(root), true, '다음 줄의 표 행은 자리표시자가 아니다')
  })
})

test('분할된 tech-stack/ 디렉터리의 선언도 읽는다', () => {
  withProject(['_workspace/01_plan/tech-stack'], root => {
    writeFileSync(join(root, '_workspace/01_plan/tech-stack/INDEX.md'), '# index\n')
    writeFileSync(join(root, '_workspace/01_plan/tech-stack/harness-profile.md'), '- PUBLIC_EXPOSURE: yes\n')
    assert.equal(requiresSeo(root), true)
  })
})

test('분할된 설계 산출물(디렉터리)도 그 QA 보고서를 요구한다 — 분할이 검증 요구를 지우지 않는다', () => {
  withProject(['_workspace/02_design/seo-spec', '_workspace/02_design/performance-budget'], root => {
    writeFileSync(join(root, '_workspace/02_design/seo-spec/routes.md'), '# SEO\n')
    writeFileSync(join(root, '_workspace/02_design/performance-budget/web-vitals.md'), '# Budget\n')
    const ids = releaseReportRequirements(root, PROFILE, 'final').map(([id]) => id)
    assert.ok(ids.includes('seo'), `분할한 seo-spec이 qa-seo 요구를 지웠다: ${ids.join(', ')}`)
    assert.ok(ids.includes('performance'), `분할한 performance-budget이 qa-perf 요구를 지웠다: ${ids.join(', ')}`)
  })
})

test('은퇴한 모드 선언은 템플릿·false를 선언으로 읽지 않는다', () => {
  withProject(['_workspace/01_plan'], root => {
    const requirements = join(root, '_workspace/01_plan/requirements.md')
    writeFileSync(requirements, '## Modes\n- LOCAL_DOMAIN_STATE_MODE: true — 브라우저 저장소가 정본\n')
    assert.equal(retiredModeDeclarations(root).length, 1)
    for (const template of ['true/false', 'true | false', 'false — API가 정본']) {
      writeFileSync(requirements, `## Modes\n- LOCAL_DOMAIN_STATE_MODE: ${template}\n`)
      assert.deepEqual(retiredModeDeclarations(root), [], `선언하지 않은 모드(${template})를 알렸다 — false·템플릿은 선언이 아니다`)
    }
  })
})

test('분할된 requirements/ 디렉터리의 모드 선언도 읽는다', () => {
  withProject(['_workspace/01_plan/requirements'], root => {
    writeFileSync(join(root, '_workspace/01_plan/requirements/INDEX.md'), '# index\n')
    writeFileSync(join(root, '_workspace/01_plan/requirements/modes.md'), '- **EXTERNAL_DATA_INGESTION_MODE**: **true**\n')
    assert.ok(retiredModeDeclarations(root).some(notice => notice.startsWith('EXTERNAL_DATA_INGESTION_MODE')))
  })
})

test('은퇴한 모드 선언·설계 산출물은 QA를 요구하지 않고 알림으로 드러낸다', () => {
  withProject(['_workspace/01_plan', '_workspace/02_design'], root => {
    assert.deepEqual(retiredModeDeclarations(root), [])
    writeFileSync(join(root, '_workspace/01_plan/requirements.md'), '## Modes\n- TIMESERIES_MODE: true\n- ANALYTICS_BUILDER_MODE: true/false\n')
    writeFileSync(join(root, '_workspace/02_design/analytics-architecture.md'), '# Analytics\n')
    mkdirSync(join(root, '_workspace/02_design/state-contract'))
    writeFileSync(join(root, '_workspace/02_design/ingestion-contract.md'), '# Ingestion\n')
    const notices = retiredModeDeclarations(root)
    assert.equal(notices.length, 4, notices.join(' | '))
    rmSync(join(root, '_workspace/02_design/ingestion-contract.md'))
    writeFileSync(join(root, '_workspace/02_design/runtime-data-contract.json'), '{}\n')
    assert.equal(retiredModeDeclarations(root).length, 4, '남은 runtime-data-contract.json만으로도 수집 모드 알림이 나야 한다')
    for (const mode of ['TIMESERIES_MODE', 'ANALYTICS_BUILDER_MODE', 'LOCAL_DOMAIN_STATE_MODE', 'EXTERNAL_DATA_INGESTION_MODE']) {
      assert.ok(notices.some(notice => notice.startsWith(mode)), `${mode} 알림이 없다: ${notices.join(' | ')}`)
    }
    const ids = releaseReportRequirements(root, PROFILE, 'final').map(([id]) => id)
    for (const id of ['timeseries', 'analytics', 'state', 'data-quality']) assert.ok(!ids.includes(id), ids.join(', '))
  })
})
