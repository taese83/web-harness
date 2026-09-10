#!/usr/bin/env node
// test-entry-points.mjs — 사용자 문서가 내부 스킬을 진입점으로 안내하지 않는다.
//
// 여기서 고정하는 사실:
//   (1) `[내부]` 선언이 분모다 — 스킬 목록을 검사에 적지 않는다(두 곳이 갈라진다)
//   (2) 경로 조각을 슬래시 명령으로 오인하지 않는다 — 실측 오탐 3건을 낸 자리다
//   (3) 분모가 0이면 통과가 아니다
//   (4) 실제 저장소가 통과한다 — 픽스처만으로는 배선을 증명하지 못한다
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {findAdvertisedInternals, internalSkills, validateEntryPoints}
  from './validators/validate-entry-points.mjs'

const scaffold = ({description, readme}) => {
  const root = mkdtempSync(join(tmpdir(), 'wh-entry-'))
  mkdirSync(join(root, '.claude/skills/web-plan'), {recursive: true})
  writeFileSync(join(root, '.claude/skills/web-plan/SKILL.md'),
    `---\nname: web-plan\ndescription: ${description}\n---\n`)
  writeFileSync(join(root, 'README.md'), readme)
  return root
}

test('내부 스킬을 진입점으로 안내하면 잡는다', () => {
  const root = scaffold({description: '[내부] /wh가 호출한다.', readme: '실행: `/web-plan 요청`\n'})
  try {
    assert.deepEqual(internalSkills(root), ['web-plan'])
    const found = findAdvertisedInternals(root, {docs: ['README.md']})
    assert.equal(found.length, 1, '내부 스킬 안내를 놓쳤다')
    assert.equal(found[0].skill, 'web-plan')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('경로 조각을 슬래시 명령으로 오인하지 않는다 — 실측 오탐 3건이 난 자리다', () => {
  const root = scaffold({description: '[내부] /wh가 호출한다.',
    readme: 'receipt는 `golden/web-plan/_workspace/04_qa/t1-summary.json`에 있다\n'})
  try {
    assert.deepEqual(findAdvertisedInternals(root, {docs: ['README.md']}), [],
      '경로 안의 이름을 명령으로 읽으면 정당한 문서를 막는다 — 오탐 있는 검사는 막을 자격이 없다')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('내부가 아닌 스킬 안내는 막지 않는다', () => {
  const root = scaffold({description: 'Web Harness 단일 진입점.', readme: '실행: `/web-plan 요청`\n'})
  try {
    assert.deepEqual(findAdvertisedInternals(root, {docs: ['README.md']}), [])
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('배포 README 생성기의 템플릿 접두도 명령으로 읽는다 — 사용자가 실제로 설치하는 경로다', () => {
  const root = scaffold({description: '[내부] /wh가 호출한다.', readme: 'x\n'})
  try {
    // 생성기는 `${PLUGIN_NAME}:`으로 쓴다 — `web-harness:`만 보면 배포 README가 통째로 빠진다
    // (교차 모델 커밋 리뷰 2026-09-10: 저장소 문서는 고쳤는데 배포 README는 내부 스킬을 게시했다).
    mkdirSync(join(root, '.claude/scripts'), {recursive: true})
    writeFileSync(join(root, '.claude/scripts/build-plugin.mjs'),
      'const t = `| \\`/${PLUGIN_NAME}:web-plan\\` | Produce the plan |`\n')
    const found = findAdvertisedInternals(root, {docs: ['.claude/scripts/build-plugin.mjs']})
    assert.equal(found.length, 1, '배포 README 템플릿의 내부 스킬 안내를 놓쳤다')
    assert.equal(found[0].skill, 'web-plan')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('분모가 0이면 통과가 아니다', () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-entry-empty-'))
  try {
    const calls = {pass: [], fail: []}
    validateEntryPoints({repositoryRoot: root,
      pass: m => calls.pass.push(m), fail: m => calls.fail.push(m)})
    assert.equal(calls.fail.length, 1, '분모 0을 통과로 세면 검사가 공허해진다')
    assert.equal(calls.pass.length, 0)
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('실제 저장소가 통과하고 validate-harness가 이 검사를 부른다', () => {
  const repositoryRoot = new URL('../..', import.meta.url).pathname
  assert.deepEqual(findAdvertisedInternals(repositoryRoot), [],
    '사용자 문서가 내부 스킬을 진입점으로 안내한다')
  const run = spawnSync(process.execPath, ['.claude/scripts/validate-harness.mjs'],
    {cwd: repositoryRoot, encoding: 'utf8'})
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /entry point advertising checked \(\d+ internal skills/,
    '보고에 측정값이 없다 — 호출부가 끊겼거나 고정 문구다')
})
