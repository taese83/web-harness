#!/usr/bin/env node

import {loadBuiltinAdapters} from './adapter-lib.mjs'
import {runCli} from './core-lib.mjs'
import {checkCapabilityDag, compileCapabilityDag} from './dag-lib.mjs'

runCli(() => {
  const adapters = loadBuiltinAdapters()
  const results = adapters.map(adapter => {
    const plan = compileCapabilityDag(adapter)
    const fullGraph = checkCapabilityDag(adapter)
    return {
      id: adapter.id,
      version: adapter.version,
      supportLevel: adapter.supportLevel,
      trustTier: adapter.trust.tier,
      commandPolicy: adapter.trust.commandPolicy,
      taskCount: adapter.tasks.length,
      compiledTaskCount: plan.nodes.length,
      acyclicTaskCount: fullGraph.taskCount,
      acyclic: fullGraph.acyclic,
    }
  })
  return {ok: true, adapterCount: results.length, adapters: results}
})
