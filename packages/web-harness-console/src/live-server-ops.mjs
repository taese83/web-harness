// 라이브 dev 서버 **운영**만 담는다 — 승인 표면이 아니다.
//
// 2026-08-28 분리: 종전 `live-base-preview.mjs`는 실행 중인 앱에 프록시를 세우고 델타
// 오버레이를 주입해 **승인 표면**을 만들었다. 그 결합이 CSP·SSR·Shadow DOM 미실증과
// identity 대조·anchorReceipt 같은 부수 기제를 전부 끌고 왔다. 승인은 프리뷰 한 곳으로
// 모으고, 라이브는 "띄우고 본다"만 남긴다 — 그래서 여기 남는 것은 대상 포트 해석뿐이다.
//
// 운영 엔드포인트(`/api/live-base/start|stop|health`)가 이 파서로 대상을 정하고,
// `.claude/launch.json`의 포트 allowlist가 그 위에서 실행 가능 범위를 다시 좁힌다.

const LOOPBACK_TARGET = /^http:\/\/(?:127\.0\.0\.1|localhost):(\d{2,5})$/

/**
 * dev 서버 대상은 **loopback으로 제한**한다 — 콘솔의 로컬 전용 보안 경계를 유지한다.
 * @returns {{host: string, port: number, origin: string} | null}
 */
export const parseLiveBaseTarget = value => {
  const match = LOOPBACK_TARGET.exec(String(value ?? '').replace(/\/+$/, ''))
  if (!match) return null
  const port = Number(match[1])
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return {host: '127.0.0.1', port, origin: `http://127.0.0.1:${port}`}
}
