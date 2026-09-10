// golden-spec-drift-lib.mjs — **커밋된 골든 스팩의 입력이 확정 이후 바뀌었는가.**
//
// 계기(2026-09-10 실측): `golden/vite-serverless-hybrid`의 스팩은 `ebed2d1`(8/26)에 확정됐고
// `ddc3314`(8/27)가 `project-profile.json`을 바꿨다. 그 커밋 본문은 JUDGMENT에
// **"vite-serverless-hybrid 잠금이 stale이 돼 재생성했다"**고 적었는데 `spec.json`은
// 건드리지 않았다 — **재-잠금 주장이 트리에 없다.** 2주 동안 아무도 몰랐다. CI가 골든을
// 아예 보지 않기 때문이다(`run-golden-profile.mjs`는 `ci` 스크립트에 없다).
//
// 이 검사가 닫는 것은 staleness가 아니라 **침묵**이다. I1은 "주장에는 증명이 따라야 한다"인데,
// 커밋 본문의 주장을 아무 기계도 대조하지 않으면 그 주장은 그냥 산문이다.
//
// ── 분모를 스팩 **자신이 기록한 입력**으로 잡는다 ────────────────────────────
// 현재 `LOCK_INPUTS`로 재면 목록이 넓어질 때마다 모든 골든이 드리프트로 뜬다(2026-09-09에
// 실제로 3개를 넣었다). 그것은 골든의 결함이 아니라 하네스 쪽 변경이다. 스팩이 기록한
// 경로만 대조하면 **진짜 드리프트만** 남고 목록 확장에는 면역이다.
//
// ── 막지 않는다 ─────────────────────────────────────────────────────────────
// 골든 스팩은 `schemaVersion: 1`이고 `spec.mjs`가 그것을 **읽기 전용 이력**으로 못박았다 —
// "이미 커밋된 증거에 결박된 spec을 새 규칙에 맞춰 고쳐 쓰지 않는다". 재-잠금은 규칙이
// 금지할 뿐 아니라 **기계적으로 불가능하다**: v1 골든의 solution-design에는 v2가 요구하는
// `testLayers.unit`이 없어 `lockSpec`이 거부한다(실행으로 확인).
//
// 그래서 지금 막으면 남는 길은 ⓐ 의도된 리팩터를 되돌리거나 ⓑ 골든을 v2로 이관하는 것뿐이고,
// 둘 다 이 검사가 혼자 결정할 일이 아니다. **드리프트를 이름 대어 보고하고 판단은 사람에게
// 남긴다** — 소급 fail 금지(G3) 관례 그대로다. 실질 해소는 골든의 v2 이관이며, 그때 이
// 검사를 게이트로 올린다.

import {createHash} from 'node:crypto'
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs'
import {join, resolve} from 'node:path'

const sha256 = text => createHash('sha256').update(text).digest('hex')

/** 커밋된 골든 스팩 경로들. 없으면 빈 배열 — 골든이 없는 체크아웃도 정상이다. */
export function goldenSpecPaths(repositoryRoot, {io = {}} = {}) {
  const root = resolve(repositoryRoot)
  const goldenDir = join(root, 'golden')
  const list = io.listDir ?? (path => (existsSync(path) && statSync(path).isDirectory() ? readdirSync(path) : []))
  return list(goldenDir)
    .map(name => `golden/${name}/_workspace/03_dev/spec.json`)
    .filter(relativePath => (io.exists ?? existsSync)(join(root, relativePath)))
    .sort()
}

/**
 * 스팩 하나의 드리프트(순수 판정 + 파일 읽기).
 * **`stripHarnessMarkers`와 같은 규율로 읽는다** — 여기서는 원문을 그대로 해시한다.
 * `spec.mjs`의 `digestInputs`를 부르지 않는 이유는 그쪽이 현재 `LOCK_INPUTS`를 분모로 쓰기
 * 때문이다. 이 검사의 분모는 스팩이 기록한 목록이다.
 * @returns {{path: string, state: 'FRESH'|'DRIFTED'|'UNREADABLE', drifted: string[], note: string}}
 */
