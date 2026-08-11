# AI Evaluation Ladder

## Stage 0 — Baseline

기존 skill, agent, ownership, verifier 경계를 검증한다.

## Stage 1 — Foundation

AI manifest, 공통 skill·agent, 필수 설계 산출물, server secret 경계를 검증한다.

## Stage 2 — Routing

한국어·영어 prompt가 올바른 AI submode와 서비스 skill로 연결되는지 검증한다.

## Stage 3 — Service Contracts

서비스별 builder, tool policy, 최소 scenario 수와 완료 조건을 검증한다.

## Stage 4 — Policy

browser secret, direct provider call, approval 없는 side effect, verifier mutation을 synthetic input으로 차단하는지 검증한다.

## Stage 5 — Eval Contracts

scenario schema, risk, assertion type, evidence requirement를 검증한다.

## Stage 6 — Isolated Execution

각 prompt를 깨끗한 fixture에서 실제 실행한다. 생성 파일, command log, trace, tool call, approval을 수집한다.

## Stage 7 — Quality and Release

deterministic assertion, domain metric, 필요 시 LLM grader를 실행하고 threshold와 비교한다.

## Result 최소 schema

    {
      "scenarioId": "example",
      "status": "PASS | FAIL | BLOCKED",
      "versions": {
        "model": "...",
        "prompt": "...",
        "workflow": "..."
      },
      "assertions": [
        {
          "id": "example-assertion",
          "status": "PASS | FAIL | BLOCKED",
          "evidence": ["path, trace ID, command, or measured value"]
        }
      ]
    }

PASS에는 비어 있지 않은 evidence가 필요하다. Critical scenario의 BLOCKED는 release PASS로 계산하지 않는다.
