# Project Init Template Catalog

`/project-init`에서 파일 생성 시 사용하는 템플릿 모음.
`{{APP_NAME}}`, `{{APP_TITLE}}`, `{{ENVS}}` 등은 intake 값으로 치환한다.

---

## ROOT_PACKAGE_JSON (모노레포)

```json
{
  "name": "{{APP_NAME}}",
  "version": "1.0.0",
  "private": true,
  "packageManager": "pnpm@11.18.0",
  "engines": {
    "node": ">=22.22.0"
  },
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "build:dev": "turbo build:dev",
    "build:staging": "turbo build:staging",
    "build:production": "turbo build:production",
    "lint": "turbo lint",
    "typecheck": "turbo typecheck",
    "test": "turbo test",
    "test:e2e": "turbo test:e2e",
    "web": "pnpm --filter {{APP_NAME}}-web"
  },
  "devDependencies": {
    "@eslint/js": "9.39.5",
    "eslint": "9.39.5",
    "eslint-plugin-jsx-a11y": "6.10.2",
    "eslint-plugin-react-hooks": "7.0.1",
    "eslint-plugin-unicorn": "65.0.1",
    "globals": "16.5.0",
    "husky": "9.1.7",
    "lint-staged": "16.2.7",
    "prettier": "3.8.1",
    "turbo": "2.8.0",
    "typescript": "6.0.2",
    "typescript-eslint": "8.65.0"
  },
  "lint-staged": {
    "**/*.{js,jsx,ts,tsx}": [
      "eslint --fix"
    ]
  }
}
```

> 위 버전은 2026-07 검증 기준선이다. 생성 시점에는 `tech-advisor`가 Node·React·Router·Vite·TypeScript·ESLint의 peer/engine 호환성을 공식 릴리스 문서로 다시 확인하고 lockfile에 고정한다. TypeScript 7은 생태계 호환 검증을 통과한 경우에만 선택한다.

---

## PNPM_WORKSPACE

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

---

## TURBO_JSON

```json
{
  "$schema": "https://turbo.build/schema.json",
  "ui": "tui",
  "tasks": {
    "dev": {
      "cache": false,
      "persistent": true
    },
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "build:dev": {
      "dependsOn": ["^build:dev"],
      "outputs": ["dist/**"]
    },
    "build:staging": {
      "dependsOn": ["^build:staging"],
      "outputs": ["dist/**"]
    },
    "build:production": {
      "dependsOn": ["^build:production"],
      "outputs": ["dist/**"]
    },
    "lint": {
      "dependsOn": ["^lint"]
    },
    "typecheck": {
      "dependsOn": ["^typecheck"]
    },
    "test": {
      "dependsOn": ["^test"],
      "outputs": ["coverage/**"]
    },
    "test:e2e": {
      "cache": false
    }
  }
}
```

---

## GITIGNORE

```
# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

node_modules
dist
dist-ssr
*.local
playwright-report
test-results

# Editor directories and files
.vscode/*
!.vscode/extensions.json
.idea
.DS_Store
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?

# turbo cache
.turbo

# ts build cache
cache
*.tsbuildinfo

# local env overrides
.env.local
.env.*.local

# 하네스 산출물 — 실행마다 달라지는 증거·receipt만 무시한다.
# `_workspace/03_dev/spec.json`과 `spec-ledger.jsonl`, 기획·디자인 산출물은 **무시하지 않는다**:
# 스팩은 협업 계약이고, 공유되지 않으면 개발자마다 다른 스팩으로 개발하게 된다.
_workspace/04_qa/evidence/
_workspace/04_qa/receipts/
```

> `_workspace`를 통째로 무시하지 않는다. `validate-spec-conformance`의 `specShared`가
> 확정 스팩이 무시 대상인지 기계로 대조한다 — 확정된 결정이 공유되는 것이 "각자 로컬에서
> 작업해도 같은 스타일"의 기반이다.

---

## PRETTIERRC

```json
{
  "printWidth": 120,
  "tabWidth": 2,
  "useTabs": false,
  "arrowParens": "avoid",
  "bracketSameLine": true,
  "bracketSpacing": false,
  "singleQuote": true,
  "semi": false
}
```

---

## ESLINT_CONFIG

