#!/usr/bin/env node
// test-ownership-hook.mjs — 소유권 훅 **스크립트**의 회귀.
//
// 왜 별도 파일인가: `test-spec-ownership.mjs`는 `agent-registry.mjs`의 순수 함수를 직접 부른다.
// 훅 스크립트(`enforce-agent-ownership.mjs`)가 그 함수들에 **무엇을 넘기는지**는 아무도 시험하지
// 않았고, 그래서 중첩 프로젝트에서 스팩을 엉뚱한 root에서 읽는 결함이 살아남았다(2026-08-30).
// "배선을 시험하는 회귀가 없으면 배선은 조용히 끊긴다" — protected-core §4에 이미 등록된 교훈이다.
//
// 여기서 고정하는 사실:
//   (1) 프로젝트 root 밖 쓰기는 차단된다
//   (2) `workspace/<project>/` 중첩에서 스팩·범위를 **같은 root**에서 읽는다
//   (3) 스팩이 없는 developer는 무엇이 없어서 막혔는지 말한다
//   (4) change-scope의 ALLOWED_PATHS가 중첩에서도 실제로 좁힌다 — 마크다운 줄·JSON 배열 양쪽
//   (5) 범위를 **판정할 수 없으면** 넓히지 않는다 — 깨진 JSON은 block이지 무제한이 아니다
//   (6) 오케스트레이터 산출물은 스팩·범위보다 앞서 막힌다 — 스팩 자기수정으로 소유권을 못 넓힌다
import assert from 'node:assert/strict'
import test from 'node:test'
import {execFileSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'

const HOOK = new URL('./enforce-agent-ownership.mjs', import.meta.url).pathname

// 훅을 실제 프로세스로 돌린다. exit 0 = 허용, exit 2 = 차단(stderr에 사유).
const runHook = ({cwd, agentType, filePath}) => {
  const payload = JSON.stringify({tool_name: 'Write', agent_type: agentType, cwd, tool_input: {file_path: filePath}})
  try {
    execFileSync(process.execPath, [HOOK], {input: payload, cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']})
    return {allowed: true, message: ''}
  } catch (error) {
    return {allowed: false, message: String(error.stderr ?? '')}
  }
}

const SPEC = {
  schemaVersion: 2,
  layerMap: {domainModel: 'src/entities', composedUI: 'src/widgets', serverlessApi: 'api'},
  testLayers: {unit: 'src', e2e: 'e2e'},
}

// 하네스 root와 그 안에 중첩된 프로젝트를 만든다. **하네스 root에는 `_workspace/`를 두지 않는다** —
// 실제 배치가 그렇고, 결함이 바로 그 부재 위에서 났다.
const withNestedProject = (run, {scope = null, spec = SPEC, scopeForm = 'json', rawScope = null} = {}) => {
  // macOS tmpdir은 심볼릭 링크(/var → /private/var)다. 훅이 root를 realpath로 정규화하므로
  // 테스트도 같은 표기를 써야 한다 — 아니면 모든 경로가 '루트 밖'으로 보인다.
  const harnessRoot = realpathSync(mkdtempSync(join(tmpdir(), 'web-harness-hook-')))
  try {
    const projectRelative = 'workspace/demo'
    const projectRoot = join(harnessRoot, projectRelative)
    mkdirSync(join(projectRoot, '_workspace/03_dev'), {recursive: true})
    if (spec) writeFileSync(join(projectRoot, '_workspace/03_dev/spec.json'), JSON.stringify(spec))
    if (rawScope !== null) writeFileSync(join(projectRoot, '_workspace/03_dev/change-scope.md'), rawScope)
    if (scope) {
      // 기본은 **JSON 배열만** 적는다 — 실측 writer가 내는 형태이고, 처음 넣은 폴백이 정작
      // 이 형태에서 죽어 있었다. 마크다운 줄 형태는 별도 테스트가 따로 고정한다.
      const body = scopeForm === 'markdown'
        ? ['# change-scope', '', `- **ALLOWED_PATHS**: ${scope.join(', ')}`, ''].join('\n')
        : ['# change-scope', '', '```json change-scope', JSON.stringify({ALLOWED_PATHS: scope}, null, 2), '```', ''].join('\n')
      writeFileSync(join(projectRoot, '_workspace/03_dev/change-scope.md'), body)
    }
    return run({harnessRoot, projectRoot})
  } finally {
    rmSync(harnessRoot, {recursive: true, force: true})
  }
}

// ── (1) 루트 이탈 ────────────────────────────────────────────────────────────
test('프로젝트 root 밖으로는 쓰지 못한다', () => {
  withNestedProject(({harnessRoot}) => {
    const result = runHook({cwd: harnessRoot, agentType: 'developer', filePath: join(realpathSync(tmpdir()), 'elsewhere.ts')})
    assert.equal(result.allowed, false)
    assert.match(result.message, /outside the project root/)
  })
})

// ── (2) 중첩 프로젝트의 스팩 해소 ────────────────────────────────────────────
// 결함 재현: 쓰기 경로만 `workspace/<project>/` 접두를 벗기고 스팩은 하네스 root에서 읽으면,
// 스팩을 확정해도 developer가 영원히 막힌다.
test('중첩 프로젝트의 스팩이 소유권을 공급한다 — 하네스 root가 아니라 프로젝트 root에서 읽는다', () => {
  withNestedProject(({harnessRoot, projectRoot}) => {
    const result = runHook({
      cwd: harnessRoot,
      agentType: 'developer',
      filePath: join(projectRoot, 'src/entities/track/model/schema.ts'),
    })
    assert.equal(result.allowed, true, `중첩 프로젝트에서 스팩이 안 읽혔다: ${result.message}`)
  })
})

test('스팩 layerMap 밖은 중첩에서도 여전히 막힌다', () => {
  withNestedProject(({harnessRoot, projectRoot}) => {
    const result = runHook({cwd: harnessRoot, agentType: 'developer', filePath: join(projectRoot, 'docs/notes.md')})
    assert.equal(result.allowed, false)
    assert.match(result.message, /does not own docs\/notes\.md/)
  })
})

test('중첩 경로 판정은 프로젝트 root 기준이다 — 접두가 사유 문구에 새지 않는다', () => {
  withNestedProject(({harnessRoot, projectRoot}) => {
    const result = runHook({cwd: harnessRoot, agentType: 'developer', filePath: join(projectRoot, 'docs/notes.md')})
    assert.ok(!result.message.includes('workspace/demo'), `사유가 하네스 상대 경로를 노출한다: ${result.message}`)
  })
})

// ── (3) 스팩 부재의 안내 ─────────────────────────────────────────────────────
test('스팩이 없는 developer는 무엇이 없어서 막혔는지 말한다', () => {
  withNestedProject(({harnessRoot, projectRoot}) => {
    const result = runHook({cwd: harnessRoot, agentType: 'developer', filePath: join(projectRoot, 'src/entities/x.ts')})
    assert.equal(result.allowed, false)
    assert.match(result.message, /spec lock is missing/)
    assert.match(result.message, /_workspace\/03_dev\/spec\.json/)
  }, {spec: null})
})

// ── (4) 스폰 범위가 중첩에서도 좁힌다 ────────────────────────────────────────
// 이 방향이 더 나쁘다: 범위를 못 읽으면 **조용히 넓어진다**. 실패가 시끄럽지 않다.
test('중첩 프로젝트의 change-scope가 실제로 범위를 좁힌다', () => {
  withNestedProject(({harnessRoot, projectRoot}) => {
    const inScope = runHook({cwd: harnessRoot, agentType: 'developer', filePath: join(projectRoot, 'src/entities/track/model/t.ts')})
    assert.equal(inScope.allowed, true, `범위 안인데 막혔다: ${inScope.message}`)
    const outOfScope = runHook({cwd: harnessRoot, agentType: 'developer', filePath: join(projectRoot, 'src/widgets/canvas/ui/C.tsx')})
    assert.equal(outOfScope.allowed, false, 'layerMap에는 있지만 스폰 범위 밖인데 통과했다 — 범위가 미적용이다')
  }, {scope: ['src/entities/track/']})
})

test('마크다운 한 줄 표기도 같은 결과를 낸다 — 두 표기가 갈리지 않는다', () => {
  withNestedProject(({harnessRoot, projectRoot}) => {
    const inScope = runHook({cwd: harnessRoot, agentType: 'developer', filePath: join(projectRoot, 'src/entities/track/model/t.ts')})
    assert.equal(inScope.allowed, true, `범위 안인데 막혔다: ${inScope.message}`)
    const outOfScope = runHook({cwd: harnessRoot, agentType: 'developer', filePath: join(projectRoot, 'src/widgets/canvas/ui/C.tsx')})
    assert.equal(outOfScope.allowed, false)
  }, {scope: ['src/entities/track/'], scopeForm: 'markdown'})
})

// ── (4b) 승자가 문서 편집 순서에 좌우되지 않는다 ────────────────────────────
// 실물 change-scope.md는 ALLOWED_PATHS를 3번 담는다(산문·JSON 펜스·마크다운 줄). 종전 추출은
// "문서에서 처음 나오는 곳"을 잡아서, 산문이 앞에 있으면 그것이 이겼다.
test('산문이 앞서 있어도 change-scope 펜스가 정본이다', () => {
  const raw = [
    '# change-scope',
    '',
    'ALLOWED_PATHS: 아래 블록에 적는다(이 줄은 설명이다).',
    '- **ALLOWED_PATHS**: src/widgets/',
    '',
    '```json change-scope',
    JSON.stringify({ALLOWED_PATHS: ['src/entities/track/']}, null, 2),
    '```',
    '',
  ].join('\n')
  withNestedProject(({harnessRoot, projectRoot}) => {
    const inFence = runHook({cwd: harnessRoot, agentType: 'developer', filePath: join(projectRoot, 'src/entities/track/m/t.ts')})
    assert.equal(inFence.allowed, true, `펜스가 정본이어야 한다: ${inFence.message}`)
    const inProse = runHook({cwd: harnessRoot, agentType: 'developer', filePath: join(projectRoot, 'src/widgets/c/C.tsx')})
    assert.equal(inProse.allowed, false, '산문/마크다운 줄이 펜스를 이겼다 — 승자가 편집 순서에 좌우된다')
  }, {rawScope: raw})
})

test('민무늬 한 줄 표기도 읽는다 — 별표를 요구해 범위가 사라지지 않는다', () => {
  const raw = ['# change-scope', '', 'ALLOWED_PATHS: src/entities/track/', ''].join('\n')
  withNestedProject(({harnessRoot, projectRoot}) => {
    // 양방향으로 조인다 — 차단만 보면 "스팩을 아예 못 읽어서 막힌 것"과 구분되지 않는다.
    const inScope = runHook({cwd: harnessRoot, agentType: 'developer', filePath: join(projectRoot, 'src/entities/track/m/t.ts')})
    assert.equal(inScope.allowed, true, `범위 안인데 막혔다: ${inScope.message}`)
    const outOfScope = runHook({cwd: harnessRoot, agentType: 'developer', filePath: join(projectRoot, 'src/widgets/c/C.tsx')})
    assert.equal(outOfScope.allowed, false, '별표 없는 표기를 못 읽어 범위가 통째로 사라졌다')
  }, {rawScope: raw})
})

// ── (5) 판정 불가는 확대가 아니다 ───────────────────────────────────────────
test('change-scope 펜스의 JSON이 깨졌으면 막는다 — 조용히 넓히지 않는다', () => {
  const raw = ['# change-scope', '', '```json change-scope', '{ "ALLOWED_PATHS": [ "src/a/", }', '```', ''].join('\n')
  withNestedProject(({harnessRoot, projectRoot}) => {
    const result = runHook({cwd: harnessRoot, agentType: 'developer', filePath: join(projectRoot, 'src/entities/x.ts')})
    assert.equal(result.allowed, false, '파싱 실패가 무제한 범위로 떨어졌다 — fail-open이다')
    assert.match(result.message, /유효한 JSON이 아니다/)
  }, {rawScope: raw})
})

// ── (6) 오케스트레이터 산출물 ───────────────────────────────────────────────
test('스팩에 적어도 오케스트레이터 산출물은 쓰지 못한다 — 자기 소유권을 못 넓힌다', () => {
  const greedySpec = {
    schemaVersion: 2,
    layerMap: {domainModel: 'src/entities', sneaky: '_workspace/03_dev'},
    testLayers: {unit: 'src'},
  }
  withNestedProject(({harnessRoot, projectRoot}) => {
    for (const target of ['_workspace/03_dev/spec.json', '_workspace/03_dev/change-scope.md', '_workspace/03_dev/build-manifest/plan.json']) {
      const result = runHook({cwd: harnessRoot, agentType: 'developer', filePath: join(projectRoot, target)})
      assert.equal(result.allowed, false, `${target}에 쓸 수 있다 — 스팩 자기수정으로 소유권을 넓힐 수 있다`)
      assert.match(result.message, /orchestrator-authored/)
    }
  }, {spec: greedySpec})
})

// ── (7) workspace/ 이름 충돌 ────────────────────────────────────────────────
test('자기 소스에 workspace/ 를 가진 평면 프로젝트는 중첩으로 오인되지 않는다', () => {
  const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'web-harness-own-workspace-')))
  try {
    mkdirSync(join(projectRoot, '_workspace/03_dev'), {recursive: true})
    mkdirSync(join(projectRoot, 'workspace/pkg-a'), {recursive: true})
    writeFileSync(join(projectRoot, '_workspace/03_dev/spec.json'), JSON.stringify({
      schemaVersion: 2, layerMap: {packages: 'workspace'}, testLayers: {unit: 'workspace'},
    }))
    const result = runHook({cwd: projectRoot, agentType: 'developer', filePath: join(projectRoot, 'workspace/pkg-a/src/x.ts')})
    assert.equal(result.allowed, true, `이름만 보고 root를 옮겨 자기 스팩이 무시됐다: ${result.message}`)
  } finally {
    rmSync(projectRoot, {recursive: true, force: true})
  }
})

