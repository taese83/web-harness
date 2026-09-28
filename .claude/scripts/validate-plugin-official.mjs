#!/usr/bin/env node
// validate-plugin-official.mjs — 빌드한 배포본을 Claude Code 공식 검증기(`claude plugin validate --strict`)로 본다.
//
// 하네스 검증기(validate-harness·빌드 검사)는 우리가 아는 규칙만 본다. 공식 검증기는 런타임이 너그럽게 넘기는 것(모르는 필드·
// 빠진 메타데이터 등)을 경고로 내고, --strict는 경고도 실패로 센다. 플러그인 매니페스트와 마켓플레이스 매니페스트를 둘 다 본다.
// `claude`가 없으면 건너뛰지 않고 실패한다 — 건너뛴 검사는 통과처럼 보인다. CI 러너는 고정 판본을 설치한다(harness-ci.yml).
//
// 사용법: node .claude/scripts/validate-plugin-official.mjs [--dist <dist 디렉터리>]
// 종료 코드: 0 = 두 매니페스트 통과, 1 = 검증 실패·claude 없음, 2 = 사용법 오류(배포본 없음).
import {spawnSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {answerHelp} from './cli-help-lib.mjs'

answerHelp(import.meta.url)

const args = process.argv.slice(2)
const index = args.indexOf('--dist')
const dist = resolve(index >= 0 ? args[index + 1] ?? '' : fileURLToPath(new URL('../../dist', import.meta.url)))
const targets = [join(dist, 'web-harness-plugin'), dist]
for (const target of targets) {
  if (!existsSync(join(target, '.claude-plugin'))) {
    process.stderr.write(`배포본이 없다: ${target}/.claude-plugin — 먼저 node .claude/scripts/build-plugin.mjs\n`)
    process.exit(2)
  }
}
// win32의 npm 전역 설치는 `.cmd` 심이다 — 그대로 부르면 없다고 오판한다.
const CLAUDE = process.platform === 'win32' ? 'claude.cmd' : 'claude'
const env = {...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1'}
// 판정한 판본을 남긴다 — 로컬과 CI의 판본이 달라 결과가 갈리면 로그에서 보인다.
const version = spawnSync(CLAUDE, ['--version'], {encoding: 'utf8', env})
if (!version.error) process.stdout.write(`claude ${String(version.stdout).trim()}\n`)
let failed = false
for (const target of targets) {
  const result = spawnSync(CLAUDE, ['plugin', 'validate', '--strict', target], {encoding: 'utf8', env})
  if (result.error?.code === 'ENOENT') {
    process.stderr.write('claude CLI가 없다 — 공식 검증을 건너뛰지 않는다. 고정 판본을 설치한다: '
      + 'npm install -g @anthropic-ai/claude-code@<harness-ci.yml의 판본>\n')
    process.exit(1)
  }
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  if (result.status !== 0) {
    failed = true
    process.stderr.write(`✗ claude plugin validate --strict ${target}\n${output}\n`)
  } else {
    process.stdout.write(`✔ claude plugin validate --strict ${target}\n`)
  }
}
process.exit(failed ? 1 : 0)
