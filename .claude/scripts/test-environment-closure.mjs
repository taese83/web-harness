// environment closure 게이트 회귀 — 계약(scaffolder §82·§87·§109·§124)이 기계로 대조되는지.
import assert from 'node:assert/strict'
import test from 'node:test'
import {analyzeEnvironmentClosure, REQUIRED_SCRIPTS, WEB_APP_SCRIPTS} from './validate-environment-closure.mjs'

const full = () => ({
  scripts: Object.fromEntries([...REQUIRED_SCRIPTS, ...WEB_APP_SCRIPTS].map(name => [name, 'echo run'])),
  devDependencies: {eslint: '9.0.0'},
})
const entries = ['package.json', 'eslint.config.js']

test('완비된 환경은 누락 0건', () => {
  assert.deepEqual(analyzeEnvironmentClosure({packageJson: full(), entries}), [])
})

test('scaffolder가 빠뜨린 축을 각각 잡는다', () => {
  const packageJson = full()
  delete packageJson.scripts.lint
  delete packageJson.scripts['test:tc']
  const missing = analyzeEnvironmentClosure({packageJson, entries})
  assert.deepEqual(missing.map(item => item.name).sort(), ['lint', 'test:tc'])
})

test('lint 도구가 없으면 축을 실행할 수 없으므로 누락이다 — 없으면 통과가 아니다', () => {
  const packageJson = {...full(), devDependencies: {vite: '5.0.0'}}
  const missing = analyzeEnvironmentClosure({packageJson, entries})
  assert.deepEqual(missing.map(item => item.kind), ['dependency'])
})

test('.eslintrc는 Flat Config 충족이 아니다(scaffolder §82 생성 금지 대상)', () => {
  const missing = analyzeEnvironmentClosure({packageJson: full(), entries: ['package.json', '.eslintrc.json']})
  assert.deepEqual(missing.map(item => item.name), ['eslint.config.*'])
})

test('typescript-eslint만 있어도 lint 도구로 인정한다', () => {
  const packageJson = {...full(), devDependencies: {'typescript-eslint': '8.0.0'}}
  assert.deepEqual(analyzeEnvironmentClosure({packageJson, entries}), [])
})

test('web app이 아니면 dev·test:e2e를 요구하지 않는다(library·CLI 형태)', () => {
  const packageJson = full()
  delete packageJson.scripts.dev
  delete packageJson.scripts['test:e2e']
  assert.deepEqual(analyzeEnvironmentClosure({packageJson, entries, webApp: false}), [])
  assert.equal(analyzeEnvironmentClosure({packageJson, entries, webApp: true}).length, 2)
})

test('실측 회귀 — track이 겪은 누락 7건 형태를 그대로 잡는다', () => {
  const packageJson = {scripts: {dev: 'vite', build: 'tsc --noEmit && vite build', preview: 'vite preview', test: 'vitest run', 'test:watch': 'vitest', e2e: 'playwright test'}, devDependencies: {vite: '5.0.0'}}
  const missing = analyzeEnvironmentClosure({packageJson, entries: ['package.json', 'vite.config.ts']})
  assert.equal(missing.length, 7)
  assert.ok(missing.some(item => item.name === 'lint'))
  assert.ok(missing.some(item => item.kind === 'dependency'))
  assert.ok(missing.some(item => item.kind === 'config'))
})
