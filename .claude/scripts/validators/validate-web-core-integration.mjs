import {spawnSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {detectSourceRepository} from './validate-adapter-hygiene.mjs'

export const validateWebCoreIntegration = ({repositoryRoot, pass, fail}) => {
  // console 패키지는 harness source repo에만 존재한다 — 배포된 control plane의 root
  // package.json은 대상 프로젝트의 것이므로 이 계약을 물을 대상이 아니다. 아래 하위
  // 스크립트 7종은 배포본에서도 그대로 실행한다(커버리지 유지).
  const isSourceRepository = detectSourceRepository(repositoryRoot)
  const rootPackage = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'))
  const scripts = rootPackage.scripts ?? {}
  const expectedConsoleScripts = {
    'console:check': 'pnpm --filter @web-harness/console check',
    'console:test': 'pnpm --filter @web-harness/console test',
  }
  if (isSourceRepository) {
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
  } else {
    pass('deployed control plane: console package CI wiring is a source-repo contract (skipped)')
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
