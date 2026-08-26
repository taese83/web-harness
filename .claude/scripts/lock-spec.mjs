#!/usr/bin/env node
// lock-spec.mjs — 개발 착수 전 구현 스팩을 확정·잠근다 (Stage 1).
//
// solution-design.md의 `web-harness:solution-design` 블록을 읽어 검증하고, 그것이 유래한
// 입력들의 해시를 함께 묶어 spec-lock을 stdout으로 낸다. 오케스트레이터가 stdout을 그대로
// `_workspace/03_dev/spec-lock.json`에 저장한다 — project-profile.json·web-execution-plan.json과
// 같은 관례다. 어떤 에이전트도 이 파일을 소유하지 않으므로 구현 에이전트의 스팩 자기수정이
// **Edit/Write 채널에서** 차단된다 — 차단의 실체는 ORCHESTRATOR_AUTHORED_ARTIFACTS(비강제
// 명세)가 아니라 enforce-agent-ownership의 default-deny다. Bash 채널과 메인 스레드는 훅 밖이며
// 이는 protected-core에 기등록된 한계다.
//
// 왜 잠그는가: 협업 때문이다. 여러 사람이 같은 스팩에 맞춰 개발하려면 그 스팩이 개발 중에
// 흔들리지 않아야 한다. 모델 능력이 좋아져도 이 필요는 사라지지 않는다 — 능력 보상형
// 스캐폴딩이 아니라 협업 계약형이다.
//
// 잠금 거부 조건(fail-closed):
//   · 결정 블록 부재·중복·JSON 오류
//   · 스키마 위반
//   · **status: "open"인 미결정이 하나라도 있음** — 스팩 확정이 착수 전제다
//
// 잠금은 하되 라벨로 표기하는 것(이진 거부가 아님):
//   · 수용 기준 부재(`acceptanceSource: "absent"`) → `specTier: "unverifiable"`
//     설계는 확정됐으나 그것이 맞는지 판정할 기준이 없다는 뜻이다. 잠금 자체는 유효하다 —
//     기획 없는 브라운필드 개선을 막지 않으면서 그 상태를 숨기지도 않는다.
//     이 tier를 게이트가 어떻게 다룰지는 Stage 2의 결정이며 여기서 정하지 않는다.
import {createHash} from 'node:crypto'
import {existsSync, readFileSync, statSync} from 'node:fs'
import {isAbsolute, join, relative, resolve, sep} from 'node:path'

const BLOCK = /```json\s+web-harness:solution-design\s*\n([\s\S]*?)\n```/g

// 잠금이 유래한 입력. 없으면 없다고 기록한다 — 부재도 잠금의 일부다.
// 한계(적대 리뷰 2026-08-26): flat 경로 고정이라 하네스가 허용하는 sharded 형태
// (api-schema/INDEX.md 등)를 포섭하지 못한다. sharded 프로젝트에서는 실제 입력이
// present:false로 기록돼 변경이 staleness에 안 잡힌다 — Stage 2에서 stale 게이트가 생기면
// fail-open 방향이다. §4 등록, 해소는 Stage 2 전제조건.
export const LOCK_INPUTS = [
  '_workspace/01_plan/feature-plan.md',
  '_workspace/01_plan/tech-stack.md',
  '_workspace/01_plan/project-profile.json',
  '_workspace/02_design/api-schema.md',
  '_workspace/02_design/component-spec.md',
  '_workspace/02_design/state-contract.md',
  '_workspace/02_design/integration-overlay.json',
  '_workspace/02_design/solution-design.md',
]

export class LockError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.code = code
    this.details = details
  }
}

const sha256 = value => createHash('sha256').update(value).digest('hex')

const requireNonEmptyString = (value, code, message) => {
  if (typeof value !== 'string' || value.trim() === '') throw new LockError(code, message)
  return value
}


