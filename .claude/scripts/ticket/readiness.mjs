// readiness.mjs — 티켓의 **채울 자리**와 되돌아가는 길(순수, 트래커 무관).
//
// 계기(2026-09-09 코드 대조): `normalize.mjs`가 `specCompleteness`를 "개발 진입 준비도"라
// 부르고 **"pickup이 이 판정으로 되돌림 여부를 결정한다"**고 적어뒀는데 `pickup.mjs`는 그
// 필드를 한 번도 읽지 않았다. 발행 본문도 "pickup에서 되돌림 대상"이라 적는다 — 약속이 둘인데
// 배선이 0이었다.
//
// **되돌아가는 길이 게이트보다 먼저다.** 길 없이 픽업만 막으면 개발자가 막히고 거기서 끝난다.
//
// ── 형태를 하나만 둔다 ────────────────────────────────────────────────────────
// **AI가 읽는 형태와 사람이 읽는 형태를 나누지 않는다.** 두 벌을 두면 어긋나고 어긋남은
// 조용하다 — 이 저장소가 한 주에 세 번 물린 클래스다(주석↔배선, 계약↔정책, 로컬↔CI).
// 보이는 본문 하나만 두고 기계가 그것을 읽는다.
//
// 기계에만 필요한 것(키·발행 시점 요구 목록)은 **숨은 마커**에 둔다. **내용은 넣지 않는다** —
// 마커에 내용이 들어가는 순간 그것이 두 번째 사본이다. 마커가 드는 것은 색인뿐이다.
//
// **요구 목록을 마커에 박는 이유**: 보이는 체크리스트에만 있으면 **줄을 지우는 것이 곧
// 통과**가 된다. 2026-09-08 조건 분모 실측에서 정확히 그 구멍을 봤다(열을 지우니 게이트가
// 아무 말도 하지 않았다). 마커와 대조하면 삭제는 통과가 아니라 **미충족**으로 읽힌다.
//
// **판정 신호는 「내용이 있는가」 하나다. 체크박스는 보지 않는다** — ① 체크만 하고 내용을
// 안 적으면 통과하는 프록시가 된다 ② Jira는 마크다운 체크박스를 렌더하지 않아 리터럴
// 텍스트로 보인다. 체크박스를 신호로 쓰면 트래커마다 판정이 갈린다. 상자는 GitHub에서
// 사람이 쓰기 편하라고 두는 장식이다.
//
// **키는 본문에 보이지 않는다.** `docs/planning-document-template.md` 부록이 못 박아뒀다 —
// "기술 표기는 하네스가 알아서 만듭니다. 따라 쓰지 마십시오." 사람은 자기 언어의 라벨만 본다.

// ── 필드 카탈로그 ─────────────────────────────────────────────────────────────
// 출처는 `docs/planning-document-template.md`다 — 기획자가 **이미 그 말로** 문서를 쓴다.
// `required`는 **조건의 이름**이지 서비스 지식이 아니다. 조건의 참·거짓은 호출자가 프로필
// 선언에서 만들어 넘긴다(I3 — 특정 서비스의 사고모델을 여기 인코딩하지 않는다).
export const FIELD_CATALOG = [
  {key: 'behavior', owner: 'planner', required: 'always'},
  // **화면이 있는 형태에서만 묻는다.** 백엔드 전용·library·CLI FEAT에 화면을 물으면 오탐이고,
  // 채울 수 없는 것을 묻는 게이트는 아무 문자나 적게 만든다(적대 리뷰 2026-09-09).
  {key: 'screens', owner: 'planner', required: 'hasUserInterface'},
  {key: 'acceptanceCriteria', owner: 'planner', required: 'always'},
  // 템플릿이 스스로 "가장 자주 빠지고 개발에서 가장 자주 문제가 되는 자리"라고 경고한다.
  {key: 'failureCriteria', owner: 'planner', required: 'always'},
  // 아래 둘은 **생산자가 아직 없다** — 조건을 만드는 호출자가 0건이라 지금은 묻지 않는다.
  // 예약 자리이며, 조건을 만들 때 그 사실을 여기 적는다.
  {key: 'cancelCriteria', owner: 'planner', required: 'reversible'},
  {key: 'designRef', owner: 'planner', required: 'designDeclared'},
  {key: 'branching', owner: 'planner', required: 'branchingDeclared'},
  // 하네스가 채운다 — 기획자에게 묻지 않는다.
  {key: 'testCaseIds', owner: 'harness', required: 'always'},
]

