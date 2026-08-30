// 팀 워크플로우 통합 — feature-plan 마크다운 → 티켓 unit 파서 (순수, 증분 2).
// 콘솔 인덱서의 전체 파서(테이블·서브피처·PAGE 참조)와 달리, 티켓 파이프라인이 필요한
// 최소만 뽑는다: FEAT 헤딩 섹션 → {featureId, title, body, testCaseIds, type}.
//
// 규율: **지어내지 않는다** — FEAT 스탬프가 있는 헤딩 섹션만 unit이 되고, TC는 그 섹션 안의
// 규격 ID(TC-NNN-N)만 수집한다. 같은 FEAT 헤딩이 두 번 나오면 **합치지 않고 두 unit으로**
// 반환한다 — 하류 computeEmitPlan의 DUPLICATE_FEATURE_ID loud-fail이 상류 결함을 표면화하는
// 기존 게이트이므로, 파서가 병합으로 그것을 가리면 안 된다.
// body는 섹션 원문(trim)이라 결정적 — unitContentHash(청구 형상 대조)의 입력으로 안전하다.

// **커버리지 한계(정직 표기, 리뷰 2026-08-24)**: 이 파서는 FEAT **헤딩** 형식만 지원한다.
// 표(feature-list 테이블) 형식 계획은 unit 0개가 나온다 — 그 상태로 emit에 들어가면 close-all
// 방향이므로 computeEmitPlan의 EMPTY_UNITS_CLOSE_ALL loud 가드가 막는다(침묵 폐기 방지).
// body는 섹션 원문 그대로 해시 입력이라 공백·소제목 등 사소 편집에도 contentHash가 변해
// stale/update가 과발화할 수 있다 — 방향은 보수적(재확인 유도)이라 안전하나 노이즈 비용 있음.
// 서브피처 헤딩(FEAT-NNN-NN)은 부정 선독으로 배제한다 — 안 하면 부모 ID 절단+제목 오염으로
// **오수집**된다(FEAT-001-01 → featureId=FEAT-001, title="01 …"). 과소(미수집) 방향이 정직.
const FEAT_HEADING = /^#{1,6}\s+(FEAT-\d{3,})(?!-\d)\s*(?:[-—:]\s*)?(.*)$/

// 병렬 안전성 선언. `claim-scope`의 의존·충돌 판정은 `dependsOn`·`paths`를 읽는데 **파서가
// 그 필드를 만든 적이 없어서**, 두 판정이 처음부터 한 번도 발화하지 않았다(2026-08-30 실측:
// track 14단위 전부 `paths: undefined` → 충돌 검사 0건, `dependsOn: undefined` → 의존 강등
// 0건. 그 사이 설계 문서는 "FEAT-006이 FEAT-004/005를 필요로 한다"고 산문으로 적어뒀다).
// 순수 함수에는 회귀가 있는데 그것을 먹이는 배선이 없던, §4에 등록된 그 클래스다.
//
//   <!-- web-harness:unit feat=FEAT-006 dependsOn=FEAT-004,FEAT-005 paths=src/widgets/track-canvas/ -->
//
// **미선언과 "없음"을 구분한다.** 속성이 없으면 필드도 `undefined`로 남긴다 — 빈 배열로
// 채우면 "선언 안 함"이 "의존 없음"으로 읽혀 하류가 조용히 통과시킨다. 명시적 없음은
// `dependsOn=none`이다. 이 구분이 없으면 산문에만 있는 순서가 pickupable로 둔갑한다.
const UNIT_MARKER = /<!--\s*web-harness:unit\s+([^>]*?)-->/g
const NONE_VALUES = new Set(['none', '없음', '-'])
// 값은 쉼표 뒤 공백을 허용한다 — `dependsOn=FEAT-004, FEAT-005`가 사람이 가장 자연스럽게 쓰는
// 형태인데, 공백에서 끊으면 **두 번째 의존이 조용히 사라진다**(적대 리뷰 2026-08-30: 마커를
// 썼는데도 미머지 선행 위에서 착수 가능해진다 — 이 게이트가 닫으려던 바로 그 시나리오).
const ATTRIBUTE = /([a-zA-Z][\w-]*)=((?:[^\s,]+)(?:\s*,\s*[^\s,]+)*)/g