// 결정 블록을 뽑는다. 0개도 2개 이상도 거부한다 — 어느 것이 정본인지 모호해선 안 된다.
export const extractDecisionBlock = markdown => {
  const matches = [...String(markdown).matchAll(BLOCK)]
  if (matches.length === 0) {
    throw new LockError('DECISION_BLOCK_MISSING', 'solution-design.md에 web-harness:solution-design 블록이 없다')
  }
  if (matches.length > 1) {
    throw new LockError('DECISION_BLOCK_AMBIGUOUS', `결정 블록이 ${matches.length}개다 — 정본이 하나여야 한다`, {count: matches.length})
  }
  try {
    return JSON.parse(matches[0][1])
  } catch (error) {
    throw new LockError('DECISION_BLOCK_INVALID_JSON', `결정 블록이 유효한 JSON이 아니다: ${error.message}`)
  }
}

// 미결정 정리. open이 하나라도 남아 있으면 잠그지 않는다.
export const settleDecisions = openDecisions => {
  const list = Array.isArray(openDecisions) ? openDecisions : []
  const open = list.filter(item => (item?.status ?? 'open') === 'open')
  if (open.length > 0) {
    throw new LockError(
      'SPEC_NOT_SETTLED',
      `확정되지 않은 결정 ${open.length}건이 있다 — 개발 착수 전에 확정하거나 ASSUMPTION으로 기록해야 잠글 수 있다`,
      {open: open.map(item => item?.id ?? '(id 없음)')},
    )
  }
  return list.map(item => {
    // 스키마 required와 결속한다 — 이전 구현은 {status}만 있는 항목을 통과시켜
    // JSON.stringify가 undefined를 탈락시킨 결과 스키마 위반 출력을 냈다(적대 리뷰).
    requireNonEmptyString(item?.id, 'DECISION_ID_MISSING', '결정에 id가 없다')
    requireNonEmptyString(item?.question, 'DECISION_QUESTION_MISSING', `결정 ${item?.id}에 question이 없다`)
    const settled = {id: item.id, question: item.question, status: item.status}
    if (Array.isArray(item.options)) settled.options = item.options
    if (typeof item.recommended === 'string') settled.recommended = item.recommended
    return settled
  })
}

// 입력 해시. 경로 탈출을 막고, 부재는 present:false로 남긴다.
export const digestInputs = (projectRoot, inputs = LOCK_INPUTS) => {
  const root = resolve(projectRoot)
  const records = inputs.map(relativePath => {
    const candidate = resolve(root, relativePath)
    const offset = relative(root, candidate)
    if (offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)) {
      throw new LockError('LOCK_INPUT_ESCAPES_ROOT', `잠금 입력이 프로젝트 루트를 벗어난다: ${relativePath}`)
    }
    if (!existsSync(candidate) || !statSync(candidate).isFile()) {
      return {path: relativePath, present: false}
    }
    return {path: relativePath, present: true, sha256: sha256(readFileSync(candidate))}
  })
  // combined는 경로·존재여부·해시를 모두 반영한다 — 파일이 사라진 것도 변경이다.
  const combined = sha256(records.map(r => `${r.path}:${r.present ? r.sha256 : 'absent'}`).join('\n'))
  return {inputs: records, combined}
}

const FEATURE_PLAN_INPUT = '_workspace/01_plan/feature-plan.md'

