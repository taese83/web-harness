#!/usr/bin/env node
// test-artifact-sharding.mjs — 소비자 열 검사의 언어 중립 구조 식별 + FAIL 승격 회귀 (M1 ③).
//
// 왜 이 테스트가 있나: 이전 구현은 헤더 행을 한국어 문자열(`주 소비자`)로 식별해, 영어 헤더
// INDEX에서 헤더가 값으로 읽혀 경고가 났다(telemetry-viewer 파일럿 실측 — `Primary consumer`
// is not a known agent). 번역이 검사를 조용히 열화시키는 마커 락인이었다. 여기서 고정하는 사실:
//   (1) 절 행은 구조(2열 백틱 절 파일)로 식별된다 — 한국어/영어 헤더 모두 동일 판정(번역 불변)
//   (2) 미상 에이전트·빈 소비자 칸·절 행 0건은 warning이 아니라 **위반(exit 1)**이다
//   (3) 괄호 한정어·괄호 안 쉼표(파일럿 실측 지배 패턴)는 오탐을 내지 않는다
//   (4) INDEX 안의 다른 4열 표는 소비자 검사 대상이 아니다
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'

const script = resolve(import.meta.dirname, 'validate-artifact-sharding.mjs')

// 픽스처 프로젝트를 만들고 validator CLI를 실행한다. 임시 디렉터리는 하니스 저장소 밖이므로
// CLAUDE_PROJECT_DIR로 세션 프로젝트 경계를 지정한다(플러그인 모드와 같은 경로).
const runOn = files => {
  const root = mkdtempSync(join(tmpdir(), 'sharding-fixture-'))
  for (const [relativePath, content] of Object.entries(files)) {
    const path = join(root, relativePath)
    mkdirSync(join(path, '..'), {recursive: true})
    writeFileSync(path, content)
  }
  const result = spawnSync(process.execPath, [script, '--project', root, '--json'], {
    encoding: 'utf8',
    env: {...process.env, CLAUDE_PROJECT_DIR: root},
  })
  rmSync(root, {recursive: true, force: true})
  const parsed = result.stdout ? JSON.parse(result.stdout) : {errors: [], warnings: []}
  return {status: result.status, ...parsed}
}

const section = '# 절\n\n내용.\n'

test('한국어 INDEX: 알려진 에이전트 + 전체 sentinel → 통과', () => {
  const run = runOn({
    '_workspace/02_design/api-schema/INDEX.md':
      '# API — 서비스\n\n## 절 목록\n' +
      '| 절 | 파일 | 담당 범위 | 주 소비자 |\n|---|---|---|---|\n' +
      '| 공통 | `common.md` | 응답 형식 | 전체 |\n' +
      '| 주문 | `orders.md` | 주문 API | entity-query-builder, mock-api-builder |\n',
    '_workspace/02_design/api-schema/common.md': section,
    '_workspace/02_design/api-schema/orders.md': section,
  })
  assert.equal(run.status, 0)
  assert.deepEqual(run.errors, [])
})

test('영어 INDEX(번역 불변의 요점): Primary consumer 헤더 + * sentinel → 동일하게 통과', () => {
  const run = runOn({
    '_workspace/02_design/api-schema/INDEX.md':
      '# API — Service\n\n## Sections\n' +
      '| Section | File | Scope | Primary consumer |\n|---|---|---|---|\n' +
      '| Common | `common.md` | envelope | * |\n' +
      '| Orders | `orders.md` | orders API | entity-query-builder |\n',
    '_workspace/02_design/api-schema/common.md': section,
    '_workspace/02_design/api-schema/orders.md': section,
  })
  assert.equal(run.status, 0)
  assert.deepEqual(run.errors, [])
  // 이전 구현의 실측 결함: 영어 헤더가 값으로 읽혀 "Primary consumer is not a known agent"
  assert.deepEqual(run.warnings, [])
})

test('미상 에이전트 이름 → warning이 아니라 위반(exit 1)', () => {
  const run = runOn({
    '_workspace/02_design/api-schema/INDEX.md':
      '| 절 | 파일 | 담당 범위 | 주 소비자 |\n|---|---|---|---|\n' +
      '| 주문 | `orders.md` | 주문 | e2e-test-writer |\n',
    '_workspace/02_design/api-schema/orders.md': section,
  })
  assert.equal(run.status, 1)
  assert.equal(run.errors.filter(message => message.includes('e2e-test-writer')).length, 1)
})

test('빈 소비자 칸 → 위반 (이전에는 조용히 건너뜀 — 계약 "비워 두지 않는다" 미강제)', () => {
  const run = runOn({
    '_workspace/02_design/api-schema/INDEX.md':
      '| 절 | 파일 | 담당 범위 | 주 소비자 |\n|---|---|---|---|\n' +
      '| 주문 | `orders.md` | 주문 |  |\n',
    '_workspace/02_design/api-schema/orders.md': section,
  })
  assert.equal(run.status, 1)
  assert.equal(run.errors.filter(message => message.includes('empty consumer column')).length, 1)
})

