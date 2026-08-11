import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Golden react-vite-spa — CSR SPA. vitest 설정을 vite.config에 함께 둔다(vitest/config defineConfig).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    // e2e(Playwright)는 별도 러너 — vitest 대상에서 제외
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
