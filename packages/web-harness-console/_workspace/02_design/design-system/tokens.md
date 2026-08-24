# Tokens — 승인 렌더 실측 → 정규화

근거는 `approved-render.html`의 실제 사용값 하나뿐이다. 격자 밖 실측값은 아래 §정규화 대장에 실측→토큰 차이와 이유를 남긴다 — "왜 렌더와 1px 다른가"가 사후 미스터리로 남지 않게.

## `:root` 이식 블록 (styles.css 상단 `:root` 대체용 — vanilla CSS, 무의존)

```css
:root {
  color-scheme: dark;

  /* ── 표면: 밝기 사다리 — 다크에서 elevation은 그림자가 아니라 표면 밝기 (원리 3) ── */
  --bg-deep: #0a0f1b;   /* 최심부: 사이드바, 사이드 푸터 */
  --bg: #0d1321;        /* 앱 배경 */
  --panel: #141c2f;     /* 1단: 패널·레일·리스트 */
  --card: #1a2440;      /* 2단: 카드·선택 배경 */
  --card-grad: linear-gradient(160deg, #1a2440, #1c2136); /* NEXT 히어로 카드 전용 */
  --gauge-track: #232e49; /* 게이지·프로그레스 트랙 */

  /* ── 라인 ── */
  --line-soft: #1f2941;   /* hairline 구분선 (장식) */
  --line: #28324d;        /* 컨테이너 윤곽 (장식 — 보더가 유일한 컨트롤 식별자일 때 사용 금지) */
  --line-strong: #66759a; /* 기능 보더: 모든 표면에서 ≥3:1 — 인풋, 보더 단독 식별 컨트롤 */

  /* ── 텍스트 위계 3단 + 비텍스트 ── */
  --text: #e8edf7;   /* 1위계: 제목·본문 */
  --muted: #93a0bb;  /* 2위계: 설명·보조 본문 */
  --faint: #8290ad;  /* 3위계(최저 읽기 텍스트): 경로·타임스탬프·오버라인 — card 위 4.8:1 */
  --dim: #5c6a8a;    /* 텍스트 사용 금지 (card 위 2.8:1): 장식·비활성 윤곽·게이지 idle 전용 */

  /* ── 상태 4색 — 의미 예약 (원리 2) ── */
  --go: #3ddc97;     /* 통과·승인·연결 (증거 있음) */
  --warn: #ffc555;   /* '지금' — 진행 중·행동 필요·stale */
  --stop: #ff6b6b;   /* 실패·차단·파괴적 액션 */
  --accent: #6ea8ff; /* 내비·선택·포커스·정보 (비상태) */
  --go-dim: rgba(61, 220, 151, .14);
  --warn-dim: rgba(255, 197, 85, .14);
  --stop-dim: rgba(255, 107, 107, .14); /* 파생 — 렌더의 *-dim 패턴 완성 (렌더에 stop-dim만 부재) */
  --accent-dim: rgba(110, 168, 255, .14);
  --on-go: #0b2417;    /* go 솔리드 위 텍스트 9.3:1 (파생) */
  --on-warn: #1a1405;  /* warn 솔리드 위 텍스트 11.7:1 (렌더 실측) */
  --on-stop: #1f0808;  /* stop 솔리드 위 텍스트 6.9:1 (파생) */
  --on-accent: #0a0f1b;/* accent 솔리드 위 텍스트 7.9:1 (렌더 브랜드 마크 실측) */

  /* ── 발광 — 상태의 전유물, 장식·hover 금지 (원리 1) ── */
  --glow-go: 0 0 14px rgba(61, 220, 151, .25);      /* 통과 게이트 노드 */
  --glow-go-line: 0 0 8px rgba(61, 220, 151, .4);   /* 통과 링크(레일 연결선) */
  --glow-warn: 0 0 16px rgba(255, 197, 85, .35);    /* '지금' 게이트 기저 */
  --glow-warn-peak: 0 0 26px rgba(255, 197, 85, .55); /* pulse keyframe 정점 전용 */

  /* ── 타이포 ── */
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --fs-overline: 11px;  /* caps 라벨·상태 워드마크 (전용: +tracking, 800) */
  --fs-caption: 12px;   /* 메타·타임스탬프·칩 */
  --fs-compact: 13px;   /* 컨트롤·리스트 본문 */
  --fs-body: 14px;      /* 기본 본문 */
  --fs-h3: 16px;
  --fs-h2: 18px;        /* NEXT 카드 제목급 */
  --fs-h1: 20px;        /* 페이지 제목 */
  --fs-metric: 24px;    /* 계기 숫자 (전용: tabular-nums, 700) */
  --fs-doc: 16px;       /* 문서 리딩 본문 (Documents 탭 markdown 전용, line-height 1.6) */
  --lh-body: 1.55; --lh-heading: 1.3; --lh-doc: 1.6;
  --fw-regular: 400; --fw-medium: 600; --fw-bold: 700; --fw-black: 800;
  --ls-overline: .14em; /* 11px caps 오버라인 전용 */
  --ls-status: .06em;   /* 상태 워드마크 전용 */
  --ls-h1: -.01em;

  /* ── 간격 (8pt, 반단위 4) ── */
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px;
  --sp-6: 24px; --sp-8: 32px; --sp-10: 40px; --sp-12: 48px;

  /* ── 형태 ── */
  --r-ctl: 8px;    /* 버튼·행·인풋·사각 칩 */
  --r-panel: 12px; /* 패널·스탯 카드·다이얼로그 내부 블록 */
  --r-hero: 14px;  /* 화면 척추 카드: 레일·NEXT·PULSE (2단 유지 — 정규화 대장 참조) */
  --r-round: 999px;/* 알약 칩 */
  --stroke-link: 2px;  /* 레일 연결선 */
  --stroke-gauge: 3px; /* 사이드바 게이지 높이 */
  --stroke-edge: 4px;  /* NEXT 카드 좌측 강조 바 */
  --sidebar-w: 248px;

  /* ── 모션 — 이름만으로 자명하지 않으므로 전 토큰에 선언 목적 명시 ── */
  --dur-pulse: 2.2s; /* 루프: '지금' 게이트 존재 알림 전용. reduced-motion 시 정지하고 정적 --glow-warn으로 대체 — 보더+색+텍스트가 병행하므로 정보 손실 없음 */
  --dur-spin: .8s;   /* 루프: 로딩 스피너 전용. reduced-motion 시 제거(콘솔 전역 규칙 유지), 로딩 텍스트 병행이 정보 전달 */
  --dur-fast: 120ms; /* 인터랙션 전환: hover/active의 색·보더·배경 (파생 — 렌더 미정의, 원칙 기본값) */
  --dur-med: 200ms;  /* 인터랙션 전환: 다이얼로그·패널 개폐 (파생 — 렌더 미정의, 원칙 기본값) */
}
```

