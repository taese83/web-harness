# QA And Evidence Contract

Phase 4와 `/web-verify` 시작 전에 읽는다.

## Verifier immutability

Verifier는 source, test, config, package, lockfile, snapshot, generated app을 수정하지 않는다. structured finding과 report content만 반환하고 orchestrator가 `_workspace/04_qa`에 저장한다.

- update snapshot, auto-fix, formatter write 명령을 실행하지 않는다.
- finding마다 likely owner와 재현 가능한 file/error context를 포함한다.
- `existing-change`이면 code review가 change brief의 허용 경로·보존 contract·non-goal과 실제 diff를 대조한다.
- test infrastructure는 `environment-scaffolder`, product test는 `developer`, 구현 수정은 해당 owner에게만 라우팅한다.
- verifier가 PASS를 만들기 위해 실패 대상을 고치지 않는다.

## Deterministic command evidence

test infrastructure와 test file이 존재한 뒤 실행한다.

```bash
node .claude/scripts/run-quality-gates.mjs --all --allow-host-execution
```

- build, typecheck, lint, unit, coverage, browser, production audit를 runner가 직접 실행한다.
- required script 없음과 test file 0개는 `BLOCKED`다.
- receipt는 실제 command, package script argv digest, cwd, exit, runtime compatibility, output hash, discovered tests, source fingerprint, full effective `node_modules` content·metadata·virtual-store package-link·`.bin` graph와 실제 store binary binding을 기록한다. project workspace symlink는 승인 root와 target-tree digest 계약 전까지 차단한다. package script는 검증된 binary를 argv로 직접 실행하며 secret 영속화를 막기 위해 stdout/stderr tail은 저장하지 않는다.
- final release receipt는 하나의 `--all` cohort와 public build-environment digest를 공유하고 24시간을 넘기지 않는다. single-check receipt는 진단용이며 release evidence가 아니다.
- profile build는 기존 selected artifact를 먼저 제거한 clean build여야 한다. build는 promoted runtime data를 포함한 protected source를 변경할 수 없고 selected deployment artifact만 다시 만들 수 있다. exact protected root를 예외로 선언할 수 없다.
- 다른 source mutation은 receipt 실패다.
- source, design, test, package, workflow, version 변경은 이전 receipt와 manifest를 stale로 만든다.
- local host 실행은 사용자 승인 flag가 필요하며 진단용이다. 격리 CI는 `WEB_HARNESS_ISOLATED_EXECUTION=1`을 주입하고 실제 filesystem/network/process/frozen-install isolation을 CI 정책으로 증명한 뒤 외부 attester가 cohort·source·trust-config·receipt digest와 repository/revision/workflow/issuer provenance를 Ed25519로 서명한다.

## Report contract

- 각 Markdown report의 `## Result`에는 단일 status만 둔다.
- command를 인용하면 `| Check | Command | Exit Code | Status |` 표를 사용한다.
- 표의 command/exit/status는 `evidence/{check}.json`과 일치해야 한다.
- `qa-manifest.json` schema v3는 release gate script만 real parent·regular file 검사, exclusive mode `0600` temp write, atomic rename으로 생성하며, 신뢰할 수 있는 격리 CI attester의 Ed25519 서명을 필수로 한다.
- unsigned request, trust root, signed envelope는 각각 `quality-attestation-request.schema.json`, `quality-attesters.schema.json`, `quality-attestation.schema.json`을 따른다. trust key는 canonical SPKI Ed25519 public-key PEM만 허용한다. checkout 밖의 보호된 trust-config digest와 CI identity가 없으면 release는 `BLOCKED`다. request 자체를 곧바로 서명하지 않고 외부 attester가 claims를 독립 검증해 final subject를 구성한다. private key나 보호된 control-plane environment는 project filesystem·project child process에 주입하지 않는다.
- 모델 기억이나 terminal 화면 요약은 machine evidence가 아니다.

## Conditional QA

- state contract가 있으면 `qa-state.md`
- ingestion/runtime data contract가 있으면 `qa-data-quality.md`
- AI architecture가 있으면 AI eval, security, data access, cost/latency, trace reports
- performance budget이 있으면 `qa-perf.md`; browser receipt가 제공하지 않은 runtime 지표는 `NOT_MEASURED`이며 PASS로 승격하지 않는다
- SEO spec이 있으면 `qa-seo.md`
- timeseries architecture가 있으면 `qa-timeseries.md`; normal/max/burst, reconnect/resume/gap, buffer, cadence, interaction latency, heap trend evidence를 포함한다
- visual contract가 있으면 `qa-visual.md`와 browser receipt의 `visualEvidence`; 승인 baseline manifest와 현재 PNG hash가 일치해야 한다