```js
import js from '@eslint/js'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import unicorn from 'eslint-plugin-unicorn'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {ignores: ['**/dist/**', '**/coverage/**', '**/playwright-report/**', '**/test-results/**']},
  {...js.configs.recommended, files: ['**/*.{js,mjs,cjs,ts,tsx}']},
  ...tseslint.configs.recommendedTypeChecked.map(config => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
  })),
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {globals: globals.node},
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: {...globals.browser, ...globals.node},
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // 코드 규약은 **여기서** 강제한다. 산문 규약은 모델이 기억해야 성립하므로 세션마다·
    // 개발자마다 갈린다 — 규칙으로 옮기면 컨텍스트를 안 쓰면서 결정적으로 수렴한다.
    // `.tsx`뿐 아니라 `.ts`에도 건다: 훅·스토어·유틸·api 클라이언트가 전부 `.ts`이고
    // 타입 전용 import가 가장 많이 쓰이는 곳이 거기다.
    files: ['**/*.{ts,tsx}'],
    rules: {
      // `import type {X}` 분리 구문(tsconfig `verbatimModuleSyntax`와 짝).
      // recommendedTypeChecked에 없는 opt-in 규칙이라 명시해야 한다.
      '@typescript-eslint/consistent-type-imports': ['error', {fixStyle: 'separate-type-imports'}],
      // 명명 규약 — 제네릭 T 접두, 불리언 is/has/should/can 접두, 미사용은 `_` 접두.
      // 실측(2026-08-28): 규약을 지킨 코드에 오탐 0, 위반은 전부 검출. `types: ['boolean']`이
      // 타입 정보를 쓰므로 `disabled` 같은 라이브러리 prop 파라미터는 잡히지 않는다.
      '@typescript-eslint/naming-convention': [
        'error',
        {selector: 'typeParameter', format: ['PascalCase'], prefix: ['T']},
        {selector: 'variable', types: ['boolean'], format: ['PascalCase'], prefix: ['is', 'has', 'should', 'can']},
      ],
      // `_` 접두 = 의도적 미사용. 기본 옵션은 이 관례를 모르므로 명시해야 규약이 성립한다.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_'},
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSEnumDeclaration',
          message: 'enum·const enum 금지 — isolatedModules에서 삭제 불가 구문이다. `as const` 객체 + 파생 union을 쓴다.',
        },
        {
          selector: 'ExportAllDeclaration',
          message: 'barrel에서 `export *` 금지 — named export만 선택적으로 재노출한다(트리쉐이킹·API 변경 안전성).',
        },
        {
          selector: 'TSTypeReference > TSQualifiedName[left.name="React"][right.name="FC"]',
          message: 'React.FC 금지(React 19 비권장) — 함수 선언 + props 타입으로 쓴다.',
        },
        {
          selector: 'TSTypeReference > Identifier[name="FC"]',
          message: 'FC 금지(React 19 비권장) — 함수 선언 + props 타입으로 쓴다.',
        },
      ],
    },
  },
  // 파일명 케이스 — **kebab-case만 규칙이다**. eslint 9와 맞는 마지막 unicorn(65.0.1)은
  // 조상 디렉토리까지 같은 케이스로 검사하고 끄는 옵션이 없다. 디렉토리가 kebab이므로
  // kebab 규칙만 충돌 없이 성립하고, camelCase·PascalCase 규칙은 `src/`나 `date-picker`
  // 같은 디렉토리를 FAIL시킨다(2026-08-28 실측). 그래서 훅(`useXxx.ts`)과 컴포넌트
  // (`PascalCase.tsx`)는 **제외만 하고 강제하지 않는다** — 잘못된 규칙보다 없는 편이 낫다.
  // 옵션이 생긴 unicorn 66+는 eslint >=10.4를 요구하고 `eslint-plugin-jsx-a11y`는 eslint 9
  // 까지다 — 접근성 lint를 버리면서까지 올리지 않는다. jsx-a11y가 10을 지원하면 옮긴다.
  //
  // 제외 glob이 `use[A-Z]*`인 이유: `use*`는 `user-api.ts`·`use-cases.ts` 같은 **규약을 지킨**
  // kebab 파일까지 삼킨다(`*`가 `-`를 통과한다). `user` 엔티티는 거의 보편이라 첫 프로젝트에서
  // 바로 오탐이 났을 것이다 — 적대 리뷰가 잡았고 실행으로 재현했다.
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/use[A-Z]*.ts'],
    plugins: {unicorn},
    rules: {'unicorn/filename-case': ['error', {case: 'kebabCase'}]},
  },
  {
    // `src` 밖 `.tsx`도 접근성·훅 규칙을 받는다 — 안전 하한은 경로로 갈리지 않는다.
    files: ['**/*.tsx'],
    plugins: {
      'jsx-a11y': jsxA11y,
      'react-hooks': reactHooks,
    },
    rules: {
      ...jsxA11y.configs.recommended.rules,
      ...reactHooks.configs.flat.recommended.rules,
    },
  },
)
```

---

## APP_PACKAGE_JSON

```json
{
  "name": "{{APP_NAME}}-web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.18.0",
  "engines": {"node": ">=22.22.0"},
  "msw": {"workerDirectory": "./public"},
  "scripts": {
    "dev": "vite --host=127.0.0.1 --port=8080 --mode dev",
    "build": "tsc -b && vite build",
    "build:dev": "tsc -b && vite build --mode dev",
    "build:staging": "tsc -b && vite build --mode staging",
    "build:production": "tsc -b && vite build --mode production",
    "preview": "vite preview --host=127.0.0.1 --port=4173",
    "lint": "eslint .",
    "typecheck": "tsc -b --pretty false",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@emotion/react": "11.14.0",
    "@emotion/styled": "11.14.1",
    "@hookform/resolvers": "5.2.2",
    "@mui/material": "7.3.0",
    "@tanstack/react-query": "5.102.7",
    "axios": "1.13.0",
    "date-fns": "4.1.0",
    "react": "19.2.7",
    "react-dom": "19.2.7",
    "react-error-boundary": "6.0.0",
    "react-hook-form": "7.71.0",
    "react-router": "8.2.0",
    "web-vitals": "5.1.0",
    "zod": "4.3.0",
    "zustand": "5.0.11"
  },
  "devDependencies": {
    "@eslint/js": "9.39.5",
    "@axe-core/playwright": "4.11.0",
    "@playwright/test": "1.61.0",
    "@testing-library/jest-dom": "6.6.3",
    "@testing-library/react": "16.3.0",
    "@testing-library/user-event": "14.6.1",
    "@types/react": "19.2.0",
    "@types/react-dom": "19.2.0",
    "@vitejs/plugin-react": "6.0.3",
    "@vitest/coverage-v8": "4.1.0",
    "eslint": "9.39.5",
    "eslint-plugin-jsx-a11y": "6.10.2",
    "eslint-plugin-react-hooks": "7.0.1",
    "eslint-plugin-unicorn": "65.0.1",
    "globals": "16.5.0",
    "husky": "9.1.7",
    "jsdom": "29.0.0",
    "msw": "2.12.0",
    "prettier": "3.8.1",
    "typescript": "6.0.2",
    "vite": "8.1.4",
    "vite-plugin-svgr": "4.5.0",
    "vitest": "4.1.0",
    "typescript-eslint": "8.65.0"
  }
}
```

