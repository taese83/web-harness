// readiness.mjs — 되돌림을 **계획을 고칠 사람에게** 돌려보내는 코멘트(순수, 트래커 무관).
//
// **되돌아가는 길이 게이트보다 먼저다.** 길 없이 픽업만 막으면 개발자가 막히고 거기서 끝난다 —
// 개발자 터미널에서 끝난 되돌림은 계획을 고칠 사람이 모른다.
//
// FEAT 개발 티켓 본문의 「채울 자리」 체크리스트와 그 판정(`parseReadiness`)은 FEAT 픽업 경로와 함께
// 제거됐다(2026-09-14). WORK 티켓 본문에는 그 절이 없다 — 되돌림 사유는 계획·원장 판정에서 온다.
const FALLBACK_LANG = 'en'

// ── 되돌림을 기획자에게 알린다 ────────────────────────────────────────────────
// 개발자 터미널에서 끝나면 기획자는 막힌 사실을 모른다. 사유 문구도 선언 언어를 따른다.
const REASONS = {
  ko: {
    // 계획을 고칠 사람이 봐야 하는 것만 넣는다 — 배정 경합·인젝션처럼 기획 쪽에 할 일이 없는
    // 사유는 null이라 티켓이 소음으로 차지 않는다.
    'stale-plan': '발행 뒤 WORK 계획이 바뀌었다 — 바뀐 안을 다시 검토·발행해야 착수할 수 있다',
    'decision-unresolved': '이 작업에 아직 닫히지 않은 결정이 있다(디자인 조건·계약 선택)',
    'dependency-incomplete': '선행 작업이 아직 머지로 끝나지 않았다 — 그 위에서 개발하면 재작업이 된다',
    'no-acceptance': '이 작업에 수용 기준(TC 또는 checks)이 하나도 없다 — 무엇으로 끝났다고 할지가 없다',
    'work-not-registered': '이 티켓이 원장에 등록된 WORK가 아니다 — 계획에서 발행된 티켓인지 확인해야 한다',
    'feature-decomposed-pick-work': '이 FEAT는 WORK로 분해됐다 — FEAT 티켓이 아니라 해당 WORK 티켓을 집어야 한다',
    'work-marker-missing': '이 티켓은 원장에 WORK로 발행됐는데 본문의 WORK 마커가 지워졌다 — 본문을 복구해야 착수할 수 있다',
  },
  en: {
    'stale-plan': 'the WORK plan changed after publishing — review and publish the new plan before starting',
    'decision-unresolved': 'this work still has an open decision (design condition or contract choice)',
    'dependency-incomplete': 'a prerequisite work is not merged yet — building on it now means rework',
    'no-acceptance': 'this work has no acceptance criteria at all (no TC, no checks)',
    'work-not-registered': 'this ticket is not a WORK registered in the ledger — check it came from the plan',
    'feature-decomposed-pick-work': 'this FEAT is decomposed into WORK — pick the WORK ticket, not the FEAT ticket',
    'work-marker-missing': 'the ledger published this ticket as WORK but its WORK marker was removed — restore the body before starting',
  },
}
const COMMENT = {
  ko: {lead: '개발 착수가 되돌아갔습니다 — 계획·발행 쪽에서 해결해야 진행됩니다.', reason: '사유', target: '대상',
    detail: '상세', tail: '해결한 뒤 개발자가 다시 픽업합니다. 이 코멘트는 하네스가 남깁니다.'},
  en: {lead: 'Pickup was sent back — the plan or its publishing needs attention before development starts.', reason: 'Reason',
    target: 'Target', detail: 'Detail', tail: 'Once resolved, the developer picks this up again. Posted by web-harness.'},
}

/**
 * 되돌림 코멘트(순수). 기획자가 할 일이 없는 되돌림이면 `null` — 티켓이 소음으로 차면
 * 아무도 읽지 않게 되고 그러면 이 경로 자체가 죽는다.
 * @param {{featureId?, reason, detail?, outputLanguage?}} args
 */
export function bounceComment({featureId = null, reason, detail = null, outputLanguage = null} = {}) {
  const requested = String(outputLanguage ?? '').trim()
  const lang = Object.prototype.hasOwnProperty.call(REASONS, requested) ? requested : FALLBACK_LANG
  const reasons = REASONS[lang] ?? REASONS[FALLBACK_LANG]
  const copy = COMMENT[lang] ?? COMMENT[FALLBACK_LANG]
  if (!Object.prototype.hasOwnProperty.call(reasons, reason)) return null
  return [
    // 기계 마커 — 중복 코멘트를 나중에 걷어내려면 **그때** 근거가 있어야 한다(§4 등록).
    `<!-- web-harness:bounce reason=${reason}${featureId ? ` feat=${featureId}` : ''} -->`,
    copy.lead,
    '',
    `- ${copy.reason}: ${reasons[reason]} (\`${reason}\`)`,
    ...(featureId ? [`- ${copy.target}: \`${featureId}\``] : []),
    ...(detail ? [`- ${copy.detail}: ${detail}`] : []),
    '',
    copy.tail,
  ].join('\n')
}