export const buildSpecLock = ({decision, digest}) => {
  if (decision === null || typeof decision !== 'object' || Array.isArray(decision)) {
    throw new LockError('DECISION_BLOCK_INVALID_SHAPE', '결정 블록이 객체가 아니다')
  }
  const acceptanceSource = decision.acceptanceSource ?? 'absent'
  if (!['feature-plan', 'absent'].includes(acceptanceSource)) {
    throw new LockError('ACCEPTANCE_SOURCE_INVALID', `acceptanceSource는 feature-plan 또는 absent여야 한다: ${acceptanceSource}`)
  }
  const acceptanceRefs = Array.isArray(decision.acceptanceRefs) ? decision.acceptanceRefs : []
  // 자기 모순 차단: feature-plan이라 주장하면서 참조가 없으면 둘 중 하나가 거짓이다.
  if (acceptanceSource === 'feature-plan' && acceptanceRefs.length === 0) {
    throw new LockError('ACCEPTANCE_SOURCE_CONTRADICTS_REFS', 'acceptanceSource가 feature-plan인데 acceptanceRefs가 비어 있다')
  }
  if (acceptanceSource === 'absent' && acceptanceRefs.length > 0) {
    throw new LockError('ACCEPTANCE_SOURCE_CONTRADICTS_REFS', 'acceptanceSource가 absent인데 acceptanceRefs가 비어 있지 않다')
  }
  // 라벨을 증거에 결박한다(적대 리뷰 2026-08-26). 이전 구현은 acceptanceRefs가 비어 있지만
  // 않으면 verifiable을 부여해, feature-plan.md가 **부재해도** 임의 ID를 적으면 통과했다 —
  // protected-core §4 "골든 5/7" 행이 실측한 라벨-증거 언바인딩의 재현이다.
  // 한계(정직): 파일 실존까지만 대조한다. ref ID가 그 파일에 실제로 있는지는 미대조 — §4 TODO.
  if (acceptanceSource === 'feature-plan') {
    const featurePlan = (digest?.inputs ?? []).find(item => item.path === FEATURE_PLAN_INPUT)
    if (!featurePlan?.present) {
      throw new LockError(
        'ACCEPTANCE_SOURCE_WITHOUT_PLAN',
        `acceptanceSource가 feature-plan인데 ${FEATURE_PLAN_INPUT}이 없다 — 라벨은 증거를 요구한다`,
      )
    }
  }

  const architecture = decision.architecture ?? {}
  requireNonEmptyString(architecture.pattern, 'ARCHITECTURE_PATTERN_MISSING', 'architecture.pattern이 없다')
  requireNonEmptyString(architecture.rationale, 'ARCHITECTURE_RATIONALE_MISSING', 'architecture.rationale이 없다 — 무엇을 골랐는지만으로는 잠글 수 없다')

  const libraries = decision.libraries ?? {}
  for (const [role, entry] of Object.entries(libraries)) {
    requireNonEmptyString(entry?.choice, 'LIBRARY_CHOICE_MISSING', `libraries.${role}.choice가 없다`)
    if (!['measured', 'measured-absent', 'proposed'].includes(entry?.source)) {
      throw new LockError('LIBRARY_SOURCE_INVALID', `libraries.${role}.source는 measured|measured-absent|proposed여야 한다`)
    }
  }

  return {
    schemaVersion: 1,
    specTier: acceptanceSource === 'feature-plan' ? 'verifiable' : 'unverifiable',
    acceptanceSource,
    acceptanceRefs,
    architecture: {pattern: architecture.pattern, rationale: architecture.rationale},
    layerMap: decision.layerMap ?? {},
    libraries,
    moduleBoundaries: Array.isArray(decision.moduleBoundaries) ? decision.moduleBoundaries : [],
    nonGoals: Array.isArray(decision.nonGoals) ? decision.nonGoals : [],
    decisions: settleDecisions(decision.openDecisions),
    sourceDigest: digest,
  }
}

// 잠금이 유래한 입력이 그 뒤로 바뀌었는지 판정한다. Stage 2의 게이트가 소비할 지점이다.
export const isSpecLockStale = (specLock, projectRoot) =>
  digestInputs(projectRoot).combined !== specLock?.sourceDigest?.combined

export const lockSpec = projectRoot => {
  const root = resolve(projectRoot)
  const designPath = join(root, '_workspace/02_design/solution-design.md')
  if (!existsSync(designPath)) {
    throw new LockError('SOLUTION_DESIGN_MISSING', 'solution-design.md가 없다 — 설계 단계를 먼저 실행하라', {path: designPath})
  }
  const decision = extractDecisionBlock(readFileSync(designPath, 'utf8'))
  return buildSpecLock({decision, digest: digestInputs(root)})
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2)
  const rootIndex = argv.indexOf('--project-root')
  const projectRoot = rootIndex >= 0 ? argv[rootIndex + 1] : undefined
  if (!projectRoot) {
    process.stderr.write('사용법: node .claude/scripts/lock-spec.mjs --project-root <path>\n')
    process.exit(2)
  }
  try {
    process.stdout.write(`${JSON.stringify(lockSpec(projectRoot), null, 2)}\n`)
  } catch (error) {
    const payload = error instanceof LockError
      ? {ok: false, error: {code: error.code, message: error.message, details: error.details}}
      : {ok: false, error: {code: 'LOCK_FAILED', message: error.message, details: {}}}
    // 오류는 stderr로 낸다 — stdout은 "그대로 저장" 관례라 오류 객체가 잠금으로 위장될 수 있다.
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`)
    process.exit(1)
  }
}
