import {existsSync, lstatSync, readFileSync, readdirSync, realpathSync} from 'node:fs'
import {isAbsolute, join, relative, resolve, sep} from 'node:path'
import {readProjectRegularFile} from '../safe-project-file-lib.mjs'

const WORKFLOW_SECURITY_FIXTURE = 'workflow-security-cases.json'

// 승격 계약(선행 검증 job·보호 환경·broker action 단독·`run:` 금지)을 **면제**하는 write scope.
//
// 종전에는 `value === 'write'`면 종류를 가리지 않고 전부 승격으로 봤다. 그 규칙은 코드·
// 아티팩트·배포를 바꾸는 쓰기를 막으려고 만들어졌는데, 문법이 넓어 **이슈 상태만 바꾸는
// 워크플로우까지 같이 걸렸다** — Actions가 무조건 배포는 아니다(사용자 지적).
//
// **기본은 fail-closed다**: 여기 나열되지 않은 write는 전부 승격으로 본다. 새 GitHub 권한이
// 생겨도 자동으로 느슨해지지 않는다. 목록을 늘리는 것은 같은 수준의 검토를 거쳐야 한다.
//
// `issues`만 둔다 — 이 권한으로 할 수 있는 최악은 이슈를 잘못 닫거나 코멘트를 다는 것이고,
// 코드·릴리스·배포·신원(id-token)·체크 상태를 바꿀 수 없다. `pull-requests`·`statuses`·
// `checks`·`pages`·`packages`·`deployments`·`actions`·`attestations`는 승격에 닿으므로 제외한다.
const NON_PROMOTION_WRITE_SCOPES = new Set(['issues'])
const MAX_WORKFLOW_BYTES = 2 * 1024 * 1024
const MAX_WORKFLOWS_PER_PROJECT = 256
const SAFE_PERMISSION_VALUES = new Set(['none', 'read', 'write'])
const PROTECTED_GENERATED_SEGMENTS = new Set([
  '.git',
  '.github',
  '.claude',
  '_workspace',
  'node_modules',
  'scripts',
  'src',
  'workers',
])
const PROTECTED_GENERATED_FILES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'turbo.json',
  'vercel.json',
])

const stripYamlComment = source => {
  let quote = null
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      if (character === quote && source[index - 1] !== '\\') quote = null
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      continue
    }
    if (character === '#' && (index === 0 || /\s/.test(source[index - 1]))) return source.slice(0, index)
  }
  return source
}

const containsYamlAnchorOrAlias = source => {
  let quote = null
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      if (quote === "'" && character === "'" && source[index + 1] === "'") {
        index += 1
        continue
      }
      if (character === quote && (quote === "'" || source[index - 1] !== '\\')) quote = null
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      continue
    }
    if (!['&', '*'].includes(character) || !/[A-Za-z0-9_-]/.test(source[index + 1] ?? '')) continue
    const previous = source[index - 1] ?? ''
    if (previous && !/[\s:[{,\-]/.test(previous)) continue
    let end = index + 2
    while (/[A-Za-z0-9_-]/.test(source[end] ?? '')) end += 1
    const following = source[end] ?? ''
    if (!following || /[\s,\]}:#]/.test(following)) return true
  }
  return false
}

const normalizeScalar = source => {
  const value = String(source ?? '').trim()
  if (
    value.length >= 2 &&
    ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"')))
  ) return value.slice(1, -1).trim()
  return value
}

const parseWorkflowLines = source => source.split(/\r?\n/).map((raw, index) => {
  const withoutComment = stripYamlComment(raw).replace(/\s+$/, '')
  const leading = withoutComment.match(/^\s*/)?.[0] ?? ''
  const trimmed = withoutComment.trim()
  const match = trimmed.match(/^(-\s+)?([A-Za-z_][A-Za-z0-9_.-]*):(?:\s*(.*))?$/)
  return {
    raw,
    index,
    line: index + 1,
    indent: leading.replaceAll('\t', '  ').length,
    hasIndentTab: leading.includes('\t'),
    trimmed,
    entry: match ? {
      sequence: Boolean(match[1]),
      key: match[2],
      value: match[3] ?? '',
    } : null,
  }
})

const blockEnd = (lines, header) => {
  for (let index = header.index + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trimmed) continue
    if (line.indent <= header.indent) return index
  }
  return lines.length
}

const directEntries = (lines, header) => {
  const end = blockEnd(lines, header)
  const candidates = lines
    .slice(header.index + 1, end)
    .filter(line => line.entry && !line.entry.sequence && line.indent > header.indent)
  if (candidates.length === 0) return []
  const childIndent = Math.min(...candidates.map(line => line.indent))
  return candidates.filter(line => line.indent === childIndent)
}