> 조직 사설 레지스트리의 내부 패키지(예: `@your-scope/ui`, `@your-scope/data`)가 필요하면 dependencies에 추가한다.
> 환경 이름이 dev/sandbox/cbt/production 4개면 scripts에 `build:sandbox`, `build:cbt`도 추가한다.

---

## TSCONFIG

```json
{
  "files": [],
  "references": [
    {"path": "./tsconfig.web.json"}
  ]
}
```

---

## TSCONFIG_WEB

```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "paths": {
      "@app/*": ["./src/app/*"],
      "@pages/*": ["./src/pages/*"],
      "@widgets/*": ["./src/widgets/*"],
      "@features/*": ["./src/features/*"],
      "@entities/*": ["./src/entities/*"],
      "@shared/*": ["./src/shared/*"],
      "@test/*": ["./src/test/*"]
    },
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "incremental": true,
    "tsBuildInfoFile": "./cache/.tsbuildinfo",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noUncheckedIndexedAccess": true,
    "allowJs": false,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src", "e2e", "vite.config.ts", "vitest.config.ts", "playwright.config.ts"]
}
```

---

## VITE_CONFIG

```ts
import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import svgr from 'vite-plugin-svgr'

export default defineConfig({
  plugins: [react(), svgr()],
  resolve: {tsconfigPaths: true},
  server: {
    port: 8080,
    host: '127.0.0.1',
  },
  build: {assetsInlineLimit: 4096},
})
```

---

## INDEX_HTML

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="{{APP_TITLE}}" />
    <title>{{APP_TITLE}}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

---

## VITEST_CONFIG

```ts
import {defineConfig} from 'vitest/config'

export default defineConfig({
  resolve: {tsconfigPaths: true},
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/entities/**', 'src/features/**', 'src/shared/**'],
    },
  },
})
```

---

## PLAYWRIGHT_CONFIG

```ts
import {defineConfig, devices} from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html', {open: 'never'}], ['github']] : 'list',
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      threshold: 0.2,
    },
  },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    deviceScaleFactor: 1,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {name: 'chromium', use: {...devices['Desktop Chrome']}},
    {name: 'mobile-chrome', use: {...devices['Pixel 7']}},
    {name: 'reflow-320', use: {browserName: 'chromium', viewport: {width: 320, height: 800}}},
  ],
  webServer: {
    command: 'pnpm build:dev && pnpm preview --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
```

---

## E2E_SMOKE

```ts
import AxeBuilder from '@axe-core/playwright'
import {expect, test} from '@playwright/test'

test('핵심 화면이 오류 없이 접근 가능하다', async ({page}) => {
  const consoleErrors: string[] = []
  const failedRequests: string[] = []

  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('requestfailed', request => failedRequests.push(request.url()))

  await page.goto('/home')
  await expect(page.getByRole('heading', {level: 1})).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(page.locator(':focus-visible')).toBeVisible()

  const accessibility = await new AxeBuilder({page}).analyze()
  expect(accessibility.violations).toEqual([])
  expect(consoleErrors).toEqual([])
  expect(failedRequests).toEqual([])
})
```

---

## VISUAL_E2E

```ts
import {expect, test} from '@playwright/test'

test.use({
  colorScheme: 'light',
  reducedMotion: 'reduce',
  viewport: {width: 1280, height: 900},
})

test('home-default visual target', async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-01-01T00:00:00Z'))
  await page.goto('/home')
  await page.evaluate(() => document.fonts.ready)
  await expect(page).toHaveScreenshot('home-default.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixels: 0,
    maxDiffPixelRatio: 0,
    threshold: 0.2,
  })
})
```

이 section은 승인된 `visual-qa-contract.json`이 있을 때만 사용한다. snapshot PNG는 verifier나 scaffold가 생성하지 않으며 `visual-baseline-manifest.json` 승인 후 별도 baseline change로 반영한다.

---

## TEST_SETUP

```ts
import '@testing-library/jest-dom/vitest'
import {afterAll, afterEach, beforeAll} from 'vitest'

import {server} from '../mocks/server'

beforeAll(() => server.listen({onUnhandledRequest: 'error'}))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

> Mock API를 생성하지 않는 프로젝트라면 `server` import와 MSW lifecycle hook을 제거한다.

---

## TEST_UTILS

```tsx
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import type {ReactNode} from 'react'

export const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {retry: false},
      mutations: {retry: false},
    },
  })

export const createWrapper = () => {
  const queryClient = createTestQueryClient()
  return ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}
