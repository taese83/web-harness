#!/usr/bin/env node
// test-prepare-review-packet.mjs — 리뷰 묶음이 실제 조회 결과를 담고, 실패를 통과로 적지 않으며, 경계 밖에 쓰지 않는지 고정한다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'prepare-review-packet.mjs')
const PACKET = '_workspace/04_qa/review-packet'

const withProject = run => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-review-packet-'))
  try {
    const project = join(root, 'proj')
    mkdirSync(join(project, 'src'), {recursive: true})
    const git = (...args) => {
      const result = spawnSync('git', ['-C', project, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {encoding: 'utf8'})
      assert.equal(result.status, 0, result.stderr)
    }
    git('init', '-q', '-b', 'main')
    writeFileSync(join(project, 'src/a.ts'), 'export const a = 1\n')
    git('add', '.')
    git('commit', '-q', '-m', 'root')
    writeFileSync(join(project, 'src/a.ts'), 'export const a = 2\n')
    const packet = (args = [], cwd = project) => spawnSync(process.execPath, [SCRIPT, '--project-root', project, ...args],
      {cwd, encoding: 'utf8', env: {...process.env, CLAUDE_PROJECT_DIR: ''}})
    return run({root, project, packet})
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
}
const readIndex = project => JSON.parse(readFileSync(join(project, PACKET, 'INDEX.json'), 'utf8'))

test('변경 조회와 기계 판정을 묶고 항목마다 exit·sha256을 적는다', () => {
  withProject(({project, packet}) => {
    const result = packet()
    assert.equal(result.status, 0, result.stderr)
    const index = readIndex(project)
    assert.deepEqual(index.entries.map(entry => entry.file),
      ['status.txt', 'diff-stat.txt', 'diff-names.txt', 'diff.patch', 'ls-files.txt', 'layer-boundaries.json', 'reuse-inventory.txt', 'impact.txt'])
    assert.match(readFileSync(join(project, PACKET, 'diff.patch'), 'utf8'), /\+export const a = 2/)
    for (const entry of index.entries) assert.match(entry.sha256, /^[0-9a-f]{64}$/)
  })
})

test('미판정(스팩 없음)은 exit 0으로 적지 않는다 — 리뷰어가 통과로 읽지 않게', () => {
  withProject(({project, packet}) => {
    assert.equal(packet().status, 0)
    const layer = readIndex(project).entries.find(entry => entry.file === 'layer-boundaries.json')
    assert.notEqual(layer.exitCode, 0)
  })
})

test('다음 조회의 변경 목록에 묶음 자신을 되먹이지 않는다', () => {
  withProject(({project, packet}) => {
    assert.equal(packet().status, 0)
    assert.equal(packet().status, 0)
    assert.doesNotMatch(readFileSync(join(project, PACKET, 'status.txt'), 'utf8'), /review-packet/)
    assert.doesNotMatch(readFileSync(join(project, PACKET, 'diff.patch'), 'utf8'), /review-packet/)
  })
})

test('이번에 만들지 않은 선택 항목(지난 라운드 handoff)은 지운다', () => {
  withProject(({project, packet}) => {
    mkdirSync(join(project, PACKET), {recursive: true})
    writeFileSync(join(project, PACKET, 'handoff-development.json'), '{"stale":true}\n')
    assert.equal(packet().status, 0)
    assert.equal(existsSync(join(project, PACKET, 'handoff-development.json')), false)
  })
})

test('세션 프로젝트 밖은 거부하고 쓰지 않는다', () => {
  withProject(({root, project, packet}) => {
    const outside = join(root, 'other')
    mkdirSync(outside)
    const result = packet([], outside)
    assert.equal(result.status, 2)
    assert.equal(existsSync(join(project, PACKET)), false)
  })
})

test('묶음 디렉터리가 링크면 따라가 쓰지 않는다', () => {
  withProject(({root, project, packet}) => {
    const elsewhere = join(root, 'elsewhere')
    mkdirSync(elsewhere)
    mkdirSync(join(project, '_workspace/04_qa'), {recursive: true})
    symlinkSync(elsewhere, join(project, PACKET))
    const result = packet()
    assert.notEqual(result.status, 0)
    assert.equal(existsSync(join(elsewhere, 'INDEX.json')), false)
  })
})

test('묶음은 폴더 안 .gitignore로 커밋에서 빠지고 항목별 exit 의미를 싣는다', () => {
  withProject(({project, packet}) => {
    assert.equal(packet().status, 0)
    assert.equal(readFileSync(join(project, PACKET, '.gitignore'), 'utf8'), '*\n')
    assert.match(readIndex(project).exitMeaning['layer-boundaries.json'], /1 = FAIL/)
  })
})

test('영향 범위: 바뀐 소스 파일을 import하는 파일(상대 경로·별칭)을 impact.txt에 싣는다 — diff 밖의 호출부를 열어 보게', () => {
  withProject(({project, packet}) => {
    writeFileSync(join(project, 'src/b.ts'), "import {a} from './a'\nexport const b = a\n")
    writeFileSync(join(project, 'src/c.ts'), "import {a} from '@/a'\nexport const c = a\n")
    writeFileSync(join(project, 'src/d.ts'), 'export const d = 1\n')
    assert.equal(packet().status, 0)
    const impact = readFileSync(join(project, PACKET, 'impact.txt'), 'utf8')
    const section = impact.split('## ').find(part => part.startsWith('src/a.ts'))
    assert.match(section, /^src\/a\.ts — 사용처 2개/)
    assert.match(section, /- src\/b\.ts/)
    assert.match(section, /- src\/c\.ts/)
    assert.doesNotMatch(section, /src\/d\.ts/, 'a를 import하지 않는 파일을 사용처로 셌다')
  })
})

test('Codex 교차 리뷰를 켠 프로젝트면 묶음 출력에 같은 범위의 실행 명령을 싣는다 — 레인 문서를 안 읽어도 리뷰와 함께 띄운다', () => {
  withProject(({root, project, packet}) => {
    const off = packet(['--base', 'HEAD'])
    assert.equal(off.status, 0, off.stderr)
    assert.doesNotMatch(off.stdout, /codex cross-review/, '켜지 않은 프로젝트에 Codex 명령을 실었다')
    const home = join(root, 'home')
    mkdirSync(join(home, '.claude/web-harness'), {recursive: true})
    writeFileSync(join(home, '.claude/web-harness/local.json'), JSON.stringify({projects: {[project]: {codexReview: true}}}))
    const on = spawnSync(process.execPath, [SCRIPT, '--project-root', project, '--base', 'origin/develop'],
      {cwd: project, encoding: 'utf8', env: {...process.env, CLAUDE_PROJECT_DIR: '', HOME: home}})
    assert.equal(on.status, 0, on.stderr)
    assert.match(on.stdout, /codex cross-review: .*codex-cross-review\.mjs" --project-root ".*" --base origin\/develop/,
      'Codex를 켠 프로젝트인데 묶음과 같은 범위의 Codex 명령을 알리지 않았다')
  })
})
