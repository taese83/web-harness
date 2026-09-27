#!/usr/bin/env node
// validate-next-contracts.mjs — Next.js 계약 매트릭스 6종과 프로필·영수증의 정합을 검사한다.
// 사용법: node .claude/scripts/web-core/validate-next-contracts.mjs --project <root>
// 출력: stdout JSON. 위반이면 비0 종료.

import {join} from 'node:path'
import {adapterDirectory} from './adapter-lib.mjs'
import {parseArgv, readJson, runCli} from './core-lib.mjs'
import {evaluateNextContractDocument} from './next-contract-lib.mjs'
import {validateNextProject} from './next-project-lib.mjs'
import {answerHelp} from '../cli-help-lib.mjs'

answerHelp(import.meta.url)

runCli(() => {
  const args = parseArgv(process.argv.slice(2), {'--project': 'value'})
  const fixturePath = join(adapterDirectory, 'next-app-fullstack', 'fixtures', 'contract-cases.json')
  const contractFixtures = evaluateNextContractDocument(readJson(fixturePath))
  return args.project ? {contractFixtures, project: validateNextProject(args.project)} : contractFixtures
})
