import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {orchestrationSurface} from './orchestration-surface.mjs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {sha256} from '../evidence-lib.mjs'
import {analyzePackageScript, hasMeaningfulProfileScript} from '../quality-policy-lib.mjs'
import {
  VISUAL_CONTRACT_PATH,
  VISUAL_MANIFEST_PATH,
  collectVisualEvidence,
} from '../visual-evidence-lib.mjs'
import {DESIGN_BINDING_PATH} from '../design-binding-lib.mjs'

const writeJson = (root, relativePath, value) => {
  const absolutePath = join(root, relativePath)
  mkdirSync(join(absolutePath, '..'), {recursive: true})
  writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`)
}

const validContract = baselinePath => ({
  schemaVersion: 1,
  renderProfile: {
    browser: 'chromium',
    deviceScaleFactor: 1,
    locale: 'ko-KR',
    timezone: 'Asia/Seoul',
    animations: 'disabled',
    waitForFonts: true,
    reflowCssWidth: 320,
    zoomEquivalentPercent: 400,
  },
  thresholds: {maxDiffPixels: 0, maxDiffPixelRatio: 0, threshold: 0.2},
  stability: {freezeClock: true, deterministicData: true, clsMax: 0.1},
  baselinePolicy: {
    approvalRequired: true,
    verifierMayUpdate: false,
    manifestPath: VISUAL_MANIFEST_PATH,
  },
  references: [
    {id: 'approved-prototype', kind: 'none', locator: 'Phase 2 rendered prototype'},
    {id: 'order-detail', kind: 'figma-node', locator: 'node-id=412:9037'},
  ],
  modes: [
    {id: 'reflow-light', width: 320, height: 800, colorScheme: 'light', reducedMotion: 'reduce', forcedColors: 'none'},
    {id: 'desktop-light', width: 1280, height: 900, colorScheme: 'light', reducedMotion: 'reduce', forcedColors: 'none'},
  ],
  targets: [{
    id: 'home-default',
    kind: 'route',
    locator: '/home',
    state: 'default',
    modeIds: ['reflow-light', 'desktop-light'],
    baselinePath,
    referenceId: 'approved-prototype',
    blocking: true,
  }],
})

// 하나의 화면이 조건에 따라 여러 근거를 갖는 형태를 fixture로 고정한다 — 공급된 default,
// 파생하는 empty, 재사용하는 모바일. 셋이 한 PAGE 아래 병존하는 것이 정상 형태다.
const validBinding = () => ({
  schemaVersion: 1,
  references: [{
    id: 'order-detail',
    kind: 'figma-node',
    locator: 'node-id=412:9037',
    snapshot: '_workspace/00_source/figma-fixture-412-9037.md',
    capturedAt: '2026-01-01T00:00:00.000Z',
  }],
  bindings: [
    {pageGroup: 'PAGE-001', condition: {state: 'default'}, referenceIds: ['order-detail'], declaredBy: 'user', declaredAt: '2026-01-01T00:00:00.000Z'},
    {pageGroup: 'PAGE-001', condition: {state: 'empty'}, referenceIds: [], resolution: 'derive', declaredBy: 'user', declaredAt: '2026-01-01T00:00:00.000Z'},
    {pageGroup: 'PAGE-001', condition: {modeId: 'reflow-light'}, referenceIds: [], resolution: 'reuse:order-detail', declaredBy: 'user', declaredAt: '2026-01-01T00:00:00.000Z'},
  ],
  unbound: {references: [], pageGroups: []},
})

export const validateVisualDesign = ({repositoryRoot, read, pass, fail}) => {
  for (const relativePath of [
    '.claude/skills/visual-design-verify/SKILL.md',
    '.claude/skills/visual-design-verify/references/visual-qa-contract.md',
    '.claude/skills/visual-design-verify/references/render-matrix.md',
    '.claude/skills/visual-design-verify/references/baseline-governance.md',
    '.claude/agents/visual-contract-designer.md',
    '.claude/agents/visual-baseline-manager.md',
    '.claude/agents/visual-regression-verifier.md',
    '.claude/schemas/visual-qa-contract.schema.json',
    '.claude/schemas/visual-baseline-manifest.schema.json',
    '.claude/schemas/design-binding.schema.json',
    '.claude/skills/web-orchestrator/references/design-binding-contract.md',
  ]) {
    try {
      readFileSync(join(repositoryRoot, relativePath))
    } catch {
      fail(`${relativePath}: required visual QA harness file is missing`)
    }
  }

  for (const relativePath of [
    '.claude/schemas/visual-qa-contract.schema.json',
    '.claude/schemas/visual-baseline-manifest.schema.json',
    '.claude/schemas/design-binding.schema.json',
  ]) {
    try {
      JSON.parse(read(relativePath))
    } catch (error) {
      fail(`${relativePath}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const orchestration = `${orchestrationSurface(repositoryRoot)}\n${read('.claude/skills/web-verify/SKILL.md')}`
  for (const marker of [
    'VISUAL_QA_MODE',
    'visual-contract-designer',
    'developer',
    'visual-regression-verifier',
    'qa-visual.md',
    'visualEvidence',
  ]) {
    if (!orchestration.includes(marker)) fail(`visual QA orchestration is missing ${marker}`)
  }
  for (const marker of ['toHaveScreenshot', 'reflow-320', 'VISUAL_E2E', 'document.fonts.ready']) {
    if (!read('.claude/skills/project-init/assets/templates.md').includes(marker)) {
      fail(`project visual template is missing ${marker}`)
    }
  }
  for (const [relativePath, markers] of [
    ['.claude/scripts/release-report-policy.mjs', ['VISUAL_REPORTS', 'qa-visual.md']],
    ['.claude/scripts/release-gate-lib.mjs', ['visual-qa-contract.json']],
    ['.claude/scripts/receipt-validation-lib.mjs', ['collectVisualEvidence', 'visualEvidenceMatches']],
    ['.claude/scripts/run-quality-gates.mjs', ['visualEvidenceBefore', 'visualEvidenceAfter']],
  ]) {
    const source = read(relativePath)
    for (const marker of markers) {
      if (!source.includes(marker)) fail(`${relativePath}: visual release evidence is missing ${marker}`)
    }
  }

  const validBrowserScript = 'playwright test'
  const updateBrowserScripts = [
    'playwright test --update-snapshots',
    'playwright test --update-snapshots=all',
    'playwright test -u',
  ]
  if (!hasMeaningfulProfileScript('vite.browser', {kind: 'browser'}, validBrowserScript, analyzePackageScript(validBrowserScript))) {
    fail('quality policy rejects a normal Playwright browser command')
  }
  for (const source of updateBrowserScripts) {
    if (hasMeaningfulProfileScript('vite.browser', {kind: 'browser'}, source, analyzePackageScript(source))) {
      fail(`quality policy allows snapshot update in a verifier quality command: ${source}`)
    }
  }

  const fixtureRoot = mkdtempSync(join(tmpdir(), 'web-harness-visual-'))
  try {
    const absent = collectVisualEvidence(fixtureRoot)
    if (absent.required || absent.errors.length) fail('visual evidence is not optional when no contract exists')

    const baselinePath = 'e2e/home.visual.spec.ts-snapshots/home-default.png'
    const testPath = 'e2e/home.visual.spec.ts'
    mkdirSync(join(fixtureRoot, 'e2e/home.visual.spec.ts-snapshots'), {recursive: true})
    writeFileSync(join(fixtureRoot, testPath), "test('visual', async ({page}) => expect(page).toHaveScreenshot('home-default.png'))\n")
    const png = Buffer.from('approved-visual-baseline')
    writeFileSync(join(fixtureRoot, baselinePath), png)
    writeJson(fixtureRoot, VISUAL_CONTRACT_PATH, validContract(baselinePath))
    writeJson(fixtureRoot, VISUAL_MANIFEST_PATH, {
      schemaVersion: 1,
      baselines: [{
        targetId: 'home-default',
        path: baselinePath,
        sha256: sha256(png),
        approvedBy: 'design-reviewer@example.test',
        approvedAt: '2026-01-01T00:00:00.000Z',
        reason: 'Approved initial rendered prototype',
        referenceId: 'approved-prototype',
      }],
    })
    const valid = collectVisualEvidence(fixtureRoot, [testPath])
    if (!valid.required || valid.errors.length || valid.assertions[0]?.count !== 1 || valid.baselines.length !== 1) {
      fail(`valid visual evidence fixture was rejected: ${valid.errors.join('; ')}`)
    }

    // 공급된 디자인 근거의 결속. 배선이 살아 있는지를 fixture로 확인한다 — lib 회귀만
    // 있으면 호출부가 끊겨도 조용히 green이 된다(wiring-coverage가 등록한 클래스).
    mkdirSync(join(fixtureRoot, '_workspace/00_source'), {recursive: true})
    writeFileSync(join(fixtureRoot, '_workspace/00_source/figma-fixture-412-9037.md'), '# snapshot\n')
    writeJson(fixtureRoot, DESIGN_BINDING_PATH, validBinding())
    const bound = collectVisualEvidence(fixtureRoot, [testPath])
    if (bound.errors.some(error => error.includes(DESIGN_BINDING_PATH))) {
      fail(`valid design binding fixture was rejected: ${bound.errors.join('; ')}`)
    }

    const forged = validBinding()
    forged.references[0].sha256 = 'a'.repeat(64)
    writeJson(fixtureRoot, DESIGN_BINDING_PATH, forged)
    if (!collectVisualEvidence(fixtureRoot, [testPath]).errors.some(error => error.includes('sha256을 적을 수 없다'))) {
      fail('design binding accepts a fabricated hash on a figma-node reference')
    }

    const diverged = validBinding()
    diverged.references[0].locator = 'node-id=999:1'
    writeJson(fixtureRoot, DESIGN_BINDING_PATH, diverged)
    if (!collectVisualEvidence(fixtureRoot, [testPath]).errors.some(error => error.includes('다른 것을 가리킨다'))) {
      fail('design binding and visual contract may claim different things under one reference id')
    }
    writeJson(fixtureRoot, DESIGN_BINDING_PATH, validBinding())

    // 상류 reference를 통째로 복사하면 스키마상 무효한 계약이 된다 — 그 형태가 실제로 거부되는지
    // 배선으로 확인한다(에이전트 지침이 "세 값만 옮긴다"로 좁혀진 근거).
    const copiedWholesale = validContract(baselinePath)
    copiedWholesale.references[1] = {...validBinding().references[0]}
    writeJson(fixtureRoot, VISUAL_CONTRACT_PATH, copiedWholesale)
    if (!collectVisualEvidence(fixtureRoot, [testPath]).errors.some(error => error.includes('unknown keys'))) {
      fail('visual contract accepts design-binding-only fields copied into a reference')
    }
    writeJson(fixtureRoot, VISUAL_CONTRACT_PATH, validContract(baselinePath))

    writeFileSync(join(fixtureRoot, baselinePath), Buffer.from('tampered-baseline'))
    const tampered = collectVisualEvidence(fixtureRoot, [testPath])
    if (!tampered.errors.some(error => error.includes('baseline hash differs'))) {
      fail('visual evidence accepts a baseline that differs from the approved manifest')
    }
  } finally {
    rmSync(fixtureRoot, {recursive: true, force: true})
  }

  const scenarios = JSON.parse(read('.claude/evals/scenarios.json'))
  for (const id of ['visual-baseline-tamper', 'visual-render-matrix', 'visual-source-token-drift']) {
    if (!scenarios.some(scenario => scenario.id === id)) fail(`required visual eval is missing: ${id}`)
  }
  pass('visual contract, baseline governance, render matrix, and evidence fixtures checked')
}
