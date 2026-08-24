# Design System v2 — Web Harness Console ("Gate Rail")

승인 렌더에서 추출한 디자인 시스템. **구 `_workspace/02_design/design-system.md`(라이트 테마)를 대체한다** — 구 파일은 대조용으로만 남긴다.

- **승인 정본(유일한 근거)**: `_workspace/02_design/approved-render.html` — 후보 A "Gate Rail" (계기판형, 다크). 사용자가 라운드 1에서 확정.
- **기각 기록**: 라운드 1의 후보 B(Evidence Ledger — 라이트 지면·타이포형)·후보 C(Ops Terminal — 모노스페이스 터미널형)는 사용자 선택에서 탈락. 세 후보와 방향 설명은 `candidates/round-1/`에 보존.
- **다크가 기본 팔레트다.** 라이트 모드 값은 지어내지 않았다 — `tokens.md` §라이트 모드에 파생 규칙만 있고 값은 "승인 대기".

## 절 파일과 주 소비자

| 파일 | 담당 범위 | 주 소비자 |
|---|---|---|
| `tokens.md` | 색·타이포·간격·형태·모션 토큰, 정규화 대장, `:root` 이식 블록, 레거시 alias | component-designer, app-shell-builder, design-preview-builder |
| `principles.md` | 토큰에 없는 값을 정할 때의 판단 근거 5원리 + 파생 절차 | 전체 (모든 design·build agent) |
| `components.md` | 인벤토리 — A(승인 렌더에 있음) / B(원리에서 파생, **승인 대기**) 구분 | component-designer, layout-designer, design-reviewer |
| `accessibility.md` | 계산된 대비표, 기능 보더 3:1 규칙, focus, 타깃 크기, reduced-motion·forced-colors | design-reviewer, component-designer |
| `style-tile.html` | 확정 언어의 참조표 1장 (무의존·인라인 CSS). **방향 선택용이 아니다** | 사람 검토자, design-preview-builder |

## 구 시스템 대비 무엇이 바뀌나 (대조 요약)

- 라이트(#f3f5f8 배경, 파랑 primary filled) → **다크 슬레이트**(#0d1321) + 밝기 사다리 elevation(그림자 폐기).
- primary 액션 색: 파랑 → **호박(amber #ffc555)**, 단 "지금 존" CTA 전용 예산. 파랑(--accent)은 내비게이션·선택·포커스 역할로 이동.
- 상태 표현에 **발광(glow)** 도입 — 게이트·상태 전유, 장식 사용 금지.
- 사이드바 프로젝트 행: 텍스트 행 → **소형 게이지 행**(3px 진행 바 + 상태 워드마크).
- Overview 신규 요소: **게이트 레일**(화면 척추), **NEXT 카드**(지금 존), **PULSE 리스트**.

## 이식 주의 (구현은 이 산출 범위 밖)

`public/styles.css`는 `:root` 밖 하드코딩 hex가 다수(#101828 #263348 #1d2939 #263b5d #84adff #0c1422 #aebbd0 #dbe4f0 #344054 #eef2f7 등)라 `:root` 교체만으로 완전히 재피복되지 않는다. `tokens.md` §레거시 alias가 1차 재피복을 담당하고, 소탕 대상은 `tokens.md` §이식 시 소탕 대상 참조. `index.html`의 `<meta name="color-scheme" content="light">`도 `dark`로 바꿔야 한다.
