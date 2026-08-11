# Design Principles — Navigation & IA (내비게이션·정보 구조·사용자 동선)

내비게이션 구조 선택, 메뉴 설계, 계층 이동, 동선 설계, 검색, 모바일 전환, 상태 표시의 규칙이다.

## 내비게이션 구조 선택

- **화면 유형이 아니라 "최상위 항목 수 + 라벨 길이 + 성장 가능성"으로 선택한다**:
  - **톱바**: 항목 5~7개 이하 + 짧은 라벨 + 콘텐츠/마케팅 사이트. 수직 공간 절약, 항상 노출.
  - **사이드바**: 항목 8개+ 또는 계속 늘어나는 경우 + 긴 라벨 + 중첩 계층 필요. 세로 목록은 스캔이 빠르고 하위 계층을 인라인 확장할 수 있다. 대시보드·도구형 SaaS(Slack, Notion, Linear)가 거의 전부 사이드바인 이유.
- **데스크톱에서 햄버거 메뉴 금지** — NN/g 정량 연구(179명): 숨긴 내비는 발견율 절반, task success 하락. 데스크톱은 사이드바/톱바 상시 노출.
- **반응형 전환 규칙(Material)**: 폰=bottom bar → 태블릿=navigation rail → 데스크톱=사이드바. rail과 bottom bar를 동시에 쓰지 않는다.

## 메뉴 설계

- **"7±2" 항목 제한을 근거로 쓰지 않는다** — Miller의 7±2는 단기기억(recall) 연구. 항상 보이는 메뉴는 recognition 과업이라 무관하다. 실제 규칙: **항목 수 제한이 아니라 섹션 헤더 그룹핑** — 사이드바 15개면 무그룹이 잘못이지 15개가 잘못이 아니다. 5~7개 단위 그룹으로 나눈다.
- **넓고 얕게(broad & shallow) 기본** — 깊은 계층은 각 레벨 카테고리가 generic해져 혼란을 만든다 (NN/g flat vs deep). 웹 앱은 최대 2단계(그룹 > 페이지). 깊게 갈 수밖에 없으면 breadcrumb·인기 항목·검색 shortcut 병행.
- **아이콘 단독 내비 금지 — 항상 텍스트 라벨** — universal icon은 극소수(홈·검색). collapsed 사이드바를 제공해도 기본 상태는 아이콘+라벨, 바텀 탭도 라벨 병기 (NN/g icon usability).
- **라벨은 사용자 언어의 구체 명사/동사** — 내부 조직 용어·마케팅 조어 금지. 담은 콘텐츠를 그대로 서술하는 라벨이 information scent를 만든다.

## 계층 이동

- **breadcrumb은 계층 3레벨 이상일 때만** — 1~2레벨 flat 구조에서는 이득이 없다. 위치 기반(사이트 계층)으로, 방문 경로(history)가 아니다 (NN/g).
- **상세→목록 복귀 시 스크롤·필터·페이지 상태 유지 (필수)** — 87%의 사이트가 복원하는 웹 관례 (Baymard). 목록 상태는 URL query(필터·정렬·페이지)에, 스크롤은 History state/sessionStorage로. overlay·filter도 브라우저 back으로 닫히게.

## 사용자 동선 설계

- **"3클릭 규칙"을 버리고 information scent를 최적화한다** — 3클릭 규칙은 실증 근거가 없다. 문제는 클릭 수가 아니라 "각 클릭에서 올바른 다음 링크를 확신할 수 있는가" (NN/g).
- **단, 매일 반복하는 핵심 과업은 1클릭 진입 보장** — 반복 과업의 클릭은 누적 비용. 사이드바 상단 고정 primary action(Linear "New issue", Gmail "Compose"), 어느 화면에서든 접근 가능하게.
- **Empty state를 온보딩으로 설계 (필수)** — 빈 화면마다 ① 이게 뭘 담는 곳인지 ② 첫 행동 CTA. "아직 프로젝트가 없습니다" + [첫 프로젝트 만들기] (+ 샘플 데이터 옵션). 빈 테이블만 렌더링 금지 (NN/g empty states).

