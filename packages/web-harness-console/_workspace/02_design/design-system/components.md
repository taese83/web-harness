# 컴포넌트 인벤토리 — A(승인 렌더에 있음) / B(원리 파생, 승인 대기)

**A**는 승인 렌더에 실물이 있어 그대로 확정된 언어다. **B**는 콘솔 화면 인벤토리(index.html + app.js 렌더 함수: Overview/Documents/Features/Design/Preview/Changes/Workflow/Development/QA/다이얼로그)가 요구하지만 렌더에 없어 **원리에서 파생**했다 — 전부 "승인 대기"이며 첫 구현 프리뷰에서 승인받아야 한다. 추측을 승인된 사실로 표기하지 않는다.

## A — 승인 렌더에 있는 것

| 컴포넌트 | 확정 언어 (토큰 기준) |
|---|---|
| 브랜드 블록 | 26~32px 마크(accent→#9b7bff 그라디언트, --on-accent 글자), 이름 14px/700 + 서브 11px faint |
| 사이드바 프로젝트 행 | bg-deep 위 투명 행(--r-ctl), hover=--panel, 선택=--card+1px --line 아웃라인. 이름 13px/600, 아래 게이지(3px, 트랙 --gauge-track, 채움=상태색) + 상태 워드마크(11px/700/+.06em, 상태색·중립은 faint) |
| 사이드 섹션 라벨 | 오버라인: 11px caps +.14em faint (`Projects · 17` 카운트 병기) |
| 워크스페이스 헤더 | h1 20px/700/-.01em + 경로 12px faint + Last scan 12px faint(tabular-nums) + refresh 테두리 버튼 |
| 게이트 레일 | --panel/--r-hero 컨테이너. 노드 32px 원: pass=go 보더+go-dim 배경+--glow-go, now=warn 보더+warn-dim+pulse(--dur-pulse), wait=--line 보더+faint 숫자. 라벨 11px/700 상태색(wait=faint), 서브 11px faint. 연결선 2px: done=go+--glow-go-line, 미도달=--line. `role="img"`+aria-label로 전체 상태 문장 제공 |
| NEXT 카드 (지금 존) | --card-grad + 1px warn 보더 + 좌측 4px warn 엣지, --r-hero. tag 오버라인(warn), 제목 18px/700, 설명 13px muted(max 46ch), 액션 amber filled 1 + 테두리 1 |
| PULSE 리스트 | --panel/--r-hero, 제목 오버라인, 행 12~13px + 값 tabular-nums(상태색+워드마크) , 행간 hairline --line-soft |
| 탭 바 (상단 6탭) | 하단 hairline 위, 비활성 13px/600 **faint**(렌더 dim은 대비 미달로 정규화), hover=text, 활성=text+2px accent 밑줄 |
| 메트릭 카드 (stat) | --panel/--r-panel, 3층 계기 구성(원리 4): 오버라인 k / 24px·700 v(tabular-nums, 단위 13px faint) / 12px muted d |
| 버튼 primary (btn-p) | amber filled: --warn 배경 + --on-warn 글자, 13px/700, --r-ctl, min-height 40px. **화면당 1개, '지금 존' CTA 전용** (원리 2) |
| 버튼 secondary (btn-s) | 투명 + 1px --line 보더 + text 글자(라벨이 식별자이므로 line 허용), hover 배경 --panel 또는 보더 --line-strong |

## B — 콘솔이 요구하나 렌더에 없음 (원리 파생 · 승인 대기)

| 컴포넌트 | 파생 규칙 (근거 원리) |
|---|---|
| 상태 칩 (status-chip 전 계열) | 알약(--r-round, min-height 28px): `*-dim` 배경 + 상태색 dot + 상태색 워드마크 11px/800/+.06em (원리 5 — 색+글자 병행). 매핑: approved/connected/completed/no_change→go · pending/running/in_review/proposed→accent · stale/unapproved/draft/revision→warn · failed/blocked/timed_out/invalid/missing→stop · absent/unchanged→중립(--bg 배경+faint) |
| 서브탭 pane bar | 상단 탭과 동형, 한 단계 축소: 13px, 밑줄 2px, 여백 --sp-2 (원리: 관습 유지·위계 축소) |
| 패널 (article.panel) | --panel + 1px --line-soft + --r-panel + padding --sp-4. 패널 제목은 오버라인형(PULSE h3와 동형) — 16px 제목은 섹션 헤딩에만 (원리 3·4) |
| 문서 트리 + 마크다운 본문 | 트리=inset --bg + phase 라벨 오버라인 faint + 선택 accent-dim. 본문=리딩 표면: 16px/1.6, max 72ch, 제목 위계는 타입 스케일 그대로, 코드 블록 --bg inset + mono 13px (구 시스템 리딩 규칙 계승) |
| 기능 카드 / 서브기능 / TC 목록 | 카드 --panel/--r-panel, 선택=--card+1px accent, ID는 mono 12px accent, TC 사각 칩=--card 배경+mono 11px muted (원리 3·4) |
| 워크플로우 보드 행 | 행=패널 내 hairline 분리, 단계 표시는 게이트 레일의 축소형(노드 16px, 라벨 없이 tooltip/sr-only), 카운트 tabular-nums (원리 1·4) |
| 라이브 헬스 칩·가이드 | 칩=상태 칩과 동형, 연결됨에만 --glow-go 허용(상태이므로, 원리 1). 실패 가이드 패널=stop-dim 배경+1px stop 보더+본문 muted |
| 변경요청 다이얼로그 | 표면 --panel/--r-hero, backdrop rgba(10,15,27,.72)(bg-deep 계열 — 원리 3), 컨텍스트 블록 inset --bg, 필드 보더 **--line-strong**(보더가 유일한 식별자 — accessibility.md), 액션 우하단: 테두리 취소 + filled 확정(amber는 '지금' 의미일 때만, 아니면 accent filled+--on-accent) |
| 버튼 danger | 투명 + 1px stop 보더 + stop 글자, hover=stop-dim 배경 (원리 2 — red는 파괴 전용) |
| 버튼 armed (2단 확인) | 1단 danger 클릭 → 2단 armed: --stop filled + --on-stop 글자 + 라벨이 결과 서술("정말 중단")로 교체, 수 초 후 자동 해제. 색만이 아니라 라벨 변화 병행 (원리 5) |
| 빈 상태 | 1px dashed --line + muted 본문 + 다음 행동 버튼 1개(테두리형 — 빈 상태는 '지금'이 아님) |
| 로딩 스피너 | 24px, 트랙 --gauge-track + 헤드 --accent, --dur-spin, 로딩 텍스트 병행 |
| 토스트/글로벌 메시지 | accent-dim 배경 + 1px accent 계열 보더 + text 본문, role=status 유지. 성공/실패 변형은 go-dim/stop-dim + 해당 워드마크 (원리 5) |
| count-badge | --card 배경 + muted 12px tabular-nums 알약 |
| diff 블록 | added=go-dim 배경+go 텍스트+`+` 기호, removed=stop-dim+stop+`-` — 색+기호 병행 (원리 5) |
| QA TC 카드·히스토리 | 카드=패널 내 --r-ctl 블록, verdict 워드마크(go/stop)+tabular-nums 시각·소요 faint (원리 4·5) |
| 테이블 | 헤더 오버라인 faint, 행 hairline, 숫자 열 우측 정렬 tabular-nums (원리 4) |
| 스킵 링크 | --accent 배경 + --on-accent 글자 (대비 7.9:1) |
| 폼 필드 (input/textarea/select) | --bg inset 배경 + 1px --line-strong 보더 + text 글자, focus는 공통 focus ring |

B 항목의 승인 경로: 첫 적용 화면의 프리뷰 라운드에서 사용자 승인 → A로 승격하고 이 표를 갱신한다.
