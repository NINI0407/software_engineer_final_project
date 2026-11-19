import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'

// 正式後端的完整流程（change build-quiz-backend，task 7.1；spec quiz-backend「依介面約定回應」的「前端改接正式後端」）。
// 後端由 server/testing/e2e-entry.js 啟動，試算表換成 fake-sheets（`e2e-single` 為單題範本）。
// 不使用任何 /__mock 鉤子：每個測試都建立自己的活動，彼此不互相影響。

const PASSWORD = () => process.env.E2E_TEACHER_PASSWORD as string
const SINGLE = 'https://docs.google.com/spreadsheets/d/e2e-single/edit#gid=0'

const contexts: BrowserContext[] = []
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.close().catch(() => {})))
})

async function newPage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext()
  contexts.push(ctx)
  return ctx.newPage()
}

async function joinViaUi(browser: Browser, code: string, nickname: string, groupId: string) {
  const page = await newPage(browser)
  await page.goto('/')
  await page.getByTestId('go-student').click()
  await page.getByTestId('join-code').fill(code)
  await page.getByTestId('join-nickname').fill(nickname)
  await page.getByTestId('join-btn').click()
  await expect(page.getByTestId('choose-group')).toBeVisible()
  await page.getByTestId('group-select').selectOption(groupId)
  await page.getByTestId('join-group-btn').click()
  await expect(page.getByTestId('waiting')).toBeVisible()
  await expect(page.getByTestId('conn-status')).toHaveText('已連線')
  return page
}

test('前端改接正式後端：登入、匯入、建立活動、兩組搶答、結束、寫回、下載 CSV', async ({ browser }) => {
  // 老師登入、匯入、建立活動
  const board = await newPage(browser)
  await board.goto('/teacher/login')
  await board.getByTestId('password').fill(PASSWORD())
  await board.getByTestId('login-btn').click()
  await expect(board).toHaveURL(/\/teacher\/new$/)
  await board.getByTestId('sheet-url-input').fill(SINGLE)
  await board.getByTestId('import-btn').click()
  await expect(board.getByTestId('preview-count')).toHaveText('共 6 題')
  await expect(board.getByTestId('preview-row-1')).toContainText('學習單!G5')
  await board.getByTestId('group-count').fill('2')
  await board.getByTestId('create-btn').click()
  await expect(board).toHaveURL(/\/teacher\/board\/[A-Z2-9]{6}$/)
  await expect(board.getByTestId('conn-status')).toHaveText('已連線')
  const code = board.url().split('/').pop()!
  await expect(board.getByTestId('activity-code')).toContainText(code)

  // 兩組各一位學生（各自獨立的 browser context），加入後成為組長
  const g1 = await joinViaUi(browser, code, '小明', 'g1')
  const g2 = await joinViaUi(browser, code, '小華', 'g2')
  await expect(g1.getByTestId('me-leader')).toBeVisible()
  await expect(g2.getByTestId('me-leader')).toBeVisible()

  // 開始第 1 題
  await board.getByTestId('q-row-1').getByTestId('start-btn').click()
  await expect(board.getByTestId('q-row-1').getByTestId('q-status')).toHaveText('進行中')
  await expect(g1.getByTestId('question-title')).toHaveText('第 1 題')
  await expect(g2.getByTestId('question-title')).toHaveText('第 1 題')

  // 第 2 組先送出，第 1 組後送出
  await g2.getByTestId('answer-0').fill('中央處理器')
  await g2.getByTestId('submit-btn').click()
  await expect(g2.getByTestId('submitted-msg')).toBeVisible()
  await expect(board.getByTestId('group-g2').getByTestId('group-rank')).toContainText('1')
  await g1.getByTestId('answer-0').fill('CPU')
  await g1.getByTestId('submit-btn').click()
  await expect(g1.getByTestId('submitted-msg')).toBeVisible()
  // 學生在結束前看不到順位與他組答案
  await expect(g1.getByText('中央處理器')).toHaveCount(0)

  // 結束：所有人看到順位
  await board.getByTestId('q-row-1').getByTestId('close-btn').click()
  for (const p of [g1, g2]) {
    await expect(p.getByTestId('result-title')).toHaveText('第 1 題結果')
    await expect(p.getByTestId('result-row-1')).toContainText('第 2 組')
    await expect(p.getByTestId('result-row-1')).toContainText('中央處理器')
    await expect(p.getByTestId('result-row-2')).toContainText('第 1 組')
  }

  // 寫回試算表
  await board.getByTestId('export-sheet-btn').click()
  await expect(board.getByTestId('export-confirm')).toContainText('學習單!G5')
  await board.getByTestId('export-confirm-ok').click()
  await expect(board.getByTestId('export-result')).toContainText('已寫入 1 格')
  await expect(board.getByTestId('last-exported')).not.toContainText('尚未寫回')

  // 下載 CSV
  const [download] = await Promise.all([board.waitForEvent('download'), board.getByTestId('export-csv').click()])
  expect(download.suggestedFilename()).toBe(`${code}_results.csv`)
})

test('錯誤密碼不能登入；找不到的試算表顯示錯誤且不能建立活動', async ({ browser }) => {
  const page = await newPage(browser)
  await page.goto('/teacher/login')
  await page.getByTestId('password').fill('wrong-password')
  await page.getByTestId('login-btn').click()
  await expect(page.getByTestId('login-error')).toHaveText('密碼錯誤')

  await page.getByTestId('password').fill(PASSWORD())
  await page.getByTestId('login-btn').click()
  await expect(page).toHaveURL(/\/teacher\/new$/)
  // fake-sheets 中不存在的試算表：404 SHEET_NOT_FOUND
  await page.getByTestId('sheet-url-input').fill('https://docs.google.com/spreadsheets/d/e2e-missing/edit')
  await page.getByTestId('import-btn').click()
  await expect(page.getByTestId('import-error')).toContainText('找不到這份試算表')
  await expect(page.getByTestId('create-btn')).toBeDisabled()
})
