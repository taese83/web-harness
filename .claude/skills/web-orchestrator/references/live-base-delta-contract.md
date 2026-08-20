# Live-Base Delta Contract — 브라운필드의 기획 확인·승인 표면

> **상태: 확정(2026-08-10).** 서로 다른 서비스 형태 2개에서 전 구간 실증됨(아래 일반화
> 근거). 미실증 스택(SSR·엄격 CSP·Shadow DOM 등)은 "알려진 제약"에 따라 처음 만날 때
> 재실증하고, 어긋나면 규칙을 고쳐 write-back한다.

**역할(2026-08-10 재정의)**: 서비스 태생에 따라 기획 확인 표면이 배정된다 — greenfield
태생은 디자인 프리뷰(`design-approval-contract.md`), **brownfield는 라이브 델타(이 계약)**.
실행 중인 기존 dev server 위에 변경분만 델타로 얹고, 디자인 프리뷰와 **같은 기획 UX**를
가진다: 닷+호버 배지 · 기능 사이드바 · 변경 요청 · 승인(`UNAPPROVED/APPROVED/STALE`).
공유 구현은 공용 오버레이 런타임(`assets/wh-overlay.mjs`)이다. 원칙: **프리뷰 범위 = 변경
범위, 바탕 = 가장 실물에 가까운 것** — 기존 동작·데이터는 실물 그대로, 신규 동작만
프로토타입이며, **승인된 내용이 실개발의 입력**이다(같은 TC ID로 구현 검증 — 원칙 4).

**전환 규칙 — 태생은 서비스의 속성이 아니라 시점의 속성이다(2026-08-18 명문화).** 그린필드로
태어난 서비스도 **v1 구현 검증이 완료되어 실행 가능한 실물이 생기면, 이후 모든 변경에 대해
브라운필드다** — 승인 표면은 dev server 위 라이브 델타로 전환되고, 디자인 프리뷰는 그
시점에 승인 표면에서 은퇴해 증거물이 된다(`design-approval-contract.md` §프리뷰 보존 —
이후로는 갱신 대상이 아니라 보존 대상). **전환 판정은 기록으로 한다**: 승인된 TC 전부가
같은 ID의 구현 검증 기록(Phase 4 QA 산출물)으로 통과 확인된 시점이 "v1 구현 검증 완료"다 —
일부 TC만 통과한 과도기는 아직 "검증 전"이다. 근거: 실물과 프로토타입은 등가가 아니다 —
프레임워크 런타임·번들러·개발 모드(예: React StrictMode의 이중 마운트)처럼 **실행 스택에서만
발생하는 결함 클래스는 무의존 프로토타입에 구조적으로 부재**하므로, 실물이 생긴 뒤의 검토를
프로토타입 위에서 계속하면 그 클래스 전체를 놓친다. 전환에 재승인 의식은 없다 — v1 폐곡선은
구현 검증이 이미 닫았고, 델타 표면은 다음 변경에서 처음 만들어진다. 예외는 하나다: v1 구현 검증 **전**의 기획 변경은 프리뷰가
여전히 유일한 살아있는 표면이므로 프리뷰를 갱신한다(design-approval-contract §계속 다듬기의
양방향 동기화). **승인 표면은 언제나 하나다** — 같은 변경에 프리뷰와 델타를 병행 생성하지
않는다: 두 표면이 미세하게 다를 때 승인의 진실이 둘이 되어 같은 TC ID 검증 고리가 모호해진다.

## 산출물 (델타 킷)

```
_workspace/02_design/delta-spec.md              # 앵커 표·mock 경계·인접 목록 (스펙 정본)
_workspace/02_design/preview/manifest.json      # {"mode": "live-delta", "target": "http://127.0.0.1:<port>",
                                                #  "identity": {"titleIncludes": "<앱 <title>의 리터럴 부분 문자열, 1~200자>"}}
                                                # identity는 신규 킷 필수(생성 시점 — 승인 전이라 digest 영향 없음)
_workspace/02_design/preview/delta/bootstrap.mjs      # 주입 진입점 (기능 델타 + 앵커 스탬핑 + 오버레이 로드)
_workspace/02_design/preview/delta/wh-overlay.mjs     # 공용 런타임 — assets/에서 복사 (재작성 금지)
_workspace/02_design/preview/delta/traceability.json  # feature-plan 전 FEAT 매핑 (as-is는 빈 anchorIds+사유)
                                                      # + 패널 표시 필드 필수: features[].summary·scope, anchors[].behavior,
                                                      #   testCases 상세(Given/When/Then) — 비우면 패널에 ID만 떠 검토 불가(실측)
```

