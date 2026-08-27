import {existsSync} from 'node:fs'
import {join} from 'node:path'

export const validateContentPolicy = ({repositoryRoot, activeSource, read, pass, fail}) => {
  const generatedCatalogSource = [
    '.claude/skills/project-init/assets/templates.md',
    '.claude/skills/lib-advisor/assets/setup-snippets.md',
  ]
    .filter(relativePath => existsSync(join(repositoryRoot, relativePath)))
    .map(relativePath => `${relativePath}\n${read(relativePath)}`)
    .join('\n')

  const bannedPatterns = [
    ['FID metric', /\bonFID\b/],
    ['mutable latest package tag', /@latest\b/],
    ['mutable GitHub Action major tag', /^\s*uses:\s*[^\s]+@v\d+\s*$/m],
    ['long-lived AWS access key', /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/],
    ['legacy ESLint config output', /\.eslintrc\.json/],
    ['unconditional Query boundary', /throwOnError:\s*true/],
    ['removed React Router v8 package', /react-router-dom/],
  ]
  for (const [label, pattern] of bannedPatterns) {
    if (pattern.test(`${activeSource}\n${generatedCatalogSource}`)) {
      fail(`${label} found in active harness or generated catalog content`)
    }
  }

  // Storage APIs are valid for non-sensitive browser-owned state and also appear
  // in security review instructions. Block concrete credential persistence
  // shapes instead of failing on the method name alone.
  const credentialName = String.raw`(?:access[_-]?token|refresh[_-]?token|auth[_-]?token|id[_-]?token|jwt|session[_-]?id|credential)`
  const credentialStoragePatterns = [
    new RegExp(String.raw`(?:localStorage|sessionStorage)\.(?:getItem|setItem)\(\s*['\"\x60][^'\"\x60]*(?:token|jwt|credential|session)[^'\"\x60]*['\"\x60]`, 'i'),
    new RegExp(String.raw`${credentialName}\s*=\s*(?:localStorage|sessionStorage)\.getItem\(`, 'i'),
    new RegExp(String.raw`(?:localStorage|sessionStorage)\.setItem\([^,\n]+,\s*(?:JSON\.stringify\()?\s*${credentialName}\b`, 'i'),
  ]
  const combinedSource = `${activeSource}\n${generatedCatalogSource}`
  if (credentialStoragePatterns.some(pattern => pattern.test(combinedSource))) {
    fail('credential persistence in browser storage found in active harness or generated catalog content')
  }

  const insecureCredentialFixtures = [
    "localStorage.setItem('access_token', accessToken)",
    "const refreshToken = sessionStorage.getItem('refresh-token')",
    'sessionStorage.setItem(KEY, JSON.stringify(sessionId))',
  ]
  if (insecureCredentialFixtures.some(source => !credentialStoragePatterns.some(pattern => pattern.test(source)))) {
    fail('credential storage policy does not detect its insecure fixtures')
  }
  for (const safeFixture of [
    "localStorage.setItem('theme', theme)",
    "rg -n 'localStorage.getItem|localStorage.setItem' src/",
  ]) {
    if (credentialStoragePatterns.some(pattern => pattern.test(safeFixture))) {
      fail('credential storage policy rejects a non-credential fixture')
    }
  }
  pass('stale and insecure pattern scan completed')

  // INJECTION_SUSPECT 마커 사슬 — 생산자가 없으면 release 차단 규칙이 영구 무발화된다.
  // 실사고: 계약은 마커를 요구했지만 어떤 agent도 생산하지 않아 규칙이 한 번도 발화하지 못했다.
  // 생산자·소비자·orchestrator 로드 경로를 모두 강제해 같은 단절이 재발하지 않게 한다.
  const quarantineReference = '.claude/skills/web-orchestrator/references/untrusted-content-quarantine.md'
  if (!existsSync(join(repositoryRoot, quarantineReference))) {
    fail('untrusted content quarantine contract is missing')
  } else {
    if (!read('.claude/skills/web-orchestrator/SKILL.md').includes('untrusted-content-quarantine.md')) {
      fail('.claude/skills/web-orchestrator/SKILL.md: quarantine contract is not loaded on any path')
    }
    const markerProducers = [
      // 도메인 특화 빌더 3종(enterprise-search·browser-agent·customer-support)이 2026-08-26에
      // 제거되면서 이 의무가 developer로 이관됐다 — 도메인이 아니라 **구현의 성질**에 걸리는
      // 계약이다. 외부 콘텐츠가 실행에 들어오면 누가 구현하든 마커 의무를 진다.
      '.claude/agents/developer.md',
    ]
    const markerConsumers = [
      '.claude/agents/data-quality-verifier.md',
      '.claude/agents/ai-security-reviewer.md',
    ]
    for (const agentPath of [...markerProducers, ...markerConsumers]) {
      const agentSource = read(agentPath)
      if (!agentSource.includes('INJECTION_SUSPECT')) fail(`${agentPath}: INJECTION_SUSPECT marker duty is missing`)
      if (!agentSource.includes('untrusted-content-quarantine.md')) fail(`${agentPath}: quarantine contract path is not passed`)
    }
    for (const consumerPath of markerConsumers) {
      // "마커 0건"과 "탐지 미구현"을 구분해야 한다 — 후자를 안전으로 읽으면 계약이 장식이 된다
      if (!/미구현|unimplemented/i.test(read(consumerPath))) fail(`${consumerPath}: unimplemented-detection verdict is missing`)
    }
    pass('INJECTION_SUSPECT producer/consumer chain checked')
  }

  // 레거시 `$skill` 호출 문법 잔재 — 2026-08 validate-harness 본문에서 이관(400줄 예산의 실질 해소,
  // protected-core §4: 줄 병합이 아니라 모듈 추출로 줄인다). 내용·판정은 동일.
  const invalidDollarReferences = [...activeSource.matchAll(/\$([a-z][a-z0-9-]+)/g)]
    .map(match => match[1])
    .filter(name => !['ref', 'schema', 'uri'].includes(name))
  if (invalidDollarReferences.length) {
    fail(`legacy skill invocation syntax remains: ${[...new Set(invalidDollarReferences)].join(', ')}`)
  } else {
    pass('slash-command invocation syntax checked')
  }
}
