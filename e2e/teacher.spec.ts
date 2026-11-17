import { expect, test } from '@playwright/test'
import {
  createActivity,
  FILES,
  hook,
  joinStudent,
  newContext,
  openBoard,
  PASSWORD,
  questionApi,
  reset,
  submitViaApi,
  teacherContext,
} from './helpers'

test.beforeEach(reset)

test.describe('5.2 教師登入', () => {
  test('密碼正確：導向 /teacher/new，密碼不留在 URL 與瀏覽器儲存空間', async ({ browser }) => {
    const ctx = await newContext(browser)
    const page = await ctx.newPage()
    await page.goto('/')
    await page.getByTestId('go-teacher').click()
    await page.getByTestId('password').fill(PASSWORD())
    await page.getByTestId('login-btn').click()
    await expect(page).toHaveURL(/\/teacher\/new$/)
    const leaked = await page.evaluate(
      (pw) =>
        location.href.includes(pw) ||
        JSON.stringify({ ...localStorage }).includes(pw) ||
        JSON.stringify({ ...sessionStorage }).includes(pw) ||
        document.cookie.includes(pw),
      PASSWORD(),
    )
    expect(leaked).toBe(false)
  })

  test('密碼錯誤：停留在登入頁、顯示錯誤並清空密碼', async ({ page }) => {
    await page.goto('/teacher/login')
    await page.getByTestId('password').fill('wrong-password')
    await page.getByTestId('login-btn').click()
    await expect(page.getByTestId('login-error')).toHaveText('密碼錯誤')
    await expect(page.getByTestId('password')).toHaveValue('')
    await expect(page).toHaveURL(/\/teacher\/login/)
  })

  test('未登入時開啟看板：導向登入頁', async ({ page }) => {
    await page.goto('/teacher/board/ABC234')
    await expect(page).toHaveURL(/\/teacher\/login/)
  })
})

test.describe('5.3 上傳、預覽與建立活動', () => {
  test('單題範本 → 題組範本 → 另一份 Guided Notes：畫面完全依後端資料，換檔後不殘留', async ({ browser }) => {
    const ctx = await teacherContext(browser)
    const page = await ctx.newPage()
    await page.goto('/teacher/new')
    const input = page.getByTestId('upload-input')

    await input.setInputFiles(FILES.single)
    await expect(page.getByTestId('preview-count')).toHaveText('共 6 題')
    await expect(page.locator('[data-testid^="preview-row-"]')).toHaveCount(6)
    for (const [n, row] of [[1, 5], [3, 9], [6, 15]]) {
      await expect(page.getByTestId(`preview-row-${n}`)).toContainText(`學習單!G${row}`)
    }

    await input.setInputFiles(FILES.group)
    await expect(page.getByTestId('preview-count')).toHaveText('共 4 題')
    const q1 = page.getByTestId('preview-row-1').getByTestId('preview-blank')
    await expect(q1).toHaveCount(2)
    await expect(q1.nth(0)).toHaveText(/^（1）\s*學習單!H5$/)
    await expect(q1.nth(1)).toHaveText(/^（2）\s*學習單!H6$/)

    await input.setInputFiles(FILES.variant)
    await expect(page.getByTestId('preview-count')).toHaveText('共 9 題')
    await expect(page.locator('[data-testid^="preview-row-"]')).toHaveCount(9)
    await expect(page.getByTestId('preview')).not.toContainText('學習單!')
    await expect(page.getByTestId('preview-warnings')).toContainText('第 9 題的填空格原本已有內容')
    await expect(page.getByTestId('create-btn')).toBeEnabled()
  })

  test('解析失敗：顯示原因，不能建立活動', async ({ browser }) => {
    const ctx = await teacherContext(browser)
    const page = await ctx.newPage()
    await page.goto('/teacher/new')
    await page.getByTestId('upload-input').setInputFiles(FILES.single)
    await expect(page.getByTestId('preview-count')).toHaveText('共 6 題')
    await page.getByTestId('upload-input').setInputFiles(FILES.invalid)
    await expect(page.getByTestId('upload-error')).toHaveText('解析失敗：找不到題號/作答表頭')
    await expect(page.getByTestId('preview')).toHaveCount(0)
    await expect(page.getByTestId('create-btn')).toBeDisabled()
  })

  test('檔案格式錯誤：顯示「請上傳 .xlsx 檔」且不顯示預覽', async ({ browser }) => {
    const ctx = await teacherContext(browser)
    const page = await ctx.newPage()
    await page.goto('/teacher/new')
    await page.getByTestId('upload-input').setInputFiles(FILES.notXlsx)
    await expect(page.getByTestId('upload-error')).toHaveText('請上傳 .xlsx 檔')
    await expect(page.getByTestId('preview')).toHaveCount(0)
  })

  test('組數不合法時顯示錯誤；建立成功後導向看板並顯示代號', async ({ browser }) => {
    const ctx = await teacherContext(browser)
    const page = await ctx.newPage()
    await page.goto('/teacher/new')
    await page.getByTestId('upload-input').setInputFiles(FILES.single)
    await expect(page.getByTestId('preview-count')).toHaveText('共 6 題')
    await page.getByTestId('group-count').fill('1')
    await page.getByTestId('create-btn').click()
    await expect(page.getByTestId('create-error')).toHaveText('組數不合法')
    await expect(page).toHaveURL(/\/teacher\/new$/)

    await page.getByTestId('group-count').fill('6')
    await page.getByTestId('create-btn').click()
    await expect(page).toHaveURL(/\/teacher\/board\/[A-Z2-9]{6}$/)
    const code = page.url().split('/').pop()!
    await expect(page.getByTestId('activity-code')).toHaveText(code)
    await expect(page.locator('[data-testid^="group-g"]')).toHaveCount(6)
    await expect(page.locator('[data-testid^="q-row-"]')).toHaveCount(6)
  })
})

