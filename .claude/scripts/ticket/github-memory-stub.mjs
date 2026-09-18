#!/usr/bin/env node
// github-memory-stub.mjs — 테스트 전용 GitHub Issues. `createGithubProvider({exec})`에 넣는 gh 대역이다.
// `stateFile`을 주면 상태를 파일에 두어, 같은 파일을 보는 `gh` 대역 실행 파일(이 파일을 직접 실행)과 공유한다 —
// 대상 프로젝트 CI에서 단독으로 도는 스크립트(`close-merged-tickets.mjs`)를 실제 프로세스로 돌리기 위해서다.
import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'

const notFound = number => new Error(`gh exit 1: GraphQL: Could not resolve to an issue or pull request with the number of ${number}. (repository.issue)`)
const flagValues = (args, name) => args.flatMap((arg, index) => (arg === name ? [args[index + 1]] : []))
const flagValue = (args, name) => flagValues(args, name)[0] ?? null

export function createGithubStub({stateFile = null, repo = 'acme/web'} = {}) {
  let state = {next: 1, commentId: 1000, clock: 0, issues: {}}
  const load = () => { if (stateFile && existsSync(stateFile)) state = JSON.parse(readFileSync(stateFile, 'utf8')) }
  const save = () => { if (stateFile) writeFileSync(stateFile, JSON.stringify(state)) }
  const touch = issue => { issue.updatedAt = new Date(Date.UTC(2026, 0, 1) + (state.clock += 1000)).toISOString() }
  const issueOf = number => {
    const issue = state.issues[String(number)]
    if (!issue) throw notFound(number)
    return issue
  }
  const view = (issue, fields) => Object.fromEntries(fields.split(',').map(field => [field,
    field === 'labels' ? issue.labels.map(name => ({name}))
      : field === 'assignees' ? issue.assignees.map(login => ({login}))
        : field === 'comments' ? issue.comments.map(item => ({author: {login: item.author}, body: item.body, createdAt: item.createdAt}))
          : issue[field] ?? null]))
  const create = ({title, body, labels = [], assignees = []}) => {
    const number = state.next++
    const issue = {number, title, body, labels: [...labels], assignees: [...assignees], state: 'OPEN', comments: []}
    touch(issue)
    state.issues[String(number)] = issue
    return issue
  }

  function handle(args, {stdin = null} = {}) {
    const [head, verb] = args
    if (head === 'label' && verb === 'create') return ''
    if (head === 'issue' && verb === 'create') {
      const issue = create({title: flagValue(args, '--title'), body: flagValue(args, '--body'), labels: flagValues(args, '--label'), assignees: flagValues(args, '--assignee')})
      return `Creating issue in ${repo}\n\nhttps://github.com/${repo}/issues/${issue.number}\n`
    }
    if (head === 'issue' && verb === 'view') return JSON.stringify(view(issueOf(args[2]), flagValue(args, '--json')))
    if (head === 'issue' && verb === 'list') {
      const wanted = flagValue(args, '--state') ?? 'open'
      const label = flagValue(args, '--label')
      const search = flagValue(args, '--search')
      const limit = Number(flagValue(args, '--limit') ?? 30)
      const rows = Object.values(state.issues)
        .filter(issue => wanted === 'all' || issue.state === wanted.toUpperCase())
        .filter(issue => !label || issue.labels.includes(label))
        .filter(issue => !search || issue.body.includes(search.replace(/ in:body$/, '')))
        .sort((a, b) => b.number - a.number).slice(0, limit)
      return JSON.stringify(rows.map(issue => view(issue, flagValue(args, '--json'))))
    }
    if (head === 'issue' && verb === 'edit') {
      const known = new Set(['--repo', '--add-assignee', '--remove-assignee', '--add-label', '--remove-label', '--body-file'])
      const unknown = args.slice(3).filter((arg, index) => index % 2 === 0 && !known.has(arg))
      if (unknown.length > 0) throw new Error(`gh exit 1: unknown flag: ${unknown[0]}`)
      const issue = issueOf(args[2])
      for (const login of flagValues(args, '--add-assignee')) if (!issue.assignees.includes(login)) issue.assignees.push(login)
      issue.assignees = issue.assignees.filter(login => !flagValues(args, '--remove-assignee').includes(login))
      for (const name of flagValues(args, '--add-label')) if (!issue.labels.includes(name)) issue.labels.push(name)
      issue.labels = issue.labels.filter(name => !flagValues(args, '--remove-label').includes(name))
      if (flagValue(args, '--body-file') === '-') issue.body = String(stdin ?? '')
      touch(issue)
      return `https://github.com/${repo}/issues/${issue.number}\n`
    }
    if (head === 'issue' && verb === 'comment') {
      const issue = issueOf(args[2])
      issue.comments.push({id: state.commentId++, author: 'bot', body: flagValue(args, '--body'), createdAt: new Date().toISOString()})
      touch(issue)
      return ''
    }
    if (head === 'issue' && verb === 'close') {
      const issue = issueOf(args[2])
      const comment = flagValue(args, '--comment')
      if (comment) issue.comments.push({id: state.commentId++, author: 'github-actions', body: comment, createdAt: new Date().toISOString()})
      issue.state = 'CLOSED'
      touch(issue)
      return ''
    }
    if (head === 'api') {
      const method = flagValue(args, '--method') ?? 'GET'
      const path = args.find(arg => arg.startsWith('repos/'))
      const commentOf = path.match(/issues\/comments\/(\d+)$/)
      if (method === 'PATCH' && commentOf) {
        const found = Object.values(state.issues).flatMap(issue => issue.comments).find(item => String(item.id) === commentOf[1])
        if (!found) throw new Error('gh exit 1: HTTP 404: Not Found')
        found.body = JSON.parse(stdin).body
        return JSON.stringify({id: found.id})
      }
      const postTo = path.match(/issues\/(\d+)\/comments$/)
      if (method === 'POST' && postTo) {
        const issue = issueOf(postTo[1])
        const item = {id: state.commentId++, author: 'bot', body: JSON.parse(stdin).body, createdAt: new Date().toISOString()}
        issue.comments.push(item)
        return JSON.stringify({id: item.id})
      }
      if (method === 'GET' && /\/issues\?state=all/.test(path)) {
        return Object.values(state.issues).map(issue => JSON.stringify({number: issue.number, title: issue.title, body: issue.body})).join('\n')
      }
    }
    throw new Error(`gh-stub: 모르는 명령 ${args.join(' ')}`)
  }

  return {
    exec: async (args, options = {}) => { load(); try { return handle(args, options) } finally { save() } },
    /** 사람이 트래커에서 직접 만든 이슈. */
    humanIssue: ({title, body, labels = [], assignees = []}) => { load(); const issue = create({title, body, labels, assignees}); save(); return String(issue.number) },
    issue: number => { load(); return state.issues[String(number)] ?? null },
    update: (number, change) => { load(); Object.assign(state.issues[String(number)], change); save() },
  }
}

// `gh` 대역으로 직접 실행될 때 — 상태 파일은 GH_STUB_STATE.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const stub = createGithubStub({stateFile: process.env.GH_STUB_STATE})
  stub.exec(process.argv.slice(2)).then(out => process.stdout.write(out), error => { process.stderr.write(`${error.message}\n`); process.exit(1) })
}
