// readiness.mjs — 준비 안 된 티켓을 **기획자에게 되돌리는 길**(순수, 트래커 무관).
//
// 계기(2026-09-09 코드 대조): `normalize.mjs`가 `specCompleteness`를 "개발 진입 준비도"라
// 부르고 주석에 **"pickup(단계 3)이 이 판정으로 되돌림 여부를 결정한다"**고 적어뒀는데,
// `pickup.mjs`는 그 필드를 한 번도 읽지 않는다. `provider-github.mjs`의 발행 본문도
// "(연결된 TC 없음 — 스펙 미완, **pickup에서 되돌림 대상**)"이라 적는다. 약속이 둘인데
// 배선이 없다 — I1 문제다.
//
// **그런데 게이트를 먼저 세우면 안 된다.** 되돌아가는 길이 없는 채로 픽업만 막으면
// **개발자가 막히고 거기서 끝난다** — 기획자는 막힌 사실을 모른다. 그래서 이 모듈이 먼저다:
//   ① 발행 본문에 **기획자가 채울 자리**를 체크박스로 남긴다(티켓이 곧 질문지다)
//   ② 되돌림이 일어나면 **그 티켓에 코멘트로** 무엇이 비었는지 남긴다
// 두 방향 다 기획자가 이미 쓰는 도구(트래커) 안에서 끝난다 — 새 도구를 배우지 않는다.
//
// **한계**: 체크박스의 **존재**만 다룬다. 채워진 내용이 옳은지는 보지 않으며, 체크만 하고
// 내용을 안 적어도 형식은 통과한다(§4 등록 대상). 그것은 사람이 보는 몫이다.

/** 어휘 → 기획자가 읽는 말. 하네스 내부 이름을 그대로 티켓에 내보내지 않는다. */
const LABELS = {
  behavior: '이 기능이 무엇을 하는지 — 화면에서 사용자가 겪는 동작으로',
  acceptanceCriteria: '무엇이 되면 완료인지 — 확인 가능한 문장으로',
  testCaseIds: '연결된 테스트 케이스(TC) — 기획의 TC 번호',
}

/** 기획자가 채울 자리인가. 하네스가 채우는 것은 여기 넣지 않는다 — 물어봐야 답이 나오는 것만. */
export const plannerOwned = key => Object.prototype.hasOwnProperty.call(LABELS, key)

export const readinessLabel = key => LABELS[key] ?? key

/**
 * 발행 본문에 넣을 「기획자가 채울 것」 절(순수). 빈 배열이면 `null` — 절 자체를 넣지 않는다.
 * 체크박스로 두는 이유: 기획자가 트래커에서 그 자리에 바로 쓰고 체크한다. 별도 도구가 없다.
 * @param {string[]} missing  `specCompleteness.missing`
 * @returns {string[]|null}   본문에 이어 붙일 줄들
 */
export function plannerChecklist(missing) {
  const items = (missing ?? []).filter(plannerOwned)
  if (items.length === 0) return null
  return [
    '',
    '## 기획자가 채울 것',
    '아래가 비어 있으면 개발이 착수할 수 없다. 이 자리에 직접 적고 체크한다.',
    ...items.map(key => `- [ ] **${key}** — ${readinessLabel(key)}`),
  ]
}

/**
 * 되돌림이 났을 때 **티켓에 남길 코멘트**(순수). 개발자 터미널에만 뜨면 기획자는 모른다.
 * @param {{featureId?: string, reason: string, missing?: string[], detail?: string}} args
 * @returns {string|null}  기획자가 할 일이 없는 되돌림이면 `null`(코멘트하지 않는다)
 */
export function bounceComment({featureId = null, reason, missing = [], detail = null}) {
  const items = (missing ?? []).filter(plannerOwned)
  // **기획자가 고칠 수 있는 사유만** 여기 있다. 범위 되돌림(의존 미선언·경로 충돌 등)도
  // 구제책이 「계획을 고친다」라서 포함한다 — 실측(2026-08-30) 되돌림의 큰 부류가 이쪽이었고,
  // 넣지 않으면 「되돌아가는 길」이 두 사유에만 닿는다(적대 리뷰 2026-09-09).
  const known = {
    'spec-incomplete': '티켓이 참조하는 기획 단위(FEAT)나 테스트 케이스(TC)가 맞지 않는다',
    'unknown-feature': '티켓이 가리키는 FEAT를 현재 기획에서 찾지 못했다',
    'deps-undeclared': '이 기능의 선행 의존이 계획에 선언돼 있지 않다 — 없으면 `없음`이라고 명시해야 한다',
    'deps-incomplete': '선행 기능이 아직 끝나지 않았다',
    'path-collision': '다른 기능과 쓰기 경로가 겹친다 — 계획에서 경계를 나눠야 한다',
    'foundation-incomplete': '토대 단위가 아직 끝나지 않았다',
    // `content-incomplete`는 **아직 아무도 내지 않는다** — 본문 준비도 차단(S1)의 예약 자리다.
    // 미리 두는 이유는 차단이 붙는 순간 되돌아가는 길이 이미 있어야 하기 때문이다.
    'content-incomplete': '티켓 본문이 비어 있어 무엇을 만들지 알 수 없다',
  }
  // **기획자가 할 수 있는 일이 없으면 코멘트하지 않는다.** 배정 경합·인젝션 의심 같은 것은
  // 개발·보안 쪽 사건이고, 여기에 남기면 티켓이 소음으로 찬다.
  if (!Object.prototype.hasOwnProperty.call(known, reason)) return null
  return [
    // 기계 마커 — 지금은 아무도 읽지 않지만, 중복 코멘트를 나중에 걷어내려면 **그때**
    // 근거가 있어야 한다. 되돌림마다 코멘트가 쌓이는 것은 이 커밋이 남기는 대가다(§4 등록).
    `<!-- web-harness:bounce reason=${reason}${featureId ? ` feat=${featureId}` : ''} -->`,
    '개발 착수가 되돌아갔습니다 — 기획 쪽에서 채워야 진행됩니다.',
    '',
    `- 사유: ${known[reason]} (\`${reason}\`)`,
    ...(featureId ? [`- 대상: \`${featureId}\``] : []),
    ...(detail ? [`- 상세: ${detail}`] : []),
    ...(items.length > 0 ? ['', '채울 것:', ...items.map(key => `- [ ] **${key}** — ${readinessLabel(key)}`)] : []),
    '',
    '채운 뒤에는 개발자가 다시 픽업하면 됩니다. 이 코멘트는 하네스가 남깁니다.',
  ].join('\n')
}
