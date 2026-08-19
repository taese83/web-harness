# Style-Tile 내장 대비 검사 — 렌더 실측 receipt (2026-08-18)

`assets/style-tile.html`의 자기평가 대비 검사가 실제로 판정하는지의 실행 근거.
방법: 템플릿 사본 2부를 각각 `tokens.css`와 함께 로컬 정적 서버(node)로 서빙,
브라우저 렌더 후 페이지 텍스트로 검사 결과를 수집(오케스트레이터 세션,
harness-change-review가 receipt 부재를 지적해 사후 기록 — 목격은 기록되기 전까지
증거가 아니다).

## 후보 1 — 통과 세트 (warm cream + terracotta)

tokens: bg `#faf7f2` · surface `#ffffff` · text `#1f2933` · muted `#52606d` ·
accent `#99582a` · on-accent `#ffffff` · border `#8a7968` · danger `#a52a2a`

```
본문 text/bg: 13.81:1 (하한 4.5:1) — PASS
보조 muted/bg: 6.04:1 (하한 4.5:1) — PASS
본문 text/surface: 14.76:1 (하한 4.5:1) — PASS
액센트 on-accent/accent: 5.55:1 (하한 4.5:1) — PASS
오류 danger/bg: 6.63:1 (하한 4.5:1) — PASS
비텍스트 border/bg: 3.92:1 (하한 3:1) — PASS
```

## 후보 2 — 상투 룩 위반 세트 (near-black + 애시드 그린 — 상투 회피 목록의 룩)

tokens: bg `#0a0a0a` · surface `#161616` · text `#e8e8e8` · muted `#4a4a4a` ·
accent `#39ff14` · on-accent `#d0ffd0` · border `#222222` · danger `#ff2222`

```
본문 text/bg: 16.16:1 (하한 4.5:1) — PASS
보조 muted/bg: 2.23:1 (하한 4.5:1) — FAIL
본문 text/surface: 14.77:1 (하한 4.5:1) — PASS
액센트 on-accent/accent: 1.22:1 (하한 4.5:1) — FAIL
오류 danger/bg: 5.19:1 (하한 4.5:1) — PASS
비텍스트 border/bg: 1.24:1 (하한 3:1) — FAIL
```

판정: 통과 세트 6/6 PASS, 위반 세트 FAIL 3건 검출 — 검사기가 실제 판정함.
부수 관찰: 상투 룩이 기계 하한에서도 자연 탈락 — 상투 회피(취향)와 접근성
하한(기계)이 같은 방향을 가리킨 사례.

## 한계 (정직 명세)

- 이 receipt는 위 두 토큰 세트를 같은 템플릿에 다시 입히면 재현 가능하나,
  수집 자체는 세션 내 수동 실행이다(자동 eval 시나리오 아님 — 승격 TODO).
- 검사기는 후보 디렉터리로 복사된 **사본 안에서** 자체 채점된다 — 사본 변조를
  잡는 독립 기계는 없다(protected-core §4 "스타일 타일 자기채점 대비 검사" 행).
