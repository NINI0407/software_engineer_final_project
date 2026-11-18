import { expect, test } from '@playwright/test'
import { joinStudent, questionApi, reset, SHEETS, submitViaApi, teacherContext } from './helpers'

// 前端不接觸 Google 憑證（teacher-console spec「前端不接觸 Google 憑證」、design G1）：
// 試算表的讀寫只透過自家後端，瀏覽器不得直接連到 Google 的 API 或授權網域。

test.beforeEach(reset)

const GOOGLE_API = /(^|\.)googleapis\.com$|^accounts\.google\.com$|^oauth2\.googleapis\.com$/
const TOKEN = /ya29\.|AIza[0-9A-Za-z_-]{35}|private_key|client_secret|access_token|id_token/

test('完整流程中沒有任何請求送往 Google，瀏覽器儲存空間也沒有 Google 權杖', async ({ browser }) => {
  const ctx = await teacherContext(browser)
  const hosts = new Set<string>()
  ctx.on('request', (r) => hosts.add(new URL(r.url()).hostname))
  const page = await ctx.newPage()

  // 匯入、建立活動
  await page.goto('/teacher/new')
  await page.getByTestId('sheet-url-input').fill(SHEETS.single)
  await page.getByTestId('import-btn').click()
  await expect(page.getByTestId('preview-count')).toHaveText('共 6 題')
  await page.getByTestId('group-count').fill('3')
  await page.getByTestId('create-btn').click()
  await expect(page).toHaveURL(/\/teacher\/board\/[A-Z2-9]{6}$/)
  await expect(page.getByTestId('conn-status')).toHaveText('已連線')
  const code = page.url().split('/').pop()!

  // 結束一題並寫回
  const s = await joinStudent(browser, code, '小明', 'g1', { open: false })
  await questionApi(ctx, code).open('q1')
  expect((await submitViaApi(s, code, 'q1', 1, ['答案'])).status()).toBe(201)
  await questionApi(ctx, code).close('q1')
  await page.getByTestId('export-sheet-btn').click()
  await page.getByTestId('export-confirm-ok').click()
  await expect(page.getByTestId('export-result')).toContainText('已寫入 1 格')

  expect([...hosts].filter((h) => GOOGLE_API.test(h))).toEqual([])
  expect([...hosts].every((h) => h === 'localhost' || h === '127.0.0.1')).toBe(true)

  const stored = await page.evaluate(() =>
    JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie }),
  )
  expect(stored).not.toMatch(TOKEN)
})
