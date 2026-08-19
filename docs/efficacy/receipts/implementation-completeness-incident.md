# 시안 적용 완결성 결함 — 실측 receipt (2026-08-19)

`design-principles-research.md` §시안 적용 완결성의 근거 사건 요약. **정본 기록은 대상
프로젝트 자체 repo에 있다**: `tamiya-motor-lab`(github.com/taese83/tamiya-motor-lab,
이 repo의 workspace/는 gitignore) `_workspace/03_dev/change-scope.md`의 "R2 결함 라운드"
항목 — 그 repo의 git 이력으로 영속화됨. 이 receipt는 하네스 repo에서 검증 가능하도록
남기는 요약 사본이다.

## 사건

- 발산 시안 A(Pit-Wall Amber, 5축: 색·타이포·밀도·형태·위계)를 사용자가 승인 →
  design-system v4 개정·소스 동기화·라이브 검증·릴리스(v2.42.0)까지 완주 선언.
- **사용자가 발견**: 실제 적용은 색상 축뿐 — 폰트(모노 디스플레이)·버튼/인풋 형태
  (radius 12·매트 글로우)·밀도(6px)가 v3 값 그대로. "색상만 적용된 상황이야, 이렇게
  되면 안 되."

## 삼중 실패 (각각이 §시안 적용 완결성 규칙 1·2·3의 근거)

1. 오케스트레이터의 개정 지시가 "리컬러" 프레이밍으로 축약 스코핑됨.
2. 에이전트 완료 보고에 "task scope is color-only — shape/typography/spacing은 기존 값
   보존"이 **명시돼 있었으나** 오케스트레이터가 경보로 처리하지 않고 통과시킴.
3. 라이브 검증이 색만 확인 — 색은 가장 먼저 눈에 띄어 나머지 축의 결손을 가림
   (리컬러가 리디자인으로 보임).

## 한계 (정직 명세)

- 단일 사건(1건 실측) — 완결성 규칙의 일반화는 "명명 수준"이며, 두 번째 형태에서의
  재현 관찰이 승격 조건이다.
- 이 receipt는 요약 사본 — 사건의 1차 기록·시안 아카이브·보수 라운드 이력은
  tamiya-motor-lab repo가 정본이다.
