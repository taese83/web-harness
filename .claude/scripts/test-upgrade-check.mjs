#!/usr/bin/env node
// test-upgrade-check.mjs — 이전 판본이 만든 `_workspace`가 지금 규칙과 어디서 부딪히는지(업그레이드 점검) 고정한다.
//
// 기준은 0.28.0 스크립트로 실제로 만든 fixture(`evals/fixtures/legacy-brownfield-0.28`)다. 부딪히는 항목 목록이 바뀌면
// 이 테스트가 깨진다 — 새 판본이 옛 산출물에 요구를 더했다는 뜻이고, 목록을 고치는 것은 의식적 행위다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {execFileSync, spawnSync} from 'node:child_process'
import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {summarize, upgradeCheck} from './upgrade-check.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(here, '../evals/fixtures/legacy-brownfield-0.28')

const withLegacy = run => {
  const root = mkdtempSync(join(tmpdir(), 'wh-upgrade-check-'))
  try {
    cpSync(FIXTURE, root, {recursive: true})
    rmSync(join(root, 'README.fixture.md'))
    execFileSync('git', ['init', '-q'], {cwd: root})
    return run(root)
  } finally { rmSync(root, {recursive: true, force: true}) }
}

test('0.28.0 산출물: 막는 것·건드릴 때·참고를 가르고, 목록이 고정돼 있다', () => {
  withLegacy(root => {
    const before = readFileSync(join(root, '_workspace/03_dev/spec.json'), 'utf8')
    const ledgerBefore = readFileSync(join(root, '_workspace/03_dev/spec-ledger.jsonl'), 'utf8')
    const report = upgradeCheck(root)
    assert.deepEqual(report.items.map(item => `${item.kind}:${item.id}`),
      ['blocks:gate0:team-sharing', 'on-touch:spec-relock', 'info:change-lane'],
      '옛 산출물과 부딪히는 항목이 바뀌었다 — 새 요구라면 목록과 릴리스 커밋에 적는다')
    assert.match(report.items[0].fix, /validate-development-readiness\.mjs --project \. --fix/)
    assert.match(report.items[1].detail, /constitution/)
    // 읽기 전용 — 스팩·원장·설정 파일을 건드리지 않는다
    assert.equal(readFileSync(join(root, '_workspace/03_dev/spec.json'), 'utf8'), before)
    assert.equal(readFileSync(join(root, '_workspace/03_dev/spec-ledger.jsonl'), 'utf8'), ledgerBefore)
    assert.throws(() => readFileSync(join(root, '.gitignore')), /ENOENT/)
  })
})

test('안내된 고치기를 하면 막는 항목이 사라진다', () => {
  withLegacy(root => {
    execFileSync(process.execPath, [join(here, 'validate-development-readiness.mjs'), '--project', root, '--fix'], {stdio: 'ignore'})
    const report = upgradeCheck(root)
    assert.deepEqual(report.items.filter(item => item.kind === 'blocks'), [])
  })
})

test('SessionStart 요약: 막는 것만 줄로 내고, 깨끗하면 빈 문자열이다', () => {
  withLegacy(root => {
    const text = summarize(upgradeCheck(root, {fast: true}), {from: '0.28.0'})
    assert.match(text, /Upgraded 0\.28\.0 →/)
    assert.match(text, /1 blocking, 2 other/)
    assert.match(text, /gate0:team-sharing/)
    assert.doesNotMatch(text, /spec-relock/, '막지 않는 항목은 줄로 내지 않는다')
    assert.ok(text.split('\n').length <= 6, '세션 문맥을 늘리지 않는다')
  })
  assert.equal(summarize({managed: true, items: []}), '')
  assert.equal(summarize({managed: false, items: []}), '')
})

test('_workspace가 없으면 관할 밖이다', () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-upgrade-none-'))
  try {
    assert.deepEqual(upgradeCheck(root).items, [])
    assert.equal(upgradeCheck(root).managed, false)
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('CLI: 막는 항목이 있으면 exit 1, --json은 같은 보고', () => {
  withLegacy(root => {
    const result = spawnSync(process.execPath, [join(here, 'upgrade-check.mjs'), '--project-root', root, '--json'], {encoding: 'utf8'})
    assert.equal(result.status, 1)
    assert.equal(JSON.parse(result.stdout).items[0].id, 'gate0:team-sharing')
  })
})

// 루트에서 잠근 옛 프로필(패키지는 멤버에만)이 있는 모노레포 — 러너가 멈추는 경우를 보고가 짚는가.
const withRootLockedMonorepo = run => {
  const root = mkdtempSync(join(tmpdir(), 'wh-upgrade-rootlock-'))
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({name: 'mono', private: true}))
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n')
    mkdirSync(join(root, 'apps/web'), {recursive: true})
    writeFileSync(join(root, 'apps/web/package.json'), JSON.stringify({name: 'web', dependencies: {react: '19.0.0'}, devDependencies: {vite: '6.0.0'}}))
    mkdirSync(join(root, '_workspace/01_plan'), {recursive: true})
    writeFileSync(join(root, '_workspace/01_plan/project-profile.json'),
      readFileSync(join(here, '../evals/fixtures/migrate-profile-lock/root-locked-profile.json')))
    return run(root)
  } finally { rmSync(root, {recursive: true, force: true}) }
}

test('루트 잠금 프로필: 막는 항목으로 멤버를 짚고 마이그레이션을 사람 몫으로 안내한다', () => {
  withRootLockedMonorepo(root => {
    const profile = upgradeCheck(root).items.find(item => item.id === 'profile-lock')
    assert.ok(profile, '러너가 멈추는 루트 잠금을 보고가 놓쳤다')
    assert.equal(profile.kind, 'blocks')
    assert.match(profile.detail, /apps\/web/)
    assert.match(profile.fix, /migrate-profile-lock.*사람이 --apply/)
  })
})

test('루트 잠금이 아닌 무효 프로필에는 마이그레이션이 아니라 재해석을 안내한다', () => {
  withRootLockedMonorepo(root => {
    rmSync(join(root, 'apps/web/package.json'))
    const profile = upgradeCheck(root).items.find(item => item.id === 'profile-lock')
    assert.ok(profile)
    assert.doesNotMatch(profile.fix, /migrate-profile-lock/, '실행하면 거부되는 명령을 가리켰다')
    assert.match(profile.fix, /resolve-profile/)
  })
})

test('개발 단계 전(스팩·원장 없음)이면 Gate 0 FAIL을 업그레이드 충돌로 내지 않는다', () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-upgrade-planning-'))
  try {
    mkdirSync(join(root, '_workspace/01_plan'), {recursive: true})
    const report = upgradeCheck(root, {fast: true})
    assert.deepEqual(report.items.filter(item => item.id.startsWith('gate0:')), [])
    assert.equal(summarize(report), '')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('--fast 요약은 건너뛴 검사를 머리줄에 적는다 — 요약에 없다고 통과가 아니다', () => {
  withLegacy(root => {
    const report = upgradeCheck(root, {fast: true})
    assert.deepEqual(report.partial.skipped, ['ownership'])
    assert.match(summarize(report), /partial — ownership not run/)
  })
})