// ── (5) 중첩이 아닌 배치는 그대로다 ──────────────────────────────────────────
test('중첩되지 않은 프로젝트는 종전대로 자기 root에서 읽는다', () => {
  const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'web-harness-flat-project-')))
  try {
    mkdirSync(join(projectRoot, '_workspace/03_dev'), {recursive: true})
    writeFileSync(join(projectRoot, '_workspace/03_dev/spec.json'), JSON.stringify(SPEC))
    const result = runHook({cwd: projectRoot, agentType: 'developer', filePath: join(projectRoot, 'src/entities/a.ts')})
    assert.equal(result.allowed, true, `평면 배치가 깨졌다: ${result.message}`)
  } finally {
    rmSync(projectRoot, {recursive: true, force: true})
  }
})

// ── (6) 다른 에이전트의 등록부 소유권은 중첩에서도 성립한다 ──────────────────
test('등록부 소유권도 중첩에서 프로젝트 root 기준으로 판정된다', () => {
  withNestedProject(({harnessRoot, projectRoot}) => {
    const owned = runHook({
      cwd: harnessRoot,
      agentType: 'system-architect',
      filePath: join(projectRoot, '_workspace/02_design/solution-design.md'),
    })
    assert.equal(owned.allowed, true, `등록부 소유 경로가 막혔다: ${owned.message}`)
    const notOwned = runHook({
      cwd: harnessRoot,
      agentType: 'system-architect',
      filePath: join(projectRoot, '_workspace/01_plan/feature-plan.md'),
    })
    assert.equal(notOwned.allowed, false)
  })
})
