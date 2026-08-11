import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('홈 화면 렌더 + 라우팅', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Golden react-vite-spa' })).toBeVisible();
  await page.getByRole('link', { name: 'About' }).click();
  await expect(page.getByText('About 화면입니다.')).toBeVisible();
});

test('접근성 위반 없음 (axe)', async ({ page }) => {
  await page.goto('/');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
