#!/usr/bin/env node
// Claude Code 플러그인 아티팩트 빌더 — .claude/ 원본에서 dist/web-harness-plugin을 생성한다.
// 원본은 수정하지 않는다 — 산출물만 재생성한다(유일하게 남은 배포 사본 표면, I4 예산 대상).
// 산출물 레이아웃은 저장소 내부 구조를 보존해(.claude/scripts, packages/web-harness-console)
// script-relative 루트 해석과 콘솔의 상대 import가 무변경으로 동작하게 한다.
import {execFileSync} from 'node:child_process'
import {chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs'
import {basename, dirname, join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const outputRoot = resolve(repositoryRoot, process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : 'dist/web-harness-plugin')

const PLUGIN_NAME = 'web-harness'
const PLUGIN_VERSION = '0.8.0'

// 배포 메타데이터는 소스에 특정 저장소·개인을 박지 않고 환경에서 파생한다.
// WEB_HARNESS_PLUGIN_AUTHOR / _REPO_URL / _MARKETPLACE_GIT 로 override, 없으면 git remote,
// 그마저 없으면 중립 placeholder. (소스 중립 + 내부에선 remote로 올바른 값 자동 반영)
const gitRemote = () => {
  try { return execFileSync('git', ['-C', repositoryRoot, 'remote', 'get-url', 'origin'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim() } catch { return '' }
}
const remoteHttp = (() => {
  const raw = process.env.WEB_HARNESS_PLUGIN_REPO_URL || gitRemote()
  if (!raw) return '<your web-harness repository URL>'
  return raw.replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git$/, '')
})()
// author·marketplace URL도 remote에서 파생한다. 이전엔 env override가 없으면 placeholder로
// 되돌아가, `pnpm run ci`가 build-plugin을 돌 때마다 **배포 산출물의 브랜딩이 조용히 원복**됐다
// (실측: owner가 실제 소유자에서 'web-harness maintainers'로, 설치 URL이 placeholder로 회귀).
// remote에서 파생하면 소스에 특정 개인·저장소를 박지 않으면서도 재발하지 않는다.
const remoteOwner = (() => {
  const match = remoteHttp.match(/^https?:\/\/[^/]+\/([^/]+)\//)
  return match ? match[1] : ''
})()
const PLUGIN_AUTHOR = process.env.WEB_HARNESS_PLUGIN_AUTHOR || remoteOwner || 'web-harness maintainers'
const PLUGIN_REPO_URL = remoteHttp
// 관례: 마켓플레이스 저장소는 `<source repo>-plugin`. 다른 관례면 env로 override한다.
const MARKETPLACE_GIT = process.env.WEB_HARNESS_PLUGIN_MARKETPLACE_GIT
  || (remoteHttp.startsWith('http') ? `${remoteHttp}-plugin` : '<your web-harness plugin marketplace git URL>')

// 하니스 저장소 개발 전용 — 플러그인 런타임에 싣지 않는다.
const DEV_ONLY_SCRIPTS = new Set([
  'build-plugin.mjs',
  'deploy-harness.mjs',
  'run-eval-executor.mjs',
  'run-golden-profile.mjs',
  'validate-harness.mjs',
  'validate-toolchain.mjs',
])
const DEV_ONLY_SCRIPT_DIRS = new Set(['validators'])
const DEV_ONLY_SCRIPT_PATTERN = /^test-.*\.mjs$/
// 하니스 자체 개발에만 의미가 있는 표면 — 사용자 프로젝트 세션에는 싣지 않는다.
const DEV_ONLY_SKILLS = new Set()
const DEV_ONLY_AGENTS = new Set(['harness-change-reviewer.md'])

// 사용자 세션 전체에 적용해도 안전한 프로젝트-대면 훅만 배선한다.
// enforce-global-bash-policy는 하니스 저장소 개발 정책이라 의도적으로 제외한다.
const PLUGIN_HOOKS = [
  ['Read|Grep|Glob', 'enforce-sensitive-access.mjs'],
  ['Bash', 'enforce-verifier-bash.mjs'],
  ['Write|Edit', 'enforce-ai-safety.mjs'],
  ['Write|Edit', 'enforce-agent-ownership.mjs'],
  ['Write|Edit', 'enforce-release-gate.mjs'],
]

// SessionStart 안내 층 — `_workspace/`가 있는 프로젝트에서만 재진입 안내를 주입하고
// 아니면 침묵한다. matcher 없음 = startup/resume/clear/compact 전부(압축 후 재진입 포함).
const PLUGIN_SESSION_START_HOOKS = ['detect-harness-project.mjs']

const SCRIPT_INVOCATION = /node (?:"\$CLAUDE_PROJECT_DIR"\/|\{[a-zA-Z]+\}\/)?\.claude\/scripts\/([a-z0-9/-]+\.mjs)/g
const DOCUMENT_REFERENCE = /\.claude\/((?:skills|agents|adapters|schemas)\/[A-Za-z0-9._/-]*[A-Za-z0-9])/g
const RESIDUAL_REFERENCE = /\.claude\/(?:scripts|skills|agents|adapters|schemas|evals)\//g

// dev-only 스크립트 참조는 repo-only 절 제거·스킬 제외로 전부 해소된 상태를 기본으로 한다.
// 새 미해결 참조가 생기면 빌드가 실패한다.
const KNOWN_DEV_SCRIPT_REFERENCES = new Set()
const REPO_ONLY_BLOCK = /<!-- repo-only:start -->[\s\S]*?<!-- repo-only:end -->/g
const REPO_ONLY_PLACEHOLDER = '_(저장소 모드 전용 단계 — 플러그인 배포판에서는 생략한다.)_'

const transformStats = {files: 0, replacements: 0, documentReferences: 0}
const referencedScripts = new Set()
const residuals = []

const transformMarkdown = (source, relativePath) => {
  let replacements = 0
  let transformed = source.replace(REPO_ONLY_BLOCK, REPO_ONLY_PLACEHOLDER)
  transformed = transformed.replace(SCRIPT_INVOCATION, (_match, scriptPath) => {
    replacements += 1
    referencedScripts.add(scriptPath)
    return `web-harness-script ${scriptPath.replace(/\.mjs$/, '')}`
  })
  transformed = transformed.replace(DOCUMENT_REFERENCE, (_match, documentPath) => {
    transformStats.documentReferences += 1
    return `web-harness-read ${documentPath}`
  })
  if (replacements > 0) {
    transformStats.files += 1
    transformStats.replacements += replacements
  }
  const leftover = [...transformed.matchAll(RESIDUAL_REFERENCE)]
  if (leftover.length > 0) residuals.push({path: relativePath, count: leftover.length})
  return transformed
}

const copyTree = (sourceRoot, targetRoot, {transform = false, exclude = () => false} = {}) => {
  const walk = current => {
    for (const entry of readdirSync(current, {withFileTypes: true})) {
      const sourcePath = join(current, entry.name)
      const relativePath = relative(sourceRoot, sourcePath)
      if (exclude(relativePath, entry)) continue
      const targetPath = join(targetRoot, relativePath)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        walk(sourcePath)
        continue
      }
      mkdirSync(dirname(targetPath), {recursive: true})
      if (transform && /\.md$/.test(entry.name)) {
        writeFileSync(targetPath, transformMarkdown(readFileSync(sourcePath, 'utf8'), relativePath))
      } else {
        cpSync(sourcePath, targetPath)
      }
    }
  }
  walk(sourceRoot)
}

const writeExecutable = (path, content) => {
  mkdirSync(dirname(path), {recursive: true})
  writeFileSync(path, content)
  chmodSync(path, 0o755)
}

const countTree = root => {
  let files = 0
  let bytes = 0
  const walk = current => {
    for (const entry of readdirSync(current, {withFileTypes: true})) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else {
        files += 1
        bytes += statSync(path).size
      }
    }
  }
  walk(root)
  return {files, bytes}
}

rmSync(outputRoot, {recursive: true, force: true})
mkdirSync(outputRoot, {recursive: true})

// 1. 스킬·에이전트 — 스크립트 호출을 bin 디스패처로 변환해 복사한다(하니스 개발 전용 제외).
const excludeDevSkills = relativePath => DEV_ONLY_SKILLS.has(relativePath.split('/')[0])
const excludeDevAgents = relativePath => DEV_ONLY_AGENTS.has(relativePath)
copyTree(join(repositoryRoot, '.claude', 'skills'), join(outputRoot, 'skills'), {transform: true, exclude: excludeDevSkills})
copyTree(join(repositoryRoot, '.claude', 'agents'), join(outputRoot, 'agents'), {transform: true, exclude: excludeDevAgents})
// 스크립트 호환용 원본 사본 — read-skill-section 등의 .claude/skills asset 참조와
// knownAgents 해석이 플러그인 루트 기준으로 그대로 동작하게 한다.
copyTree(join(repositoryRoot, '.claude', 'skills'), join(outputRoot, '.claude', 'skills'), {exclude: excludeDevSkills})
copyTree(join(repositoryRoot, '.claude', 'agents'), join(outputRoot, '.claude', 'agents'), {exclude: excludeDevAgents})

// 배포 README 인벤토리는 산출물 실측에서 파생한다 — 하드코딩 문자열은 루트 README와 달리
// 어떤 ratchet도 대조하지 않아 스킬/에이전트 추가 시 조용히 드리프트한다(실측: team-flow 추가로
// '30 skills'가 실제 31과 어긋난 채 배포됨).
const shippedSkillCount = readdirSync(join(outputRoot, 'skills'), {withFileTypes: true})
  .filter(entry => entry.isDirectory()).length
const shippedAgentCount = readdirSync(join(outputRoot, 'agents'), {withFileTypes: true})
  .filter(entry => entry.isFile() && entry.name.endsWith('.md')).length

// 2. 런타임 스크립트 서브셋 — 저장소와 같은 .claude/scripts 위치에 둔다.
copyTree(join(repositoryRoot, '.claude', 'scripts'), join(outputRoot, '.claude', 'scripts'), {
  exclude: (relativePath, entry) => {
    const [head] = relativePath.split('/')
    if (entry.isDirectory()) return DEV_ONLY_SCRIPT_DIRS.has(head)
    if (relativePath.includes('/')) return false
    return DEV_ONLY_SCRIPTS.has(relativePath) || DEV_ONLY_SCRIPT_PATTERN.test(relativePath)
  },
})
copyTree(join(repositoryRoot, '.claude', 'adapters'), join(outputRoot, '.claude', 'adapters'))
copyTree(join(repositoryRoot, '.claude', 'schemas'), join(outputRoot, '.claude', 'schemas'))
// 스크립트가 런타임에 import.meta.url 상대 경로로 읽는 .claude 루트 카탈로그는
// 전부 배포본에 있어야 한다. 손으로 유지하던 목록이 두 번 연속 누락을 냈다 —
// substrate-defaults.json(0.3.x), shape-checks.json(0.4.0~0.4.1, 형태 층 전체가 배포본에서
// 깨져 있었다). 목록을 늘리는 대신 참조를 스캔해 강제한다.
const runtimeRootCatalogs = new Set()
for (const entry of readdirSync(join(repositoryRoot, '.claude', 'scripts'), {recursive: true})) {
  const name = String(entry)
  if (!name.endsWith('.mjs') || name === 'build-plugin.mjs') continue  // 빌더 자신은 런타임 소비자가 아니다
  const source = readFileSync(join(repositoryRoot, '.claude', 'scripts', name), 'utf8')
  for (const match of source.matchAll(/new URL\(\s*['"`]\.\.\/([\w.-]+\.json)['"`]/g)) {
    runtimeRootCatalogs.add(match[1])
  }
}
if (runtimeRootCatalogs.size === 0) {
  throw new Error('build-plugin: 런타임 카탈로그 참조를 하나도 찾지 못했다 — 스캔이 깨졌다(무산출을 통과로 만들지 않는다)')
}
for (const catalog of [...runtimeRootCatalogs].sort()) {
  const source = join(repositoryRoot, '.claude', catalog)
  if (!existsSync(source)) {
    throw new Error(`build-plugin: 스크립트가 읽는 ${catalog}가 .claude에 없다`)
  }
  cpSync(source, join(outputRoot, '.claude', catalog))
}

// 3. 콘솔 — 상대 import(../../../.claude/scripts/...)가 그대로 풀리는 위치에 복사한다.
copyTree(join(repositoryRoot, 'packages', 'web-harness-console'), join(outputRoot, 'packages', 'web-harness-console'), {
  exclude: relativePath => relativePath === '_workspace' || relativePath.startsWith('_workspace/')
    || relativePath === 'test' || relativePath.startsWith('test/'),
})

// 4. bin 디스패처 — 스킬 본문 변수 치환에 의존하지 않고 플러그인 루트를 자체 해석한다.
writeExecutable(join(outputRoot, 'bin', 'web-harness-script'), `#!/usr/bin/env bash
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
NAME="\${1:-}"
case "$NAME" in
  ''|*..*|*[!a-z0-9/-]*) echo "web-harness-script: invalid script name: $NAME" >&2; exit 2;;
esac
shift
SCRIPT="$PLUGIN_ROOT/.claude/scripts/$NAME.mjs"
if [ ! -f "$SCRIPT" ]; then
  echo "web-harness-script: not part of the plugin runtime: $NAME" >&2
  exit 2
fi
exec node "$SCRIPT" "$@"
`)
writeExecutable(join(outputRoot, 'bin', 'web-harness-console'), `#!/usr/bin/env bash
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$PLUGIN_ROOT/packages/web-harness-console/server.mjs" --root "\${CLAUDE_PROJECT_DIR:-$PWD}" "$@"
`)
writeExecutable(join(outputRoot, 'bin', 'web-harness-read'), `#!/usr/bin/env bash
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="\${1:-}"
case "$TARGET" in
  ''|/*|*..*) echo "web-harness-read: invalid path: $TARGET" >&2; exit 2;;
esac
RESOLVED="$PLUGIN_ROOT/$TARGET"
if [ -f "$RESOLVED" ]; then
  exec cat "$RESOLVED"
elif [ -d "$RESOLVED" ]; then
  exec ls -1 "$RESOLVED"
else
  echo "web-harness-read: not found in plugin payload: $TARGET" >&2
  exit 2
fi
`)

// 5. 매니페스트와 훅 배선
mkdirSync(join(outputRoot, '.claude-plugin'), {recursive: true})
writeFileSync(join(outputRoot, '.claude-plugin', 'plugin.json'), `${JSON.stringify({
  name: PLUGIN_NAME,
  description: 'Multi-agent web development harness — planning, design, implementation, QA pipeline with an approval-gated local console.',
  version: PLUGIN_VERSION,
  author: {name: PLUGIN_AUTHOR},
  license: 'MIT',
}, null, 2)}\n`)
mkdirSync(join(outputRoot, 'hooks'), {recursive: true})
writeFileSync(join(outputRoot, 'hooks', 'hooks.json'), `${JSON.stringify({
  hooks: {
    SessionStart: PLUGIN_SESSION_START_HOOKS.map(script => ({
      hooks: [{type: 'command', command: `node "\${CLAUDE_PLUGIN_ROOT}"/.claude/scripts/${script}`}],
    })),
    PreToolUse: PLUGIN_HOOKS.map(([matcher, script]) => ({
      matcher,
      hooks: [{type: 'command', command: `node "\${CLAUDE_PLUGIN_ROOT}"/.claude/scripts/${script}`}],
    })),
  },
}, null, 2)}\n`)

// 5a-1. LICENSE — 공개 배포 산출물에 라이선스 원문을 동봉한다(마켓플레이스 root + 플러그인 root).
if (existsSync(join(repositoryRoot, 'LICENSE'))) {
  cpSync(join(repositoryRoot, 'LICENSE'), join(outputRoot, 'LICENSE'))
  cpSync(join(repositoryRoot, 'LICENSE'), join(dirname(outputRoot), 'LICENSE'))
}

// 5b. 마켓플레이스 매니페스트와 배포 repo README — dist/를 marketplace root로 쓸 수 있게 한다.
// 이 랜딩 페이지는 플러그인 채택자의 첫인상 표면이므로 영어가 정본이다(M4).
writeFileSync(join(dirname(outputRoot), 'README.md'), `# web-harness plugin marketplace

Build artifact generated from [web-harness](${PLUGIN_REPO_URL}) via \`node .claude/scripts/build-plugin.mjs\`. Do not edit directly. MIT licensed.

## Install

In Claude Code:

\`\`\`
/plugin marketplace add ${MARKETPLACE_GIT}
/plugin install ${PLUGIN_NAME}@web-harness-marketplace
\`\`\`

The local Console (port 4310) and isolated preview (4311) are started against the current project by the \`web-harness-console\` executable.

## Entry-point commands

These are the commands you invoke directly. Everything else this plugin ships is an **internal building block** that the orchestrators call for you (Phase steps, companion setups, AI submodes) — they appear in the \`/${PLUGIN_NAME}:\` list but are not meant to be run standalone.

| Command | Use it to |
|---|---|
| \`/${PLUGIN_NAME}:web-orchestrator\` | Build a complete web app from a description (plan → design → dev → QA). The master entry. |
| \`/${PLUGIN_NAME}:web-plan\` | Produce or refine the plan only (planning facilitation + readiness review). |
| \`/${PLUGIN_NAME}:feature-add\` | Add one feature to a finished project (scoped plan → design → dev → QA loop). |
| \`/${PLUGIN_NAME}:team-flow\` | Ticket-based team development — batch-claim a plan into GitHub Issues on a feature branch, pick up tickets into evidence PRs. |
| \`/${PLUGIN_NAME}:pr-drafter\` | Draft a PR description from the current branch diff. |
| \`/${PLUGIN_NAME}:web-console\` | Open the approval-gated local Console for the current project. |
| \`/${PLUGIN_NAME}:project-init\` | Scaffold an empty project skeleton only (no planning/QA gates). |

First app, cost expectations, and the brownfield path: see the [quickstart](${PLUGIN_REPO_URL}/blob/main/docs/quickstart.md).

- Version: ${PLUGIN_VERSION}
- ${shippedSkillCount} skills · ${shippedAgentCount} agents · ${PLUGIN_HOOKS.length} safety hooks
- Always-on context cost ≈10k tokens/session (plus a few SessionStart re-entry lines only in \`_workspace/\` harness-managed projects) — disable when idle: \`/plugin disable ${PLUGIN_NAME}@web-harness-marketplace\`
`)


const marketplaceRoot = dirname(outputRoot)
mkdirSync(join(marketplaceRoot, '.claude-plugin'), {recursive: true})
writeFileSync(join(marketplaceRoot, '.claude-plugin', 'marketplace.json'), `${JSON.stringify({
  name: 'web-harness-marketplace',
  description: 'Distribution marketplace for the web-harness multi-agent web development plugin.',
  owner: {name: PLUGIN_AUTHOR},
  plugins: [{
    name: PLUGIN_NAME,
    source: `./${basename(outputRoot)}`,
    description: 'Multi-agent web development harness — planning, design, implementation, QA pipeline with an approval-gated local console.',
    license: 'MIT',
  }],
}, null, 2)}\n`)

// 6. 검증 — 변환된 호출이 실제로 실린 스크립트를 가리키는지 확인한다.
const missingScripts = [...referencedScripts]
  .filter(scriptPath => !existsSync(join(outputRoot, '.claude', 'scripts', scriptPath)))
  .sort()
const knownMissing = missingScripts.filter(scriptPath => KNOWN_DEV_SCRIPT_REFERENCES.has(scriptPath))
const unexpectedMissing = missingScripts.filter(scriptPath => !KNOWN_DEV_SCRIPT_REFERENCES.has(scriptPath))

const {files, bytes} = countTree(outputRoot)
process.stdout.write(`Plugin built: ${relative(repositoryRoot, outputRoot)}\n`)
process.stdout.write(`  files: ${files}, bytes: ${(bytes / 1024 / 1024).toFixed(2)} MiB\n`)
process.stdout.write(`  script invocations rewritten: ${transformStats.replacements} across ${transformStats.files} markdown files\n`)
process.stdout.write(`  document references rewritten to web-harness-read: ${transformStats.documentReferences}\n`)
process.stdout.write(`  distinct scripts referenced by skills/agents: ${referencedScripts.size}\n`)
if (knownMissing.length > 0) {
  process.stdout.write(`  known stage-2 TODO (dev-only scripts still referenced by shipped text):\n`)
  for (const scriptPath of knownMissing) process.stdout.write(`    - ${scriptPath}\n`)
}
if (unexpectedMissing.length > 0) {
  process.stdout.write(`  MISSING from runtime payload (unexpected — fix before shipping):\n`)
  for (const scriptPath of unexpectedMissing) process.stdout.write(`    - ${scriptPath}\n`)
}
if (residuals.length > 0) {
  process.stdout.write(`  residual .claude/ references (need stage-2 treatment): ${residuals.length} files\n`)
  for (const {path, count} of residuals.slice(0, 40)) process.stdout.write(`    - ${path} (${count})\n`)
  if (residuals.length > 40) process.stdout.write(`    ... and ${residuals.length - 40} more\n`)
}
if (unexpectedMissing.length > 0) process.exitCode = 1
