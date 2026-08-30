#!/usr/bin/env node
// spec.mjs — 개발 착수 전 구현 스팩을 확정·확정한다 (Stage 1).
//
// solution-design.md의 `web-harness:solution-design` 블록을 읽어 검증하고, 그것이 유래한
// 입력들의 해시를 함께 묶어 spec-lock을 stdout으로 낸다. 오케스트레이터가 stdout을 그대로
// `_workspace/03_dev/spec.json`에 저장한다 — project-profile.json·web-execution-plan.json과
// 같은 관례다. 어떤 에이전트도 이 파일을 소유하지 않으므로 구현 에이전트의 스팩 자기수정이
// **Edit/Write 채널에서** 차단된다 — 차단의 실체는 ORCHESTRATOR_AUTHORED_ARTIFACTS(비강제
// 명세)가 아니라 enforce-agent-ownership의 default-deny다. Bash 채널과 메인 스레드는 훅 밖이며
// 이는 protected-core에 기등록된 한계다.
//
// 왜 확정하는가: 협업 때문이다. 여러 사람이 같은 스팩에 맞춰 개발하려면 그 스팩이 개발 중에
// 흔들리지 않아야 한다. 모델 능력이 좋아져도 이 필요는 사라지지 않는다 — 능력 보상형
// 스캐폴딩이 아니라 협업 계약형이다.
//
// 확정 거부 조건(fail-closed):
//   · 결정 블록 부재·중복·JSON 오류
//   · 스키마 위반
//   · **status: "open"인 미결정이 하나라도 있음** — 스팩 확정이 착수 전제다
//
// 스팩은 하되 라벨로 표기하는 것(이진 거부가 아님):
//   · 수용 기준 부재(`acceptanceSource: "absent"`) → `specTier: "unverifiable"`
//     설계는 확정됐으나 그것이 맞는지 판정할 기준이 없다는 뜻이다. 스팩 확정 자체는 유효하다 —
//     기획 없는 브라운필드 개선을 막지 않으면서 그 상태를 숨기지도 않는다.
//     이 tier를 게이트가 어떻게 다룰지는 Stage 2의 결정이며 여기서 정하지 않는다.
import {createHash} from 'node:crypto'
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs'
import {isAbsolute, join, relative, resolve, sep} from 'node:path'
import {appendEvidenceLine, readEvidenceLog} from './evidence-log-lib.mjs'
import {pathToFileURL} from 'node:url'
import {readShapeChecks} from './validate-shape-checks.mjs'

const BLOCK = /```json\s+web-harness:solution-design\s*\n([\s\S]*?)\n```/g

// 스팩이 유래한 입력. 없으면 없다고 기록한다 — 부재도 스팩의 일부다.
// flat·sharded 양쪽을 해소한다(2026-08-30). 종전에는 flat 경로 고정이라 하네스가 허용하는
// sharded 형태(`feature-plan/INDEX.md` 등)를 못 봤고, sharded 프로젝트에서는 8개 입력 중
// 7개가 present:false로 잠겨 (a) 기획·설계가 바뀌어도 staleness에 안 잡히고(fail-open),
// (b) 수용 기준이 실재하는데도 `acceptanceSource: feature-plan`이 파일 부재로 거부돼
// specTier가 unverifiable로 밀렸다 — 축이 없다는 이유로 검증이 면제되는 형태다.
// §4 등록 항목의 해소이며, 해소 방식은 ticket/cli.mjs의 resolvePlanLocation과 같다.
// 스팩 원장(append-only). 스팩 확정 자신의 해시를 기록해 **삭제와 사후 수정**을 탐지한다.
// 배경(적대 리뷰 2026-08-26): sourceDigest는 스팩의 *입력*만 다이제스트하고 스팩 확정 *자신*은
// 아니므로, layerMap·libraries를 사후 실측에 맞게 고쳐 써도 어떤 기계도 잡지 못했다.
// spec.json을 지우면 NO_SPEC로 결박이 풀리는 것도 같은 구멍이다.
// planLock 삭제 우회(§4 "재개 매니페스트" 행)와 같은 클래스이며 그때의 해법을 그대로 쓴다.
//
// **한계(정직)**: 원장도 파일이라 함께 지우면 탐지되지 않는다. 이것은 로컬 신뢰 모델의
// 명시적 리스크 인수이며 ticket/ledger-writer.mjs와 같은 판단이다 — 실질 방어는 원장이
// git에 커밋되어 삭제가 히스토리에 남는 것이다.
export const SPEC_LEDGER = '_workspace/03_dev/spec-ledger.jsonl'

