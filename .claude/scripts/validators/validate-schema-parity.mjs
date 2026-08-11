// JSON Schema(문서)와 수기 검증기(실행 코드) 사이의 상수 드리프트 tripwire.
//
// 배경: 이 저장소는 무의존(zero-dependency)이라 schemas/*.json을 ajv 같은 평가기로
// 실행하지 않는다 — adapter-lib, quality-attestation-lib 등 수기 JS가 같은 제약을
// 중복 구현한다. 스키마만 고치고 검증기를 안 고치면(또는 반대) 조용히 발산하므로,
// load-bearing 리터럴이 스키마와 미러 양쪽에 존재하는지 assert한다.
// 이 목록 자체가 세 번째 사본이며 그것이 tripwire의 역할이다 — 어느 한쪽만 바뀌면
// 여기서 실패해 세 곳의 동시 갱신을 강제한다.
//
// 검사 계층:
//   1. PARITY_CASES     — 스키마 const/enum/pattern/키가 수기 미러 소스에 존재
//   2. EMITTER_CASES    — 스키마 top-level required 키가 생성기 소스에 리터럴로 존재
//   3. DIRECT_CONSUMERS — 스키마를 직접 로드·해석하는 소비자의 경로 참조 확인
//   4. dangling check   — 모든 schema 파일이 scripts 또는 저장소 문서에서 참조됨

import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs'
import {join, relative} from 'node:path'

const PARITY_CASES = [
  {
    schema: '.claude/schemas/web-core/adapter.schema.json',
    mirror: '.claude/scripts/web-core/adapter-lib.mjs',
    values: ['pnpm', 'build', 'static', 'unit', 'contract', 'browser', 'runtime', 'security', 'artifact'],
  },
  {
    schema: '.claude/schemas/quality-attestation.schema.json',
    mirror: '.claude/scripts/quality-attestation-lib.mjs',
    values: ['ed25519', '^[A-Za-z0-9+/]{86}==$', 'schemaVersion', 'keyId', 'algorithm', 'subject', 'signature'],
  },
  {
    schema: '.claude/schemas/quality-attesters.schema.json',
    mirror: '.claude/scripts/quality-attestation-lib.mjs',
    values: ['ed25519', 'publicKeyPem'],
  },
  {
    schema: '.claude/schemas/visual-qa-contract.schema.json',
    mirror: '.claude/scripts/validators/validate-visual-design.mjs',
    values: ['disabled', 'reflowCssWidth', 'zoomEquivalentPercent', 'clsMax', 320, 400],
  },
  {
    schema: '.claude/schemas/visual-baseline-manifest.schema.json',
    mirror: '.claude/scripts/validators/validate-visual-design.mjs',
    values: ['approvedBy', 'approvedAt', 'sha256'],
  },
]

const EMITTER_CASES = [
  ['.claude/schemas/web-core/project-profile.schema.json', '.claude/scripts/web-core/profile-lib.mjs'],
  ['.claude/schemas/web-core/execution-plan.schema.json', '.claude/scripts/web-core/dag-lib.mjs'],
]

const DIRECT_CONSUMERS = [
  ['.claude/schemas/runtime-data-contract.schema.json', '.claude/scripts/runtime-data-contract-lib.mjs'],
]

const walkFiles = (root, extensions, out = []) => {
  if (!existsSync(root)) return out
  for (const name of readdirSync(root)) {
    const path = join(root, name)
    if (statSync(path).isDirectory()) walkFiles(path, extensions, out)
    else if (extensions.some(extension => name.endsWith(extension))) out.push(path)
  }
  return out
}

export const validateSchemaParity = ({repositoryRoot, pass, fail}) => {
  const readSource = relativePath => readFileSync(join(repositoryRoot, relativePath), 'utf8')

  // 1. 상수 parity
  let literalCount = 0
  for (const {schema, mirror, values} of PARITY_CASES) {
    if (!existsSync(join(repositoryRoot, schema))) {
      fail(`schema parity: schema file is missing: ${schema}`)
      continue
    }
    let schemaText
    try {
      schemaText = JSON.stringify(JSON.parse(readSource(schema)))
    } catch (error) {
      fail(`schema parity: ${schema} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    const mirrorText = readSource(mirror)
    for (const value of values) {
      literalCount += 1
      const schemaNeedle = typeof value === 'number' ? String(value) : `"${value}"`
      if (!schemaText.includes(schemaNeedle)) {
        fail(`schema parity: ${schema} no longer contains ${schemaNeedle} — 스키마가 바뀌었으면 ${mirror}와 이 목록을 함께 갱신할 것`)
      }
      if (!mirrorText.includes(String(value))) {
        fail(`schema parity: ${mirror} no longer mirrors ${String(value)} from ${schema} — 검증기가 바뀌었으면 스키마와 이 목록을 함께 갱신할 것`)
      }
    }
  }

  // 2. 생성기 required 키 parity (스키마의 top-level required를 그대로 읽어 비교)
  for (const [schema, emitter] of EMITTER_CASES) {
    const required = JSON.parse(readSource(schema)).required ?? []
    const emitterSource = readSource(emitter)
    for (const key of required) {
      literalCount += 1
      if (!emitterSource.includes(key)) {
        fail(`schema parity: ${emitter} does not emit required key "${key}" declared by ${schema}`)
      }
    }
  }

  // 3. 직접 소비자의 경로 참조
  for (const [schema, consumer] of DIRECT_CONSUMERS) {
    if (!readSource(consumer).includes(schema)) {
      fail(`schema parity: ${consumer} no longer loads ${schema}`)
    }
  }

  // 4. dangling schema — scripts 또는 저장소 문서 어디에서도 참조되지 않는 스키마
  const referenceCorpus = [
    ...walkFiles(join(repositoryRoot, '.claude', 'scripts'), ['.mjs']),
    ...walkFiles(join(repositoryRoot, '.claude', 'skills'), ['.md', '.json']),
    ...walkFiles(join(repositoryRoot, '.claude', 'agents'), ['.md']),
    ...walkFiles(join(repositoryRoot, '.claude', 'adapters'), ['.md', '.json']),
    join(repositoryRoot, 'README.md'),
    join(repositoryRoot, '.claude', 'README.md'),
  ]
    .filter(path => existsSync(path))
    .map(path => readFileSync(path, 'utf8'))
    .join('\n')
  const schemaFiles = walkFiles(join(repositoryRoot, '.claude', 'schemas'), ['.json'])
  for (const schemaPath of schemaFiles) {
    const basename = relative(join(repositoryRoot, '.claude', 'schemas'), schemaPath).split('/').at(-1)
    if (!referenceCorpus.includes(basename)) {
      fail(`schema parity: ${relative(repositoryRoot, schemaPath)} is referenced by no script or document (dangling schema)`)
    }
  }

  pass(`schema-validator parity checked (${PARITY_CASES.length + EMITTER_CASES.length} pairs, ${literalCount} literals, ${schemaFiles.length} schemas referenced)`)
}
