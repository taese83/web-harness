#!/usr/bin/env node
// validate-dependency-pins.mjs — 의존성 pin registry 사전검증 (Tessl Spec Registry 착안).
//
// 왜: tech-advisor가 "웹 리서치로 교차확인했다"며 고정한 exact 버전 pin은 install 전까지
// 자기진술(§4 프록시)이다. seminar-booking 전 과정 실증에서 두 결함이 새어들었다 —
//   (1) typescript 6.0.0: 안정 릴리스가 존재하지 않음(베타 전용) → install에서 ERR로 검출
//   (2) typescript-eslint 8.57.0이 typescript 7을 미지원(peer ">=4.8.4 <6.0.0") →
//       **install/lockfile은 peer를 WARN으로만 처리해 통과, lint 단계까지 새어듦**
// 이 게이트는 (1) 존재성 + (2) pin 집합 내부의 peer 호환을 install **전에** 기계로 잡는다.
//
// 사용법:
//   node .claude/scripts/validate-dependency-pins.mjs --project <root> [--json]
//   (오케스트레이터가 package-scaffolder 직후·lockfile/install 전에 실행 — Phase 3 pre-install 게이트)
// 종료 코드: 0 = 위반 없음, 1 = NONEXISTENT/PEER_INCOMPAT 위반, 2 = 사용법/입력 오류.
//
// 네트워크: `pnpm view <pkg>@<ver> --json`으로 존재성·peerDependencies를 조회한다(있을 때만).
// 순수 분석(analyzePins)은 네트워크 결과를 주입받아 오프라인 테스트로 고정된다.

import {execFileSync} from 'node:child_process'
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs'
import {join, resolve} from 'node:path'

// ── 최소 semver (dependency-free, 보수적) ─────────────────────────────────
// 파싱 못 하는 범위는 false-fail 대신 'unknown'을 반환해 SKIP한다(신뢰성 우선).

export function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v).trim().replace(/^[v=]/, ''))
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

export function compareVersion(a, b) {
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1 }
  return 0
}

// 단일 비교자(comparator)를 만족하는지. 파싱 불가면 null.
// partial 버전 파싱 — `3`, `3.1`, `3.1.4` 모두 [x,y,z](누락은 0). npm 범위(`^3`, `>=9`)용.
function parsePartial(s) {
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(s).trim())
  if (!m) return null
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)]
}

function satisfiesComparator(ver, cmp) {
  cmp = cmp.trim()
  if (cmp === '' || cmp === '*' || cmp === 'x' || cmp === 'X' || cmp === 'latest') return true
  const caret = /^\^\s*(\d+(?:\.\d+){0,2})/.exec(cmp)
  if (caret) {
    const t = parsePartial(caret[1]); if (!t) return null
    const [MA, MI, PA] = t
    const hi = MA > 0 ? [MA + 1, 0, 0] : MI > 0 ? [0, MI + 1, 0] : [0, 0, PA + 1]
    return compareVersion(ver, [MA, MI, PA]) >= 0 && compareVersion(ver, hi) < 0
  }
  const tilde = /^~\s*(\d+(?:\.\d+){0,2})/.exec(cmp)
  if (tilde) {
    const t = parsePartial(tilde[1]); if (!t) return null
    const [MA, MI] = t
    // npm 시맨틱: 마이너 미지정(`~5`)이면 상한 [MA+1,0,0](= ^5), 마이너 지정(`~5.0`/`~5.0.0`)이면 [MA,MI+1,0].
    const minorGiven = /^\d+\.\d+/.test(tilde[1])
    const hi = minorGiven ? [MA, MI + 1, 0] : [MA + 1, 0, 0]
    return compareVersion(ver, t) >= 0 && compareVersion(ver, hi) < 0
  }
  const op = /^(>=|<=|>|<|=)?\s*(\d+(?:\.\d+){0,2})/.exec(cmp)
  if (op) {
    const operator = op[1] || '='
    const target = parsePartial(op[2]); if (!target) return null
    const c = compareVersion(ver, target)
    if (operator === '>=') return c >= 0
    if (operator === '<=') return c <= 0
    if (operator === '>') return c > 0
    if (operator === '<') return c < 0
    return c === 0
  }
  return null // 파싱 불가
}

// 범위(OR of AND)를 만족하는지. 'yes' | 'no' | 'unknown'.
export function satisfies(version, range) {
  const ver = parseVersion(version)
  if (!ver) return 'unknown'
  const orParts = String(range).split('||')
  let anyUnknown = false
  for (const part of orParts) {
    const comparators = part.trim().split(/\s+/).filter(Boolean)
    if (comparators.length === 0) return 'yes' // 빈 범위 = any
    let allSat = true
    let subUnknown = false
    for (const cmp of comparators) {
      const r = satisfiesComparator(ver, cmp)
      if (r === null) { subUnknown = true; break }
      if (r === false) { allSat = false; break }
    }
    if (subUnknown) { anyUnknown = true; continue }
    if (allSat) return 'yes'
  }
  return anyUnknown ? 'unknown' : 'no'
}

