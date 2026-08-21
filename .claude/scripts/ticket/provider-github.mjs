// 팀 워크플로우 통합 — GitHub Issues provider (gh CLI, 통합 빌드 3단계).
// docs/team-workflow-integration-design.md 공유 척추의 첫 구체 provider. Jira MCP 대신
// gh CLI를 쓴다(이미 있음 → 대화형 인증 부재 리스크 없음, PR↔이슈 네이티브 링킹).
//
// 이 모듈은 **순수 부분만** 담는다 — 이슈 필드 빌드(발행 payload)와 왕복 파싱(이슈 본문 → refs).
// 실제 gh 실행(issue create/list/edit)은 side-effect이므로 confirm 게이트를 통과한 runner의
// 몫이며, 여기서는 실행하지 않는다(child_process import 없음). runner는 아래 buildIssueFields의
// 결과로 `gh issue create`를 구성하고, listExistingIssues의 결과로 claim 경쟁을 검사한다.

import {buildRefsMarker, parseIssueRefs} from './refs.mjs'

const unique = values => [...new Set(values)]

// 왕복 마커(빌드/파싱)는 트래커 무관 모듈 refs.mjs 소유다(I3 — provider 인터페이스 뒤
// 격리). 이 파일은 그것을 소비만 한다. parseIssueRefs는 하위 호환으로 재노출한다.
export {parseIssueRefs}

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
  const refsMarker = buildRefsMarker(featureIds, testCaseIds)
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
 * computeCloseLink 결과(트래커 무관)를 **GitHub 서식** PR 본문 줄로 렌더한다. 순수.
 * close/relate 키워드는 GitHub 전용이므로 이 provider 파일이 소유한다(I3 — 순수 코어 pr.mjs에
 * 유출 금지). 안전 하한(I6):
 *  - verified(원장 소유 확인) → `Closes #N`(머지 시 자동 닫힘 허용)
 *  - unverified(원장 미기록)  → `Relates to #N` non-closing 참조 + **가시** 경고(자동 닫힘 안 함)
 *  - mismatch(CLOSE_TARGET_MISMATCH) → 링크 생략 + 가시 사유(침묵 fail-closed 방지)
 * @param {{ok: boolean, closes?: string, verified?: boolean, error?: string, warning?: string}} closeLink
 * @returns {string|null}  PR 본문에 넣을 줄(없으면 null)
 */
export function renderCloseReference(closeLink) {
  if (!closeLink?.ok) {
    if (closeLink?.error === 'CLOSE_TARGET_MISMATCH') {
      return `> ⚠️ 자동 닫힘 링크 생략 — 대상 불일치(${closeLink.warning ?? ''})`
    }
    return null
  }
  if (closeLink.verified) return `Closes #${closeLink.closes}`
  return `Relates to #${closeLink.closes}\n\n> ⚠️ 이 이슈 소유가 원장에서 미확인 — 자동 닫힘하지 않음(확인 후 Closes로 승격)`
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

/**
 * `gh issue list --json number,title,url`의 stdout(JSON 배열)을 파싱한다. 순수.
 * 손상/비배열은 빈 배열로 안전 처리(지어내지 않음).
 * @param {string} stdout
 * @returns {Array<{number: number, title: string, url: string}>}
 */
export function parseIssueListJson(stdout) {
  try {
    const parsed = JSON.parse(stdout)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(item => item && Number.isInteger(item.number))
  } catch {
    return []
  }
}

/**
 * `gh issue create`가 마지막 줄에 출력하는 이슈 URL에서 번호를 뽑는다. 순수.
 * @param {string} stdout
 * @returns {{number: number, url: string}|null}
 */
export function parseCreatedIssueUrl(stdout) {
  const match = String(stdout).match(/(https?:\/\/[^\s]*\/issues\/(\d+))\s*$/m)
  return match ? {number: Number(match[2]), url: match[1]} : null
}
