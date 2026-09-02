// 팀 워크플로우 통합 — GitHub Issues provider 실행부 (gh spawn, 통합 빌드 4단계).
// 이 파일이 **side-effect 경계**다 — gh를 실제로 spawn한다. 순수 부분(필드 빌드·파싱)은
// provider-github.mjs에 있고, 여기서는 그 결과로 gh를 호출할 뿐이다. confirm(=개발자의
// 선택 행위) 뒤 runner.claimFeature가 이 provider를 주입받아 쓴다.
import {spawn} from 'node:child_process'
import {buildIssueFields, featLabel, ghCreateArgs, parseIssueListJson, parseCreatedIssueUrl, renderCloseReference} from './provider-github.mjs'
import {classifyGhError} from './permissions.mjs'
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

// --- 순수 argv 빌더 (회귀 테스트 대상 — 실 gh 없이 인자 구조를 고정) ---
export const listArgs = (repo, label) => ['issue', 'list', '--repo', repo, '--label', label, '--state', 'all', '--json', 'number,title,url,state', '--limit', '1']
export const viewArgs = (repo, number) => ['issue', 'view', String(number), '--repo', repo, '--json', 'number,title,body,labels,assignees']
export const labelEnsureArgs = (repo, label) => ['label', 'create', label, '--repo', repo, '--color', 'ededed', '--force']
export const createArgs = (repo, fields) => [...ghCreateArgs(fields), '--repo', repo]
export const permissionArgs = repo => ['repo', 'view', repo, '--json', 'viewerPermission']
// C(아웃바운드) 실행부 argv — 실제 실행은 confirm/권한 게이트 뒤 caller 몫.
export const prCreateArgs = (repo, {title, body, base, head}) => {
  const args = ['pr', 'create', '--repo', repo, '--title', title, '--body', body]
  if (base) args.push('--base', base)
  if (head) args.push('--head', head)
  return args
}
export const issueCommentArgs = (repo, number, body) => ['issue', 'comment', String(number), '--repo', repo, '--body', body]
// 대체 발행에서 옛 티켓을 닫는다. **완료가 아니라 대체**임이 코멘트로 남는다 — 닫힌 이슈를
// 완료로 오독하면 보드와 실제가 갈린다.
export const issueSupersedeCloseArgs = (repo, number, newNumber) => [
  'issue', 'close', String(number), '--repo', repo,
  '--comment', `계획 변경으로 대체됨 → #${newNumber} (완료가 아니라 superseded)`,
]
// 픽업 시 개발 소유권 self-assign(청구≠픽업 분리) — 실행은 confirm 게이트 뒤 caller.
export const assignArgs = (repo, number, login) => ['issue', 'edit', String(number), '--repo', repo, '--add-assignee', login]
// 보드 강화(배정 표시)·merged 출처 명세용 read-only argv.
export const issueListAllArgs = repo => ['issue', 'list', '--repo', repo, '--state', 'all', '--json', 'number,title,body,labels,assignees', '--limit', '200']
export const prStateArgs = prUrl => ['pr', 'view', prUrl, '--json', 'state']

// 범용 gh 러너(실행부 경계 재노출) — executor CLI가 assign/comment 등 argv를 실제 스폰할 때
// 쓴다. side-effect이므로 caller(cli)의 --confirm 게이트 뒤에서만 호출된다.
export function runGh(args, options = {}) {
  return gh(args, options)
}

/**
 * merged 출처 명세(§4-2 리뷰 조건): 원장의 prUrl 실린 레코드마다 `gh pr view --json state`로
 * **실제 머지 상태**를 조회해 merged FEAT 집합을 돌려준다(read-only). 조회 실패/미링크는
 * merged로 치지 않는다(낙관 위조 금지 — 미상은 제외).
 * @param {{records: Array<{featureId: string, prUrl?: string}>, exec?: (a: string[]) => Promise<string>, host?: string}} config
 * @returns {Promise<string[]>} merged featureIds
 */
export async function resolveMergedFeatures({records, exec = null, host = 'github.com'}) {
  const run = exec ?? (args => gh(args, {host}))
  const merged = []
  for (const record of records ?? []) {
    if (!record?.prUrl) continue
    try {
      const parsed = JSON.parse(await run(prStateArgs(record.prUrl)))
      if (parsed?.state === 'MERGED') merged.push(record.featureId)
    } catch { /* 조회 실패 = 미상 → merged 아님(보수) */ }
  }
  return merged
}

/**
 * runner에 주입할 GitHub provider(실행부). findByLabel/createIssue를 gh로 구현.
 * exec는 argv→stdout Promise — 기본은 실제 gh spawn, 테스트는 mock을 주입해 side-effect
 * 없이 argv·순서·오류 경로를 검증한다(회귀 커버리지, 리뷰 조건).
 * @param {{repo: string, host?: string, exec?: (args: string[]) => Promise<string>}} config
 */
