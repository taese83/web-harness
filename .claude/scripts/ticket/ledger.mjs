// 팀 워크플로우 통합 — 식별자 원장 (traceability 백본, 통합 빌드 2단계).
// docs/team-workflow-integration-design.md 공유 척추: FEAT-ID ↔ 티켓키 ↔ PR-URL을
// 트래커 밖 append-only 원장(JSONL)에 둔다. 트래커가 아니라 이 원장이 왕복의 정본이다.
//
// 이 모듈은 순수하다 — 파싱·직렬화만, 파일쓰기 없음. append(side-effect)는 confirm
// 게이트를 통과한 runner의 몫이며 serializeLedgerRecord로 만든 줄을 O_APPEND로 쓴다.

const FEAT_ID_ONE = /^FEAT-\d{3,}$/

/**
 * @typedef {Object} LedgerRecord
 * @property {1} schemaVersion
 * @property {string} featureId     FEAT-NNN — 하네스측 안정 식별자(왕복 앵커)
 * @property {string} ticketKey     외부 트래커 이슈 키 (예: "PROJ-123")
 * @property {string} contentHash   발행 시점 unit 내용 해시(재발행 멱등 판정용)
 * @property {string} [provider]    티켓 트래커 식별자('github' · 'jira'). **선택 — 없으면 'github'**
 *   (하위호환: 이 필드 도입 전 레코드가 전부 GitHub이다). 두 트래커가 한 원장에 섞이면
 *   무엇으로 조회할지의 근거가 되고, board가 소스를 나눠 읽는 기준이 된다.
 * @property {string} createdAt      ISO 시각
 * @property {string} [prUrl]        C(PR/status)가 채우는 PR 링크 — 없으면 미연결
 * @property {boolean} [closed]      units에서 사라져 닫힌 티켓
 * @property {string} [assignee]     청구 시 배정자(있으면)
 * @property {string} [branch]       청구가 이뤄진 브랜치 — 픽업 시 브랜치 대조(점 2). 하위호환 위해 선택
 */

/**
 * JSONL 원장을 파싱한다. 손상/스키마 위반 줄은 제외(지어내지 않음).
 * @param {string} text
 * @returns {LedgerRecord[]}
 */
export function parseLedger(text) {
  if (typeof text !== 'string' || !text.trim()) return []
  return text.split(/\r?\n/).filter(line => line.trim()).flatMap(line => {
    try {
      const record = JSON.parse(line)
      const valid = record?.schemaVersion === 1
        && typeof record.featureId === 'string' && FEAT_ID_ONE.test(record.featureId)
        && typeof record.ticketKey === 'string' && record.ticketKey.trim().length > 0
        && typeof record.contentHash === 'string' && record.contentHash.length > 0
        && typeof record.createdAt === 'string'
      return valid ? [record] : []
    } catch {
      return []
    }
  })
}

/**
 * append-only 원장을 featureId별 최신 상태로 접는다(뒤 항목이 이김).
 * @param {LedgerRecord[]} entries
 * @returns {Map<string, LedgerRecord>}
 */
export function ledgerState(entries) {
  const map = new Map()
  for (const entry of entries) map.set(entry.featureId, entry)
  return map
}

/**
 * append할 원장 줄을 직렬화한다(파일쓰기는 호출자 몫 — confirm 뒤 O_APPEND).
 * @param {Omit<LedgerRecord, 'schemaVersion'>} record
 * @returns {string}
 */
export function serializeLedgerRecord(record) {
  return `${JSON.stringify({schemaVersion: 1, ...record})}\n`
}
