#!/usr/bin/env node
// execution-binding-lib.mjs — receipt가 "무엇이 이 실행을 결정했나"에 결박되게 한다.
//
// 종전 `profileBinding`은 11필드 중 넷이 **배포 메타**였다(deploymentProvider·deploymentTarget·
// releaseTarget·selectedCapabilities). 조사(2026-08-26):
//
//   Score·OAM — 워크로드 스펙과 배포를 분리한다. 배포 결정은 플랫폼이 실행하지 개발자의
//     스펙에 담지 않는다. 배포 대상을 하네스가 드는 것 자체가 관심사 혼입이다.
//   Vercel·Netlify — 배포 대상은 선언이 아니라 감지로 가고 있다(2026 무설정 import).
//   SLSA build provenance — 결속 대상은 `builder.id`·`buildType`·`externalParameters`,
//     **누가 무엇으로 빌드했나**다. 배포 대상은 build provenance의 필드가 아니다.
//     그리고 builder 필드는 서명자에서 유추되더라도 **필수**다(명시적으로 남긴다).
//
// 그래서 배포 메타를 빼고 **빌드 provenance만** 묶는다. 결과적으로 결속은 약해지지 않고
// 강해진다 — "어느 어댑터였나"가 아니라 "어느 그래프·어느 검사 카탈로그·어느 스팩이었나"다.
//
// 또 하나: 종전 검증은 `if (expectedProfile)`로 감싸여 있어 프로필이 없으면 **11필드 검증
// 전체가 건너뛰어졌다**. 실행 결속은 프로필과 무관하므로 **항상** 검증된다 — 건너뛸 블록이 없다.
import {createHash} from 'node:crypto'
import {existsSync, readFileSync} from 'node:fs'
import {join, resolve} from 'node:path'

const SHAPE_CHECKS_PATH = new URL('../shape-checks.json', import.meta.url)
export const SPEC_PATH = '_workspace/03_dev/spec.json'
export const BINDING_SCHEMA_VERSION = 1

const sha256 = value => createHash('sha256').update(value).digest('hex')
const stable = value => JSON.stringify(value, Object.keys(value ?? {}).sort())

const readIfExists = path => (existsSync(path) ? readFileSync(path, 'utf8') : null)

// 하네스 자신의 정체성. SLSA의 builder.id에 대응한다 — 유추 가능해도 명시한다.
export const harnessIdentity = () => {
  const checks = readFileSync(SHAPE_CHECKS_PATH, 'utf8')
  return {shapeChecksSha256: sha256(checks)}
}

// 이 실행을 결정한 것 전부. 하나라도 바뀌면 receipt는 stale이다.
export const computeExecutionBinding = ({projectRoot, tasks}) => {
  const root = resolve(projectRoot)
  const specSource = readIfExists(join(root, SPEC_PATH))
  return {
    schemaVersion: BINDING_SCHEMA_VERSION,
    ...harnessIdentity(),
    // 도출된 실행 그래프. 검사가 늘거나 의존이 바뀌면 달라진다.
    graphSha256: Array.isArray(tasks) ? sha256(JSON.stringify(tasks.map(stable))) : null,
    // 확정된 스팩. 없으면 null이며 그 사실 자체가 결속의 일부다(스팩 없이 만든 증거).
    specSha256: specSource === null ? null : sha256(specSource),
  }
}

// 항상 검증한다. 프로필 유무로 건너뛰지 않는다.
export const verifyExecutionBinding = ({receipt, expected, relativePath}) => {
  const errors = []
  const actual = receipt?.executionBinding
  if (!actual) {
    errors.push(`${relativePath}: execution binding이 없다 — 무엇이 이 실행을 결정했는지 알 수 없다`)
    return errors
  }
  for (const key of ['shapeChecksSha256', 'graphSha256', 'specSha256']) {
    if (actual[key] !== expected[key]) {
      errors.push(`${relativePath}: execution binding이 stale하다 (${key})`)
    }
  }
  return errors
}