const entriesByKey = entries => {
  const result = new Map()
  for (const entry of entries) {
    const existing = result.get(entry.entry.key) ?? []
    existing.push(entry)
    result.set(entry.entry.key, existing)
  }
  return result
}

const firstEntry = (entries, key) => entries.find(line => line.entry.key === key) ?? null

const configuredEntry = (lines, entry) => {
  if (!entry) return false
  const value = normalizeScalar(entry.entry.value)
  if (value && value !== '[]' && value !== '{}' && value !== '|' && value !== '>') return true
  return directEntries(lines, entry).some(child => {
    const childValue = normalizeScalar(child.entry.value)
    return child.entry.key === 'name' && Boolean(childValue)
  })
}

const normalizeUsesTarget = source => normalizeScalar(source.replace(/\s+#.*$/, ''))

const isImmutableUsesTarget = target => {
  // Local composite actions can hide nested mutable `uses:` declarations. Until
  // their action.yml dependency graph is recursively inspected, reject them.
  if (target.startsWith('./')) return false
  if (target.startsWith('docker://')) {
    return /^docker:\/\/[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[a-f0-9]{64}$/i.test(target)
  }
  const match = target.match(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)@(?:[a-f0-9]{40}|[a-f0-9]{64})$/i)
  return Boolean(match && !match[1].split('/').some(segment => segment === '.' || segment === '..'))
}

export const parseTrustedPromotionActions = source => {
  if (source === undefined || source === null || source === '') return []
  if (typeof source !== 'string' || source.length > 16 * 1024) {
    throw new Error('WEB_HARNESS_TRUSTED_PROMOTION_ACTIONS exceeds its bounded JSON contract')
  }
  let value
  try {
    value = JSON.parse(source)
  } catch (error) {
    throw new Error(`WEB_HARNESS_TRUSTED_PROMOTION_ACTIONS must be a JSON array: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (
    !Array.isArray(value) ||
    value.length > 16 ||
    value.some(target => typeof target !== 'string' || target.startsWith('./') || target.startsWith('docker://') || !isImmutableUsesTarget(target)) ||
    new Set(value).size !== value.length
  ) throw new Error('WEB_HARNESS_TRUSTED_PROMOTION_ACTIONS must contain no more than 16 unique full-SHA remote actions')
  return [...value].sort()
}

const isSafeGeneratedPath = source => {
  const path = normalizeScalar(source).replace(/^\.\//, '')
  if (
    !path ||
    isAbsolute(path) ||
    path.endsWith('/') ||
    path.includes('\\') ||
    /[\0\r\n*?\[\]{}$`]/.test(path)
  ) return false
  const segments = path.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return false
  if (segments.some(segment => PROTECTED_GENERATED_SEGMENTS.has(segment))) return false
  if (PROTECTED_GENERATED_FILES.has(segments.at(-1))) return false
  if (/^(?:vite|vitest|playwright|eslint|tsconfig)(?:\.|$)/.test(segments.at(-1))) return false
  return true
}

const parseGeneratedPaths = source => [...new Set(
  normalizeScalar(source)
    .split(',')
    .map(path => path.trim().replace(/^\.\//, ''))
    .filter(Boolean),
)]

const collectRunScripts = lines => {
  const scripts = []
  for (const line of lines) {
    if (line.entry?.key !== 'run') continue
    const value = normalizeScalar(line.entry.value)
    if (value && value !== '|' && value !== '>') {
      scripts.push(value)
      continue
    }
    if (value !== '|' && value !== '>') continue
    const end = blockEnd(lines, line)
    scripts.push(lines.slice(line.index + 1, end).map(child => child.raw.trim()).join('\n'))
  }
  return scripts
}

const checkoutStepRange = (lines, usesLine) => {
  let stepIndent = usesLine.indent
  if (!usesLine.trimmed.startsWith('- ')) {
    for (let index = usesLine.index - 1; index >= 0; index -= 1) {
      const candidate = lines[index]
      if (candidate.trimmed.startsWith('- ') && candidate.indent < usesLine.indent) {
        stepIndent = candidate.indent
        break
      }
    }
  }
  for (let index = usesLine.index + 1; index < lines.length; index += 1) {
    const candidate = lines[index]
    if (!candidate.trimmed) continue
    if (candidate.indent < stepIndent || (candidate.indent === stepIndent && candidate.trimmed.startsWith('- '))) {
      return lines.slice(usesLine.index + 1, index)
    }
  }
  return lines.slice(usesLine.index + 1)
}

export const inspectWorkflowSecurity = ({
  source,
  workflowPath,
  generatedPaths: manifestGeneratedPaths = null,
  trustedPromotionActions = [],
}) => {
  const findings = []
  const add = (code, message, line = null) => findings.push({code, message, line, workflowPath})
  const lines = parseWorkflowLines(source)

  for (const line of lines) {
    if (line.hasIndentTab) add('YAML_TAB_INDENTATION', 'security-relevant workflow YAML must use spaces for indentation', line.line)
    const value = normalizeScalar(line.entry?.value)
    if (/^<<\s*:/.test(line.trimmed) || containsYamlAnchorOrAlias(line.trimmed)) {
      add('YAML_ALIAS_OR_ANCHOR_FORBIDDEN', 'workflow security policy cannot be hidden behind a YAML alias or anchor', line.line)
    }
    if (/^-\s*[\[{]/.test(line.trimmed) || /^[\[{]/.test(value)) {
      add('YAML_FLOW_STYLE_FORBIDDEN', 'workflow security policy must use canonical block-style YAML', line.line)
    }
    if (/^%/.test(line.trimmed) || /^(?:-\s+)?!/.test(line.trimmed) || /^!/.test(value)) {
      add('YAML_TAG_OR_DIRECTIVE_FORBIDDEN', 'YAML tags and directives are outside the canonical workflow security subset', line.line)
    }
    if (/^(?:-\s+)?["'][^"']+["']\s*:/.test(line.trimmed)) {
      add('YAML_QUOTED_KEY_FORBIDDEN', 'workflow mapping keys must use canonical unquoted block syntax', line.line)
    }
    if (/^[?:]\s/.test(line.trimmed) || /^(?:---|\.\.\.)$/.test(line.trimmed)) {
      add('YAML_EXPLICIT_OR_DOCUMENT_SYNTAX_FORBIDDEN', 'explicit keys and multi-document YAML are unsupported by the security contract', line.line)
    }
  }
  if (/\{\{[A-Z][A-Z0-9_]+\}\}/.test(source)) {
    add('WORKFLOW_PLACEHOLDER', 'unresolved template placeholder remains')
  }

  const topEntries = lines.filter(line => line.entry && !line.entry.sequence && line.indent === 0)
  const topByKey = entriesByKey(topEntries)
  for (const key of ['on', 'permissions', 'env', 'concurrency', 'jobs']) {
    const entries = topByKey.get(key) ?? []
    if (entries.length > 1) add('DUPLICATE_SECURITY_KEY', `top-level ${key} is declared more than once`, entries[1].line)
  }

  for (const line of lines) {
    if (line.entry?.key !== 'uses') continue
    const target = normalizeUsesTarget(line.entry.value)
    if (target.startsWith('./')) {
      add(
        'LOCAL_ACTION_UNVERIFIED',
        'local actions are forbidden until their nested action dependency graph can be inspected',
        line.line,
      )
    } else if (!isImmutableUsesTarget(target)) {
      add('ACTION_NOT_IMMUTABLE', `action must use a full commit SHA or container digest, found ${target || '<empty>'}`, line.line)
    }
    if (!target.toLowerCase().startsWith('actions/checkout@')) continue
    const persistEntries = checkoutStepRange(lines, line).filter(candidate => candidate.entry?.key === 'persist-credentials')
    if (persistEntries.length !== 1 || normalizeScalar(persistEntries[0].entry.value).toLowerCase() !== 'false') {
      add(
        'CHECKOUT_PERSIST_CREDENTIALS_REQUIRED',
        'actions/checkout must set persist-credentials: false in the same step',
        line.line,
      )
    }
  }

  const permissionsHeader = (topByKey.get('permissions') ?? [])[0] ?? null
  if (!permissionsHeader) {
    add('DEFAULT_PERMISSIONS_REQUIRED', 'workflow must declare top-level permissions with contents: read')
  } else if (normalizeScalar(permissionsHeader.entry.value)) {
    add('DEFAULT_PERMISSIONS_BLOCK_REQUIRED', 'top-level permissions must use an explicit block with contents: read', permissionsHeader.line)
  } else {
    const permissionEntries = directEntries(lines, permissionsHeader)
    const permissionByKey = entriesByKey(permissionEntries)
    const contentsEntries = permissionByKey.get('contents') ?? []
    if (contentsEntries.length !== 1 || normalizeScalar(contentsEntries[0].entry.value).toLowerCase() !== 'read') {
      add('DEFAULT_CONTENTS_READ_REQUIRED', 'top-level permissions.contents must be exactly read', permissionsHeader.line)
    }
    for (const permission of permissionEntries) {
      const value = normalizeScalar(permission.entry.value).toLowerCase()
      if (!SAFE_PERMISSION_VALUES.has(value)) {
        add('PERMISSION_VALUE_INVALID', `${permission.entry.key} permission must be read, write, or none`, permission.line)
      } else if (value === 'write') {
        add('TOP_LEVEL_WRITE_PERMISSION', 'write permissions are only allowed on isolated jobs', permission.line)
      }
    }
  }

  const concurrencyHeader = (topByKey.get('concurrency') ?? [])[0] ?? null
  let concurrencyCancel = null
  if (!concurrencyHeader) {
    add('WORKFLOW_CONCURRENCY_REQUIRED', 'workflow must declare top-level concurrency')
  } else if (normalizeScalar(concurrencyHeader.entry.value)) {
    add('WORKFLOW_CONCURRENCY_BLOCK_REQUIRED', 'concurrency must declare group and cancel-in-progress explicitly', concurrencyHeader.line)
  } else {
    const concurrencyEntries = directEntries(lines, concurrencyHeader)
    const group = firstEntry(concurrencyEntries, 'group')
    const cancel = firstEntry(concurrencyEntries, 'cancel-in-progress')
    if (!configuredEntry(lines, group)) add('CONCURRENCY_GROUP_REQUIRED', 'concurrency.group is required', concurrencyHeader.line)
    concurrencyCancel = normalizeScalar(cancel?.entry.value).toLowerCase()
    if (!['true', 'false'].includes(concurrencyCancel)) {
      add('CONCURRENCY_CANCEL_POLICY_REQUIRED', 'concurrency.cancel-in-progress must be an explicit boolean', concurrencyHeader.line)
    }
  }

  const jobsHeader = (topByKey.get('jobs') ?? [])[0] ?? null
  let writeJobCount = 0
  if (!jobsHeader || normalizeScalar(jobsHeader.entry.value)) {
    add('WORKFLOW_JOBS_REQUIRED', 'workflow must declare jobs as a block', jobsHeader?.line ?? null)
  } else {
    const jobHeaders = directEntries(lines, jobsHeader)
    if (jobHeaders.length === 0) add('WORKFLOW_JOBS_REQUIRED', 'workflow must declare at least one job', jobsHeader.line)
    for (const jobHeader of jobHeaders) {
      const jobId = jobHeader.entry.key
      const jobFields = directEntries(lines, jobHeader)
      const jobFieldMap = entriesByKey(jobFields)
      for (const key of ['permissions', 'needs', 'environment', 'timeout-minutes']) {
        const entries = jobFieldMap.get(key) ?? []
        if (entries.length > 1) add('DUPLICATE_SECURITY_KEY', `job ${jobId} declares ${key} more than once`, entries[1].line)
      }

      const timeout = (jobFieldMap.get('timeout-minutes') ?? [])[0] ?? null
      const timeoutValue = normalizeScalar(timeout?.entry.value)
      if (!timeout || !/^[1-9]\d*$/.test(timeoutValue) || Number(timeoutValue) > 360) {
        add('JOB_TIMEOUT_REQUIRED', `job ${jobId} must set timeout-minutes between 1 and 360`, jobHeader.line)
      }

      const jobPermissions = (jobFieldMap.get('permissions') ?? [])[0] ?? null
      let hasWritePermission = false
      if (jobPermissions) {
        const inline = normalizeScalar(jobPermissions.entry.value).toLowerCase()
        if (inline) {
          if (inline === 'write-all') hasWritePermission = true
          add('JOB_PERMISSIONS_BLOCK_REQUIRED', `job ${jobId} permissions must use an explicit block`, jobPermissions.line)
        } else {
          for (const permission of directEntries(lines, jobPermissions)) {
            const value = normalizeScalar(permission.entry.value).toLowerCase()
            if (!SAFE_PERMISSION_VALUES.has(value)) {
              add('PERMISSION_VALUE_INVALID', `${jobId}.${permission.entry.key} permission must be read, write, or none`, permission.line)
            }
            if (value === 'write' && !NON_PROMOTION_WRITE_SCOPES.has(permission.entry.key)) hasWritePermission = true
          }
        }
      }

      if (hasWritePermission) {
        writeJobCount += 1
        const needs = (jobFieldMap.get('needs') ?? [])[0] ?? null
        const environment = (jobFieldMap.get('environment') ?? [])[0] ?? null
        if (!configuredEntry(lines, needs)) {
          add('WRITE_JOB_NEEDS_REQUIRED', `write-capable job ${jobId} must depend on a prior validation job`, jobHeader.line)
        }
        if (!configuredEntry(lines, environment)) {
          add('WRITE_JOB_ENVIRONMENT_REQUIRED', `write-capable job ${jobId} must use a protected environment`, jobHeader.line)
        }
        const jobLines = lines.slice(jobHeader.index + 1, blockEnd(lines, jobHeader))
        const brokerUses = jobLines.filter(line => line.entry?.key === 'uses')
        const runSteps = jobLines.filter(line => line.entry?.key === 'run')
        if (runSteps.length > 0) {
          add('WRITE_JOB_RUN_FORBIDDEN', `write-capable job ${jobId} must delegate only to one trusted promotion broker action`, runSteps[0].line)
        }
        if (brokerUses.length !== 1) {
          add('WRITE_JOB_SINGLE_BROKER_REQUIRED', `write-capable job ${jobId} must invoke exactly one trusted promotion broker action`, jobHeader.line)
        } else {
          const brokerTarget = normalizeUsesTarget(brokerUses[0].entry.value)
          if (!trustedPromotionActions.includes(brokerTarget)) {
            add('WRITE_JOB_PROMOTION_ACTION_UNTRUSTED', `write-capable job ${jobId} action is not bound by protected promotion policy`, brokerUses[0].line)
          }
        }
      }
    }
  }

  const onHeader = (topByKey.get('on') ?? [])[0] ?? null
  const onEntries = onHeader && !normalizeScalar(onHeader.entry.value) ? directEntries(lines, onHeader) : []
  const scheduleHeader = firstEntry(onEntries, 'schedule')
  const scheduled = Boolean(scheduleHeader)
  const workflowDispatch = Boolean(firstEntry(onEntries, 'workflow_dispatch'))
  const envHeader = (topByKey.get('env') ?? [])[0] ?? null
  const envEntries = envHeader && !normalizeScalar(envHeader.entry.value) ? directEntries(lines, envHeader) : []
  const envByKey = entriesByKey(envEntries)
  const envValue = key => normalizeScalar((envByKey.get(key) ?? [])[0]?.entry.value)
  const workflowKind = envValue('WEB_HARNESS_WORKFLOW_KIND').toLowerCase()
  const filename = workflowPath.split('/').at(-1) ?? workflowPath
  const refreshNameHint = /^(?:crawl|refresh)(?:[-_.]|$)/i.test(filename)
  const refreshWorkflow = workflowKind === 'refresh' || refreshNameHint

  if (scheduled) {
    const scheduleLines = lines.slice(scheduleHeader.index + 1, blockEnd(lines, scheduleHeader))
    const cronEntries = scheduleLines.filter(line => line.entry?.key === 'cron')
    if (
      cronEntries.length === 0 ||
      cronEntries.some(entry => !normalizeScalar(entry.entry.value) || normalizeScalar(entry.entry.value).includes('${{'))
    ) add('SCHEDULE_CRON_REQUIRED', 'scheduled workflow must declare at least one static cron expression', scheduleHeader.line)
    if (!workflowDispatch) {
      add('SCHEDULE_MANUAL_TRIGGER_REQUIRED', 'scheduled workflow must also provide workflow_dispatch recovery', onHeader?.line ?? null)
    }
    if (!['refresh', 'maintenance'].includes(workflowKind)) {
      add(
        'SCHEDULE_KIND_REQUIRED',
        'scheduled workflow must declare WEB_HARNESS_WORKFLOW_KIND as refresh or maintenance',
        envHeader?.line ?? null,
      )
    }
  }

  if (refreshWorkflow && !scheduled) {
    add('REFRESH_SCHEDULE_REQUIRED', 'crawl/refresh workflow must declare an on.schedule trigger', onHeader?.line ?? null)
  }
  if (refreshNameHint && workflowKind !== 'refresh') {
    add('REFRESH_KIND_REQUIRED', 'crawl/refresh workflow must declare WEB_HARNESS_WORKFLOW_KIND: refresh', envHeader?.line ?? null)
  }

  const runSource = collectRunScripts(lines).join('\n')
  if (/\bgit\s+push\b/.test(runSource)) {
    add('DIRECT_GIT_PUSH_FORBIDDEN', 'workflow must not execute git push directly')
  }
  if (/\bgit\s+commit\b[^\n]*(?:\s-a\b|\s--all\b)/.test(runSource)) {
    add('GIT_COMMIT_ALL_FORBIDDEN', 'workflow must not commit all tracked changes')
  }

  if (refreshWorkflow) {
    if (writeJobCount !== 1) {
      add('REFRESH_PROMOTION_JOB_REQUIRED', 'scheduled refresh must contain exactly one isolated trusted promotion job', jobsHeader?.line ?? null)
    }
    if (concurrencyCancel !== 'false') {
      add('REFRESH_CANCEL_IN_PROGRESS_MUST_BE_FALSE', 'scheduled refresh must queue rather than cancel an in-progress promotion', concurrencyHeader?.line ?? null)
    }
    const declaredPathSource = envValue('WEB_HARNESS_GENERATED_PATHS')
    const declaredPaths = parseGeneratedPaths(declaredPathSource)
    if (!declaredPathSource || declaredPaths.length === 0) {
      add('REFRESH_PATH_ALLOWLIST_REQUIRED', 'refresh workflow must declare exact WEB_HARNESS_GENERATED_PATHS', envHeader?.line ?? null)
    }
    for (const path of declaredPaths) {
      if (!isSafeGeneratedPath(path)) add('REFRESH_PATH_UNSAFE', `generated path is unsafe or too broad: ${path}`, envHeader?.line ?? null)
    }
    if (Array.isArray(manifestGeneratedPaths)) {
      const expected = [...new Set(manifestGeneratedPaths.map(path => path.replace(/^\.\//, '')))].sort()
      const actual = [...declaredPaths].sort()
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        add('REFRESH_PATH_MANIFEST_MISMATCH', 'workflow generated paths do not match the explicit project manifest', envHeader?.line ?? null)
      }
    }

    const directPushPolicy = envValue('WEB_HARNESS_DIRECT_PUSH').toLowerCase()
    if (directPushPolicy !== 'forbidden') {
      add(
        'REFRESH_DIRECT_PUSH_POLICY_INVALID',
        'refresh workflow must declare WEB_HARNESS_DIRECT_PUSH: forbidden and promote via reviewed automation',
        envHeader?.line ?? null,
      )
    }

    for (const line of runSource.split(/\r?\n/)) {
      for (const match of line.matchAll(/\bgit\s+add\s+(.+?)(?=\s*(?:&&|;|\|\|)|$)/g)) {
        const argumentSource = match[1].trim()
        if (/[$`*?\[\]{}]/.test(argumentSource)) {
          add('GIT_ADD_BROAD_OR_DYNAMIC', 'git add must use exact literal generated paths')
          continue
        }
        const arguments_ = argumentSource.split(/\s+/).map(normalizeScalar).filter(Boolean)
        const paths = arguments_.filter(argument => argument !== '--' && !argument.startsWith('-'))
        if (
          arguments_.some(argument => ['.', '-A', '--all'].includes(argument)) ||
          arguments_.some(argument => argument.startsWith('-') && argument !== '--') ||
          paths.length === 0
        ) {
          add('GIT_ADD_BROAD_OR_DYNAMIC', 'git add must use exact literal generated paths')
          continue
        }
        for (const path of paths.map(argument => argument.replace(/^\.\//, ''))) {
          if (!declaredPaths.includes(path)) {
            add('GIT_ADD_OUTSIDE_ALLOWLIST', `git add path is not in WEB_HARNESS_GENERATED_PATHS: ${path}`)
          }
        }
      }
    }
  }

  return findings
}

export const createWorkflowSecurityManifest = projectRoots => ({
  schemaVersion: 1,
  projects: projectRoots.map(project => typeof project === 'string' ? {root: project} : project),
})

const validateWorkflowSecurityFixtures = ({claudeDirectory, pass, fail}) => {
  const fixturePath = join(claudeDirectory, 'evals', 'fixtures', WORKFLOW_SECURITY_FIXTURE)
  if (!existsSync(fixturePath)) {
    fail(`.claude/evals/fixtures/${WORKFLOW_SECURITY_FIXTURE} is missing`)
    return
  }

  let fixture
  try {
    fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
  } catch (error) {
    fail(`workflow security fixture is invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  if (fixture.schemaVersion !== 1 || typeof fixture.baseWorkflow !== 'string' || !Array.isArray(fixture.cases)) {
    fail('workflow security fixture requires schemaVersion 1, baseWorkflow, and cases[]')
    return
  }

  for (const fixtureCase of fixture.cases) {
    let source = fixture.baseWorkflow
    let replacementFailed = false
    for (const replacement of fixtureCase.replacements ?? []) {
      if (typeof replacement.from !== 'string' || !source.includes(replacement.from)) {
        fail(`workflow security fixture ${fixtureCase.id}: replacement source was not found`)
        replacementFailed = true
        break
      }
      source = source.replace(replacement.from, replacement.to ?? '')
    }
    if (replacementFailed) continue
    const findings = inspectWorkflowSecurity({
      source,
      workflowPath: fixture.workflowPath ?? '.github/workflows/refresh-data.yml',
      generatedPaths: fixtureCase.generatedPaths ?? null,
      trustedPromotionActions: fixture.trustedPromotionActions ?? [],
    })
    const findingCodes = new Set(findings.map(finding => finding.code))
    const expectedCodes = fixtureCase.expectCodes ?? []
    if (!Array.isArray(expectedCodes)) {
      fail(`workflow security fixture ${fixtureCase.id}: expectCodes must be an array`)
      continue
    }
    if (expectedCodes.length === 0 && findings.length > 0) {
      fail(`workflow security fixture ${fixtureCase.id}: valid workflow was rejected (${[...findingCodes].join(', ')})`)
    }
    if (expectedCodes.length > 0 && findings.length === 0) {
      fail(`workflow security fixture ${fixtureCase.id}: negative workflow was accepted`)
    }
    for (const expectedCode of expectedCodes) {
      if (!findingCodes.has(expectedCode)) {
        fail(`workflow security fixture ${fixtureCase.id}: expected ${expectedCode}, found ${[...findingCodes].join(', ') || '<none>'}`)
      }
    }
  }
  pass(`${fixture.cases.length} workflow security self-fixtures completed`)
}

export const validateWorkflowSecurityProjects = ({repositoryRoot, manifest, pass, fail}) => {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.projects) || manifest.projects.length === 0) {
    fail('workflow security manifest requires schemaVersion 1 and explicit projects[]')
    return
  }

  const repositoryRealRoot = realpathSync(repositoryRoot)
  const seenRoots = new Set()
  let inspectedWorkflows = 0
  for (const project of manifest.projects) {
    if (!project || typeof project.root !== 'string' || !project.root.trim()) {
      fail('workflow security manifest project.root must be a non-empty string')
      continue
    }
    const requestedProjectRoot = resolve(repositoryRealRoot, project.root)
    const requestedOffset = relative(repositoryRealRoot, requestedProjectRoot)
    if (requestedOffset === '..' || requestedOffset.startsWith(`..${sep}`) || isAbsolute(requestedOffset)) {
      fail(`workflow security project root escapes the repository: ${project.root}`)
      continue
    }
    if (!existsSync(requestedProjectRoot)) {
      fail(`workflow security project root does not exist: ${project.root}`)
      continue
    }
    const requestedStats = lstatSync(requestedProjectRoot)
    if (!requestedStats.isDirectory() || requestedStats.isSymbolicLink()) {
      fail(`workflow security project root must be a real directory: ${project.root}`)
      continue
    }
    const projectRoot = realpathSync(requestedProjectRoot)
    const offset = relative(repositoryRealRoot, projectRoot)
    if (offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)) {
      fail(`workflow security project root resolves outside the repository: ${project.root}`)
      continue
    }
    if (seenRoots.has(projectRoot)) {
      fail(`workflow security manifest contains a duplicate project root: ${project.root}`)
      continue
    }
    seenRoots.add(projectRoot)
    if (project.generatedPaths !== undefined) {
      if (!Array.isArray(project.generatedPaths) || project.generatedPaths.some(path => typeof path !== 'string' || !isSafeGeneratedPath(path))) {
        fail(`workflow security manifest has unsafe generatedPaths for ${project.root}`)
        continue
      }
    }
    let trustedPromotionActions
    try {
      trustedPromotionActions = parseTrustedPromotionActions(JSON.stringify(project.trustedPromotionActions ?? []))
    } catch (error) {
      fail(`workflow security manifest has invalid trustedPromotionActions for ${project.root}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }

    // Deliberately inspect only each explicitly listed root. Nested projects are
    // never discovered recursively because their policy must be supplied by the caller.
    const workflowDirectory = join(projectRoot, '.github', 'workflows')
    if (!existsSync(workflowDirectory)) continue
    const workflowDirectoryStats = lstatSync(workflowDirectory)
    if (!workflowDirectoryStats.isDirectory() || workflowDirectoryStats.isSymbolicLink()) {
      fail(`${[offset, '.github/workflows'].filter(Boolean).join('/')}: workflow directory must be a real directory`)
      continue
    }
    const workflowEntries = readdirSync(workflowDirectory, {withFileTypes: true})
      .filter(entry => /\.ya?ml$/.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name))
    if (workflowEntries.length > MAX_WORKFLOWS_PER_PROJECT) {
      fail(`${[offset, '.github/workflows'].filter(Boolean).join('/')}: workflow count exceeds ${MAX_WORKFLOWS_PER_PROJECT}`)
    }
    for (const entry of workflowEntries.slice(0, MAX_WORKFLOWS_PER_PROJECT)) {
      const displayRoot = offset ? offset.split(sep).join('/') : ''
      const workflowPath = [displayRoot, '.github', 'workflows', entry.name].filter(Boolean).join('/')
      if (!entry.isFile()) {
        fail(`${workflowPath}: workflow must be a regular file and cannot be a symlink`)
        continue
      }
      let source
      try {
        const projectRelativeWorkflowPath = ['.github', 'workflows', entry.name].join('/')
        source = readProjectRegularFile(projectRoot, projectRelativeWorkflowPath, {maxBytes: MAX_WORKFLOW_BYTES})
          .toString('utf8')
      } catch (error) {
        fail(`${workflowPath}: workflow cannot be inspected safely: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }
      inspectedWorkflows += 1
      for (const finding of inspectWorkflowSecurity({
        source,
        workflowPath,
        generatedPaths: project.generatedPaths ?? null,
        trustedPromotionActions,
      })) {
        const location = finding.line ? `${workflowPath}:${finding.line}` : workflowPath
        fail(`${location}: [${finding.code}] ${finding.message}`)
      }
    }
  }
  pass(`${inspectedWorkflows} workflows checked across ${seenRoots.size} explicit project roots`)
}

export const validateWorkflowsAndEvals = ({
  claudeDirectory,
  repositoryRoot,
  pass,
  fail,
  workflowSecurityManifest = createWorkflowSecurityManifest(['.']),
}) => {
  const fullSha = 'a'.repeat(40)
  if (!isImmutableUsesTarget(`actions/checkout@${fullSha}`)) fail('workflow pin classifier rejects a full commit SHA')
  if (!isImmutableUsesTarget(`docker://alpine@sha256:${'b'.repeat(64)}`)) fail('workflow pin classifier rejects a container digest')
  for (const mutableTarget of ['actions/checkout@main', 'actions/checkout@v4', 'actions/checkout@v4.2.1', 'actions/checkout@abc1234', 'docker://alpine:3.22']) {
    if (isImmutableUsesTarget(mutableTarget)) fail(`workflow pin classifier accepts mutable target ${mutableTarget}`)
  }
  pass('workflow pin classifier self-test completed')

  validateWorkflowSecurityFixtures({claudeDirectory, pass, fail})
  validateWorkflowSecurityProjects({repositoryRoot, manifest: workflowSecurityManifest, pass, fail})

  const evalPath = join(claudeDirectory, 'evals', 'scenarios.json')
  if (!existsSync(evalPath)) {
    fail('.claude/evals/scenarios.json is missing')
  } else {
    try {
      const scenarios = JSON.parse(readFileSync(evalPath, 'utf8'))
      const scenarioIds = new Set()
      if (!Array.isArray(scenarios) || scenarios.length < 20) fail('at least twenty eval scenarios are required')
      for (const scenario of scenarios) {
        if (!scenario.id || scenarioIds.has(scenario.id)) fail(`invalid or duplicate eval id: ${scenario.id ?? '<missing>'}`)
        scenarioIds.add(scenario.id)
        if (!scenario.entrySkill || !scenario.prompt) fail(`${scenario.id}: entrySkill and prompt are required`)
        if (!Array.isArray(scenario.assertions) || scenario.assertions.length === 0) fail(`${scenario.id}: assertions are required`)
      }
      for (const routingScenario of [
        'grafana-timeseries-dashboard',
        'historical-timeseries-routing',
        'realtime-chat-routing',
        'local-domain-state-workflow',
        'preference-persistence-routing',
        'external-ingestion-static-snapshot',
        'github-actions-static-ingestion-vercel',
        'external-ingestion-selector-drift',
        'generated-artifact-missing-source',
        'qa-evidence-tamper',
      ]) {
        if (!scenarioIds.has(routingScenario)) fail(`required routing eval is missing: ${routingScenario}`)
      }
      pass(`${scenarios.length} eval scenario contracts checked`)
    } catch (error) {
      fail(`eval scenarios are not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  }


  // canonical CI 제안본(.claude/ci/<name>)이 .github/workflows/<name>로 활성 배치된 경우 두 사본은
  // 바이트 동일해야 한다 — 남은 배포 사본 표면(I4)이며, 드리프트하면 CI가 canonical과 다른 게이트를
  // 조용히 실행한다. 활성 미러가 없는 제안본(예: hybrid-t1 활성화 전)은 검사 대상이 아니다.
  const canonicalCiRoot = join(claudeDirectory, 'ci')
  if (existsSync(canonicalCiRoot)) {
    let mirroredWorkflowCount = 0
    for (const entry of readdirSync(canonicalCiRoot, {withFileTypes: true})) {
      if (!entry.isFile() || !entry.name.endsWith('.yml')) continue
      const activeMirrorPath = join(repositoryRoot, '.github', 'workflows', entry.name)
      if (!existsSync(activeMirrorPath)) continue
      mirroredWorkflowCount += 1
      if (readFileSync(join(canonicalCiRoot, entry.name), 'utf8') !== readFileSync(activeMirrorPath, 'utf8')) {
        fail(`CI_MIRROR_DRIFT: .claude/ci/${entry.name} and .github/workflows/${entry.name} have diverged — update both copies in the same commit`)
      }
    }
    pass(`${mirroredWorkflowCount} activated CI workflow mirror(s) checked against canonical proposals`)
  }
}
