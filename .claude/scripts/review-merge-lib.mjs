// review-merge-lib.mjs — 진행 중인 merge(MERGE_HEAD)에서 「이 merge가 만든 변경」만 고른다.
// 들어온 쪽을 그대로 받은 파일은 이 merge의 변경이 아니다 — 그 리뷰는 들어온 브랜치 PR의 몫이며, 여기서는 리뷰됐다고 주장하지 않는다.
// 판정은 blob 동일성이다(근사 — 한계는 protected-core §4 「merge 리뷰 범위」 행).
import {spawnSync} from 'node:child_process'
import {lstatSync, readFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {computeImpact} from './review-impact-lib.mjs'

const git = (root, args, input) => {
  const result = spawnSync('git', ['-C', root, '-c', 'core.quotePath=false', ...args], {
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
    env: {...process.env, GIT_LITERAL_PATHSPECS: '1'},
  })
  return result.status === 0 ? result.stdout : null
}
const nameSet = out => new Set((out ?? '').split('\0').filter(Boolean))
const treeBlobs = (root, ref) => {
  const out = git(root, ['ls-tree', '-r', '-z', '--full-tree', ref])
  if (out === null) throw new Error(`${ref} 트리를 읽지 못했다`)
  return new Map(out.split('\0').filter(Boolean).map(line => {
    const tab = line.indexOf('\t')
    return [line.slice(tab + 1), line.slice(0, tab).split(' ')[2]]
  }))
}
const worktreeBlobs = (root, paths) => {
  const present = paths.filter(path => { try { return lstatSync(join(root, path)).isFile() } catch { return false } })
  const out = present.length ? git(root, ['hash-object', '--stdin-paths'], present.join('\n')) : ''
  if (out === null) throw new Error('작업 트리 파일의 지문을 구하지 못했다')
  const hashes = out.trim().split('\n')
  return new Map(present.map((path, index) => [path, hashes[index]]))
}

export const RESOLUTION = {
  unresolved: '충돌 미해결',
  'kept-ours': '양쪽이 바꿈 — 이쪽(HEAD) 내용을 남김, 들어온 변경이 빠졌다',
  'took-theirs': '양쪽이 바꿈 — 들어온 쪽 내용을 받음, 이쪽 변경이 빠졌다',
  combined: '양쪽이 바꿈 — 두 변경을 합침',
  'dropped-theirs': '들어온 쪽만 바꿈 — 그 변경을 받지 않았다',
  edited: 'merge 결과에서 새로 고침 — 어느 쪽과도 다르다',
  'cross-impact': '자동 병합 의미 충돌 후보 — 반대쪽이 바꾼 파일을 import한다',
}

// 진행 중인 merge가 없으면 null. 계산하지 못하면 throw — 호출부가 「확인 불가」로 적는다.
// changedPaths: 묶음의 diff-names(merge와 무관하게 작업 트리에서 고친 파일도 볼 파일에 넣는다).
export function computeMergeFocus(root, changedPaths = []) {
  const mergeHead = git(root, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])?.trim()
  if (!mergeHead) return null
  const head = git(root, ['rev-parse', 'HEAD'])?.trim()
  const mergeBase = git(root, ['merge-base', 'HEAD', 'MERGE_HEAD'])?.trim()
  if (!head || !mergeBase) throw new Error('HEAD와 MERGE_HEAD의 merge-base를 구하지 못했다')
  const ours = nameSet(git(root, ['diff', '--name-only', '-z', '--no-renames', mergeBase, 'HEAD']))
  const theirs = nameSet(git(root, ['diff', '--name-only', '-z', '--no-renames', mergeBase, 'MERGE_HEAD']))
  const unmerged = nameSet(git(root, ['diff', '--name-only', '-z', '--diff-filter=U']))
  const paths = [...new Set([...ours, ...theirs, ...unmerged, ...changedPaths])].filter(path => !path.startsWith('_workspace/04_qa/')).sort()
  const headBlobs = treeBlobs(root, 'HEAD')
  const incomingBlobs = treeBlobs(root, 'MERGE_HEAD')
  const resultBlobs = worktreeBlobs(root, paths)
  const focus = []
  const incomingAsIs = {}
  for (const path of paths) {
    if (unmerged.has(path)) { focus.push({path, resolution: 'unresolved'}); continue }
    const result = resultBlobs.get(path) ?? null
    const o = headBlobs.get(path) ?? null
    const t = incomingBlobs.get(path) ?? null
    let resolution = null
    if (ours.has(path) && theirs.has(path)) {
      if (result !== o || result !== t) resolution = result === o ? 'kept-ours' : result === t ? 'took-theirs' : 'combined'
    } else if (theirs.has(path)) {
      if (result === t) incomingAsIs[path] = result
      else resolution = result === o ? 'dropped-theirs' : 'edited'
    } else if (result !== o) {
      resolution = 'edited'
    }
    if (resolution) focus.push({path, resolution})
  }
  // 깨끗한 자동 병합의 의미 충돌 — 한쪽이 바꾼 파일을 다른 쪽이 바꾼 파일이 import하면 둘 다 한쪽 내용 그대로여도 함께 봐야 한다.
  const listed = new Set(focus.map(entry => entry.path))
  for (const [changed, other] of [[theirs, ours], [ours, theirs]]) {
    const {importers} = computeImpact(root, [...changed])
    for (const [target, users] of importers) {
      for (const user of users) {
        if (!other.has(user) || changed.has(user) || listed.has(user)) continue
        listed.add(user)
        delete incomingAsIs[user]
        focus.push({path: user, resolution: 'cross-impact', via: target})
      }
    }
  }
  focus.sort((left, right) => left.path.localeCompare(right.path))
  const message = git(root, ['rev-parse', '--git-path', 'MERGE_MSG'])?.trim()
  let incomingRef = null
  try { incomingRef = readFileSync(resolve(root, message), 'utf8').split('\n')[0].trim() || null } catch { /* 이름 없이 sha만 */ }
  return {head, mergeHead, mergeBase, incomingRef, focus, incomingAsIs}
}