```

---

## MAIN_TSX

```tsx
import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import App from './app/App'

async function enableMocking() {
  if (import.meta.env.VITE_PHASE !== 'dev') return
  const {worker} = await import('./mocks/browser')
  return worker.start({onUnhandledRequest: 'bypass'})
}

const renderApp = () => {
  const rootElement = document.getElementById('root')
  if (!rootElement) throw new Error('Root element is missing')

  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void enableMocking()
  .catch(error => console.error('[MSW] Service Worker registration failed', error))
  .finally(renderApp)
```

---

## VITE_ENV_D_TS

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PHASE: 'dev' | 'staging' | 'production'
  readonly VITE_API_URL: string
  readonly VITE_APP_TITLE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

> `sandbox`, `cbt` 같은 환경을 추가하면 `VITE_PHASE` union 타입과 package.json build script를 함께 확장한다.

---

## APP_TSX

```tsx
import {CssBaseline, ThemeProvider} from '@mui/material'
import {QueryClientProvider, QueryErrorResetBoundary} from '@tanstack/react-query'
import {ErrorBoundary} from 'react-error-boundary'
import {queryClient} from '@shared/api'
import {ErrorFallback} from '@shared/ui/ErrorFallback'
import RouterProvider from './providers/RouterProvider'
import {lightTheme} from './theme'
import './style.css'

function App() {
  return (
    <ThemeProvider theme={lightTheme}>
      <CssBaseline enableColorScheme />
      <QueryClientProvider client={queryClient}>
        <QueryErrorResetBoundary>
          {({reset}) => (
            <ErrorBoundary FallbackComponent={ErrorFallback} onReset={reset}>
              <RouterProvider />
            </ErrorBoundary>
          )}
        </QueryErrorResetBoundary>
      </QueryClientProvider>
    </ThemeProvider>
  )
}

export default App
```

> 사설 UI 패키지(예: `@your-scope/data-ui`)를 쓰는 경우 `ThemeProvider`, `CssBaseline`, `LocalizationProvider`를 추가한다.
> 다크 모드가 요구되면 `developer`가 settings slice를 먼저 만든 뒤 `useMediaQuery`와 명시적 theme store를 연결한다. 존재하지 않는 settings feature를 기본 템플릿에서 import하지 않는다.

---

## ERROR_FALLBACK

```tsx
import {Alert, Button, Stack} from '@mui/material'
import type {FallbackProps} from 'react-error-boundary'

export const ErrorFallback = ({resetErrorBoundary}: FallbackProps) => (
  <Stack role="alert" spacing={2} sx={{p: 3}}>
    <Alert severity="error">일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.</Alert>
    <Button onClick={resetErrorBoundary} sx={{alignSelf: 'flex-start'}} variant="contained">
      다시 시도
    </Button>
  </Stack>
)
```

개발자용 오류 상세는 화면에 노출하지 않고 observability adapter로 전송한다. 사용자 메시지에 stack, raw API body, token, request header를 포함하지 않는다.

---

## APP_THEME

```ts
import {createTheme, type ThemeOptions} from '@mui/material'

const typography: ThemeOptions['typography'] = {
  fontFamily: ['Inter', 'Pretendard', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'].join(','),
}

export const lightTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {main: '#1976d2'},
    secondary: {main: '#7c4dff'},
    background: {default: '#f7f8fa'},
  },
  typography,
})

export const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {main: '#90caf9'},
    secondary: {main: '#ce93d8'},
    background: {default: '#121212', paper: '#1e1e1e'},
  },
  typography,
})
```

> `design-system.md`에 다크 팔레트가 명시된 경우 위 값을 해당 토큰으로 교체한다.
> 다크 팔레트가 없으면 `lightTheme`만 export하고 APP_TSX를 단순화한다.

---

## APP_STYLE_CSS

```css
html,
body {
  min-height: 100%;
  margin: 0;
  padding: 0;
}

body > #root {
  min-height: 100dvh;
}

.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

---

## ROUTER_PROVIDER

```tsx
import {createBrowserRouter} from 'react-router'
import {RouterProvider} from 'react-router/dom'
import {ROUTES} from '@app/routes'

const router = createBrowserRouter(ROUTES)

const AppRouterProvider = () => <RouterProvider router={router} />

export default AppRouterProvider
```

> Hash 기반 라우팅이 필요하면 `createBrowserRouter` → `createHashRouter`로 변경한다.

---

## ROUTES_INDEX

```ts
export {ROUTES} from './Routes'
```

---

## ROUTES_TSX

```tsx
import {lazy, Suspense} from 'react'
import {Navigate} from 'react-router'

const HomePage = lazy(() => import('@pages/home/ui/HomePage'))
const NotFoundPage = lazy(() => import('@pages/not-found/ui/NotFoundPage'))

export const ROUTES = [
  {
    path: '/',
    element: <Navigate to="/home" replace />,
  },
  {
    path: '/home',
    element: (
      <Suspense fallback={<div role="status">로딩 중...</div>}>
        <HomePage />
      </Suspense>
    ),
  },
  {
    path: '*',
    element: (
      <Suspense fallback={<div role="status">로딩 중...</div>}>
        <NotFoundPage />
      </Suspense>
    ),
  },
]
```

모든 route를 무조건 lazy-load하지 않는다. 초기 route와 작은 화면은 bundle 측정 결과에 따라 정적 import를 사용한다. 공개 콘텐츠/SEO 요구가 있으면 CSR router를 전제로 하지 말고 `tech-stack.md`의 rendering profile을 따른다.