// 마커가 둘 이상이면 **미선언으로 강등한다.** 첫 매칭이 조용히 이기면 낡은 마커 아래 정정
// 마커를 둔 계획에서 낡은 쪽이 이긴다. 같은 파일이 "파서가 병합으로 loud를 가리면 안 된다"를
// 이미 천명하고 있고(중복 FEAT 헤딩), 마커 중복에도 같은 규율을 적용한다.
const parseMarkerAttributes = source => {
  const markers = [...String(source ?? '').matchAll(UNIT_MARKER)]
  if (markers.length === 0) return {ok: true, attributes: {}}
  if (markers.length > 1) return {ok: false, reason: `unit 마커가 ${markers.length}개다 — 정본이 하나여야 한다`}
  const body = markers[0][1]
  const attributes = {}
  for (const [, key, value] of body.matchAll(ATTRIBUTE)) attributes[key] = value
  // key=value로 읽히지 않은 잔여 토큰이 있으면 **조용히 버리지 않는다** — 값이 잘려나간
  // 조각일 수 있고, 그 침묵이 곧 의존 삭제다.
  const consumed = body.replace(ATTRIBUTE, ' ').trim()
  if (consumed) return {ok: false, reason: `마커에서 읽지 못한 토큰: ${consumed}`}
  return {ok: true, attributes}
}

// `a, b` → ['a','b'] · `none` → [] · 없음 → undefined(미선언)
const parseList = value => {
  if (value === undefined) return undefined
  if (NONE_VALUES.has(value.trim().toLowerCase())) return []
  return value.split(',').map(entry => entry.trim()).filter(Boolean)
}

/** FEAT 섹션 본문에서 병렬 안전성 선언을 뽑는다(순수). 미선언 필드는 담지 않는다. */
export function parseUnitDeclaration(body, featureId) {
  const parsed = parseMarkerAttributes(body)
  // 읽을 수 없는 마커는 **미선언**이다(하류가 deps-undeclared로 막는다) + 사유를 싣는다.
  if (!parsed.ok) return {declarationError: parsed.reason}
  const attributes = parsed.attributes
  // 마커의 feat이 섹션과 다르면 남의 선언이다 — 지어내지 않고 미선언으로 둔다.
  if (attributes.feat && attributes.feat !== featureId) return {}
  const declaration = {}
  const dependsOn = parseList(attributes.dependsOn)
  const paths = parseList(attributes.paths)
  if (dependsOn !== undefined) declaration.dependsOn = dependsOn
  if (paths !== undefined) declaration.paths = paths
  // **`layer`는 마커에서 받지 않는다.** foundation은 `claimScopeReadiness`에서 무조건
  // pickupable이라, 자기선언을 허용하면 deps-undeclared로 막힌 팀에게 가장 싼 우회가
  // "전 유닛에 layer=foundation 찍기"가 된다(적대 리뷰 2026-08-30). 계층은 운영자가 주는
  // `--foundation-roots`와 실제 경로에서 도출한다 — 계획 문서의 자기신고가 아니다.
  return declaration
}

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
      ...parseUnitDeclaration(body, current.featureId),
    })
    current = null
  }
  for (const line of lines) {
    const match = line.match(FEAT_HEADING)
    if (match) {
      // 같은 FEAT ID의 헤딩이 열린 섹션 안에서 다시 나오면(예: "#### FEAT-012 Sub Features")
      // 새 unit이 아니라 그 섹션의 소제목이다 — 흡수한다(실측: search-portal 샤드에서 중복
      // unit 3건 발생). 다른 FEAT를 사이에 둔 재등장은 여전히 별개 unit → 하류 DUPLICATE loud.
      if (current && match[1] === current.featureId) {
        current.bodyLines.push(line)
        continue
      }
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