// 스팩 확정 내용 자체의 해시. 원장 기록과 대조해 사후 수정을 잡는다.
export const specDigest = spec => sha256(JSON.stringify(spec))

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

// 논리 입력 하나가 실제로 어느 파일(들)인지 해소한다.
//   flat    `x.md`가 파일로 있다
//   sharded `x.md`가 없고 `x/` 디렉터리에 `.md`가 있다 — 파일명 정렬로 결정적 순서를 준다
//           (순서가 흔들리면 내용이 같아도 다이제스트가 달라져 거짓 stale이 난다)
//   absent  둘 다 없다
// `.json` 입력은 샤딩하지 않는다 — 기계가 읽는 단일 문서라 분할 관례 자체가 없다.
// 디렉터리는 있는데 `.md`가 하나도 없으면 absent다: 빈 껍데기를 '있음'으로 세면 그 순간
// 존재 검사가 프록시가 된다.
//
// **flat과 디렉터리가 함께 있으면 flat이 이긴다.** 이 상태에서 샤드 편집은 다이제스트 밖이
// 되는데, 그 방어는 여기가 아니라 `validate-artifact-sharding.mjs`가 동명 공존을 ERROR로
// 잡는 데 있다(01_plan·02_design 전역). lockSpec 단독으로는 공존을 거부하지 않으므로 이
// 의존을 명시한다 — 산문에만 있는 계약은 지켜지지 않는다는 것을 이미 두 번 실측했다.
//
// 기록·해시에 쓰는 경로는 **NFC로 정규화**한다. macOS는 readdir이 NFD로, Linux는 NFC로
// 돌려주므로 한글 샤드명이 있으면 같은 내용에 다른 다이제스트가 나와 팀 간 거짓 stale이 난다.
// 읽기는 파일시스템이 준 원본 이름으로 한다 — 정규화한 이름으로 읽으면 Linux에서 못 연다.
export const resolveInputFiles = (root, relativePath) => {
  const flat = resolve(root, relativePath)
  if (existsSync(flat) && statSync(flat).isFile()) {
    return {kind: 'flat', files: [{path: relativePath, read: relativePath}]}
  }
  if (!relativePath.endsWith('.md')) return {kind: 'absent', files: []}
  const directoryRelative = relativePath.slice(0, -'.md'.length)
  const directory = resolve(root, directoryRelative)
  if (!existsSync(directory) || !statSync(directory).isDirectory()) return {kind: 'absent', files: []}
  const files = readdirSync(directory)
    .filter(name => name.endsWith('.md'))
    .map(name => ({path: `${directoryRelative}/${name.normalize('NFC')}`, read: `${directoryRelative}/${name}`}))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  return files.length > 0 ? {kind: 'sharded', files} : {kind: 'absent', files: []}
}

