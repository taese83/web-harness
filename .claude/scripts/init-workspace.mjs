#!/usr/bin/env node
// init-workspace.mjs — 하네스 최소 환경을 만든다.
//
// 최소 환경은 **디렉토리 + `_workspace/web-harness.md` 하나**다. 기획·디자인 문서 사슬을
// 미리 만들지 않는다 — 그건 요청이 있을 때 그 요청에 맞춰 생성된다(계약 §0-1).
//
// web-harness.md는 두 가지를 겸한다:
//   (1) 재진입 마커 — 이 repo가 하네스 관할임을 미래 세션이 안다. 종전 방식은 사용자
//       `CLAUDE.md`에 블록을 append하는 것이었는데, 그건 **추적 파일을 고치는 것**이라
//       사내 repo에서 쓸 수 없었다. _workspace 안이면 그 문제가 없다.
//   (2) 기본 정보 — 실측으로 즉시 알 수 있는 것만. 추론이나 생성이 필요한 것은 넣지 않는다.
//
// 이미 있으면 덮어쓰지 않는다. 재실행은 디렉토리 보강만 한다.
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {basename, join, resolve} from 'node:path'

export const WORKSPACE_DIRS = ['00_source', '01_plan', '02_design', '03_dev', '04_qa', 'RELEASE']
export const MARKER = '_workspace/web-harness.md'

const readJson = path => {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

// 실측으로 즉시 알 수 있는 것만 모은다. 없으면 그 줄을 쓰지 않는다 — 빈 값을 지어내지 않는다.
export const collectBasics = projectRoot => {
  const root = resolve(projectRoot)
  const manifest = readJson(join(root, 'package.json'))
  const spec = readJson(join(root, '_workspace/03_dev/spec.json'))
  const basics = {name: manifest?.name ?? basename(root)}
  if (manifest?.version) basics.version = manifest.version
  if (manifest?.private === true) basics.private = true
  if (existsSync(join(root, '.git'))) basics.git = true
  if (spec?.targetShapes?.length) basics.targetShapes = spec.targetShapes
  if (spec?.specTier) basics.specTier = spec.specTier
  const substrate = spec?.constitution?.substrate
  if (substrate) {
    basics.substrate = Object.entries(substrate)
      .filter(([, entry]) => entry?.source === 'measured')
      .map(([key, entry]) => `${key}=${entry.value}`)
  }
  return basics
}

export const renderMarker = (basics, {at}) => {
  const lines = ['# web-harness', '', `이 프로젝트는 web-harness 관할이다. 산출물은 \`_workspace/\` 아래에 있다.`, '']
  lines.push(`- project: ${basics.name}`)
  if (basics.version) lines.push(`- version: ${basics.version}`)
  lines.push(`- adopted: ${at}`)
  if (basics.private) lines.push('- private: true')
  if (basics.targetShapes) lines.push(`- targetShapes: ${basics.targetShapes.join(', ')} (확정된 스팩에서)`)
  if (basics.specTier) lines.push(`- specTier: ${basics.specTier}`)
  if (basics.substrate?.length) lines.push(`- substrate(실측): ${basics.substrate.join(' · ')}`)
  lines.push('')
  lines.push('## 레이아웃', '')
  lines.push('| 디렉토리 | 내용 |', '|---|---|')
  lines.push('| `00_source` | 기존 기획·디자인 원본 |')
  lines.push('| `01_plan` | 요구사항·UX·기능 계획 |')
  lines.push('| `02_design` | 디자인 시스템·레이아웃·구현 설계(`solution-design.md`) |')
  lines.push('| `03_dev` | 확정 스팩(`spec.json`)·실행 계획 |')
  lines.push('| `04_qa` | QA 보고서·evidence receipt |')
  lines.push('| `RELEASE` | 릴리스 산출물 |')
  lines.push('')
  lines.push('기획·디자인 문서는 **요청이 있을 때 그 요청에 맞춰** 생성된다. 미리 만들지 않는다.')
  lines.push('')
  return lines.join('\n')
}

export const initWorkspace = ({projectRoot, at, force = false}) => {
  const root = resolve(projectRoot)
  const created = []
  for (const dir of WORKSPACE_DIRS) {
    const path = join(root, '_workspace', dir)
    if (!existsSync(path)) { mkdirSync(path, {recursive: true}); created.push(`_workspace/${dir}`) }
  }
  const markerPath = join(root, MARKER)
  // 이미 있으면 덮어쓰지 않는다 — 사람이 손으로 적은 내용이 있을 수 있다.
  if (existsSync(markerPath) && !force) return {created, marker: 'kept'}
  writeFileSync(markerPath, renderMarker(collectBasics(root), {at}))
  return {created, marker: existsSync(markerPath) ? 'written' : 'written'}
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2)
  const rootIndex = argv.indexOf('--project-root')
  const projectRoot = rootIndex >= 0 ? argv[rootIndex + 1] : '.'
  const at = new Date().toISOString().slice(0, 10)
  const result = initWorkspace({projectRoot, at, force: argv.includes('--force')})
  for (const dir of result.created) process.stdout.write(`created ${dir}\n`)
  process.stdout.write(`${MARKER}: ${result.marker}\n`)
}