## 레거시 alias (구 styles.css 변수명 → 신 토큰; `:root` 교체 시 함께 넣어 1차 재피복)

```css
:root {
  --surface: var(--panel);
  --surface-subtle: var(--bg);           /* inset(물러난) 표면: 다크에서는 더 어둡게 — 코드 블록·문서 트리 */
  --surface-selected: var(--accent-dim);
  --border: var(--line);
  --border-soft: var(--line-soft);
  --primary: var(--accent);              /* 구 primary의 내비·선택·링크 의미 */
  --primary-hover: var(--accent);        /* hover 밝은 변형 값은 승인 대기 — 당장은 배경(--accent-dim) 변화로 hover 표현 */
  --focus: var(--accent);
  --success: var(--go);   --success-bg: var(--go-dim);
  --warning: var(--warn); --warning-bg: var(--warn-dim);
  --error: var(--stop);   --error-bg: var(--stop-dim);
  --info-bg: var(--accent-dim);
  --shadow: none;                        /* 다크: elevation은 그림자가 아니라 표면 밝기 (원리 3) */
}
```

주의: 구 `.primary-button`(파랑 filled, 헤더 새로고침)은 신 시스템에서 **secondary(테두리형)**가 된다 — 렌더의 헤더 refresh가 테두리형이고, filled 강조(amber `btn-p`)는 "지금 존" CTA 전용이기 때문(원리 2). alias의 `--primary`를 filled 배경으로 그대로 쓰면 강조 예산을 위반한다.

## 정규화 대장 (실측 → 토큰, 근거)

