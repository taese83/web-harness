// mutation-sample-lib.mjs — 생성된 테스트가 **결함을 실제로 잡는가**를 표본으로 잰다.
//
// 계기(2026-09-09 실측): 커버리지는 **실행만** 측정한다. 이 저장소의 `test-executor`도
// 「coverage 70% 미만은 WARN」으로 커버리지를 품질 신호로 쓴다 — 그것이 프록시라는 것이
// I5의 정의 그대로다. 실제로 재보니 `track`(327 테스트 전부 통과)에서 소스의 비교 연산자를
// 뒤집어도 **14건 중 10건이 통과**했다. `search-portal`은 13/14, `minicar-laptime`은 14/14. 테스트가 통과한다는
// 것과 테스트가 무엇을 검증한다는 것은 다르다.
//
// 방법은 이 저장소가 이미 쓰는 것과 같다 — `validate-falsification.mjs`가 **게이트**를
// 변이시켜 회귀가 잡는지 보듯, 여기서는 **제품 코드**를 변이시켜 그 프로젝트의 테스트가
// 잡는지 본다. 층위만 다르고 질문은 하나다: 「끄면 누가 알아채는가」.
//
// **표본이지 mutation score가 아니다.** Stryker 류는 전수를 돌려 점수를 낸다. 여기서는
// 변이 하나마다 테스트 스위트를 통째로 돌리므로 상한을 두고 **표본**을 낸다 — 보고 문구에서
// 「표본」을 떼지 않는다.
//
// **하네스에 의존성을 넣지 않는다.** 프로젝트가 이미 가진 테스트 러너를 `resolveCommand`로
// 찾아 그대로 부른다(`resolveSymbols`가 프로젝트의 TypeScript를 빌려 쓰는 것과 같은 규율).
//
// **못 잡는 것**: ① **equivalent mutant** — 의미가 같은 변이는 살아남아도 결함이 아니다.
// mutation testing의 알려진 한계이며 이 표본도 예외가 아니다. 살아남은 목록을 그대로 실어
// 사람이 가릴 수 있게 한다 ② 표본이라 **전수 점수가 아니다** ③ 변이 연산자가 일곱뿐이라
// 그 밖의 결함 클래스는 건드리지 않는다 ④ 테스트가 느린 프로젝트에서는 상한이 작아진다.

import {readFileSync, readdirSync, writeFileSync, existsSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {join, relative, resolve} from 'node:path'

// 고전적 변이 연산자. **경계와 논리**만 건드린다 — 문자열·주석을 바꾸면 무엇이 깨졌는지
// 사람이 읽기 어렵고, 테스트가 문자열을 단언하면 잡혀도 의미가 없다.
export const MUTATION_OPERATORS = [
  {id: 'gte-to-gt', find: /([^=!<>])>=/g, replace: '$1>', label: '>= → >'},
  {id: 'lte-to-lt', find: /([^=!<>])<=/g, replace: '$1<', label: '<= → <'},
  {id: 'and-to-or', find: / && /g, replace: ' || ', label: '&& → ||'},
  {id: 'or-to-and', find: / \|\| /g, replace: ' && ', label: '|| → &&'},
  {id: 'eq-to-neq', find: /([^=!])===/g, replace: '$1!==', label: '=== → !=='},
  {id: 'true-to-false', find: /\breturn true\b/g, replace: 'return false', label: 'return true → false'},
  {id: 'false-to-true', find: /\breturn false\b/g, replace: 'return true', label: 'return false → true'},
]

const SOURCE_EXT = /\.(?:tsx?|jsx?)$/
const IS_TEST = /\.(?:test|spec)\.|\.d\.ts$/

/** 변이 대상 소스 파일. 테스트 파일은 뺀다 — 테스트를 바꾸면 테스트를 시험하는 게 아니다. */
export function sourceFilesOf(projectRoot, relativeDir = 'src', collected = []) {
  const directory = join(projectRoot, relativeDir)
  if (!existsSync(directory)) return collected
  let entries
  try { entries = readdirSync(directory, {withFileTypes: true}) } catch { return collected }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const next = `${relativeDir}/${entry.name}`
    if (entry.isDirectory()) sourceFilesOf(projectRoot, next, collected)
    else if (SOURCE_EXT.test(entry.name) && !IS_TEST.test(entry.name)) collected.push(next)
  }
  return collected
}

