# Component Spec — 도서관 열람실 좌석 예약

토큰은 `design-system.md`, 배치는 `layout-spec.md`를 따른다. 각 컴포넌트의 책임 기능과 확인 TC를 함께 적는다.

## LoginForm — FEAT-003 (PAGE-001)

- props: `onSubmit(memberId, password)`, `status: idle | submitting | error`, `errorMessage?`
- 상태: `idle` → 제출 → `submitting`(버튼 비활성·「로그인 중」) → 성공 시 `/seats` 이동 / 실패 시 `error`
- 실패: 비밀번호만 비우고 회원번호는 유지, 인라인 오류 「회원번호 또는 비밀번호가 올바르지 않습니다」(TC-003-2).
  네트워크 오류는 인라인 대신 전역 배너.
- 중복 제출 금지: `submitting` 동안 버튼 비활성(TC-003-3).
- 접근성: `label`로 두 입력을 잇고, 오류는 `aria-describedby`와 `role="alert"`. Tab·Enter만으로 완료(TC-003-4).

## SessionGuard — FEAT-001 · FEAT-007 (PAGE-000)

- 화면 요소가 없는 경계 컴포넌트. 로그인 전 `/seats` 진입을 `/login`으로 보낸다(TC-007-2).
- API 클라이언트가 인증 실패(401류)를 알리면 `/login`으로 보내고 전역 배너 「다시 로그인해주세요」(TC-007-1).
- 세션 상태 표시는 TopBar가 맡는다(회원번호 끝 4자리, 로그아웃).

## SeatGrid — FEAT-004 (PAGE-002)

- props: `seats: Seat[]`, `status: loading | ready | refreshing | empty | error`, `renderActions?(seat)` —
  액션 영역을 prop으로 열어 FEAT-005(선택)·FEAT-006(취소 트리거)이 이 컴포넌트를 고치지 않고 조합한다.
- `loading`: 같은 열 수·셀 크기의 스켈레톤(TC-004-5). `refreshing`: 이전 데이터 유지 + 제목 줄 인디케이터.
- `empty`: 「현재 예약 가능한 좌석이 없습니다」 + [다시 조회](TC-004-2).
- `error`: 마지막 정상 데이터 유지 + 배너 「좌석 정보를 불러오지 못했습니다, 다시 시도」(TC-004-6).
- 부분 실패: 실패한 좌석만 「상태 확인 불가」 셀, 나머지는 정상(TC-004-4).
- 접근성: `role="grid"`, 방향키로 셀 이동, 셀마다 상태를 담은 접근 이름(TC-004-1).

### SeatCell — FEAT-004

- props: `seat`, `state: available | mine | taken | past | unknown`, `selected`, `onSelect?`, `actions?`
- 색 + 아이콘 이중 신호(`design-system.md` 좌석 상태 토큰). `taken`·`past`·`unknown`은 선택할 수 없다.
- 누름 피드백 100ms 이내(`--duration-press`, TC-004-3).

## SlotPicker — FEAT-005

- props: `seat`, `slots: Slot[]`(오늘 남은 30분 칸), `selectedSlotId?`, `onSelectSlot`
- 좌석 선택 시 그 행 아래로 펼쳐진다(`--duration-expand`). 한 번에 한 칸만 고른다(연속 슬롯 불허, PC-007).
- 1일·동시 한도에 닿았으면 칸 대신 한도 안내를 보인다.
- 접근성: `radiogroup`, Space로 선택(TC-005-4).

### ReservationConfirmBar — FEAT-005

- props: `summary?`, `status: idle | submitting | success | conflict | timeout`, `onConfirm`
- `submitting`: 버튼 비활성 + 진행 표시. 낙관적 갱신 없이 서버 확정을 기다린다.
- `success`: 좌석이 「내 예약」으로 바뀌고 인라인 확정 메시지(TC-005-1).
- `conflict`(409류): 「다른 회원이 먼저 예약했습니다」 + 좌석 현황 자동 재조회 + 선택 초기화(TC-005-2).
- `timeout`: 진행 표시를 유지하다 재시도 안내. 같은 요청을 다시 보내지 않는다(TC-005-3).
- 접근성: 결과 메시지는 `role="status"`. Enter로 확정(TC-005-4).

## CancelDialog — FEAT-006

- props: `reservation`(좌석 번호·시간), `open`, `status: idle | submitting | failed`, `onConfirm`, `onClose`
- 확인 다이얼로그 방식은 PC-005 결정이다. 제목에 좌석 번호와 시간을 적는다. [예약 취소](danger)와 [닫기].
- 확정 → 예약 취소, 좌석이 다시 예약 가능(TC-006-1). 닫기·X·Esc → 변경 없음, 포커스는 트리거로(TC-006-2).
  파괴적 확인이라 바깥 클릭으로는 닫히지 않는다.
- 실패 → 상태를 되돌릴 필요 없음(낙관적 갱신 안 함), 실패 안내 + [다시 시도](TC-006-3).
- 접근성: `role="alertdialog"`, 포커스 가둠, 초기 포커스는 [닫기].

## StatusBanner · TopBar (PAGE-000)

- StatusBanner: `tone: error | info`, `message`, `action?`. `role="status"`, 자동으로 사라지지 않는다.
- TopBar: 서비스 이름, 회원 식별, [로그아웃]. `header` 랜드마크.

## 도메인 데이터 — FEAT-002

좌석·예약의 상태 값(`available·mine·taken·past·unknown`)과 오류 형태는 컴포넌트가 새로 정의하지 않는다.
FEAT-002의 도메인 계약을 그대로 props로 받는다 — 화면마다 다른 상태 어휘를 만들지 않는다.
