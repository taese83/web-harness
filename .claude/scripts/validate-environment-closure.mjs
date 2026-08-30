#!/usr/bin/env node
// validate-environment-closure.mjs — environment-scaffolder 산출의 closure를 기계로 대조한다.
//
// 왜: `environment-scaffolder.md`는 이미 완전한 계약을 갖고 있다 —
//   §87 "생성 직후 eslint.config.*, package scripts의 파일/명령 closure를 대조한다.
//        하나라도 빠지면 완료하지 않는다."
//   §109 scripts는 dev·build·lint·typecheck·test·test:coverage·test:tc·test:e2e를 포함한다
//   §124 ESLint Flat Config와 strict TypeScript 설정이 포함됐다
// 그런데 **아무도 그것을 대조하지 않았다.** 실측(track, 2026-08-30): lint·typecheck·
// test:coverage·test:tc·test:e2e 5개와 ESLint 설정·의존성이 통째로 없는 채 Phase 3가 진행됐고,
// Gate A·B·C가 세 번 요구하는 lint 축이 **도구 부재로 조용히 사라졌다**(§4 공허 통과).
// 계약이 산문으로만 있으면 그 계약은 지켜지지 않는다.
//
// 사용법:
//   node .claude/scripts/validate-environment-closure.mjs --project <root> [--json]
// 종료 코드: 0 = closure 성립, 1 = 누락, 2 = 사용법/입력 오류.
//
// **없으면 통과가 아니라 실패다.** 도구가 없어 축을 못 돌리는 상태를 green으로 적지 않는다.
import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {join, resolve} from 'node:path'

// scaffolder §109. `dev`는 라이브러리·CLI 형태에 없을 수 있어 조건부로 둔다.
export const REQUIRED_SCRIPTS = ['build', 'lint', 'typecheck', 'test', 'test:coverage', 'test:tc']
export const WEB_APP_SCRIPTS = ['dev', 'test:e2e']
// scaffolder §82: Flat Config만 인정한다. `.eslintrc*`는 생성 금지 대상이라 존재해도 충족이 아니다.
const FLAT_CONFIG = /^eslint\.config\.(?:js|mjs|cjs|ts|mts|cts)$/
const LINT_TOOLS = /^(?:eslint|@eslint\/|typescript-eslint|@typescript-eslint\/)/

/** package.json + 디렉터리 목록 → 누락 목록(순수). 네트워크·파일시스템 접근 없음. */
export function analyzeEnvironmentClosure({packageJson, entries, webApp = true}) {
  const missing = []
  const scripts = packageJson?.scripts ?? {}
  const required = [...REQUIRED_SCRIPTS, ...(webApp ? WEB_APP_SCRIPTS : [])]
  for (const name of required) {
    if (typeof scripts[name] !== 'string' || !scripts[name].trim()) {
      missing.push({kind: 'script', name, detail: `package scripts에 \`${name}\`이 없다`})
    }
  }
  const deps = {...(packageJson?.dependencies ?? {}), ...(packageJson?.devDependencies ?? {})}
  if (!Object.keys(deps).some(name => LINT_TOOLS.test(name))) {
    missing.push({kind: 'dependency', name: 'eslint', detail: 'ESLint 계열 의존성이 없다 — lint 축을 실행할 수 없다'})
  }
  if (!entries.some(entry => FLAT_CONFIG.test(entry))) {
    missing.push({kind: 'config', name: 'eslint.config.*', detail: 'ESLint Flat Config가 없다(.eslintrc*는 생성 금지 대상이라 충족이 아니다)'})
  }
  return missing
}

const parseArgs = argv => {
  const values = {project: null, json: false, webApp: true}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (key === '--project') { values.project = argv[index + 1]; index += 1 }
    else if (key === '--json') values.json = true
    else if (key === '--no-web-app') values.webApp = false
    else { process.stderr.write(`Unknown argument: ${key}\n`); process.exit(2) }
  }
  if (!values.project) { process.stderr.write('Usage: --project <root> [--json] [--no-web-app]\n'); process.exit(2) }
  return values
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const {project, json, webApp} = parseArgs(process.argv.slice(2))
  const root = resolve(project)
  const packagePath = join(root, 'package.json')
  if (!existsSync(packagePath)) { process.stderr.write(`package.json 없음: ${packagePath}\n`); process.exit(2) }
  let packageJson
  try { packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) }
  catch (error) { process.stderr.write(`package.json 파싱 실패: ${error.message}\n`); process.exit(2) }
  const missing = analyzeEnvironmentClosure({packageJson, entries: readdirSync(root), webApp})
  if (json) process.stdout.write(`${JSON.stringify({ok: missing.length === 0, missing}, null, 2)}\n`)
  else if (missing.length === 0) process.stdout.write('environment closure 성립 — 필수 script·lint 도구·Flat Config 모두 존재\n')
  else {
    process.stdout.write(`environment closure 누락 ${missing.length}건 — 게이트는 통과가 아니다:\n`)
    for (const item of missing) process.stdout.write(`  - [${item.kind}] ${item.detail}\n`)
  }
  process.exitCode = missing.length === 0 ? 0 : 1
}
