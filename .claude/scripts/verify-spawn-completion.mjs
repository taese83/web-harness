#!/usr/bin/env node
// verify-spawn-completion.mjs — 서브에이전트 스폰 완결성의 기계 검증 (dependency-free).
//
// execution-budget-contract.md "스폰 완결성 게이트"의 layer 2 구현.
// 오케스트레이터가 구현/빌더 스폰 직후, 다음 의존 단계로 진행하기 전에 호출한다.
// 스폰이 남긴 owned 파일이 (a) 존재하고 비어있지 않은지, (b) 편집 도중 truncate된
// 흔적(미종결 문자열/주석/템플릿, 짝 안 맞는 괄호, dangling opener/operator로 끝남)이
// 없는지 검사한다. TypeScript 타입 오류 같은 의미 결함은 범위 밖이다 — 그건 toolchain이
// 있을 때 run-quality-gates(typecheck)가 잡는 더 깊은 게이트다. 이 스크립트는 install
// 없이 항상 도는 1차 방어선으로, probe가 실측한 "빌더가 편집 도중 잘려 깨진 파일을
// 남김" 실패 클래스를 잡는다.
//
// 사용법:
//   node .claude/scripts/verify-spawn-completion.mjs --root <project> --paths <p1> [p2 ...]
//   node .claude/scripts/verify-spawn-completion.mjs --root <project> --expect <f1> [f2 ...]
//   옵션: --json (기계 판독 출력), --allow-empty (빈 파일 허용),
//         --allow-no-output (--paths가 산출물 0개여도 통과 — 산출물 없는 스폰이 정당할 때만)
// 종료 코드: 0 = 전부 OK, 1 = SUSPECT/누락/무산출 있음, 2 = 사용법/입력 오류.
//
// 무산출 가드(2026-08-11 추가): `--paths`로 owned 범위를 지정했는데 스캔 가능한 산출물이
// 0개면 vacuous PASS가 아니라 FAIL이다 — 실측(seminar-booking 도메인 빌더)에서 스폰이
// 스펙 재독에만 예산을 쓰고 파일을 하나도 쓰지 못한 채 종료했는데 "검사 0 · PASS"로
// 통과할 뻔했다. 산출물이 정당하게 0개인 스폰(예: 검증 전용)은 --allow-no-output으로 명시.

import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs'
import {extname, join, relative, resolve} from 'node:path'

export const SCANNABLE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

function parseArgs(argv) {
  const out = {root: '.', paths: [], expect: [], json: false, allowEmpty: false, allowNoOutput: false}
  let bucket = null
  for (const arg of argv) {
    if (arg === '--json') { out.json = true; bucket = null; continue }
    if (arg === '--allow-empty') { out.allowEmpty = true; bucket = null; continue }
    if (arg === '--allow-no-output') { out.allowNoOutput = true; bucket = null; continue }
    if (arg === '--root') { bucket = 'root'; continue }
    if (arg === '--paths') { bucket = 'paths'; continue }
    if (arg === '--expect') { bucket = 'expect'; continue }
    if (arg.startsWith('--')) { bucket = null; continue }
    if (bucket === 'root') { out.root = arg; bucket = null; continue }
    if (bucket === 'paths') { out.paths.push(arg); continue }
    if (bucket === 'expect') { out.expect.push(arg); continue }
  }
  return out
}

function collectFiles(root, paths) {
  const files = new Set()
  const walk = (abs) => {
    let st
    try { st = statSync(abs) } catch { return }
    if (st.isDirectory()) {
      for (const name of readdirSync(abs)) {
        if (name === 'node_modules' || name === '.next' || name === '.git' || name === '__tests__') continue
        walk(join(abs, name))
      }
      return
    }
    if (st.isFile() && SCANNABLE.has(extname(abs))) files.add(abs)
  }
  for (const p of paths) walk(resolve(root, p))
  return [...files].sort()
}

// 무산출 가드용 — owned 범위에 **확장자 무관** 파일이 하나라도 존재하는지. collectFiles는
// truncation 스캔 대상(scannable 확장자)만 모으므로, 산출물이 정당하게 비-code(.md/.json/
// .yml/.sql 등: package-scaffolder·designer·deploy-ci-writer류)면 "무산출"과 혼동된다.
function anyFilePresent(root, paths) {
  const walk = (abs) => {
    let st
    try { st = statSync(abs) } catch { return false }
    if (st.isDirectory()) {
      for (const name of readdirSync(abs)) {
        if (name === 'node_modules' || name === '.next' || name === '.git' || name === '__tests__') continue
        if (walk(join(abs, name))) return true
      }
      return false
    }
    return st.isFile()
  }
  return paths.some(p => walk(resolve(root, p)))
}

