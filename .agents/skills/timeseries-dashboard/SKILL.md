---
name: timeseries-dashboard
description: Designs and implements production-oriented time-series dashboards for high-volume historical and realtime data. Use for Grafana-like dashboards, metric charts, date-range exploration, live telemetry, WebSocket/SSE streams, chart performance, downsampling, reconnect/resume behavior, realtime mocks, or migration from mock streams to real APIs.
argument-hint: "[dashboard requirements or existing project path]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, Agent, AskUserQuestion
metadata:
  version: 1.0.0
  maturity: eval-covered
  updated: 2026-07-27
  changelog: 최초 버저닝 — adapter 재생성·검증 체계 도입과 함께 일괄 부여.
---

# Timeseries Dashboard

시계열 대시보드의 데이터 예산, historical snapshot, realtime stream, 차트 렌더링, Mock 전환을 하나의 계약으로 설계하고 구현한다.

항상 `references/detection-contract.md`와 `references/intake-and-slos.md`를 읽는다. 기존 프로젝트를 수정하면 `.claude/skills/web-orchestrator/references/minimal-change-contract.md`도 읽는다. API/stream 설계 전 `references/streaming-contract.md`, 차트 구현 전 `references/chart-performance.md`, Mock 또는 실제 연결 작업 전 `references/mock-and-migration.md`를 읽는다.

## Start

`/timeseries-dashboard`를 단독 호출하면 다음 정보를 한 번에 확인한다.

1. dashboard 사용자와 핵심 지표
2. 최대 series 수, 초당 point 수, 화면 표시 point 수
3. historical 조회 기간과 집계 resolution
4. realtime latency와 화면 갱신 주기
5. WebSocket/SSE/polling 지원 여부
6. timezone, 누락·중복·역순 데이터 처리
7. zoom/brush/crosshair/live pause/export/alert 요구
8. 목표 browser/device와 memory/CPU 예산
9. 실제 API 또는 backend 제약

모르는 값은 `references/intake-and-slos.md`의 보수적 baseline을 제안하고 `ASSUMPTION`으로 기록한다. 처리량, 표시량, transport가 모두 불명확하면 구현 전에 한 번 더 확인한다.

## 적용 모드

- **신규 프로젝트**: `/web-orchestrator`의 조건부 timeseries branch로 실행한다.
- **기존 프로젝트**: 현재 `_workspace`, source, package, API client를 읽고 change brief의 `ALLOWED_PATHS`에 해당하는 owner agent만 실행한다.
- **설계 전용**: `timeseries-architect`까지만 실행하고 구현을 중단한다.
- **실제 연결**: Mock transport가 완성된 뒤 `/api-connect`와 이 skill의 migration contract를 함께 적용한다.

## Workflow

1. `requirements-analyst`가 데이터 규모와 SLO를 `requirements.md`에 반영한다.
2. `feature-planner`가 time-range, chart-panel, live-mode, stream-status slice를 설계한다.
3. `tech-advisor`가 chart/transport/worker 선택과 compatibility를 확정한다.
4. `timeseries-architect`가 `_workspace/02_design/timeseries-architecture.md`를 생성한다.
5. 다음 agent가 architecture 문서를 입력으로 사용한다.
   - `api-schema-designer`
   - `component-designer`
   - `entity-query-builder`
6. `shared-foundation-builder`가 공통 timestamp schema를 만든 뒤 `realtime-data-builder`가 transport adapter, buffer, merge, reconnect 계층을 구현한다.
7. `mock-api-builder`가 완성된 transport interface를 사용해 deterministic realtime fake를 구현한다.
8. `component-builder`와 `data-ui-binder`가 차트 UI와 historical/live 데이터를 연결한다.
9. `test-writer`가 stream correctness와 고부하 경계 테스트를 작성한다.
10. `timeseries-verifier`가 stream 계약·bounded buffer·재연결 복구·Mock 격리·성능 evidence를 단일 판정(`qa-timeseries.md`)으로 통합하고, `api-contract-verifier`, `browser-verifier`, `integration-verifier`가 계약·장시간 실행·성능 budget을 보조 검증한다.

## Hard Stops

- 최대 series/point/update-rate 중 어떤 값도 추정할 근거가 없음
- backend가 resume cursor나 historical recovery를 지원하지 않는데 무손실 표시를 요구함
- client에서 원본 전체 데이터를 무제한 보존하도록 요구함
- 실제 production stream에 credential 또는 mutation이 필요한데 승인되지 않음
- 요구 SLO가 선택한 browser/device에서 측정상 달성 불가능함

## 완료 조건

- `timeseries-architecture.md`에 데이터 budget과 snapshot+stream 계약이 있다.
- visible point 수와 memory가 bounded이고 무제한 배열 누적이 없다.
- disconnect/reconnect/resume/gap/duplicate/out-of-order 동작이 정의되고 테스트된다.
- historical 조회와 live stream이 동일 runtime schema와 timestamp 정책을 사용한다.
- Mock과 real transport가 같은 adapter interface를 구현한다.
- HANDOFF에 실제 endpoint, 인증, cursor, 운영 SLO 전환 가이드가 있다.
