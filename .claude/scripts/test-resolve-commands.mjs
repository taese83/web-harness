#!/usr/bin/env node
// test-resolve-commands.mjs — 즉시 판단이 어댑터 선언을 대체할 수 있는가.
//
// 이 파일의 핵심은 (1) 등가성 증명이다. 어댑터를 걷어내기 전에 즉시 판단이 같은 명령을
// 내는지 실측으로 보여야 한다 — 재현하지 못하면 어댑터가 뭔가 더 담고 있었다는 뜻이다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {dirname, join as pathJoin} from 'node:path'
import {resolveCommand, resolveCommands, TOOL_COMMANDS} from './resolve-commands.mjs'

const BASELINE_PATH = pathJoin(dirname(fileURLToPath(import.meta.url)), 'fixtures/adapter-baseline.json')

const withManifest = (manifest, run) => {
  const root = mkdtempSync(join(tmpdir(), 'wh-cmd-'))
  try { writeFileSync(join(root, 'package.json'), JSON.stringify(manifest)); run(root) }
  finally { rmSync(root, {recursive: true, force: true}) }
}

// ── (1) 등가성 — 어댑터를 걷어낼 근거 ────────────────────────────────────────
test('어댑터 commands를 재현한다 (알려진 차이 2종 제외)', () => {
  // 어댑터는 2026-08-26에 삭제됐다. 등가성 증거를 잃지 않도록 삭제 직전의 commands와 골든
  // package.json scripts를 fixtures/adapter-baseline.json에 동결했다 — 이 테스트가 그 증거다.
  //
  // 알려진 차이:
  //   dependencies.install — --ignore-scripts를 뺐다. 브라운필드는 개발자가 이미 install을
  //     돌리므로 막는 게 없고, playwright 브라우저·네이티브 빌드를 깨뜨린다.
  //   ingestion.validate — requires:["external-ingestion"] 조건부 검사다. 골든에 그 능력이
  //     없어 script도 없는 것이 정상이며 즉시 판단은 NO_SCRIPT로 정확히 보고한다.
  const KNOWN_DELTA = new Set(['dependencies.install', 'ingestion.validate'])
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  let compared = 0
  for (const [profile, entry] of Object.entries(baseline)) {
    const manifest = {scripts: entry.scripts}
    for (const command of entry.commands) {
      if (KNOWN_DELTA.has(command.id)) continue
      const resolved = resolveCommand(command.id, manifest)
      assert.equal(resolved.status, undefined, `${profile}/${command.id}: script를 찾지 못했다`)
      assert.equal(`${resolved.executable} ${resolved.args.join(' ')}`,
        `${command.executable} ${command.args.join(' ')}`, `${profile}/${command.id}`)
      compared++
    }
  }
  assert.ok(compared >= 12, `비교가 ${compared}건뿐이다 — fixture를 못 읽었으면 vacuous PASS다`)
})

// ── (2) 없는 것을 지어내지 않는다 ────────────────────────────────────────────
test('회귀 반증: script가 없으면 NO_SCRIPT다 — 명령을 만들어내지 않는다', () => {
  withManifest({name: 'x', scripts: {dev: 'vite'}}, root => {
    const {resolved, missing} = resolveCommands({projectRoot: root, checkIds: ['quality.lint', 'vite.build']})
    assert.equal(resolved.length, 0)
    assert.deepEqual(missing.map(m => m.id).sort(), ['quality.lint', 'vite.build'])
    assert.ok(missing[0].candidates.length > 0, '무엇을 찾았는지 보고한다')
  })
})

test('package.json이 없으면 전부 미해결이다', () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-cmd-'))
  try {
    const {resolved, missing} = resolveCommands({projectRoot: root, checkIds: ['quality.lint']})
    assert.equal(resolved.length, 0)
    assert.equal(missing.length, 1)
  } finally { rmSync(root, {recursive: true, force: true}) }
})

// ── (3) 도구가 정하는 것은 프로젝트와 무관하다 ───────────────────────────────
test('pack.contents는 script가 없어도 나온다 — npm이 정하는 명령이다', () => {
  withManifest({name: 'x'}, root => {
    const {resolved} = resolveCommands({projectRoot: root, checkIds: ['pack.contents']})
    assert.equal(resolved.length, 1)
    assert.equal(resolved[0].source, 'tool')
    assert.deepEqual(resolved[0].args, ['pack', '--dry-run', '--json'])
  })
})

test('회귀 반증: --ignore-scripts를 붙이지 않는다', () => {
  // 의도적 제거다. 되살리면 playwright 브라우저·네이티브 빌드가 빠진 채 설치돼
  // "하네스 탓 실패"가 프로젝트 실패로 보고된다.
  assert.equal(TOOL_COMMANDS['dependencies.install'].args.includes('--ignore-scripts'), false)
})

// ── (4) 이름이 프로젝트마다 다르다 ───────────────────────────────────────────
test('script 이름 후보를 순서대로 본다', () => {
  withManifest({name: 'x', scripts: {'type-check': 'tsc --noEmit'}}, root => {
    assert.deepEqual(resolveCommands({projectRoot: root, checkIds: ['quality.typecheck']}).resolved[0].args,
      ['run', 'type-check'], 'typecheck가 없으면 type-check을 본다')
  })
  withManifest({name: 'x', scripts: {typecheck: 'tsc', 'type-check': 'tsc'}}, root => {
    assert.deepEqual(resolveCommands({projectRoot: root, checkIds: ['quality.typecheck']}).resolved[0].args,
      ['run', 'typecheck'], '둘 다 있으면 앞 후보가 이긴다')
  })
})

test('빈 문자열 script는 없는 것으로 본다', () => {
  withManifest({name: 'x', scripts: {lint: '   '}}, root => {
    assert.equal(resolveCommands({projectRoot: root, checkIds: ['quality.lint']}).missing.length, 1)
  })
})

// ── 배선 회귀 (2026-08-26) ───────────────────────────────────────────────────
// 오늘 두 번 확인했다: 검증 호출을 지워도 CI가 exit 0이었다. 테스트가 lib을 직접 부르고
// **배선 지점을 지나가지 않아서**다. 게이트를 만들어도 호출부가 끊기면 아무도 모른다.
// 아래는 receipt-validation-lib의 환경 결속 호출이 살아 있는지를 배선으로 확인한다.
test('배선 회귀: 환경 결속이 프로필 없이도 검증된다', async () => {
  const {readReceipt} = await import('./receipt-validation-lib.mjs')
  const {mkdirSync} = await import('node:fs')
  const root = mkdtempSync(join(tmpdir(), 'wh-envbind-'))
  try {
    mkdirSync(join(root, '_workspace/04_qa/evidence'), {recursive: true})
    // 환경 결속이 없는 receipt — 종전에는 if (expectedProfile) 안이라 프로필이 없으면 통과했다
    writeFileSync(join(root, '_workspace/04_qa/evidence/lint.json'),
      JSON.stringify({schemaVersion: 1, id: 'lint', status: 'PASS'}))
    const errors = []
    readReceipt(root, 'lint', null, errors)  // expectedProfile 없이 호출
    assert.ok(errors.some(e => /environment binding/.test(e)),
      '조건부 스킵이 되살아나면 이 단언이 깨진다')
  } finally { rmSync(root, {recursive: true, force: true}) }
})