---

## HOME_INDEX

```ts
export {default as HomePage} from './ui/HomePage'
```

---

## HOME_PAGE

```tsx
import {Box, Button, Card, CardContent, Stack, Typography} from '@mui/material'

const HomePage = () => {
  return (
    <Box sx={{minHeight: '100vh', p: 4}}>
      <Stack spacing={3} sx={{maxWidth: 960, mx: 'auto'}}>
        <Box>
          <Typography component="h1" variant="h3" fontWeight={700}>
            {'{{APP_TITLE}}'}
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{mt: 1}}>
            생성된 React + TypeScript + Vite 웹앱입니다.
          </Typography>
        </Box>
        <Card>
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h6">시작 준비 완료</Typography>
              <Typography color="text.secondary">
                이 화면을 기준으로 페이지, 위젯, 기능 슬라이스를 추가하세요.
              </Typography>
              <Button variant="contained" sx={{alignSelf: 'flex-start'}}>
                첫 기능 만들기
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </Box>
  )
}

export default HomePage
```

---

## NOT_FOUND_PAGE

```tsx
import {Button, Stack, Typography} from '@mui/material'
import {Link} from 'react-router'

const NotFoundPage = () => (
  <Stack alignItems="flex-start" spacing={2} sx={{p: 4}}>
    <Typography component="h1" variant="h3">페이지를 찾을 수 없습니다</Typography>
    <Button component={Link} to="/home" variant="contained">홈으로 이동</Button>
  </Stack>
)

export default NotFoundPage
```

---

<!-- ══ UI_LANE: tailwind-shadcn 병렬 섹션 (M4 tier b) ══
     아래 *_TAILWIND 섹션은 같은 이름의 MUI 섹션을 레인별로 대체한다.
     project-init은 tech-stack.md의 UI_LANE에 따라 한 레인의 섹션만 사용한다. -->

## APP_PACKAGE_JSON_TAILWIND

APP_PACKAGE_JSON에서 dependencies의 `@emotion/react`·`@emotion/styled`·`@mui/material` 세 줄을
아래로 교체한 것 외에는 동일하다(scripts·devDependencies 전부 동일 — 중복 기재하지 않는다).

```json
{
  "_comment": "⚠ 이 JSON을 package.json으로 그대로 복사하지 말 것 — APP_PACKAGE_JSON에 적용할 diff 지시다",
  "dependencies-교체분": {
    "@radix-ui/react-slot": "1.2.0",
    "class-variance-authority": "0.7.1",
    "clsx": "2.1.1",
    "tailwind-merge": "3.3.1",
    "tailwindcss": "4.1.0"
  },
  "devDependencies-추가분": {
    "@tailwindcss/vite": "4.1.0"
  }
}
```

> 레인 의존성의 exact version은 생성 시 tech-advisor의 registry 확인(validate-dependency-pins)으로
> 갱신한다 — 위 값은 실재 확인된 출발점이다. Radix 프리미티브(`@radix-ui/react-*`)는 vendoring하는
> 컴포넌트에 따라 개별 추가한다.

---

## VITE_CONFIG_TAILWIND

```ts
import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import svgr from 'vite-plugin-svgr'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), svgr(), tailwindcss()],
  resolve: {tsconfigPaths: true},
  server: {
    port: 8080,
    host: '127.0.0.1',
  },
  build: {assetsInlineLimit: 4096},
})
```

Tailwind v4는 `@tailwindcss/vite` 플러그인만 쓴다 — `postcss.config.*`·`tailwind.config.*`를
만들지 않는다(토큰·설정은 전부 `src/app/style.css`의 `@theme`).

---

## APP_TSX_TAILWIND

```tsx
import {QueryClientProvider, QueryErrorResetBoundary} from '@tanstack/react-query'
import {ErrorBoundary} from 'react-error-boundary'
import {queryClient} from '@shared/api'
import {ErrorFallback} from '@shared/ui/ErrorFallback'
import RouterProvider from './providers/RouterProvider'
import './style.css'

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <QueryErrorResetBoundary>
        {({reset}) => (
          <ErrorBoundary FallbackComponent={ErrorFallback} onReset={reset}>
            <RouterProvider />
          </ErrorBoundary>
        )}
      </QueryErrorResetBoundary>
    </QueryClientProvider>
  )
}

export default App
```

> ThemeProvider가 없다 — 테마는 `style.css`의 `@theme`(CSS 변수)가 전담한다. 다크 모드가
> 요구되면 `data-theme` 속성 토글 + `@theme`의 다크 변수 재정의로 구현한다(settings slice는
> developer가 먼저 만든 뒤 연결 — MUI 레인과 동일 규칙).

---

## APP_STYLE_CSS_TAILWIND

```css
@import "tailwindcss";

@theme {
  --color-primary: #1976d2;
  --color-secondary: #7c4dff;
  --color-surface: #f7f8fa;
  --font-sans: "Inter", "Pretendard", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --radius-md: 0.5rem;
}

html,
body {
  min-height: 100%;
  margin: 0;
  padding: 0;
}

body > #root {
  min-height: 100dvh;
}
```

