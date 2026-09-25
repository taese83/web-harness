// verdict-record-lib.mjs — 검증 에이전트가 **스스로 낸** 판정을 하네스가 기록하고, 릴리스 게이트가 QA 보고서와 대조한다.
//
// QA 보고서(`_workspace/04_qa/qa-*.md`)는 검증 에이전트가 돌려준 본문을 오케스트레이터가 옮겨 적는다. 도구 검사는 영수증으로
// 대조되지만 판단 판정(보안·UX·데이터 접근 등)은 옮겨 적는 쪽이 PASS를 지어내도 잡을 곳이 없었다. 그래서 서브에이전트가
// 끝날 때(SubagentStop — 런타임이 최종 응답 `last_assistant_message`를 준다) 그 응답의 `## Result`를 증거 폴더에 남긴다.
// 증거 폴더는 Write/Edit로 쓸 수 없다(`enforce-release-gate.mjs`) — 기록은 훅만 쓴다.
import {appendFileSync, existsSync, mkdirSync, readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {join} from 'node:path'

export const VERDICTS_RELATIVE = '_workspace/04_qa/evidence/verdicts'

// 검증 에이전트 → 그 에이전트가 판정을 내는 QA 보고서 id(`release-report-policy.mjs`의 id와 같다).
export const VERDICT_REPORT_BY_AGENT = {
  'code-reviewer': 'code',
  'ux-validator': 'ux',
  'integration-verifier': 'integration',
  'security-reviewer': 'security',
  'api-contract-verifier': 'api-contract',
  'browser-verifier': 'browser',
  'data-access-verifier': 'data-access',
  'state-invariant-verifier': 'state',
  'data-quality-verifier': 'data-quality',
  'analytics-verifier': 'analytics',
  'visual-regression-verifier': 'visual',
  'performance-verifier': 'performance',
  'seo-verifier': 'seo',
  'timeseries-verifier': 'timeseries',
  'next-contract-verifier': 'next-contract',
}

// 검증 에이전트 대신 스크립트가 보고서를 쓰고 판정을 기록하는 보고서 — 스크립트 이름 → 보고서 id.
export const VERDICT_REPORT_BY_SCRIPT = {
  'report-test-qa': 'test',
}

const KNOWN = new Set(['PASS', 'WARN', 'FAIL', 'BLOCKED', 'NEEDS_REVIEW'])
/**
 * 응답의 `## Result` 다음 줄 상태(순수). 없거나 모르는 값이면 null.
 * 줄 전체가 상태가 아니어도(`PASS — 경고 2건`) 첫 단어가 알려진 상태면 그것이 판정이다 — 기록 쪽 정규화일 뿐 대조 기준은 그대로다.
 * 알려진 상태가 둘 이상 나오면(양식 줄 `PASS | FAIL | BLOCKED`를 그대로 옮긴 응답) 판정이 아니다 — 첫 단어로 추정하지 않는다.
 */
export const parseVerdictStatus = text => {
  const match = String(text ?? '').match(/^## Result\s*\r?\n\s*([^\r\n]+)$/im)
  if (!match) return null
  const line = match[1].replace(/[`*_]/g, '').trim().toUpperCase()
  if (new Set(line.match(/\b(?:PASS|WARN|FAIL|BLOCKED|NEEDS_REVIEW)\b/g) ?? []).size > 1) return null
  const status = line.match(/^[A-Z_]+/)?.[0] ?? null
  return KNOWN.has(status) ? status : null
}

/** 기록 한 줄을 남긴다. 판정 id가 없는 에이전트·상태를 읽지 못한 응답도 남긴다(판정 없음도 사실이다). */
export function recordVerdict(projectRoot, {agentName, agentId = null, message, at = new Date().toISOString()}) {
  const reportId = VERDICT_REPORT_BY_AGENT[agentName]
  if (!reportId) return null
  const record = {reportId, agent: agentName, agentId, status: parseVerdictStatus(message),
    digest: createHash('sha256').update(String(message ?? '')).digest('hex'), at}
  const directory = join(projectRoot, VERDICTS_RELATIVE)
  mkdirSync(directory, {recursive: true})
  appendFileSync(join(directory, `${reportId}.jsonl`), `${JSON.stringify(record)}\n`)
  return record
}

/**
 * 스크립트가 영수증에서 계산한 판정을 기록한다(report-test-qa). 보고서를 스크립트가 쓰므로 옮겨 적는 단계가 없지만,
 * 기록을 남겨야 손으로 고친 보고서를 릴리스 게이트가 같은 대조로 잡는다.
 */
export function recordScriptVerdict(projectRoot, {reportId, script, status, report, at = new Date().toISOString()}) {
  const record = {reportId, agent: `script:${script}`, agentId: null, status,
    digest: createHash('sha256').update(String(report ?? '')).digest('hex'), at}
  const directory = join(projectRoot, VERDICTS_RELATIVE)
  mkdirSync(directory, {recursive: true})
  appendFileSync(join(directory, `${reportId}.jsonl`), `${JSON.stringify(record)}\n`)
  return record
}

const latestRecord = (projectRoot, reportId) => {
  const path = join(projectRoot, VERDICTS_RELATIVE, `${reportId}.jsonl`)
  if (!existsSync(path)) return null
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(lines[index]) } catch { /* 깨진 줄은 건너뛴다 — 앞선 온전한 기록으로 판정한다 */ }
  }
  return null
}

/**
 * QA 보고서 판정이 검증 에이전트가 낸 판정과 같은가.
 * 기록 폴더가 없으면 이 프로젝트에서 기록이 한 번도 돈 적이 없는 것이다(훅 미배선·옛 판본) — 막지 않고 `bound: false`.
 * 폴더가 있는데 그 보고서의 기록이 없거나 상태가 다르면 오류다 — 검증 에이전트 없이 쓴 보고서이거나 옮겨 적으며 바뀐 판정이다.
 * @returns {{bound: boolean, error?: string, recorded?: object}}
 */
export function checkVerdictBinding(projectRoot, reportId, reportStatus, reportSource = null) {
  if (!existsSync(join(projectRoot, VERDICTS_RELATIVE))) return {bound: false}
  const recorded = latestRecord(projectRoot, reportId)
  if (!recorded) return {bound: true, error: `검증 에이전트의 판정 기록이 없다(${VERDICTS_RELATIVE}/${reportId}.jsonl) — 검증 에이전트 없이 쓴 보고서다`}
  if (recorded.status !== reportStatus) {
    return {bound: true, recorded, error: `보고서 판정(${reportStatus})이 검증 에이전트 ${recorded.agent}의 판정(${recorded.status ?? '없음'})과 다르다`}
  }
  // 스크립트가 쓴 보고서는 보고서 자체의 digest를 기록한다 — 판정 줄을 안 건드린 편집도 잡는다.
  if (String(recorded.agent ?? '').startsWith('script:') && reportSource !== null
    && recorded.digest !== createHash('sha256').update(String(reportSource)).digest('hex')) {
    return {bound: true, recorded, error: `${recorded.agent}가 쓴 보고서가 그 뒤에 바뀌었다 — 스크립트를 다시 돌린다`}
  }
  return {bound: true, recorded}
}
