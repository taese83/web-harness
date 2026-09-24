// plugin-eval-checks-lib.mjs — 배포본 평가(run-plugin-evals)가 러너 채점기 밖에서 내리는 결정적 판정.
//
// 러너 채점기는 메인 스레드 트레이스만 보므로 서브에이전트의 쓰기·파일 내용을 못 본다. 그래서 실행 뒤 작업 공간을
// 직접 본다. 판정이 CLI 안에 인라인이면 테스트도 반증도 붙지 않는다 — 여기 모아 test-plugin-eval-checks가 고정한다.
import {existsSync, readdirSync, readFileSync, realpathSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {basename, dirname, join, relative} from 'node:path'

export const listFiles = (root, current = root) => readdirSync(current, {withFileTypes: true})
  .sort((left, right) => left.name.localeCompare(right.name))
  .flatMap(entry => {
    const path = join(current, entry.name)
    if (entry.isSymbolicLink()) return []
    return entry.isDirectory() ? listFiles(root, path) : [relative(root, path)]
  })

export const fileHashes = root => new Map(existsSync(root)
  ? listFiles(root).map(file => [file, createHash('sha256').update(readFileSync(join(root, file))).digest('hex')]) : [])

/**
 * 러너가 남긴 실행 디렉터리(`<tmp 루트>/e-*`)만 돌려준다 — 트레이스 경로가 다른 자리를 가리키면 null이라 열지도 지우지도 않는다.
 * @param {string} tracePath `<실행>/out/trace.jsonl`
 * @param {string[]} tmpRoots 실제 경로로 푼 tmp 루트들
 */
export const runRootOf = (tracePath, tmpRoots) => {
  if (!tracePath) return null
  const root = dirname(dirname(tracePath))
  const real = existsSync(root) ? realpathSync(root) : null
  return real && /^e-[A-Za-z0-9]+$/.test(basename(real)) && tmpRoots.includes(dirname(real)) ? real : null
}

/**
 * 배포본에 **있는** 스크립트를 디스패처가 못 찾았다는 흔적 — 그 실행은 플러그인 판정이 아니라 환경 오류다.
 * 없는 이름(`--help` 같은 사용 실수)은 환경 오류가 아니다.
 */
export const dispatchMisses = (traceText, distScriptsDirectory) => [...new Set(
  [...String(traceText ?? '').matchAll(/web-harness-script: not part of the plugin runtime: ([a-z0-9/-]+)/g)].map(match => match[1]),
)].filter(name => existsSync(join(distScriptsDirectory, `${name}.mjs`)))

/**
 * 사례의 사후 검사(순수에 가깝다 — 읽기만 한다). 문제 문장 목록을 돌려준다(빈 목록 = 통과).
 * @param {Array<{type: string}>} checks checks.json의 checks
 * @param {{workspace: string|null, seedSource: string|null, draftValidator: {parseTicketDrafts: Function, validateTicketDrafts: Function}}} context
 */
export const runChecks = (checks, {workspace, seedSource, draftValidator}) => checks.flatMap(check => {
  try {
    if (!workspace || !existsSync(workspace)) return [`${check.type}: 작업 공간을 열지 못했다`]
    if (check.type === 'source-unchanged') {
      if (!seedSource) return ['source-unchanged: 대조할 시드 src가 없다(checks.json의 seed)']
      const before = fileHashes(seedSource)
      const after = fileHashes(join(workspace, 'src'))
      const changed = [...new Set([...before.keys(), ...after.keys()])].filter(file => before.get(file) !== after.get(file))
      return changed.length ? [`source-unchanged: src/가 바뀌었다(${changed.slice(0, 5).map(file => `src/${file}`).join(', ')})`] : []
    }
    if (check.type === 'ticket-drafts-valid') {
      const directory = join(workspace, check.directory)
      const files = existsSync(directory) ? readdirSync(directory).filter(name => name.endsWith('.md')) : []
      if (files.length === 0) return [`ticket-drafts-valid: ${check.directory}에 초안이 없다`]
      return files.flatMap(name => {
        const drafts = draftValidator.parseTicketDrafts(readFileSync(join(directory, name), 'utf8'))
        const problems = draftValidator.validateTicketDrafts({drafts}).errors.map(error => `ticket-drafts-valid(${name}): ${error}`)
        if (check.maxTickets && drafts.length > check.maxTickets) problems.push(`ticket-drafts-valid(${name}): 티켓 ${drafts.length}개 — ${check.maxTickets}개 이하여야 한다`)
        return problems
      })
    }
    if (check.type === 'file-exists') return existsSync(join(workspace, check.path)) ? [] : [`file-exists: ${check.path}가 없다`]
    return [`알 수 없는 검사 type: ${check.type}`]
  } catch (error) {
    return [`${check.type}: 검사하지 못했다(${error instanceof Error ? error.message : String(error)})`]
  }
})
