// plugin-eval-checks-lib.mjs — 배포본 평가(run-plugin-evals)가 러너 채점기 밖에서 내리는 결정적 판정.
//
// 러너 채점기는 메인 스레드 트레이스만 보므로 서브에이전트의 쓰기·파일 내용을 못 본다. 그래서 실행 뒤 작업 공간을
// 직접 본다. 판정이 CLI 안에 인라인이면 테스트도 반증도 붙지 않는다 — 여기 모아 test-plugin-eval-checks가 고정한다.
import {existsSync, readdirSync, readFileSync, realpathSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {basename, delimiter, dirname, join, relative, sep} from 'node:path'
import {DISPATCHER_NOT_FOUND} from './eval-trace-metrics.mjs'

/** 사후 검사 종류 — runChecks와 사례 검사기(validate-workflows-and-evals)가 같은 목록을 쓴다. */
export const CHECK_TYPES = new Set(['source-unchanged', 'ticket-drafts-valid', 'file-exists', 'artifact-exists', 'file-absent', 'artifact-matches'])

export const listFiles = (root, current = root) => readdirSync(current, {withFileTypes: true})
  .sort((left, right) => left.name.localeCompare(right.name))
  .flatMap(entry => {
    const path = join(current, entry.name)
    if (entry.isSymbolicLink()) return []
    return entry.isDirectory() ? listFiles(root, path) : [relative(root, path)]
  })

export const fileHashes = root => new Map(existsSync(root)
  ? listFiles(root).map(file => [file, createHash('sha256').update(readFileSync(join(root, file))).digest('hex')]) : [])

/** 트리의 파일 이름과 내용에 묶인 digest — receipt가 어느 판본의 사례·시드·배포본을 쟀는지 남긴다. */
export const treeDigest = root => {
  const hash = createHash('sha256')
  for (const file of listFiles(root)) hash.update(`${file}\0`).update(readFileSync(join(root, file))).update('\0')
  return hash.digest('hex')
}

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
 * 평가 세션의 PATH — 설치본 플러그인의 bin은 뺀다(평가 대상이 아닌 디스패처를 부른다). 평가 대상의 bin은 설치본처럼
 * 앞에 둔다 — 없으면 서브에이전트가 디스패처를 못 찾고(exit 127), 검증 Bash 정책이 절대 경로를 막아 우회로도 없다.
 */
export const evalSessionPath = (pluginDirectory, parentPath) => [join(pluginDirectory, 'bin'),
  ...String(parentPath ?? '').split(delimiter).filter(entry => entry !== '' && !entry.includes(`${sep}.claude${sep}plugins${sep}`))].join(delimiter)

/**
 * 배포본에 **있는** 디스패처를 셸이 못 찾았다는 흔적(exit 127) — 설치본은 플러그인 bin을 PATH에 두므로 이 실행은
 * 플러그인 판정이 아니라 환경 오류다. 배포본에 디스패처가 없으면 빌드 결함이라 환경 오류로 빼지 않는다.
 */
export const dispatcherNotOnPath = (traceText, pluginBinDirectory) =>
  DISPATCHER_NOT_FOUND.test(String(traceText ?? '')) && existsSync(join(pluginBinDirectory, 'web-harness-script'))
    ? ['배포본의 web-harness-script를 셸이 찾지 못했다(PATH에 플러그인 bin이 없다) — 이 실행은 플러그인 판정이 아니다']
    : []

/**
 * 실행이 모델에 닿지도 못한 흔적(인증 만료 등) — 플러그인 판정이 아니라 환경 오류다. 그대로 두면 채점기 실패가
 * 「플러그인이 아무것도 안 했다」로 읽힌다.
 */
export const runFailureEnvironmentErrors = error => {
  const text = String(error ?? '')
  if (!/\b401\b|authenticat|OAuth access token/i.test(text)) return []
  return [`Claude 인증이 실패했다(${text.slice(0, 160)}) — 이 실행은 플러그인 판정이 아니다. \`claude auth login\` 뒤 다시 돌린다`]
}

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
    // 멈춰야 할 자리에서 멈췄는가 — 서브에이전트의 쓰기는 채점기(메인 트레이스)가 못 보므로 작업 공간을 본다.
    if (check.type === 'file-absent') return existsSync(join(workspace, check.path)) ? [`file-absent: ${check.path}가 있다 — 멈춰야 할 단계를 넘었다`] : []
    // 산출물의 내용 계약(상태 줄 등) — 분할이면 INDEX.md를 본다(artifact-sharding-contract).
    if (check.type === 'artifact-matches') {
      const file = [`${check.path}.md`, join(check.path, 'INDEX.md')].map(path => join(workspace, path)).find(path => existsSync(path))
      if (!file) return [`artifact-matches: ${check.path}(.md 또는 분할 INDEX.md)가 없다`]
      return new RegExp(check.pattern, 'm').test(readFileSync(file, 'utf8')) ? [] : [`artifact-matches: ${check.path}에 /${check.pattern}/가 없다`]
    }
    // 설계·기획 산출물은 크면 같은 이름의 디렉터리로 나뉜다(artifact-sharding-contract) — 파일만 보면 분할한 실행이 실패로 보인다.
    if (check.type === 'artifact-exists') {
      return [`${check.path}.md`, check.path].some(path => existsSync(join(workspace, path))) ? [] : [`artifact-exists: ${check.path}(.md 또는 분할 디렉터리)가 없다`]
    }
    return [`알 수 없는 검사 type: ${check.type}`]
  } catch (error) {
    return [`${check.type}: 검사하지 못했다(${error instanceof Error ? error.message : String(error)})`]
  }
})
