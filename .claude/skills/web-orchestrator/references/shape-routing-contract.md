# Shape Routing Contract — targetShapes가 빌더를 고른다

**시점 로드**: Phase 2 시작 전. 스팩 확정(`_workspace/03_dev/spec.json`)이 선행한다.

진입점은 `/web-orchestrator` **하나다**. 산출물이 웹앱이든 라이브러리든 CLI든 같은 문으로 들어와
같은 기획·디자인 게이트를 지나고, **확정된 `targetShapes`가 그 뒤의 빌더와 검증을 고른다.**

## 1. 왜 형태가 골라야 하는가

`targetShapes`는 스팩 확정에서 실측·추론·질의를 거쳐 정해진다(`solution-design-contract.md` §4).
그런데 그 값이 개발 경로에서 읽히지 않으면 확정이 헛돈다 — 스팩이 `["library"]`인데 Phase 3이
`app-shell-builder`·`route-builder`를 돌려 **라이브러리에 라우터를 만든다**(2026-08-26 실측).

`layerMap`이 소유권을 공급하는 것과 같은 구조다. 형태는 이미 **요구 검증**을 고르고 있고
(`shape-checks.json`), 여기서 **빌더**도 고른다. 두 절반이 같은 값에서 나와야 어긋나지 않는다.

## 2. 라우팅 표

Phase 1(기획)은 형태와 무관하게 **같은 에이전트**가 돈다. 해석만 달라진다 — 라이브러리에서
`ux-researcher`는 화면 UX가 아니라 **API 발견성·타입 추론·오류 메시지·migration DX**를 다룬다.
그 사실을 에이전트 prompt에 명시해 전달한다.

| targetShape | Phase 2 설계 | Phase 3 빌더 | Phase 4 검증 |
|---|---|---|---|
| `web-app` | `design-system-architect` · `layout-designer` · `component-designer` | `WEB_PROFILE` 파이프라인(SKILL.md Phase 3) | `browser-verifier` · `ux-validator` · 조건부 `seo-verifier` |
| `library` | `lib-api-designer` → `_workspace/02_design/api-design.md` | `lib-scaffolder` → `lib-core-builder` → `lib-docs-generator` → `package-publish-metadata` | `pack-verifier` |
| `cli` | `lib-api-designer`(CLI 표면: 명령·플래그·exit code·stderr 계약) | `library`와 같은 셋 | `pack-verifier` |
| `serverless-functions` | `api-schema-designer` | `/vite-serverless-hybrid` 계약의 `api/` handler | `api-contract-verifier` |

**React 컴포넌트 패키지**(`library` + UI 런타임이 react)이면 Phase 3의 `lib-core-builder`와
병렬로 `lib-story-builder`를 돌린다. 스토리는 구현과 같은 공개 API를 소비하므로 순서가 아니라
병렬이다.

**공통(형태 무관)**: `package-scaffolder` · `tooling-scaffolder`는 항상 먼저 돈다.
`code-reviewer` · `security-reviewer` · `test-executor`는 항상 돈다.

## 3. 합집합 — 형태가 여럿이면 세트를 합친다

`targetShapes`는 배열이다(라이브러리이면서 CLI인 패키지가 정상 패턴). 세트는 **합집합**이며
교집합이나 우선순위가 아니다. `["library","cli"]`이면 `lib-*` 셋이 한 번 돌고 Phase 4에
CLI 검증이 더해진다. **형태를 더하는 것이 빌더를 줄이는 경로는 없다** — 요구 검증 합집합과
같은 규율이다.

## 4. fail-closed — 스팩이 없거나 형태를 모르면

- **스팩 확정 없음**: 기존 `WEB_PROFILE` 경로로 간다. 형태 라우팅은 opt-in이며 확정하지 않은
  프로젝트의 동작을 바꾸지 않는다.
- **카탈로그 밖 형태**(`browser-extension` 등): 그 형태는 **빌더를 고르지 않고** note로 보고한다.
  하네스가 모르는 것을 실패로 만들지 않는다. 다만 카탈로그에 있는 형태가 하나도 없으면
  공통 셋만 돌므로 그 사실을 사용자에게 알린다 — 조용히 웹 파이프라인으로 떨어뜨리지 않는다.
- **형태와 `WEB_PROFILE`이 모순**(예: `["library"]`인데 `WEB_PROFILE: react-vite-spa`):
  확정된 스팩이 이긴다. 프로필은 웹앱 전용 축이고 형태가 상위 결정이다. 모순 자체는 보고한다.

## 5. 라이브러리 경로 상세

`/dev-orchestrator`가 소유하던 워크플로를 여기로 옮겼다(2026-08-26). 진입점 이원화는 분류가
**스팩 확정보다 앞에서 산문으로** 일어나게 만들었고, 확정된 `targetShapes`와 결속되지 않았다.

**설계**: 기존 API 설계가 있으면 원본을 보존하고 `lib-api-designer`가 `api-design.md`로
정규화한다. 기존 파일을 덮어쓰지 않는다.

**개발**: 공개 API를 먼저 확정하고 내부 구현을 그 계약에 맞춘다. package metadata나 export map을
기능 코드에 임시로 중복 선언하지 않는다.

**배포 메타데이터**: `package-publish-metadata`가 `package.json`의 배포 필드·`files` 허용목록·
license 검사를 담당한다. 이 산출은 `pack-verifier`와 `pack.publish-metadata` 형태 검사가 소비한다.

**브라운필드**: 기존 source가 있으면 `CHANGE_MODE: existing-change`로 기록하고 첫 edit 전에
`change-scope.md`를 쓴다(`minimal-change-contract.md`가 canonical). 각 builder에 `ALLOWED_PATHS`·
보존할 public export/type/runtime contract·`NON_GOALS`·예상 파일 범위를 전달한다.

**레지스트리**: 사내 registry 배포가 있다. `private:true`도 공개 배포도 아닌 제3의 상태이며
하네스는 아직 이를 구분하지 못한다(protected-core §4 등록). `publishConfig.registry` 유무는
관측해 기록하되 형태 판정에 쓰지 않는다.

## 일반화 근거

축은 **산출물이 어떻게 소비되는가** 하나이며 프레임워크·도메인·백엔드와 무관하다. 서로 다른
형태 2개에서 실측으로 성립함을 확인했다:

- **`web-app`** — `golden/vite-serverless-hybrid`(2026-08-26 확정). `index.html` → `createRoot`로
  브라우저가 렌더하고 `vercel.json`이 `dist`를 정적 배포한다. `bin`·`exports` 부재가 `cli`·
  `library` 주장을 기계로 배제했다. Phase 3은 `WEB_PROFILE` 파이프라인이 맞다.
- **`library`** — `@kakao/ai-chatkit`(2026-08-26 확정, pnpm 모노레포의 배포 패키지). `exports`·
  `main`·`types`가 `dist/`를 가리키고 `build.lib.entry`가 단일 진입점이다. `index.html`이 있지만
  `src/main.ts` 주석이 "라이브러리 빌드에 포함되지 않습니다"로 명시해 web-app을 배제했다 —
  **같은 신호(`index.html`)가 형태를 가르지 못하고 소비 방식이 갈랐다.** Phase 3은 `lib-*` 셋이
  맞고, 현재 파이프라인은 여기에 `developer`·`developer`를 돌린다(실측된 오류).

빌더 이름이 표에 등장하는 것은 하네스가 그 에이전트를 소유하기 때문이며, 프로젝트의 디렉토리
구조나 라이브러리 선택을 강제하지 않는다 — 그것은 스팩의 `layerMap`·`libraries`가 프로젝트마다
정한다.
