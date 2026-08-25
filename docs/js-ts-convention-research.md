# JS/TS 코드 컨벤션 리서치 (2026-08)

*규약 확장(ts-conventions.md ③단계)을 위한 근거 자료. 조사: `tech-advisor`, 출처는 각 절에 명시.
**표기 원칙**: 검색으로 확인한 것과 사전 지식을 구분하고, 확인 못 한 것은 "미확인"으로 남긴다.*

## 배경 — TS 버전 지형

TypeScript 6.0(2026-03-23)이 **JS 기반 컴파일러의 마지막 메이저**이고, Go 네이티브 7.0이 RC
단계다. 하네스 방침(신규 major는 CI fixture 통과 후 채택)과 맞물려 **6.0을 기준선**으로 둔다.
브라운필드 주의 신호: TS 5.x 코드가 `verbatimModuleSyntax` 하에서 대량 에러를 내는 실사례 보고
(mixed import·namespace re-export·side-effect module) — 신규 생성 코드는 무관.

## 현재 하네스 규약과의 충돌 (조치 필요)

| # | 현재 규약 | 리서치 결론 | 조치 |
|---|---|---|---|
| C1 | `ts-conventions.md` 예시가 `React.FC` 사용 | **React 19에서 `FC` 비권장** — 함수 선언 + `type Props` | 예시 교체 |
| C2 | "명시적 props **interface**" | props는 `type`이 현재 관행(React 유틸리티 타입과 조합 자연스러움) | 예외 명문화 |
| C3 | slice `index.ts` 공개 타입 export | barrel 일반 비권장 흐름 vs FSD 필수 규칙 **정면 충돌** | 절충 규약(아래 §barrel) |
| C4 | `enum` 언급 없음 | `enum`/`const enum` 금지 + `as const` union이 Vite·isolatedModules 정합 | 신규 조항 |
| C5 | `import type` 권장(구문 미지정) | `verbatimModuleSyntax: true` + 분리 구문 표준화 | tsconfig+린트 확정 |

## 항목별 결론

### type vs interface
- **합의**: 객체 shape·공개 계약 = `interface`(선언 병합·확장), 유니온/교차/매핑/조건부 = `type`.
- **논쟁**: React props는 "공개 계약"인데도 커뮤니티는 `type`을 권장 — 위 합의와 충돌.
- **권장**: FSD 슬라이스 public API 타입 = `interface`, **컴포넌트 props·내부 조합 = `type`**(명시적 예외).
  `@typescript-eslint/consistent-type-definitions`로 강제하되 props 예외 허용.
