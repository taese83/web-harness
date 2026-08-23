// 공통 evidence-log — append-only 원장의 두 직교 관용구를 한 곳에 모은다.
// protected-core.md §4의 tamper 클래스 4행(.plan-locks·.plan-snapshots·티켓 ledger·구현
// receipt)이 각자 재발명하던 것을 추출한다. 각 소비처는 반쪽씩만 갖고 있었다:
//   - .plan-locks / .plan-snapshots: 최초-digest 가드 ✓, 안전 append(O_NOFOLLOW·cap) ✗
//   - 티켓 ledger: 안전 append ✓, 최초-digest 가드 ✗(미배선)
// 이 모듈은 두 primitive를 **직교**하게 제공해, 소비처가 없는 절반을 채우게 한다.
//
// tamper 성격(§4 유지): append-only는 tamper-evident이지 tamper-proof가 아니다 —
// 원장을 통째로 지우면 최초 기록이 사라져 위조가 성립한다. 이 모듈은 그 한계를 없애지
// 않는다(그건 commit-anchor 등 외부 앵커의 몫). 없앤 것은 "관용구를 네 번 재발명"과
// "소비처마다 반쪽만 구현"이다. 우발적 손상·무한 성장은 막고, **POSIX에서는** 최종
// 컴포넌트 심볼릭링크도 거부한다(O_NOFOLLOW — win32는 이 플래그가 없어 no-op, 아래 주석).
import {closeSync, constants as C, existsSync, fstatSync, mkdirSync, openSync, readFileSync, writeSync} from 'node:fs'
import {dirname} from 'node:path'

export const DEFAULT_MAX_LEDGER_BYTES = 1024 * 1024

/**
 * 안전 관용구로 한 줄(JSON)을 append-only 기록한다.
 * O_APPEND|O_CREAT|O_WRONLY|O_NOFOLLOW, 0o600, 크기 상한, 부모 디렉터리 생성.
 * 기존 줄을 재작성하지 않는다. record는 객체(여기서 JSON+개행으로 직렬화)이거나
 * 이미 개행으로 끝나는 문자열이다. validate가 주어지면 직렬화 결과를 그 함수로 검사한다
 * (예: parseLedger 왕복 — 파서가 조용히 버릴 줄을 쓰지 않게).
 * @param {string} path
 * @param {object|string} record
 * @param {{maxBytes?: number, validate?: (line: string) => void}} [opts]
 */
export function appendEvidenceLine(path, record, opts = {}) {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_LEDGER_BYTES
  const line = typeof record === 'string'
    ? (record.endsWith('\n') ? record : `${record}\n`)
    : `${JSON.stringify(record)}\n`
  if (opts.validate) opts.validate(line)
  mkdirSync(dirname(path), {recursive: true})
  let fd = null
  try {
    // O_NOFOLLOW는 win32에 없다(undefined). `?? 0`으로 명시 — POSIX 심층방어, Windows no-op.
    // (repo 관용구: artifact-inventory-lib.mjs 등과 동일.)
    fd = openSync(path, C.O_APPEND | C.O_CREAT | C.O_WRONLY | (C.O_NOFOLLOW ?? 0), 0o600)
    if (fstatSync(fd).size > maxBytes) {
      throw new Error(`EVIDENCE_LOG_FULL: 원장이 ${maxBytes}B를 초과함: ${path}`)
    }
    writeSync(fd, line, null, 'utf8')
  } finally {
    if (fd != null) closeSync(fd)
  }
  return record
}

/**
 * 원장 파일을 줄 단위로 읽어 파싱한다(없으면 빈 배열). 빈 줄은 건너뛰고,
 * JSON.parse 실패 줄은 keepCorrupt가 참이면 {__corrupt: raw}로, 아니면 건너뛴다.
 * 도메인별 파서(parseLedger 등)가 따로 있으면 이 함수 대신 그것을 쓴다 —
 * 이 함수는 최초-digest 가드에 필요한 최소 판독만 제공한다.
 * @param {string} path
 * @param {{keepCorrupt?: boolean}} [opts]
 * @returns {object[]}
 */
export function readEvidenceLog(path, opts = {}) {
  if (!existsSync(path)) return []
  const rows = []
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    if (raw.trim() === '') continue
    try {
      rows.push(JSON.parse(raw))
    } catch {
      if (opts.keepCorrupt) rows.push({__corrupt: raw})
    }
  }
  return rows
}

/**
 * 최초-digest 가드(순수). 원장의 **최초** 관련 기록의 digest가 현재 digest와 다르면
 * 재바인딩(re-lock/re-snapshot)이 일어난 것이다. key가 주어지면 같은 key의 기록만 본다
 * (예: 같은 task·changeId). digestField로 각 기록에서 digest를 뽑는다.
 *
 * 반환: null(위반 없음 — 최초 기록이 없거나 현재와 일치) 또는
 *   {firstDigest, currentDigest} (재바인딩 실측 — 최초 ≠ 현재).
 * @param {object[]} rows readEvidenceLog 결과(또는 도메인 파서 결과)
 * @param {string} currentDigest
 * @param {{digestField?: string, key?: {field: string, value: unknown}}} [opts]
 */
export function detectRebind(rows, currentDigest, opts = {}) {
  const digestField = opts.digestField ?? 'digest'
  const relevant = opts.key
    ? rows.filter(r => (r?.[opts.key.field] ?? null) === opts.key.value)
    : rows
  if (relevant.length === 0) return null
  const firstDigest = relevant[0]?.[digestField]
  if (typeof firstDigest !== 'string') return null
  return firstDigest === currentDigest ? null : {firstDigest, currentDigest}
}