// 볼 파일만의 diff — HEAD 대비(이쪽에서 무엇이 바뀌었나)와 MERGE_HEAD 대비(들어온 변경 중 무엇이 빠지거나 고쳐졌나).
export function mergeFocusPatch(root, focus) {
  const paths = focus.map(entry => entry.path)
  if (paths.length === 0) return ''
  const ours = git(root, ['diff', '--no-color', '--no-renames', 'HEAD', '--', ...paths])
  const theirs = git(root, ['diff', '--no-color', '--no-renames', 'MERGE_HEAD', '--', ...paths])
  if (ours === null || theirs === null) throw new Error('볼 파일의 diff를 만들지 못했다')
  return `# ===== HEAD 대비 merge 결과 =====\n${ours}\n# ===== 들어온 쪽(MERGE_HEAD) 대비 merge 결과 =====\n${theirs}`
}

export function renderMergeFocus({head, mergeHead, mergeBase, incomingRef, focus, incomingAsIs}) {
  const short = sha => sha.slice(0, 7)
  const asIs = Object.keys(incomingAsIs).length
  const lines = [
    '# merge 리뷰 범위 — 진행 중인 merge(MERGE_HEAD)',
    '',
    `- HEAD ${short(head)} ← MERGE_HEAD ${short(mergeHead)}${incomingRef ? ` (${incomingRef})` : ''} · merge-base ${short(mergeBase)}`,
    `- 볼 파일 ${focus.length}개(아래)와 그 diff \`merge-focus.patch\`가 이 merge가 만든 변경이다.`,
    `- 들어온 쪽을 그대로 받은 파일 ${asIs}개는 이 merge의 변경이 아니다 — 그 리뷰는 들어온 브랜치 PR의 몫이고, 이 리뷰가 봤다고 기록하지 않는다.`
      + ' 들어온 쪽이 PR base가 아니면(리뷰 안 된 브랜치) 그 사실을 보고에 적는다.',
    '- 볼 파일의 사용처가 들어온 쪽 파일이면 그 파일은 읽는다(impact.txt).',
    '',
    '## 볼 파일',
    ...(focus.length
      ? focus.map(({path, resolution, via}) => `- ${path} — ${RESOLUTION[resolution]}${via ? `(\`${via}\`)` : ''}`)
      : ['- 없음 — 들어온 쪽을 그대로 받았고, 양쪽 변경이 서로 import로 닿는 파일도 없다(import 근사 — 동적·문자열 경로는 못 본다)']),
  ]
  return `${lines.join('\n')}\n`
}
