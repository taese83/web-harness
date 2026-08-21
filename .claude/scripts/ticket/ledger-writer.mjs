// 팀 워크플로우 통합 — 식별자 원장 실파일 I/O (append-only writer).
// ledger.mjs는 순수(파싱/직렬화)이고, 이 모듈이 side-effect 경계다 — 실제 파일 append.
// console tc-runs.jsonl과 같은 안전 관용구: O_APPEND|O_CREAT|O_WRONLY|O_NOFOLLOW, 0o600,
// 크기 상한. 기존 줄을 재작성하지 않는다(append-only). confirm 게이트를 통과한 실행부가 쓴다.
//
// tamper 성격(protected-core.md §4 "티켓 식별자 원장" 등록): append-only는 tamper-evident이지
// tamper-proof가 아니다 — 파일 삭제 후 재구성하면 청구 이력을 위조할 수 있다. 분산 티켓 원장은
// resume-manifest/plan-delta처럼 "증거를 변경 대상 바깥에" 둘 외부 앵커가 없어, 여기서는
// **명시적 리스크 인수**를 택한다(로컬 신뢰 모델). 대신 append-only·심볼릭링크 거부·크기 상한으로
// 우발적 손상과 링크 공격은 막는다. 멱등은 writer가 아니라 caller(원장-우선 가드)의 몫이다.
import {closeSync, constants as C, existsSync, fstatSync, mkdirSync, openSync, readFileSync, writeSync} from 'node:fs'
import {dirname} from 'node:path'
import {parseLedger, ledgerState, serializeLedgerRecord} from './ledger.mjs'

const MAX_LEDGER_BYTES = 1024 * 1024

/** 원장 파일을 읽어 파싱한다(없으면 빈 배열). */
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
  const line = serializeLedgerRecord(record)
  if (parseLedger(line).length !== 1) {
    throw new Error('LEDGER_INVALID_RECORD: 원장 스키마를 만족하지 않는 레코드')
  }
  mkdirSync(dirname(path), {recursive: true})
  let fd = null
  try {
    fd = openSync(path, C.O_APPEND | C.O_CREAT | C.O_WRONLY | C.O_NOFOLLOW, 0o600)
    if (fstatSync(fd).size > MAX_LEDGER_BYTES) {
      throw new Error('LEDGER_FULL: 원장이 1MB를 초과함')
    }
    writeSync(fd, line, null, 'utf8')
  } finally {
    if (fd != null) closeSync(fd)
  }
  return record
}
