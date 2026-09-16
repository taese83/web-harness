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
    'stale-plan': '티켓을 만든 뒤 계획이 바뀌었습니다. 바뀐 계획을 검토하고 다시 발행하면 착수할 수 있습니다.',
    'decision-unresolved': '아직 정해지지 않은 결정이 남아 있습니다. 그 결정을 먼저 내려야 합니다.',
    'dependency-incomplete': '먼저 끝나야 할 작업이 아직 머지되지 않았습니다. 그 작업이 끝나면 이어서 진행합니다.',
    'no-acceptance': '무엇이 되면 끝인지가 이 작업에 적혀 있지 않습니다. 완료 조건을 정해 주세요.',
    'work-not-registered': '이 티켓은 하네스가 만든 작업 티켓이 아닙니다. 계획에서 발행한 티켓인지 확인해 주세요.',
    'feature-decomposed-pick-work': '이 기능은 여러 작업으로 나뉘었습니다. 이 티켓 대신 나뉜 작업 티켓을 집어야 합니다.',
    'ticket-needs-planning': '개발을 시작하기 전에 정해야 할 것이 있습니다. 아래 항목을 정해 티켓에 적어 주세요.',
    'ticket-needs-design': '개발을 시작하기 전에 화면 모양이 정해져야 합니다. 아래 화면을 디자인해 주세요.',
    'ticket-undecidable': '지금 티켓 내용만으로는 개발을 시작할 수 있는지 판단할 수 없습니다. 아래 내용을 보태 주세요.',
    'ticket-additions-too-large': '티켓에 새로 더한 내용이 한 작업으로 보기에 너무 많습니다. 계획에서 작업을 나눠 주세요.',
    'ticket-diverges-from-plan': '계획이 정한 완료 조건이나 테스트 항목이 티켓에서 지워지거나 바뀌었습니다. 계획을 고쳐 다시 발행하거나 티켓 내용을 되돌려 주세요.',
    'work-marker-missing': '하네스가 이 티켓에 남긴 표시가 지워졌습니다. 티켓 내용을 되돌려야 착수할 수 있습니다.',
  },
  en: {
    'stale-plan': 'the WORK plan changed after publishing — review it again and run `claim --publish --confirm` to sync the ticket before starting',
    'decision-unresolved': 'this work still has an open decision (design condition or contract choice)',
    'dependency-incomplete': 'a prerequisite work is not merged yet — building on it now means rework',
    'no-acceptance': 'this work has no acceptance criteria at all (no TC, no checks)',
    'work-not-registered': 'this ticket is not a WORK registered in the ledger — check it came from the plan',
    'feature-decomposed-pick-work': 'this FEAT is decomposed into WORK — pick the WORK ticket, not the FEAT ticket',
    'ticket-needs-planning': 'this development ticket needs planning before work starts — decide the items below and update the ticket',
    'ticket-needs-design': 'this development ticket needs design before work starts — define how the screens/states below look',
    'ticket-undecidable': 'this development ticket cannot be assessed with the current information — resolve the reasons below',
    'ticket-additions-too-large': 'too many or too long items were added to the ticket — put them in the plan as work',
    'ticket-diverges-from-plan': 'a plan acceptance criterion or test item was removed or changed in the ticket description — update the plan (review and publish) or restore the description',
    'work-marker-missing': 'the ledger published this ticket as WORK but its WORK marker was removed — restore the body before starting',
  },
}
/**
 * 트래커에 남기는 코멘트의 언어(순수). **프로젝트 선언(`outputLanguage`)이 우선**이고, 없으면 그 티켓·작업 글의
 * 언어를 따른다(한글이 있으면 ko) — 둘 다 모르면 기본값(en). 한국어로 쓴 티켓에 영어 코멘트가 붙던 것을 고친다.
 * @param {{declared?: string|null, text?: string|null}} args
 */
export function resolveCommentLanguage({declared = null, text = null} = {}) {
  const value = String(declared ?? '').trim()
  if (Object.prototype.hasOwnProperty.call(COMMENT, value)) return value
  // 마커·주석은 언어 표지가 아니다 — 사람이 쓴 글만 본다.
  const prose = String(text ?? '').replace(/<!--[\s\S]*?-->/g, '')
  return /[\uAC00-\uD7A3]/.test(prose) ? 'ko' : FALLBACK_LANG
}

const COMMENT = {
  ko: {lead: '개발을 시작하지 못하고 되돌아왔습니다. 아래를 해결해 주세요.', reason: '이유', target: '대상',
    detail: '필요한 것', tail: '해결되면 개발자가 다시 가져갑니다. 이 코멘트는 web-harness가 자동으로 남깁니다.'},
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
