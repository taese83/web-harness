#!/usr/bin/env node
// test-planning-chain.mjs — Phase 1 기획 사슬(product-planner → feature-planner → tech-advisor → plan-reviewer)과 퇴역 이름 검사.
//
// 고정하는 사실:
//   - 기획 사슬 검사는 실제 저장소에서 통과한다
//   - 사슬 순서가 뒤집히거나 product-planner가 산출물 하나를 선언하지 않으면 잡는다
//   - 퇴역 에이전트 이름이 에이전트 문서에 남으면 validate-harness가 막는다
import assert from 'node:assert/strict'
import test from 'node:test'
import {cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {validatePlanningFacilitation} from './validators/validate-planning-facilitation.mjs'

const REPOSITORY = fileURLToPath(new URL('../..', import.meta.url))
const source = path => readFileSync(join(REPOSITORY, path), 'utf8')
const planningFailures = (overrides = {}) => {
  const failures = []
  const read = path => overrides[path] ?? source(path)
  validatePlanningFacilitation({repositoryRoot: REPOSITORY, read, pass: () => {}, fail: message => failures.push(message)})
  return failures
}

test('기획 사슬 검사는 실제 저장소에서 통과한다', () => {
  assert.deepEqual(planningFailures(), [])
})

test('사슬 순서가 뒤집히거나 product-planner가 산출물을 선언하지 않으면 잡는다', () => {
  const plan = source('.claude/skills/web-plan/SKILL.md')
  const swapped = plan.replace('4. `tech-advisor`', '4. `plan-reviewer`를 먼저 부르고 `tech-advisor`')
  assert.notEqual(swapped, plan, 'fixture가 사슬 문장을 찾지 못했다')
  assert.ok(planningFailures({'.claude/skills/web-plan/SKILL.md': swapped}).some(message => /not ordered/.test(message)), '순서 역전을 놓쳤다')

  const planner = source('.claude/agents/product-planner.md')
  const withoutBrief = planner.replaceAll('_workspace/01_plan/ux-brief.md', '_workspace/01_plan/ux.md')
  assert.ok(planningFailures({'.claude/agents/product-planner.md': withoutBrief}).some(message => /does not declare its output ux-brief\.md/.test(message)),
    'ux-brief의 생산자가 사라졌는데 통과했다')
})

test('퇴역 에이전트 이름이 에이전트 문서에 남으면 validate-harness가 막는다', () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-retired-agent-'))
  try {
    // 병렬로 도는 validate-harness의 보안 자체 시험이 저장소 루트에 임시 폴더를 만들고 지운다 — 복사 도중 사라지면 ENOENT다.
    cpSync(REPOSITORY, root, {recursive: true, filter: path => !/\/(?:\.git|node_modules|dist|eval-runs|\.wt-[^/]+|\.security-hardening-package-[^/]+)(?:\/|$)/.test(path.slice(REPOSITORY.length - 1))})
    const target = join(root, '.claude/agents/feature-planner.md')
    writeFileSync(target, `${readFileSync(target, 'utf8')}\n입력 초안은 ux-researcher가 쓴다.\n`)
    const result = spawnSync(process.execPath, ['.claude/scripts/validate-harness.mjs'], {cwd: root, encoding: 'utf8'})
    assert.notEqual(result.status, 0, '퇴역 이름이 남았는데 validate-harness가 통과했다')
    assert.match(`${result.stdout}${result.stderr}`, /legacy agent: ux-researcher/)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})
