// 공유 git 규칙 판정 — 경로가 **커밋되어 팀원 클론에도 있는** `.gitignore`·`.gitattributes` 규칙으로 덮이는가.
// `_workspace/04_qa/` 한 줄이 그 아래 파일들을 덮듯 같은 뜻의 다른 패턴을 인정한다. 전역·시스템·`.git/info` 규칙은
// 커밋되지 않아 팀원에게 없으므로 근거로 치지 않는다. 판정 결과: true(덮임) · false(안 덮임) · null(git이 답하지 못함 —
// 부른 쪽이 줄 대조로 돌아간다). 개발 준비 검사(team-sharing)와 흐름 로그(ticket/flow-log)가 같은 판정을 쓴다.
import {execFileSync} from 'node:child_process'
import {existsSync, readFileSync} from 'node:fs'
import {resolve} from 'node:path'

const DIRECTORY_PROBE = '__readiness_probe__'  // dot으로 시작하지 않는다 — `.*` 같은 무관한 규칙이 디렉터리를 덮은 것처럼 보이지 않게
const env = {...process.env, GIT_ATTR_NOSYSTEM: '1'}

const git = (cwd, args, input) => {
  try { return {status: 0, out: execFileSync('git', args, {cwd, env, encoding: 'utf8', input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore']})} }
  catch (error) { return {status: typeof error?.status === 'number' ? error.status : -1, out: String(error?.stdout ?? '')} }
}
const noGlobalExcludes = ['-c', 'core.excludesFile=/dev/null']

// 규칙 파일 자체가 팀원에게 가는가 — 추적 중이거나, 아직 커밋 전이라도 스스로 무시되지 않아야 한다(`*`만 담은 하위 .gitignore는 못 간다).
function travels(top, source) {
  if (git(top, ['ls-files', '--error-unmatch', '--', source]).status === 0) return true
  return git(top, [...noGlobalExcludes, 'check-ignore', '-q', '--no-index', '--', source]).status === 1
}

/** `line`(파일 경로, `/`로 끝나면 디렉터리)이 공유 `.gitignore` 규칙으로 무시되는가. */
export function sharedIgnoreCovers(root, line) {
  const probe = line.endsWith('/') ? `${line}${DIRECTORY_PROBE}` : line
  const {status, out} = git(root, [...noGlobalExcludes, 'check-ignore', '-z', '-v', '--no-index', '--stdin'], `${probe}\0`)
  if (status === 1) return false
  if (status !== 0) return null
  // `-v`는 마지막으로 맞은 규칙을 낸다 — `!` 재포함 규칙이 맞아도 exit 0이므로 패턴을 읽어야 한다.
  // `-z`(`--stdin` 전용)는 경로를 인용하지 않는다(비ASCII 디렉터리의 규칙 파일도 원문 그대로): source NUL line NUL pattern NUL path NUL.
  const [source, , pattern] = out.split('\0')
  if (!source || pattern === undefined) return null
  if (pattern.startsWith('!')) return false
  if (!/(?:^|\/)\.gitignore$/.test(source) || source.split('/').includes('.git')) return false
  const top = git(root, ['rev-parse', '--show-toplevel'])
  if (top.status !== 0) return null
  return travels(top.out.trim(), source)
}

/** `path attr=value` 한 줄의 속성이 공유 `.gitattributes`로 그 값인가. `.git/info/attributes`가 섞이면 출처를 가릴 수 없어 null. */
export function sharedAttributeCovers(root, line) {
  const [path, attribute] = line.split(/\s+/)
  const [name, value] = attribute.split('=')
  const local = git(root, ['rev-parse', '--git-path', 'info/attributes'])
  if (local.status !== 0) return null
  const localPath = resolve(root, local.out.trim())
  if (existsSync(localPath) && readFileSync(localPath, 'utf8').trim()) return null
  const {status, out} = git(root, ['-c', 'core.attributesFile=/dev/null', 'check-attr', name, '--', path])
  if (status !== 0) return null
  return out.trim().endsWith(`: ${name}: ${value}`)
}