// 입력 해시. 경로 탈출을 막고, 부재는 present:false로 남긴다.
export const digestInputs = (projectRoot, inputs = LOCK_INPUTS) => {
  const root = resolve(projectRoot)
  const records = inputs.map(relativePath => {
    const candidate = resolve(root, relativePath)
    const offset = relative(root, candidate)
    if (offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)) {
      throw new LockError('LOCK_INPUT_ESCAPES_ROOT', `확정 입력이 프로젝트 루트를 벗어난다: ${relativePath}`)
    }
    const {kind, files} = resolveInputFiles(root, relativePath)
    if (kind === 'absent') return {path: relativePath, present: false}
    if (kind === 'flat') return {path: relativePath, present: true, sha256: sha256(readFileSync(candidate))}
    // 샤드는 **경로와 해시를 함께** 잇는다 — 샤드가 추가·삭제·개명되는 것도 입력 변경이다.
    // 내용만 이으면 파일을 쪼개거나 합치는 것이 다이제스트에 안 잡힌다.
    // 결합은 JSON으로 한다: 파일명은 콜론·개행을 담을 수 있어서 `path:hash`를 개행으로 이으면
    // 서로 다른 샤드 집합이 같은 문자열을 만들 수 있다(인코딩 모호성).
    const shards = files.map(file => ({path: file.path, sha256: sha256(readFileSync(resolve(root, file.read)))}))
    return {
      path: relativePath,
      present: true,
      kind: 'sharded',
      shards,
      sha256: sha256(JSON.stringify(shards.map(shard => [shard.path, shard.sha256]))),
    }
  })
  // combined는 경로·존재여부·해시를 모두 반영한다 — 파일이 사라진 것도 변경이다.
  // flat 프로젝트의 combined는 이 변경 전후로 동일하다(기존 스팩·receipt를 stale로 만들지 않는다).
  const combined = sha256(records.map(r => `${r.path}:${r.present ? r.sha256 : 'absent'}`).join('\n'))
  return {inputs: records, combined}
}

const FEATURE_PLAN_INPUT = '_workspace/01_plan/feature-plan.md'
const SUBSTRATE_DEFAULTS_PATH = new URL('../substrate-defaults.json', import.meta.url)

export const readSubstrateDefaults = () => JSON.parse(readFileSync(SUBSTRATE_DEFAULTS_PATH, 'utf8')).substrate ?? {}

// 고정 기반 병합. 규칙 하나 — **기본값은 미지정 키만 채운다.**
// 프로젝트가 measured(기존 코드에서 실측)나 declared(의도적 덮어쓰기)를 적었으면 그것이 이긴다.
// declared는 rationale을 요구한다: 기본값을 벗어나는 것은 판단이므로 근거가 남아야 한다.
export const mergeSubstrate = (declaredSubstrate, defaults = readSubstrateDefaults()) => {
  const declared = declaredSubstrate ?? {}
  const merged = {}
  for (const [key, entry] of Object.entries(declared)) {
    requireNonEmptyString(entry?.value, 'SUBSTRATE_VALUE_MISSING', `constitution.substrate.${key}.value가 없다`)
    if (!['default', 'measured', 'inferred', 'declared'].includes(entry?.source)) {
      throw new LockError('SUBSTRATE_SOURCE_INVALID', `constitution.substrate.${key}.source는 default|measured|inferred|declared여야 한다`)
    }
    if (entry.source === 'declared') {
      requireNonEmptyString(
        entry.rationale, 'SUBSTRATE_DECLARED_WITHOUT_RATIONALE',
        `constitution.substrate.${key}가 declared인데 rationale이 없다 — 기본값을 벗어나는 것은 판단이다`,
      )
    }
    // default라 주장하는데 하네스 기본값에 그런 키가 없으면 출처 날조다(적대 리뷰 2026-08-26).
    // 이 구멍이 열려 있으면 새 키 이름 하나로 declared의 rationale 의무를 우회할 수 있다.
    if (entry.source === 'default' && !(key in defaults)) {
      throw new LockError(
        'SUBSTRATE_DEFAULT_UNKNOWN_KEY',
        `constitution.substrate.${key}가 default라는데 하네스 기본값에 그런 키가 없다 — 존재하지 않는 출처다`,
      )
    }
    // default라 주장하면서 하네스 기본값과 다르면 거짓이다.
    if (entry.source === 'default' && key in defaults && entry.value !== defaults[key]) {
      throw new LockError(
        'SUBSTRATE_DEFAULT_MISMATCH',
        `constitution.substrate.${key}가 default라는데 값이 기본값과 다르다(${entry.value} ≠ ${defaults[key]}) — declared로 적고 rationale을 남겨라`,
      )
    }
    const settled = {value: entry.value, source: entry.source}
    if (typeof entry.rationale === 'string' && entry.rationale.trim() !== '') settled.rationale = entry.rationale
    merged[key] = settled
  }
  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in merged)) merged[key] = {value, source: 'default'}
  }
  return merged
}