## 검색 vs 브라우징

- **검색을 주 동선으로 승격하는 조건**: 항목 수백+ / 사용자가 목표를 정확히 아는 유형 / 콘텐츠가 이질적. 검색은 브라우징의 대체가 아니라 병행 — 검색만 있으면 탐색형 사용자가 구조를 학습할 수 없다.
- **Cmd+K 커맨드 팔레트는 "많은 목적지 + 반복 사용 파워 유저"가 확인된 뒤에** — 내비게이션의 대체가 아니라 전문가 레이어. 가시적 내비가 먼저 완성돼야 한다. 헤더에 ⌘K 힌트 칩, 팔레트 안에 단축키 표기로 점진 학습 (Linear·GitHub 패턴).

## 모바일 내비게이션

- **바텀 탭 3~5개** — 5개 초과 시 터치 타깃 축소·라벨 잘림 (HIG·Material 공통). 6번째를 More에 욱여넣는 것은 최후 수단 — 구조를 다시 그룹핑한다.
- **전환 규칙**: 데스크톱 사이드바 항목 중 핵심 3~5개 → 바텀 탭, 나머지 → More/drawer. 햄버거 단독은 최후 수단 — 쓸 수밖에 없으면 "Menu" 라벨 병기 + 상단 관례 위치 + 버튼임을 표시.

## 상태 표시

- **현재 위치는 색 + 형태(배경/굵기/인디케이터)의 이중 신호 + `aria-current="page"`** — 색 단독은 색각 이상 배제 (WCAG G128). 현재 위치 미표시가 가장 흔한 내비 결함이다.
- **내비 라벨 = 페이지 타이틀 = 문서 `<title>` 일치** — 클릭한 라벨과 도착 페이지 제목이 다르면 scent가 단절된다. 사이드바 "Team Settings" → h1도 "Team Settings".

## 정보 구조

- **사용자 멘탈 모델 기반 그룹핑** — 조직 구조·기능 구현 단위가 아니다. 도구형 앱 기본값은 **객체 기반**(Issues, Projects, Docs — 조작 대상)이 기능 기반(Create, Manage)보다 안전 — 기능 기반은 같은 객체가 여러 메뉴에 흩어진다.
- **빈도 기반 정렬: 매일 쓰는 것 최상단, 관리·설정 최하단** — 목록 상단 = 중요도 신호. [Inbox, My Issues] → [Projects, Views] → 하단 고정 [Settings, Help]이 SaaS 관례. Settings를 상단 그룹에 섞지 않는다.

## 핵심 요약 (우선순위 순)

1. 내비를 숨기지 않는다 — 데스크톱 햄버거 금지, 모바일 바텀 탭 우선
2. 넓고 얕게 + 그룹핑 — 7±2는 오적용, 2단계 초과 시 shortcut 필수
3. 아이콘엔 항상 라벨, 라벨 = 페이지 타이틀 일치
4. back/복귀 시 상태 보존 — 필터는 URL에, 스크롤은 복원
5. 클릭 수가 아니라 scent — 단 반복 핵심 과업은 1클릭 진입점 상시 노출
6. Empty state = 온보딩 — 빈 화면마다 첫 행동 CTA
7. 현재 위치는 색+형태 이중 신호 + `aria-current`
8. 객체 기반 그룹핑, 빈도순 정렬, 설정은 맨 아래

## 출처

NN/g (hamburger menus, vertical nav, flat vs deep, breadcrumbs, icon usability, 3-click rule, empty states, card sorting, menu-design checklist) · Apple HIG tab bars · Material 3 navigation bar/rail · Baymard (back button, return to same place) · WCAG G128 · MeasuringU search vs browse