export function createGithubProvider({repo, host = 'github.com', exec = null}) {
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`INVALID_REPO: ${repo}`)
  const run = exec ?? (args => gh(args, {host}))
  return {
    // ── TicketProvider 필수부(`ticket-provider.mjs`) ──
    name: 'github',
    buildFields: buildIssueFields,
    // **조회 키가 라벨인 것은 GitHub의 사정이다.** 호출자는 FEAT만 준다.
    async findByFeature(featureId) {
      return this.findByLabel(featLabel(featureId))
    },
    // ── 선택부 — 있는 능력만 노출한다 ──
    // `transition`은 **주지 않는다**: GitHub Issues의 상태는 open/closed뿐이라 "진행중"이 없다.
    // 없는 것을 흉내 내면 pickup이 전이했다고 보고하게 된다.
    // PR 본문의 자동 닫기 참조 — GitHub은 네이티브 지원. **서식 정본은 `renderCloseReference`**이고
    // 여기서는 그것을 위임만 한다(두 곳에서 만들면 갈라진다). cli 배선은 아직 그쪽을 직접 부른다.
    closeReference: key => renderCloseReference({ok: true, verified: true, closes: key}),
    classifyError: classifyGhError,
    /** 이슈 조회 — pickup의 소유권 판정 입력. */
    async resolveIssue(key) {
      return resolveIssue({repo, number: key, host, exec})
    },
    /** 배정. gh add-assignee는 additive라 CAS가 없다 — 사후 다중배정 감지는 호출자 몫이다. */
    async assign(key, login) {
      await run(assignArgs(repo, key, login))
      return {ticketKey: String(key), assignee: login}
    },
    // FEAT 고유 라벨로 기존 이슈 조회(청구 경쟁 검사) — 있으면 첫 이슈, 없으면 null.
    // 하위호환으로 남긴다: 라벨을 직접 아는 호출자(exec 계층 내부)가 있다.
    async findByLabel(label) {
      return parseIssueListJson(await run(listArgs(repo, label)))[0] ?? null
    },
    // 이슈 생성 — GitHub은 --label로 붙이려면 라벨이 먼저 존재해야 하므로(라이브 실측:
    // "could not add label: not found"), 각 라벨을 발행 *전에* 보장한다(--force=멱등).
    // 그 뒤 이슈 생성, 출력 URL에서 번호 파싱해 반환.
    // 닫힌 티켓을 되살린다. 재개(reopen) 흐름에서 **새 번호를 내지 않기 위해서**다 —
    // 내용이 같은 티켓을 번호만 바꿔 다시 내면 히스토리가 끊긴다.
    async reopenIssue(ticketKey, comment = null) {
      const args = ['issue', 'reopen', String(ticketKey), '--repo', repo]
      if (comment) args.push('--comment', comment)
      await run(args)
      return {number: Number(ticketKey), ticketKey: String(ticketKey)}
    },
    async createIssue(fields) {
      for (const label of fields.labels) await run(labelEnsureArgs(repo, label))
      const out = await run(createArgs(repo, fields))
      const created = parseCreatedIssueUrl(out)
      if (!created) throw new Error(`이슈 생성 출력에서 URL을 못 찾음: ${out.trim().slice(-200)}`)
      return created
    },
  }
}

/**
 * 이슈를 조회해 pickup 입력 형태로 반환한다(read-only, side-effect). 순수 파싱은 caller가
 * pickup.mjs로 처리 — 여기서는 gh json을 그대로 넘긴다.
 * @param {{repo: string, number: number|string, host?: string, exec?: (args: string[]) => Promise<string>}} config
 * @returns {Promise<{number: number, title: string, body: string, labels: string[], assignees: string[]}>}
 */
export async function resolveIssue({repo, number, host = 'github.com', exec = null}) {
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`INVALID_REPO: ${repo}`)
  const run = exec ?? (args => gh(args, {host}))
  const parsed = JSON.parse(await run(viewArgs(repo, number)))
  return {
    number: parsed.number,
    title: parsed.title ?? '',
    body: parsed.body ?? '',
    labels: (parsed.labels ?? []).map(l => l.name),
    assignees: (parsed.assignees ?? []).map(a => a.login),
  }
}

/**
 * 개발자의 repo 권한 등급을 gh로 조회한다(read-only, side-effect). runner의 permission
 * pre-check 입력. 404/403(미접근)이면 'read'로 보수 판정(least-privilege).
 * @param {{repo: string, host?: string}} config
 * @returns {Promise<'write'|'triage'|'read'>}
 */
export async function resolveViewerPermission({repo, host = 'github.com', exec = null}) {
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`INVALID_REPO: ${repo}`)
  const run = exec ?? (args => gh(args, {host}))
  try {
    return parseViewerPermission(await run(permissionArgs(repo)))
  } catch {
    return 'read' // 조회 실패(미접근·gh 환경 오류 등) → 보수적으로 최소 권한 가정
  }
}

// 편의: FEAT 고유 라벨 재노출(runner가 이미 emit 쪽에서 씀 — 일관성).
export {featLabel}
