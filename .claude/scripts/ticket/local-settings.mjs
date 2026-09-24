// local-settings.mjs — 저장소를 고치지 않고 **이 개발자에게만** 적용하는 리뷰 설정(파일 조회만).
//
// 팀 설정(`ticket-provider.json`)은 커밋돼 모두에게 적용된다. 저장소를 고칠 수 없는 팀에서도 PR 전 리뷰에 자기
// 리뷰어·참고 문서를 넣을 수 있게, 저장소 밖 `~/.claude/web-harness/local.json`에서 프로젝트 절대 경로를 키로 읽는다.
// 받는 것은 **개인 작업 방식**뿐이다 — 팀이 같아야 하는 값(제목 접두어·스팩·규약)은 받지 않는다(사람마다 갈리면
// 같은 제목 대조와 같은 스팩 판정이 갈린다).
//
//   {"projects": {"/abs/project/root": {"reviewAgents": ["code-reviewer"], "reviewReferences": ["docs/react.md"]}}}
import {existsSync, readFileSync, realpathSync, statSync} from 'node:fs'
import {homedir} from 'node:os'
import {isAbsolute, join, relative, resolve, sep} from 'node:path'

export const LOCAL_SETTINGS_RELATIVE = '.claude/web-harness/local.json'
export const LOCAL_SETTING_KEYS = ['reviewAgents', 'reviewReferences']

const stringList = value => (Array.isArray(value) ? [...new Set(value.map(item => String(item).trim()).filter(Boolean))] : null)
const realOrSelf = path => { try { return realpathSync(path) } catch { return resolve(path) } }

/**
 * 이 프로젝트의 로컬 리뷰 설정. 파일이 없거나 이 프로젝트 항목이 없으면 null.
 * 형식이 틀리면 버리지 않고 `errors`로 돌려준다(조용히 무시하면 설정했다고 믿는 채 리뷰가 빠진다).
 * @returns {null | {path: string, reviewAgents: string[], reviewReferences: string[], missingReferences: string[], errors: string[]}}
 */
export function readLocalReviewSettings(projectRoot, {home = homedir()} = {}) {
  const path = join(home, LOCAL_SETTINGS_RELATIVE)
  if (!existsSync(path)) return null
  const root = realOrSelf(projectRoot)
  let parsed
  try { parsed = JSON.parse(readFileSync(path, 'utf8')) } catch (error) {
    return {path, reviewAgents: [], reviewReferences: [], missingReferences: [], errors: [`읽지 못했다: ${String(error?.message ?? error).slice(0, 120)}`]}
  }
  const projects = parsed?.projects && typeof parsed.projects === 'object' ? parsed.projects : {}
  // 키는 절대 경로만 — 상대 키는 실행 위치에 따라 다른 프로젝트에 붙는다.
  const key = Object.keys(projects).find(candidate => isAbsolute(candidate) && realOrSelf(candidate) === root)
  if (key === undefined) return null
  const entry = projects[key]
  const errors = []
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return {path, reviewAgents: [], reviewReferences: [], missingReferences: [], errors: ['프로젝트 항목이 객체가 아니다']}
  }
  const unknown = Object.keys(entry).filter(name => !LOCAL_SETTING_KEYS.includes(name))
  if (unknown.length > 0) errors.push(`로컬에서 받지 않는 키: ${unknown.join(', ')} — 팀이 같아야 하는 설정은 팀 설정(ticket-provider.json)에 둔다`)
  const reviewAgents = stringList(entry.reviewAgents)
  if (entry.reviewAgents !== undefined && reviewAgents === null) errors.push('reviewAgents는 문자열 배열이어야 한다')
  const references = stringList(entry.reviewReferences)
  if (entry.reviewReferences !== undefined && references === null) errors.push('reviewReferences는 문자열 배열이어야 한다')
  // 참고 문서는 프로젝트 안의 실파일만 — 밖을 가리키면 리뷰어가 읽을 수 없고(훅이 막는다) 경로 탈출이 된다.
  const reviewReferences = []
  const missingReferences = []
  for (const reference of references ?? []) {
    const target = resolve(root, reference)
    const offset = relative(root, realOrSelf(target))
    const inside = !isAbsolute(reference) && offset !== '' && offset !== '..' && !offset.startsWith(`..${sep}`) && !isAbsolute(offset)
    if (inside && existsSync(target) && statSync(target).isFile()) reviewReferences.push(offset.split(sep).join('/'))
    else missingReferences.push(reference)
  }
  return {path, reviewAgents: reviewAgents ?? [], reviewReferences: [...new Set(reviewReferences)], missingReferences, errors}
}
