#!/usr/bin/env node
// test-resolve-commands.mjs — 즉시 판단이 어댑터 선언을 대체할 수 있는가.
//
// 이 파일의 핵심은 (1) 등가성 증명이다. 어댑터를 걷어내기 전에 즉시 판단이 같은 명령을
// 내는지 실측으로 보여야 한다 — 재현하지 못하면 어댑터가 뭔가 더 담고 있었다는 뜻이다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {resolveCommand, resolveCommands, TOOL_COMMANDS} from './resolve-commands.mjs'

const withManifest = (manifest, run) => {
  const root = mkdtempSync(join(tmpdir(), 'wh-cmd-'))
  try { writeFileSync(join(root, 'package.json'), JSON.stringify(manifest)); run(root) }
  finally { rmSync(root, {recursive: true, force: true}) }
}

// ── (1) 등가성 — 어댑터를 걷어낼 근거 ────────────────────────────────────────
test('골든에서 어댑터 commands를 재현한다 (알려진 차이 2종 제외)', () => {
  // 알려진 차이:
  //   dependencies.install — --ignore-scripts를 뺐다. 브라운필드는 개발자가 이미 install을
  //     돌리므로 막는 게 없고, playwright 브라우저·네이티브 빌드를 깨뜨려 "하네스 탓 실패"를
  //     만든다(2026-08-26 판단).
  //   ingestion.validate — requires:["external-ingestion"] 조건부 검사다. 골든에 그 능력이
  //     없어 script도 없는 것이 정상이며, 즉시 판단은 NO_SCRIPT로 정확히 보고한다.
  const KNOWN_DELTA = new Set(['dependencies.install', 'ingestion.validate'])
  let compared = 0
  for (const [profile, root] of [['react-vite-spa', 'golden/react-vite-spa'], ['vite-serverless-hybrid', 'golden/vite-serverless-hybrid']]) {
    const adapterPath = `.claude/adapters/${profile}/adapter.json`
    if (!existsSync(adapterPath) || !existsSync(`${root}/package.json`)) continue
    const adapter = JSON.parse(readFileSync(adapterPath, 'utf8'))
    const manifest = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'))
    for (const command of adapter.commands) {
      if (KNOWN_DELTA.has(command.id)) continue
      const resolved = resolveCommand(command.id, manifest)
      assert.equal(resolved.status, undefined, `${profile}/${command.id}: script를 찾지 못했다`)
      assert.equal(`${resolved.executable} ${resolved.args.join(' ')}`,
        `${command.executable} ${(command.args ?? []).join(' ')}`, `${profile}/${command.id}`)
      compared++
    }
  }
  assert.ok(compared >= 12, `비교가 ${compared}건뿐이다 — 골든을 못 읽었으면 vacuous PASS다`)
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
