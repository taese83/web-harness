import {fixtures, state} from './store.js'
import {current} from './router.js'

const a = (anchor, feature, tests) => `data-wh-anchor="${anchor}" data-wh-feature="${feature}" data-wh-tests="${tests}"`

const topBar = () => `
<header>
  <strong>열람실 좌석 예약</strong>
  <span ${a('wh-feat-001-session', 'FEAT-001', 'TC-001-1 TC-001-2 TC-001-3')}>회원 ****1234 · <button class="secondary">로그아웃</button></span>
</header>
<div role="status" ${a('wh-feat-007-expired-banner', 'FEAT-007', 'TC-007-1 TC-007-2')} class="banner" hidden>다시 로그인해주세요</div>`

const login = () => `
${topBar()}
<main id="main">
  <form class="card" ${a('wh-feat-003-form', 'FEAT-003', 'TC-003-1 TC-003-4')}>
    <label class="field">회원번호 <input name="memberId" autocomplete="username"></label>
    <label class="field">비밀번호 <input name="password" type="password" autocomplete="current-password"></label>
    <p class="error" role="alert" ${a('wh-feat-003-error', 'FEAT-003', 'TC-003-2')}>회원번호 또는 비밀번호가 올바르지 않습니다</p>
    <button class="primary" type="submit" ${a('wh-feat-003-submit', 'FEAT-003', 'TC-003-3')}>로그인</button>
  </form>
</main>`

const selectAnchor = a('wh-feat-005-select', 'FEAT-005', 'TC-005-4')
const seatCell = seat => `<button class="seat ${seat.state}" aria-label="${seat.id} ${seat.state}" ${seat.id === 'A-01' ? selectAnchor : ''}>${seat.id}</button>`

const seats = () => `
${topBar()}
<main id="main">
  <h1>오늘 좌석 <small>10:05 갱신</small> <button ${a('wh-feat-004-refresh', 'FEAT-004', 'TC-004-6')}>새로고침</button></h1>
  <ul ${a('wh-feat-002-legend', 'FEAT-002', 'TC-002-1 TC-002-2 TC-002-3')}><li>예약 가능</li><li>내 예약</li><li>예약됨</li><li>지난 시간</li><li>상태 확인 불가</li></ul>
  <p>내 예약 A-03 10:00~10:30 <button class="danger" ${a('wh-feat-006-cancel', 'FEAT-006', 'TC-006-1 TC-006-2 TC-006-3')}>취소</button></p>
  <div class="grid" role="grid" ${a('wh-feat-004-grid', 'FEAT-004', 'TC-004-1 TC-004-3')}>
    ${fixtures.normal.map(seatCell).join('')}
    <div class="slots" role="radiogroup" aria-label="A-01 이용 시간">${fixtures.slots.map(slot => `<label><input type="radio" name="slot"> ${slot}</label>`).join('')}</div>
  </div>
  <div class="grid" aria-hidden="true" ${a('wh-feat-004-skeleton', 'FEAT-004', 'TC-004-5')}><div class="skeleton"></div><div class="skeleton"></div></div>
  <p ${a('wh-feat-004-empty', 'FEAT-004', 'TC-004-2')}>현재 예약 가능한 좌석이 없습니다 <button>다시 조회</button></p>
  <p ${a('wh-feat-004-unknown', 'FEAT-004', 'TC-004-4')}>A-05 상태 확인 불가</p>
  <div class="bar" ${a('wh-feat-005-confirm', 'FEAT-005', 'TC-005-1 TC-005-2 TC-005-3')}>
    <span>A-01 · 14:00~14:30</span><button class="primary">예약하기</button>
  </div>
</main>`

const render = () => {
  document.getElementById('root').innerHTML = current() === '#/seats' ? seats() : login()
}
window.addEventListener('hashchange', render)
render()