// ── 순수 분석 코어 ───────────────────────────────────────────────────────
// pinned: {name: version}  (exact 버전만)
// meta:   {name: {exists: bool, availableLatest?: string, peerDependencies?: {dep: range}}}
//   meta[name].exists === false → 그 exact 버전이 registry에 없음.
export function analyzePins(pinned, meta) {
  const violations = []
  const skipped = []
  for (const [name, version] of Object.entries(pinned)) {
    const m = meta[name]
    if (!m) { skipped.push({name, version, reason: 'no-registry-data'}); continue }
    if (m.exists === false) {
      violations.push({kind: 'NONEXISTENT', name, version, detail: m.availableLatest ? `해당 exact 버전 없음(registry latest: ${m.availableLatest})` : '해당 exact 버전이 registry에 없음'})
      continue
    }
    const peers = m.peerDependencies ?? {}
    for (const [peerName, peerRange] of Object.entries(peers)) {
      if (!(peerName in pinned)) continue // 우리 pin 집합에 없는 peer는 install이 해결
      const result = satisfies(pinned[peerName], peerRange)
      if (result === 'no') {
        violations.push({kind: 'PEER_INCOMPAT', name, version, detail: `${name}@${version}의 peer ${peerName} "${peerRange}"를 pin ${peerName}@${pinned[peerName]}이 위반`})
      } else if (result === 'unknown') {
        skipped.push({name, version, reason: `peer ${peerName} "${peerRange}" 범위 파싱 불가 — 미검사`})
      }
    }
  }
  return {violations, skipped}
}

// ── package.json 수집 ────────────────────────────────────────────────────
const EXACT = /^\d+\.\d+\.\d+/ // caret/tilde/range/workspace/catalog 제외 — exact pin만
function collectPins(root) {
  const pins = {}
  const pkgFiles = []
  const walk = dir => {
    let entries
    try { entries = readdirSync(dir) } catch { return }
    for (const name of entries) {
      if (name === 'node_modules' || name === '.git') continue
      const abs = join(dir, name)
      let st
      try { st = statSync(abs) } catch { continue }
      if (st.isDirectory()) walk(abs)
      else if (name === 'package.json') pkgFiles.push(abs)
    }
  }
  walk(root)
  for (const file of pkgFiles) {
    let json
    try { json = JSON.parse(readFileSync(file, 'utf8')) } catch { continue }
    for (const field of ['dependencies', 'devDependencies']) {
      for (const [name, spec] of Object.entries(json[field] ?? {})) {
        if (typeof spec === 'string' && EXACT.test(spec)) pins[name] = spec.replace(/^[v=]/, '')
      }
    }
  }
  return pins
}

// ── 네트워크 계층 (pnpm view) ────────────────────────────────────────────
function fetchMeta(name, version, viewFn) {
  try {
    const raw = viewFn(name, version)
    const data = JSON.parse(raw)
    // `pnpm view pkg@ver --json`은 정확 매칭이면 객체, 아니면 던지거나 빈값.
    const resolved = data.version ?? (Array.isArray(data) ? data[data.length - 1]?.version : undefined)
    if (!resolved) return {exists: false}
    return {exists: true, peerDependencies: data.peerDependencies ?? {}}
  } catch (error) {
    const msg = String(error.stdout ?? error.message ?? '')
    if (/No match|ERR_PNPM_NO_MATCHING_VERSION|is not in the npm registry|404/i.test(msg)) {
      // latest 조회 시도(안내용)
      let latest
      try { latest = JSON.parse(viewFn(name, '')).version } catch { /* ignore */ }
      return {exists: false, availableLatest: latest}
    }
    return null // 조회 실패(네트워크 등) → skip
  }
}

const defaultViewFn = (name, version) => execFileSync('pnpm', ['view', version ? `${name}@${version}` : name, '--json'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']})

export function buildMeta(pinned, viewFn = defaultViewFn) {
  const meta = {}
  for (const [name, version] of Object.entries(pinned)) {
    const m = fetchMeta(name, version, viewFn)
    if (m) meta[name] = m
  }
  return meta
}

// ── main ─────────────────────────────────────────────────────────────────
function main() {
  const argv = process.argv.slice(2)
  let root = null
  let json = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') { root = argv[++i]; continue }
    if (argv[i] === '--json') { json = true; continue }
  }
  if (!root) { console.error('사용법: --project <root> [--json]'); process.exit(2) }
  const abs = resolve(root)
  if (!existsSync(abs)) { console.error(`root 없음: ${abs}`); process.exit(2) }

  const pinned = collectPins(abs)
  if (Object.keys(pinned).length === 0) {
    if (json) console.log(JSON.stringify({schemaVersion: 1, pins: 0, violations: [], skipped: []}, null, 2))
    else console.log('exact 버전 pin 없음 — 검사 대상 없음')
    process.exit(0)
  }
  const meta = buildMeta(pinned)
  const {violations, skipped} = analyzePins(pinned, meta)

  if (json) {
    console.log(JSON.stringify({schemaVersion: 1, pins: Object.keys(pinned).length, violations, skipped}, null, 2))
  } else {
    for (const v of violations) console.log(`  ❌ ${v.kind} ${v.name}@${v.version} — ${v.detail}`)
    for (const s of skipped) if (s.reason !== 'no-registry-data') console.log(`  ⚠️  SKIP ${s.name}@${s.version} — ${s.reason}`)
    console.log(`\n의존성 pin: ${Object.keys(pinned).length}개 · 위반 ${violations.length} · 미검사 ${skipped.length}`)
    if (violations.length === 0) console.log('PASS ✅ — 존재하지 않는 버전·peer 비호환 없음')
    else console.log('FAIL ❌ — install 전에 pin을 정정하라(존재하는 버전 + peer 호환 집합으로).')
  }
  process.exit(violations.length === 0 ? 0 : 1)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
