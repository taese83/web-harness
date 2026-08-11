# Visual Baseline Governance

## Separation of duties

- `visual-test-writer`: test/story만 작성
- `visual-regression-verifier`: 실행 결과와 diff만 읽음
- candidate generation job: 승인 전 격리 branch/worktree에서 snapshot candidate 생성
- 사용자 또는 지정 reviewer: before/after/diff 승인
- `visual-baseline-manager`: 승인된 hash와 metadata만 manifest에 반영

verifier와 일반 quality runner는 `--update-snapshots`를 실행하지 않는다.

## Approval sequence

1. current baseline과 candidate를 서로 다른 경로에 생성한다.
2. target, state, mode, before, after, diff, changed pixel ratio를 제시한다.
3. 디자인 source 변경, 의도된 product 변경, 렌더 환경 drift를 구분한다.
4. 명시적 승인 후 snapshot과 manifest를 같은 change로 반영한다.
5. clean checkout의 pinned environment에서 read-only visual QA를 다시 실행한다.

승인 전에 기존 baseline을 덮어쓰지 않는다.

## Manifest

`_workspace/02_design/visual-baseline-manifest.json`은 `.claude/schemas/visual-baseline-manifest.schema.json`을 따른다.

각 entry:

- target ID
- project-relative PNG path
- SHA-256
- approvedBy
- approvedAt
- reason
- design reference ID

manifest hash와 실제 PNG hash가 다르면 `BLOCKED`다. approval metadata만 있고 이미지가 없거나, 이미지가 있으나 manifest에 없거나, target이 선언되지 않은 snapshot도 `BLOCKED`다.

## Threshold and mask changes

threshold 완화와 mask 확대는 baseline 변경과 같은 승인이 필요하다. flaky test를 숨기기 위한 전역 threshold 확대는 금지한다. 안정화할 수 없는 영역은 최소 bounding region과 사유, owner, 만료 조건을 contract에 기록한다.