// 라벨은 `outputLanguage`를 따른다(`development-gates-contract.md` §Gate L — "식별자·파일
// 경로·코드·FEAT/TC ID는 그대로 두고 본문은 선언 언어로"). 문구는 기획 템플릿의 항목 이름
// 그대로다. **모르는 언어면 영어로 떨어뜨리고 그 사실을 표시한다** — 조용히 한국어를
// 내보내는 것이 최악이다.
const LABELS = {
  ko: {
    behavior: '어떻게 동작하는가',
    screens: '어느 화면에서',
    acceptanceCriteria: '무엇이 되면 완료인가 — 정상',
    failureCriteria: '안 되는 경우 무엇이 보이는가',
    cancelCriteria: '취소할 때 무엇이 되는가',
    designRef: '시안 — Figma 프레임 링크(어느 화면·어느 조건인지 한 줄)',
    branching: '분기 — 무엇을 보고 판단하고, 값마다 어디로 가는가',
    testCaseIds: '연결된 테스트 케이스',
  },
  en: {
    behavior: 'How it behaves',
    screens: 'Which screens',
    acceptanceCriteria: 'Done when — normal path',
    failureCriteria: 'What is shown when it fails',
    cancelCriteria: 'What happens on cancel',
    designRef: 'Design — Figma frame link (which screen, which condition)',
    branching: 'Branching — what decides, and where each value goes',
    testCaseIds: 'Linked test cases',
  },
}
const FALLBACK_LANG = 'en'

/** 선언 언어의 라벨 표. 없는 언어는 영어로 떨어뜨리고 `fellBack`으로 **표시한다**. */
export function resolveLabels(outputLanguage) {
  const lang = String(outputLanguage ?? '').trim()
  if (Object.prototype.hasOwnProperty.call(LABELS, lang)) return {lang, labels: LABELS[lang], fellBack: false}
  return {lang: FALLBACK_LANG, labels: LABELS[FALLBACK_LANG], fellBack: true, requested: lang || null}
}

/**
 * 이 티켓이 기획자에게 물어야 하는 필드(순수). 조건의 참·거짓은 **호출자가** 넘긴다.
 * @param {{reversible?: boolean, designDeclared?: boolean, branchingDeclared?: boolean}} conditions
 * @returns {Array<{key: string, owner: string}>}
 */
export function requiredFields(conditions = {}) {
  return FIELD_CATALOG.filter(field =>
    field.required === 'always' || conditions[field.required] === true)
}

// 마커는 `;`로 항목을, 첫 `:`로 키·라벨을 가른다 — 라벨의 `;`는 `,`로 바꿔 그 경계를 지킨다.
const safeLabel = text => String(text).replace(/;/g, ',').replace(/-->/g, '—>').trim()
const MARKER = /<!--\s*web-harness:readiness\s+([^>]*?)-->/

/** 색인 마커(순수). **내용은 절대 담지 않는다** — 담는 것은 키·라벨·언어뿐이다. */
export function readinessMarker({required, labels, lang}) {
  const pairs = required.map(field => `${field.key}:${safeLabel(labels[field.key] ?? field.key)}`)
  return `<!-- web-harness:readiness v=1 lang=${lang} required=${pairs.join(';')} -->`
}

/** 마커를 되읽는다. 없으면 `null` — "요구가 없다"와 "못 읽었다"를 구별한다. */
export function parseReadinessMarker(body) {
  const found = MARKER.exec(String(body ?? ''))
  if (!found) return null
  const attrs = Object.fromEntries([...found[1].matchAll(/(\w+)=([^\s]+(?:\s(?!\w+=)[^\s]+)*)/g)]
    .map(match => [match[1], match[2].trim()]))
  const required = String(attrs.required ?? '').split(';').filter(Boolean).map(pair => {
    const at = pair.indexOf(':')
    return at < 0 ? {key: pair, label: pair} : {key: pair.slice(0, at), label: pair.slice(at + 1)}
  })
  return {version: attrs.v ?? null, lang: attrs.lang ?? null, required}
}

/**
 * 계획 단위(TicketDraft)가 **이미 답한** 필드. 기획서에서 뽑아낸 것을 다시 묻지 않기 위해서다.
 * 여기 없는 필드는 오늘 계획 산출물에 자리가 없다는 뜻이고, 그래서 기획자에게 묻는다.
 */
export function providedByPlan(draft) {
  const given = []
  if (String(draft?.body ?? '').trim()) given.push('behavior')
  if ((draft?.acceptanceCriteria ?? []).length > 0) given.push('acceptanceCriteria')
  if ((draft?.harnessRefs?.testCaseIds ?? []).length > 0) given.push('testCaseIds')
  return given
}

// 절 제목도 선언 언어를 따른다.
const SECTION = {
  ko: {heading: '채워 주실 것', lead: '아래를 각 줄 **아래에** 적어 주십시오. 비어 있으면 개발이 착수하지 못합니다.'},
  en: {heading: 'Please fill in', lead: 'Write your answer **below** each line. Development cannot start while these are empty.'},
}

