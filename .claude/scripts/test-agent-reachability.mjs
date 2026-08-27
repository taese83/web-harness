// test-agent-reachability.mjs — 역방향 reachability(죽은 스폰 지시)의 회귀.
// 실측 회귀는 2026-08-27 `visual-developer` 사건이다 — 하드코딩 어휘가 `developer` 접미사를
// 빠뜨려 잡지 못했다. 여기서는 그 원문을 고정한다.
import {strict as assert} from 'node:assert'
import {readFileSync, readdirSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import test from 'node:test'
import {
  basename,
  deriveRoleSuffixes,
  findDanglingAgentDispatches,
} from './validators/agent-reachability.mjs'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '../..')
const AGENTS = ['developer', 'environment-scaffolder', 'visual-baseline-manager', 'code-reviewer']

const find = (source, agentNames = AGENTS) =>
  findDanglingAgentDispatches({agentNames, documents: [{path: 'doc.md', source}]})

test('실존 에이전트 지시는 위반이 아니다', () => {
  assert.equal(find('구현은 `developer`가, 설정은 `environment-scaffolder`가 한다.').length, 0)
})

test('실측 회귀: visual-developer는 잡힌다 (하드코딩 어휘가 놓쳤던 원문)', () => {
  const dangling = find('구현 완료 후 `visual-developer`가 테스트만 작성한다.')
  assert.equal(dangling.length, 1)
  assert.equal(dangling[0].token, 'visual-developer')
  assert.equal(dangling[0].line, 1)
})

test('역할 어휘는 실존 이름에서 파생된다 — developer 접미사가 포함된다', () => {
  // 이것이 eval receipt a3가 놓친 지점이다. 하드코딩 목록에는 developer가 없었다.
  assert.ok(deriveRoleSuffixes(AGENTS).has('developer'))
  assert.ok(deriveRoleSuffixes(AGENTS).has('scaffolder'))
})

test('제거된 에이전트를 백틱 없이 서술하면 통과한다 (서술 ≠ 지시)', () => {
  assert.equal(find('package-scaffolder·test-scaffolder 3종을 합쳤다(2026-08-26 제거).').length, 0)
})

test('같은 이름을 백틱으로 쓰면 loud FAIL이다', () => {
  assert.equal(find('`package-scaffolder`를 합쳤다.').length, 1)
})

test('역할 접미사가 아닌 토큰은 무시한다 — 파일명·모듈명 오탐 방지', () => {
  assert.equal(find('`shape-routing-contract`와 `ledger-writer`와 `read-skill-section`').length, 0)
})

test('백틱이 앵커라 경로·확장자 표기는 매칭되지 않는다', () => {
  assert.equal(find('`references/phase-3-development.md`와 `agents/visual-developer.md`').length, 0)
})

test('여러 줄에서 줄 번호를 정확히 보고한다', () => {
  const dangling = find(['첫 줄', '`ghost-reviewer`를 실행한다', '셋째 줄'].join('\n'))
  assert.equal(dangling.length, 1)
  assert.equal(dangling[0].line, 2)
})

test('에이전트 목록이 비면 통과가 아니라 검사 미수행으로 던진다 (vacuous pass 차단)', () => {
  assert.throws(() => find('`visual-developer`', []), /check not performed/)
})

test('basename은 구분자 무관이다 — Windows 백슬래시 경로', () => {
  assert.equal(basename('.claude\\agents\\developer.md'), 'developer')
  assert.equal(basename('.claude/agents/developer.md'), 'developer')
})

test('실제 트리에 죽은 스폰 지시가 없다 (오탐 0 실행 로그)', () => {
  const agentDirectory = join(repositoryRoot, '.claude/agents')
  const agentNames = readdirSync(agentDirectory)
    .filter(name => name.endsWith('.md'))
    .map(basename)
  const documents = []
  const walk = directory => {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      const full = join(directory, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.md')) documents.push({path: full, source: readFileSync(full, 'utf8')})
    }
  }
  walk(join(repositoryRoot, '.claude/skills'))
  walk(agentDirectory)
  const dangling = findDanglingAgentDispatches({agentNames, documents})
  assert.deepEqual(dangling, [], `dangling agent dispatches: ${JSON.stringify(dangling, null, 2)}`)
})