export function inspectGoldenSpec(repositoryRoot, relativeSpecPath, {io = {}} = {}) {
  const root = resolve(repositoryRoot)
  const read = io.readFile ?? (path => readFileSync(join(root, path), 'utf8'))
  let spec
  try { spec = JSON.parse(read(relativeSpecPath)) } catch (error) {
    return {path: relativeSpecPath, state: 'UNREADABLE', drifted: [],
      note: `읽지 못했다: ${error.message} — 미판정이며 통과가 아니다`}
  }
  const recorded = spec?.sourceDigest?.inputs
  if (!Array.isArray(recorded) || recorded.length === 0) {
    return {path: relativeSpecPath, state: 'UNREADABLE', drifted: [],
      note: '스팩이 입력 지문을 기록하지 않았다 — 대조할 분모가 없다. 미판정이며 통과가 아니다'}
  }
  const projectRoot = relativeSpecPath.replace(/\/_workspace\/03_dev\/spec\.json$/, '')
  const drifted = []
  for (const record of recorded) {
    const inputPath = `${projectRoot}/${record.path}`
    let now = null
    try { now = read(inputPath) } catch { now = null }
    // 부재/존재가 뒤집힌 것도 변경이다 — "없어졌다"를 침묵으로 두면 삭제가 통과한다.
    if (now === null) { if (record.present) drifted.push(`${record.path}(사라짐)`); continue }
    if (!record.present) { drifted.push(`${record.path}(새로 생김)`); continue }
    // 샤드 기록은 경로별 해시를 담는다 — 여기서는 flat 기록만 대조하고 샤드는 미판정으로 둔다.
    if (typeof record.sha256 !== 'string') continue
    if (sha256(now) !== record.sha256) drifted.push(`${record.path}(내용 바뀜)`)
  }
  return drifted.length === 0
    ? {path: relativeSpecPath, state: 'FRESH', drifted: [],
      note: `기록한 입력 ${recorded.length}개가 확정 당시와 같다`}
    : {path: relativeSpecPath, state: 'DRIFTED', drifted,
      note: `확정 이후 입력이 바뀌었다: ${drifted.join(' · ')} — 골든이 자기 스팩과 어긋난다`}
}

/** 저장소 전체 보고 문구(순수). **막지 않는다** — 호출부가 보고로만 쓴다. */
export function renderGoldenSpecDrift(results) {
  if (results.length === 0) return '골든 스팩 드리프트: 커밋된 골든 스팩이 없다 — 잴 것이 없다'
  const drifted = results.filter(item => item.state === 'DRIFTED')
  const unreadable = results.filter(item => item.state === 'UNREADABLE')
  if (drifted.length === 0 && unreadable.length === 0) {
    return `golden spec drift checked (${results.length} spec(s) match their recorded inputs)`
  }
  const lines = [`golden spec drift: ${drifted.length} drifted · ${unreadable.length} unreadable of ${results.length}`]
  for (const item of [...drifted, ...unreadable]) lines.push(`  · ${item.path} — ${item.note}`)
  // 처방을 함께 낸다 — 이름만 대고 무엇을 하라는지 말하지 않으면 다음 사람도 그냥 지나친다.
  lines.push('  재-잠금은 v1 골든에 불가하다(`testLayers.unit` 부재) — 실질 해소는 골든의 v2 이관이며,'
    + ' 그 전까지 골든 입력을 편집하지 않는다. 편집했다면 그 커밋이 결함이다')
  return lines.join('\n')
}

/** 저장소의 모든 골든 스팩을 검사한다. */
export const inspectGoldenSpecs = (repositoryRoot, options = {}) =>
  goldenSpecPaths(repositoryRoot, options).map(path => inspectGoldenSpec(repositoryRoot, path, options))
