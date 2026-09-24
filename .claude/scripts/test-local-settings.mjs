#!/usr/bin/env node
// test-local-settings.mjs — 저장소를 고치지 않는 개발자 로컬 리뷰 설정.
//
// 고정하는 사실:
//   - 저장소 밖 `~/.claude/web-harness/local.json`에서 **이 프로젝트 절대 경로** 항목만 읽는다
//   - 받는 키는 리뷰어·참고 문서뿐이다 — 다른 키는 버리지 않고 오류로 알린다
//   - 참고 문서는 프로젝트 안의 실파일만 싣고, 밖·절대·없는 경로는 따로 알린다
//   - 리뷰 계획에 팀 선언과 합쳐지되 로컬 출처가 결과에 남는다
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {LOCAL_SETTINGS_RELATIVE, readLocalReviewSettings} from './ticket/local-settings.mjs'
import {reviewPlanOf} from './ticket/ticket-config.mjs'

const withHomeAndProject = run => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-local-settings-')))
  try {
    const home = join(root, 'home')
    const project = join(root, 'project')
    mkdirSync(join(home, '.claude/web-harness'), {recursive: true})
    mkdirSync(join(project, 'docs'), {recursive: true})
    writeFileSync(join(project, 'docs/react.md'), '# React')
    writeFileSync(join(root, 'outside.md'), '# 밖')
    const write = value => writeFileSync(join(home, LOCAL_SETTINGS_RELATIVE), typeof value === 'string' ? value : JSON.stringify(value))
    run({root, home, project, write})
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
}

test('파일이 없거나 이 프로젝트 항목이 없으면 null이다', () => withHomeAndProject(({home, project, write}) => {
  assert.equal(readLocalReviewSettings(project, {home}), null)
  write({projects: {'/other/project': {reviewAgents: ['x']}}})
  assert.equal(readLocalReviewSettings(project, {home}), null, '다른 프로젝트의 설정을 이 프로젝트에 적용했다')
  write({projects: {'.': {reviewAgents: ['x']}}})
  assert.equal(readLocalReviewSettings(project, {home}), null, '상대 경로 키를 실행 위치 기준으로 붙였다')
}))

test('이 프로젝트의 리뷰어·참고 문서를 읽고, 경로 표기(심볼릭 링크)가 달라도 같은 프로젝트로 본다', () => withHomeAndProject(({root, home, project, write}) => {
  const alias = join(root, 'alias')
  symlinkSync(project, alias)
  write({projects: {[alias]: {reviewAgents: ['code-reviewer', ' code-reviewer '], reviewReferences: ['docs/react.md', './docs/react.md']}}})
  const local = readLocalReviewSettings(project, {home})
  assert.deepEqual(local.reviewAgents, ['code-reviewer'])
  assert.deepEqual(local.reviewReferences, ['docs/react.md'], '같은 문서를 다른 표기로 두 번 실었다')
  assert.deepEqual(local.errors, [])
}))

test('받지 않는 키·틀린 형식·프로젝트 밖 참고 문서는 버리지 않고 알린다', () => withHomeAndProject(({home, project, write}) => {
  write({projects: {[project]: {reviewAgents: 'code-reviewer', titlePrefix: '[FE]', reviewReferences: ['../outside.md', '/etc/hosts', 'docs/none.md', 'docs/react.md']}}})
  const local = readLocalReviewSettings(project, {home})
  assert.ok(local.errors.some(error => /titlePrefix/.test(error)), '팀이 같아야 하는 키를 로컬에서 조용히 받았다')
  assert.ok(local.errors.some(error => /reviewAgents는 문자열 배열/.test(error)))
  assert.deepEqual(local.reviewReferences, ['docs/react.md'])
  assert.deepEqual(local.missingReferences, ['../outside.md', '/etc/hosts', 'docs/none.md'], '프로젝트 밖·없는 문서를 리뷰 참고로 실었다')
  write('{ 깨진 json')
  assert.match(readLocalReviewSettings(project, {home}).errors[0], /읽지 못했다/)
}))

test('리뷰 계획: 팀 선언과 로컬 리뷰어를 합치고 로컬 출처를 남긴다 — 로컬이 없으면 모양이 그대로다', () => {
  const config = {provider: 'jira', jira: {reviewAgents: ['a11y-reviewer']}}
  assert.deepEqual(reviewPlanOf(config, {base: 'develop'}), {harness: 'code-reviewer', project: ['a11y-reviewer'], base: 'develop', head: 'HEAD'})
  const local = {path: '/h/.claude/web-harness/local.json', reviewAgents: ['code-reviewer', 'a11y-reviewer'], reviewReferences: ['docs/react.md'], missingReferences: [], errors: []}
  const plan = reviewPlanOf(config, {base: 'develop', local})
  assert.deepEqual(plan.project, ['a11y-reviewer', 'code-reviewer'])
  assert.deepEqual(plan.references, ['docs/react.md'])
  assert.deepEqual(plan.local, {path: local.path, reviewAgents: ['code-reviewer', 'a11y-reviewer']}, '로컬 설정의 출처가 결과에 남지 않았다')
  const broken = reviewPlanOf(null, {local: {...local, missingReferences: ['../x.md'], errors: ['e']}})
  assert.deepEqual([broken.local.missingReferences, broken.local.errors], [['../x.md'], ['e']])
})
