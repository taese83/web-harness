#!/usr/bin/env node
// test-plugin-eval-checks.mjs — 배포본 평가의 결정적 판정(사후 검사·환경 오류·실행 디렉터리 가드).
//
// 고정하는 사실:
//   - source-unchanged는 시드 src와 작업 공간 src를 파일 해시로 대조한다 — 수정·추가·삭제 모두 문제, 무변경은 통과(쓴 에이전트와 무관)
//   - ticket-drafts-valid는 배포본 초안 검사기로 본다 — 양식이 틀린 초안·초안 없음·티켓 수 초과는 문제
//   - 환경 오류는 배포본에 **있는** 스크립트를 디스패처가 못 찾은 경우뿐이다 — 없는 이름(사용 실수)은 아니다
//   - 실행 디렉터리 가드는 tmp 루트 바로 아래 `e-*`만 받는다 — tmp 루트 자신·다른 이름은 null(열지도 지우지도 않는다)
//   - 트리 digest는 파일 이름과 내용에 묶인다 — 사례를 고치면 receipt의 사례 digest가 바뀐다
//   - artifact-exists는 산출물 파일이나 같은 이름의 분할 디렉터리를 받는다
//   - 인증 실패로 모델에 닿지 못한 실행은 환경 오류다 — 다른 실행 오류는 판정에 남긴다
//   - file-absent는 경로가 있으면 잡는다 — 멈춰야 할 단계를 넘은 실행(서브에이전트의 쓰기 포함)
//   - artifact-matches는 산출물 파일이나 분할 INDEX.md에서 패턴을 찾는다 — 없거나 안 맞으면 잡는다
//   - 디스패처를 셸이 못 찾은 실행(exit 127)은 배포본에 디스패처가 있을 때만 환경 오류다 — 없으면 빌드 결함이다
//   - 평가 세션 PATH는 평가 대상의 bin을 앞에 두고 설치본 플러그인의 bin은 뺀다 — 설치본과 같은 조건에서 잰다
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync} from 'node:fs'
import {delimiter, join, sep} from 'node:path'
import {tmpdir} from 'node:os'
import {dispatcherNotOnPath, dispatchMisses, evalSessionPath, runChecks, runFailureEnvironmentErrors, runRootOf, treeDigest} from './plugin-eval-checks-lib.mjs'
import * as draftValidator from './ticket/ticket-create.mjs'

const withRoot = run => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-eval-checks-')))
  try { return run(root) } finally { rmSync(root, {recursive: true, force: true}) }
}
const write = (root, path, text) => { mkdirSync(join(root, path, '..'), {recursive: true}); writeFileSync(join(root, path), text) }
const SOURCE = [{type: 'source-unchanged'}]

test('source-unchanged: 수정·추가·삭제를 잡고 무변경은 통과한다', () => withRoot(root => {
  const seed = join(root, 'seed/src')
  write(root, 'seed/src/app/routes.tsx', 'routes')
  write(root, 'seed/src/shared/lib/formatDate.ts', 'format')
  const workspace = join(root, 'ws')
  write(root, 'ws/src/app/routes.tsx', 'routes')
  write(root, 'ws/src/shared/lib/formatDate.ts', 'format')
  const check = () => runChecks(SOURCE, {workspace, seedSource: seed, draftValidator})
  assert.deepEqual(check(), [])
  write(root, 'ws/src/app/routes.tsx', 'routes + settings')
  assert.match(check()[0], /src\/app\/routes\.tsx/, '수정을 놓쳤다')
  write(root, 'ws/src/app/routes.tsx', 'routes')
  write(root, 'ws/src/pages/settings/SettingsPage.tsx', 'new')
  assert.match(check()[0], /src\/pages\/settings\/SettingsPage\.tsx/, '추가를 놓쳤다')
  unlinkSync(join(workspace, 'src/pages/settings/SettingsPage.tsx'))
  unlinkSync(join(workspace, 'src/shared/lib/formatDate.ts'))
  assert.match(check()[0], /src\/shared\/lib\/formatDate\.ts/, '삭제를 놓쳤다')
  assert.match(runChecks(SOURCE, {workspace, seedSource: null, draftValidator})[0], /대조할 시드/)
  assert.match(runChecks(SOURCE, {workspace: null, seedSource: seed, draftValidator})[0], /작업 공간을 열지 못했다/)
}))

