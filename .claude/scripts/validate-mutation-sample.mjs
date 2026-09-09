#!/usr/bin/env node
// validate-mutation-sample.mjs — 생성된 테스트가 결함을 잡는지 표본으로 재고 **보고한다**.
//
// **막지 않는다.** 실측(2026-09-09)에서 완주한 프로젝트가 33%·43%였다 — 차단으로 두면 기존
// 프로젝트가 전부 선다. 그리고 equivalent mutant가 원리적으로 섞이므로 오탐이 0이 될 수 없다.
// 이 저장소 규율대로, 오탐이 있는 검사는 막지 않는다.
//
// **소스를 변이시키므로 복원을 증명한다.** 실행 전후로 **변이 대상 파일들**의 지문을 비교해
// 다르면 loud하게 멈춘다(exit 2). 프로젝트 전체가 아니라 대상만 재는 이유는, 테스트 러너가
// `node_modules`·lockfile을 만드는 부수효과가 「복원 실패」로 오탐되기 때문이다(자체 실측).
//
// 사용법:
//   node .claude/scripts/validate-mutation-sample.mjs --project <root> [--limit N] [--json]
// 종료 코드: 0 = 보고 완료(점수와 무관), 2 = 사용법 오류 또는 **복원 실패**.

import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'
import {resolveCommand} from './resolve-commands.mjs'
import {mutableDigest, renderMutationSample, runMutationSample} from './mutation-sample-lib.mjs'

const argv = process.argv.slice(2)
const flagValue = name => {
  const at = argv.indexOf(name)
  return at >= 0 ? argv[at + 1] ?? null : null
}
const projectFlag = flagValue('--project')
const jsonOutput = argv.includes('--json')
const limit = Number(flagValue('--limit') ?? 12)

/**
 * 프로젝트의 **자기 테스트 명령**을 찾는다 — 하네스가 러너를 정하지 않는다.
 * 없으면 `null`이고 호출부가 `NOT_MEASURED`로 낸다(추측해서 돌리지 않는다).
 */
export function projectTestRunner(projectRoot) {
  const manifestPath = join(projectRoot, 'package.json')
  if (!existsSync(manifestPath)) return null
  let manifest
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) } catch { return null }
  // `resolveCommand`는 없을 때 `null`이 아니라 `{status:'NO_SCRIPT'}`를 돌려준다 —
  // truthy 검사만 하면 `undefined`를 spawn한다(자체 실측에서 잡았다).
  const command = resolveCommand('quality.unit', manifest)
  if (!command?.executable) return null
  // **timeout을 둔다.** watch 모드 스크립트는 영원히 매달리고, 그동안 소스는 변이된 채다.
  // spawn 실패·timeout은 `status === null`이라 1로 접는다 — 기준 실행이 그것을 잡는다.
  return () => spawnSync(command.executable, command.args,
    {cwd: projectRoot, stdio: 'ignore', timeout: 120000}).status ?? 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!projectFlag) {
    process.stderr.write('사용법: validate-mutation-sample.mjs --project <root> [--limit N] [--json]\n')
    process.exit(2)
  }
  const projectRoot = resolve(projectFlag)
  if (!existsSync(projectRoot)) {
    process.stderr.write(`프로젝트 경로가 없다: ${projectFlag}\n`)
    process.exit(2)
  }
  // **강제 종료 대비.** `finally`는 예외만 덮는다 — SIGINT·툴 timeout으로 죽으면 변이가
  // 사용자 소스에 남는다. 진행 중 파일을 들고 있다가 신호에 복원한다.
  let inFlight = null
  const rescue = signal => {
    if (inFlight) {
      try { writeFileSync(join(projectRoot, inFlight.file), inFlight.original) } catch { /* 최선 노력 */ }
      process.stderr.write(`${signal}: 변이 중이던 ${inFlight.file}를 복원했다\n`)
    }
    process.exit(2)
  }
  process.once('SIGINT', () => rescue('SIGINT'))
  process.once('SIGTERM', () => rescue('SIGTERM'))
  const before = mutableDigest(projectRoot)
  const result = await runMutationSample(projectRoot, {runTests: projectTestRunner(projectRoot), limit,
    onInFlight: item => { inFlight = item }})
  const after = mutableDigest(projectRoot)
  if (before !== after) {
    // 복원이 깨졌다. 점수를 말할 자리가 아니다 — 사람이 트리를 확인해야 한다.
    process.stderr.write('변이 복원에 실패했다 — 변이 대상 소스가 실행 전과 다르다. `git status`로 확인하고 되돌려라.\n')
    process.exit(2)
  }
  if (jsonOutput) process.stdout.write(`${JSON.stringify({...result, digestStable: true}, null, 2)}\n`)
  else {
    process.stdout.write(`${renderMutationSample(result)}\n`)
    for (const item of result.survivors ?? []) process.stdout.write(`  · 살아남음 ${item.file} [${item.label}]\n`)
  }
  // **보고다.** 점수가 낮아도 exit 0 — 판정은 사람과 `test-executor`의 몫이다.
  process.exit(0)
}
