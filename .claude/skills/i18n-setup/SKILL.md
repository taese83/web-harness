---
name: i18n-setup
description: Introduces internationalization to a web-harness project — locale inventory, message catalog structure, ICU formatting, locale routing strategy, string extraction, and translation completeness checks. Use when a project needs more than one display language or locale-aware formatting.
argument-hint: "[locales and routing requirements]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, Agent, AskUserQuestion
metadata:
  version: 1.0.0
  maturity: eval-covered
  updated: 2026-08-03
  changelog: 신설 — P1-3 i18n 커버리지 확장 (자동화 역량 보고서 로드맵).
---

# i18n Setup

다국어·locale 대응을 계약 기반으로 도입한다. `developer`가 만들어 두는 빈 `src/shared/lang/`이 이 스킬의 구현 지점이며, visual QA의 locale matrix가 이 스킬의 소비자다.

## 언제 사용

- 표시 언어가 2개 이상 필요하거나 예정됨
- 날짜·숫자·통화·복수형이 locale별로 달라야 함
- 언어별 URL(`/ko/…`, `/en/…`) 또는 언어 전환 UI가 필요함

**적합하지 않은 경우**: 단일 언어 고정 서비스(이 경우 하드코딩 문자열이 정당하다), 문자열 2~3개의 단순 언어 토글.

## Start

intake (최대 3개씩):

1. **locale 목록과 기본 locale** — 예: `ko`(기본), `en`. 미정 locale은 `ASSUMPTION`
2. **routing 전략** — URL prefix(`/en/…`) / 저장된 preference / Accept-Language 초기값. 공개 SEO 서비스면 URL prefix + hreflang을 기본 권장
3. **번역 소스와 워크플로** — 개발자 직접 작성 / 번역 파일 외부 수령 / TMS 연동(범위 밖이면 수령 포맷만 고정)
4. **라이브러리** — 기본 권장: react-i18next(+ICU 필요 시 i18next-icu), Next profile이면 next-intl. 정확한 버전은 `/lib-advisor`의 현재성 검증을 거쳐 typed broker로 설치한다. 하드코딩 버전을 이 스킬이 단정하지 않는다

## Workflow

파일 작성은 **`developer`** subagent에게 위임한다 (소유: `_workspace/02_design/i18n-spec.md`, `src/shared/lang/**`). locale routing 세그먼트와 Next `[locale]` 세그먼트는 각각 라우팅 범위의 `developer` 스폰이 소유하므로 여기서는 spec으로 전달만 한다.

### 1. i18n Spec — `_workspace/02_design/i18n-spec.md`

- locale 목록, 기본 locale, fallback 체인
- namespace 구조(페이지/기능 단위)와 key 명명 규칙(`feature.component.purpose` — 영문 문장을 key로 쓰지 않는다)
- ICU 사용 범위: 복수형(`{count, plural, …}`), 선택(`{gender, select, …}`), 날짜/숫자/통화는 `Intl.*` 사용
- routing 전략과 locale 감지·저장 정책
- 번역 누락 정책: 기본 locale fallback + dev 모드 경고, production에서 key 노출 금지

### 2. Catalog 구조 — `src/shared/lang/`

```
src/shared/lang/
  index.ts          # i18n 초기화, public API
  ko/common.json    # namespace별 catalog
  ko/{feature}.json
  en/common.json
  en/{feature}.json
```

- catalog는 JSON — 코드 로직을 넣지 않는다
- 모든 locale이 동일한 key 집합을 가진다 — 누락은 완료 조건 위반
- lazy namespace 로딩은 측정된 필요가 있을 때만 (소규모 catalog에 기계적 분할 금지)

### 3. 구현 규칙

- 사용자 노출 문자열을 JSX/TS에 하드코딩하지 않고 `t('key')`를 사용한다. 로그·에러 코드·내부 식별자는 대상이 아니다
- 날짜·숫자·통화 포맷은 수동 문자열 조합 금지 — `Intl.DateTimeFormat`/`NumberFormat` 또는 라이브러리 formatter
- RTL locale이 목록에 있으면 `dir` 속성과 logical CSS property(`margin-inline-start` 등) 계약을 spec에 추가
- 언어 전환 시 라우터 상태·폼 입력이 유실되지 않아야 한다
- CJK 입력(IME)과 i18n이 결합된 검색/폼은 `.claude/skills/component-gen/references/input-focus-ime.md`를 따른다

### 4. 검증

- `ux-validator`가 i18n-spec 존재 시 translation completeness(전체 locale 동일 key)와 하드코딩 문자열을 검사한다
- `VISUAL_QA_MODE`이면 visual contract의 locale matrix에 이 스킬의 locale 목록을 사용한다 — 두 목록이 다르면 계약 위반
- 텍스트 길이 팽창(독일어 등 +30%)으로 인한 레이아웃 깨짐은 browser/visual QA의 대상 locale로 확인한다

## Hard Stops

- 기본 locale을 결정할 수 없음 (`BLOCKER`)
- 공개 SEO 서비스인데 URL 전략 없이 client-only 언어 전환을 요구함 — hreflang/index 정책과 모순
- 기존 하드코딩 문자열의 전수 추출이 요구되지만 대상 화면 범위가 합의되지 않음 — 범위 합의 전 bulk 치환 금지

## 완료 조건

- `i18n-spec.md`의 locale·routing·fallback 정책이 구현과 일치한다
- 모든 locale catalog가 동일 key 집합을 가진다
- 대상 화면의 사용자 노출 문자열이 catalog를 통과한다 (하드코딩 잔존 목록 0 또는 승인된 예외)
- 언어 전환이 상태 유실 없이 동작한다 (`/run` 또는 browser QA로 확인)
