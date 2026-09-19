// 티켓 provider — GitHub Issues 실행부(gh spawn). 이 파일이 **side-effect 경계**다 — 순수 부분(필드 빌드·
// 파싱)은 provider-github.mjs에 있고, 여기서는 그 결과로 gh를 호출할 뿐이다. 발행·픽업·보드가 주입받아 쓴다.
import {spawn} from 'node:child_process'
import {buildWorkIssueFields, featLabel, ghCreateArgs, parseCreatedIssueUrl, renderCloseReference} from './provider-github.mjs'
import {classifyGhError} from './permissions.mjs'
import {parseGithubWorkList, workListArgs, workSearchArgs} from './work-provider.mjs'
import {withWorkMarker, WORK_MARKER_BEGIN} from './work-refs.mjs'
import {DEV_TICKET} from './intake.mjs'

// gh를 실행하고 stdout을 문자열로 반환. 실패(비0 exit)면 stderr를 담아 throw.
// `stdin`은 **본문처럼 긴 값**을 넘기는 통로다 — argv로 넘기면 인자 길이 한계와 셸 인용에
// 걸린다(`gh issue edit --body-file -`). 없으면 종전대로 stdin을 닫는다.
function gh(args, {host = 'github.com', timeoutMs = 30000, stdin = null} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', args,
      {env: {...process.env, GH_HOST: host}, stdio: [stdin === null ? 'ignore' : 'pipe', 'pipe', 'pipe']})
    if (stdin !== null) { child.stdin.end(String(stdin)) }
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

export const workViewArgs = (repo, number) => ['issue', 'view', String(number), '--repo', repo, '--json', 'number,title,labels,state,stateReason,closedAt,body,assignees']
// gh가 「그 번호의 이슈가 없다」고 답한 경우만 부재다 — 권한·네트워크 실패를 부재로 접지 않는다.
const isIssueNotFound = error => /Could not resolve to an? (issue|Issue)/.test(String(error?.message ?? error))
export const viewArgs = (repo, number) => ['issue', 'view', String(number), '--repo', repo, '--json', 'number,title,body,labels,assignees,comments,updatedAt']
export const labelEnsureArgs = (repo, label) => ['label', 'create', label, '--repo', repo, '--color', 'ededed', '--force']
export const labelEditArgs = (repo, number, {add = [], remove = []}) => ['issue', 'edit', String(number), '--repo', repo,
  ...add.flatMap(label => ['--add-label', label]), ...remove.flatMap(label => ['--remove-label', label])]
export const createArgs = (repo, fields) => [...ghCreateArgs(fields), '--repo', repo]
// 픽업 시 개발 소유권 self-assign(청구≠픽업 분리) — 실행은 confirm 게이트 뒤 caller.
export const assignArgs = (repo, number, login) => ['issue', 'edit', String(number), '--repo', repo, '--add-assignee', login]
export const prStateArgs = prUrl => ['pr', 'view', prUrl, '--json', 'state,baseRefName,headRefName,title,mergedAt']
/** 기대 base에 머지된 PR 목록 — 완료 판정의 근거(제목의 티켓 키). 상한에 닿으면 잘렸다고 알린다. */
export const mergedPrListArgs = (repo, base, limit) => ['pr', 'list', '--repo', repo, '--base', base, '--state', 'merged', '--limit', String(limit),
  '--json', 'number,title,headRefName,mergedAt,url']

// 범용 gh 러너(실행부 경계 재노출) — executor CLI가 assign/comment 등 argv를 실제 스폰할 때
// 쓴다. side-effect이므로 caller(cli)의 --confirm 게이트 뒤에서만 호출된다.
export function runGh(args, options = {}) {
  return gh(args, options)
}


/**
 * GitHub provider(실행부). 발행·조회·배정·코멘트를 gh로 구현한다.
 * exec는 argv→stdout Promise — 기본은 실제 gh spawn, 테스트는 mock을 주입해 side-effect
 * 없이 argv·순서·오류 경로를 검증한다(회귀 커버리지, 리뷰 조건).
 * @param {{repo: string, host?: string, exec?: (args: string[]) => Promise<string>}} config
 */
