#!/usr/bin/env node
// test-agent-skill-preload.mjs — 에이전트 `skills:` 프리로드가 실제로 실리는 스킬만 가리킨다.
//
// 고정하는 사실:
//   - Claude Code는 disable-model-invocation 스킬을 프리로드하지 않는다(조용히 빠진다) — 그런 프리로드와 없는 스킬은 위반이다
//   - 하네스 저장소의 에이전트에는 조용히 빠지는 프리로드가 없다(참조 경로를 본문에 적는다)
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {droppedSkillPreloads, readSkillPreloads} from './validators/validate-agent-boundaries.mjs'

test('disable-model-invocation 스킬과 없는 스킬의 프리로드를 잡고, 부를 수 있는 스킬은 통과시킨다', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-preload-')))
  try {
    const skill = (name, disabled) => {
      mkdirSync(join(root, 'skills', name), {recursive: true})
      writeFileSync(join(root, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: probe\n${disabled ? 'disable-model-invocation: true\n' : ''}---\nbody\n`)
    }
    skill('hidden', true)
    skill('open', false)
    mkdirSync(join(root, 'agents'), {recursive: true})
    writeFileSync(join(root, 'agents', 'inline.md'), '---\nname: inline\ndescription: probe\nskills: hidden, open\n---\nbody\n')
    writeFileSync(join(root, 'agents', 'listed.md'), '---\nname: listed\ndescription: probe\nskills:\n  - open\n  - missing\n---\nbody\n')
    writeFileSync(join(root, 'agents', 'none.md'), '---\nname: none\ndescription: probe\n---\nskills: hidden (본문은 프리로드가 아니다)\n')
    writeFileSync(join(root, 'agents', 'flow.md'), '---\nname: flow\ndescription: probe\nskills: [open, hidden]\n---\nbody\n')
    const dropped = droppedSkillPreloads(readSkillPreloads(root)).map(({agent, skill: name}) => `${agent}:${name}`)
    assert.deepEqual(dropped, ['flow:hidden', 'inline:hidden', 'listed:missing'])
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('하네스 에이전트에는 조용히 빠지는 프리로드가 없다', () => {
  const claudeDirectory = fileURLToPath(new URL('..', import.meta.url))
  assert.deepEqual(droppedSkillPreloads(readSkillPreloads(claudeDirectory)), [])
})
