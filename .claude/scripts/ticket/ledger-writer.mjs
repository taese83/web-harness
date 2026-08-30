// 팀 워크플로우 통합 — 식별자 원장 실파일 I/O (append-only writer).
// ledger.mjs는 순수(파싱/직렬화)이고, 이 모듈이 side-effect 경계다 — 실제 파일 append.
// 안전 append는 공유 `evidence-log-lib`(appendEvidenceLine)가 정본 — O_APPEND|O_CREAT|O_WRONLY|
// O_NOFOLLOW(POSIX)·0o600·1MB cap. 기존 줄을 재작성하지 않는다(append-only). confirm 게이트를
// 통과한 실행부가 쓴다. 도메인 스키마 검증(왕복 parseLedger)만 이 파일이 validate 훅으로 얹는다.
//
// tamper 성격(protected-core.md §4 "티켓 식별자 원장" 등록): append-only는 tamper-evident이지
// tamper-proof가 아니다 — 파일 삭제 후 재구성하면 청구 이력을 위조할 수 있다(실해소는 commit-anchor
// 몫). 분산 티켓 원장은 resume-manifest/plan-delta처럼 "증거를 변경 대상 바깥에" 둘 외부 앵커가
// 없어 **명시적 리스크 인수**를 택한다(로컬 신뢰 모델). 최초-digest 가드(재청구 거부 = detectRebind)는
// 실행부 writer 소비자가 생길 때 배선한다(§4). 멱등은 writer가 아니라 caller(원장-우선 가드)의 몫이다.
import {existsSync, readFileSync} from 'node:fs'
import {parseLedger, ledgerState, serializeLedgerRecord} from './ledger.mjs'
import {appendEvidenceLine, detectRebind} from '../evidence-log-lib.mjs'

/** 원장 파일을 읽어 파싱한다(없으면 빈 배열). 판독은 도메인 파서(parseLedger — 스키마 검증)라
 * 공유 readEvidenceLog가 아니라 이것을 쓴다(altitude: 안전 append는 공유, 스키마 파싱은 로컬). */
export function readLedger(path) {
  if (!existsSync(path)) return []
  return parseLedger(readFileSync(path, 'utf8'))
}

/** 원장 파일을 읽어 featureId별 최신 상태 Map으로 접는다. */
export function readLedgerState(path) {
  return ledgerState(readLedger(path))
}

/**
 * 원장 레코드를 append-only로 기록한다(side-effect). record는 schemaVersion 없는 필드셋
 * (serializeLedgerRecord가 붙인다). 기록 전 왕복 검증: 직렬화→parseLedger가 정확히 1건을
 * 되돌려야 한다(파서가 조용히 버릴 줄을 쓰지 않음 — 정직).
 * @param {string} path
 * @param {Omit<import('./ledger.mjs').LedgerRecord, 'schemaVersion'>} record
 * @returns {typeof record}
 */
export function appendLedgerRecord(path, record) {
  // 안전 append는 공유 evidence-log(O_APPEND|O_NOFOLLOW·0o600·1MB cap). 도메인 검증(왕복
  // parseLedger)은 validate 훅으로 넘긴다 — 파서가 조용히 버릴 줄을 쓰지 않게(정직).
  appendEvidenceLine(path, serializeLedgerRecord(record), {
    validate: line => {
      if (parseLedger(line).length !== 1) {
        throw new Error('LEDGER_INVALID_RECORD: 원장 스키마를 만족하지 않는 레코드')
      }
    },
  })
  return record
}

/**
 * **청구(create) 전용** 가드 append — §4 "티켓 식별자 원장" 행의 최초-digest 가드(detectRebind)
 * 배선(executor CLI가 첫 writer 소비자가 되는 시점). 같은 FEAT의 최초 청구 contentHash와 다른
 * 해시로 재청구를 시도하면 REBIND_REFUSED loud 거부 — 재청구 위조·계획 변경 후 무단 재바인드를
 * within-file 수준에서 막는다(파일 통삭제 재구성은 여전히 못 잡음 — tamper-evident 한계는 §4
 * 그대로). 계획 변경의 정당한 갱신·prUrl 링크는 appendLedgerRecord(비가드)를 쓰되 emit update
 * 경로/링크 멱등 판정을 거친다(경로 분리가 곧 계약).
 */
/**
 * **대체 발행 기록**(append-only). 같은 featureId를 새 ticketKey·새 contentHash로 다시
 * 기록한다 — `appendClaimRecord`의 rebind 가드가 정확히 막던 그 형태다. 가드의 목적은
 * "조용한 재바인드 금지"이지 "재바인드 금지"가 아니었고(에러 문구가 스스로 "재청구는 emit
 * update 경로로"라 적고 있다), 그 경로가 배선되지 않아 계획이 바뀌면 티켓이 영원히 낡은 채
 * 남았다(2026-08-30 실측).
 *
 * 조용하지 않게 만드는 것이 조건이다: `supersedes`(옛 ticketKey)가 **필수**이며, 그것이
 * 원장에 남아 "무엇을 무엇으로 대체했는지"가 히스토리에 보인다. 없으면 거부한다 —
 * 근거 없는 재바인드는 여전히 막는다.
 */
export function appendSupersedeRecord(path, record) {
  if (record?.supersedes === undefined || record.supersedes === null || record.supersedes === '') {
    throw new Error(`LEDGER_SUPERSEDE_WITHOUT_PRIOR: ${record?.featureId} — 무엇을 대체하는지(supersedes) 없이 재바인드할 수 없다`)
  }
  if (String(record.supersedes) === String(record.ticketKey)) {
    throw new Error(`LEDGER_SUPERSEDE_SELF: ${record.featureId} — 자기 자신을 대체할 수 없다`)
  }
  return appendLedgerRecord(path, record)
}

export function appendClaimRecord(path, record) {
  const rebind = detectRebind(readLedger(path), record.contentHash, {
    digestField: 'contentHash',
    key: {field: 'featureId', value: record.featureId},
  })
  if (rebind) {
    throw new Error(`LEDGER_REBIND_REFUSED: ${record.featureId} 최초 청구 digest와 불일치(최초 ${rebind.firstDigest.slice(0, 12)}… ≠ 현재 ${rebind.currentDigest.slice(0, 12)}…) — 재청구는 emit update 경로로`)
  }
  return appendLedgerRecord(path, record)
}
