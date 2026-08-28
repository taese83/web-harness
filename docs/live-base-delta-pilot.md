# 라이브 베이스 델타 프리뷰 파일럿 결과 (2026-08-07)

> **이 인프라는 2026-08-28에 제거됐다**(라이브 델타 폐지 — 승인은 프리뷰 한 곳으로).
> 아래는 그 시점의 실측 기록이며 현재 동작 설명이 아니다.

브라운필드 feature-add 프리뷰 전략의 파일럿 기록. 실행 중인 실제 dev server 위에
프록시 주입 델타로 (1) 신규 기능 추가, (2) 컴포넌트 통째 교체를 실증했다.
이 문서는 design-preview-builder 델타 모드 계약화의 입력이다.

- 대상: workspace/analytics-spa (Vite 5 + React + MUI + hash router, SSO 인증, 실데이터)
- 인프라: `packages/web-harness-console/src/live-base-preview.mjs` (4312 → 8080 프록시,
  HTML에만 bootstrap 주입, `/__wh_delta__/` 정적 서빙, WS 패스스루)
- 델타: `_workspace/02_design/preview/delta/bootstrap.mjs` (gitignored, v11까지 반복)

## 실증된 능력

1. **추가 기능** (서비스 즐겨찾기): 플로팅 favbar + 항목 별 토글 + 실제 앱 위임
   (선택→CTA 폴링 클릭)으로 진짜 페이지 이동까지. SPA 라우트 전환·포털 모달에서 유지.
2. **컴포넌트 교체** (개요 차트): Highcharts 라인차트를 `visibility:hidden`으로 숨기고
   같은 자리에 실데이터 SVG 바 차트 오버레이. 레이아웃 무손상, 지표/단위 전환 추종.
3. **실데이터 캡처**: XHR/fetch 패시브 탭으로 앱이 받는 응답 복사(요청 무변경).
   프록시 밖으로 직행하는 API(axios → 외부 호스트)도 페이지 내 인터셉트로 커버.
4. 기존 앱 무영향: 소스 무수정, 자산 바이트 동일 통과, Vite HMR 정상, 델타 기인 콘솔 에러 0.

## 계약에 들어갈 규칙 (실패에서 도출)

각 규칙은 파일럿에서 실제로 깨진 뒤 고친 것이다.

1. **앵커는 구조가 아니라 텍스트 패턴** — 같은 라벨이 렌더 상태에 따라 button/span/portal로
   바뀌어 구조 셀렉터는 3회 깨졌다. 라벨 리프 매칭 + 최근접 조상 방식만 살아남았다.
   앵커 실패 시 침묵하지 말고 정직 보고(빈 데코 상태로 두고 로그).
2. **관찰은 document.body 전체** — MUI Portal(모달/팝오버)은 `#root` 밖에 마운트된다.
3. **자기오염 가드** — 델타가 만든 UI를 델타가 다시 앵커로 잡는 루프가 실제 발생.
   모든 델타 요소에 `data-wh-delta` 마킹 + 탐색에서 `closest('[data-wh-delta]')` 제외.
4. **호스트 레이아웃에 끼어들지 않기** — flex 컨테이너 prepend는 폭 0으로 찌그러졌다.
   델타 UI는 고정 플로팅 레이어가 기본값. 교체 오버레이는 `visibility:hidden`(크기 보존) + absolute.
5. **캡처 선택은 "최신"이 아니라 "앱 상태 매칭"** — 앱이 일/주/월 응답을 프리페치(react-query)
   해서 UI 전환 시 네트워크 요청이 없다. 요청 payload를 캡처에 기록하고 URL 상태
   (granularity, metric)와 매칭해 선택해야 한다. 매칭 근거는 배지로 화면에 노출(I1).
6. **XHR·fetch 둘 다 패치** — axios는 XHR이다. fetch만 탭하면 아무것도 못 잡는다.
7. **캡처 → 형태 검사 → 렌더러 순서** — 응답 형태({header, rows} 테이블, 값 문자열)는
   캡처 전에 알 수 없다. 렌더러를 먼저 쓰지 말 것.
8. **인접 상호작용 검증** — 변경 대상과 상태·데이터를 공유하는 컨트롤 목록(지표 탭,
   granularity, 기간, 세그먼트)을 델타 명세에 명시하고 각각 검증한다. granularity 버그는
   변경 경로가 아니라 인접 컨트롤에서 나왔다.

## 델타 적용 스펙트럼 (모드 판별 기준)

- ① 추가 기능: 최적. ② 경계 명확한 컴포넌트 교체: 적합 — "새 디자인 + 진짜 데이터" 조합은
  이 방식만 가능. ③ 여러 컴포넌트에 걸친 구조 재배치: 부적합 → 풀 프로토타입 모드로.
- mock 경계 = 변경이 새로 도입하는 API 표면. 기존 API는 절대 mock하지 않는다(바탕은 실물).
  신규 API가 필요하면 `/__wh_mock__/` 프록시 라우트(미구현)로.

## 한계 (요약)

델타는 승인용 일회성 증거물(앱 리팩토링에 깨짐, 유지보수 금지). dev server 필수라 정적
아카이브 불가 → 승인 시 스크린샷/녹화를 receipt에 남길 것. 실데이터 노출 = 리뷰어 권한
일치 필요, loopback 전용. 일반화는 앱 1개(Vite/React/MUI)에서만 실증 — SSR·CSP 엄격
환경·Shadow DOM은 미검증(I3: 계약 확정 전 다른 형태 1개 이상 재실증 필요).

## 콘솔 연동 (2026-08-07 완료분)

실전 feature-add(FEAT-010 즐겨찾기)를 콘솔 전체 흐름으로 확인: feature-plan.md(TC 파서는
`TC-NNN-N: 설명` 라인 형식 필요) → Features 탭 인덱싱 → UI로 CHG 생성(Changes 탭) →
Preview 탭. 프로젝트 상세 API에 `livePreview`(url·target·deltaPresent)를 노출하고 Preview
탭에 "라이브 베이스 델타 프리뷰" 카드(DELTA READY 칩 + 새 탭에서 열기 + best-effort 임베드)를
추가했다.

**임베드 제약(확정)**: 토큰이 탭 컨텍스트에 묶이고 만료 시 문서 자체를 인증 서버로
리다이렉트하는 앱(이 파일럿이 이 구조)은 콘솔 임베드에서 렌더 불가 — iframe 내비게이션이
콘솔의 loopback 전용 `frame-src`에 차단된다(CORS 아님: API는 401 정상 응답, 콘솔에 CSP
frame-src violation 기록). 외부 origin을 frame-src에 여는 것은 콘솔 보안 경계 완화라 하지
않는다. 이런 앱의 정식 동선은 "새 탭에서 열기"이며 카드 안내문이 이를 설명한다.

## 남은 작업

1. design-preview-builder 계약에 델타 모드 공식화(위 규칙 + 3구간 판별)
2. `/__wh_mock__/` 라우트(신규 API mock 경계)
3. 파일럿·연동 코드 커밋(live-base-preview.mjs·server 배선·livePreview API·Preview 탭 카드·테스트·launch.json — 미커밋)
4. 다른 서비스 형태 1개에서 재실증 후 일반화 규칙 확정(비-SSO 앱이면 임베드 경로도 실증 가능)
