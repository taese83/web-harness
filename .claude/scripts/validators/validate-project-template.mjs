// validate-project-template.mjs — 생성 템플릿(project-init/assets/templates.md)이 지켜야 하는 의존성·안전·진실성 가드.
// 빠지면 생성 프로젝트가 조용히 약해진다. 존재 검사다 — 의미는 각 가드의 반증 seed와 실측 receipt가 묶는다.
const REQUIRED_PACKAGES = [
  '@axe-core/playwright', '@hookform/resolvers', '@playwright/test', '@tanstack/eslint-plugin-query',
  'eslint-plugin-jsx-a11y', 'eslint-plugin-no-unsanitized', 'eslint-plugin-playwright', 'eslint-plugin-testing-library',
  'web-vitals', 'zod',
]

const TEMPLATE_GUARDS = [
  // knip은 config 키(`"knip": {`)와 이름이 같다 — 버전 pin으로 본다.
  [/"knip": "\d/, 'is missing knip devDependency pin'],
  // 재시도로 통과한 flaky 테스트가 browser receipt에서 green이 되지 않게 한다.
  ['failOnFlakyTests: Boolean(process.env.CI)', 'Playwright config lets retried flaky tests pass green in CI'],
  // axe 기본 실행은 WCAG 2.2 target-size(2.5.8)를 끈다.
  ["'target-size': {enabled: true}", 'axe scan leaves WCAG 2.2 target-size (2.5.8) disabled'],
  // XSS 싱크는 lint가 막는다 — 셀렉터가 빠지면 SafeHtml·JsonLd 출구 설계가 공허해진다.
  ["JSXAttribute[name.name='dangerouslySetInnerHTML']", 'ESLint lacks the dangerouslySetInnerHTML restriction'],
  // 라우터 안 오류는 App 경계에 오지 않는다 — 경계가 없으면 기본 화면이 stack을 노출한다.
  ['ErrorBoundary: RouteErrorBoundary', 'routes lack a route ErrorBoundary'],
  // 새 배포가 이전 청크를 지우면 lazy import가 실패해 빈 화면이 된다.
  ["window.addEventListener('vite:preloadError'", 'main entry does not recover from stale chunks after a deploy'],
  // smoke 첨부물이 적용된 정책을 담지 않으면 빈 위반 목록이 "측정 안 됨"과 구별되지 않는다.
  ["headers()['content-security-policy-report-only']", 'E2E smoke does not record the applied CSP header'],
]

const REQUIRED_SECTIONS = [
  '## ESLINT_CONFIG', '## PLAYWRIGHT_CONFIG', '## ERROR_FALLBACK', '## NOT_FOUND_PAGE', '## RENOVATE_CONFIG',
  '## ROUTE_ERROR_BOUNDARY', '## SAFE_HTML', '## SAFE_URL', '## JSON_LD',
]

export const validateProjectTemplate = ({templateSource, pass, fail}) => {
  for (const packageName of REQUIRED_PACKAGES) {
    if (!templateSource.includes(`"${packageName}"`)) fail(`project template is missing ${packageName}`)
  }
  for (const [pattern, message] of TEMPLATE_GUARDS) {
    const present = typeof pattern === 'string' ? templateSource.includes(pattern) : pattern.test(templateSource)
    if (!present) fail(`project template ${message}`)
  }
  // CSP는 Report-Only로 두 UI 레인의 preview에 걸어 e2e가 위반을 측정한다 — 헤더 없는 preview는 측정하지 않은 green이다.
  if ((templateSource.match(/'Content-Security-Policy-Report-Only': contentSecurityPolicy\(/g) ?? []).length < 2) {
    fail('project template preview lacks the Report-Only CSP header in both UI lanes')
  }
  for (const section of REQUIRED_SECTIONS) {
    if (!templateSource.includes(section)) fail(`project template is missing ${section}`)
  }
  pass('project template dependencies and sections checked')
}