// feature-plan.md에 실제로 존재하는 수용 기준 ID를 뽑는다.
// `FEAT-007`·`TC-007-1`·`TC-007-1-2` 형태를 받는다 — 번호 깊이는 프로젝트가 정한다.
export const extractAcceptanceIds = source =>
  new Set(String(source ?? '').match(/\b(?:FEAT|TC)-\d+(?:-\d+)*\b/g) ?? [])

// UI가 있는가 — **형태 카탈로그가 선언한다**(shape-checks.json의 shapes.<name>.userInterface).
// 여기서 이름을 하드코딩하지 않는 이유: 새 UI 형태가 추가될 때 이 함수를 고치는 것을 잊으면
// e2e 요구가 조용히 사라진다. 카탈로그는 형태를 추가할 때 반드시 지나가는 곳이고,
// validate-shape-checks가 userInterface 누락·오타를 FAIL로 잡는다.
// 반환: true(UI 있음) · false(UI 없음) · 'unknown'(카탈로그가 모르는 형태가 섞여 있다).
// 적대 리뷰(2026-08-28)가 잡은 fail-open: 미등록 형태를 false로 퇴화시키면 targetShapes에
// 카탈로그 밖 이름을 적는 것만으로 e2e 요구가 **조용히 증발**한다. 그렇다고 미등록 형태를
// 실패로 만들 수는 없다 — shape-routing-contract §4가 "하네스가 모르는 것을 실패로 만들지
// 않는다"를 이미 결정했다. 실패시키지 않되 **판단을 스팩에 되돌린다**.
export const hasUserInterface = (targetShapes, catalog = readShapeChecks()) => {
  const shapes = targetShapes ?? []
  if (shapes.some(shape => catalog?.shapes?.[shape]?.userInterface === true)) return true
  if (shapes.some(shape => catalog?.shapes?.[shape] === undefined)) return 'unknown'
  return false
}

