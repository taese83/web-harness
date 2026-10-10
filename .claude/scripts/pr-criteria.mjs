#!/usr/bin/env node
// pr-criteria.mjs — 티켓 없는 change 라운드의 완료 기준을 PR 본문에 넣을 문단으로 낸다(번호·문장·검증 테스트 ID).
// change-scope는 개발자 로컬 파일이라 팀은 PR에서 기준을 본다. 티켓·계획 작업의 PR은 `link`의 `prBody`가 같은 일을 한다.
// 사용법: node .claude/scripts/pr-criteria.mjs --project-root <root> [--lang ko|en]
//   읽는 곳: <root>/_workspace/03_dev/change-scope.md의 `- ACC-R<n>-<k> <문장> · <LOCAL_VERIFIABLE|DEPLOY_ONLY> — TT-…` 줄.
//   가장 최근 라운드의 기준만, 최대 15줄. 문장은 300자까지 자르지 않는다. 내부 ID(ACC-)는 싣지 않는다. --lang 기본은 프로젝트 선언 언어.
// 종료 코드: 0 = 문단을 냄(기준이 없으면 빈 출력과 안내), 2 = 사용법 오류.
import {readFileSync, realpathSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {answerHelp} from './cli-help-lib.mjs'
import {renderRoundCriteria} from './ticket/work-link.mjs'
import {readDeclaredLanguage} from './ticket/ticket-config.mjs'

answerHelp(import.meta.url)

const invokedDirectly = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false } }
if (process.argv[1] !== undefined && invokedDirectly()) {
  const args = process.argv.slice(2)
  const value = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined }
  const root = value('--project-root')
  // --lang이 없으면 프로젝트가 선언한 언어(link와 같은 출처), 그것도 없으면 한국어.
  const declared = (() => { try { return root ? readDeclaredLanguage(resolve(root)) : null } catch { return null } })()
  const lang = value('--lang') ?? (declared === 'en' ? 'en' : 'ko')
  if (!root || !['ko', 'en'].includes(lang)) {
    process.stderr.write('사용법: node .claude/scripts/pr-criteria.mjs --project-root <root> [--lang ko|en]\n')
    process.exit(2)
  }
  let source = ''
  try { source = readFileSync(join(resolve(root), '_workspace/03_dev/change-scope.md'), 'utf8') } catch { /* 없으면 기준 없음 */ }
  const lines = renderRoundCriteria(source, {lang})
  if (lines.length === 0) process.stderr.write('change-scope에 라운드 완료 기준(ACC-R)이 없다 — 티켓 작업이면 link의 prBody를 쓴다.\n')
  else process.stdout.write(`${lines.join('\n')}\n`)
  process.exit(0)
}
