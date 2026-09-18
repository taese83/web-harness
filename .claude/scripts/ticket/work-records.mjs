// work-records.mjs — 개발자가 남기는 작업 기록(PR 연결·완료 회수)을 **티켓 코멘트**로 쓰고 읽는다(순수).
//
// 원장(git)에 두면 개발자 커밋마다 하네스 기록이 섞이고, 머지 전까지 다른 클론이 보지 못한다. 티켓 코멘트는 모든 클론이
// 바로 보고, 작성자·시각이 트래커 이력에 남는다. 사람이 읽는 한 줄 + 기계가 읽는 마커로 쓴다.
// 완료는 기록하지 않는다 — 연결한 PR의 머지·머지된 커밋·트래커의 끝남에서 그때그때 계산한다.

const LINK = 'web-harness:link'
const REOPEN = 'web-harness:reopen'
const FIELD = (name, text) => text.match(new RegExp(`\\b${name}=(\\S+)`))?.[1] ?? null
const nothing = value => (value === null || value === '-' ? null : value)

/** 값에 공백·마커 끝이 들어가면 마커가 끊긴다 — 쓰지 않는다. */
const safe = value => {
  const text = String(value ?? '-')
  if (/\s|-->/.test(text)) throw new Error(`INVALID_RECORD_FIELD: 공백이나 -->가 기록 마커를 끊는다 — ${text}`)
  return text
}

/**
 * PR 연결 기록(순수) — `link`가 완료 조건을 재고 남긴다. 인수(`--accept-*`)로 넘긴 것도 적는다(나중에 왜 통과했는지).
 * revision: 대조한 티켓 개정(어느 개정을 보고 개발했는가) — 트래커가 정한 문자열이라 인코딩해 싣는다.
 * @param {{prUrl: string, baseRef: string, definitionDigest?: string|null, revision?: string|null, accepted?: string[], summary?: string|null, lang?: string}} args
 */
export function renderLinkRecord({prUrl, baseRef, definitionDigest = null, revision = null, accepted = [], summary = null, lang = 'ko'}) {
  const rev = revision === null || revision === undefined ? '-' : encodeURIComponent(String(revision))
  const marker = `<!-- ${LINK} pr=${safe(prUrl)} base=${safe(baseRef)} def=${safe(definitionDigest ?? '-')} rev=${safe(rev)} accepted=${safe(accepted.length ? accepted.join(',') : '-')} -->`
  const line = lang === 'en'
    ? `Linked PR ${prUrl} (expected base: ${baseRef})${summary ? ` — ${summary}` : ''}${accepted.length ? ` · accepted: ${accepted.join(', ')}` : ''}. Posted by web-harness.`
    : `PR을 연결했습니다: ${prUrl} (기대 base: ${baseRef})${summary ? ` — ${summary}` : ''}${accepted.length ? ` · 인수: ${accepted.join(', ')}` : ''}. 이 코멘트는 하네스가 남깁니다.`
  return `${marker}\n${line}`
}

/** 완료 회수 기록(순수) — 머지를 되돌렸을 때. 이 시각 뒤의 근거만 완료로 센다. */
export function renderReopenRecord({prUrl = null, reason, lang = 'ko'}) {
  const marker = `<!-- ${REOPEN} pr=${safe(prUrl ?? '-')} -->`
  const line = lang === 'en' ? `Completion withdrawn: ${reason}. Posted by web-harness.` : `완료를 거뒀습니다: ${reason}. 이 코멘트는 하네스가 남깁니다.`
  return `${marker}\n${line}`
}

/**
 * 티켓 코멘트에서 작업 기록을 읽는다(순수). 시각은 트래커가 붙인 코멘트 작성 시각이다(쓴 사람이 정하지 않는다).
 * @param {{body?: string, created?: string, author?: string}[]|null} comments
 * @returns {{link: object|null, reopen: object|null, links: object[], reopens: object[]}} link·reopen은 가장 최근 것
 */
export function parseWorkRecords(comments) {
  const links = []
  const reopens = []
  for (const comment of Array.isArray(comments) ? comments : []) {
    // 트래커가 작성자를 저장소 밖 사람이라고 알려 준 코멘트는 기록으로 세지 않는다(GitHub 공개 저장소). 모르면(Jira) 센다.
    if (comment?.trusted === false) continue
    const body = String(comment?.body ?? '')
    const at = comment?.created ?? null
    for (const match of body.matchAll(/<!--\s*web-harness:(link|reopen)\b([^>]*?)-->/g)) {
      const fields = match[2]
      if (match[1] === 'link') {
        const prUrl = nothing(FIELD('pr', fields))
        const baseRef = nothing(FIELD('base', fields))
        if (!prUrl || !baseRef) continue
        const accepted = nothing(FIELD('accepted', fields))?.split(',').filter(Boolean) ?? []
        const rev = nothing(FIELD('rev', fields))
        let revision = null
        try { revision = rev === null ? null : decodeURIComponent(rev) } catch { revision = null }
        links.push({prUrl, baseRef, definitionDigest: nothing(FIELD('def', fields)), revision, accepted, at, author: comment?.author ?? null,
          acceptedIncomplete: accepted.includes('incomplete'), acceptedUnverifiedScope: accepted.includes('unverified-scope')})
      } else {
        reopens.push({prUrl: nothing(FIELD('pr', fields)), at, author: comment?.author ?? null})
      }
    }
  }
  const latest = list => list.filter(item => Number.isFinite(Date.parse(item.at))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null
  return {link: latest(links), reopen: latest(reopens), links, reopens}
}
