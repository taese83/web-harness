# Eval 실행 receipt

`run-eval-executor.mjs` 실행에서 `--verify-result`를 통과한 result JSON만 이곳에 커밋한다 —
`<scenario-id>/<run-id>.json`. 규약과 커밋 기준은 `.claude/evals/README.md` "실행 receipt" 절이
정본이다. transcript·fixture는 커밋하지 않는다(`eval-runs/`는 VCS 제외).

현재 receipt **1건**(2026-08-27, `complete-harness-packaging`). 규약 선언에서 실행 증거로 넘어온
첫 건이며, 그 실행 자체가 하네스 결함 5건을 뱉었다 — 배포 카탈로그 누락(`shape-checks.json`
미배포로 배포본이 프로필을 못 읽음)·죽은 dependency pin 3건·broker의 deprecated URL 오인·
target README 요구 미고지·체인 배포 시 `deployment.json` 중복. 자세한 근거는
`docs/protected-core.md` §4 "첫 eval receipt" 행.
