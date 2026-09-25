# Design System — 도서관 열람실 좌석 예약

## 방향 (시안 확정)

- 커밋 방향: **「조용한 열람실」** — 흰 바탕, 차분한 청록 단일 accent, 표준 밀도, 라이트 모드만.
- 기각 방향: 「신호등」(원색 셋이 경쟁해 좌석 스캔이 느려진다), 「다크 콘솔」(다크 모드 불필요 결정과 충돌).
- 근거: `ux-brief.md` Design Direction의 ASSUMPTION(공공기관 톤·단일 accent·표준 밀도·다크 모드 없음)을
  시안 왕복에서 확정했다. 좌석 상태는 색만으로 구분하지 않는다 — 색 + 아이콘 이중 신호(TC-004-1).

## 색 토큰

| 역할 | 토큰 | 값 | 비고 |
|---|---|---|---|
| 바탕 | `--color-bg` | `#FFFFFF` | |
| 표면 | `--color-surface` | `#F4F7F7` | 카드·바텀 바 |
| 본문 | `--color-text` | `#1B2426` | 바탕 대비 15.6:1 |
| 보조 본문 | `--color-text-muted` | `#55646A` | 바탕 대비 6.0:1 |
| accent | `--color-accent` | `#0F766E` | 주요 버튼·포커스 |
| accent 위 글자 | `--color-on-accent` | `#FFFFFF` | 5.5:1 |
| 오류 | `--color-danger` | `#B91C1C` | |
| 성공 | `--color-success` | `#15803D` | |

## 좌석 상태 토큰 (색 + 아이콘)

| 상태 | 토큰 | 색 | 아이콘 | 접근 이름 |
|---|---|---|---|---|
| 예약 가능 | `--seat-available` | `#0F766E` 테두리·연한 채움 | 빈 원 | 「A-12 예약 가능」 |
| 내 예약 | `--seat-mine` | `#1D4ED8` 채움 | 별 | 「A-12 내 예약 10:00~10:30」 |
| 다른 회원 예약 | `--seat-taken` | `#9CA3AF` 채움 | 가위표 | 「A-12 예약됨」 |
| 지난 시간 | `--seat-past` | `#E5E7EB` 빗금 | 없음 | 「A-12 지난 시간」 |
| 상태 확인 불가 | `--seat-unknown` | `#F59E0B` 점선 테두리 | 물음표 | 「A-12 상태 확인 불가」 |

## 타이포그래피·간격·모서리

- 글꼴: `Pretendard, system-ui, sans-serif`. 크기 14 / 16(본문) / 20 / 24, 줄 높이 1.5.
- 간격: 4px 단위(4·8·12·16·24·32). 터치 대상 최소 44×44px.
- 모서리: 카드 8px, 좌석 셀 6px, 칩 999px.

## 모션

| 역할 | 토큰 | 값 |
|---|---|---|
| 누름 피드백(인터랙션) | `--duration-press` | 100ms |
| 슬롯 인라인 확장(인터랙션) | `--duration-expand` | 200ms |
| 스켈레톤 반복 주기(주기) | `--duration-skeleton-period` | 1400ms |

반복 모션은 주기 토큰만 쓴다 — 인터랙션 토큰을 빌리지 않는다. `prefers-reduced-motion: reduce`이면 확장은 즉시,
스켈레톤은 정지한 회색 면이다.

## 포커스

- 모든 조작 요소: `outline: 2px solid var(--color-accent)`, `outline-offset: 2px`. 좌석 셀도 같다.

## 컴포넌트 인벤토리

Button(primary·secondary·danger) · TextField · InlineError · StatusBanner(error·info) · Skeleton · SeatCell ·
SlotChip · BottomBar · Dialog · TopBar. 명세는 `component-spec.md`.