서빙: 콘솔이 delta manifest의 `target`(loopback http 한정 — 검증 실패 시 프록시 미구성
+ 정직 안내)으로 **프로젝트별 델타 프록시를 동적 구성**한다(임시 포트) — plain 콘솔
하나로 모든 델타 프로젝트를 표시하며, `--live-base` 플래그는 포트 고정 수동 오버라이드다.
프록시는 HTML에만 bootstrap 주입, `/__wh_delta__/`로 킷 서빙. 기존 앱 소스는 절대
수정하지 않는다. 주의: 임시 포트는 콘솔 재시작마다 바뀌므로 origin별 저장소(localStorage)
에 얹힌 앱 상태는 초기화된다(쿠키는 포트 무관이라 SSO 세션은 유지).

### target 신원 대조 (2026-08-19 오표시 사건에서 도입)

포트는 앱 신원이 아니다 — launch.json에 여러 프로젝트가 등록된 환경에서 manifest target
포트를 **다른 프로젝트의 dev server가 점유**하면, 포트만 신뢰하는 프록시는 그 앱을 이
프로젝트의 라이브 프리뷰로 오표시한다(실측: tart-web target 8080을 tamiya-motor-lab
vite dev server가 점유 — 사용자 발견). 대응 메커니즘:

- **선언**: manifest `identity.titleIncludes` — 대상 앱 `<title>`의 **리터럴 부분 문자열**
  (1~200자). 정규식이 아니다 — manifest는 repo 콘텐츠라 정규식 허용은 프록시에 ReDoS를
  주입할 수 있다. 선언은 launch.json 포트 allowlist 안에서 표시 범위를 **좁히기만** 하므로
  잘못된 manifest가 신뢰를 확장할 수 없다.
- **대조**: 프록시가 **HTML 응답마다** 응답 `<title>`(공백 정규화)과 부분 문자열 대조 —
  생성 시 1회 검사로는 이후의 포트 점유 교체를 놓친다. 불일치·제목 미검출은 fail-closed:
  바탕 앱을 표시하지 않고 `LIVE_TARGET_IDENTITY_MISMATCH` 차단 페이지(502)를 낸다. 선언
  형식 오류는 미선언으로 강등하지 않고 `INVALID_LIVE_IDENTITY`로 loud 실패한다(오타가
  검사를 조용히 끄는 것 방지). 헬스체크가 신원 상태(verified/mismatch/undeclared/invalid)
  를 보고하고 콘솔 카드가 "다른 앱 응답" 경고를 띄운다.
- **하위호환**: identity 미선언 킷은 차단하지 않는다(소급 하드 실패는 승인된 기존 킷을
  일괄 무효화) — 대신 콘솔이 "IDENTITY 미검증" 경고를 상시 표시하고 응답 헤더에
  `unverified`를 노출한다. **신규 킷은 선언이 필수다**(위 산출물 표) — 단 이 필수는
  현재 validator가 기계 강제하지 않는 산문 규칙이다(design-preview-status-lib는 identity
  필드를 보지 않음, §4 등록): 누락 탐지망은 콘솔 경고뿐이며, 신규 킷 한정 validator
  승격은 미해결 TODO.
- **오탐 트레이드오프**: 정당한 앱 title 변경도 차단된다 — 복구는 manifest identity 갱신
  (프록시가 요청 시점마다 재독하므로 콘솔 재시작 불필요). 단 manifest는 previewDigest
  입력이라 갱신은 승인을 STALE로 전이시킨다 — 바탕 앱의 신원 표식이 바뀌었으면 재검증이
  정당하다는 방향으로 수용한다(델타는 일회성 증거물).
- **한계**(protected-core §4 등록): title 부분 문자열은 앱 신원의 **프록시**다 — 제목이
  같거나 generic한 두 앱은 구분하지 못하고, 비-HTML 경로(asset·API·WS 패스스루)는
  미검사이며, 옳은 제목을 선언했는지 자체는 자기선언이다. 앵커 수준 실검증은 여전히
  anchorReceipt(사람의 라이브 검증) 몫 — 이 검사는 오표시 차단이지 실검증 대체가 아니다.

