import {defineConfig} from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // 품질 러너는 HOME을 격리하므로 사용자 Playwright cache에 의존하지 않는다.
  // 로컬/CI 이미지에 사전 설치된 stable Chrome을 명시적으로 사용한다.
  use: {baseURL: 'http://127.0.0.1:4173', channel: 'chrome'},
  webServer: {
    // quality runner가 검증한 설치 그래프 안의 Vite entrypoint를 직접 실행한다.
    // nested `pnpm run`은 격리 HOME/store 차이로 node_modules 재설치를 유발할 수 있어 금지한다.
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
})