> `design-system.md`(또는 `theme.code.css`)에 토큰이 명시된 경우 `@theme` 값을 그 토큰으로
> 교체한다. preflight가 리셋을 담당하므로 MUI 레인의 CssBaseline에 대응하는 별도 리셋은 없다.

---

## ERROR_FALLBACK_TAILWIND

```tsx
import type {FallbackProps} from 'react-error-boundary'

export const ErrorFallback = ({resetErrorBoundary}: FallbackProps) => (
  <div role="alert" className="flex flex-col gap-4 p-6">
    <p className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
      일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.
    </p>
    <button
      type="button"
      onClick={resetErrorBoundary}
      className="self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      다시 시도
    </button>
  </div>
)
```

개발자용 오류 상세는 화면에 노출하지 않고 observability adapter로 전송한다(MUI 레인과 동일 규칙).

---

## HOME_PAGE_TAILWIND

```tsx
const HomePage = () => {
  return (
    <main className="min-h-dvh p-8">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <header>
          <h1 className="text-4xl font-bold">{'{{APP_TITLE}}'}</h1>
          <p className="mt-2 text-gray-600">생성된 React + TypeScript + Vite 웹앱입니다.</p>
        </header>
        <section className="rounded-md border border-gray-200 bg-white p-6">
          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">시작 준비 완료</h2>
            <p className="text-gray-600">이 화면을 기준으로 페이지, 위젯, 기능 슬라이스를 추가하세요.</p>
            <button
              type="button"
              className="self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              첫 기능 만들기
            </button>
          </div>
        </section>
      </div>
    </main>
  )
}

export default HomePage
```

---

## NOT_FOUND_PAGE_TAILWIND

```tsx
import {Link} from 'react-router'

const NotFoundPage = () => (
  <div className="flex flex-col items-start gap-4 p-8">
    <h1 className="text-4xl font-bold">페이지를 찾을 수 없습니다</h1>
    <Link
      to="/home"
      className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      홈으로 이동
    </Link>
  </div>
)

export default NotFoundPage
```

---

## UTILS_CN_TAILWIND

```ts
// src/shared/lib/utils.ts — vendored 프리미티브의 클래스 병합 유틸(cva variants와 함께 사용)
import {clsx, type ClassValue} from 'clsx'
import {twMerge} from 'tailwind-merge'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))
```

---

## MOCK_HANDLERS_INDEX

```ts
import type {RequestHandler} from 'msw'

export const handlers: RequestHandler[] = []
```

---

## MOCK_BROWSER

```ts
import {setupWorker} from 'msw/browser'
import {handlers} from './handlers'

export const worker = setupWorker(...handlers)
```

---

## MOCK_SERVER

```ts
import {setupServer} from 'msw/node'
import {handlers} from './handlers'

export const server = setupServer(...handlers)
```

---

## SHARED_API