test('괄호 한정어·괄호 안 쉼표(파일럿 실측 패턴) → 오탐 없음', () => {
  const run = runOn({
    '_workspace/02_design/component-spec/INDEX.md':
      '| 절 | 파일 | 담당 범위 | 주 소비자 |\n|---|---|---|---|\n' +
      '| 공유 | `shared.md` | shared/ui | component-builder (shared layer) |\n' +
      '| 상위 | `upper.md` | widgets | component-builder(widgets/*, pages/*) |\n' +
      '| 조건 | `cond.md` | 조건부 | entity-query-builder(해당 시) |\n',
    '_workspace/02_design/component-spec/shared.md': section,
    '_workspace/02_design/component-spec/upper.md': section,
    '_workspace/02_design/component-spec/cond.md': section,
  })
  assert.equal(run.status, 0)
  assert.deepEqual(run.errors, [])
})

test('INDEX 안의 다른 4열 표(2열에 절 파일 없음)는 소비자 검사 대상이 아니다', () => {
  const run = runOn({
    '_workspace/02_design/component-spec/INDEX.md':
      '| 절 | 파일 | 담당 범위 | 주 소비자 |\n|---|---|---|---|\n' +
      '| 공유 | `shared.md` | shared/ui | 전체 |\n\n' +
      '## 결정 기록\n' +
      '| 결정 | 근거 | 승인 | Directed by |\n|---|---|---|---|\n' +
      '| 토큰 | 브랜드 | 사용자 | This task\'s explicit brief instruction |\n',
    '_workspace/02_design/component-spec/shared.md': section,
  })
  assert.equal(run.status, 0)
  assert.deepEqual(run.errors, [])
})

test('절 파일은 있는데 절 행이 0건(형식 이탈) → vacuous pass가 아니라 파일별 위반', () => {
  const run = runOn({
    '_workspace/02_design/api-schema/INDEX.md':
      '# API\n\n절 목록을 표 없이 산문으로만 나열: common.md, orders.md\n',
    '_workspace/02_design/api-schema/common.md': section,
    '_workspace/02_design/api-schema/orders.md': section,
  })
  assert.equal(run.status, 1)
  assert.equal(run.errors.filter(message => message.includes('not covered by a 4-column section row')).length, 2)
})

test('단일 행 백틱 생략(리뷰 HIGH 우회): 그 행만 검사를 벗어나는 게 아니라 커버리지 위반이다', () => {
  // 평문 등재 검사(substring)는 통과하지만, 백틱 절 행이 아니므로 소비자 검사가 건너뛰어진다 —
  // 커버리지 검사가 이 부분 이탈을 파일 단위로 잡는지 고정한다.
  const run = runOn({
    '_workspace/02_design/api-schema/INDEX.md':
      '| 절 | 파일 | 담당 범위 | 주 소비자 |\n|---|---|---|---|\n' +
      '| 공통 | `common.md` | 응답 형식 | 전체 |\n' +
      '| 주문 | orders.md | 주문 API |  |\n', // 백틱 없음 + 빈 소비자 칸 — 이전엔 조용히 통과
    '_workspace/02_design/api-schema/common.md': section,
    '_workspace/02_design/api-schema/orders.md': section,
  })
  assert.equal(run.status, 1)
  assert.equal(run.errors.filter(message => message.includes('orders.md') && message.includes('not covered')).length, 1)
})

test('5열 표의 절 행: 4열 형식 오매칭이 아니라 커버리지 위반으로 loud하게 잡힌다', () => {
  const run = runOn({
    '_workspace/02_design/api-schema/INDEX.md':
      '| 절 | 파일 | 담당 범위 | 주 소비자 | 비고 |\n|---|---|---|---|---|\n' +
      '| 주문 | `orders.md` | 주문 API | entity-query-builder | 메모 |\n',
    '_workspace/02_design/api-schema/orders.md': section,
  })
  assert.equal(run.status, 1)
  assert.equal(run.errors.filter(message => message.includes('orders.md') && message.includes('not covered')).length, 1)
})

// ── project-brief 축소-전용 예외 (search-portal 파일럿 실측 결함: 계약은 분할 금지·레지스트리는
//    flat-only인데 섹션 트리거가 "split required"를 내 기계끼리 모순됐다) ──

const manySections = Array.from({length: 11}, (_, i) => `## 절 ${i + 1}\n\n내용.\n`).join('\n')

test('project-brief: 섹션 11개여도 예산 내면 통과 — 분할 금지 문서에 섹션 트리거 미적용', () => {
  const run = runOn({
    '_workspace/01_plan/project-brief.md': `# Brief\n\n${manySections}`,
  })
  assert.equal(run.status, 0)
  assert.deepEqual(run.errors, [])
})

test('project-brief: 20KB 초과는 여전히 위반 — 단 시정 지시는 분할이 아니라 축소', () => {
  const run = runOn({
    '_workspace/01_plan/project-brief.md': `# Brief\n\n${'본문 채움 '.repeat(2200)}`,
  })
  assert.equal(run.status, 1)
  assert.equal(run.errors.filter(message => message.includes('shrink the body')).length, 1)
  assert.equal(run.errors.filter(message => message.includes('split required')).length, 0)
})

test('일반 flat 산출물의 섹션 트리거는 그대로 — 예외는 project-brief에만 좁게 적용', () => {
  const run = runOn({
    '_workspace/01_plan/requirements.md': `# Req\n\n${manySections}`,
  })
  assert.equal(run.status, 1)
  assert.equal(run.errors.filter(message => message.includes('split required')).length, 1)
})