export function createGithubProvider({repo, host = 'github.com', exec = null}) {
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`INVALID_REPO: ${repo}`)
  const run = exec ?? ((args, options = {}) => gh(args, {host, ...options}))
  return {
    // ── TicketProvider 필수부(`ticket-provider.mjs`) ──
    name: 'github',
    // 본문은 마크다운이고, 기계 마커는 **렌더되지 않는 HTML 주석**으로 본문 끝에 둔다(사람 눈에 보이지 않는다).
    docFormat: 'markdown',
    buildWorkFields: draft => buildWorkIssueFields({...draft, body: draft.marker ? withWorkMarker(draft.body, draft.marker) : draft.body}),
    // ── WORK 축 ── 시도 시각(`since`)이 있으면 **REST 목록**(DB 기반, 색인 지연 없음)을 끝까지 돌아 마커로 찾는다 —
    // 끝까지 돌았으면 완결이다. 시각이 없으면 본문 검색이고 색인 지연이라 부재를 단정하지 않는다.
    async findByWorkId({workId, since = null}) {
      if (since) {
        const out = await run(['api', '--paginate', `repos/${repo}/issues?state=all&per_page=100&since=${encodeURIComponent(since)}`,
          '--jq', '.[] | select(.pull_request == null) | {number, title, body}'])
        const rows = out.split('\n').filter(Boolean).map(line => JSON.parse(line))
        const matches = rows.filter(row => String(row.body ?? '').includes(`${WORK_MARKER_BEGIN} `) && String(row.body ?? '').includes(`work=${workId} `))
          .map(row => ({ticketKey: String(row.number), summary: row.title ?? null}))
        return {matches, complete: true, indexLag: false, total: rows.length, nextCursor: null}
      }
      const json = JSON.parse(await run(workSearchArgs(repo, workId)))
      const parsed = parseGithubWorkList(json, {limit: 100, indexLag: true})
      return {matches: parsed.matches, complete: false, indexLag: true, total: null, nextCursor: null}
    },
    /**
     * 목록. gh는 커서를 주지 않으므로 상한에 닿으면 잘렸을 수 있다고 표시한다. **키를 주면** 잘린 목록에서 못 본
     * 키를 하나씩 직접 조회한다 — 이슈가 많은 저장소에서 보드가 오래된 WORK를 늘 「미상」으로 두지 않게.
     */
    /** 사람이 다시 연 시각 — 이슈 이벤트의 가장 최근 `reopened`. 키마다 한 번 읽는다(머지 근거가 있고 열린 이슈만 부른다). */
    async listReopens({keys}) {
      const {reopenedAtFromGithubEvents} = await import('./work-provider.mjs')
      const reopens = new Map()
      const errors = []
      for (const key of keys.map(String)) {
        try {
          // --paginate는 페이지마다 배열을 이어 붙인다(`][`) — 한 배열로 편다.
          const out = String(await run(['api', '--paginate', `repos/${repo}/issues/${key}/events`])).trim()
          const events = out ? JSON.parse(`[${out.replace(/^\[|\]$/g, '').replace(/\]\s*\[/g, ',')}]`) : []
          const at = reopenedAtFromGithubEvents(events)
          if (at) reopens.set(key, at)
        } catch (error) {
          errors.push({ticketKey: key, error: String(error?.message ?? error).slice(0, 120)})
        }
      }
      return {reopens, errors}
    },
    async listWorkIssues({keys = null, pageSize = 100}) {
      const json = JSON.parse(await run(workListArgs(repo, pageSize)))
      const parsed = parseGithubWorkList(json, {limit: pageSize})
      const wanted = keys ? new Set(keys.map(key => String(key))) : null
      const items = wanted ? parsed.matches.filter(item => wanted.has(item.ticketKey)) : parsed.matches
      const observed = new Set(items.map(item => item.ticketKey))
      if (keys && parsed.truncated) {
        const notFound = []
        for (const key of [...wanted].filter(key => !observed.has(key))) {
          if (!/^\d+$/.test(key)) throw new Error(`INVALID_WORK_KEY: GitHub 이슈 번호가 아니다 — ${key}`)
          try {
            const [item] = parseGithubWorkList([JSON.parse(await run(workViewArgs(repo, key)))], {limit: Infinity}).matches
            items.push(item)
            observed.add(item.ticketKey)
          } catch (error) {
            if (!isIssueNotFound(error)) throw error
            notFound.push(key)
          }
        }
        // 요청한 키를 **전부 직접 확인했다** — 목록의 절단과 무관하게 이 키들에 대해서는 완결이다.
        return {items, nextCursor: null, complete: true, truncated: false, keyLookup: true, total: null,
          requested: keys.map(String), missing: notFound}
      }
      return {items, nextCursor: null, complete: parsed.complete, truncated: parsed.truncated, total: null,
        requested: keys ? keys.map(String) : null,
        // 키를 주고 여기 왔으면 목록이 잘리지 않았다 — 잘렸으면 위에서 키마다 직접 조회했다(못 본 키를 부재로 단정하는
        // 경로가 없다. 그 판정은 `isIssueNotFound`가 맡는다).
        missing: keys ? keys.map(String).filter(key => !observed.has(key)) : null}
    },
    /** 사람이 만든 개발 티켓 목록 — 팀이 `개발 티켓`으로 선언한 라벨의 열린 이슈. 선언이 없으면 조회하지 않는다. */
    async listDevTickets({config: teamConfig = {}} = {}) {
      const labels = Object.entries(teamConfig?.github?.labelAxis ?? {}).filter(([, role]) => role === DEV_TICKET).map(([name]) => name)
      if (labels.length === 0) return {items: [], complete: true, reason: 'no-dev-ticket-axis'}
      const items = new Map()
      let complete = true
      for (const label of labels) {
        const json = JSON.parse(await run(['issue', 'list', '--repo', repo, '--state', 'open', '--label', label, '--json', 'number,title,assignees,labels', '--limit', '100']))
        if (Array.isArray(json) && json.length >= 100) complete = false
        for (const item of Array.isArray(json) ? json : []) {
          items.set(String(item.number), {ticketKey: String(item.number), summary: item.title ?? null, assignees: (item.assignees ?? []).map(person => person?.login ?? person),
            labels: (item.labels ?? []).map(label => label?.name ?? label)})
        }
      }
      return {items: [...items.values()], complete, ...(complete ? {} : {truncated: true})}
    },
    /** 관계. 확인한 native 계층이 없다 — 본문 참조뿐이며 계층이라 부르지 않는다. */
    async linkRelated() {
      return {applied: false, mode: 'link-only',
        note: 'GitHub에는 확인된 유형 관계가 없다 — 발행 시 본문 참조로 남긴다(계층이 아니다)'}
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
    async unassign(key, login) {
      await run(['issue', 'edit', String(key), '--repo', repo, '--remove-assignee', login])
      return {ticketKey: String(key), removed: login}
    },
    // 되돌림을 기획자에게 알리는 경로.
    async comment(ticketKey, text) {
      await run(['issue', 'comment', String(ticketKey), '--repo', repo, '--body', String(text)])
      return {ticketKey: String(ticketKey), commented: true}
    },
    // 본문 교체. **호출자가 만든 본문을 그대로 넘긴다** — 이 메서드가 본문을 지어내지 않는다.
    // `--body`는 인자 길이 한계와 셸 인용 문제가 있어 stdin으로 넘긴다.
    async updateBody(ticketKey, body, {marker = null} = {}) {
      await run(['issue', 'edit', String(ticketKey), '--repo', repo, '--body-file', '-'], {stdin: String(marker ? withWorkMarker(body, marker) : body)})
      return {ticketKey: String(ticketKey), updated: true}
    },
    // 마커만 바꾼다 — 사람이 고친 본문은 그대로 두고 끝의 주석만 교체한다(GitHub은 마커가 본문 안에 산다).
    async updateMarker(ticketKey, marker, {currentBody}) {
      await run(['issue', 'edit', String(ticketKey), '--repo', repo, '--body-file', '-'], {stdin: withWorkMarker(currentBody, marker)})
      return {ticketKey: String(ticketKey), updated: true, scope: 'marker'}
    },
    // AI 작업 맥락. GitHub 이슈에는 파일 첨부 API가 없어 **접힌 코멘트 하나**로 두고, 동기화는 그 코멘트를 고친다.
    async attachContext(ticketKey, {name, content, previous = null}) {
      const body = `<details>\n<summary>AI 작업 맥락 · ${name}</summary>\n\n${content}\n</details>\n\n<!-- web-harness:work-context name=${name} -->`
      if (previous) {
        try {
          await run(['api', '--method', 'PATCH', `repos/${repo}/issues/comments/${previous}`, '--input', '-'], {stdin: JSON.stringify({body})})
          return {ref: String(previous), replaced: true}
        } catch (error) {
          // 사람이 코멘트를 지웠으면 새로 단다 — 다른 실패는 올린다.
          if (!/\b404\b|Not Found/.test(String(error?.message ?? error))) throw error
        }
      }
      const created = JSON.parse(await run(['api', '--method', 'POST', `repos/${repo}/issues/${ticketKey}/comments`, '--input', '-'], {stdin: JSON.stringify({body})}))
      if (!created?.id) throw new Error('GH_CONTEXT_NO_ID: 코멘트 생성 응답에 id가 없다')
      return {ref: String(created.id), replaced: false}
    },
    // 라벨 증감. 붙일 라벨은 생성과 같은 이유로 **먼저 보장**한다. 호출자가 준 것만 떼고 나머지 라벨은 건드리지 않는다.
    async updateLabels(ticketKey, {add = [], remove = []}) {
      for (const label of add) await run(labelEnsureArgs(repo, label))
      if (add.length > 0 || remove.length > 0) await run(labelEditArgs(repo, ticketKey, {add, remove}))
      return {ticketKey: String(ticketKey), added: add, removed: remove}
    },
    // 이슈 생성 — GitHub은 --label로 붙이려면 라벨이 먼저 존재해야 하므로(라이브 실측:
    // "could not add label: not found"), 각 라벨을 발행 *전에* 보장한다(--force=멱등).
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
 * @returns {Promise<{number: number, title: string, body: string, labels: string[], assignees: string[], revision: string|null, links: null, comments: Array|null, commentsOmitted: number|null}>}
 */
export async function resolveIssue({repo, number, host = 'github.com', exec = null}) {
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`INVALID_REPO: ${repo}`)
  const run = exec ?? ((args, options = {}) => gh(args, {host, ...options}))
  const parsed = JSON.parse(await run(viewArgs(repo, number)))
  return {
    number: parsed.number,
    provider: 'github',
    title: parsed.title ?? '',
    body: parsed.body ?? '',
    labels: (parsed.labels ?? []).map(l => l.name),
    assignees: (parsed.assignees ?? []).map(a => a.login),
    // 티켓 맥락 — Jira `parseIssueResponse`와 **같은 키**다(런타임 중립 계약). `null`은 「가져오지 않았다」.
    revision: parsed.updatedAt ?? null,
    links: null, // GitHub 이슈에는 유형 있는 링크가 없다 — 「없다」가 아니라 「이 트래커가 주지 않는다」
    comments: Array.isArray(parsed.comments)
      ? parsed.comments.map(item => ({author: item?.author?.login ?? null, created: item?.createdAt ?? null, body: item?.body ?? ''}))
      : null,
    commentsOmitted: null, // gh는 총수를 주지 않는다 — 덜 받았는지 모른다(0이라고 적지 않는다)
  }
}

export {featLabel}
