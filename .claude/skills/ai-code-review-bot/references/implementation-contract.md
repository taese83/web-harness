# AI Code Review Implementation Contract

`code-review-contract.md`의 파이프라인·finding schema를 전제로, 운영에서 실제로 실패하는 지점의 구현 결정을 고정한다.

## Diff 범위 전략

- **incremental review**: base 갱신·추가 커밋 시 전체 재리뷰가 아니라 직전 리뷰 이후 변경 hunk만 분석한다. 전체 재리뷰는 force-push로 히스토리가 재작성됐을 때만.
- **large PR 상한**: 변경 파일 수·라인 수 상한을 config로 고정한다 (기본 제안: 파일 60개 / diff 3,000라인). 초과 시 파일별 리뷰를 포기하고 ① 위험도 순 상위 파일 목록 ② 분할 제안 comment로 강등한다 — 절단된 리뷰를 전체 리뷰처럼 보고하지 않는다.
- **monorepo 스코핑**: 변경 package + 그 dependent 소비자의 인접 소스만 context에 포함한다. workspace 전체 소스 로딩 금지.
- **컨텍스트 절단**: 대형 파일은 변경 hunk ± N줄(기본 40)만 포함하고, import 해석이 필요한 심볼만 `get_file_at_sha`로 추가 조회한다.

## Noise Budget (리뷰 피로 예산)

- PR당 finding 상한: critical/high 무제한, medium ≤ 5, low ≤ 3 (초과분은 요약 1줄로 접기).
- 같은 카테고리 finding이 3회 연속 dismissed되면 해당 카테고리 confidence 임계를 자동 상향하고 변경 사실을 감사 로그에 남긴다.
- **legacy baseline suppression**: 도입 시점에 기존 위반 스냅샷(fingerprint 집합)을 기록하고, 이후 리뷰는 신규·변경 라인의 위반만 보고한다. baseline 항목은 별도 부채 리포트로만 집계한다.
- style/formatting은 deterministic linter 결과가 있을 때 AI가 중복 지적하지 않는다.

## 비용 모델

- PR당 token budget과 model call 상한을 config로 고정하고 초과 시 리뷰를 강등(요약 모드)한다 — 조용한 절단 금지.
- diff 크기 구간별 context 정책(소형: 파일 전체 / 중형: hunk ± N / 대형: hunk만)을 문서화하고 receipt에 사용 구간을 기록한다.

## Re-review·상태 정책

- finding fingerprint는 (rule, 정규화 경로, 심볼/구조 anchor)로 계산해 rebase·라인 이동에도 유지한다 — 라인 번호를 fingerprint에 넣지 않는다.
- 사람이 resolve한 thread는 동일 fingerprint로 재오픈하지 않는다. 코드가 다시 바뀐 경우에만 새 finding으로.
- check-run 결론은 항상 `neutral` — 모델 판정이 merge를 막거나 승인하지 않는다 (사람 게이트).

## 평가 추가 항목

- baseline suppression 정확도 (legacy 위반이 신규로 오보고되는 비율)
- 대형 PR 강등 시 위험 파일 선정 recall
- fingerprint 안정성 (rebase 후 중복 comment 비율)
