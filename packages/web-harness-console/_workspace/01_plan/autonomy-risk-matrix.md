# Autonomy Risk Matrix — Codex Change Request Bridge

| Action | Risk | Level | Required gate | Automatic retry |
|---|---|---|---|---|
| Codex 연결 상태 조회 | Low | L0 | loopback GET | n/a |
| Change Request 영향 분석 | Low | L1 | user click, read-only sandbox | 0 |
| 기획·TC·디자인·Preview 수정 | High | L2 | completed impact + explicit apply confirmation | 0 |
| apply 결과 승인·수정 요청·폐기 기록 | Medium | L2 | READY_FOR_REVIEW + explicit decision dialog | 0 |
| 수정 요청 반영 apply | High | L2 | persisted revision feedback + explicit apply confirmation | 0 |
| commit/push/PR/deploy/delete | Prohibited | L4 | unavailable | 0 |

## Approval contract

- 요청 등록은 실행 승인이 아니다.
- impact와 apply는 서로 다른 사용자 action과 서로 다른 Codex session이다.
- apply dialog는 target, impact summary, 예상 artifacts, current base drift를 보여주고 실행 권한을 설명한다.
- unknown state, timeout, connection loss에는 재실행 button만 제공하고 자동 retry는 하지 않는다.
- `APPROVED|DISCARDED`는 terminal이며 새 Codex run을 허용하지 않는다. `DISCARDED`는 모델이나 Git restore를 자동 실행하지 않는다.