## 승인 파이프라인 (validator live-delta 모드 — 프리뷰와 같은 상태머신)

1. `validate-design-preview.mjs --write-source-snapshot` — 소스(feature-plan + delta-spec,
   그린필드 문서는 있으면 포함) digest 고정 → `UNAPPROVED`. 필수 파일 누락은 `INVALID`.
2. **라이브 검증**(브라우저): 앵커 스탬핑 확인 → 각 TC 실측 → 인접 상호작용 무영향 확인.
3. `--record-approval --approval-text "…" --anchor-receipt "anchors N/N matched @ <URL>, <요약>, <시점>"`
   — anchorReceipt는 **쓰기·읽기 경로 모두에서 필수**다(수기 승인 레코드도 receipt 없으면
   `INVALID` — fail-closed). receipt는 자기진술 프록시(§4 등록)이므로 매칭 수·확인 URL·
   시점을 반드시 담는다.
4. 스펙·델타 파일이 바뀌면 자동 `STALE` — 재검증·재승인 전 Phase 3 진입 금지(프리뷰와 동일).
   콘솔은 mode·status를 표시하고 `STALE/UNAPPROVED`를 "승인됨"으로 위장하지 않는다.

## 델타 작성 규칙 (파일럿 실패에서 도출 — 각 규칙은 실제로 깨진 뒤 확립됨)

1. **앵커는 구조가 아니라 텍스트/의미 패턴** — 라벨 리프 매칭 + 최근접 조상. **실패 시 침묵
   금지** — 장식을 생략하고 콘솔 경고로 정직 보고한다.
2. **관찰은 `document.body` 전체** — 포털(모달·팝오버)은 `#root` 밖에 마운트된다.
3. **자기오염 가드** — 델타 요소에 `data-wh-delta` 마킹, 앵커 탐색에서 제외. 재적용은
   멱등(없는 것만 추가)으로 설계해 자기 뮤테이션이 no-op으로 수렴하게 한다.
4. **호스트 레이아웃 불간섭** — 델타 UI는 플로팅 레이어 기본값. 컴포넌트 교체는 원본
   `visibility:hidden`(크기 보존) + absolute 오버레이.
5. **실데이터 캡처는 앱 상태 매칭** — XHR·fetch 둘 다 패시브 탭, payload 기록, "최신"이
   아니라 URL 파라미터·활성 탭과 매칭해 선택.
6. **캡처 → 형태 검사 → 렌더러 순서** — 응답 형태는 캡처 전에 알 수 없다.
7. **기획 배지는 오버레이 몫** — bootstrap은 자기 요소에 `data-wh-anchor`/`data-wh-feature`/
   `data-wh-tests`를 스탬핑하고 `wh-overlay.mjs`를 로드한다(배지·사이드바 재구현 금지).
   경계 배너(델타/프로토타입 고지)는 bootstrap이 담당한다. **기능 UI 자체는 기존 디자인
   시스템과 동일한 시각 언어**로 그린다 — 델타 전용 강조는 경계 표시에만.
8. **인접 상호작용 검증** — 변경과 상태를 공유하는 컨트롤 목록을 delta-spec에 명시하고
   각각 검증한다. 변경 경로만 검증하면 인접에서 깨진다.
9. **rAF는 숨김 탭에서 발화하지 않는다**(실측: pane 백그라운드·iframe) — 재적용 디바운스는
   `visibilityState === 'hidden'`이면 setTimeout 폴백을 쓴다(defer 패턴, 오버레이 자산 동일).
10. **미지 앵커는 배지 금지** — 브라운필드 바탕에는 traceability 밖의 `data-wh-anchor`
    스탬프가 있을 수 있다(과거 하네스 산출물, 자체 주석 체계 등 — 실측: 바탕 앱의 잔존
    스탬프가 배지돼 조회 실패로 빈 패널). 오버레이는 traceability에 등록된 앵커만 배지하고
    미지 앵커는 콘솔 경고로 정직 보고한다(공용 런타임에 구현됨). 바탕 앱이 같은 배지
    시스템을 내장한 경우(layer id 충돌·핑퐁)의 대응 — 주석 레이어만 도입 시점에 제거·
    비활성 — 은 **코드 확인 수준(미실증)**이다: 충돌 구조는 픽스처 코드에서 확인했으나
    핑퐁 자체를 라이브로 실측하기 전에 픽스처를 정리했다. 처음 실제로 만날 때 재실증한다.