## Retry and release

- FAIL은 `retry-policy.md`에 따라 가장 작은 owner set에 라우팅한다.
- 수정 뒤 quality runner와 영향받은 verifier를 다시 실행한다.
- 필수 report/receipt 누락, stale fingerprint, mixed/expired cohort, dependency graph drift, FAIL, BLOCKED, NEEDS_REVIEW는 release hard stop이다.
- ACL leak, approval bypass, unauthorized side effect, data loss 가능성은 재분류로 우회하지 않는다.
- version/changelog/deploy 변경은 final evidence 전에 완료한다.
- manifest가 현재 source와 일치하고 `releaseStatus: PASS`일 때만 HANDOFF를 만든다.

## Iterate evidence (경량 라운드)

`execution-contract.md`의 Iterate mode 라운드는 release-grade attestation을 만들지 않는다. 대신 변경을 실제로 구동해 관측한 경량 증거를 change-scope의 `TEST_EVIDENCE`에 남긴다. 이 증거는 release evidence를 대체하지 않으며 배포 후보에서는 위 full runner로 승격한다.

- **게이트**: 프로젝트 toolchain pin(`.nvmrc`)으로 typecheck·lint·test·build (`development-gates-contract.md`의 toolchain pin 규약). 낮은 Node에서 나온 green은 증거로 인정하지 않는다.
- **브라우저 스모크(관측 가능한 변경)**: dev/preview에서 대상 화면을 구동하고 **snapshot의 실제 콘텐츠**로 확인한다(콘솔 로그가 아니라). stale HMR은 `operational-gotchas.md`의 dev-server 신뢰 규약대로 하드 리로드 후 판정한다. 인증 뒤·serverless·server DB·sensor 경로는 `execution-contract.md`의 Runtime verifiability(`LOCAL_VERIFIABLE`/`DEPLOY_ONLY`)를 따르고 미검증 경로를 표면 PASS로 보고하지 않는다.
- **생성 바이너리 자산(아이콘·이미지 등)**: `file`이 "정상 PNG"로 통과해도 내용은 blank/잘림일 수 있다 — **치수·픽셀 분포(예상 색 비율 등)·전송 SHA-256(생성원↔디스크)**을 대조하고, 배포에 복사되는 자산은 source↔dist 해시 일치를 확인한다. 큰 base64는 셸로 손복사하지 말고 파일 경유로 전달하며 SHA mismatch면 청크로 재전송한다. (실사고: 512 PNG가 하단 잘림·투명으로 생성됐고 `file`은 통과했으며, 단일 붙여넣기 손상을 SHA 가드가 잡았다.)
- 경량 증거는 재현 절차(무엇을 구동해 무엇을 봤는지)를 한 줄로 남긴다. 모델 기억·화면 요약만으로 PASS하지 않는다.
- **기존 receipt의 재발급**: 프로젝트에 이미 `_workspace/04_qa/evidence/`가 있으면, 경량 라운드도 소스를 바꾼 뒤 `run-quality-gates.mjs --project {root} --all`로 receipt를 재발급한다. attestation·manifest는 만들지 않지만 **receipt를 stale로 남기지도 않는다** — receipt는 발급 시점 소스에 fingerprint로 결속되므로, 소스를 고치고 그대로 두면 그 시점부터 저장된 모든 evidence가 검증 불가가 된다. 재발급이 불가한 환경이면 완료 보고에 `QA evidence: STALE (재발급 필요)`를 명시하고 완료로 선언하지 않는다.
- **승격 QA**: change-scope의 `CAPABILITY_ESCALATION`이 `detected`면 경량 라운드에서도 `security-reviewer`(서버 계약이 생겼으면 `api-contract-verifier`도) 재투입이 의무다. 자세한 조건은 `execution-contract.md`의 **Iterate round exit gates**가 canonical이다.

## Dev server note

승인된 외부 실행 context에서 시작한 server는 같은 context에서 smoke check한다. sandbox curl이 실패하면 Vite ready 출력만으로 앱 실패를 단정하지 말고 listening process와 실행 namespace를 확인한다.