/** 한 소스가 담은 변이 후보(순수). 실제로 문자열이 바뀌는 것만 센다. */
export function mutationCandidates(source, relativePath) {
  const found = []
  for (const operator of MUTATION_OPERATORS) {
    const mutated = String(source).replace(operator.find, operator.replace)
    if (mutated !== source) found.push({file: relativePath, operator: operator.id, label: operator.label})
  }
  return found
}

/**
 * 표본을 고른다(순수). **파일을 고루 흩는다** — 한 파일에 몰리면 그 파일의 테스트만 재게 되고,
 * 테스트가 없는 층(실측에서 살아남은 변이가 몰린 곳)이 표본에서 통째로 빠진다.
 */
export function spreadSample(candidates, limit) {
  const byFile = new Map()
  for (const item of candidates) {
    if (!byFile.has(item.file)) byFile.set(item.file, [])
    byFile.get(item.file).push(item)
  }
  const sample = []
  for (let round = 0; sample.length < limit && round < MUTATION_OPERATORS.length; round++) {
    for (const list of byFile.values()) {
      if (list[round] && sample.length < limit) sample.push(list[round])
    }
  }
  return sample
}

const operatorById = id => MUTATION_OPERATORS.find(operator => operator.id === id) ?? null
// **첫 출현 하나만 바꾼다.** `/g`로 전부 뒤집으면 「변이 1건」이 아니라 「파일 × 연산자의 모든
// 출현 동시 반전」이고, 어떤 테스트든 하나만 걸려도 killed라 점수가 **위로 기운다**
// (적대 리뷰 2026-09-09). 후보 탐지는 `/g`로 하되 적용은 단일이다.
const singleOccurrence = operator => new RegExp(operator.find.source, operator.find.flags.replace('g', ''))

/**
 * 표본을 실제로 돌린다. **원본은 반드시 복원한다** — 실패 경로에서도(`finally`).
 * @param {string} projectPath
 * @param {{runTests: () => number|Promise<number>, limit?: number, io?: object}} options
 *   `runTests`는 **주입**이다 — 회귀가 실제 프로젝트 없이 CI에서 돌아야 하기 때문이다.
 *   이 저장소는 gitignore된 `workspace/`에 회귀를 결박했다가 CI에서 vacuous green을 만든 적이
 *   세 번 있다(§4 등록).
 * @returns {Promise<{state, killed, survived, sampled, score, survivors, note}>}
 */
