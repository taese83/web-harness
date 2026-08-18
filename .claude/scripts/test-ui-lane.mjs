#!/usr/bin/env node
// test-ui-lane.mjs — UI 레인 방출-선택 일치 검사 회귀 (M4 tier b).
//
// 왜 이 테스트가 있나: 침묵 레인 불일치(선언은 tailwind-shadcn, 방출은 MUI)는 정찰이 지목한
// 최고 위험이었고, 이 validator가 그것을 잡는 유일한 기계다. 여기서 고정하는 사실:
//   (1) 양방향 교차(각 레인에서 상대 생태계 import)가 exit 1로 잡힌다
//   (2) 선언 부재는 통과가 아니라 UNDECLARED(검사 미수행) 명시 보고다(vacuous pass 차단)
//   (3) 브라운필드 overlay 실측이 tech-stack 선언보다 우선한다(tech-advisor 규칙과 정합)
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'

const script = resolve(import.meta.dirname, 'validate-ui-lane.mjs')

const runOn = files => {
  const root = mkdtempSync(join(tmpdir(), 'ui-lane-'))
  for (const [relativePath, content] of Object.entries(files)) {
    const path = join(root, relativePath)
    mkdirSync(join(path, '..'), {recursive: true})
    writeFileSync(path, content)
  }
  const result = spawnSync(process.execPath, [script, '--project', root, '--json'], {
    encoding: 'utf8',
    env: {...process.env, CLAUDE_PROJECT_DIR: root},
  })
  rmSync(root, {recursive: true, force: true})
  const payload = result.stdout ? JSON.parse(result.stdout) : {}
  return {exitCode: result.status, payload}
}

const techStack = lane => `# Tech Stack\n\n## Harness Profile\n- UI_LANE: ${lane}\n`

test('mui 선언 + mui import → PASS', () => {
  const {exitCode, payload} = runOn({
    '_workspace/01_plan/tech-stack.md': techStack('mui'),
    'src/app/App.tsx': "import {ThemeProvider} from '@mui/material'\n",
  })
  assert.equal(exitCode, 0)
  assert.equal(payload.status, 'PASS')
  assert.equal(payload.declaredLane, 'mui')
})

test('tailwind-shadcn 선언 + tailwind import → PASS', () => {
  const {exitCode, payload} = runOn({
    '_workspace/01_plan/tech-stack.md': techStack('tailwind-shadcn'),
    'src/shared/lib/utils.ts': "import {twMerge} from 'tailwind-merge'\nimport {clsx} from 'clsx'\n",
  })
  assert.equal(exitCode, 0)
  assert.equal(payload.status, 'PASS')
})

test('교차 ①: tailwind-shadcn 선언인데 MUI 방출 → exit 1 (정찰 R1 시나리오)', () => {
  const {exitCode, payload} = runOn({
    '_workspace/01_plan/tech-stack.md': techStack('tailwind-shadcn'),
    'src/pages/home/ui/HomePage.tsx': "import {Box} from '@mui/material'\n",
  })
  assert.equal(exitCode, 1)
  assert.equal(payload.status, 'CROSS_LANE')
  assert.equal(payload.violations.length, 1)
  assert.match(payload.violations[0], /@mui\/material/)
})

test('교차 ②: mui 선언인데 tailwind 생태계 방출 → exit 1', () => {
  const {exitCode, payload} = runOn({
    '_workspace/01_plan/tech-stack.md': techStack('mui'),
    'src/shared/ui/button/button.tsx': "import {cva} from 'class-variance-authority'\n",
  })
  assert.equal(exitCode, 1)
  assert.match(payload.violations[0], /class-variance-authority/)
})

test('선언 부재 → 통과가 아니라 UNDECLARED 명시 보고(exit 0 + status)', () => {
  const {exitCode, payload} = runOn({
    'src/app/App.tsx': "import {Box} from '@mui/material'\n",
  })
  assert.equal(exitCode, 0)
  assert.equal(payload.status, 'UNDECLARED')
})

test('브라운필드 overlay 실측이 tech-stack 선언보다 우선한다', () => {
  const {exitCode, payload} = runOn({
    '_workspace/01_plan/tech-stack.md': techStack('tailwind-shadcn'),
    '_workspace/02_design/integration-overlay.json': JSON.stringify({uiLibrary: {uiLane: 'mui'}}),
    'src/app/App.tsx': "import {ThemeProvider} from '@mui/material'\n",
  })
  // overlay(mui)가 이겨서 MUI import는 위반이 아니다 — tech-stack만 봤다면 exit 1이었을 것
  assert.equal(exitCode, 0)
  assert.equal(payload.declaredLane, 'mui')
  assert.match(payload.declarationSource ?? '', /overlay/)
})

test('mui 레인에서 Radix 단독 import는 위반이 아니다(헤드리스 개별 조합 허용)', () => {
  const {exitCode} = runOn({
    '_workspace/01_plan/tech-stack.md': techStack('mui'),
    'src/shared/ui/popover.tsx': "import * as Popover from '@radix-ui/react-popover'\n",
  })
  assert.equal(exitCode, 0)
})

test('리뷰 우회 ①: barrel 재수출(export … from)도 잡힌다', () => {
  const {exitCode, payload} = runOn({
    '_workspace/01_plan/tech-stack.md': techStack('tailwind-shadcn'),
    'src/shared/ui/index.ts': "export {Button} from '@mui/material'\n",
  })
  assert.equal(exitCode, 1)
  assert.match(payload.violations[0], /@mui\/material/)
})

test('리뷰 우회 ②: dynamic import()도 잡힌다', () => {
  const {exitCode, payload} = runOn({
    '_workspace/01_plan/tech-stack.md': techStack('tailwind-shadcn'),
    'src/features/lazy/ui/Lazy.tsx': "const mui = await import('@emotion/react')\n",
  })
  assert.equal(exitCode, 1)
  assert.match(payload.violations[0], /@emotion\/react/)
})

test('리뷰 지적: .jsx 파일도 스캔한다(브라운필드)', () => {
  const {exitCode} = runOn({
    '_workspace/01_plan/tech-stack.md': techStack('tailwind-shadcn'),
    'src/legacy/Old.jsx': "import {Box} from '@mui/material'\n",
  })
  assert.equal(exitCode, 1)
})

test('리뷰 지적: overlay의 미지 레인 값은 조용한 폴백이 아니라 loud 실패다', () => {
  const {exitCode, payload} = runOn({
    '_workspace/01_plan/tech-stack.md': techStack('mui'),
    '_workspace/02_design/integration-overlay.json': JSON.stringify({uiLibrary: {uiLane: 'bootstrap'}}),
    'src/app/App.tsx': "import {ThemeProvider} from '@mui/material'\n",
  })
  assert.equal(exitCode, 1)
  assert.equal(payload.status, 'UNKNOWN_LANE_DECLARATION')
})