/**
 * 발행 본문의 「채워 주실 것」 절(순수). 키는 보이지 않고 라벨만 보인다.
 * @returns {string[]|null}  물을 것이 없으면 `null` — 항상 붙이면 아무도 안 읽는다.
 */
export function readinessSection({conditions = {}, outputLanguage = null, provided = []} = {}) {
  const {labels, lang, fellBack} = resolveLabels(outputLanguage)
  // **계획이 이미 준 것은 다시 묻지 않는다.** 기획서에서 뽑아낸 동작 명세·완료 기준을 빈
  // 체크박스로 또 내놓으면 기획자는 같은 것을 두 번 쓰게 되고, 그 자리가 비어 있다는 이유로
  // 착수가 막힌다 — 요구가 아니라 소음이다(자체 실측: 배선 직후 회귀 7건이 그렇게 막혔다).
  const known = new Set(provided)
  const ask = requiredFields(conditions)
    .filter(field => field.owner === 'planner' && !known.has(field.key))
  if (ask.length === 0) return null
  const copy = SECTION[lang] ?? SECTION[FALLBACK_LANG]
  return [
    '',
    `## ${copy.heading}`,
    copy.lead,
    // 선언 언어를 모르면 **영어로 냈다는 사실을 적는다** — 조용히 다른 언어를 내보내지 않는다.
    ...(fellBack ? [`(output language not declared or unsupported — labels shown in ${FALLBACK_LANG})`] : []),
    '',
    ...ask.flatMap(field => [`- [ ] ${labels[field.key] ?? field.key}`, '']),
    readinessMarker({required: ask, labels, lang}),
  ]
}

// 라벨 줄 다음부터 다음 항목 줄(또는 어떤 HTML 주석)까지가 그 항목의 **내용 자리**다.
//
// **주석에서 반드시 끊는다.** 종전에는 readiness 마커만 걸렀는데 발행 본문은 그 뒤에
// `<!-- web-harness:refs … -->`를 더 붙인다 — 마지막 항목이 그 줄을 내용으로 삼켜
// **모든 실제 티켓에서 `failureCriteria`가 「채워짐」으로 읽혔다**(적대 리뷰 2026-09-09,
// 실행으로 재현). 회귀가 못 잡은 이유는 절을 단독 문자열로만 검사했기 때문이다.
const ANY_COMMENT = /<!--/
// 항목 줄은 **형태로** 앵커한다. `includes`만 보면 기획 산문에 같은 문구가 있을 때 그 줄을
// 먼저 잡아 빈 항목이 채워진 것으로 읽힌다(같은 리뷰에서 실증 — `어느 화면에서`가 동작
// 명세 문장에 들어 있자 그 줄이 답으로 세어졌다).
const ESCAPE = /[.*+?^${}()|[\]\\]/g
const itemLineFor = label => new RegExp(`^\\s*[-*]\\s*\\[[ xX]?\\]\\s*${label.replace(ESCAPE, '\\$&')}\\s*(.*)$`)
const ITEM_ANY = /^\s*[-*]\s*\[[ xX]?\]\s/
const CONTENT_LINE = /^\s*(?:[-*]\s*)?(.*)$/

/**
 * 이슈 본문에서 준비도를 읽는다(순수). **마커가 정본**이다 — 보이는 줄이 지워졌으면
 * 「요구가 없다」가 아니라 **미충족**이다(2026-09-08 조건 분모 실측이 연 구멍).
 * 판정은 「라벨 아래에 내용이 있는가」 하나이며 체크박스는 보지 않는다.
 * @returns {{state: string, missing: Array<{key,label,reason}>, filled: string[], lang: string|null}}
 */
export function parseReadiness(body) {
  const marker = parseReadinessMarker(body)
  if (!marker) return {state: 'NO_MARKER', missing: [], filled: [], lang: null}
  // **마커 줄은 본문이 아니다.** 마커가 라벨 문자열을 담고 있어서, 빼지 않으면 보이는 줄을
  // 지워도 마커에서 찾아내 「있다」고 읽는다 — 삭제 탐지가 통째로 죽는 자리다(자체 실측).
  const lines = String(body ?? '').split('\n')
  const missing = []
  const filled = []
  for (const field of marker.required) {
    const anchor = itemLineFor(field.label)
    const at = lines.findIndex(line => anchor.test(line))
    if (at < 0) {
      // 줄이 통째로 사라졌다 — 지우는 것으로 통과할 수 없다.
      missing.push({key: field.key, label: field.label, reason: 'removed'})
      continue
    }
    const rest = []
    for (const line of lines.slice(at + 1)) {
      if (ANY_COMMENT.test(line) || ITEM_ANY.test(line)) break
      rest.push((CONTENT_LINE.exec(line) ?? [, ''])[1])
    }
    // 같은 줄의 라벨 뒤 꼬리도 내용으로 받는다 — 한 줄로 적는 사람이 있다.
    const answer = [(anchor.exec(lines[at]) ?? [, ''])[1], ...rest].join('\n').replace(/\s+/g, ' ').trim()
    if (answer === '') missing.push({key: field.key, label: field.label, reason: 'empty'})
    else filled.push(field.key)
  }
  return {state: missing.length === 0 ? 'READY' : 'INCOMPLETE', missing, filled, lang: marker.lang}
}