// 테스트 레이어 — 소유권이 여기서 나온다.
//   unit: **항상** 필요하다. 유닛 테스트 없이 개발을 끝내지 않는다(사용자 결정 2026-08-28).
//   e2e : **UI가 있으면** 필요하다. 화면이 있으면 화면을 통과하는 검증이 있어야 한다.
//
// 왜 layerMap이 아니라 별도 필드인가: layerMap은 레이어 **이름을 프로젝트가 정한다**.
// `unit-tests`·`tests`·`spec` 중 무엇이 테스트인지 이름으로 맞히면 그것이 프록시다.
// 스팩이 직접 "이 경로가 테스트다"라고 말하게 한다. 경로가 layerMap 값과 겹쳐도 된다
// (유닛 테스트를 소스 옆에 두는 것이 정상이다) — 겹침 금지는 layerMap 안에서만 적용된다.
export const validateTestLayers = (decision, catalog = readShapeChecks()) => {
  const testLayers = decision?.testLayers ?? {}
  if (typeof testLayers !== 'object' || Array.isArray(testLayers)) {
    throw new LockError('TEST_LAYERS_INVALID_SHAPE', 'testLayers가 객체가 아니다')
  }
  requireNonEmptyString(
    testLayers.unit,
    'UNIT_TEST_LAYER_MISSING',
    'testLayers.unit이 없다 — 유닛 테스트는 형태와 무관하게 항상 수행한다. 테스트가 놓일 경로를 스팩이 정해야 그 경로의 소유자가 생긴다',
  )
  // 미지 키를 조용히 버리지 않는다 — `integration` 같은 오타·미지원 키를 버리면 그 경로가
  // 무소유로 남는다. targetShape 단수를 거부하는 것과 같은 규율이다.
  for (const key of Object.keys(testLayers)) {
    if (!['unit', 'e2e'].includes(key)) {
      throw new LockError('TEST_LAYER_UNKNOWN_KEY', `testLayers에 알 수 없는 키 '${key}' — unit·e2e만 소유권으로 이어진다`)
    }
  }
  const needsE2e = hasUserInterface(decision?.targetShapes, catalog)
  if (needsE2e === true) {
    requireNonEmptyString(
      testLayers.e2e,
      'E2E_TEST_LAYER_MISSING',
      'testLayers.e2e가 없다 — targetShapes에 UI를 가진 형태가 있으면 e2e 테스트 레이어를 확정해야 한다(형태 카탈로그의 userInterface에서 도출)',
    )
  } else if (needsE2e === 'unknown') {
    // 카탈로그 밖 형태 — UI 여부를 도출할 수 없다. 실패시키지 않되 침묵도 허용하지 않는다.
    // 실제 경로든 `(absent — 이유)` 명시든, 스팩이 e2e에 대해 **말은 해야** 한다.
    if (typeof testLayers.e2e !== 'string' || testLayers.e2e.trim() === '') {
      throw new LockError(
        'E2E_TEST_LAYER_UNDECIDED',
        'targetShapes에 형태 카탈로그가 모르는 형태가 있다 — UI 여부를 도출할 수 없으므로 testLayers.e2e를 스팩이 정해야 한다(경로를 적거나 "(absent — 이유)"로 명시하라)',
      )
    }
  } else if (testLayers.e2e !== undefined) {
    requireNonEmptyString(testLayers.e2e, 'E2E_TEST_LAYER_EMPTY', 'testLayers.e2e가 비어 있다 — 선언하지 않을 것이면 키를 두지 마라')
  }
  const settled = {unit: testLayers.unit}
  if (typeof testLayers.e2e === 'string' && testLayers.e2e.trim() !== '') settled.e2e = testLayers.e2e
  return settled
}