test.describe('5.4 題目看板與控制按鈕', () => {
  test('第 3 題進行中：其他題不能開始，只有第 3 題可以結束', async ({ browser }) => {
    const ctx = await teacherContext(browser)
    const code = await createActivity(ctx)
    await questionApi(ctx, code).open('q3')
    const page = await openBoard(ctx, code)
    await expect(page.getByTestId('q-row-3').getByTestId('q-status')).toHaveText('進行中')
    for (const n of [1, 2, 4, 5, 6]) {
      await expect(page.getByTestId(`q-row-${n}`).getByTestId('start-btn')).toBeDisabled()
    }
    await expect(page.getByTestId('q-row-3').getByTestId('close-btn')).toBeEnabled()
    await expect(page.getByTestId('next-btn')).toBeDisabled()
  })

  test('後端拒絕開始（409）：顯示提示，狀態維持快照內容', async ({ browser }) => {
    const ctx = await teacherContext(browser)
    const code = await createActivity(ctx)
    const page = await openBoard(ctx, code)
    await hook('forceError', { method: 'POST', path: '/open', status: 409, code: 'ANOTHER_QUESTION_OPEN' })
    await page.getByTestId('q-row-1').getByTestId('start-btn').click()
    await expect(page.getByTestId('board-error')).toHaveText('已有題目進行中')
    await expect(page.getByTestId('q-row-1').getByTestId('q-status')).toHaveText('未開始')
  })

  test('狀態等快照才改變：204 後仍顯示未開始與處理中，收到快照後才變成進行中', async ({ browser }) => {
    const ctx = await teacherContext(browser)
    const code = await createActivity(ctx)
    const page = await openBoard(ctx, code)
    await hook('delaySnapshots', { ms: 1200 })
    const row = page.getByTestId('q-row-1')
    const resp = page.waitForResponse((r) => r.url().endsWith('/questions/q1/open'))
    await row.getByTestId('start-btn').click()
    expect((await resp).status()).toBe(204)
    await expect(row.getByTestId('q-status')).toHaveText('未開始')
    await expect(row.getByTestId('start-btn')).toHaveText('處理中…')
    await expect(row.getByTestId('q-status')).toHaveText('進行中', { timeout: 3000 })
    await hook('delaySnapshots', { ms: 0 })
  })

  test('下一題、結束、重開', async ({ browser }) => {
    const ctx = await teacherContext(browser)
    const code = await createActivity(ctx)
    const q = questionApi(ctx, code)
    await q.open('q1')
    await q.close('q1')
    await q.open('q2')
    await q.close('q2')
    const page = await openBoard(ctx, code)
    await expect(page.getByTestId('next-btn')).toHaveText('下一題（第 3 題）')
    const req = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/questions/q3/open'))
    await page.getByTestId('next-btn').click()
    await req
    await expect(page.getByTestId('q-row-3').getByTestId('q-status')).toHaveText('進行中')

    await page.getByTestId('q-row-3').getByTestId('close-btn').click()
    await expect(page.getByTestId('q-row-3').getByTestId('q-status')).toHaveText('已結束')
    await page.getByTestId('q-row-1').getByTestId('reopen-btn').click()
    await expect(page.getByTestId('q-row-1').getByTestId('q-status')).toHaveText('進行中')
    await expect(page.getByTestId('q-row-1')).toContainText('第 2 輪')
  })
})

