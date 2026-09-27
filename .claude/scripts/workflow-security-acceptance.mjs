// workflow-security-acceptance.mjs — 기존 저장소의 워크플로 보안 finding을 **사람이 명시적으로
// 인수**한 기록을 남기고 되읽는다.
//
// 왜: 품질 러너는 프로젝트 코드를 실행하기 전에 `.github/workflows`를 검사한다. 하네스가 만들지
// 않은 기존 저장소는 팀이 소유한 워크플로를 갖고 있고, 그 finding은 이 변경에서 고칠 수 없다 —
// 그래서 개발 게이트(`--check`) 자체가 영영 돌지 못했다. 인수는 그 교착만 푼다.
//
// 인수는 **개발 게이트에만** 효력이 있다. `--all`(배포 증거)에는 인수를 적용하지 않는다 — 배포 증거는
// 워크플로 finding이 0일 때만 만들어진다. 인수는 **워크플로 파일 경로 + 내용 sha256 + finding
// 코드**에 결박한다. 파일이 한 바이트라도 바뀌거나 새 코드가 생기면 인수는 그것을 덮지 않고,
// flag로 다시 인수할 수도 없다 — 사람이 이 파일을 지운 뒤에만 다시 기록된다(워크플로를 바꾼 주체가
// 같은 호출에서 자기 변경을 인수하는 폐곡선을 막는다).
import {join} from 'node:path'
import {atomicWriteProjectFile, readOptionalProjectRegularFile} from './safe-project-file-lib.mjs'

export const ACCEPTANCE_RELATIVE = '_workspace/03_dev/workflow-security-acceptance.json'
export const acceptancePath = projectRoot => join(projectRoot, ACCEPTANCE_RELATIVE)
export const ACCEPTANCE_SCHEMA_VERSION = 1
const ACCEPTANCE_MAX_BYTES = 1024 * 1024

/**
 * 현재 인수 상태. 깨진 파일·다른 프로젝트의 파일·다른 형식은 **부재가 아니라 무효**다 —
 * 무효인 파일이 있으면 flag로 새로 기록하지도 않는다(사람이 지워야 한다).
 * @returns {{state: 'none'|'valid'|'unreadable'|'other-project'|'schema-outdated', record?: object}}
 */
export function readWorkflowSecurityAcceptance(projectRoot, {read = null} = {}) {
  let raw
  try {
    raw = read
      ? read(acceptancePath(projectRoot))
      : readOptionalProjectRegularFile(projectRoot, ACCEPTANCE_RELATIVE, {maxBytes: ACCEPTANCE_MAX_BYTES})?.toString('utf8')
  } catch {
    // 심링크·비정규 파일·크기 초과 — 따라가 읽지 않고 무효로 읽는다(flag로 덮지도 못한다).
    return {state: 'unreadable'}
  }
  if (raw === null || raw === undefined) return {state: 'none'}
  let record
  try {
    record = JSON.parse(raw)
  } catch {
    return {state: 'unreadable'}
  }
  if (record?.schemaVersion !== ACCEPTANCE_SCHEMA_VERSION || !Array.isArray(record.workflows)) return {state: 'schema-outdated'}
  if (record.projectRoot !== projectRoot) return {state: 'other-project'}
  return {state: 'valid', record}
}

/** finding 하나가 인수에 덮이는가 — 경로·내용 digest·코드가 모두 같아야 한다. */
export function acceptanceCovers(record, {workflowPath, sha256, code}) {
  if (!record || typeof sha256 !== 'string') return false
  return record.workflows.some(entry =>
    entry?.path === workflowPath &&
    entry.sha256 === sha256 &&
    Array.isArray(entry.codes) &&
    entry.codes.includes(code))
}

/** 인수 기록(현재 상태 한 건). 되돌리려면 이 파일을 지운다. */
export function recordWorkflowSecurityAcceptance(projectRoot, findings, {now = () => new Date().toISOString(), write = null} = {}) {
  const byPath = new Map()
  for (const {workflowPath, sha256, code} of findings) {
    const entry = byPath.get(workflowPath) ?? {path: workflowPath, sha256, codes: []}
    if (!entry.codes.includes(code)) entry.codes.push(code)
    byPath.set(workflowPath, entry)
  }
  const record = {
    schemaVersion: ACCEPTANCE_SCHEMA_VERSION,
    projectRoot,
    acceptedAt: now(),
    workflows: [...byPath.values()]
      .map(entry => ({...entry, codes: entry.codes.sort()}))
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
    note: '이 워크플로 내용의 보안 finding을 개발 게이트(--check)에서 인수했다. 배포 증거(--all)는 인수하지 않는다. 워크플로가 바뀌면 효력이 없고, 되돌리거나 다시 인수하려면 이 파일을 지운다.',
  }
  const serialized = `${JSON.stringify(record, null, 2)}\n`
  if (write) write(acceptancePath(projectRoot), serialized)
  else atomicWriteProjectFile(projectRoot, ACCEPTANCE_RELATIVE, serialized, {maxBytes: ACCEPTANCE_MAX_BYTES})
  return record
}
