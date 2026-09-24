# Spawn Decomposition Contract — 큰 빌더 스폰의 분해·발췌 주입·재개

`execution-budget-contract.md`의 규칙 1~3이다. **산출물을 여러 개 쓰는 빌더 스폰(구현·프리뷰·설계 빌더)을
계획할 때** 읽는다. 스폰 수·telemetry·완결성 게이트·규칙 4·5(즉시-쓰기·축소-스코프 재개)는 그 계약에 있다.

per-spawn 규모 임계(Layer 3)와 무산출 가드는 runaway를 **사후 검출**한다. 아래 규칙 1·2는
스폰 전에 **예방**하고(기계 게이트 `validate-spawn-plan.mjs`), 규칙 3은 이미 난 truncate에서
**복구**한다(`resume-manifest.mjs`). runaway는 기능 단위에선 드러나지 않고 서비스 규모에서만 나타나며, 상례가 아니라 예외지만 1회당 비용이 크다.

1. **출력 단위를 계층이 아니라 파일/작은 묶음으로 분해한다.** 한 스폰에 "도메인 계층
   전체"(command 10개)나 "컴포넌트 전체"를 요구하지 않는다.
   각 스폰은 `--expect`로 그 스폰의 선언
   산출물을 명시해 완결성 게이트가 부분 완성을 정확히 판정하게 한다.
2. **스펙 재독 세금을 오케스트레이터가 흡수한다.** 빌더가 분할 설계 산출물을 40~60번
   tool call로 다시 읽고 나서야 쓰기 시작하는 것이 재독 세금이다. 오케스트레이터가 관련
   절을 **한 번 읽고 프롬프트에 발췌를 주입**한다("아래 요약이면 충분, 재독 금지"). 빌더는
   0번 읽고 바로 쓴다. 발췌가 불완전할 위험은 있으나, 재독 runaway로 산출물 0개가 되는
   비용이 더 크다(무산출 가드로 잡히지만 예산은 이미 소진).

   **규칙 1·2는 기계 게이트다 — 산문 준수에 맡기지 않는다**. 큰 빌더 스폰 **전에** 매니페스트에 `outputs`와 `reads`를 선언하고 판정한다:

   ```bash
   node .claude/scripts/validate-spawn-plan.mjs --project {root} --plan _workspace/03_dev/build-manifest/<task>.json
   ```

   `REFUSE`(exit 1)면 그대로 스폰하지 않는다 — 산출물을 나누거나 발췌 주입으로 read 범위를
   줄이고 다시 판정한다.

   **규칙 1과 2는 묶여 있다 — `readMode`로 선언한다.** 게이트는 선언된 범위의 바이트만
   잰다 — `reads` 선언 폭이 판정을 지배한다. 그래서 **좁은 선언은 규칙 2를 실제로 적용할
   때만 정직하다**:

   - `"readMode": "injected"` — 오케스트레이터가 관련 절을 발췌해 프롬프트에 주입하고
     **재독을 금지**했을 때만 쓴다. 이때 reads는 문자 그대로 측정된다. 이 값은 자기진술이다.
   - `"readMode": "browse"`(기본·생략 시) — 빌더가 스펙을 직접 읽는다. 파일 단위 선언은
     **담긴 디렉터리로 전개**된다(빌더는 한 파일만 읽지 않고 트리를 훑는다).

   browse에서도 **어느 디렉터리를 선언하느냐는 여전히 사람의 선언**이다 — 빌더를 설계 트리
   전체에 풀어놓을 거면 그 트리를 적어야지 샤드 하나만 적으면 안 된다. 발췌 주입 없이
   좁게 선언하는 조합이 게이트를 합법적으로 통과하는 실패 경로다. 좁힐 자신이 없으면 `injected`가 아니라 넓은 `browse`로 적는다.

   **한계**: 선언과 무관하게 잡히는 것은 OUTPUT_FANOUT뿐이다 — READ_BUDGET은 **사람이
   정직하게 넓은 reads(`_workspace/02_design` + `01_plan` 전체)를 선언**해야 잡힌다.

   임계 기본값은 산출물 8개 · read 추정 60k 토큰이며 `--max-outputs`/`--max-read-tokens`로
   조정한다(완화는 의식적 행위 — 사유를 남긴다. bash 정책이 **상한을 강제한다: outputs ≤32 ·
   read ≤200,000 tokens** — 그 위 값은 명령 자체가 거부되므로 임의로 크게 잡아 게이트를
   무력화할 수는 없다). **한계**: 임계는 단일 서비스 실측으로 교정한 값이라 형태가 다른
   서비스에서는 재교정이 필요하고, runaway 발생률을 낮추는지는 아직 측정 전이다.
