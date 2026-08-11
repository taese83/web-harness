import {sortedUnique, WebCoreError} from './core-lib.mjs'

export const compileCapabilityDag = (adapter, requestedTargets = adapter.targetCapabilities) => {
  const targets = sortedUnique(requestedTargets)
  if (targets.length === 0) throw new WebCoreError('TARGET_REQUIRED', 'At least one target capability is required')
  const initial = new Set(adapter.initialCapabilities)
  const tasks = new Map(adapter.tasks.map(task => [task.id, task]))
  const providers = new Map()
  for (const task of adapter.tasks) {
    for (const capability of task.provides) {
      if (providers.has(capability)) {
        throw new WebCoreError('AMBIGUOUS_PROVIDER', `Capability has multiple providers: ${capability}`, {providers: [providers.get(capability), task.id].sort()})
      }
      providers.set(capability, task.id)
    }
  }

  const selected = new Set()
  const visiting = []
  const selectTask = taskId => {
    if (selected.has(taskId)) return
    const cycleIndex = visiting.indexOf(taskId)
    if (cycleIndex !== -1) {
      throw new WebCoreError('DAG_CYCLE', 'Capability task graph contains a cycle', {cycle: [...visiting.slice(cycleIndex), taskId]})
    }
    const task = tasks.get(taskId)
    if (!task) throw new WebCoreError('TASK_NOT_FOUND', `Task is missing: ${taskId}`)
    visiting.push(taskId)
    for (const capability of [...task.requires].sort()) {
      if (initial.has(capability)) continue
      const provider = providers.get(capability)
      if (!provider) throw new WebCoreError('UNSATISFIED_CAPABILITY', `No task provides required capability: ${capability}`, {consumer: taskId})
      selectTask(provider)
    }
    visiting.pop()
    selected.add(taskId)
  }

  for (const target of targets) {
    if (initial.has(target)) continue
    const provider = providers.get(target)
    if (!provider) throw new WebCoreError('UNSATISFIED_TARGET', `No task provides target capability: ${target}`)
    selectTask(provider)
  }

  const edgeCapabilities = new Map()
  const dependencies = new Map([...selected].map(taskId => [taskId, new Set()]))
  for (const consumerId of selected) {
    const consumer = tasks.get(consumerId)
    for (const capability of consumer.requires) {
      if (initial.has(capability)) continue
      const providerId = providers.get(capability)
      if (!selected.has(providerId)) continue
      dependencies.get(consumerId).add(providerId)
      const key = `${providerId}\0${consumerId}`
      edgeCapabilities.set(key, [...(edgeCapabilities.get(key) ?? []), capability])
    }
  }

  const dependents = new Map([...selected].map(taskId => [taskId, new Set()]))
  const indegree = new Map([...selected].map(taskId => [taskId, dependencies.get(taskId).size]))
  for (const [consumerId, providerIds] of dependencies) {
    for (const providerId of providerIds) dependents.get(providerId).add(consumerId)
  }
  const ready = [...selected].filter(taskId => indegree.get(taskId) === 0).sort()
  const executionOrder = []
  while (ready.length) {
    const taskId = ready.shift()
    executionOrder.push(taskId)
    for (const dependent of [...dependents.get(taskId)].sort()) {
      indegree.set(dependent, indegree.get(dependent) - 1)
      if (indegree.get(dependent) === 0) {
        ready.push(dependent)
        ready.sort()
      }
    }
  }
  if (executionOrder.length !== selected.size) {
    throw new WebCoreError('DAG_CYCLE', 'Capability task graph contains a cycle')
  }

  const nodes = executionOrder.map(taskId => {
    const task = tasks.get(taskId)
    return {
      id: task.id,
      phase: task.phase,
      requires: [...task.requires].sort(),
      provides: [...task.provides].sort(),
      commandIds: [...task.commandIds].sort(),
      dependencies: [...dependencies.get(taskId)].sort(),
    }
  })
  const edges = [...edgeCapabilities.entries()]
    .map(([key, capabilities]) => {
      const [from, to] = key.split('\0')
      return {from, to, capabilities: sortedUnique(capabilities)}
    })
    .sort((left, right) => `${left.from}\0${left.to}`.localeCompare(`${right.from}\0${right.to}`))

  return {
    $schema: 'https://web-harness.local/schemas/web-core/execution-plan.schema.json',
    schemaVersion: 1,
    profileId: adapter.id,
    adapter: {id: adapter.id, version: adapter.version},
    initialCapabilities: [...initial].sort(),
    targetCapabilities: targets,
    nodes,
    edges,
    executionOrder,
    profileBinding: null,
  }
}

export const checkCapabilityDag = adapter => {
  const everyProvidedCapability = sortedUnique(adapter.tasks.flatMap(task => task.provides))
  const plan = compileCapabilityDag(adapter, everyProvidedCapability)
  if (plan.nodes.length !== adapter.tasks.length) {
    throw new WebCoreError('DAG_INCOMPLETE', 'Full capability graph did not select every task', {
      selected: plan.nodes.length,
      declared: adapter.tasks.length,
    })
  }
  return {acyclic: true, taskCount: plan.nodes.length}
}
