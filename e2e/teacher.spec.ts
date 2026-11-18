import { expect, test, type Browser, type Page } from '@playwright/test'
import {
  countRequests,
  createActivity,
  hook,
  joinStudent,
  newContext,
  openBoard,
  PASSWORD,
  questionApi,
  reset,
  SHARE_WITH,
  SHEETS,
  sheetWrites,
  submitViaApi,
  teacherContext,
  type SheetKind,
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

test.describe('5.3 匯入線上 Guided Notes、預覽與建立活動', () => {
  async function newPage(browser: Browser) {
    const ctx = await teacherContext(browser)
    const page = await ctx.newPage()
    await page.goto('/teacher/new')
    return { ctx, page }
  }
  async function importSheet(page: Page, url: string) {
    await page.getByTestId('sheet-url-input').fill(url)
    await page.getByTestId('import-btn').click()
  }

  test('單題 → 題組 → 另一份試算表：畫面完全依後端資料，換一份後不殘留', async ({ browser }) => {
    const { page } = await newPage(browser)

    await importSheet(page, SHEETS.single)
    await expect(page.getByTestId('preview-title')).toHaveText('軟工期末專案_單題_範例 / 學習單')
    await expect(page.getByTestId('preview-count')).toHaveText('共 6 題')
    await expect(page.locator('[data-testid^="preview-row-"]')).toHaveCount(6)
    for (const [n, row] of [[1, 5], [3, 9], [6, 15]]) {
      await expect(page.getByTestId(`preview-row-${n}`)).toContainText(`學習單!G${row}`)
    }

    await importSheet(page, SHEETS.group)
    await expect(page.getByTestId('preview-title')).toHaveText('軟工期末專案_題組_範例 / 學習單')
    await expect(page.getByTestId('preview-count')).toHaveText('共 4 題')
    const q1 = page.getByTestId('preview-row-1').getByTestId('preview-blank')
    await expect(q1).toHaveCount(2)
    await expect(q1.nth(0)).toHaveText(/^（1）\s*學習單!H5$/)
    await expect(q1.nth(1)).toHaveText(/^（2）\s*學習單!H6$/)

    await importSheet(page, SHEETS.variant)
    await expect(page.getByTestId('preview-count')).toHaveText('共 9 題')
    await expect(page.locator('[data-testid^="preview-row-"]')).toHaveCount(9)
    await expect(page.getByTestId('preview')).not.toContainText('學習單')
    await expect(page.getByTestId('preview')).not.toContainText('軟工期末專案')
    await expect(page.getByTestId('preview-title')).toHaveText('另一份講義_變體 / 講義B')
    await expect(page.getByTestId('preview-warnings')).toContainText('第 9 題的填空格原本已有內容')
    await expect(page.getByTestId('create-btn')).toBeEnabled()
  })

  test('網址欄位空白：匯入按鈕停用，不發出匯入請求', async ({ browser }) => {
    const { page } = await newPage(browser)
    const imports = countRequests(page, (url) => url.includes('/api/sheets/import'))
    const btn = page.getByTestId('import-btn')
    await expect(btn).toBeDisabled()
    await page.getByTestId('sheet-url-input').fill('   ')
    await expect(btn).toBeDisabled()
    await page.getByTestId('sheet-url-input').press('Enter')
    await page.waitForTimeout(300)
    expect(imports.n).toBe(0)
  })

  const IMPORT_ERRORS: [string, keyof typeof SHEETS, string][] = [
    ['網址無效', 'notASheet', '這不是有效的 Google 試算表網址'],
    ['試算表沒有共用', 'notShared', `無法讀取此試算表，請先共用給 ${SHARE_WITH}`],
    ['找不到試算表', 'missing', '找不到這份試算表，請確認網址'],
    ['找不到工作表', 'noWorksheet', '找不到指定的工作表：網址指定的工作表不存在'],
    ['解析失敗', 'invalid', '解析失敗：找不到題號/作答表頭'],
  ]
  for (const [name, kind, message] of IMPORT_ERRORS) {
    test(`${name}：匯入成功後再失敗，清除預覽、停用建立活動、保留網址`, async ({ browser }) => {
      const { page } = await newPage(browser)
      await importSheet(page, SHEETS.single)
      await expect(page.getByTestId('preview-count')).toHaveText('共 6 題')

      await importSheet(page, SHEETS[kind])
      await expect(page.getByTestId('import-error')).toHaveText(message)
      await expect(page.getByTestId('preview')).toHaveCount(0)
      await expect(page.getByTestId('create-btn')).toBeDisabled()
      await expect(page.getByTestId('sheet-url-input')).toHaveValue(SHEETS[kind])
      if (kind === 'notShared') {
        await expect(page.getByTestId('share-with')).toHaveText(SHARE_WITH)
        await expect(page.getByTestId('copy-share-with')).toBeVisible()
      } else {
        await expect(page.getByTestId('share-with')).toHaveCount(0)
      }
    })
  }

  test('Google 服務無法連線：顯示提示，不顯示預覽', async ({ browser }) => {
    const { page } = await newPage(browser)
    await hook('forceError', { method: 'POST', path: '/api/sheets/import', status: 503, code: 'SHEETS_UNAVAILABLE' })
    await importSheet(page, SHEETS.single)
    await expect(page.getByTestId('import-error')).toHaveText('Google 服務暫時無法連線，請稍後再試')
    await expect(page.getByTestId('preview')).toHaveCount(0)
  })

  test('組數不合法時顯示錯誤；建立成功後導向看板並顯示代號', async ({ browser }) => {
    const { page } = await newPage(browser)
    await importSheet(page, SHEETS.single)
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

  test('匯入結果已失效：顯示提示並停留在建立頁', async ({ browser }) => {
    const { page } = await newPage(browser)
    await importSheet(page, SHEETS.single)
    await expect(page.getByTestId('preview-count')).toHaveText('共 6 題')
    await hook('forceError', { method: 'POST', path: '/api/activities', status: 404, code: 'IMPORT_NOT_FOUND' })
    await page.getByTestId('create-btn').click()
    await expect(page.getByTestId('create-error')).toHaveText('匯入結果已失效，請重新匯入')
    await expect(page).toHaveURL(/\/teacher\/new$/)
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

test.describe('5.6 下載 CSV', () => {
  test('下載 CSV 觸發下載，檔名與 Content-Disposition 一致；看板上沒有 Excel 下載', async ({ browser }) => {
    const ctx = await teacherContext(browser)
    const code = await createActivity(ctx)
    const page = await openBoard(ctx, code)

    const head = await ctx.request.get(`/api/activities/${code}/export.csv`)
    const cd = head.headers()['content-disposition']
    const expected = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(cd)![1])
    const download = page.waitForEvent('download')
    await page.getByTestId('export-csv').click()
    expect((await download).suggestedFilename()).toBe(expected)

    await expect(page.getByText('匯出 Excel')).toHaveCount(0)
    await expect(page.locator('a[href*="export.xlsx"]')).toHaveCount(0)
  })

  test('下載的 CSV 由後端產生：前端原樣下載', async ({ browser }) => {
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

test.describe('5.7 寫回試算表', () => {
  /** 建立活動，讓第 2 組在第 1 題搶答成功並結束；回傳看板 */
  async function boardWithResult(browser: Browser, kind: SheetKind = 'single', texts = ['光合作用']) {
    const ctx = await teacherContext(browser)
    const code = await createActivity(ctx, kind)
    const g2 = await joinStudent(browser, code, '小華', 'g2', { open: false })
    const g1 = await joinStudent(browser, code, '小明', 'g1', { open: false })
    const q = questionApi(ctx, code)
    await q.open('q1')
    expect((await submitViaApi(g2, code, 'q1', 1, texts)).status()).toBe(201)
    expect((await submitViaApi(g1, code, 'q1', 1, texts.map((t) => `${t}慢`))).status()).toBe(201)
    await q.close('q1')
    const page = await openBoard(ctx, code)
    return { ctx, code, page, q }
  }
  const section = (page: Page) => page.getByTestId('sheet-export')

  test('沒有已結束且有提交的題目時停用；結束一題後可用；斷線時停用', async ({ browser }) => {
    const ctx = await teacherContext(browser)
    const code = await createActivity(ctx)
    const page = await openBoard(ctx, code)
    const btn = page.getByTestId('export-sheet-btn')
    await expect(btn).toBeDisabled()
    await expect(page.getByTestId('last-exported')).toHaveText('尚未寫回')
    await expect(page.getByTestId('sheet-link')).toHaveAttribute(
      'href',
      'https://docs.google.com/spreadsheets/d/mock-single/edit',
    )

    const s = await joinStudent(browser, code, '小明', 'g1', { open: false })
    const q = questionApi(ctx, code)
    await q.open('q1')
    await q.close('q1') // 無人作答：仍然停用
    await expect(btn).toBeDisabled()
    await q.open('q2')
    expect((await submitViaApi(s, code, 'q2', 1, ['答案'])).status()).toBe(201)
    await expect(btn).toBeDisabled() // 進行中：仍然停用
    await q.close('q2')
    await expect(btn).toBeEnabled()

    await hook('disconnect', { code, role: 'teacher', blockMs: 1500 })
    await expect(btn).toBeDisabled()
    await expect(btn).toBeEnabled({ timeout: 6000 })
  })

  test('確認視窗：列出寫入的組別、答案與儲存格，無人作答與進行中不寫入，並顯示覆寫警告', async ({ browser }) => {
    const { page, q } = await boardWithResult(browser)
    await q.open('q2')
    await q.close('q2') // 第 2 題無人作答
    await q.open('q3') // 第 3 題進行中
    await expect(page.getByTestId('q-row-3').getByTestId('q-status')).toHaveText('進行中')

    await page.getByTestId('export-sheet-btn').click()
    const dialog = page.getByTestId('export-confirm')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('軟工期末專案_單題_範例 / 學習單')
    const item1 = dialog.getByTestId('export-item-1')
    await expect(item1).toContainText('第 2 組')
    await expect(item1.getByTestId('export-cell')).toHaveText(/^光合作用 → 學習單!G5$/)
    await expect(dialog.getByTestId('export-item-2')).toContainText('本題無人作答，不寫入')
    await expect(dialog.getByTestId('export-item-3')).toContainText('進行中，不寫入')
    await expect(dialog.getByTestId('export-item-4')).toContainText('未開始，不寫入')
    await expect(dialog.getByTestId('export-overwrite-warning')).toHaveText('將覆寫這些儲存格的現有內容')
  })

  test('題組：確認視窗分別列出兩個子填空；寫回兩格', async ({ browser }) => {
    const { page, code } = await boardWithResult(browser, 'group', ['CPU', '作業系統'])
    await page.getByTestId('export-sheet-btn').click()
    const cells = page.getByTestId('export-item-1').getByTestId('export-cell')
    await expect(cells).toHaveCount(2)
    await expect(cells.nth(0)).toHaveText(/^（1）\s*CPU → 學習單!H5$/)
    await expect(cells.nth(1)).toHaveText(/^（2）\s*作業系統 → 學習單!H6$/)
    await page.getByTestId('export-confirm-ok').click()
    await expect(page.getByTestId('export-result')).toContainText('已寫入 2 格')
    expect((await sheetWrites(code))[0].cells).toEqual([
      { cellRef: '學習單!H5', value: 'CPU' },
      { cellRef: '學習單!H6', value: '作業系統' },
    ])
  })

  test('取消：視窗關閉，沒有發出寫回請求', async ({ browser }) => {
    const { page, code } = await boardWithResult(browser)
    const exports = countRequests(page, (url) => url.includes('/export-to-sheet'))
    await page.getByTestId('export-sheet-btn').click()
    await page.getByTestId('export-confirm-cancel').click()
    await expect(page.getByTestId('export-confirm')).toHaveCount(0)
    await page.waitForTimeout(300)
    expect(exports.n).toBe(0)
    expect(await sheetWrites(code)).toEqual([])
  })

  test('確認後送出 basedOnVersion；成功時顯示寫入格數、未寫入題號與試算表連結，寫到對應的儲存格', async ({ browser }) => {
    const { page, code, ctx } = await boardWithResult(browser)
    const version = (await (await ctx.request.get(`/api/activities/${code}/teacher`)).json()).version
    await page.getByTestId('export-sheet-btn').click()
    const req = page.waitForRequest((r) => r.url().endsWith(`/api/activities/${code}/export-to-sheet`))
    await page.getByTestId('export-confirm-ok').click()
    expect((await req).postDataJSON()).toEqual({ basedOnVersion: version })

    const result = page.getByTestId('export-result')
    await expect(result).toContainText('已寫入 1 格')
    await expect(result).toContainText('第 2、3、4、5、6 題未寫入')
    const link = page.getByTestId('export-result-link')
    await expect(link).toHaveAttribute('href', 'https://docs.google.com/spreadsheets/d/mock-single/edit')
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', /noopener/)
    expect((await sheetWrites(code))[0].cells).toEqual([{ cellRef: '學習單!G5', value: '光合作用' }])

    // 上次寫回時間依快照顯示，重新整理後仍然存在
    await expect(page.getByTestId('last-exported')).not.toHaveText('尚未寫回')
    await page.reload()
    await expect(page.getByTestId('conn-status')).toHaveText('已連線')
    await expect(page.getByTestId('last-exported')).not.toHaveText('尚未寫回')
    await expect(page.getByTestId('sheet-link')).toHaveAttribute('target', '_blank')
  })

  test('另一份試算表寫到它自己的儲存格位置', async ({ browser }) => {
    const { page, code } = await boardWithResult(browser, 'variant', ['答案A'])
    await page.getByTestId('export-sheet-btn').click()
    await expect(page.getByTestId('export-item-1').getByTestId('export-cell')).toContainText('講義B!E8')
    await page.getByTestId('export-confirm-ok').click()
    await expect(page.getByTestId('export-result')).toContainText('已寫入 1 格')
    expect((await sheetWrites(code))[0].cells).toEqual([{ cellRef: '講義B!E8', value: '答案A' }])
  })

  test('連點確認只發出一次寫回請求', async ({ browser }) => {
    const { page, code } = await boardWithResult(browser)
    const exports = countRequests(page, (url) => url.includes('/export-to-sheet'))
    await page.getByTestId('export-sheet-btn').click()
    await page.getByTestId('export-confirm-ok').evaluate((el: HTMLElement) => {
      el.click()
      el.click()
    })
    await expect(page.getByTestId('export-result')).toContainText('已寫入 1 格')
    await page.waitForTimeout(300)
    expect(exports.n).toBe(1)
    expect(await sheetWrites(code)).toHaveLength(1)
  })

  async function expectFailure(page: Page, code: string, message: string) {
    await page.getByTestId('export-sheet-btn').click()
    await page.getByTestId('export-confirm-ok').click()
    await expect(page.getByTestId('export-error')).toHaveText(message)
    await expect(page.getByTestId('export-result')).toHaveCount(0)
    await expect(section(page)).not.toContainText(/成功|已寫入/)
    await expect(page.getByTestId('export-sheet-btn')).toBeEnabled()
    expect(await sheetWrites(code)).toEqual([])
  }

  test('沒有編輯權限：顯示要設為編輯者的 email 與複製按鈕', async ({ browser }) => {
    const { page, code } = await boardWithResult(browser, 'readonly')
    await expectFailure(page, code, `試算表只有檢視權限，請把 ${SHARE_WITH} 設為編輯者`)
    await expect(section(page).getByTestId('share-with')).toHaveText(SHARE_WITH)
    await expect(section(page).getByTestId('copy-share-with')).toBeVisible()
  })

  test('試算表結構已變更：顯示原因，未寫入任何資料', async ({ browser }) => {
    const { page, code } = await boardWithResult(browser, 'changed')
    await expectFailure(page, code, '試算表的題目結構已變更，未寫入任何資料：第 3 題的作答格位置已改變')
  })

  test('寫回失敗：試算表未被修改，按鈕恢復可用，可以再次寫回', async ({ browser }) => {
    const { page, code } = await boardWithResult(browser)
    await hook('forceError', { method: 'POST', path: '/export-to-sheet', status: 502, code: 'SHEET_WRITE_FAILED' })
    await expectFailure(page, code, '寫回失敗，試算表未被修改，請稍後再試')
    await page.getByTestId('export-sheet-btn').click()
    await page.getByTestId('export-confirm-ok').click()
    await expect(page.getByTestId('export-result')).toContainText('已寫入 1 格')
    await expect(page.getByTestId('export-error')).toHaveCount(0)
  })

  test('結果已更新：顯示提示並要求最新快照，不自動重送', async ({ browser }) => {
    const { page, code } = await boardWithResult(browser)
    const exports = countRequests(page, (url) => url.includes('/export-to-sheet'))
    await hook('forceError', { method: 'POST', path: '/export-to-sheet', status: 409, code: 'STALE_VERSION' })
    await expectFailure(page, code, '結果已更新，請重新確認')
    await page.waitForTimeout(500)
    expect(exports.n).toBe(1)
  })

  test('Google 服務無法連線或網路錯誤：顯示錯誤，沒有出現「已寫入」', async ({ browser }) => {
    const { page, code } = await boardWithResult(browser)
    await hook('forceError', { method: 'POST', path: '/export-to-sheet', status: 503, code: 'SHEETS_UNAVAILABLE' })
    await expectFailure(page, code, 'Google 服務暫時無法連線，請稍後再試')
    await page.route('**/export-to-sheet', (route) => route.abort())
    await expectFailure(page, code, '發生錯誤，請稍後再試')
  })
})
