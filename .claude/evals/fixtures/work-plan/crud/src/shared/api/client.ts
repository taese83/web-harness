// fetch 래퍼 — 공통 오류 envelope을 던진다. 재시도는 호출부 몫.
export async function request(path: string, init?: RequestInit) {
  return fetch(path, init)
}