export const buildSpec = ({decision, digest, acceptanceIds}) => {
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
  // 2026-08-28: ID 대조를 위에서 수행한다. 남은 한계는 ID가 **의미 있는** 수용 기준인지까지는 못 본다는 것.
  // 라벨이 증거를 요구한다 — (a) 파일 실존, (b) 적은 ID의 실존. 둘 다 본다.
  if (acceptanceSource === 'feature-plan') {
    const featurePlan = (digest?.inputs ?? []).find(item => item.path === FEATURE_PLAN_INPUT)
    if (!featurePlan?.present) {
      throw new LockError(
        'ACCEPTANCE_SOURCE_WITHOUT_PLAN',
        `acceptanceSource가 feature-plan인데 ${FEATURE_PLAN_INPUT}이 없다 — 라벨은 증거를 요구한다`,
      )
    }
    // 파일이 있어도 **적은 ID가 그 안에 있는지**는 별개다. 없으면 존재하지 않는 `TC-999-1`을
    // 적어도 확정되어 기획→스팩 고리가 자기보고가 된다(§4 TODO였다, 2026-08-28 해소).
    if (!(acceptanceIds instanceof Set)) {
      throw new LockError(
        'ACCEPTANCE_INDEX_MISSING',
        'acceptanceRefs를 대조할 feature-plan 색인이 없다 — 검사 미수행을 통과로 만들지 않는다(lockSpec이 공급한다)',
      )
    }
    const missing = acceptanceRefs.filter(ref => !acceptanceIds.has(ref))
    if (missing.length > 0) {
      throw new LockError(
        'ACCEPTANCE_REF_NOT_FOUND',
        `acceptanceRefs가 ${FEATURE_PLAN_INPUT}에 없는 ID를 가리킨다: ${missing.join(', ')} — 라벨은 증거를 요구한다`,
        {missing},
      )
    }
  }

  const architecture = decision.architecture ?? {}
  requireNonEmptyString(architecture.pattern, 'ARCHITECTURE_PATTERN_MISSING', 'architecture.pattern이 없다')
  requireNonEmptyString(architecture.rationale, 'ARCHITECTURE_RATIONALE_MISSING', 'architecture.rationale이 없다 — 무엇을 골랐는지만으로는 잠글 수 없다')

  const libraries = decision.libraries ?? {}
  for (const [role, entry] of Object.entries(libraries)) {
    requireNonEmptyString(entry?.choice, 'LIBRARY_CHOICE_MISSING', `libraries.${role}.choice가 없다`)
    // 근거 티어(2026-08-26): 실측 → 추론 → 질의 순서를 표현한다. 브라운필드는 코드에서 읽고
    // (measured), 그린필드는 사용자 요청에서 추론하며(inferred), 둘 다 안 되면 묻는다(confirmed).
    // proposed는 셋 중 어느 근거도 없는 설계자 제안이다 — 남겨두되 구분한다.
    if (!['measured', 'measured-absent', 'inferred', 'confirmed', 'proposed'].includes(entry?.source)) {
      throw new LockError('LIBRARY_SOURCE_INVALID', `libraries.${role}.source는 measured|measured-absent|inferred|confirmed|proposed여야 한다`)
    }
  }

  const constitution = {substrate: mergeSubstrate(decision.constitution?.substrate)}
  // 형태는 배열이다(조사 2026-08-26): 라이브러리이면서 CLI인 패키지가 정상 패턴이고,
  // 하나로 강제하면 나머지 절반의 검증을 잃는다. 구 단수 필드는 조용히 받지 않고 거부한다 —
  // 같은 것을 두 가지로 말할 수 있으면 나중에 어느 쪽이 정본인지 모호해진다.
  if (decision.targetShape !== undefined) {
    throw new LockError(
      'TARGET_SHAPE_SINGULAR',
      'targetShape(단수)는 더 이상 쓰지 않는다 — targetShapes 배열로 적어라(라이브러리+CLI 같은 조합이 정상이다)',
    )
  }
  const targetShapes = Array.isArray(decision.targetShapes)
    ? decision.targetShapes.filter(shape => typeof shape === 'string' && shape.trim() !== '')
    : []
  if (targetShapes.length === 0) {
    throw new LockError(
      'TARGET_SHAPES_MISSING',
      'targetShapes가 비어 있다 — 산출물 형태(web-app·library·cli 등)가 정해져야 검증 방식이 정해진다',
    )
  }

  const testLayers = validateTestLayers({...decision, targetShapes})

  return {
    // 2 = testLayers를 담는 세대(2026-08-28). 1은 그 이전에 확정된 스팩이며 읽기 전용 이력이다 —
    // 이미 커밋된 증거(golden T1 receipt에 결박된 spec)를 새 규칙에 맞춰 고쳐 쓰지 않는다.
    schemaVersion: 2,
    specTier: acceptanceSource === 'feature-plan' ? 'verifiable' : 'unverifiable',
    acceptanceSource,
    acceptanceRefs,
    constitution,
    targetShapes,
    architecture: {pattern: architecture.pattern, rationale: architecture.rationale},
    communication: Array.isArray(decision.communication) ? decision.communication : [],
    concurrency: Array.isArray(decision.concurrency) ? decision.concurrency : [],
    layerMap: decision.layerMap ?? {},
    testLayers,
    libraries,
    moduleBoundaries: Array.isArray(decision.moduleBoundaries) ? decision.moduleBoundaries : [],
    nonGoals: Array.isArray(decision.nonGoals) ? decision.nonGoals : [],
    decisions: settleDecisions(decision.openDecisions),
    sourceDigest: digest,
  }
}

// 스팩이 유래한 입력이 그 뒤로 바뀌었는지 판정한다. Stage 2의 게이트가 소비할 지점이다.
export const isSpecStale = (spec, projectRoot) =>
  digestInputs(projectRoot).combined !== spec?.sourceDigest?.combined

