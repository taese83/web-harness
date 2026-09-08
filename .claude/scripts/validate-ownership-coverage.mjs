#!/usr/bin/env node
// validate-ownership-coverage.mjs — 프로필이 실제로 만드는 파일에 소유자가 있는가.
//
// **왜 있는가.** 파일럿 2가 소유 공백을 두 번 실측으로 발견했다 — 결함 13호(루트 `api/`:
// hybrid 프로필의 1급 계약 표면인데 registry에 소유자 없음)와 15호(루트 `tests/`: package
// 스크립트와 vitest include가 참조하는데 소유 패턴은 src·e2e뿐). 종합 판정이 이렇게 적었다:
//
//   "greenfield 프로필이 계약상 생성하는 최상위 디렉토리 전수와 registry 소유의 **대조표가
//    없어 공백이 하나씩 실측으로만 발견되고 있다** — 프로필별 소유 커버리지 게이트가 구조적
//    해법 후보"
//
// 이 스크립트가 그 대조표다. **선언을 새로 만들지 않는다** — 프로필이 무엇을 만드는지는
// `golden/` 트리가 이미 실물로 말하고 있고(그 자체가 CI 검증 대상), 소유는
// `AGENT_OWNERSHIP`(정적) ∪ `resolveDeveloperOwnership`(spec의 layerMap)이 말한다.
// 새 선언 표면을 늘리지 않는 것이 I4다.
//
// **한계(정직)**: `golden/`에 없는 경로는 보지 않는다. 골든이 프로필의 전수 표면이라는 보장은
// 없으며, 실제 프로젝트가 골든에 없는 디렉토리를 만들면 이 게이트는 침묵한다. 그리고 spec이
// 없는 골든은 **미측정**이다 — layerMap 없이 developer 소유를 알 수 없고, 모르는 것을
// 통과시키지 않는다(`docs/protected-core.md` §4 등록).
import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {AGENT_OWNERSHIP, resolveDeveloperOwnership} from './agent-registry.mjs'

const REPOSITORY_ROOT = fileURLToPath(new URL('../..', import.meta.url))

// 빌드 산출·의존성·하네스 작업공간은 에이전트가 쓰는 소스가 아니다. `.vite`·`coverage`처럼
// 도구가 만드는 캐시가 골든에 섞여 들어오면 소유를 물을 대상이 아니다.
const NOT_AUTHORED = new Set([
  'node_modules', 'dist', 'build', '.git', '_workspace', '.turbo', '.next', '.vite',
  'coverage', 'test-results', 'playwright-report', '.vercel',
])

const walk = (root, rel = '') => {
  const entries = readdirSync(join(root, rel), {withFileTypes: true})
  const out = []
  for (const entry of entries) {
    if (NOT_AUTHORED.has(entry.name)) continue
    const next = rel === '' ? entry.name : `${rel}/${entry.name}`
    if (entry.isDirectory()) out.push(...walk(root, next))
    else out.push(next)
  }
  return out
}

export const ownersOf = (relativePath, developerPatterns) => {
  const owners = Object.entries(AGENT_OWNERSHIP)
    .filter(([, patterns]) => patterns.some(pattern => pattern.test(relativePath)))
    .map(([agent]) => agent)
  if (developerPatterns.some(pattern => pattern.test(relativePath))) owners.push('developer')
  return owners
}

export function auditProfileOwnership(goldenRoot) {
  if (!existsSync(goldenRoot)) return {measured: false, reason: '골든 트리가 없다', gaps: [], files: 0}
  const specPath = join(goldenRoot, '_workspace/03_dev/spec.json')
  if (!existsSync(specPath)) {
    // **통과가 아니라 미수행이다.** layerMap 없이는 developer 소유를 알 수 없고, 모르는 것을
    // 소유 공백으로도 소유 있음으로도 세지 않는다.
    return {measured: false, reason: '`_workspace/03_dev/spec.json`이 없어 layerMap을 읽지 못한다', gaps: [], files: 0}
  }
  const spec = JSON.parse(readFileSync(specPath, 'utf8'))
  const developerPatterns = resolveDeveloperOwnership(spec) ?? []
  const files = walk(goldenRoot)
  const gaps = files.filter(file => ownersOf(file, developerPatterns).length === 0)
  return {measured: true, reason: '', gaps, files: files.length}
}

const PROFILES = ['react-vite-spa', 'vite-serverless-hybrid']

export function auditAllProfiles(repositoryRoot = REPOSITORY_ROOT) {
  return PROFILES.map(profile => ({profile, ...auditProfileOwnership(join(repositoryRoot, 'golden', profile))}))
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = auditAllProfiles()
  let failed = 0
  for (const result of results) {
    if (!result.measured) {
      console.log(`⏭️  ${result.profile}: 미측정 — ${result.reason} (통과가 아니다)`)
      continue
    }
    if (result.gaps.length === 0) {
      console.log(`✅ ${result.profile}: 파일 ${result.files}건 전부 소유자가 있다`)
      continue
    }
    failed += 1
    console.log(`❌ ${result.profile}: 소유 공백 ${result.gaps.length}건 / 파일 ${result.files}건`)
    for (const gap of result.gaps) console.log(`   · ${gap}`)
    console.log('   → `.claude/scripts/agent-registry.mjs`의 소유자에게 패턴을 추가하되,')
    console.log('     **매칭됨만이 아니라 타 소유와 안 겹침을 증명한다**(파일럿 결함 13호 교훈 — positive-only 회귀는 정밀성 착시다).')
  }
  process.exit(failed === 0 ? 0 : 1)
}
