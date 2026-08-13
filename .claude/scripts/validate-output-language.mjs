#!/usr/bin/env node
// validate-output-language.mjs — 선언한 산출물 언어와 실제 산출물이 일치하는지 검사한다.
//
// 왜: 이 하네스는 지시(에이전트·스킬 본문)가 한국어여도 동작한다 — 모델이 교차 언어를
// 처리하기 때문이다. 그러나 **산출물**(기획서·설계서·QA 리포트)이 한국어로 나오면
// 영어권 사용자에게는 이 도구의 핵심 가치가 통째로 무용지물이 된다. 실측: 산출물 문서
// 템플릿을 가진 에이전트 20개가 한국어 헤딩(`## 색상 팔레트`, `## 엔드포인트 목록` 등)을
// 들고 있었다.
//
// 그래서 언어를 **입출력의 속성**으로 다룬다: intake에서 `outputLanguage`를 한 번 정하고,
// 오케스트레이터가 산출 스폰 프롬프트에 실어 보낸다. 이 스크립트는 그 선언이 지켜졌는지를
// 기계로 확인한다 — 없으면 "영어 지원"이 증명 없는 자기선언으로 남는다.
//
// 검사 방향은 **단방향**이다: `en` 선언이면 산출물 헤딩에 한글이 없어야 한다. `ko` 선언에
// 영어 헤딩(`## API Schema`)이 섞이는 것은 정상이므로 검사하지 않는다.
// 헤딩만 보는 이유: 본문·코드블록에는 샘플 데이터·고유명사로 한글이 정당하게 들어갈 수
// 있어 오탐이 크다. 헤딩은 문서 구조라 신호가 깨끗하다.
//
// 사용법:
//   node .claude/scripts/validate-output-language.mjs --project <root> [--json]
// 종료 코드: 0 = 일치 또는 미선언(정직 보고), 1 = 불일치, 2 = 사용법 오류.

import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs'
import {join, relative, resolve} from 'node:path'

const HANGUL = /[가-힣]/
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '00_source'])

// 코드 펜스를 제거한다 — 펜스 안의 샘플·주석은 산출물 언어 규약의 대상이 아니다.
export function stripFences(text) {
  return text.replace(/```[\s\S]*?```/g, '')
}

// 마크다운 헤딩 목록(라인 번호 포함). 순수.
export function extractHeadings(text) {
  const out = []
  const lines = stripFences(text).split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.*\S)\s*$/)
    if (m) out.push({line: i + 1, level: m[1].length, text: m[2]})
  }
  return out
}

// 선언 언어에 어긋나는 헤딩. 순수 — 파일 내용을 [{file, text}]로 받는다.
export function findLanguageViolations(files, outputLanguage) {
  if (outputLanguage !== 'en') return []
  const out = []
  for (const {file, text} of files) {
    for (const h of extractHeadings(text)) {
      if (HANGUL.test(h.text)) out.push({file, line: h.line, heading: h.text})
    }
  }
  return out
}

function collectArtifacts(workspaceDir) {
  const files = []
  const walk = (abs) => {
    let st
    try { st = statSync(abs) } catch { return }
    if (st.isDirectory()) {
      for (const name of readdirSync(abs)) {
        if (SKIP_DIRS.has(name)) continue
        walk(join(abs, name))
      }
      return
    }
    if (st.isFile() && abs.endsWith('.md')) files.push(abs)
  }
  walk(workspaceDir)
  return files.sort()
}

function parseArgs(argv) {
  const out = {root: null, json: false}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') { out.root = argv[++i]; continue }
    if (argv[i] === '--json') { out.json = true; continue }
  }
  return out
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (!opts.root) { console.error('사용법: --project <root> [--json]'); process.exit(2) }
  const root = resolve(opts.root)
  if (!existsSync(root)) { console.error(`root 없음: ${root}`); process.exit(2) }

  const profilePath = join(root, '_workspace', '01_plan', 'project-profile.json')
  let declared = null
  if (existsSync(profilePath)) {
    try { declared = JSON.parse(readFileSync(profilePath, 'utf8')).outputLanguage ?? null } catch { declared = null }
  }

  const workspaceDir = join(root, '_workspace')
  const paths = existsSync(workspaceDir) ? collectArtifacts(workspaceDir) : []
  const files = paths.map(p => ({file: relative(root, p), text: readFileSync(p, 'utf8')}))
  const violations = findLanguageViolations(files, declared)

  if (opts.json) {
    console.log(JSON.stringify({schemaVersion: 1, outputLanguage: declared, scanned: files.length, violations}, null, 2))
  } else if (declared === null) {
    // 미선언은 통과가 아니라 **검사 미수행**이다 — 그렇게 보고한다(§4 등록).
    console.log(`UNDECLARED ⚠️  — project-profile.json에 outputLanguage가 없어 산출물 언어를 검사하지 않았다(스캔 대상 ${files.length}개).`)
    console.log('  영어권 배포를 주장하려면 intake에서 outputLanguage를 선언해야 한다.')
  } else if (violations.length === 0) {
    console.log(`PASS ✅ — outputLanguage=${declared}, 산출물 ${files.length}개 헤딩 일치`)
  } else {
    for (const v of violations.slice(0, 30)) console.log(`  ❌ ${v.file}:${v.line}  ${v.heading}`)
    if (violations.length > 30) console.log(`  … 외 ${violations.length - 30}건`)
    console.log(`\nFAIL ❌ — outputLanguage=${declared}인데 한글 헤딩 ${violations.length}건. 산출물이 선언한 언어로 나오지 않았다.`)
  }
  process.exit(violations.length === 0 ? 0 : 1)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
