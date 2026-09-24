#!/usr/bin/env node
// test-contract-load-points.mjs — 시점 로드로 나눈 계약을 부르는 자리가 남아 있다.
//
// 나눈 계약은 앞 계약의 포인터로만 읽힌다(protected-core §4 「시점 로드 분리」). 포인터가 사라지면 그 계약은
// 아무도 읽지 않는 문서가 되고, 문서 위생 검사(경로가 실재하는가)는 그것을 잡지 못한다. 여기서 부르는 자리를 고정한다:
//   - change 레인 스팩 승인: Iterate 1-A(`execution-contract.md`)·레인 표(`request-type-contract.md`)·`/wh` 레인 표·재진입 맵
//   - 큰 빌더 스폰 규칙: 스폰 전 핵심 계약(`execution-budget-contract.md`)·Phase 3 구현 스폰·재진입 맵
// 파일 어딘가의 언급이 아니라 **부르는 문장**을 본다 — 같은 파일의 다른 언급(예: 규칙 4의 "규칙 2와 짝") 때문에
// 부르는 문장이 사라져도 통과하면 이 검사는 공허하다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {existsSync, readFileSync} from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const REFERENCES = 'skills/web-orchestrator/references'

const LOAD_POINTS = [
  ['change-lane-checkpoint.md', [
    [`${REFERENCES}/execution-contract.md`, /^1-A\. .*`change-lane-checkpoint\.md`/m],
    [`${REFERENCES}/request-type-contract.md`, /상세는 .*`change-lane-checkpoint\.md`/],
    ['skills/wh/SKILL.md', /\*\*1-A ✋스팩 승인\*\*\(`change-lane-checkpoint\.md`\)/],
    [`${REFERENCES}/reentry-map.md`, /체크포인트를 제시할 때 .*`change-lane-checkpoint\.md`/],
  ]],
  ['spawn-decomposition-contract.md', [
    [`${REFERENCES}/execution-budget-contract.md`, /규칙 1~3은 `spawn-decomposition-contract\.md`에 있다/],
    [`${REFERENCES}/phase-3-development.md`, /스폰 계획[^\n]*`spawn-decomposition-contract\.md`를 따른다/],
    [`${REFERENCES}/reentry-map.md`, /빌더 스폰을 계획할 때 \| `spawn-decomposition-contract\.md`/],
  ]],
]

test('나눈 계약은 실재하고, 부르는 자리의 문장이 그 계약을 가리킨다', () => {
  for (const [contract, callers] of LOAD_POINTS) {
    assert.ok(existsSync(new URL(`../${REFERENCES}/${contract}`, import.meta.url)), `${contract}가 없다`)
    for (const [caller, sentence] of callers) {
      assert.match(read(caller), sentence, `${caller}의 부르는 문장이 ${contract}를 가리키지 않는다 — 그 계약은 아무도 읽지 않게 된다`)
    }
  }
})

test('옛 자리는 새 계약을 가리키는 포인터만 남긴다 — 본문이 두 곳에 갈라지지 않는다', () => {
  const checkpoints = read(`${REFERENCES}/approval-checkpoints.md`)
  const changeSection = checkpoints.slice(checkpoints.indexOf('## change 레인 → 개발'), checkpoints.indexOf('## 질문 규칙'))
  assert.match(changeSection, /change-lane-checkpoint\.md/)
  assert.doesNotMatch(changeSection, /### ①/, 'change 레인 절차 본문이 옛 자리에 남았다')
  const budget = read(`${REFERENCES}/execution-budget-contract.md`)
  assert.doesNotMatch(budget, /^1\. \*\*출력 단위를 계층이 아니라/m, '큰 빌더 스폰 규칙 본문이 핵심 계약에 남았다')
  assert.match(budget, /marker:immediate-write-contract/, '즉시-쓰기 규칙(모든 산출 스폰)은 핵심 계약에 남아야 한다')
})
