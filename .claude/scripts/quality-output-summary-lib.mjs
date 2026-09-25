// quality-output-summary-lib.mjs — 테스트·커버리지 명령 출력에서 **숫자만** 뽑는다(순수).
// 품질 실행기는 비밀값이 남지 않게 출력 원문을 영수증에 싣지 않는다. 판정에 필요한 통과·실패 수와 커버리지 백분율만
// 영수증에 남긴다. 형식을 모르면 null이다 — 추측한 숫자를 쓰지 않는다.
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g
const plain = stdout => String(stdout ?? '').replace(ANSI, '')

const tally = (segment, keys) => {
  const counts = Object.fromEntries(keys.map(key => [key, 0]))
  for (const match of segment.matchAll(new RegExp(`(\\d+)\\s+(${keys.join('|')})\\b`, 'g'))) counts[match[2]] += Number(match[1])
  return counts
}

/**
 * 단위 테스트(vitest·jest)나 브라우저 테스트(playwright) 요약 줄의 수.
 * @returns {{runner: string, passed: number, failed: number, skipped: number, todo: number, total: number} | null}
 */
export const parseTestSummary = (stdout, kind = 'unit') => {
  const text = plain(stdout)
  if (kind === 'browser') {
    const lines = [...text.matchAll(/^\s*(\d+)\s+(passed|failed|skipped|flaky)\b/gm)]
    if (lines.length === 0) return null
    const counts = {passed: 0, failed: 0, skipped: 0, todo: 0}
    for (const [, count, key] of lines) counts[key === 'flaky' ? 'failed' : key] += Number(count)
    return {runner: 'playwright', ...counts, total: counts.passed + counts.failed + counts.skipped}
  }
  // vitest: "      Tests  1 failed | 4 passed (5)" — 마지막 요약을 쓴다(watch 재실행 등으로 여러 번 나올 수 있다).
  const vitest = [...text.matchAll(/^\s*Tests\s{2,}(.+?)\s*\((\d+)\)\s*$/gm)].at(-1)
  if (vitest) return {runner: 'vitest', ...tally(vitest[1], ['passed', 'failed', 'skipped', 'todo']), total: Number(vitest[2])}
  // jest: "Tests:       1 failed, 4 passed, 5 total"
  const jest = [...text.matchAll(/^Tests:\s+(.+?),?\s*(\d+) total\s*$/gm)].at(-1)
  if (jest) return {runner: 'jest', ...tally(jest[1], ['passed', 'failed', 'skipped', 'todo']), total: Number(jest[2])}
  // 테스트를 하나도 찾지 못하면 요약 줄이 없다 — 이것은 「모른다」가 아니라 실행 0개다.
  if (/^\s*No test files found\b/m.test(text)) return {runner: 'vitest', passed: 0, failed: 0, skipped: 0, todo: 0, total: 0}
  if (/^\s*No tests found\b/m.test(text)) return {runner: 'jest', passed: 0, failed: 0, skipped: 0, todo: 0, total: 0}
  return null
}

const COVERAGE_COLUMNS = [['statements', '% Stmts'], ['branches', '% Branch'], ['functions', '% Funcs'], ['lines', '% Lines']]

/**
 * istanbul·v8 텍스트 표의 `All files` 행 백분율.
 * @returns {{statements: number, branches: number, functions: number, lines: number} | null}
 */
export const parseCoverageSummary = stdout => {
  const rows = plain(stdout).split('\n').map(line => line.split('|').map(cell => cell.trim()))
  const header = rows.findLast(cells => cells.includes('% Lines') && cells.includes('% Stmts'))
  const total = rows.findLast(cells => cells[0] === 'All files')
  if (!header || !total) return null
  const summary = {}
  for (const [key, label] of COVERAGE_COLUMNS) {
    const value = Number(total[header.indexOf(label)])
    if (header.indexOf(label) < 0 || !Number.isFinite(value)) return null
    summary[key] = value
  }
  return summary
}
