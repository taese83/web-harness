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
// ── 막는다 (2026-09-10 승격) ────────────────────────────────────────────────
// 첫 판은 **보고**였다. 골든이 `schemaVersion: 1`이라 재-잠금이 규칙상 금지(읽기 전용 이력)일
// 뿐 아니라 **기계적으로 불가능**했기 때문이다 — v1 골든의 solution-design에 v2가 요구하는
// `testLayers.unit`이 없어 `lockSpec`이 거부했다. 처방이 없는 게이트는 막을 자격이 없고,
// 그때 막으면 남는 길이 「의도된 리팩터 되돌리기」뿐이라 G3(소급 fail 금지)를 어긴다.
//
// 골든을 v2로 이관하면서 그 조건이 사라졌다. `testLayers`를 선언하고 재-잠금했으며 델타는
// 세 줄뿐이었다(schemaVersion 1→2 · sourceDigest 갱신 · testLayers 신설) — `specTier`·
// `layerMap`·`libraries`는 한 글자도 바뀌지 않았다. 이제 드리프트의 처방은 **재-잠금**이고
// 그것이 실재하므로 막는다. 오탐 0이다: 분모가 스팩 자신이 기록한 입력이라 「바뀌었다」는
// 해시 대조의 결과이지 추정이 아니다.

import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {digestInputs} from './spec.mjs'

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
 * 스팩 하나의 드리프트(판정 + 파일 읽기).
 *
 * **해시는 `digestInputs`가 낸다 — 손으로 해시하지 않는다.** 첫 판은 원문을 직접 sha256 했고
 * 적대 리뷰(2026-09-10)가 두 갈래로 갈라지는 것을 잡았다:
 *   ① `digestInputs`는 `stripHarnessMarkers`를 거친 뒤 해시한다. 하네스가 **선언하라고 요구한**
 *      `<!-- web-harness:unit … -->`가 골든 입력에 한 줄만 들어가도 두 판정이 갈렸고, 재-잠금
 *      **직후에** 이 게이트가 막았다 — 요구를 따르는 행위가 곧 자기 무효화다.
 *   ② 샤드 기록도 최상위 `sha256`을 갖는다(`spec.mjs`가 `[path, hash]` 쌍을 JSON으로 이어 해시).
 *      원문을 읽으려 하면 디렉터리라 ENOENT가 나 `(사라짐)`으로 **처방 없는 오탐 차단**이 됐다.
 * 분모만 스팩이 기록한 경로로 좁히고(`digestInputs`의 두 번째 인자) 산식은 그쪽 것을 쓴다 —
 * 그러면 `isSpecStale`과 이 검사가 **구조적으로** 갈라질 수 없다.
 * @returns {{path: string, state: 'FRESH'|'DRIFTED'|'UNREADABLE', drifted: string[], note: string}}
 */
export function inspectGoldenSpec(repositoryRoot, relativeSpecPath, {io = {}} = {}) {
  const root = resolve(repositoryRoot)
  const read = io.readFile ?? (path => readFileSync(join(root, path), 'utf8'))
  const digest = io.digestInputs ?? digestInputs
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
  const projectRoot = join(root, relativeSpecPath.replace(/\/_workspace\/03_dev\/spec\.json$/, ''))
  let now
  try { now = digest(projectRoot, recorded.map(record => record.path)) } catch (error) {
    return {path: relativeSpecPath, state: 'UNREADABLE', drifted: [],
      note: `입력 지문을 내지 못했다: ${error.message} — 미판정이며 통과가 아니다`}
  }
  const current = new Map(now.inputs.map(record => [record.path, record]))
  const drifted = []
  for (const record of recorded) {
    const fresh = current.get(record.path)
    // 부재/존재가 뒤집힌 것도 변경이다 — "없어졌다"를 침묵으로 두면 삭제가 통과한다.
    if (!fresh?.present) { if (record.present) drifted.push(`${record.path}(사라짐)`); continue }
    if (!record.present) { drifted.push(`${record.path}(새로 생김)`); continue }
    if (fresh.sha256 !== record.sha256) drifted.push(`${record.path}(내용 바뀜)`)
  }
  return drifted.length === 0
    ? {path: relativeSpecPath, state: 'FRESH', drifted: [],
      note: `기록한 입력 ${recorded.length}개가 확정 당시와 같다`}
    : {path: relativeSpecPath, state: 'DRIFTED', drifted,
      note: `확정 이후 입력이 바뀌었다: ${drifted.join(' · ')} — 골든이 자기 스팩과 어긋난다`}
}

/** 저장소 전체 보고 문구(순수). 판정은 `validateGoldenSpecDrift`가 낸다. */
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
  lines.push('  골든 입력을 고쳤으면 **재-잠금까지 같은 커밋에서 한다** —'
    + ' `lockSpec`으로 다시 확정하고 spec.json·spec-ledger.jsonl을 함께 커밋하라.'
    + ' 재-잠금 없이 입력만 바꾸면 골든이 자기 스팩을 증명하지 못한다')
  return lines.join('\n')
}

/** 저장소의 모든 골든 스팩을 검사한다. */
export const inspectGoldenSpecs = (repositoryRoot, options = {}) =>
  goldenSpecPaths(repositoryRoot, options).map(path => inspectGoldenSpec(repositoryRoot, path, options))

/**
 * `validate-harness` 소비 지점. 다른 validator와 같은 모양(`{repositoryRoot, pass, fail}`)이다.
 * FRESH가 아닌 것이 하나라도 있으면 **막는다** — 처방(재-잠금)이 실재하기 때문이다.
 */
export function validateGoldenSpecDrift({repositoryRoot, pass, fail, io = {}}) {
  const results = inspectGoldenSpecs(repositoryRoot, {io})
  const message = renderGoldenSpecDrift(results)
  // 미판정(UNREADABLE)도 통과가 아니다 — 읽지 못한 것을 FRESH로 강등하면 침묵이 통과가 된다.
  if (results.some(item => item.state !== 'FRESH')) fail(message)
  else pass(message)
}