3. **재개 가능한 빌드 (기계화).** 스폰이 truncate되면
   이미 쓴 파일은 유지된다. 큰 빌더 작업은 시작 전에 **매니페스트 파일**(`{task, outputs:[...]}`)
   을 `_workspace/03_dev/build-manifest/<task>.json`에 남긴다 — 이 파일이 영속된 빌드 계획이다.
   truncate 후 재스폰 판단은 손이 아니라 기계로 한다:
   ```bash
   node .claude/scripts/resume-manifest.mjs --project {root} --manifest _workspace/03_dev/build-manifest/<task>.json --json
   ```
   이 명령이 각 선언 산출물을 done/truncated/missing으로 분류하고 **remaining(= missing ∪
   truncated)만** 돌려준다. 재스폰 프롬프트에는 그 remaining만 지정한다(전체 재작성 금지 —
   완성분을 덮어써 오히려 truncate 위험을 키운다). remaining이 0이면 작업 완결이다.

   **계획을 스폰 전에 잠근다(`--lock`).** outputs가 자기선언인 한, 빌더가 죽은 뒤 매니페스트를
   실제로 쓰인 파일에 맞춰 줄이면 COMPLETE가 나온다(사후 축소). fit 게이트를 통과할 때
   `--lock`을 붙이면 계획 내용의 digest가 매니페스트에 박히고, `resume-manifest`가 이를
   대조해 **TAMPERED(exit 1, fail-closed)**로 잡는다. 잠금이 없으면 "검증되지 않은
   자기선언"이라고 정직하게 보고한다 — 큰 빌더 스폰은 반드시 잠그고 시작한다.

   ```bash
   node .claude/scripts/validate-spawn-plan.mjs --project {root} --plan <manifest> --lock
   node .claude/scripts/resume-manifest.mjs --project {root} --manifest <manifest> --owned <owned prefix...>
   ```

   `--owned`를 주면 소유 범위의 실제 파일과 선언 목록을 대조해 **선언되지 않은 산출물**을
   보고한다(매니페스트가 현실과 어긋났다는 신호).

   잠금 증거는 매니페스트 **바깥**의 append-only 원장(`.plan-locks.jsonl`)에 남는다.
   원장은 **최초 잠금과 대조**하므로 `planLock` 삭제·축소 후 재잠금이 둘 다 TAMPERED로 잡히고 재잠금은
   `relocked`로 드러난다. 나아가 `--lock`은 **다른 digest의 잠금이 이미 있으면 재잠금을
   거부**한다(exit 2) — 사후 탐지보다 강한 사전 차단이며, 범위를 바꾸려면 새 task로 재계획해야
   한다.

   **한계**: 원장과 `planLock`을 **둘 다 지운 뒤 다시 잠그면** 위조된 `locked`가 성립한다 — 로컬
   증거는 tamper-**evident**이지 tamper-proof가 아니며, 이 경로는 기계가 아니라
   **비협상 규칙**(CLAUDE.md "로컬에서 서명 증거 위조 금지")이 막는다.

## 일반화 근거

- **웹 앱 구현 스폰**(`developer`, 모듈 경계마다) — 산출물 8개·read 60k 토큰 임계는 단일 서비스 실측으로 교정했다.
  형태가 다른 서비스에서는 재교정이 필요하다(규칙 2 한계).
- **프리뷰·설계 빌더**(`design-preview-builder`·분할 설계 산출물) — 같은 매니페스트·잠금·재개 절차가 파일 목록만
  바꿔 성립한다. 명명 수준 — 이 형태의 runaway 발생률은 측정 전이다.