test('ticket-drafts-valid: 배포본 초안 검사기로 양식·티켓 수·초안 부재를 잡는다', () => withRoot(root => {
  const checks = [{type: 'ticket-drafts-valid', directory: 'drafts', maxTickets: 1}]
  const valid = '## 홈에 최근 본 항목 추가\n\n### 목적\n\n최근 본 항목을 보여 준다.\n\n### 작업 내용\n\n- 홈에 섹션을 더한다\n\n### 완료 조건\n\n- 홈에 최근 본 항목 섹션이 보인다\n\n### 선행·협의\n\n- 없음\n'
  assert.match(runChecks(checks, {workspace: root, seedSource: null, draftValidator})[0], /초안이 없다/)
  write(root, 'drafts/a.md', valid)
  assert.deepEqual(runChecks(checks, {workspace: root, seedSource: null, draftValidator}), [])
  write(root, 'drafts/a.md', valid.replace('## 홈', '# 홈').replaceAll('### ', '## '))
  assert.ok(runChecks(checks, {workspace: root, seedSource: null, draftValidator}).some(problem => /절이 없거나 비었다/.test(problem)), '틀린 제목 수준(# 제목·## 절)을 초안 검사기로 잡지 못했다')
  write(root, 'drafts/a.md', `${valid}\n${valid.replace('홈에 최근 본 항목 추가', '두 번째 티켓')}`)
  assert.ok(runChecks(checks, {workspace: root, seedSource: null, draftValidator}).some(problem => /티켓 2개/.test(problem)), '티켓 수 상한을 넘겼는데 통과시켰다')
}))

test('환경 오류는 배포본에 있는 스크립트의 디스패치 실패만 센다', () => withRoot(root => {
  write(root, 'scripts/ticket/cli.mjs', '')
  const trace = 'web-harness-script: not part of the plugin runtime: ticket/cli\nweb-harness-script: not part of the plugin runtime: --help\nweb-harness-script: not part of the plugin runtime: nope'
  assert.deepEqual(dispatchMisses(trace, join(root, 'scripts')), ['ticket/cli'])
  assert.deepEqual(dispatchMisses('', join(root, 'scripts')), [])
}))

test('실행 디렉터리 가드: tmp 루트 바로 아래 e-*만 받는다', () => withRoot(root => {
  mkdirSync(join(root, 'e-Abc123/out'), {recursive: true})
  mkdirSync(join(root, 'other/out'), {recursive: true})
  assert.equal(runRootOf(join(root, 'e-Abc123/out/trace.jsonl'), [root]), join(root, 'e-Abc123'))
  assert.equal(runRootOf(join(root, 'other/out/trace.jsonl'), [root]), null, 'e- 아닌 디렉터리를 실행 디렉터리로 받았다')
  assert.equal(runRootOf(join(root, 'e-Abc123/out/trace.jsonl'), ['/nowhere']), null, 'tmp 루트 밖을 받았다')
  assert.equal(runRootOf(join(root, 'trace.jsonl'), [root]), null, 'tmp 루트 위를 가리키는 경로를 받았다')
  assert.equal(runRootOf(null, [root]), null)
}))

test('트리 digest는 파일 이름과 내용에 묶인다 — 사례를 고치면 receipt의 사례 digest가 바뀐다', () => withRoot(root => {
  write(root, 'case/prompt.md', '요청 A')
  write(root, 'case/graders/marker.md', 'grader')
  const before = treeDigest(join(root, 'case'))
  assert.equal(treeDigest(join(root, 'case')), before, '같은 트리에서 digest가 흔들린다')
  write(root, 'case/prompt.md', '요청 B')
  assert.notEqual(treeDigest(join(root, 'case')), before, '요청을 고쳤는데 digest가 같다')
  write(root, 'case/prompt.md', '요청 A')
  write(root, 'case/graders/extra.md', 'grader')
  assert.notEqual(treeDigest(join(root, 'case')), before, '채점기를 더했는데 digest가 같다')
}))

test('artifact-exists는 파일이나 같은 이름의 분할 디렉터리를 받고, 둘 다 없으면 잡는다', () => withRoot(root => {
  const check = [{type: 'artifact-exists', path: '_workspace/01_plan/ux-brief'}]
  assert.match(runChecks(check, {workspace: root, seedSource: null, draftValidator})[0], /ux-brief\(\.md 또는 분할 디렉터리\)가 없다/)
  write(root, '_workspace/01_plan/ux-brief.md', 'brief')
  assert.deepEqual(runChecks(check, {workspace: root, seedSource: null, draftValidator}), [])
  unlinkSync(join(root, '_workspace/01_plan/ux-brief.md'))
  write(root, '_workspace/01_plan/ux-brief/INDEX.md', 'index')
  assert.deepEqual(runChecks(check, {workspace: root, seedSource: null, draftValidator}), [], '분할 산출물을 없는 것으로 봤다')
}))

