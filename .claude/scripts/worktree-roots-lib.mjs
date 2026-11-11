// worktree-roots-lib.mjs — 이 저장소에 붙은 git worktree의 루트를 찾는다(파일 조회만 — git을 실행하지 않는다).
//
// 같은 저장소의 다른 체크아웃(`.claude/worktrees/<이름>/`·형제 디렉터리)은 같은 신뢰 경계다.
// 판정은 메인 체크아웃의 `.git/worktrees/<id>/gitdir`(worktree의 `.git` 파일 경로)와 그 `.git` 파일의 `gitdir:`이 **서로를**
// 가리키는지로 한다 — 한쪽만 보면 아무 디렉터리에 `.git` 파일을 두어 루트를 사칭할 수 있다.
import {lstatSync, readdirSync, readFileSync, realpathSync} from 'node:fs'
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path'

/** 메인 체크아웃(`.git`이 디렉터리)에 등록된 worktree 루트들(realpath). 아니면 빈 배열. */
export const attachedWorktreeRoots = projectRoot => {
  const admin = join(projectRoot, '.git', 'worktrees')
  try {
    if (!lstatSync(join(projectRoot, '.git')).isDirectory()) return []
    if (!lstatSync(admin).isDirectory()) return []
  } catch {
    return []
  }
  const roots = []
  for (const id of readdirSync(admin)) {
    try {
      const gitFile = readFileSync(join(admin, id, 'gitdir'), 'utf8').trim()
      if (!isAbsolute(gitFile) || !lstatSync(gitFile).isFile()) continue
      const back = readFileSync(gitFile, 'utf8').match(/^gitdir:\s*(.+?)\s*$/m)?.[1]
      if (!back || realpathSync(resolve(dirname(gitFile), back)) !== realpathSync(join(admin, id))) continue
      roots.push(realpathSync(dirname(gitFile)))
    } catch { /* 깨진·지워진 worktree는 건너뛴다 */ }
  }
  return roots
}

const isInside = (root, target) => {
  const offset = relative(root, target)
  return offset === '' || (offset !== '..' && !offset.startsWith(`..${sep}`) && !isAbsolute(offset))
}

/** target을 담는 가장 깊은 worktree 루트 또는 null. */
export const worktreeRootFor = (projectRoot, target) =>
  attachedWorktreeRoots(projectRoot).filter(root => isInside(root, target)).sort((a, b) => b.length - a.length)[0] ?? null