// 정규식/문자열/주석/템플릿을 건너뛰며 괄호 균형과 truncation 신호를 스캔한다.
// 정규식 처리를 넣는 이유: `/\[\[cite:...\]\]/g` 같은 정규식 안의 [ ] 를 코드 괄호로
// 오인하면 정상 파일에 false positive가 난다.
// NOTE: '<' 와 '>' 는 의도적으로 제외한다. JSX 닫는 태그 `</div>` 의 `/` 가 `<`
// (비교 연산자) 뒤에 와서 정규식 시작으로 오인되면 모든 .tsx 컴포넌트가 false
// positive가 된다(실측: P1 tenant-isolation-probe의 layout/page.tsx). 비교 연산자
// 뒤에 정규식 리터럴이 오는 경우는 극히 드물어, JSX 오탐 비용이 훨씬 크다.
const REGEX_PRECEDERS = new Set([
  '(', ',', '=', ':', '[', '{', ';', '!', '&', '|', '?', '+', '-', '*', '%', '~', '^', 'return', 'typeof', 'instanceof', 'in', 'of', 'case', 'do', 'else', 'void', 'delete', 'throw', 'new', 'yield', 'await',
])

export function scanSource(text) {
  const reasons = []
  const openers = []
  let state = 'code' // code | line | block | sq | dq | tpl | regex | regexClass
  let line = 1
  let prevToken = '' // last significant token/char (for regex-position detection)
  let word = ''
  const n = text.length
  for (let i = 0; i < n; i++) {
    const c = text[i]
    const c2 = i + 1 < n ? text[i + 1] : ''
    if (c === '\n') line++

    if (state === 'line') { if (c === '\n') state = 'code'; continue }
    if (state === 'block') { if (c === '*' && c2 === '/') { state = 'code'; i++ } continue }
    if (state === 'sq') { if (c === '\\') { i++; continue } if (c === '\n') { reasons.push(`line ${line}: 미종결 작은따옴표 문자열`); state = 'code' } else if (c === "'") { state = 'code'; prevToken = "'str'" } continue }
    if (state === 'dq') { if (c === '\\') { i++; continue } if (c === '\n') { reasons.push(`line ${line}: 미종결 큰따옴표 문자열`); state = 'code' } else if (c === '"') { state = 'code'; prevToken = '"str"' } continue }
    if (state === 'regex') { if (c === '\\') { i++; continue } if (c === '[') state = 'regexClass'; else if (c === '/') { state = 'code'; prevToken = '/re/' } else if (c === '\n') { reasons.push(`line ${line}: 미종결 정규식`); state = 'code' } continue }
    if (state === 'regexClass') { if (c === '\\') { i++; continue } if (c === ']') state = 'regex'; else if (c === '\n') { reasons.push(`line ${line}: 미종결 정규식 클래스`); state = 'code' } continue }
    if (state === 'tpl') {
      if (c === '\\') { i++; continue }
      if (c === '`') { state = 'code'; prevToken = '`tpl`'; continue }
      if (c === '$' && c2 === '{') { openers.push({ch: '${', line}); state = 'code'; i++; continue }
      continue
    }

    // state === 'code'
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { continue }
    if (c === '/' && c2 === '/') { state = 'line'; i++; continue }
    if (c === '/' && c2 === '*') { state = 'block'; i++; continue }
    if (c === '/' && REGEX_PRECEDERS.has(prevToken)) { state = 'regex'; continue }
    if (c === "'") { state = 'sq'; continue }
    if (c === '"') { state = 'dq'; continue }
    if (c === '`') { state = 'tpl'; continue }

    if (/[A-Za-z_$]/.test(c)) { word += c; prevToken = ''; continue }
    if (word) { prevToken = word; word = '' }

    if (c === '(' || c === '[' || c === '{') { openers.push({ch: c, line}); prevToken = c; continue }
    if (c === ')' || c === ']' || c === '}') {
      const top = openers.pop()
      if (!top) { reasons.push(`line ${line}: 짝 없는 닫는 '${c}'`) }
      else if (top.ch === '${') { if (c === '}') { state = 'tpl' } else { reasons.push(`line ${line}: 템플릿 표현식이 '${c}'로 닫힘`) } }
      else {
        const expected = top.ch === '(' ? ')' : top.ch === '[' ? ']' : '}'
        if (expected !== c) reasons.push(`line ${line}: 불일치 닫힘 '${c}' (열림 '${top.ch}' @line ${top.line})`)
      }
      prevToken = c
      continue
    }
    prevToken = c
  }

  if (state === 'block') reasons.push('EOF: 미종결 블록 주석 /* */')
  else if (state === 'sq' || state === 'dq') reasons.push('EOF: 미종결 문자열')
  else if (state === 'tpl') reasons.push('EOF: 미종결 템플릿 리터럴 `')
  else if (state === 'regex' || state === 'regexClass') reasons.push('EOF: 미종결 정규식')
  if (openers.length > 0) {
    const top = openers[openers.length - 1]
    reasons.push(`EOF: 미종결 여는 괄호 ${openers.length}개 (마지막 '${top.ch}' @line ${top.line}) — truncation 의심`)
  }

  // dangling operator/opener로 끝나는지 (마지막 비어있지 않은 코드 줄)
  const lines = text.split('\n')
  for (let li = lines.length - 1; li >= 0; li--) {
    const raw = lines[li].replace(/\/\/.*$/, '').trimEnd()
    if (raw.trim() === '') continue
    if (/(=|,|\(|\[|\{|&&|\|\||=>)$/.test(raw)) {
      reasons.push(`EOF: 마지막 코드 줄이 '${raw.slice(-2).trim()}'로 끝남 — 문장 미완(truncation 의심)`)
    }
    break
  }
  return reasons
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const root = resolve(opts.root)
  if (!existsSync(root)) { console.error(`root 없음: ${root}`); process.exit(2) }
  if (opts.paths.length === 0 && opts.expect.length === 0) {
    console.error('사용법: --paths <dir/file...> 또는 --expect <file...> 중 최소 하나 필요')
    process.exit(2)
  }

  const results = []
  let suspect = 0
  let missing = 0

  // --expect: 선언된 산출물이 실제 존재하는지 (crash로 미작성 감지)
  for (const rel of opts.expect) {
    const abs = resolve(root, rel)
    const exists = existsSync(abs) && statSync(abs).isFile()
    const empty = exists && statSync(abs).size === 0
    if (!exists) { missing++; results.push({file: rel, status: 'MISSING', reasons: ['선언된 산출물이 존재하지 않음(스폰이 작성 전 중단됐을 수 있음)']}) }
    else if (empty && !opts.allowEmpty) { suspect++; results.push({file: rel, status: 'SUSPECT', reasons: ['파일이 비어 있음']}) }
    else results.push({file: rel, status: 'OK', reasons: []})
  }

  // --paths: 스캔 가능한 파일 truncation 검사
  const files = collectFiles(root, opts.paths)
  // 무산출 가드: owned 범위(--paths)를 지정했는데 **어떤 확장자의 파일도** 0개이고
  // --expect도 아무것도 매칭하지 못했으면, 스폰이 선언 범위에 아무것도 남기지 않은 것이다
  // (vacuous PASS 방지). 비-code 산출물(.md/.json/.yml 등)이 있으면 무산출이 아니다 —
  // collectFiles(scannable만)가 아니라 anyFilePresent(확장자 무관)로 판정한다.
  if (opts.paths.length > 0 && opts.expect.length === 0 && !opts.allowNoOutput && !anyFilePresent(root, opts.paths)) {
    missing++
    results.push({file: opts.paths.join(' '), status: 'MISSING', reasons: ['스폰이 owned 범위에 산출물을 하나도 남기지 않음(스펙만 읽고 작성 전 종료 의심) — 산출물 없는 스폰이 정당하면 --allow-no-output']})
  }
  for (const abs of files) {
    const rel = relative(root, abs)
    const size = statSync(abs).size
    if (size === 0) { if (!opts.allowEmpty) { suspect++; results.push({file: rel, status: 'SUSPECT', reasons: ['파일이 비어 있음']}) } else results.push({file: rel, status: 'OK', reasons: []}); continue }
    const reasons = scanSource(readFileSync(abs, 'utf8'))
    if (reasons.length > 0) { suspect++; results.push({file: rel, status: 'SUSPECT', reasons}) }
    else results.push({file: rel, status: 'OK', reasons: []})
  }

  const scanned = results.length
  const failed = suspect + missing
  if (opts.json) {
    console.log(JSON.stringify({schemaVersion: 1, root, scanned, ok: scanned - failed, suspect, missing, results}, null, 2))
  } else {
    for (const r of results) {
      if (r.status === 'OK') continue
      console.log(`  ${r.status === 'MISSING' ? '❌ MISSING' : '⚠️  SUSPECT'} ${r.file}`)
      for (const reason of r.reasons) console.log(`      - ${reason}`)
    }
    console.log(`\n완결성: 검사 ${scanned} · OK ${scanned - failed} · SUSPECT ${suspect} · MISSING ${missing}`)
    if (failed === 0) console.log('PASS ✅ — truncation/누락 신호 없음')
    else console.log(`FAIL ❌ — ${failed}건. 스폰을 완료로 처리하지 말 것: re-spawn(retry 예산) 또는 NEEDS_DECISION.`)
  }
  process.exit(failed === 0 ? 0 : 1)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
