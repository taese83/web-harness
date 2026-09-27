// cli-help-lib.mjs — `--help`/`-h` 단독 인자에 사용법만 답하고 exit 0으로 끝낸다(부작용 없음).
//
// 사용법은 스크립트 첫머리 주석 블록이다 — 목적·사용법·종료 코드를 이미 거기 적는다. 호출한 모듈이 **직접 실행된
// 스크립트일 때만** 답한다: 다른 CLI가 이 모듈을 import한 채 `--help`로 불리면 그 CLI의 도움말을 가로채지 않는다.
import {readFileSync, realpathSync} from 'node:fs'
import {basename} from 'node:path'
import {fileURLToPath} from 'node:url'

export const headerUsage = source => {
  const lines = source.split(/\r?\n/)
  let index = lines[0]?.startsWith('#!') ? 1 : 0
  const header = []
  for (; index < lines.length && lines[index].startsWith('//'); index += 1) header.push(lines[index].replace(/^\/\/ ?/, ''))
  return header.join('\n').trim()
}

export const answerHelp = (moduleUrl, args = process.argv.slice(2)) => {
  if (args.length !== 1 || !['--help', '-h'].includes(args[0])) return
  const modulePath = fileURLToPath(moduleUrl)
  let invokedDirectly = false
  try { invokedDirectly = realpathSync(process.argv[1] ?? '') === realpathSync(modulePath) } catch {}
  if (!invokedDirectly) return
  const usage = headerUsage(readFileSync(modulePath, 'utf8')) || `${basename(modulePath)} — 사용법 주석이 없다`
  process.stdout.write(`${usage}\n`)
  process.exit(0)
}
