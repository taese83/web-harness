// 숨긴 인수 테스트 — 두 조건 모두에게 보여 주지 않는다. 평가 때 src/__hidden__/에 복사해 돌린다.
// 기준 앱의 관례(App, src/mocks/server·db, 목록 aria-label)와 요청문에 적힌 문구·API만 쓴다.
import {render, screen, waitFor, within} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import {http, HttpResponse} from 'msw'
import {MemoryRouter} from 'react-router'
import {describe, expect, it} from 'vitest'
import {App} from '../App'
import {server} from '../mocks/server'

const MINUTE = 60_000
const api = (path: string, init?: RequestInit) => fetch(new URL(path, window.location.origin), init)
const extendViaApi = (id: string) => api(`/api/reservations/${id}/extend`, {method: 'POST'})
const mine = async () => (await (await api('/api/reservations')).json()) as Array<{id: string; endsAt: string}>
const endsAtOf = async (id: string) => Date.parse((await mine()).find(item => item.id === id)?.endsAt ?? 'x')
const reserveViaApi = async (seatId: string, startsInMs: number, lengthMs: number) => {
  const startsAt = new Date(Date.now() + startsInMs).toISOString()
  const endsAt = new Date(Date.now() + startsInMs + lengthMs).toISOString()
  const response = await api('/api/reservations', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({seatId, startsAt, endsAt})})
  return ((await response.json()) as {id: string}).id
}
const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
const rowOf = async (text: string) => {
  const list = await screen.findByRole('list', {name: '내 예약 목록'})
  const row = within(list).getAllByRole('listitem').find(item => item.textContent?.includes(text))
  if (!row) throw new Error(`${text} 예약 행이 없다`)
  return row
}
const isAnnounced = (element: HTMLElement) => Boolean(element.closest('[role="status"],[role="alert"],[aria-live]'))

describe('API — POST /api/reservations/:id/extend', () => {
  it('1. 내 예약을 연장하면 200이고 끝나는 시각이 정확히 1시간 늘어난다', async () => {
    const before = await endsAtOf('r1')
    const response = await extendViaApi('r1')
    expect(response.status).toBe(200)
    expect(Date.parse(((await response.json()) as {endsAt: string}).endsAt)).toBe(before + 60 * MINUTE)
    expect(await endsAtOf('r1')).toBe(before + 60 * MINUTE)
  })

  it('2. 두 번까지 연장되고 세 번째는 409이며 시각이 그대로다', async () => {
    const before = await endsAtOf('r1')
    expect((await extendViaApi('r1')).status).toBe(200)
    expect((await extendViaApi('r1')).status).toBe(200)
    expect((await extendViaApi('r1')).status).toBe(409)
    expect(await endsAtOf('r1')).toBe(before + 120 * MINUTE)
  })

  it('3. 다른 사람의 예약은 403이다', async () => {
    expect((await extendViaApi('r3')).status).toBe(403)
  })

  it('4. 없는 예약은 404다', async () => {
    expect((await extendViaApi('r999')).status).toBe(404)
  })

  it('5. 이미 끝난 예약은 409이고 시각이 그대로다', async () => {
    const ended = await reserveViaApi('seat-a3', -180 * MINUTE, 120 * MINUTE)
    const before = await endsAtOf(ended)
    expect((await extendViaApi(ended)).status).toBe(409)
    expect(await endsAtOf(ended)).toBe(before)
  })
})

describe('화면 — 내 예약에서 연장', () => {
  it('6. 「연장」을 누르면 「예약을 1시간 연장했습니다」를 알리고 서버 시각이 1시간 늘어난다', async () => {
    const before = await endsAtOf('r1')
    renderAt('/reservations')
    await userEvent.click(within(await rowOf('A-1')).getByRole('button', {name: '연장'}))
    const message = await screen.findByText('예약을 1시간 연장했습니다')
    expect(isAnnounced(message)).toBe(true)
    expect(await endsAtOf('r1')).toBe(before + 60 * MINUTE)
  })

  it('7. 연장하면 목록의 끝나는 시각이 바로 바뀐다', async () => {
    renderAt('/reservations')
    const row = await rowOf('A-1')
    const beforeText = row.textContent
    await userEvent.click(within(row).getByRole('button', {name: '연장'}))
    await screen.findByText('예약을 1시간 연장했습니다')
    await waitFor(async () => expect((await rowOf('A-1')).textContent).not.toBe(beforeText))
  })

  it('8. 한도에 이른 예약은 「연장」이 비활성화되고 「연장 한도 도달」을 보여 준다', async () => {
    await extendViaApi('r1')
    await extendViaApi('r1')
    renderAt('/reservations')
    const row = await rowOf('A-1')
    expect(within(row).getByRole('button', {name: '연장'})).toBeDisabled()
    expect(row.textContent).toMatch(/연장 한도 도달/)
  })

  it('9. 서버가 실패하면 「연장하지 못했습니다」를 알리고 시각이 그대로다', async () => {
    const before = await endsAtOf('r1')
    server.use(http.post('*/api/reservations/:id/extend', () => HttpResponse.json({message: 'boom'}, {status: 500})))
    renderAt('/reservations')
    await userEvent.click(within(await rowOf('A-1')).getByRole('button', {name: '연장'}))
    const message = await screen.findByText(/연장하지 못했습니다/)
    expect(isAnnounced(message)).toBe(true)
    server.resetHandlers()
    expect(await endsAtOf('r1')).toBe(before)
  })

  it('10. 기존 취소는 그대로 동작한다 — 연장한 예약도 「취소」로 지울 수 있다', async () => {
    await extendViaApi('r1')
    expect((await api('/api/reservations/r1', {method: 'DELETE'})).status).toBe(204)
    renderAt('/reservations')
    const list = await screen.findByRole('list', {name: '내 예약 목록'})
    expect(within(list).queryByText(/A-1/)).not.toBeInTheDocument()
  })

  it('11. 각 예약 행에 「취소」와 「연장」이 함께 있다', async () => {
    renderAt('/reservations')
    const row = await rowOf('A-1')
    expect(within(row).getByRole('button', {name: '취소'})).toBeInTheDocument()
    expect(within(row).getByRole('button', {name: '연장'})).toBeInTheDocument()
  })

  it('12. 접근성: 연장을 알린 화면에 심각·치명 axe 위반이 없다', async () => {
    renderAt('/reservations')
    await userEvent.click(within(await rowOf('A-1')).getByRole('button', {name: '연장'}))
    await screen.findByText('예약을 1시간 연장했습니다')
    const result = await axe.run(document.body, {rules: {'color-contrast': {enabled: false}}})
    expect(result.violations.filter(violation => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([])
  })
})
