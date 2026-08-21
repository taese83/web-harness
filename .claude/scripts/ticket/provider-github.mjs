// 팀 워크플로우 통합 — GitHub Issues provider (gh CLI, 통합 빌드 3단계).
// docs/team-workflow-integration-design.md 공유 척추의 첫 구체 provider. Jira MCP 대신
// gh CLI를 쓴다(이미 있음 → 대화형 인증 부재 리스크 없음, PR↔이슈 네이티브 링킹).
//
// 이 모듈은 **순수 부분만** 담는다 — 이슈 필드 빌드(발행 payload)와 왕복 파싱(이슈 본문 → refs).
// 실제 gh 실행(issue create/list/edit)은 side-effect이므로 confirm 게이트를 통과한 runner의
// 몫이며, 여기서는 실행하지 않는다(child_process import 없음). runner는 아래 buildIssueFields의
// 결과로 `gh issue create`를 구성하고, listExistingIssues의 결과로 claim 경쟁을 검사한다.

const FEAT_ID = /\bFEAT-\d{3,}\b/g
const TC_ID = /\bTC-\d{3,}-\d+\b/g
const unique = values => [...new Set(values)]

// 하네스↔이슈 왕복 마커 — 이슈 본문에 스탬프하고 pickup이 되읽는다. 사람 눈에도 보이되
// 기계 파싱이 안정적이도록 고정 구획.
const MARKER_BEGIN = '<!-- web-harness:refs'
const MARKER_END = '-->'

// FEAT당 고유 라벨 — claim 경쟁 검사·중복 감지의 기계 키(gh issue list --label 로 조회).
export const featLabel = featureId => `feat:${featureId}`

/**
 * TicketDraft(emit.buildTicketDraft 산출) → gh issue create 필드. 순수.
 * 본문에 동작 명세 + AC(TC) + 왕복 마커(FEAT/TC)를 담고, 라벨에 FEAT 고유 라벨을 넣는다.
 * @param {Object} draft  TicketDraft {sourceKey(FEAT), title, body, acceptanceCriteria, harnessRefs}
 * @param {{assignee?: string}} [options]  assignee 미지정 시 미배정(혼자 개발/나중 분배)
 * @returns {{title: string, body: string, labels: string[], assignee: string|null}}
 */
export function buildIssueFields(draft, options = {}) {
  const featureIds = draft.harnessRefs?.featureIds ?? (draft.sourceKey ? [draft.sourceKey] : [])
  const testCaseIds = draft.harnessRefs?.testCaseIds ?? []
  const acLines = (draft.acceptanceCriteria ?? []).map(ac => `- [ ] ${ac}`).join('\n')
  const refsMarker = `${MARKER_BEGIN} feat=${featureIds.join(',')} tc=${testCaseIds.join(',')} ${MARKER_END}`
  const body = [
    draft.body ?? '',
    '',
    '## 수용 기준 (AC ↔ TC)',
    acLines || '- (연결된 TC 없음 — 스펙 미완, pickup에서 되돌림 대상)',
    '',
    refsMarker,
  ].join('\n')
  const labels = unique([...featureIds.map(featLabel)])
  return {
    title: draft.title ?? (featureIds[0] ?? 'untitled'),
    body,
    labels,
    assignee: options.assignee ?? null,
  }
}

/**
 * 이슈 본문의 왕복 마커에서 하네스 refs를 되읽는다(pickup 인바운드). 순수.
 * 마커가 없으면 본문 전체에서 형식 엄격 스캔으로 폴백(사람이 맨몸으로 만든 이슈 대응).
 * @param {string} body
 * @returns {{featureIds: string[], testCaseIds: string[]}}
 */
export function parseIssueRefs(body) {
  if (typeof body !== 'string') return {featureIds: [], testCaseIds: []}
  const markerStart = body.indexOf(MARKER_BEGIN)
  const scope = markerStart >= 0
    ? body.slice(markerStart, body.indexOf(MARKER_END, markerStart) + MARKER_END.length)
    : body
  return {
    featureIds: unique(scope.match(FEAT_ID) ?? []),
    testCaseIds: unique(scope.match(TC_ID) ?? []),
  }
}

/**
 * gh issue create 명령 인자를 구성한다(문자열 배열 — 실행은 runner). 순수.
 * 실제 실행은 confirm(=개발자의 티켓 선택 행위) 뒤 runner가 spawn한다.
 * @param {{title: string, body: string, labels: string[], assignee: string|null}} fields
 * @returns {string[]}  gh 인자 (예: ['issue','create','--title',...])
 */
export function ghCreateArgs(fields) {
  const args = ['issue', 'create', '--title', fields.title, '--body', fields.body]
  for (const label of fields.labels) args.push('--label', label)
  if (fields.assignee) args.push('--assignee', fields.assignee)
  return args
}
