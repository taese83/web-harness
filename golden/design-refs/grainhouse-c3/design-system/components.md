# 컴포넌트 인벤토리

두 부류로 나눈다. **A: 승인 렌더에 있는 것** — 렌더가 스펙의 정본이다. **B: 렌더에 없어
원리에서 파생한 것** — ux-brief의 화면들이 요구하지만 아직 그려진 적 없다. B는 전부
"승인 렌더에 없음 — 원리에서 파생" 상태이며 첫 구현 화면에서 승인이 필요하다.

공정 4단계(접수 → 현상 → 스캔 → 업로드)는 **모든 화면에서 같은 언어**(4세그먼트 미터 +
mono 상태 주석)로 표시한다 — ux-brief 하한.

## A. 승인 렌더에 있는 것 (정본: approved-render.html)

| 컴포넌트 | 위치(예정) | 스펙 요점 |
|---|---|---|
| 레일 앱셸 | `widgets/app-shell` | 232px 좌측 레일, 우측 1px ink 경계, sticky. ≤900px에서 상단 가로 바로 전환(활성 표시는 좌측 보더 → 하단 보더 2px) |
| 워드마크 | `widgets/app-shell` | display 22/700 + mono sublabel(caps, tracking .18em, ink-2) |
| 레일 내비 링크 | `widgets/app-shell` | ui 14px, 기본 ink-2 + 좌측 2px grid 보더, hover ink+paper-2, 활성 `aria-current="page"` + 좌측 2px accent + 600, min-height 44px |
| 주 버튼(CTA형) | `shared/ui/button` | accent 배경 + on-accent, radius-md, 서술 문구 700 + mono sublabel 겹침 가능, hover accent-hover, min-height 44~52px, padding 12/16 |
| 주 버튼(테이블 액션형) | `shared/ui/button` | 동일 언어의 소형: ui 14px 700 + mono 용량 표기, min-height 44px |
| readout 스트립 | `widgets/readout` | 상하 1px ink 괘선의 `dl`, mono data 12.5px, 라벨은 micro caps ink-2, 라이브 값은 accent + tick(명멸 — `--animate-ink`) |
| 공정 테이블 | `widgets/roll-table` | 헤더: micro mono caps + 하단 1px ink. 행: 하단 1px grid, hover paper-2, 셀 padding 16/12, 다층 셀(emphasis 15.5/700 + meta data 12.5 ink-2) |
| Roll ID | `shared/ui` (텍스트 역할) | mono data-strong 13/500 |
| 뱃지(공정 유형) | `shared/ui/badge` | micro mono, tracking .12em, 1px rule-strong 보더, ink-2, radius-sm. 상태가 아닌 분류 표기 |
| 4세그먼트 미터 | `shared/ui/process-meter` | 34×10px 세그먼트 ×4, gap 4px. 빈=1px rule-strong 보더, 완료=ink 채움, 진행=accent 채움+`--animate-ink`. **필수**: `role="img"` + aria-label("공정 4단계 중 N단계 …") — 색 단독 전달 금지 |
| 상태 주석 라벨 | `shared/ui/process-meter` | annot mono 11.5px, 진행=accent 500, 완료=ink, 기타 ink-2. 미터와 항상 동행(비텍스트+텍스트 병행) |
| 대기 상태 라벨 | `shared/ui` (텍스트 역할) | mono 12px ink-2 — 액션이 아직 없음을 표기. 버튼처럼 보이게 하지 않는다 |
| 각주 푸터 | `widgets/page-footnote` | 상단 1px rule, body-sm~data 크기 ink-2, `sup` 마커는 accent |

## B. 승인 렌더에 없음 — 원리에서 파생 (전부 승인 대기)

### 폼 컨트롤 (새 롤 접수·계정 화면이 요구)

원리 3·5: 폼은 "양식지" — 계측 라벨 + 서술 입력. 라벨은 micro~sublabel mono caps(ink-2,
자기 인풋과 4~8px, 다음 필드와 16px+), 값은 form 16px 서술 목소리.

| 컴포넌트 | 파생 스펙 |
|---|---|
| 텍스트 인풋 | 높이 44px, padding 좌우 12px, 1px rule-strong 보더, paper 배경, radius-md. focus: 전역 focus-visible(2px accent). 오류: 보더 error + 아이콘 + 메시지(색 단독 금지) |
| 셀렉트 | 인풋과 동일 + mono 화살표 글리프(▾). 선택지가 5개 이하 고정 집합(현상 방식 등)이면 라디오 우선 |
| 라디오/체크박스 | 18px 박스(체크=정사각 radius-sm, 라디오=원 radius-full — tokens.md 형태 절), 1px rule-strong, 선택 시 ink 채움(잉크 블록 — 원리 1, `data-ink-fill`), 히트 영역은 라벨 포함 44px |
| 필드 그룹 | 3~4필드 청킹, 그룹 간 32px+, 그룹 제목은 h2 또는 micro caps 구획 괘선(1px ink) |
| 폼 오류 메시지 | body-sm 서술 목소리, error 색 + 아이콘, 인풋 하단 4px |

### 상태 (모든 화면이 요구 — ux-brief 하한)

