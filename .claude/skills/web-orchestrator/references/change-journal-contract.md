# Change Journal and Recovery Contract

기존 source를 변경하는 각 owner agent는 자기 전용 `_workspace/03_dev/change-journal/{agent-name}.md`에 append-only 항목을 남긴다. 다른 agent의 저널과 legacy 단일 `change-journal.md`는 수정하지 않는다. 오케스트레이터는 모든 agent 저널을 읽어 완료 보고와 복구 결정을 통합한다.

```markdown
## {timestamp}
- CREATED: path — purpose
- MODIFIED: path — preserved contract / change summary
- FAILED: path or operation — error / last safe point
- EVIDENCE: command or fixture
```

병렬 owner가 같은 파일을 append하지 않으므로 write 충돌과 항목 유실을 피한다. source를 수정하지 않은 owner도 `NO_SOURCE_CHANGE`와 확인한 입력을 기록할 수 있다.

## 실패 시

1. 즉시 실패 owner의 추가 수정을 중단한다.
2. change-scope와 모든 owner journal을 비교해 사용자 변경과 harness 변경을 분리한다.
3. 다음 선택을 제시한다.
   - A. 실패 owner만 수정 후 재실행
   - B. 실패 owner가 생성한 신규 파일만 제거
   - C. 검토된 reverse patch로 해당 owner 변경만 복원
   - D. 중단하고 수동 정리
4. 삭제·복원 전 대상 파일과 복구 가능성을 보여주고 확인한다.

자동 `git checkout`, 광범위한 restore, untracked 일괄 삭제는 금지한다. source 변경 후 기존 receipt와 QA manifest는 stale이다.
