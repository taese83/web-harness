// host-execution-grant.mjs — "이 프로젝트의 스크립트를 이 머신에서 실행해도 된다"는 **한 번의
// 승인**을 기록하고 되읽는다.
//
// 왜: quality runner는 생성된 프로젝트의 package script를 사용자 머신에서 실행한다. 한 번도
// 묻지 않는 것은 위험하다 — 그래서 `--allow-host-execution`이 있다. 그런데 **매번** 물었다.
// Gate A·B·C에서, 재시도마다, 스킬마다. 개발 한 사이클에 수십 번이고, 그 대부분은 같은
// 질문의 반복이라 판단이 아니라 의식이 된다(2026-08-30 사용자 지적).
//
// 한 번 승인하면 그 프로젝트·그 머신에서는 다시 묻지 않는다. 안전 하한은 그대로다 —
// **처음 한 번은 여전히 묻고**, 승인이 파일로 남아 누가 언제 무엇을 허용했는지 보인다.
//
// 승인은 **프로젝트 경로와 호스트, 그리고 승인 당시의 명령 집합에 결박**한다. 승인 파일을 다른
// 머신이나 다른 프로젝트로 복사해도, 승인 뒤에 package script가 바뀌어도 효력이 없다 — 그렇지
// 않으면 `test`를 실행해도 된다는 한 번의 "예"가, 나중에 그 `test`가 무엇으로 바뀌든 실행해도
// 된다는 허가가 된다. 승인은 "이 프로젝트의 코드"가 아니라 **"이 명령들"**에 대한 것이다.
import {createHash} from 'node:crypto'
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {hostname} from 'node:os'
import {dirname, join} from 'node:path'

export const GRANT_RELATIVE = '_workspace/03_dev/host-execution-grant.json'
export const grantPath = projectRoot => join(projectRoot, GRANT_RELATIVE)
/** 승인 레코드 형식. 이전 판 승인은 명령 집합을 담지 않으므로 다시 묻는다. */
export const GRANT_SCHEMA_VERSION = 2

/**
 * 승인이 덮는 **명령 집합**의 digest — `package.json`의 `scripts` 전체.
 * 읽지 못하면 실제 명령 집합 digest와는 절대 같지 않은 표식을 돌려준다 — 깨진 `package.json`이 승인을 살려 두지 않는다.
 */
export function commandSetDigest(projectRoot, {read = null} = {}) {
  const path = join(projectRoot, 'package.json')
  const raw = read ? read(path) : (existsSync(path) ? readFileSync(path, 'utf8') : null)
  if (raw === null || raw === undefined) return 'absent:package.json'
  let scripts
  try {
    scripts = JSON.parse(raw).scripts
  } catch {
    return 'unreadable:package.json'
  }
  const entries = scripts && typeof scripts === 'object' && !Array.isArray(scripts) ? Object.entries(scripts) : []
  const canonical = JSON.stringify(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`
}

/**
 * 승인 판정(순수 입력 주입 가능). 승인은 **이 프로젝트 경로 + 이 호스트 + 승인 당시의 명령 집합**에만
 * 유효하다.
 * @returns {{granted: boolean, reason: string, record?: object}}
 */
export function evaluateHostExecutionGrant(projectRoot, {read = null, host = hostname(), readPackage = null} = {}) {
  const path = grantPath(projectRoot)
  const raw = read ? read(path) : (existsSync(path) ? readFileSync(path, 'utf8') : null)
  if (raw === null || raw === undefined) return {granted: false, reason: 'no-grant'}
  let record
  try {
    record = JSON.parse(raw)
  } catch {
    // 깨진 승인을 "없음"이 아니라 **거부**로 읽는다 — 파싱 실패를 부재로 강등하면 한 바이트로
    // 판정이 바뀐다(이 저장소가 spec-lock에서 이미 겪은 클래스).
    return {granted: false, reason: 'grant-unreadable'}
  }
  if (record?.projectRoot !== projectRoot) return {granted: false, reason: 'grant-other-project'}
  if (record?.host !== host) return {granted: false, reason: 'grant-other-host'}
  // 이전 판 승인은 명령 집합을 담지 않는다 — 담지 않은 것을 "일치"로 읽으면 결박이 없는 것과 같다.
  if (record?.schemaVersion !== GRANT_SCHEMA_VERSION) return {granted: false, reason: 'grant-schema-outdated'}
  if (record?.commandSetDigest !== commandSetDigest(projectRoot, {read: readPackage})) {
    return {granted: false, reason: 'grant-stale-commands'}
  }
  return {granted: true, reason: 'granted', record}
}

/** 승인 기록(append 아님 — 현재 상태 한 건). 되돌리려면 이 파일을 지운다. */
export function recordHostExecutionGrant(projectRoot, {host = hostname(), now = () => new Date().toISOString(), write = null, readPackage = null} = {}) {
  const record = {
    schemaVersion: GRANT_SCHEMA_VERSION,
    projectRoot,
    host,
    commandSetDigest: commandSetDigest(projectRoot, {read: readPackage}),
    grantedAt: now(),
    note: '승인 당시의 package script를 이 머신에서 실행하는 것을 승인했다. script가 바뀌면 다시 묻는다. 되돌리려면 이 파일을 지운다.',
  }
  const path = grantPath(projectRoot)
  const serialized = `${JSON.stringify(record, null, 2)}\n`
  if (write) write(path, serialized)
  else {
    mkdirSync(dirname(path), {recursive: true})
    writeFileSync(path, serialized)
  }
  return record
}
