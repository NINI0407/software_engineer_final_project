import { expect, test } from '@playwright/test'
import { reset } from './helpers'

test.beforeEach(reset)

test('冒煙測試：首頁可以開啟，並提供老師與學生入口', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '課堂搶答系統' })).toBeVisible()
  await expect(page.getByTestId('go-teacher')).toBeVisible()
  await expect(page.getByTestId('go-student')).toBeVisible()
})
