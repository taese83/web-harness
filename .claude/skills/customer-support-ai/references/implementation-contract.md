# Customer Support Implementation Contract

`support-contract.md`의 단계·handoff context·tool 분리를 전제로, 운영 구현 결정을 고정한다.

## Handoff 상태기계

```
bot-active → handoff-requested → queued → agent-active → resolved
                    ↘ (상담원 미응대 timeout) → callback-offered | bot-active(제한 모드)
```

- 모든 전이는 이벤트로 기록하고 `support-contract.md`의 Handoff Context 필드를 유실 없이 운반한다.
- `agent-active` 중 bot은 제안(assist)만 가능 — 고객 대면 발화 금지.
- 미응대 timeout(업무시간 기준 수치 고정)에는 대기 유지가 아니라 콜백 예약 또는 제한 모드 복귀를 **고객이 선택**한다.
- 전이 없이 상태를 건너뛰는 코드 경로가 없어야 한다 — 상태기계 밖 직접 필드 수정은 FAIL.

## 라우팅·큐

- intent·urgency·고객 등급 기반 우선순위 큐. 규칙은 config로, 모델 출력이 우선순위를 직접 결정하지 않는다(모델은 intent 후보만 제공).
- 업무시간 외: 자동화 가능 범위만 처리하고 나머지는 콜백/티켓 전환을 명시 안내한다.

## 측정 루프

- **deflection 정의를 고정한다**: 사람 개입 없이 종결 + 재문의 없음(N일) + CSAT 임계 이상. "봇이 응답함"을 deflection으로 세지 않는다.
- CSAT는 세션 종결 직후 1회 수집, 채널별 응답률을 함께 보고한다.
- **KB freshness 루프**: no-answer·낮은 CSAT·상담원 정정 사례를 주기 클러스터링해 KB 갱신 백로그로 만든다. 이 루프가 없으면 답변 품질은 KB 부패 속도로 하락한다.

## 다국어 정책

- 세션 시작 시 응대 언어를 감지·고정하고 중간 혼용 입력에도 응대 언어를 유지한다.
- 미지원 언어는 추측 응대하지 않고 지원 언어 안내 + 사람 연결을 제안한다.

## REALTIME_VOICE_MODE 계약 (범위 명시)

현재 하니스는 voice **구현 builder를 제공하지 않는다** — 이 mode는 설계 산출물 요구사항으로만 존재한다. mode 활성 시 `ai-architecture.md`에 다음이 없으면 구현 진입 전 `BLOCKED`:

- STT/TTS provider는 model gateway와 같은 server-side adapter 뒤에 둔다 (browser 직결 금지)
- barge-in: 고객 발화 감지 시 TTS 즉시 중단, 중단 지점 상태 보존
- latency budget: first-audio 목표 수치와 측정 방법
- 녹취: 동의 고지 시점, 보존 기간, PII redaction — `data-governance.md`와 일치
- warm handoff: 음성 세션의 transcript·요약이 텍스트 handoff와 같은 완전성 계약을 만족

구현은 별도 승인·범위 산정 후 진행하며, 이 계약 없이 voice를 "지원"으로 표현하지 않는다.

## 평가 추가 항목

- 상태기계 전이 무결성 (기록 없는 전이 0)
- deflection 정의 준수율 (오집계 감사)
- KB 루프 처리량 (클러스터 → 갱신 반영 lead time)