- 출처: [Google TS Style Guide](https://google.github.io/styleguide/tsguide.html) · [2026 가이드](https://www.iloveblogs.blog/guides/interfaces-vs-types-in-typescript)
- **미확인**: Google 가이드의 type/interface 전면 강제 규정 유무(원문 재확인 필요).

### enum
- TS 5.8 `--erasableSyntaxOnly`가 런타임 구문(enum·namespace·parameter properties)을 에러 처리.
- `const enum`은 **공식 폐기가 아니다**(TS 팀이 폐기 제안 거부). 단 Google 가이드는 `const enum` 금지·일반 `enum` 권장으로 **정반대**.
- 세 진영 공존(Google / isolatedModules·Vite / 실용) — 단일 합의 없음.
- **권장(본 스택)**: Vite + `isolatedModules`이므로 **둘 다 금지**, `as const` 객체 + 파생 union.
  `erasableSyntaxOnly` 활성화는 팀 선택(tooling 호환 검증 필요).
- 출처: [TS 5.8 릴리스노트](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-8.html) · [oida.dev](https://oida.dev/erasable-syntax-only/) · [jsmanifest](https://jsmanifest.com/typescript-enums-const-objects-2026)

### import type / verbatimModuleSyntax
- `verbatimModuleSyntax`(TS 5.0~)가 `importsNotUsedAsValues`/`preserveValueImports`를 대체.
- **권장**: 신규 코드라 리스크 낮음 → `verbatimModuleSyntax: true` + `consistent-type-imports`
  (`fixStyle: 'separate-type-imports'`)로 `import type { X }` 분리 구문 표준화.
- 출처: [공식 tsconfig](https://www.typescriptlang.org/tsconfig/verbatimModuleSyntax.html) · [typescript-eslint 블로그](https://typescript-eslint.io/blog/consistent-type-imports-and-exports-why-and-how/)

### 반환 타입 · satisfies
- `explicit-function-return-type`은 **recommended에서 제거됨**(유지보수 비용 > 이득).
  절충안 `explicit-module-boundary-types`가 널리 채택.
- `satisfies`는 설정 객체·discriminated union·Record 맵에서 2026 표준 패턴. `as`보다 우선.
  단 **컴파일 타임 전용** — 런타임 검증(Zod)을 대체하지 않는다.
- **권장**: 내부 함수 추론 유지, **슬라이스 public API만 반환 타입 강제**. TanStack Query
  `queryOptions`·Zustand creator·라우트 정의에 `satisfies` 표준화.
- 출처: [typescript-eslint #2603](https://github.com/typescript-eslint/typescript-eslint/issues/2603) · [jsmanifest satisfies](https://jsmanifest.com/typescript-satisfies-advanced-patterns-2026)

### 불변성
- `readonly`는 **얕다**(중첩 미적용)·런타임 오버헤드 0(런타임 변경을 막지 못함).
- **권장**: 함수 파라미터 배열/객체와 상태 스냅샷에 `readonly`/`ReadonlyArray`, 도메인 상수는 `as const`.
  전역 "모든 프로퍼티 readonly"는 **팀 선택**.
- 출처: [Better Stack](https://betterstack.com/community/guides/scaling-nodejs/ts-readonly/)

### 에러 처리
- `useUnknownInCatchVariables`(strict 포함)로 catch가 `unknown` — 타입 가드 필수.
  **예외**: `Promise.prototype.catch()` 콜백 인자는 여전히 `any`.
- 원칙: 예상 못한 실패는 예외, **복구 가능한 실패는 Result**. 단 Result 전면 도입은 TanStack
  Query의 예외 기반 에러 채널과 마찰.
- **권장**: 경계(네트워크·폼)는 예외 유지, 순수 도메인은 Result **팀 선택**. catch는
  `instanceof Error` 가드 + `cause` 체이닝.
- **미확인**: `Error.cause`가 업계 표준으로 정착했다는 근거는 직접 확인 못 함(ES2022 표준·광범위 지원은 사실).
- 출처: [공식 tsconfig](https://www.typescriptlang.org/tsconfig/useUnknownInCatchVariables.html) · [typescript.tv](https://typescript.tv/best-practices/error-handling-with-result-types/)

### 명명
- 파일명 kebab vs Pascal은 **업계 단일 표준 없음**(Vite·Next 생태계는 kebab 수렴, 전통 React는 Pascal).
- 제네릭: 단일 `T`, 복수는 `TData`/`TError`(TanStack Query 관행). 불리언은 `is`/`has`/`should`/`can`.
- 상수 `CONST_CASE`는 모듈 레벨·정적 필드·enum 값만(Google).
- **권장**: 컴포넌트 `PascalCase.tsx`, 훅 `useXxx.ts`(함수명 1:1), 그 외 유틸/타입은 kebab-case.
- 출처: [Sufle.io](https://www.sufle.io/blog/naming-conventions-in-react) · [webdevtutor](https://www.webdevtutor.net/blog/typescript-parameter-naming-convention)

### barrel export — 본 스택과 정면 충돌 <!-- 핵심 -->
- 2025~26 자료 다수가 barrel을 **강하게 비판**: 트리쉐이킹 저해(MUI Button 하나에 번들 2배 실측),
  순환 참조, Vite/Turbopack 캐시 무효화 방해 → direct import 권장.
- **그런데 FSD 공식 문서는 정반대**: 모든 슬라이스는 `index.ts` public API로만 노출이 **핵심 규칙**.
  단 FSD 최신 가이드도 `export *`는 지양하고 **named export만 선택 재노출** 권장.
- **권장(절충)**: 슬라이스 **경계**는 얇은 barrel 유지 + **`export *` 금지, named export만**,
  슬라이스 **내부**는 direct import. 두 흐름의 핵심 문제(전체 재노출)를 회피하면서 FSD 규칙을 지킨다.
- 출처: [FSD Public API](https://feature-sliced.design/docs/reference/public-api) · [persistdev](https://www.persistdev.blog/post/barrel-files) · [jsdev.space](https://jsdev.space/howto/stop-using-barrel-files/)

### React 19
- `PropTypes`·`defaultProps`(함수 컴포넌트) 제거. `forwardRef`는 **사실상 불필요**(ref가 일반 prop),
  향후 완전 제거 예정 + codemod 제공 예정.
- **`React.FC` 비권장** — 함수 선언 + props 타입(`type`) 권장.
- **주의**: shadcn/Radix 벤더링 코드에 React 19 `forwardRef` 경고 이슈 보고됨.
- `use` 훅·Actions의 코드 컨벤션은 **표준 미축적(미확인)**.
- **권장**: `FC` 금지·`{Component}Props` 명명, ref-as-prop 기본. tailwind-shadcn 레인은 벤더링
  시점에 forwardRef 잔존 확인. Actions 채택 시 역할 분담 명문화(서버 상태=Query, 제출=Actions).
- 출처: [React 19](https://react.dev/blog/2024/12/05/react-19) · [forwardRef 레퍼런스](https://react.dev/reference/react/forwardRef) · [shadcn-ui #3898](https://github.com/shadcn-ui/ui/issues/3898)

### 린트 지형
- ESLint flat config 사실상 표준. 점유율(2026-05 주간 다운로드): **ESLint 1.34억 · Biome 880만 · Oxlint 670만**.
- typescript-eslint `strict-type-checked`는 "팀 TS 숙련도가 높을 때"라는 **조건부 권고**(공식).
- **Oxlint가 Vite 8 기본 린터로 채택**, tsgo 기반 타입 인지 린팅. 실무는 대체가 아니라
  **dual-linter**(Oxlint 1차 빠른 실패 + ESLint 2차 정밀)가 확산(Vercel CI 60%+ 단축 보고).
- **권장**: ESLint 9 flat config 유지, `recommended-type-checked` + `strict` 선별 조합.
  `strict-type-checked` 전면 채택은 NEEDS_DECISION, Oxlint 병행은 선택적 최적화 트랙(강제 안 함).
- 출처: [typescript-eslint configs](https://typescript-eslint.io/linting/configs/) · [tech-insider](https://tech-insider.org/eslint-vs-biome-vs-oxlint-2026/) · [pkgpulse](https://www.pkgpulse.com/blog/biome-vs-eslint-prettier-2026)

## 분류 요약

| 항목 | 분류 | 결정 |
|---|---|---|
| type vs interface | 규약 | 공개 계약=`interface` · 유니온/조합=`type` · **props는 `type` 예외** |
| enum | 규약 | `enum`·`const enum` 금지 → `as const` + union |
| import type | 규약 | `verbatimModuleSyntax: true` + 분리 구문 |
| 반환 타입 | 규약 | 내부 off · 슬라이스 public API만 강제 |
| satisfies | 규약 | 설정 객체·Query options·Store creator |
| 파일명 | 규약 | 컴포넌트 Pascal · 훅 `useXxx` · 그 외 kebab |
| barrel | 규약(충돌 절충) | 경계=named-only 얇은 barrel · 내부=direct import |
| React.FC | 규약 | 금지 → 함수 선언 + `type Props` |
| ref as prop | 규약(+검증) | 기본 채택, shadcn 벤더링 시 확인 |
| readonly 전면 | **팀 선택** | 비용 대비 이득 논쟁 |
| Result vs 예외 | **팀 선택** | 경계=예외, 도메인=선택 |
| use/Actions | **팀 선택** | 표준 미축적 |
| strict-type-checked | **NEEDS_DECISION** | 팀 TS 숙련도 전제 |
| Oxlint 병행 | **팀 선택** | ESLint 대체 아님 |
