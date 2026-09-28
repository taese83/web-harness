#!/usr/bin/env node
// enforce-human-approval.mjs — 사람의 승인을 대신하는 행위는 Claude Code의 사용자 확인을 거친다.
//
// 대상: 승인 flag(`--allow-host-execution`·`--accept-workflow-findings`)가 붙은 Bash, 그리고 승인·인수 기록 파일에
// 대한 Write/Edit. 메인이든 서브에이전트든 같다 — 모델이 스펙·기본안 승인을 이 승인으로 읽고 스스로 붙이지 못하게.
// `ask`는 대화형이면 확인 창을 띄우고, 비대화 실행(-p)에서는 권한 모드와 무관하게 거부된다.
// 한계: 명령 문자열·경로 일치다 — 변수 분할·`node -e` 같은 고의적 우회는 막지 못한다(protected-core §4).
import {resolve} from 'node:path'
import {HUMAN_APPROVAL_FLAGS, humanApprovalFlagsIn} from './global-bash-policy-lib.mjs'

const APPROVAL_RECORDS = ['_workspace/03_dev/host-execution-grant.json', '_workspace/03_dev/workflow-security-acceptance.json']
const REASON = '사용자가 이 대화에서 명시적으로 승인한 경우에만 진행한다 — 스펙·기본안 승인은 이 승인이 아니다.'

const readInput = async () => {
  let source = ''
  for await (const chunk of process.stdin) source += chunk
  return JSON.parse(source)
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
    // 셸 리다이렉트·복사로 기록 파일을 만드는 형제 경로 — 이름이 명령에 보이면 확인한다(읽기·삭제 오탐은 무해).
    const named = APPROVAL_RECORDS.find(path => command.includes(path.split('/').at(-1)))
    if (named) return ask(`승인 기록 파일을 다루는 명령(${named})`)
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
