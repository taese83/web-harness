# Eval 실행 receipt

`run-eval-executor.mjs` 실행에서 `--verify-result`를 통과한 result JSON만 이곳에 커밋한다 —
`<scenario-id>/<run-id>.json`. 규약과 커밋 기준은 `.claude/evals/README.md` "실행 receipt" 절이
정본이다. transcript·fixture는 커밋하지 않는다(`eval-runs/`는 VCS 제외).

현재 receipt 0건 — 이 디렉터리의 존재는 규약 선언이지 실행 증거가 아니다(I1).
