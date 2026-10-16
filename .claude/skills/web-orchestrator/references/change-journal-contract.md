# Change Failure Recovery Contract

기록 파일을 쓰지 않는다 — 무엇을 바꿨는지는 `change-scope.md`·git diff·스폰의 `SPAWN_RESULT FILES`가,
보존한 계약은 change-scope의 `PUBLIC_CONTRACTS_TO_PRESERVE`가, 남은 일은 스폰 반환의 `PARTIAL`이, 이유는 커밋 메시지가 정본이다.
기존 source를 바꾸는 스폰이 **절단·중단·미완이거나 게이트가 실패하면** 아래 절차를 따른다.

## 실패 시

1. 즉시 실패 owner의 추가 수정을 중단한다.
2. change-scope·git diff(`run-git-inspection.mjs --operation status`)·resume-manifest를 비교해 사용자 변경과 harness 변경을 분리한다. **한계**: 스폰 전 작업 트리 baseline이 없으면(`minimal-change-contract.md`) 더러운 트리 위의 변경 목록에 사용자 파일이 섞인다 — 그 경우 분리를 단정하지 않고 사용자에게 보여 확인한다.
3. 다음 선택을 제시한다.
   - A. 실패 owner만 수정 후 재실행
   - B. 실패 owner가 생성한 신규 파일만 제거
   - C. 검토된 reverse patch로 해당 owner 변경만 복원
   - D. 중단하고 수동 정리
4. 삭제·복원 전 대상 파일과 복구 가능성을 보여주고 확인한다.

자동 `git checkout`, 광범위한 restore, untracked 일괄 삭제는 금지한다. source가 바뀌면 배포용 receipt·QA manifest는 stale이다.