## mock 경계

**mock 경계 = 변경이 새로 도입하는 API 표면.** 기존 API는 절대 mock하지 않는다(바탕은
실물). 신규 API가 필요한 변경만 델타 안 in-memory(또는 향후 `/__wh_mock__/` 라우트)로
대체하고 경계 배너에 명시한다. 승인 시점에 "실물/프로토타입" 목록이 앵커 표 + mock
목록에서 기계적으로 나온다.

## 생성 루프 (브라우저 피드백 필수)

정찰(DOM·네트워크 probe) → 주입 → 브라우저 앵커/동작 검증 → 실패 시 수정. 브라우저 도구가
있는 세션(오케스트레이터)에서 수행한다 — `design-preview-builder`(파일 도구만)는 이 모드를
생성할 수 없다. 버전 마커(`window.__WH_DELTA_VERSION`)로 로드된 코드를 확인한다.
localStorage는 **origin별**이므로 프록시 origin에서의 상태 전제(최근 기록 등)는 별도로
만들어 검증한다.

## 일반화 근거

- Vite + React + MUI hash-router SPA, SSO 인증 (실증 — workspace/analytics-spa: 델타 메커니즘
  전 구간 라이브 검증(`docs/live-base-delta-pilot.md`) + FEAT-021 승인 파이프라인(배지·
  사이드바·anchorReceipt·콘솔 APPROVED·새 탭 딥링크 CR) 완주)
- 정적 서빙 vanilla JS SPA, 비-SSO (실증 — workspace/nocode-live-pilot FEAT-201: 임베드
  렌더 + 실제 CRUD에 대한 배지 재적용(도구 생성 시 2→3) + 딥링크 CR 자동 오픈 +
  anchorReceipt 승인·콘솔 APPROVED 완주. WS 패스스루 불필요 케이스 확인. 픽스처 출처:
  과거 하네스 프리뷰 프로토타입 사본(자기참조적) — 서빙·스택·인증 형태 실증으로는 유효,
  순수 외부 기원 브라운필드 앱 실증은 미완)
- Next.js SSR 앱 (명명 수준 — 미검증. hydration mismatch·스트리밍 응답에서 처음 만날 때
  재실증)

## 알려진 제약

- **인증 리다이렉트 앱은 콘솔 임베드 불가** — loopback 전용 `frame-src`가 인증 이동을
  차단한다(완화 금지). 정식 동선은 "새 탭에서 열기". 새 탭에서의 "변경 요청" 딥링크는
  콘솔이 `whConsoleOrigin`/`whProject` 파라미터를 실어줄 때만 노출된다 — 콘솔 라이브
  카드가 두 파라미터를 링크·임베드에 자동 부착하고, `openCR=1` 딥링크를 수신하면 해당
  FEAT로 변경 요청 다이얼로그를 자동으로 연다(1회성, URL에서 즉시 제거).
- **역방향 딥링크(콘솔→델타 "프리뷰에서 위치 열기")** — 콘솔이 `whAnchor`/`whOpen=1` +
  대상 라우트를 실어주면 공용 오버레이가 앵커가 나타나는 첫 attach에서 1회 스크롤·패널
  자동 오픈한다(그린필드 프로토타입과 같은 파라미터 규약 — 델타 실측).
- 델타는 승인용 일회성 증거물 — 앱 리팩토링에 깨지는 것이 정상, 유지보수하지 않는다.
  dev server 필수 = 정적 아카이브 불가, 실데이터 노출 = 리뷰어 권한 일치·loopback 전용.
- 미실증: SSR, 엄격 CSP dev server, Shadow DOM/canvas, Vite 외 HMR — 처음 만날 때
  재실증하고, 어긋난 규칙은 write-back한다.
- **임베드 내 postMessage 변경 요청 경로는 코드 정합 검증만** — 신뢰 검사(type·origin·
  source 일치)는 코드로 대조했으나, 자동화 도구의 pane 클릭이 크로스 오리진 iframe에
  전달되지 않아 E2E 실측은 못 했다(사용자 수동 클릭은 가능). E2E 실증된 동선은 두 형태
  모두 **새 탭 딥링크(`openCR=1`) 경로**다.