test.describe('5.5 各組狀態、順位與組長', () => {
  test('送出後看板約一秒內顯示已送出、答案與順位；順位只依後端', async ({ browser }) => {
    const ctx = await teacherContext(browser)
    const code = await createActivity(ctx, 'single', 4)
    const page = await openBoard(ctx, code)
    const s4 = await joinStudent(browser, code, '小四', 'g4', { open: false })
    const s1 = await joinStudent(browser, code, '小一', 'g1', { open: false })
    await questionApi(ctx, code).open('q1')
    await expect(page.getByTestId('group-g4').getByTestId('group-status')).toHaveText('未作答')

    expect((await submitViaApi(s4, code, 'q1', 1, ['CPU'])).status()).toBe(201)
    const g4 = page.getByTestId('group-g4')
    await expect(g4.getByTestId('group-status')).toHaveText('已送出')
    await expect(g4.getByTestId('group-answer')).toHaveText('CPU')
    await expect(g4.getByTestId('group-rank')).toHaveText('第 1 名・搶答成功')

    expect((await submitViaApi(s1, code, 'q1', 1, ['中央處理器'])).status()).toBe(201)
    await expect(page.getByTestId('group-g1').getByTestId('group-rank')).toHaveText('第 2 名')

    await questionApi(ctx, code).close('q1')
    const result = page.getByTestId('result-1')
    await expect(result.locator('tbody tr')).toHaveCount(2)
    await expect(result.locator('tbody tr').nth(0)).toContainText('第 4 組')
    await expect(result.locator('tbody tr').nth(0)).toContainText('搶答成功')
  })

  test('組長離線標示與轉移組長', async ({ browser }) => {
    const ctx = await teacherContext(browser)
    const code = await createActivity(ctx)
    const a = await joinStudent(browser, code, '小明', 'g1', { open: false })
    await joinStudent(browser, code, '小華', 'g1', { open: false })
    const page = await openBoard(ctx, code)
    const g1 = page.getByTestId('group-g1')
    await expect(g1.getByTestId('member-小明')).toContainText('組長')

    await hook('presence', { code, clientId: a.clientId, online: false })
    await expect(g1.getByTestId('member-小明').getByTestId('offline')).toBeVisible()

    await g1.getByTestId('leader-select').selectOption({ label: '小華' })
    await g1.getByTestId('leader-btn').click()
    await expect(g1.getByTestId('member-小華')).toContainText('組長')
    await expect(g1.getByTestId('member-小明')).not.toContainText('組長')
  })
})

test.describe('5.6 匯出', () => {
  test('匯出 Excel 與下載 CSV 觸發下載，檔名與 Content-Disposition 一致', async ({ browser }) => {
    const ctx = await teacherContext(browser)
    const code = await createActivity(ctx)
    const page = await openBoard(ctx, code)

    for (const [testId, ext] of [['export-xlsx', 'xlsx'], ['export-csv', 'csv']] as const) {
      const head = await ctx.request.get(`/api/activities/${code}/export.${ext}`)
      const cd = head.headers()['content-disposition']
      const expected = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(cd)![1])
      const download = page.waitForEvent('download')
      await page.getByTestId(testId).click()
      expect((await download).suggestedFilename()).toBe(expected)
    }
  })

  test('下載的 CSV 由後端產生：前端原樣下載（內容為 mock 的佔位實作）', async ({ browser }) => {
    const ctx = await teacherContext(browser)
    const code = await createActivity(ctx)
    const a = await joinStudent(browser, code, 'A', 'g2', { open: false })
    const b = await joinStudent(browser, code, 'B', 'g1', { open: false })
    await questionApi(ctx, code).open('q1')
    expect((await submitViaApi(a, code, 'q1', 1, ['CPU'])).status()).toBe(201)
    expect((await submitViaApi(b, code, 'q1', 1, ['中央處理器'])).status()).toBe(201)
    await questionApi(ctx, code).close('q1')
    const page = await openBoard(ctx, code)

    const expected = await (await ctx.request.get(`/api/activities/${code}/export.csv`)).body()
    const download = page.waitForEvent('download')
    await page.getByTestId('export-csv').click()
    const file = await (await download).path()
    const got = (await import('node:fs')).readFileSync(file)
    expect(got.equals(expected)).toBe(true) // 前端沒有修改內容
    const lines = got.toString('utf8').replace(/^﻿/, '').trim().split(/\r\n/)
    expect(lines).toEqual(['題號,組別,答案,搶答順位', '1,第 2 組,CPU,1', '1,第 1 組,中央處理器,2'])
  })
})
