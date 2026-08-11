import {spawnSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'

export const validateWebCoreIntegration = ({repositoryRoot, pass, fail}) => {
  const rootPackage = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'))
  const scripts = rootPackage.scripts ?? {}
  const expectedConsoleScripts = {
    'console:check': 'pnpm --filter @web-harness/console check',
    'console:test': 'pnpm --filter @web-harness/console test',
  }
  for (const [scriptName, expected] of Object.entries(expectedConsoleScripts)) {
    if (scripts[scriptName] !== expected) {
      fail(`root package script ${scriptName} must be exactly: ${expected}`)
    }
  }
  const ciScript = scripts.ci ?? ''
  const checkIndex = ciScript.indexOf('pnpm run console:check')
  const testIndex = ciScript.indexOf('pnpm run console:test')
  if (checkIndex < 0 || testIndex < 0 || checkIndex > testIndex) {
    fail('root ci must run console:check before console:test')
  } else {
    pass('Console package checks are wired into root CI')
  }

  for (const [label, relativeScript] of [
    ['global Bash policy fixtures', '.claude/scripts/validators/validate-global-bash-policy.mjs'],
    ['design preview traceability', '.claude/scripts/test-design-preview.mjs'],
    ['dual-profile adapter core', '.claude/scripts/web-core/test-web-core.mjs'],
    ['Vercel provider config', '.claude/scripts/web-core/test-vercel-config.mjs'],
    ['static runtime data deployment', '.claude/scripts/test-runtime-data-deployment.mjs'],
    ['Vercel static ingestion build', '.claude/scripts/test-vercel-static-ingestion-build.mjs'],
    ['Next.js adapter contracts', '.claude/scripts/web-core/validate-next-contracts.mjs'],
  ]) {
    const result = spawnSync(process.execPath, [join(repositoryRoot, relativeScript)], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    })
    if (result.status !== 0) {
      fail(`${label} failed: ${(result.stderr || result.stdout || `exit ${result.status}`).trim()}`)
    } else {
      pass(`${label} checked`)
    }
  }
}
