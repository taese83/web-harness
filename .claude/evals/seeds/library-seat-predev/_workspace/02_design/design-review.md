# Design Review — 도서관 열람실 좌석 예약

판정: **PASS** — 구현 전에 사용자가 정할 디자인 결정이 남아 있지 않다.

| 관점 | 판정 | 근거 |
|---|---|---|
| 정보 위계 | PASS | `/seats`의 Primary 셋(예약 가능 좌석·내 예약·선택 좌석의 남은 칸)이 위에서 아래 순서로 놓였다(`layout-spec.md` /seats 1~4) |
| 레이아웃 안정성 | PASS | 스켈레톤이 그리드와 같은 열 수·셀 크기, 빈 상태·오류는 그리드 자리 안에서 교체, 바텀 바 높이만큼 여백 |
| 상호작용 상태 | PASS | 예약 확정 `submitting·success·conflict·timeout`, 취소 `idle·submitting·failed`, 로그인 `idle·submitting·error`가 전부 명세됐다 |
| 접근성 | PASS | 색 + 아이콘 이중 신호, 44px 터치 대상, `role="grid"` 방향키 이동, 취소는 `alertdialog`·포커스 복귀, 오류는 `role="alert"` |
| 모션 | PASS | 반복 모션(스켈레톤)은 주기 토큰 1400ms, 인터랙션 토큰을 빌리지 않는다. reduced-motion 처리 있음 |
| 일관성 | PASS | 좌석 상태 어휘를 FEAT-002 도메인 계약 하나로 쓴다(`component-spec.md` 도메인 데이터) |

## 우선 결정 사항

없음. 기획 단계의 정책 결정 3건은 PC-007로, plan-review D1·D3는 PC-008로 처분됐다(새로고침 버튼·마지막 갱신 시각은
FEAT-004 화면 요소로 반영). API 계약·409 스펙·노쇼 정책은 production 연결 전 확보 대상이다 — 디자인 결정이 아니다.

## Preview Approval

### 2026-09-25T05:59:14.418Z

- Status: APPROVED
- Mode: prototype
- Approval: 사용자가 프리뷰에서 로그인·좌석 현황·예약·취소 흐름을 확인하고 승인했다(평가 시드)
- Recorded via: harness-session
- Source digest: `8d3c7f0d6ffda9b1c2b5175e7c1c53ebb2d8c36c73f03ae9187c8b0d1358841d`
- Preview digest: `da1ace220b4de7d0ca1050f8ca6d12a21858f44cf8516c5aa5f2e44cd32b376e`
- Traceability digest: `2e10363e549bb0c1c64b5155b7e839b527ef3fc411995625c6807fad2c865217`
- Test cases: TC-001-1, TC-001-2, TC-001-3, TC-002-1, TC-002-2, TC-002-3, TC-003-1, TC-003-2, TC-003-3, TC-003-4, TC-004-1, TC-004-2, TC-004-3, TC-004-4, TC-004-5, TC-004-6, TC-005-1, TC-005-2, TC-005-3, TC-005-4, TC-006-1, TC-006-2, TC-006-3, TC-007-1, TC-007-2

<!-- web-harness-preview-approval
{"schemaVersion":1,"mode":"prototype","approvedAt":"2026-09-25T05:59:14.418Z","approvalText":"사용자가 프리뷰에서 로그인·좌석 현황·예약·취소 흐름을 확인하고 승인했다(평가 시드)","recordedVia":"harness-session","sourceDigest":"8d3c7f0d6ffda9b1c2b5175e7c1c53ebb2d8c36c73f03ae9187c8b0d1358841d","previewDigest":"da1ace220b4de7d0ca1050f8ca6d12a21858f44cf8516c5aa5f2e44cd32b376e","traceabilityDigest":"2e10363e549bb0c1c64b5155b7e839b527ef3fc411995625c6807fad2c865217","testCaseIds":["TC-001-1","TC-001-2","TC-001-3","TC-002-1","TC-002-2","TC-002-3","TC-003-1","TC-003-2","TC-003-3","TC-003-4","TC-004-1","TC-004-2","TC-004-3","TC-004-4","TC-004-5","TC-004-6","TC-005-1","TC-005-2","TC-005-3","TC-005-4","TC-006-1","TC-006-2","TC-006-3","TC-007-1","TC-007-2"]}
-->