```ts
import axios from 'axios'
import type {AxiosInstance, CreateAxiosDefaults} from 'axios'
import {config} from '@shared/config'
import {AppError, Method} from './types'
import type {RequestConfig, ResponseFailType, ResponseSuccessType} from './types'

const SAFE_RETRY_METHODS = new Set<Method>([Method.get, Method.head, Method.options])
const EXPLICIT_IDEMPOTENT_METHODS = new Set<Method>([Method.put, Method.delete])
const DEFAULT_MAX_RATE_LIMIT_RETRIES = 3
const DEFAULT_MAX_RATE_LIMIT_DELAY_MS = 30_000
const MAX_CONFIGURED_RATE_LIMIT_RETRIES = 5
const MAX_CONFIGURED_RATE_LIMIT_DELAY_MS = 60_000

const boundedInteger = (value: number | undefined, fallback: number, maximum: number) => {
  if (value === undefined || !Number.isInteger(value) || value < 0) return fallback
  return Math.min(value, maximum)
}

const readHeader = (headers: unknown, name: string): string | undefined => {
  if (!headers || typeof headers !== 'object') return undefined
  const source = headers as {get?: (headerName: string) => unknown; [key: string]: unknown}
  const value = typeof source.get === 'function' ? source.get(name) : source[name] ?? source[name.toLowerCase()]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined
}

export const parseRetryAfterMs = (headers: unknown, now = Date.now()): number | undefined => {
  const raw = readHeader(headers, 'retry-after')
  if (!raw) return undefined
  const seconds = Number(raw)
  const secondsDelayMs = seconds * 1000
  if (Number.isFinite(seconds) && seconds >= 0 && Number.isSafeInteger(secondsDelayMs)) return secondsDelayMs
  const timestamp = Date.parse(raw)
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : undefined
}

const abortReason = (signal: RequestConfig['signal']) => {
  const reason = signal && 'reason' in signal ? (signal as {reason?: unknown}).reason : undefined
  return reason ?? new DOMException('Request aborted', 'AbortError')
}

const waitForRetry = (delayMs: number, signal?: RequestConfig['signal']): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal))
      return
    }

    const onAbort = () => {
      clearTimeout(timeoutId)
      reject(abortReason(signal))
    }
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort)
      resolve()
    }, delayMs)
    signal?.addEventListener?.('abort', onAbort, {once: true})
  })

const canRetryRateLimit = (requestConfig: RequestConfig) => {
  const method = String(requestConfig.method ?? '').toUpperCase() as Method
  if (SAFE_RETRY_METHODS.has(method)) return requestConfig.rateLimitRetry?.enabled !== false
  return EXPLICIT_IDEMPOTENT_METHODS.has(method) && requestConfig.rateLimitRetry?.enabled === true
}

const normalizeApiError = (cause: unknown): AppError => {
  if (!axios.isAxiosError<ResponseFailType>(cause)) {
    return new AppError('알 수 없는 오류가 발생했습니다.', {cause})
  }

  const payload = cause.response?.data
  const requestIdHeader = cause.response?.headers.get?.('x-request-id')
  const networkFailure = !cause.response

  return new AppError(
    networkFailure ? '네트워크 연결을 확인해주세요.' : payload?.message ?? '요청을 처리하지 못했습니다.',
    {
      cause,
      code: payload?.code,
      details: payload?.details,
      requestId: typeof requestIdHeader === 'string' ? requestIdHeader : undefined,
      retryAfterMs: parseRetryAfterMs(cause.response?.headers),
      status: cause.response?.status,
    },
  )
}

export class AppApi {
  private readonly axiosInstance: AxiosInstance

  constructor(createOptions?: CreateAxiosDefaults) {
    this.axiosInstance = axios.create(createOptions)
  }

  async request<T, D = unknown>(requestConfig: RequestConfig<D>): Promise<T> {
    let rateLimitRetryCount = 0

    while (true) {
      try {
        const response = await this.axiosInstance.request<ResponseSuccessType<T>>(requestConfig)
        return response.data.data
      } catch (cause) {
        if (axios.isCancel(cause) || requestConfig.signal?.aborted === true) throw cause
        if (!axios.isAxiosError<ResponseFailType>(cause)) throw normalizeApiError(cause)

        const retryAfterMs = parseRetryAfterMs(cause.response?.headers)
        const maxRetries = boundedInteger(
          requestConfig.rateLimitRetry?.maxRetries,
          DEFAULT_MAX_RATE_LIMIT_RETRIES,
          MAX_CONFIGURED_RATE_LIMIT_RETRIES,
        )
        const maxDelayMs = boundedInteger(
          requestConfig.rateLimitRetry?.maxDelayMs,
          DEFAULT_MAX_RATE_LIMIT_DELAY_MS,
          MAX_CONFIGURED_RATE_LIMIT_DELAY_MS,
        )
        const fallbackDelayMs = Math.min(1000 * 2 ** rateLimitRetryCount, maxDelayMs)
        const delayMs = retryAfterMs ?? fallbackDelayMs
        const shouldRetry =
          cause.response?.status === 429 &&
          canRetryRateLimit(requestConfig) &&
          rateLimitRetryCount < maxRetries &&
          delayMs <= maxDelayMs

        if (!shouldRetry) throw normalizeApiError(cause)
        rateLimitRetryCount += 1
        await waitForRetry(delayMs, requestConfig.signal)
      }
    }
  }

  get<T>(url: string, config?: RequestConfig) {
    return this.request<T>({...config, method: Method.get, url})
  }

  post<T, D = unknown>(url: string, payload: D, config?: RequestConfig<D>) {
    return this.request<T, D>({...config, method: Method.post, url, data: payload})
  }

  put<T, D>(url: string, payload: D, config?: RequestConfig<D>) {
    return this.request<T, D>({...config, method: Method.put, url, data: payload})
  }

  delete<T>(url: string, config?: RequestConfig) {
    return this.request<T>({...config, method: Method.delete, url})
  }
}

export const api = new AppApi({
  baseURL: config.apiUrl,
  paramsSerializer: {indexes: null},
  timeout: 15_000,
})
```

---

## QUERY_CLIENT

```ts
import {QueryClient} from '@tanstack/react-query'
import {AppError} from './types'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: (failureCount, error) => {
        if (error instanceof AppError && error.status && error.status < 500) return false
        return failureCount < 2
      },
      throwOnError: error => error instanceof AppError && (error.status ?? 500) >= 500,
    },
  },
})

export {queryClient}
```

---

## API_TYPES

```ts
import type {AxiosRequestConfig} from 'axios'

export enum Method {
  delete = 'DELETE',
  get = 'GET',
  head = 'HEAD',
  options = 'OPTIONS',
  patch = 'PATCH',
  post = 'POST',
  put = 'PUT',
}

export type ResponseSuccessType<T = null> = {
  statusCode: number
  isSuccess: true
  data: T
}

export type ResponseFailType = {
  statusCode: number
  isSuccess: false
  message: string
  code?: string
  details?: unknown
}

type AppErrorOptions = {
  cause?: unknown
  code?: string | undefined
  details?: unknown
  requestId?: string | undefined
  retryAfterMs?: number | undefined
  status?: number | undefined
}

export class AppError extends Error {
  readonly code: string | undefined
  readonly details: unknown
  readonly requestId: string | undefined
  readonly retryAfterMs: number | undefined
  readonly status: number | undefined

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, {cause: options.cause})
    this.name = 'AppError'
    this.code = options.code
    this.details = options.details
    this.requestId = options.requestId
    this.retryAfterMs = options.retryAfterMs
    this.status = options.status
  }
}

export type RequestConfig<D = unknown> = AxiosRequestConfig<D> & {
  authRequired?: boolean
  rateLimitRetry?: {
    enabled?: boolean
    maxDelayMs?: number
    maxRetries?: number
  }
}
```

---

## API_CONSTANTS

```ts
export const STALE_TIME = 1000 * 60 * 5
```

---

## SHARED_CONFIG

