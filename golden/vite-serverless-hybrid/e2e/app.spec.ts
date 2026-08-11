import AxeBuilder from '@axe-core/playwright'
import {expect, test} from '@playwright/test'

test('SPA routing and Vite API middleware remain live together', async ({page}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', {name: 'Golden vite-serverless-hybrid'})).toBeVisible()
  await page.getByRole('button', {name: 'Check API'}).click()
  await expect(page.getByRole('status')).toHaveText('API: ok')
  await page.getByRole('link', {name: 'About'}).click()
  await expect(page.getByRole('heading', {name: 'About'})).toBeVisible()
})

test('home has no detectable axe violations', async ({page}) => {
  await page.goto('/')
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([])
})
