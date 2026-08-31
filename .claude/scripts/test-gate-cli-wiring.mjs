#!/usr/bin/env node
// test-gate-cli-wiring.mjs — 오늘 만든 게이트 셋의 **CLI 배선** 회귀.
//
// 이 저장소가 §4에 세 번 등록한 클래스: *배선을 시험하는 회귀가 없으면 배선은 조용히 끊긴다.*
// 순수 함수에는 회귀가 촘촘한데 `main()`은 아무도 안 부르니 죽어도 모른다. 배선 감사가
// main 가드 19개 중 프로세스 테스트가 5개뿐임을 실측했고, 그중 가장 검증이 얕은 것이
// **오늘 만든 것들**이다 — 여기서 실제로 실행해본다.
//
// 고정하는 사실: 종료 코드 · 판정이 stdout에 나오는가 · `--json`이 기계 판독 가능한가 ·
// 사용법 오류가 조용히 통과하지 않는가.
import assert from 'node:assert/strict'
import test from 'node:test'
import {execFileSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'

const script = name => fileURLToPath(new URL(`./${name}`, import.meta.url))
const HANDOFF = script('validate-handoff-readiness.mjs')
const READINESS = script('validate-development-readiness.mjs')
const WIRING = script('validate-wiring-coverage.mjs')

const run = (path, args, cwd = process.cwd()) => {
  try {
    return {code: 0, out: execFileSync(process.execPath, [path, ...args], {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']})}
  } catch (error) {
    return {code: error.status ?? 1, out: `${error.stdout ?? ''}${error.stderr ?? ''}`}
  }
}

// 구멍이 하나도 없는 최소 프로젝트. 여기서 READY가 안 나오면 배선이 끊긴 것이다.
const withCleanProject = fn => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-cli-wiring-')))
  try {
    mkdirSync(join(root, '_workspace/01_plan/feature-plan'), {recursive: true})
    mkdirSync(join(root, '_workspace/02_design'), {recursive: true})
    mkdirSync(join(root, '_workspace/03_dev'), {recursive: true})
    mkdirSync(join(root, '_workspace/01_plan/ux-brief'), {recursive: true})
    writeFileSync(join(root, '_workspace/01_plan/feature-plan/a.md'), [
      '## FEAT-001 첫째',
      '<!-- web-harness:unit feat=FEAT-001 dependsOn=none paths=src/entities -->',
      '- TC-001-1 기대',
    ].join('\n'))
    writeFileSync(join(root, '_workspace/01_plan/ux-brief/a.md'), '## 화면별 정보 위계\n표\n\n## 디자인 방향\n방향\n')
    writeFileSync(join(root, '_workspace/02_design/solution-design.md'), [
      '```json web-harness:solution-design',
      JSON.stringify({targetShapes: ['web-app'], layerMap: {domain: 'src/entities'}, openDecisions: []}),
      '```',
    ].join('\n'))
    writeFileSync(join(root, '_workspace/03_dev/spec.json'), JSON.stringify({
      specTier: 'verifiable', targetShapes: ['web-app'],
      layerMap: {domain: 'src/entities'}, testLayers: {unit: 'src'},
      libraries: {}, constitution: {substrate: {}}, moduleBoundaries: [],
    }))
    return fn(root)
  } finally { rmSync(root, {recursive: true, force: true}) }
}

// ── 인계 판정 CLI ───────────────────────────────────────────────────────────
test('배선: 인계 판정이 깨끗한 프로젝트에 READY와 exit 0을 낸다', () => {
  withCleanProject(root => {
    const result = run(HANDOFF, ['--project', root, '--to', 'design'])
    assert.equal(result.code, 0, result.out)
    assert.match(result.out, /READY/)
  })
})

test('배선: 구멍이 있으면 exit 1과 HOLES를 낸다 — 실패가 조용하지 않다', () => {
  withCleanProject(root => {
    // 선언을 지우면 plan 축이 구멍이 된다.
    writeFileSync(join(root, '_workspace/01_plan/feature-plan/a.md'), '## FEAT-001 첫째\n- TC-001-1 기대')
    const result = run(HANDOFF, ['--project', root, '--to', 'design'])
    assert.equal(result.code, 1, result.out)
    assert.match(result.out, /HOLES/)
  })
})

test('배선: --json이 기계 판독 가능한 판정을 낸다', () => {
  withCleanProject(root => {
    const result = run(HANDOFF, ['--project', root, '--to', 'design', '--json'])
    const report = JSON.parse(result.out)
    assert.equal(report.verdict, 'READY')
    assert.ok(Array.isArray(report.results) && report.results.length > 0)
  })
})

test('배선: 알 수 없는 인계 대상은 사용법 오류다 — 조용히 기본값으로 빠지지 않는다', () => {
  withCleanProject(root => {
    const result = run(HANDOFF, ['--project', root, '--to', 'nowhere'])
    assert.equal(result.code, 2, result.out)
  })
})

// ── 개발 착수 관문 CLI ──────────────────────────────────────────────────────
test('배선: 착수 관문이 스팩 없는 프로젝트를 exit 1로 막는다', () => {
  withCleanProject(root => {
    rmSync(join(root, '_workspace/03_dev/spec.json'))
    const result = run(READINESS, ['--project', root])
    assert.equal(result.code, 1, result.out)
    assert.match(result.out, /BLOCKED/)
    assert.match(result.out, /spec\.json/)
  })
})

test('배선: 착수 관문의 --json에 검사 축과 실패가 함께 실린다', () => {
  withCleanProject(root => {
    rmSync(join(root, '_workspace/03_dev/spec.json'))
    const report = JSON.parse(run(READINESS, ['--project', root, '--json']).out)
    assert.equal(report.verdict, 'BLOCKED')
    assert.ok(report.failures.some(item => item.id === 'spec'))
    // 스팩에 의존하는 축은 **통과가 아니라 미수행**이어야 한다.
    assert.ok(report.results.some(item => item.id === 'ownership' && item.state === 'SKIPPED'))
  })
})

test('배선: --project 없이는 사용법 오류다', () => {
  const result = run(READINESS, ['--json'])
  assert.equal(result.code, 2, result.out)
})

// ── 배선 감사 자신 ──────────────────────────────────────────────────────────
// 이 검사도 main 가드를 가지므로 스스로의 규율을 적용받는다.
test('배선: 배선 감사가 스스로를 프로세스로 실행할 수 있다', () => {
  const report = JSON.parse(run(WIRING, ['--json']).out)
  assert.ok(report.totalWithMain > 0)
  assert.ok(Array.isArray(report.unwired))
  assert.ok(Array.isArray(report.newUnwired), 'baseline 대비 신규가 분리돼 나와야 한다')
})