```ts
import {z} from 'zod'

const publicEnvSchema = z.object({
  VITE_API_URL: z.url(),
  VITE_APP_TITLE: z.string().min(1),
  VITE_PHASE: z.enum(['dev', 'staging', 'production']),
})

const publicEnv = publicEnvSchema.parse(import.meta.env)

export const config = {
  apiUrl: publicEnv.VITE_API_URL,
  appTitle: publicEnv.VITE_APP_TITLE,
  phase: publicEnv.VITE_PHASE,
} as const
```

---

## CREATE_STORE

```ts
import {create} from 'zustand'
import type {StateCreator} from 'zustand'
import {devtools, subscribeWithSelector} from 'zustand/middleware'

export const createStore = <T extends object>(initializer: StateCreator<T>, name?: string) =>
  create<T>()(devtools(subscribeWithSelector(initializer), name ? {name} : undefined))
```

---

## ENV_FILE

```
VITE_PHASE={{ENV_NAME}}
VITE_API_URL=https://api.{{ENV_NAME}}.example.com
VITE_APP_TITLE={{APP_TITLE}}
```

환경마다 파일명과 `VITE_PHASE` 값을 달리한다:
- `.env.dev` → `VITE_PHASE=dev`
- `.env.staging` → `VITE_PHASE=staging`
- `.env.production` → `VITE_PHASE=production`
- `.env.sandbox` → `VITE_PHASE=sandbox` (필요한 경우)

추가 환경을 만들면 `src/vite-env.d.ts`의 `VITE_PHASE` union 타입도 함께 확장한다.

---

## HUSKY_PRE_COMMIT

```sh
pnpm lint-staged
```

---

## PR_TEMPLATE

```markdown
<!-- 사용하고 있는 채널만 사용하면 됩니다 -->
* JIRA: [티켓_번호]()
* Issue: #깃헙_이슈_번호

<!-- 작업 내용에 대한 요약과, 왜 그렇게 해결했는지 작성해주세요 -->
## 작업 내용
1. 작업 내용 요약 작성
    > 왜 이렇게 해결했는지, 이 방법이 최선인 이유

<!-- 체크리스트 확인 후 [] 안에 'x' 문자를 기입해주세요 -->
## 체크리스트

- [ ] 테스트 통과 (`pnpm test`)
- [ ] 정상 동작 확인
- [ ] 코드 수정에 따른 주석, 문서 수정

## 기타


<details><summary>리뷰어 도움말</summary>
<p>

> 리뷰 코멘트 시 다음 말머리를 사용해 주세요.

#### 머지 OK
  - [의견] - 더 나은 코드가 있는 경우 제안
  - [질문] - 설명이 부족하거나 이유를 알 수 없는 부분에 설명 요청

#### 머지 전 확인/반영 부탁
  - [확인] - 동작에는 지장 없지만 수정이 필요한 부분
  - [이슈] - 문제가 발생할 것으로 예상됨
</p>
</details>
```

---

## CODEOWNERS

```
# 모든 파일의 기본 소유자 — 팀 GitHub 계정으로 교체하세요
* @your-github-username
```

---

## GITHUB_ACTIONS

```yaml
name: Validate Web App

on:
  pull_request:
    types: [opened, synchronize, reopened]
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: web-validate-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  validate:
    runs-on: ubuntu-latest  # self-hosted runner 사용 시 해당 label로 변경
    timeout-minutes: 20

    steps:
      - name: Checkout
        uses: actions/checkout@{{ACTIONS_CHECKOUT_FULL_SHA}}

      - name: Setup Node.js
        uses: actions/setup-node@{{ACTIONS_SETUP_NODE_FULL_SHA}}
        with:
          node-version: '22.22.0'

      - name: Enable pnpm
        run: corepack enable && corepack prepare pnpm@11.18.0 --activate

      - name: Install dependencies
        run: pnpm install --frozen-lockfile --ignore-scripts

      - name: Install browser
        run: pnpm exec playwright install --with-deps chromium

      - name: Validate
        run: pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build:production

      - name: Create immutable artifact manifest
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        working-directory: {{APP_DIR}}
        run: find dist -type f -print0 | sort -z | xargs -0 sha256sum > artifact.sha256

      - name: Upload validated production artifact
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        uses: actions/upload-artifact@{{ACTIONS_UPLOAD_ARTIFACT_FULL_SHA}} # vX.Y.Z
        with:
          name: production-dist
          path: |
            {{APP_DIR}}/dist
            {{APP_DIR}}/artifact.sha256
          if-no-files-found: error
          retention-days: 30
```

`{{APP_DIR}}`는 단일 앱이면 `.`, 모노레포면 `apps/{appName}`으로 치환한다. `{{ACTIONS_*_FULL_SHA}}`는 workflow 생성 시 각 action의 검증된 release commit SHA로 치환한다. mutable major tag를 그대로 남기지 않는다. 실제 배포 workflow는 `environment-scaffolder`가 별도로 생성하며 environment approval, OIDC, 최소 권한을 적용한다.

---

## RENOVATE_CONFIG

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:best-practices"],
  "schedule": ["before 9am on Monday"],
  "packageRules": [
    {
      "matchManagers": ["github-actions"],
      "automerge": false
    }
  ]
}
```

---

## DEPENDABOT_CONFIG

```yaml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    commit-message:
      prefix: "ci(deps)"
```
