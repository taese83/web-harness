#!/usr/bin/env node

import {join} from 'node:path'
import {adapterDirectory} from './adapter-lib.mjs'
import {parseArgv, readJson, runCli} from './core-lib.mjs'
import {evaluateNextContractDocument} from './next-contract-lib.mjs'
import {validateNextProject} from './next-project-lib.mjs'

runCli(() => {
  const args = parseArgv(process.argv.slice(2), {'--project': 'value'})
  const fixturePath = join(adapterDirectory, 'next-app-fullstack', 'fixtures', 'contract-cases.json')
  const contractFixtures = evaluateNextContractDocument(readJson(fixturePath))
  return args.project ? {contractFixtures, project: validateNextProject(args.project)} : contractFixtures
})
