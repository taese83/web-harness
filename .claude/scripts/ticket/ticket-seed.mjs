// ticket-seed.mjs — `create`가 만든 티켓에 **초안 판정을 미리 두고**, `pickup`이 그 판정이 아직 유효한지 기계로 잰다.
//
// 초안 에이전트(system-architect 티켓 초안 모드)는 이미 요청·코드·스팩을 대조했다. 만들고 바로 집는 흔한 경우에 판정 에이전트를
// 한 번 더 부르면 같은 대조를 되풀이한다. 그래서 초안 판정을 판정서 자리에 두고 **만든 시점의 지문**을 따로 남긴다:
//   - 트래커가 돌려준 티켓 본문 지문(사람이 트래커에서 고쳤는가)
//   - 스팩 digest(소유 경계·결정이 바뀌었는가)
//   - 수정 범위(writePaths) 아래 파일 지문(그 코드가 바뀌었는가)
// 하나라도 다르거나 셀 수 없으면 미리 둔 판정을 버리고 판정 에이전트를 부른다(fail-closed). 형식 검증(validateTicketAssessment)은
// 어느 경로든 그대로다 — 달라지는 것은 판정을 쓴 시점뿐이다. 지문 기록(`.seed.json`)은 CLI만 쓴다(에이전트 소유 패턴은 `<키>.json`뿐).
import {createHash} from 'node:crypto'
import {existsSync, lstatSync, readdirSync, readFileSync} from 'node:fs'
import {join, relative, resolve, sep} from 'node:path'
import {assessmentDigest, TICKET_ASSESSMENTS_DIR, testItemPrefix, ticketBodyDigest} from './ticket-work.mjs'

const list = value => (Array.isArray(value) ? value : [])
const safeKey = ticketKey => String(ticketKey).replace(/[^A-Za-z0-9_-]/g, '_')
const MAX_FILES = 5000
const MAX_BYTES = 64 * 1024 * 1024
const SKIP_DIRS = new Set(['node_modules', '.git'])

/** 초안 판정 파일(초안 옆) — `ticket-drafts/<이름>.md` → `ticket-drafts/<이름>.assessments.json`. */
export const draftAssessmentsPath = draftPath => String(draftPath).replace(/\.md$/, '.assessments.json')
/** 만든 시점의 지문 기록(로컬, CLI만 쓴다). */
export const seedPath = ticketKey => `${TICKET_ASSESSMENTS_DIR}/${safeKey(ticketKey)}.seed.json`
/** 초안 판정의 테스트 항목 자리표시 — 티켓 키를 모를 때 쓴다. 만든 뒤 `TT-<키>-<n>`으로 바꾼다. */
export const DRAFT_TEST_ITEM = /^TT-DRAFT-(\d+)$/

/**
 * 수정 범위 아래 파일 지문. 경로마다 `경로\0내용 sha256`을 정렬해 잇는다. 없는 경로는 「없음」으로 센다.
 * 너무 크거나 심볼릭 링크가 있거나 프로젝트 밖이면 null — 셀 수 없는 것을 「같다」로 읽지 않는다.
 */
export function writePathsFingerprint(root, writePaths) {
  const base = resolve(root)
  const entries = []
  let bytes = 0
  const visit = absolute => {
    const offset = relative(base, absolute)
    if (offset === '..' || offset.startsWith(`..${sep}`)) return false
    if (!existsSync(absolute)) { entries.push(`${offset}\0missing`); return true }
    const stats = lstatSync(absolute)
    if (stats.isSymbolicLink()) return false
    if (stats.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) {
        if (SKIP_DIRS.has(name)) continue
        if (!visit(join(absolute, name))) return false
      }
      return true
    }
    if (!stats.isFile()) return false
    bytes += stats.size
    if (entries.length >= MAX_FILES || bytes > MAX_BYTES) return false
    entries.push(`${offset}\0${createHash('sha256').update(readFileSync(absolute)).digest('hex')}`)
    return true
  }
  for (const raw of list(writePaths)) {
    // 글롭 꼬리(`/**`·`/*`)와 `./` 접두는 소유권 훅과 같게 벗긴다 — 그 아래 전부가 범위다.
    const path = String(raw).replace(/^\.\//, '').replace(/\/\*\*?$/, '').replace(/\/$/, '')
    if (!path || /[*?[\]{}]/.test(path)) return null
    if (!visit(resolve(base, path))) return null
  }
  return createHash('sha256').update([...new Set(entries)].sort().join('\n')).digest('hex')
}

/** 초안 판정 → 이 티켓의 판정서(순수). 티켓 키를 채우고 `TT-DRAFT-n`을 `TT-<키>-n`으로 바꾼다. */
export function seededAssessment({draftAssessment, ticketKey, provider}) {
  const prefix = testItemPrefix(ticketKey)
  return {...draftAssessment, schemaVersion: 1, ticket: {key: String(ticketKey), provider},
    testItems: list(draftAssessment?.testItems).map(item => {
      const match = String(item?.id ?? '').match(DRAFT_TEST_ITEM)
      return match ? {...item, id: `${prefix}${match[1]}`} : item
    })}
}

/** 만든 시점의 지문(순수 입력 + 파일 지문). */
export function buildSeed({root, ticketKey, provider, body, spec, assessment}) {
  return {schemaVersion: 1, ticketKey: String(ticketKey), provider, assessmentDigest: assessmentDigest(assessment), bodyDigest: ticketBodyDigest(body ?? ''),
    specDigest: spec?.digest ?? null, writePathsFingerprint: writePathsFingerprint(root, assessment?.writePaths),
    seededAt: new Date().toISOString()}
}

/** 지문 기록이 이 판정서의 것인가 — 판정 에이전트가 판정서를 새로 썼으면 미리 둔 판정이 아니다(지문 기록은 무관하다). */
export const seedMatches = (seed, assessment) => Boolean(seed && assessment && seed.assessmentDigest === assessmentDigest(assessment))

/**
 * 미리 둔 판정이 아직 유효한가. 어긋난 지문 이름 목록을 돌려준다 — 비었으면 유효하다.
 * 스팩 digest나 파일 지문을 모르면(null) 어긋난 것으로 센다.
 */
export function staleSeedReasons({root, seed, assessment, body, spec}) {
  const reasons = []
  if (!seed || seed.schemaVersion !== 1) return ['seed-unreadable']
  if (seed.bodyDigest !== ticketBodyDigest(body ?? '')) reasons.push('ticket-body-changed')
  if (!seed.specDigest || seed.specDigest !== (spec?.digest ?? null)) reasons.push('spec-changed')
  const now = writePathsFingerprint(root, assessment?.writePaths)
  if (!seed.writePathsFingerprint || !now || seed.writePathsFingerprint !== now) reasons.push('write-paths-changed')
  return reasons
}
