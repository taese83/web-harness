#!/usr/bin/env node
// validate-release-gate.mjs — HANDOFF 전 release gate: 영수증·QA 보고서·attestation을 대조한다.
// 사용법: node .claude/scripts/validate-release-gate.mjs [--project <root>] [--write-manifest]
// 종료 코드: 0 = 통과, 1 = 차단(오류 목록 출력), 2 = --write-manifest의 매니페스트를 안전하게 쓰지 못함.

import {resolve} from 'node:path'
import {buildReleaseManifest, validateReleaseGate} from './release-gate-lib.mjs'
import {atomicWriteProjectFile} from './safe-project-file-lib.mjs'
import {answerHelp} from './cli-help-lib.mjs'

answerHelp(import.meta.url)

const args = process.argv.slice(2)
const projectFlagIndex = args.indexOf('--project')
const projectRoot = resolve(projectFlagIndex >= 0 ? args[projectFlagIndex + 1] ?? '' : process.cwd())
const writeManifest = args.includes('--write-manifest')

if (writeManifest) {
  try {
    const {manifest} = buildReleaseManifest(projectRoot)
    atomicWriteProjectFile(
      projectRoot,
      '_workspace/04_qa/qa-manifest.json',
      `${JSON.stringify(manifest, null, 2)}\n`,
    )
    // 설계→코드 결속은 **판정이 아니라 보고**다 — exit 코드를 바꾸지 않는다.
    // 매니페스트에만 남기면 아무도 읽지 않는다(이 저장소가 `SURFACE_MODEL`·`QUESTION`에서
    // 이미 겪은 「소비자 0」 클래스다). 그래서 여기서 한 줄 낸다.
    const binding = manifest?.routeBinding
    if (binding && ['UNBOUND', 'UNRECOGNIZED'].includes(binding.state)) {
      process.stderr.write(`설계→코드 결속: ${binding.state} — ${binding.note}\n`)
    }
    const symbols = manifest?.symbolBinding
    if (symbols && ['UNBUILT', 'DIVERGED', 'PARTIAL', 'NOT_MEASURED'].includes(symbols.state)) {
      process.stderr.write(`심볼 대조: ${symbols.state} — ${symbols.note}\n`)
    }
  } catch (error) {
    process.stderr.write(`QA manifest could not be written securely: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(2)
  }
}

const {errors} = validateReleaseGate(projectRoot)
if (errors.length > 0) {
  process.stderr.write(`Release gate blocked with ${errors.length} error(s):\n`)
  for (const error of errors) process.stderr.write(`- ${error}\n`)
  process.exit(1)
}

process.stdout.write('Release gate passed.\n')
