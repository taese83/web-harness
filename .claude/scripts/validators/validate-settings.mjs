import {spawnSync} from 'node:child_process'
import {join} from 'node:path'

export const validateSettings = ({claudeDirectory, repositoryRoot, read, pass, fail}) => {
  try {
    const settings = JSON.parse(read('.claude/settings.json'))
    const hookSource = JSON.stringify(settings.hooks ?? {})
    if (!hookSource.includes('enforce-global-bash-policy.mjs')) fail('Claude settings do not register global Bash enforcement')
    if (!hookSource.includes('enforce-agent-ownership.mjs')) fail('Claude settings do not register ownership enforcement')
    if (!hookSource.includes('enforce-verifier-bash.mjs')) fail('Claude settings do not register verifier Bash enforcement')
    if (!hookSource.includes('enforce-ai-safety.mjs')) fail('Claude settings do not register AI safety enforcement')
    if (!hookSource.includes('enforce-release-gate.mjs')) fail('Claude settings do not register release gate enforcement')
    if (!hookSource.includes('enforce-sensitive-access.mjs')) fail('Claude settings do not register sensitive access enforcement')
    const allowRules = settings.permissions?.allow ?? []
    if (allowRules.includes('Bash(node .claude/scripts/run-quality-gates.mjs*)')) {
      fail('Claude settings auto-allow generated project scripts through the quality runner')
    }
    for (const requiredRule of [
      'Bash(node .claude/scripts/validate-toolchain.mjs*)',
      'Bash(node .claude/scripts/validate-release-gate.mjs*)',
    ]) {
      if (!allowRules.includes(requiredRule)) fail(`Claude settings are missing ${requiredRule}`)
    }
    const forbiddenAllowRules = [
      /^Bash\(pnpm exec \*\)$/,
      /^Bash\(pnpm rebuild \*\)$/,
      /^Bash\(pnpm dlx\b/,
      /^Bash\([^)]*node_modules\/[^)]*\/install\.js[^)]*\)$/,
      /^Bash\(node -e\b/,
    ]
    for (const rule of allowRules) {
      if (forbiddenAllowRules.some(pattern => pattern.test(rule))) {
        fail(`Claude settings contain an unsafe broad execution rule: ${rule}`)
      }
    }
    if (allowRules.includes('Edit(/.claude/skills/**)')) {
      for (const rule of allowRules.filter(rule => rule.startsWith('Edit(/.claude/skills/'))) {
        if (rule !== 'Edit(/.claude/skills/**)') fail(`Claude settings contain a redundant skill Edit rule: ${rule}`)
      }
    }
    if ((settings.permissions?.additionalDirectories ?? []).length > 0) {
      fail('Claude maintainer settings contain project-specific additionalDirectories')
    }
    for (const rule of allowRules) {
      if (/vercel|pnpm --filter|git (?:add|commit|push)|kill -9|lsof -ti/i.test(rule)) {
        fail(`Claude maintainer settings contain a project-specific or dangerous rule: ${rule}`)
      }
    }
    const projectSettings = JSON.parse(read('.claude/settings.project.json'))
    const projectAllowRules = projectSettings.permissions?.allow ?? []
    const projectDenyRules = projectSettings.permissions?.deny ?? []
    if (projectAllowRules.includes('Bash(node .claude/scripts/run-quality-gates.mjs*)')) {
      fail('Project settings auto-allow generated project scripts through the quality runner')
    }
    if (projectAllowRules.some(rule => /^(?:Edit|Write)\(\/?\.claude\//.test(rule))) {
      fail('Project settings allow the generated app to modify its Claude control plane')
    }
    for (const requiredDeny of ['Edit(.claude/**)', 'Write(.claude/**)']) {
      if (!projectDenyRules.includes(requiredDeny)) fail(`Project settings are missing ${requiredDeny}`)
    }
    for (const [label, source] of [['maintainer', settings], ['project', projectSettings]]) {
      for (const requiredDeny of ['Read(**/.env.*)', 'Read(**/.dev.vars)', 'Read(**/.docker/config.json)']) {
        if (!(source.permissions?.deny ?? []).includes(requiredDeny)) fail(`${label} settings are missing ${requiredDeny}`)
      }
    }
    const projectHookSource = JSON.stringify(projectSettings.hooks ?? {})
    for (const requiredHook of ['enforce-global-bash-policy.mjs', 'enforce-agent-ownership.mjs', 'enforce-verifier-bash.mjs', 'enforce-sensitive-access.mjs', 'enforce-ai-safety.mjs', 'enforce-release-gate.mjs']) {
      if (!projectHookSource.includes(requiredHook)) fail(`Project settings do not register ${requiredHook}`)
    }
    for (const [label, source] of [['maintainer', settings], ['project', projectSettings]]) {
      const bashHooks = (source.hooks?.PreToolUse ?? []).find(entry => entry.matcher === 'Bash')?.hooks ?? []
      if (!bashHooks[0]?.command?.includes('enforce-global-bash-policy.mjs')) {
        fail(`${label} settings must run global Bash enforcement before narrower Bash hooks`)
      }
    }
    const sensitiveHookPath = join(claudeDirectory, 'scripts/enforce-sensitive-access.mjs')
    const runSensitiveHook = (toolName, toolInput) => spawnSync(process.execPath, [sensitiveHookPath], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {...process.env, CLAUDE_PROJECT_DIR: repositoryRoot},
      input: JSON.stringify({tool_name: toolName, tool_input: toolInput}),
    })
    if (runSensitiveHook('Read', {file_path: '.env.staging'}).status !== 2) fail('sensitive access hook allowed an environment file')
    if (runSensitiveHook('Grep', {path: '.', pattern: 'token'}).status !== 2) fail('sensitive access hook allowed recursive root Grep')
    if (runSensitiveHook('Grep', {path: '.claude/scripts', pattern: 'token'}).status !== 0) fail('sensitive access hook blocked a bounded code Grep')
    if (runSensitiveHook('Glob', {path: '.', pattern: '**/.env*'}).status !== 2) fail('sensitive access hook allowed a secret Glob')
    pass('Claude maintainer/project settings JSON checked')
  } catch (error) {
    fail(`Claude settings JSON is invalid: ${error instanceof Error ? error.message : String(error)}`)
  }
}