export async function runMutationSample(projectPath, {runTests, limit = 12, io = {}, onInFlight = null} = {}) {
  const projectRoot = resolve(projectPath)
  const read = io.readFile ?? (relativePath => readFileSync(join(projectRoot, relativePath), 'utf8'))
  const write = io.writeFile ?? ((relativePath, text) => writeFileSync(join(projectRoot, relativePath), text))
  const list = io.listSources ?? (() => sourceFilesOf(projectRoot))

  if (typeof runTests !== 'function') {
    return {state: 'NOT_MEASURED', killed: 0, survived: 0, sampled: 0, score: null, survivors: [],
      note: '테스트 명령을 찾지 못해 표본을 돌리지 못했다 — 미수행이며 통과가 아니다'}
  }
  // **기준 실행 없이 잰 점수는 증거가 아니다.** 변이 전에 한 번 돌려본다 — 스위트가 원래
  // 빨갛거나 러너가 아예 못 뜨면 모든 변이가 「잡혔다」로 세어져 **점수가 항상 100%**가 된다.
  // 반증 seed가 막으려던 바로 그 결과가 다른 문으로 열려 있었다(적대 리뷰 2026-09-09,
  // 실행으로 재현: 빨간 스위트 100% · 러너 부재 100%).
  const baseline = await runTests()
  if (baseline !== 0) {
    return {state: 'NOT_MEASURED', killed: 0, survived: 0, sampled: 0, score: null, survivors: [],
      note: `기준 실행이 실패했다(exit ${baseline}) — 변이 없이도 테스트가 통과하지 않으므로 잴 수 없다. 미수행이며 통과가 아니다`}
  }
  const files = list()
  const candidates = files.flatMap(relativePath => {
    try { return mutationCandidates(read(relativePath), relativePath) } catch { return [] }
  })
  if (candidates.length === 0) {
    return {state: 'NO_CANDIDATES', killed: 0, survived: 0, sampled: 0, score: null, survivors: [],
      note: `변이할 자리를 찾지 못했다 (소스 ${files.length}개) — 잴 것이 없다`}
  }
  const sample = spreadSample(candidates, limit)
  const survivors = []
  let killed = 0
  for (const item of sample) {
    const operator = operatorById(item.operator)
    const original = read(item.file)
    try {
      const mutated = original.replace(singleOccurrence(operator), operator.replace)
      if (mutated === original) continue
      // 강제 종료(SIGKILL·툴 timeout)로 `finally`가 못 돌 수 있다 — 그때 무엇을 되돌려야
      // 하는지 호출부가 알아야 한다. 이것이 이 검사의 유일한 실질 위험이다.
      onInFlight?.({file: item.file, original})
      write(item.file, mutated)
      // **0이면 살아남은 것이다** — 테스트가 통과했다는 뜻이고, 결함을 못 잡았다는 뜻이다.
      if (await runTests() === 0) survivors.push({file: item.file, label: item.label})
      else killed++
    } finally {
      write(item.file, original)
      onInFlight?.(null)
    }
  }
  const sampled = killed + survivors.length
  const score = sampled === 0 ? null : Math.round((killed / sampled) * 100)
  return {
    state: sampled === 0 ? 'NOT_MEASURED' : 'MEASURED',
    killed, survived: survivors.length, sampled, score, survivors,
    truncated: sample.length < candidates.length,
    note: sampled === 0
      ? '표본을 하나도 돌리지 못했다 — 미수행이며 통과가 아니다'
      : `변이 표본 ${sampled}건 중 ${killed}건을 테스트가 잡았다 (${score}%)`
        + `${sample.length < candidates.length ? ` · 후보 ${candidates.length}건 중 표본이며 전수 점수가 아니다` : ''}`
        + (survivors.length > 0
          ? ` · 살아남음: ${survivors.slice(0, 5).map(item => `${item.file}[${item.label}]`).join(', ')}`
          : ''),
  }
}

/** 보고 문구(순수). **「표본」을 떼지 않는다** — 전수 점수로 읽히면 그것이 곧 과장이다. */
export function renderMutationSample(result) {
  if (result.state !== 'MEASURED') return `변이 표본: ${result.state} — ${result.note}`
  // **임계값을 두지 않는다.** §4가 "더 많은 프로젝트를 재본 뒤에 정한다"고 적었고, 여기에
  // 숫자를 박으면 비판 대상인 커버리지 70%와 같은 근거 없는 선이 된다.
  return `변이 표본 ${result.killed}/${result.sampled} (${result.score}%) — ${result.note}`
}

export const relativeTo = (root, path) => relative(resolve(root), resolve(path))

/**
 * **변이 대상 파일들**의 지문(순수). 프로젝트 전체가 아니라 이 검사가 건드릴 수 있는 것만 센다 —
 * 테스트 러너가 `node_modules`·lockfile을 만드는 것은 이 검사의 책임이 아니고, 전체 트리로
 * 재면 그 부수효과가 「복원 실패」로 오탐된다(자체 실측에서 그렇게 났다).
 */
export function mutableDigest(projectRoot, {io = {}} = {}) {
  const read = io.readFile ?? (relativePath => readFileSync(join(resolve(projectRoot), relativePath), 'utf8'))
  const list = io.listSources ?? (() => sourceFilesOf(resolve(projectRoot)))
  const hash = createHash('sha256')
  for (const relativePath of [...list()].sort()) {
    hash.update(`${relativePath}\0`)
    try { hash.update(read(relativePath)) } catch { hash.update('<unreadable>') }
    hash.update('\0')
  }
  return hash.digest('hex')
}
