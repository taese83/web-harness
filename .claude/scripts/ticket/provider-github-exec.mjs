// 팀 워크플로우 통합 — GitHub Issues provider 실행부 (gh spawn, 통합 빌드 4단계).
// 이 파일이 **side-effect 경계**다 — gh를 실제로 spawn한다. 순수 부분(필드 빌드·파싱)은
// provider-github.mjs에 있고, 여기서는 그 결과로 gh를 호출할 뿐이다. confirm(=개발자의
// 선택 행위) 뒤 runner.claimFeature가 이 provider를 주입받아 쓴다.
import {spawn} from 'node:child_process'
import {featLabel, ghCreateArgs, parseIssueListJson, parseCreatedIssueUrl} from './provider-github.mjs'
import {parseViewerPermission} from './permissions.mjs'

// gh를 실행하고 stdout을 문자열로 반환. 실패(비0 exit)면 stderr를 담아 throw.
function gh(args, {host = 'github.com', timeoutMs = 30000} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', args, {env: {...process.env, GH_HOST: host}, stdio: ['ignore', 'pipe', 'pipe']})
    let out = ''
    let err = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`gh timeout: ${args[0]} ${args[1]}`)) }, timeoutMs)
    child.stdout.on('data', chunk => { out += chunk })
    child.stderr.on('data', chunk => { err += chunk })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(`gh exit ${code}: ${err.trim() || out.trim()}`))
    })
  })
}

/**
 * runner에 주입할 GitHub provider(실행부). findByLabel/createIssue를 gh로 구현.
 * @param {{repo: string, host?: string}} config  repo = "owner/name"
 */
export function createGithubProvider({repo, host = 'github.com'}) {
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`INVALID_REPO: ${repo}`)
  return {
    // FEAT 고유 라벨로 기존 이슈 조회(청구 경쟁 검사) — 있으면 첫 이슈, 없으면 null.
    async findByLabel(label) {
      const out = await gh(['issue', 'list', '--repo', repo, '--label', label, '--state', 'all', '--json', 'number,title,url', '--limit', '1'], {host})
      return parseIssueListJson(out)[0] ?? null
    },
    // 이슈 생성 — GitHub은 --label로 붙이려면 라벨이 먼저 존재해야 하므로(라이브 실측:
    // "could not add label: not found"), 각 라벨을 발행 전에 보장한다. --force는 이미
    // 있으면 갱신(멱등). 그 뒤 이슈 생성, 출력 URL에서 번호 파싱해 반환.
    async createIssue(fields) {
      for (const label of fields.labels) {
        await gh(['label', 'create', label, '--repo', repo, '--color', 'ededed', '--force'], {host})
      }
      const out = await gh([...ghCreateArgs(fields), '--repo', repo], {host})
      const created = parseCreatedIssueUrl(out)
      if (!created) throw new Error(`이슈 생성 출력에서 URL을 못 찾음: ${out.trim().slice(-200)}`)
      return created
    },
  }
}

/**
 * 개발자의 repo 권한 등급을 gh로 조회한다(read-only, side-effect). runner의 permission
 * pre-check 입력. 404/403(미접근)이면 'read'로 보수 판정(least-privilege).
 * @param {{repo: string, host?: string}} config
 * @returns {Promise<'write'|'triage'|'read'>}
 */
export async function resolveViewerPermission({repo, host = 'github.com'}) {
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`INVALID_REPO: ${repo}`)
  try {
    const out = await gh(['repo', 'view', repo, '--json', 'viewerPermission'], {host})
    return parseViewerPermission(out)
  } catch {
    return 'read' // 조회 실패(미접근 등) → 보수적으로 최소 권한 가정
  }
}

// 편의: FEAT 고유 라벨 재노출(runner가 이미 emit 쪽에서 씀 — 일관성).
export {featLabel}
