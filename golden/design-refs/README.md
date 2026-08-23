# 디자인 레퍼런스 아카이브

발산 프로브에서 **사용자가 확정한** 시안의 렌더 원본을 보존한다. 이 디렉터리는 디자인 시스템도
템플릿도 아니다 — 계약 개정 논의와 후속 실험의 근거가 되는 **증거물**이다.

- 이 렌더는 특정 브리프(eval fixture)의 산출이며, 다른 서비스의 출발점으로 재사용하지 않는다
  (`design-principles-research.md` §발산 6 "앵커화 금지" — 과거 시안이 출발점이 되면 조사가
  그 안으로 수렴해 재탕이 된다).
- 토큰·컴포넌트 인벤토리로의 추출은 별도 작업이다. 여기 있는 것은 렌더일 뿐이다.

| 항목 | 브리프 | 확정 경위 | receipt |
|---|---|---|---|
| `grainhouse-c3/` | Grainhouse — 필름 현상소 온라인 창구(브랜드-포워드, 반레트로 긴장) | 자유군 3후보에서 사용자가 축을 분해·재조합: C 스타일 + A 구조, 한글 A 서체 · 영문 C 서체 | `docs/efficacy/receipts/free-lane-divergence-probe.md` |

`grainhouse-c3/index.html`의 대비는 기계 검사 15/15 PASS(텍스트 4.5:1 · 비텍스트 3:1)이며,
색 이식 과정에서 검출·수정한 결함 2건의 근거는 파일 내 주석과 위 receipt에 있다.

## grainhouse-c3/design-system/ — 추출된 시스템 (2026-08-23)

승인 렌더 1장에서 추출하고, 파생 화면 4종을 만들며 사용자 검토로 **12건을 갱신**한 상태다.
`docs/efficacy/receipts/design-system-extraction.md`가 그 왕복의 receipt다.

| 파일 | 내용 |
|---|---|
| `INDEX.md` | 소비자별 읽기 안내 |
| `principles.md` | **생성 원리 5개** — 토큰에 없는 값을 정할 때의 근거 |
| `tokens.md` | 토큰 49종 + 정규화·판단 기록 |
| `theme.code.css` | `@font-face`(서체 3분할) + `@theme` 전문 |
| `components.md` | 인벤토리 — A(렌더 존재) / B(원리에서 파생) 구분 |
| `accessibility.md` | 대비 계산표(기계 검증 완료) + 하한 계약 |

`DERIVATION.md`는 파생 화면 4종을 만들며 남긴 "그대로 쓴 것 vs 원리에서 파생한 것" 기록이다.
