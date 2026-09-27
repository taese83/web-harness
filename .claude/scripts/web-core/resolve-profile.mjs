#!/usr/bin/env node
// resolve-profile.mjs — 프로젝트를 실측해 web 프로필(adapter·배포·capability)을 해석한다.
// 사용법: node .claude/scripts/web-core/resolve-profile.mjs --project-root <path> [--requested <adapter|auto>] [--provider <id>] [--deployment <target>] [--capability <id> ...]
// 출력: stdout JSON(그대로 _workspace/01_plan/project-profile.json에 저장). 오류는 JSON과 비0 종료.

import {parseArgv, runCli} from './core-lib.mjs'
import {resolveProjectProfile} from './profile-lib.mjs'
import {answerHelp} from '../cli-help-lib.mjs'

answerHelp(import.meta.url)

runCli(() => {
  const args = parseArgv(process.argv.slice(2), {
    '--project-root': 'value',
    '--requested': 'value',
    '--provider': 'value',
    '--deployment': 'value',
    '--capability': 'repeatable',
  })
  return resolveProjectProfile({
    projectRoot: args['project-root'],
    requested: args.requested ?? 'auto',
    deploymentProvider: args.provider,
    deploymentTarget: args.deployment,
    capabilities: args.capability,
  })
})
