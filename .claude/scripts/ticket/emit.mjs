// 팀 워크플로우 통합 — 아웃바운드 emit 코어 (통합 빌드 2단계).
// docs/team-workflow-integration-design.md 지점 A: feature-plan 단위 → 티켓.
//
// 이 모듈은 **순수 오케스트레이션 코어**다 — 멱등 emit-plan(create/update/close/unchanged)을
// 계산할 뿐, 외부 티켓 생성·원장 쓰기(side-effect)는 하지 않는다. 실제 발행은 confirm 게이트를
// 통과한 runner가 provider.emit + 원장 append로 수행한다(미리보기→확인→생성).
//
// **분배(assignment)는 emit의 일부가 아니다.** emit은 티켓 "생성"만 하고, "누가 맡느냐"는
// 선택적 하류 단계(트래커 assignee)다 — 혼자 개발이면 분배 없이 본인이 픽업한다. 그래서
// 이 코어는 assignee를 전혀 모른다.
import {stripUnitMarker} from './plan-units.mjs'

import {createHash} from 'node:crypto'

const sha256 = value => createHash('sha256').update(value).digest('hex')
const uniqueSorted = values => [...new Set(values)].sort()


/**
 * 재발행 멱등 판정용 내용 해시. 티켓에 실리는 필드만 정규화해 해시 —
 * 순서·중복에 안정적이라 같은 내용이면 같은 해시(불필요한 갱신 방지).
 * @param {{title?: string, body?: string, testCaseIds?: string[], type?: string}} unit
 */
export function unitContentHash(unit) {
  return sha256(JSON.stringify({
    title: unit.title ?? '',
    // 하네스 제어 마커는 **내용이 아니다.** 넣으면 "의존을 선언하라"는 요구가 이미 발행된
    // 티켓의 청구를 스스로 무효화한다(2026-08-30 실측: 선언 커밋 하나로 11건이 영구 픽업
    // 불가). 스펙이 바뀐 것이 아니므로 stale로 볼 근거가 없다 — 제목·TC·산문이 바뀌면
    // 여전히 잡힌다.
    body: stripUnitMarker(unit.body ?? ''),
    testCaseIds: uniqueSorted(unit.testCaseIds ?? []),
    type: unit.type ?? 'feature',
  }))
}