| 상태 | 파생 스펙 |
|---|---|
| 로딩 | 스피너 금지(원리 1). tick(3×11px accent 블록) + `--animate-ink` + mono "기록 중…" 라벨. 표·패널은 스켈레톤: grid색 블록(radius-sm), 명멸은 저강도 |
| 빈 상태 | 기록지의 빈 페이지: grid 괘선 유지 + 가운데 정렬 안내(3줄 이하 — 원칙 허용 범위) + 주 버튼 1개. 예: 보관함 빈 상태 → "아직 완료된 스캔이 없습니다" + 새 롤 접수 CTA |
| 오류 상태 | error 잉크: 아이콘 + 서술 메시지 + 재시도 보조 버튼. 화면 전체 오류는 readout 자리에 error 괘선 배너 |
| 부분 상태 | 행 단위로 표현(렌더의 "대기" 라벨 언어) — 전체를 막지 않는다 |

### 기타 파생 컴포넌트

| 컴포넌트 | 파생 스펙 |
|---|---|
| 보조 버튼 | 렌더에 없음. 투명 배경 + 1px **rule-strong** 보더 + **ink-2** 텍스트, hover 시 paper-2 대지 + ink 보더·텍스트로 진해짐. 그 외 주 버튼과 동일 치수. 2026-08-23 실측 수정: 초판의 ink 보더·텍스트는 주 버튼과 시각 무게가 비슷해 시선을 나눠 가졌다 — 보조는 한 단 물러선다. 주/보조가 한 화면에 있을 때 주(accent)는 1개만(원리 4) |
| 파괴적 버튼 | error 배경 + on-accent, confirm 필수, 주 버튼 쌍에서 16~24px 이격(원칙) |
| 모달 | paper-2 대지 + 1px ink 보더, 그림자 없음(원리 2), 하부 scrim. 제목 h1/20, 액션은 우하단 — 순서(보조·주)는 전 화면 통일 |
| 알림 배너 | semantic solid 1px 보더 + subtle-bg(tokens.md 파생 규칙) + 아이콘 + 서술 텍스트 |
| 페이지네이션 (보관함) | mono data 숫자, 타깃 40~44px, 현재 페이지 = accent + 하단 2px accent 보더(내비 활성과 같은 언어), `aria-current="page"` |
| 문서 조판 (가격·공정 안내) | **폭 제한은 문단(`p`)에만** — 컨테이너(`main`·`.prose`)에 걸지 않는다(2026-08-23 실측 결함: `<main class="prose">`에 max-width를 선언해 페이지 전체 폭이 어긋났다). 본문 문단 max-width 36em, h1 20 → h2 17 위계, 표는 공정 테이블 언어 재사용, 각주 푸터 패턴. 가격 숫자는 mono + tabular-nums 우측 정렬 |
| 링크(본문 내) | accent + 밑줄(색 단독 전달 금지 — 본문 속 링크는 밑줄 필수) |
| 토글/스위치 (계정 알림) | 스위치 은유는 발광 계기에 가깝다 — 체크박스 또는 라디오로 대체(원리 1). 꼭 필요하면 잉크 블록 이동형으로 재해석 후 승인 |

### 폼 액션 줄 (2026-08-23 실측 확정)

| 항목 | 규정 |
|---|---|
| 정렬 | **오른쪽 정렬**(`justify-content: flex-end`) — 취소·확인을 **한 덩어리**로 모은다. 주 버튼에만 `margin-left:auto`를 걸면 두 버튼이 양 끝으로 갈라져 한 쌍으로 읽히지 않는다(실측 지적) |
| 순서 | 보조(취소) → 주(확인). 주 버튼이 흐름의 끝(오른쪽 맨 끝) |
| 부속 안내 | 마감 시각 등 계측 주석은 **왼쪽**에 두고 `margin-right:auto`로 버튼 쌍을 밀어낸다 — 안내는 참고 정보, 액션은 행동이므로 분리한다 |
| 구획 | 액션 줄 위에 `--color-rule` 괘선 + `padding-top: 24px` — 폼 본문과 분리 |
| 마감 | 좌우 패딩 `28px`(초판 16px은 글자가 테두리에 붙었다), 상태 전환 `.14s`(색·보더), `:active`에서 1px 내려앉음. `prefers-reduced-motion`에서 전환 제거 |

### 서체 메트릭 보정 (Pretendard 교체의 후과 — 2026-08-23)

Pretendard는 IBM Plex Sans KR보다 x-height가 커서 **같은 px이 더 크게 보인다**. 시스템의 크기
값은 IBM Plex 기준으로 정해졌으므로, 서체만 바꾸면 전 화면이 커 보인다(실측 지적: "전체적으로
글자 크기가 어색해").

- 해법: `body { font-size-adjust: 0.52 }` — **선언 크기는 그대로, 보이는 소문자 높이만** 맞춘다.
  크기를 낮추는 방식은 `--text-form`(16px, iOS 줌 방지 하한)을 깨므로 쓰지 않는다.
- **규칙**: 본문 서체를 교체하면 스케일을 재검증한다. 서체 교체는 색 교체와 같은 등급의
  변경이며(전 화면 영향), 토큰 값을 건드리지 않았다고 안전한 것이 아니다.

## 금지 목록 (전 컴포넌트 공통)

- `box-shadow`, 그라데이션, 글로우 (원리 1) · radius를 **분리·위계 수단으로** 쓰기(마감일 뿐 — 원리 2 개정)
- accent를 장식·배경 대면적에 사용 (원리 4)
- 상태를 색만으로 전달 (aria-label 또는 텍스트 라벨 동행 — accessibility.md)
- shadcn 컴포넌트 도입 시 기본 shadow·ring 스타일을 토큰으로 덮어쓰지 않은 채 사용(radius는 시스템 스케일로 매핑)