| 렌더 실측 | 토큰값 | 근거 |
|---|---|---|
| h1 21px / weight 750 | 20px / 700 | 타입 스케일 격자(12/14/16/20/24)·굵기 4단계 사다리 |
| weight 650 / 750 / 780 / 800 | 600 / 700 / 800 | 굵기 4단계 원칙 (650→600, 750→700, 780·800→800) |
| 9.5px(.st) / 10px / 10.5px | 11px | 오버라인 하한 — 원칙 Overline 11~12px, 한글 가독 하한 |
| 12.5px | 13px | compact 본문 단일화 |
| letter-spacing .12 / .14 / .16em | .14em 단일 | 원칙 +0.08em 대신 0.14em: 승인 렌더의 계기판 오버라인 물성 유지 (11px caps 전용) |
| main padding 22px 30px | 24px 32px | 8pt 격자 스냅 |
| rail padding 16px 22px | 16px 24px | 8pt |
| aside padding 18px 14px | 16px 16px | 8pt |
| 카드 간 gap·margin 14px | 16px (--sp-4) | 8pt, 그룹 여백 하한 16 |
| proj 행 padding 9px 8px | 8px | 8pt 반단위 |
| gate min-width 86px | 88px | 8pt |
| gate node 34px | 32px | 8pt (비인터랙티브 role="img" — 타깃 크기 규칙 비적용) |
| radius 7px(브랜드) / 9px(버튼) | 8px (--r-ctl) | 컨트롤 radius 단일화, 1px 차이는 비지각 |
| radius 12px vs 14px | 12(--r-panel)·14(--r-hero) **2단 유지** | 렌더가 척추 카드(레일·NEXT·PULSE)와 일반 카드(stat)를 의도적으로 구분 — 정체성 보존. 원칙에 radius 격자 없음 |
| `--dim` #5c6a8a을 텍스트로 사용 (path·scan·sub·비활성 탭·ABSENT 워드마크) | **--faint #8290ad 신설**, 해당 역할 전부 faint로 | AA 위반 — dim은 card 위 2.8:1 (계산, accessibility.md). 접근성 하한은 협상 불가. dim은 비텍스트(장식·비활성 윤곽·게이지 idle)로 강등 |
| `--line` #28324d을 버튼(btn-s)·컨트롤 보더로 사용 | **--line-strong #66759a 신설** (기능 보더 전용) | 비텍스트 3:1(SC 1.4.11) — line은 표면 대비 1.2~1.5:1로 장식 전용. 텍스트 라벨이 있는 버튼은 line 유지 가능하되, 보더가 유일한 식별자인 컨트롤(인풋 등)은 line-strong 강제 |
| 배경 #0d1321 (원칙 예시 #121212와 다름) | 실측 유지 | 원칙 취지(순검정 회피·재설계) 충족 — 청색조 슬레이트는 승인된 정체성 |
| 색상(hue) 전반 | 실측 유지 | 승인 렌더가 곧 정본 — 색은 정규화 대상 아님 |

## 라이트 모드 (값 없음 — 승인 대기)

승인 렌더는 다크 단일이다. 라이트 값은 지어내지 않는다. 필요해지면 파생 규칙만 적용한다: ① 반전이 아니라 재설계 — 밝기 사다리를 종이 기반(배경>패널>카드 밝기 역순)으로 다시 세운다, ② 상태 4색은 라이트 배경에서 4.5:1을 만족하는 어두운 변형으로 재도출(#3ddc97 등 현재 값은 라이트 배경에서 불합격 확실), ③ 발광(glow)은 라이트에서 성립하지 않으므로 대체 표현(보더 두께·배경 틴트)을 새로 승인받는다. 전부 **B급(승인 대기)** — 렌더 없이 확정 금지.

## 이식 시 소탕 대상 (구현 범위 밖 — 목록만)

styles.css의 `:root` 밖 하드코딩: 사이드바 계열(#101828 #263348 #1d2939 #263b5d #0c1422 #aebbd0 #dbe4f0 #cbd5e1 #84adff), 본문 회색 계열(#344054 #6b7280 #eef2f7 #edf2f7 #f8fbff #f6f8fb #25334b #dbeafe #f1f5f9), semantic 고정값(#12b76a #f04438 #b42318 #fda29b #a6f4c5 #fedf89 #7a2e0e #7a271a #05603a #84caff #b2ddff), spinner(#dbe4f0), preview-frame `background:#fff`(iframe 문서 배경 — 유지 판단 필요). `meta color-scheme` light→dark.