test('인증 실패로 모델에 닿지 못한 실행은 환경 오류다 — 다른 실행 오류는 판정에 남긴다', () => {
  const expired = 'exit 1: Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue.'
  assert.equal(runFailureEnvironmentErrors(expired).length, 1)
  assert.match(runFailureEnvironmentErrors(expired)[0], /claude auth login/)
  assert.deepEqual(runFailureEnvironmentErrors('exit 1: max turns reached'), [], '플러그인이 만든 실패를 환경 오류로 뺐다')
  assert.deepEqual(runFailureEnvironmentErrors(null), [])
})

test('file-absent는 경로가 생기면 잡는다 — 멈춰야 할 단계를 넘은 실행', () => withRoot(root => {
  const check = [{type: 'file-absent', path: '_workspace/03_dev/spec.json'}]
  assert.deepEqual(runChecks(check, {workspace: root, seedSource: null, draftValidator}), [])
  write(root, '_workspace/03_dev/spec.json', '{}')
  assert.match(runChecks(check, {workspace: root, seedSource: null, draftValidator})[0], /spec\.json가 있다/)
}))

test('artifact-matches는 파일이나 분할 INDEX.md에서 패턴을 찾고, 없거나 안 맞으면 잡는다', () => withRoot(root => {
  const check = [{type: 'artifact-matches', path: '_workspace/02_design/api-schema', pattern: '^API_CONTRACT: provisional'}]
  assert.match(runChecks(check, {workspace: root, seedSource: null, draftValidator})[0], /api-schema\(\.md 또는 분할 INDEX\.md\)가 없다/)
  write(root, '_workspace/02_design/api-schema.md', '# API Schema\n\nAPI_CONTRACT: confirmed (openapi.yaml)\n')
  assert.match(runChecks(check, {workspace: root, seedSource: null, draftValidator})[0], /API_CONTRACT: provisional\/가 없다/, '다른 상태를 맞는 것으로 봤다')
  write(root, '_workspace/02_design/api-schema.md', '# API Schema\n\nAPI_CONTRACT: provisional\n')
  assert.deepEqual(runChecks(check, {workspace: root, seedSource: null, draftValidator}), [])
  unlinkSync(join(root, '_workspace/02_design/api-schema.md'))
  write(root, '_workspace/02_design/api-schema/INDEX.md', '# API Schema\n\nAPI_CONTRACT: provisional\n')
  assert.deepEqual(runChecks(check, {workspace: root, seedSource: null, draftValidator}), [], '분할 산출물의 INDEX를 보지 않았다')
}))

test('디스패처를 셸이 못 찾은 실행은 배포본에 디스패처가 있을 때만 환경 오류다', () => withRoot(root => {
  const trace = '{"type":"user","message":{"content":[{"type":"tool_result","content":"(eval):1: command not found: web-harness-script"}]}}'
  assert.deepEqual(dispatcherNotOnPath(trace, join(root, 'bin')), [], '배포본에 디스패처가 없는데 환경 오류로 뺐다 — 빌드 결함을 숨긴다')
  write(root, 'bin/web-harness-script', '#!/usr/bin/env bash\n')
  assert.equal(dispatcherNotOnPath(trace, join(root, 'bin')).length, 1)
  assert.deepEqual(dispatcherNotOnPath('{"ok":true}', join(root, 'bin')), [])
  assert.equal(dispatcherNotOnPath('bash: web-harness-script: command not found', join(root, 'bin')).length, 1, 'bash 형식을 놓쳤다')
  assert.deepEqual(dispatcherNotOnPath('(eval):1: command not found: web-harness-scripts', join(root, 'bin')), [],
    '이름이 다른 명령(오타)을 PATH 누락으로 읽었다 — 플러그인 결함을 판정에서 뺀다')
}))

test('평가 세션 PATH는 평가 대상의 bin을 앞에 두고 설치본 플러그인의 bin은 뺀다', () => {
  const installed = ['', 'Users', 'u', '.claude', 'plugins', 'cache', 'web-harness', '0.46.0', 'bin'].join(sep)
  const path = evalSessionPath(join(sep, 'tmp', 'eval', 'web-harness'), ['/usr/bin', installed, '/bin'].join(delimiter)).split(delimiter)
  assert.equal(path[0], join(sep, 'tmp', 'eval', 'web-harness', 'bin'), '평가 대상의 디스패처가 PATH에 없다 — 서브에이전트가 exit 127로 실패한다')
  assert.ok(!path.includes(installed), '설치본 디스패처가 남았다 — 평가 대상이 아닌 판본을 잰다')
  assert.deepEqual(path.slice(1), ['/usr/bin', '/bin'])
})