// 스팩을 원장에 기록한다. 스팩이 stdout으로 나가 저장되는 시점과 같은 시점에 호출한다.
export const recordSpec = (projectRoot, spec) => {
  const record = {
    at: new Date().toISOString(),
    digest: specDigest(spec),
    sourceDigest: spec.sourceDigest?.combined ?? null,
    specTier: spec.specTier ?? null,
    targetShapes: spec.targetShapes ?? [],
  }
  appendEvidenceLine(join(resolve(projectRoot), SPEC_LEDGER), record)
  return record
}

// 원장과 현재 스팩을 대조한다. 셋을 구분한다:
//   NO_LEDGER   원장이 없다 — 스팩 확정 이력이 없거나 원장까지 지워졌다
//   DELETED     원장에 기록이 있는데 스팩 파일이 없다 — 삭제 탐지
//   TAMPERED    스팩이 있는데 해시가 원장 최신 기록과 다르다 — 사후 수정 탐지
//   OK          일치
export const inspectSpecLedger = (projectRoot, spec) => {
  const path = join(resolve(projectRoot), SPEC_LEDGER)
  if (!existsSync(path)) return {state: 'NO_LEDGER', rows: 0}
  const rows = readEvidenceLog(path).filter(row => typeof row?.digest === 'string')
  if (rows.length === 0) return {state: 'NO_LEDGER', rows: 0}
  if (spec === null || spec === undefined) {
    return {state: 'DELETED', rows: rows.length, lastDigest: rows[rows.length - 1].digest}
  }
  const current = specDigest(spec)
  const known = rows.some(row => row.digest === current)
  return known
    ? {state: 'OK', rows: rows.length}
    : {state: 'TAMPERED', rows: rows.length, currentDigest: current, lastDigest: rows[rows.length - 1].digest}
}

export const lockSpec = projectRoot => {
  const root = resolve(projectRoot)
  const designPath = join(root, '_workspace/02_design/solution-design.md')
  if (!existsSync(designPath)) {
    throw new LockError('SOLUTION_DESIGN_MISSING', 'solution-design.md가 없다 — 설계 단계를 먼저 실행하라', {path: designPath})
  }
  const decision = extractDecisionBlock(readFileSync(designPath, 'utf8'))
  // 수용 기준 색인도 샤드 전체에서 뽑는다 — flat만 읽으면 sharded 프로젝트의 ID가
  // 통째로 없는 것으로 보여 ACCEPTANCE_REF_NOT_FOUND가 거짓으로 난다.
  const planFiles = resolveInputFiles(root, FEATURE_PLAN_INPUT).files
  const acceptanceIds = planFiles.length > 0
    ? extractAcceptanceIds(planFiles.map(file => readFileSync(resolve(root, file.read), 'utf8')).join('\n'))
    : new Set()
  return buildSpec({decision, digest: digestInputs(root), acceptanceIds})
}

// main guard: `file://${argv[1]}` 문자열 결합은 POSIX에서만 맞는다 — Windows 경로(D:\…)에서는
// 절대 일치하지 않아 CLI가 통째로 no-op하고 exit 0이 된다(조용한 통과).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  const rootIndex = argv.indexOf('--project-root')
  const projectRoot = rootIndex >= 0 ? argv[rootIndex + 1] : undefined
  if (!projectRoot) {
    process.stderr.write('사용법: node .claude/scripts/spec.mjs --project-root <path>\n')
    process.exit(2)
  }
  try {
    const spec = lockSpec(projectRoot)
    // 원장 먼저 기록한다 — stdout이 저장되지 않아도 스팩 확정 시도는 남는다.
    recordSpec(projectRoot, spec)
    process.stdout.write(`${JSON.stringify(spec, null, 2)}\n`)
  } catch (error) {
    const payload = error instanceof LockError
      ? {ok: false, error: {code: error.code, message: error.message, details: error.details}}
      : {ok: false, error: {code: 'LOCK_FAILED', message: error.message, details: {}}}
    // 오류는 stderr로 낸다 — stdout은 "그대로 저장" 관례라 오류 객체가 스팩 확정으로 위장될 수 있다.
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`)
    process.exit(1)
  }
}
