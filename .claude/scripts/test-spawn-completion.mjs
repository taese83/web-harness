#!/usr/bin/env node
// test-spawn-completion.mjs — verify-spawn-completion.mjs의 게이트 강도 회귀 테스트.
// 특히 "무산출 가드"(2026-08-11): --paths가 산출물 0개면 vacuous PASS가 아니라 FAIL.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import test from 'node:test'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(scriptDir, 'verify-spawn-completion.mjs')
const {scanSource, inspectReturn} = await import(SCRIPT)

const run = (args) => {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {encoding: 'utf8'})
    return {code: 0, stdout}
  } catch (error) {
    return {code: error.status ?? 1, stdout: `${error.stdout ?? ''}${error.stderr ?? ''}`}
  }
}

test('무산출 가드: --paths가 스캔 산출물 0개면 FAIL (vacuous PASS 방지)', () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-spawn-empty-'))
  mkdirSync(join(root, 'owned'))
  try {
    const result = run(['--root', root, '--paths', 'owned'])
    assert.equal(result.code, 1)
    assert.match(result.stdout, /MISSING/)
    assert.match(result.stdout, /산출물을 하나도 남기지 않음/)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('--allow-no-output이면 빈 범위도 통과 (산출물 없는 스폰이 정당한 경우)', () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-spawn-empty2-'))
  mkdirSync(join(root, 'owned'))
  try {
    const result = run(['--root', root, '--paths', 'owned', '--allow-no-output'])
    assert.equal(result.code, 0)
    assert.match(result.stdout, /PASS/)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('산출물이 있으면 정상 PASS (무산출 가드가 회귀를 만들지 않음)', () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-spawn-ok-'))
  mkdirSync(join(root, 'owned'))
  writeFileSync(join(root, 'owned', 'a.ts'), 'export const x = 1\n')
  try {
    const result = run(['--root', root, '--paths', 'owned'])
    assert.equal(result.code, 0)
    assert.match(result.stdout, /PASS/)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('비-code 산출물(.md/.json/.yml)만 있어도 PASS — 무산출 가드 오탐 방지', () => {
  // package-scaffolder(package.json/turbo.json/yaml), designer(.md), deploy-ci-writer(.yml)
  // 처럼 owned 산출물이 전부 비-scannable이면 무산출이 아니다(scannable 0개여도 실산출 존재).
  const root = mkdtempSync(join(tmpdir(), 'wh-spawn-noncode-'))
  mkdirSync(join(root, 'owned'))
  writeFileSync(join(root, 'owned', 'package.json'), '{"name":"x"}\n')
  writeFileSync(join(root, 'owned', 'design-system.md'), '# tokens\n')
  writeFileSync(join(root, 'owned', 'deploy.yml'), 'on: push\n')
  try {
    const result = run(['--root', root, '--paths', 'owned'])
    assert.equal(result.code, 0)
    assert.match(result.stdout, /PASS/)
    assert.doesNotMatch(result.stdout, /MISSING [1-9]/) // 요약 "MISSING 0"은 허용, 실제 MISSING 실패만 금지
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('truncation 신호(미종결 괄호)는 여전히 SUSPECT로 검출', () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-spawn-trunc-'))
  mkdirSync(join(root, 'owned'))
  writeFileSync(join(root, 'owned', 'b.ts'), 'export function f() {\n  return {\n')
  try {
    const result = run(['--root', root, '--paths', 'owned'])
    assert.equal(result.code, 1)
    assert.match(result.stdout, /SUSPECT|truncation/)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

// ── 정규식 리터럴 진입 판정 회귀 (실측 FP 2건 — synthetic-replay 2026-08-18) ──
// scanSource를 직접 임포트해 실측 사례의 축약 없는 원문 라인을 고정한다.

test('실측 FP 회귀: 화살표 본문 위치 정규식(=> /re/)의 괄호를 열림으로 세지 않음 — validate-settings.mjs:55', () => {
  // 정규식 안의 \( 가 열림으로, 끝의 \// 가 라인 주석으로 오인되던 사례.
  const source = [
    'const projectAllowRules = ["Edit(.claude/x)"]',
    'if (projectAllowRules.some(rule => /^(?:Edit|Write)\\(\\/?\\.claude\\//.test(rule))) {',
    '  fail("Project settings allow the generated app to modify its Claude control plane")',
    '}',
    '',
  ].join('\n')
  assert.deepEqual(scanSource(source), [])
})

test('실측 FP 회귀: 키워드-선행 정규식(return /re/)의 문자클래스 [ 를 열림으로 세지 않음 — validate-workflows-and-evals.mjs:148', () => {
  // word 버퍼가 '/' 판정 전에 flush되지 않아 return 뒤 정규식이 코드로 읽히던 사례.
  const source = [
    'const isImmutableUsesTarget = target => {',
    '  if (target.startsWith("docker://")) {',
    '    return /^docker:\\/\\/[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[a-f0-9]{64}$/i.test(target)',
    '  }',
    '  const match = target.match(/^([A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+(?:\\/[A-Za-z0-9_.-]+)*)@(?:[a-f0-9]{40}|[a-f0-9]{64})$/i)',
    '  return Boolean(match && !match[1].split("/").some(segment => segment === "." || segment === ".."))',
    '}',
    '',
  ].join('\n')
  assert.deepEqual(scanSource(source), [])
})

test('정규식 진입 정밀화가 recall을 약화하지 않음: 정규식 중간 절단은 여전히 검출', () => {
  // 화살표/키워드 위치에서 정규식 상태로 들어간 채 잘리면 미종결 정규식으로 잡혀야 한다.
  assert.ok(scanSource('const ok = rules.some(rule => /^(?:Edit|Write').length > 0)
  assert.ok(scanSource('function f(x) {\n  return /^docker:[a-z').length > 0)
})

test('=> 합성 경계: >=·제네릭·복합 연산자는 정규식으로 오진입하지 않음 (리뷰 반영)', () => {
  // '=>'는 직전 문자가 정확히 '='일 때만 합성된다 — 순서 의존이라 '>='(먼저 '>')와
  // 구분된다. 아래 어느 것도 '/'를 나눗셈이 아니라 정규식 시작으로 오독하면 안 된다.
  assert.deepEqual(scanSource('const r = a >= b / c'), [])          // 비교 뒤 나눗셈
  assert.deepEqual(scanSource('const xs: Array<number> = split / n'), []) // 제네릭 뒤 나눗셈
  assert.deepEqual(scanSource('let m = 0; m >>= 1; const q = t / 2'), [])  // 복합 시프트 뒤 나눗셈
  assert.deepEqual(scanSource('const f = (x: number): boolean => x > 1 / 2'), []) // 진짜 화살표 + 뒤 나눗셈
})

// ── 판정 계열 반환 완결성 (2026-08-26) ───────────────────────────────────────
// 구현 계열은 파일을 남겨 --paths로 잡히지만 설계자·리뷰어는 텍스트만 반환한다.
// 실측: maxTurns에 걸린 서브에이전트는 에러가 아니라 **빈 보고**로 끝나고, 정상 종료와
// 반환 형태가 같다. 아래 두 문자열은 2026-08-26에 실제로 받은 절단 반환이다.
test('회귀 반증: 실제 절단 반환 2종을 잡는다', () => {
  for (const [label, text] of [
    ['리뷰어', 'Factual claims confirmed so far. Now run the test suite and the validator against the real goldens.'],
    ['설계자', "I'll start by reading the contract, then measure the target."],
  ]) {
    const verdict = inspectReturn(text)
    assert.equal(verdict.status, 'SUSPECT', `${label} 절단 반환을 통과시키면 빈 보고가 "검토 완료"가 된다`)
    assert.ok(verdict.reasons.some(r => /마커가 없다/.test(r)))
  }
})

test('마커가 있으면 통과한다 — 오탐이 아니어야 한다', () => {
  const verdict = inspectReturn(['## 리뷰 결과', '', '발견 3건.', '',
    'SPAWN_RESULT: complete', 'FINDINGS: 3', 'SELF_CHECK: 골든 3종 실행 확인'].join('\n'))
  assert.equal(verdict.status, 'OK')
  assert.deepEqual(verdict.reasons, [])
})

test('실행 환경의 조기 종료 보고를 잡는다', () => {
  const verdict = inspectReturn('분석 중이다. Agent terminated early due to an API error.')
  assert.equal(verdict.status, 'SUSPECT')
  assert.ok(verdict.reasons.some(r => /조기 종료/.test(r)))
})

test('스스로 blocked를 보고하면 완료로 처리하지 않는다', () => {
  const verdict = inspectReturn('대상을 읽지 못했다.\n\nSPAWN_RESULT: blocked\nFINDINGS: none\nSELF_CHECK: none')
  assert.equal(verdict.status, 'SUSPECT')
  assert.ok(verdict.reasons.some(r => /blocked/.test(r)))
})

test('빈 반환은 MISSING이다 — SUSPECT보다 강한 신호다', () => {
  assert.equal(inspectReturn('').status, 'MISSING')
  assert.equal(inspectReturn('   \n  ').status, 'MISSING')
})

test('회귀 반증: 마커가 있으면 꼬리 문장을 절단으로 오인하지 않는다', () => {
  // 정상 문서가 "다음 단계로 진행한다"로 끝나고 마커가 붙는 경우 — 오탐이면 정상 스폰이 막힌다
  const verdict = inspectReturn('결론: 이 설계로 진행한다.\n\nSPAWN_RESULT: complete\nFINDINGS: none\nSELF_CHECK: none')
  assert.equal(verdict.status, 'OK')
})
