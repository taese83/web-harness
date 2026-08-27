#!/usr/bin/env node
// test-lockfile-source.mjs — lockfile 출처 판정의 회귀.
//
// 2026-08-27 첫 eval receipt가 잡은 결함: 판정이 lockfile 텍스트 전체에서 URL을 찾아
// `deprecated:` 안내문 속 URL을 dependency source로 오인했다. eslint를 쓰는 어떤 프로젝트도
// install할 수 없었고, 실제로 걸린 URL 중 둘은 **보안 권고**였다.
//
// 여기서 고정하는 사실:
//   (1) 산문 필드(deprecated 등)의 URL은 출처가 아니다 — 통과한다
//   (2) 진짜 비-레지스트리 출처는 그대로 막힌다 (좁히면서 게이트를 잃지 않았다)
//   (3) 산문 제외는 **값만** 지우고 키는 남긴다 — 구조를 흐려 다른 검사가 새면 안 된다
//   (4) block scalar 산문도 값 전체가 제외된다
import assert from 'node:assert/strict'
import test from 'node:test'
import {inspectLockfileSource, stripInertMetadata} from './lockfile-source-lib.mjs'

const BASE = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

packages:

  eslint@9.39.5:
    resolution: {integrity: sha512-abc}
`

test('산문 필드의 URL은 출처가 아니다 — 실제 lockfile에 있는 값들', () => {
  for (const [label, notice] of [
    ['eslint 버전 지원 안내', 'This version is no longer supported. Please see https://eslint.org/version-support for other options.'],
    ['CVE 권고', 'Critical severity vulnerability, see https://nextjs.org/blog/CVE-2025-66478'],
    ['보안 업데이트', 'see https://nextjs.org/blog/security-update-2025-12-11'],
  ]) {
    const violations = inspectLockfileSource(`${BASE}  old@1.0.0:\n    resolution: {integrity: sha512-d}\n    deprecated: ${notice}\n`)
    assert.deepEqual(violations, [], `${label}가 install을 막았다: ${violations.join('; ')}`)
  }
})

test('진짜 비-레지스트리 출처는 그대로 막힌다', () => {
  const cases = [
    ['외부 tarball', '  evil@1.0.0:\n    resolution: {tarball: https://evil.example.com/p.tgz}\n'],
    ['git+ssh', '  x@1.0.0:\n    resolution: {type: git, repo: git+ssh://git@github.com/a/b.git}\n'],
    ['file: 출처', '  y@1.0.0:\n    version: file:../local\n'],
    ['link: 출처', '  z@1.0.0:\n    version: link:../sibling\n'],
    ['자격증명 삽입 registry', '  w@1.0.0:\n    resolution: {tarball: https://user:pw@registry.npmjs.org/w.tgz}\n'],
    ['포트 지정 registry', '  v@1.0.0:\n    resolution: {tarball: https://registry.npmjs.org:8443/v.tgz}\n'],
  ]
  for (const [label, block] of cases) {
    const violations = inspectLockfileSource(BASE + block)
    assert.ok(violations.length > 0, `${label}를 놓쳤다 — 좁히다 게이트를 잃었다`)
  }
})

test('산문 제외는 값만 지우고 키는 남긴다', () => {
  const stripped = stripInertMetadata('  deprecated: see https://x.example/y\n  resolution: {integrity: sha512-a}\n')
  assert.match(stripped, /deprecated:/, '키가 사라지면 구조가 흐려진다')
  assert.ok(!stripped.includes('https://x.example/y'), '산문 값이 남았다')
  assert.match(stripped, /resolution: \{integrity: sha512-a\}/, '산문이 아닌 줄이 훼손됐다')
})

test('산문 다중행 네 형태 전부 값이 제외된다 — 형태별 특수 처리는 하나를 놓친다', () => {
  // 첫 구현은 `>`/`|` 리터럴만 봤고 접힌 plain·따옴표·들여쓰기 지시자를 놓쳤다(적대 검토 HIGH).
  // 들여쓰기 규칙 하나로 통일해 네 형태를 덮는다. 실측(2026-08-27): 실제 pnpm은 한 줄 plain으로
  // 최대 260자까지 내보내지만, 형태를 가정하지 않는 쪽이 맞다.
  const forms = [
    ['한 줄 plain', '  deprecated: see https://evil.example.com/x'],
    ['접힌 plain 다중행', '  deprecated: a very long notice that wraps\n    onto https://evil.example.com/x'],
    ['따옴표 다중행', '  deprecated: "a long notice\n    that mentions https://evil.example.com/x"'],
    ['block scalar', '  deprecated: >-\n    long notice\n    https://evil.example.com/x'],
    ['들여쓰기 지시자', '  deprecated: |2\n    long notice\n    https://evil.example.com/x'],
  ]
  for (const [label, block] of forms) {
    const source = `${BASE}  old@1.0.0:\n${block}\n  next@1.0.0:\n    resolution: {tarball: https://registry.npmjs.org/next.tgz}\n`
    const stripped = stripInertMetadata(source)
    assert.ok(!stripped.includes('evil.example.com'), `${label}: 산문 값이 남았다`)
    assert.match(stripped, /registry\.npmjs\.org\/next\.tgz/, `${label}: 값 범위를 넘어 다음 항목까지 먹었다`)
    assert.deepEqual(inspectLockfileSource(source), [], `${label}: 산문 URL이 install을 막았다`)
  }
})

test('같은 들여쓰기의 실제 출처는 산문 값을 끝내고 검사된다', () => {
  const source = `${BASE}  bad@1.0.0:\n    deprecated: notice\n    resolution: {tarball: https://evil.example.com/p.tgz}\n`
  assert.ok(
    inspectLockfileSource(source).length > 0,
    '산문 바로 다음 줄의 진짜 출처를 놓쳤다 — 값 범위가 너무 넓다',
  )
})

test('레지스트리 tarball은 통과한다', () => {
  assert.deepEqual(
    inspectLockfileSource(`${BASE}  ok@1.0.0:\n    resolution: {tarball: https://registry.npmjs.org/ok/-/ok-1.0.0.tgz}\n`),
    [],
  )
})
