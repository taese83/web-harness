// 프리뷰 전용 상태 — 실제 API가 아니라 고정 fixture로 화면 상태를 바꾼다.
export const fixtures = {
  normal: [
    {id: 'A-01', state: 'available'}, {id: 'A-02', state: 'taken'}, {id: 'A-03', state: 'mine', time: '10:00~10:30'},
    {id: 'A-04', state: 'past'}, {id: 'A-05', state: 'unknown'}, {id: 'A-06', state: 'available'},
    {id: 'A-07', state: 'available'}, {id: 'A-08', state: 'taken'},
  ],
  slots: ['14:00~14:30', '14:30~15:00', '15:00~15:30', '21:30~22:00'],
}
export const state = {seatView: 'normal', selectedSeat: null, selectedSlot: null, confirm: 'idle', dialogOpen: false, loggedIn: false}
