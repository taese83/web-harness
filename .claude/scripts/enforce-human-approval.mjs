#!/usr/bin/env node
// enforce-human-approval.mjs — 사람의 승인을 대신하는 행위는 Claude Code의 사용자 확인을 거친다.
//
// 대상: 승인 flag(`--allow-host-execution`·`--accept-workflow-findings`)가 붙은 Bash, 그리고 승인·인수 기록 파일에
// 대한 Write/Edit. 메인이든 서브에이전트든 같다 — 모델이 스펙·기본안 승인을 이 승인으로 읽고 스스로 붙이지 못하게.
// `ask`는 대화형이면 확인 창을 띄우고, 비대화 실행(-p)에서는 권한 모드와 무관하게 거부된다.
// 한계: 명령 문자열 일치다 — 변수 분할·이름 쪼개기(`host-execution-gr"ant.json`)는 막지 못한다(protected-core §4).
import {resolve} from 'node:path'
import {HUMAN_APPROVAL_FLAGS, humanApprovalFlagsIn} from './global-bash-policy-lib.mjs'

const APPROVAL_RECORDS = ['_workspace/03_dev/host-execution-grant.json', '_workspace/03_dev/workflow-security-acceptance.json']
const REASON = '사용자가 이 대화에서 명시적으로 승인한 경우에만 진행한다 — 스펙·기본안 승인은 이 승인이 아니다.'

const readInput = async () => {
  let source = ''
  for await (const chunk of process.stdin) source += chunk
  return JSON.parse(source)
}
// 기록 파일 이름이 보이는 명령은 기본이 확인이다 — **읽기 전용으로 알아본 형태만** 묻지 않는다(모르면 묻는다, fail-closed).
// 승인을 지어내는 길은 쓰기뿐이라, 읽기·삭제(승인을 거둔다)·스테이징 해제까지 묻으면 확인이 반사적 클릭이 된다.
// 읽기 전용: 첫 단어(경로·VAR= 접두 제거)가 읽기 명령이고, 같은 파이프의 뒤 단계도 읽기 소비자이며, 리다이렉트·heredoc이 없다.
const READ_ONLY = new Set(['cat', 'head', 'tail', 'less', 'more', 'jq', 'grep', 'egrep', 'fgrep', 'rg', 'ls', 'wc', 'stat', 'file',
  'diff', 'cmp', 'md5', 'md5sum', 'shasum', 'sha256sum', 'test', '[', 'rm', 'echo', 'printf'])
const READ_CONSUMERS = new Set(['cat', 'head', 'tail', 'less', 'more', 'jq', 'grep', 'egrep', 'fgrep', 'rg', 'wc', 'sort', 'uniq', 'cut', 'tr', 'column'])
const GIT_READ = /^git\s+(?:status|diff|log|show|add|check-ignore|ls-files|blame|rm\s+(?:.*\s)?--cached)(?:\s|$)/
const GIT_UNSTAGE = /^git\s+restore\s+(?:\S+\s+)*--staged(?:\s|$)/
const head = stage => {
  const words = stage.trim().split(/\s+/).filter(word => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word))
  return {word: (words[0] ?? '').split('/').at(-1), text: words.join(' ')}
}
const readOnlyStage = stage => {
  const {word, text} = head(stage)
  if (word === 'git') return GIT_READ.test(text) || (GIT_UNSTAGE.test(text) && !/(?:^|\s)(?:-W|--worktree)(?:\s|$)/.test(text))
  // echo·printf는 파이프 앞에서 이름을 내보낼 때만 읽기다(뒤 단계가 읽기 소비자인지 아래에서 본다).
  return READ_ONLY.has(word)
}
export const mayWriteRecord = (command, name) => {
  const source = String(command)
  if (!source.includes(name)) return false
  // heredoc은 본문을 가를 수 없어 쓰기로 센다. 리다이렉트(`>`·`>>`·`>|`·`&>`·`2>`·`>&`)는 대상이 기록 파일이거나
  // 셸이 펼치는 값(`$F`·백틱)일 때 쓰기다 — `2>/dev/null`·`2>&1`·다른 파일로 내보내기는 기록을 만들지 않는다.
  if (/<<-?\s*['"]?\w+/.test(source)) return true
  for (const match of source.matchAll(/(?:\d|&)?>{1,2}[|&]?\s*([^\s;|&<>]+)/g)) {
    const target = match[1]
    if (target.includes(name) || /[$`]/.test(target)) return true
  }
  return source.split(/\n|;|&&|\|\|/).some(statement => {
    if (!statement.includes(name)) return false
    const stages = statement.split('|')
    const at = stages.findIndex(stage => stage.includes(name))
    if (!stages.slice(0, at + 1).every(readOnlyStage)) return true
    if (stages.slice(at + 1).some(stage => !READ_CONSUMERS.has(head(stage).word))) return true
    // echo·printf가 이름을 내보내면 뒤 단계가 있어야 읽기다 — 혼자면 출력일 뿐이라 통과.
    return false
  })
}

const ask = subject => JSON.stringify({
  hookSpecificOutput: {hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: `${subject}: ${REASON}`},
})

const decide = input => {
  if (input?.tool_name === 'Bash') {
    const command = String(input.tool_input?.command ?? '')
    const flags = humanApprovalFlagsIn(command)
    if (flags.length > 0) return ask(flags.join(' '))
    // 팀 소유 잠금을 지우고 스팩을 다시 확정하는 마이그레이션 적용 — 미리보기는 묻지 않는다.
    if (/migrate-profile-lock/.test(command) && /(?:^|\s)--apply(?:\s|$)/.test(command)) return ask('migrate-profile-lock --apply(프로필 잠금 삭제·스팩 재확정)')
    // 쓰기 범위 넓히기 적용 — developer 소유권(layerMap ∩ 범위)을 넓히는 행위다. 미리보기는 묻지 않는다.
    // 프로젝트 밖 파일 들이기 — 사용자가 준 파일인지 사람이 확인한다.
    if (/import-source\.mjs/.test(command)) return ask('import-source(프로젝트 밖 파일을 _workspace/00_source로 복사)')
    if (/widen-change-scope/.test(command) && /(?:^|\s)--apply(?:\s|$)/.test(command)) return ask('widen-change-scope --apply(이번 라운드 쓰기 범위 넓히기)')
    // 셸 리다이렉트·복사로 기록 파일을 만드는 형제 경로 — 이름이 명령에 보이면 확인한다(읽기·삭제 오탐은 무해).
    const named = APPROVAL_RECORDS.find(path => mayWriteRecord(command, path.split('/').at(-1)))
    if (named) return ask(`승인 기록 파일을 쓸 수 있는 명령(${named})`)
  } else if (['Write', 'Edit'].includes(input?.tool_name)) {
    const target = String(input.tool_input?.file_path ?? '').split('\\').join('/')
    const root = resolve(process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? '.').split('\\').join('/')
    const record = APPROVAL_RECORDS.find(path => target === `${root}/${path}` || target.endsWith(`/${path}`))
    if (record) return ask(`승인 기록 직접 쓰기(${record})`)
  }
  return ''
}

try {
  process.stdout.write(decide(await readInput()))
} catch (error) {
  // 입력을 못 읽으면 확인으로 떨어진다 — 승인 행위를 조용히 통과시키지 않는다.
  process.stdout.write(ask(`승인 훅 입력 오류(${error instanceof Error ? error.message : String(error)}; 대상 flag: ${HUMAN_APPROVAL_FLAGS.join(', ')})`))
}
process.exitCode = 0