// ── 되돌림을 기획자에게 알린다 ────────────────────────────────────────────────
// 개발자 터미널에서 끝나면 기획자는 막힌 사실을 모른다. 사유 문구도 선언 언어를 따른다.
const REASONS = {
  ko: {
    'spec-incomplete': '티켓이 참조하는 기획 단위(FEAT)나 테스트 케이스(TC)가 맞지 않는다',
    'unknown-feature': '티켓이 가리키는 FEAT를 현재 기획에서 찾지 못했다',
    'deps-undeclared': '이 기능의 선행 의존이 계획에 선언돼 있지 않다 — 없으면 `없음`이라고 명시해야 한다',
    'deps-incomplete': '선행 기능이 아직 끝나지 않았다',
    'path-collision': '다른 기능과 쓰기 경로가 겹친다 — 계획에서 경계를 나눠야 한다',
    'foundation-incomplete': '토대 단위가 아직 끝나지 않았다',
    'content-incomplete': '티켓에 채워지지 않은 항목이 있어 무엇을 만들지 알 수 없다',
  },
  en: {
    'spec-incomplete': 'the FEAT/TC this ticket references does not match the plan',
    'unknown-feature': 'the FEAT this ticket points at is not in the current plan',
    'deps-undeclared': 'this feature declares no prerequisites — write `none` if there are none',
    'deps-incomplete': 'a prerequisite feature is not finished',
    'path-collision': 'write paths overlap another feature — the plan must split the boundary',
    'foundation-incomplete': 'a foundation unit is not finished',
    'content-incomplete': 'the ticket has unfilled items, so what to build is unknown',
  },
}
const COMMENT = {
  ko: {lead: '개발 착수가 되돌아갔습니다 — 기획 쪽에서 채워야 진행됩니다.', reason: '사유', target: '대상',
    detail: '상세', fill: '채울 것:', tail: '채운 뒤에는 개발자가 다시 픽업하면 됩니다. 이 코멘트는 하네스가 남깁니다.'},
  en: {lead: 'Pickup was sent back — planning input is needed before development starts.', reason: 'Reason',
    target: 'Target', detail: 'Detail', fill: 'To fill in:', tail: 'Once filled, the developer can pick this up again. Posted by web-harness.'},
}

/**
 * 되돌림 코멘트(순수). 기획자가 할 일이 없는 되돌림이면 `null` — 티켓이 소음으로 차면
 * 아무도 읽지 않게 되고 그러면 이 경로 자체가 죽는다.
 * @param {{featureId?, reason, missing?: Array<{key,label}>|string[], detail?, outputLanguage?}} args
 */
export function bounceComment({featureId = null, reason, missing = [], detail = null, outputLanguage = null} = {}) {
  const {lang} = resolveLabels(outputLanguage)
  const reasons = REASONS[lang] ?? REASONS[FALLBACK_LANG]
  const copy = COMMENT[lang] ?? COMMENT[FALLBACK_LANG]
  if (!Object.prototype.hasOwnProperty.call(reasons, reason)) return null
  const items = (missing ?? []).map(item => (typeof item === 'string' ? item : item?.label ?? item?.key)).filter(Boolean)
  return [
    // 기계 마커 — 중복 코멘트를 나중에 걷어내려면 **그때** 근거가 있어야 한다(§4 등록).
    `<!-- web-harness:bounce reason=${reason}${featureId ? ` feat=${featureId}` : ''} -->`,
    copy.lead,
    '',
    `- ${copy.reason}: ${reasons[reason]} (\`${reason}\`)`,
    ...(featureId ? [`- ${copy.target}: \`${featureId}\``] : []),
    ...(detail ? [`- ${copy.detail}: ${detail}`] : []),
    ...(items.length > 0 ? ['', copy.fill, ...items.map(label => `- [ ] ${label}`)] : []),
    '',
    copy.tail,
  ].join('\n')
}
