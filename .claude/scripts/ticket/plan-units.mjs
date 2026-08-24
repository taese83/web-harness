// 팀 워크플로우 통합 — feature-plan 마크다운 → 티켓 unit 파서 (순수, 증분 2).
// 콘솔 인덱서의 전체 파서(테이블·서브피처·PAGE 참조)와 달리, 티켓 파이프라인이 필요한
// 최소만 뽑는다: FEAT 헤딩 섹션 → {featureId, title, body, testCaseIds, type}.
//
// 규율: **지어내지 않는다** — FEAT 스탬프가 있는 헤딩 섹션만 unit이 되고, TC는 그 섹션 안의
// 규격 ID(TC-NNN-N)만 수집한다. 같은 FEAT 헤딩이 두 번 나오면 **합치지 않고 두 unit으로**
// 반환한다 — 하류 computeEmitPlan의 DUPLICATE_FEATURE_ID loud-fail이 상류 결함을 표면화하는
// 기존 게이트이므로, 파서가 병합으로 그것을 가리면 안 된다.
// body는 섹션 원문(trim)이라 결정적 — unitContentHash(청구 형상 대조)의 입력으로 안전하다.

const FEAT_HEADING = /^#{1,6}\s+(FEAT-\d{3,})\s*(?:[-—:]\s*)?(.*)$/

/**
 * feature-plan 마크다운(단일 텍스트)에서 티켓 unit들을 뽑는다(순수). 분할(sharded) 계획이면
 * caller가 샤드들을 이 함수에 각각 돌리고 이어붙인다(파일 경계는 caller 몫 — 정직).
 * @param {string} markdown
 * @returns {Array<{featureId: string, title: string, body: string, testCaseIds: string[], type: 'feature'}>}
 */
export function parseFeaturePlanUnits(markdown) {
  if (typeof markdown !== 'string' || !markdown.trim()) return []
  const lines = markdown.split(/\r?\n/)
  const units = []
  let current = null
  const flush = () => {
    if (!current) return
    const body = current.bodyLines.join('\n').trim()
    // TC ID는 자기 FEAT 번호를 인코딩한다(TC-007-* ↔ FEAT-007) — 섹션 안에서도 자기 번호 TC만
    // 수집해, 섹션 경계 느슨함(아래)으로 인한 타 FEAT/비-FEAT 잔여 TC의 오귀속을 원천 차단한다.
    const own = current.featureId.slice('FEAT-'.length)
    const ownTc = new RegExp(`\\bTC-${own}-\\d+\\b`, 'g')
    units.push({
      featureId: current.featureId,
      title: current.title || current.featureId,
      body,
      testCaseIds: [...new Set(body.match(ownTc) ?? [])],
      type: 'feature',
    })
    current = null
  }
  for (const line of lines) {
    const match = line.match(FEAT_HEADING)
    if (match) {
      flush()
      current = {featureId: match[1], title: match[2].trim(), bodyLines: []}
      continue
    }
    // FEAT 섹션은 다음 FEAT 헤딩까지 — 상위 레벨의 비-FEAT 헤딩(## 개요 등)이 나와도 섹션을
    // 닫지 않는다(계획 문서가 FEAT 섹션 안에 소제목을 두는 형식 허용). 보수적 선택: TC 수집
    // 범위가 넓어지는 쪽이며, FEAT 경계는 FEAT 헤딩만이 정본.
    if (current) current.bodyLines.push(line)
  }
  flush()
  return units
}
