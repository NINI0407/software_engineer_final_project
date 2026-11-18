import { expect, test, type Page } from '@playwright/test'
import {
  BASE,
  countRequests,
  createActivity,
  hook,
  joinStudent,
  newContext,
  openBoard,
  questionApi,
  reset,
  submitViaApi,
  teacherContext,
} from './helpers'

test.beforeEach(reset)

const groupCookie = async (page: Page, code: string) =>
  (await page.context().cookies(BASE)).find((c) => c.name === `group_${code}`)?.value

test.describe('6.1 加入活動', () => {
  test('輸入代號與暱稱加入成功；重新整理後恢復', async ({ browser }) => {
    const t = await teacherContext(browser)
    const code = await createActivity(t)
    const ctx = await newContext(browser)
    const page = await ctx.newPage()
    await page.goto('/')
    await page.getByTestId('go-student').click()
    await page.getByTestId('join-code').fill(code.toLowerCase())
    await page.getByTestId('join-nickname').fill('小明')
    await page.getByTestId('join-btn').click()
    await expect(page).toHaveURL(new RegExp(`/play/${code}$`))
    await expect(page.getByTestId('choose-group')).toBeVisible()
    await expect(page.getByTestId('me')).toHaveText('小明')

    await page.reload()
    await expect(page).toHaveURL(new RegExp(`/play/${code}$`))
    await expect(page.getByTestId('me')).toHaveText('小明')
  })

  test('代號不存在：顯示錯誤並停留在 /join', async ({ page }) => {
    await page.goto('/join')
    await page.getByTestId('join-code').fill('ZZZZZZ')
    await page.getByTestId('join-nickname').fill('小明')
    await page.getByTestId('join-btn').click()
    await expect(page.getByTestId('join-error')).toHaveText('找不到此活動代號')
    await expect(page).toHaveURL(/\/join/)
  })

  test('未加入就開啟 /play：導向 /join 並預填代號', async ({ browser }) => {
    const t = await teacherContext(browser)
    const code = await createActivity(t)
    const ctx = await newContext(browser)
    const page = await ctx.newPage()
    await page.goto(`/play/${code}`)
    await expect(page).toHaveURL(new RegExp(`/join\\?code=${code}$`))
    await expect(page.getByTestId('join-code')).toHaveValue(code)
  })
})

test.describe('6.2 選組、換組與鎖定', () => {
  test('開始前換組：畫面與 Cookie 更新，重新整理後預選新組別', async ({ browser }) => {
    const t = await teacherContext(browser)
    const code = await createActivity(t)
    const s = await joinStudent(browser, code, '小明', 'g2')
    await expect(s.page.getByTestId('group-select')).toHaveValue('g2')
    await s.page.getByTestId('group-select').selectOption('g3')
    await expect(s.page.getByTestId('my-members')).toBeVisible()
    await expect(s.page.locator('h2', { hasText: '第 3 組 成員' })).toBeVisible()
    expect(await groupCookie(s.page, code)).toBe('g3')
    await s.page.reload()
    await expect(s.page.getByTestId('group-select')).toHaveValue('g3')
  })

  test('開始後鎖定：下拉選單停用並顯示提示', async ({ browser }) => {
    const t = await teacherContext(browser)
    const code = await createActivity(t)
    const s = await joinStudent(browser, code, '小明', 'g1')
    await expect(s.page.getByTestId('group-select')).toBeEnabled()
    await questionApi(t, code).open('q1')
    await expect(s.page.getByTestId('group-select')).toBeDisabled()
    await expect(s.page.getByTestId('group-locked')).toHaveText('搶答已開始，無法換組')
  })

  test('開始後才加入的學生可以選一次組，選定後鎖定', async ({ browser }) => {
    const t = await teacherContext(browser)
    const code = await createActivity(t)
    await questionApi(t, code).open('q1')
    const s = await joinStudent(browser, code, '晚到')
    await expect(s.page.getByTestId('choose-group')).toBeVisible()
    await expect(s.page.getByTestId('group-select')).toBeEnabled()
    await s.page.getByTestId('group-select').selectOption('g2')
    await s.page.getByTestId('join-group-btn').click()
    await expect(s.page.getByTestId('group-select')).toBeDisabled()
    await expect(s.page.getByTestId('group-select')).toHaveValue('g2')
    await expect(s.page.getByTestId('answer-card')).toBeVisible()
  })

  test('後端拒絕換組（409）：下拉選單與 Cookie 恢復成後端的值', async ({ browser }) => {
    const t = await teacherContext(browser)
    const code = await createActivity(t)
    const s = await joinStudent(browser, code, '小明', 'g1')
    await expect.poll(() => groupCookie(s.page, code)).toBe('g1')
    await hook('forceError', { method: 'PUT', path: '/me/group', status: 409, code: 'GROUP_LOCKED' })
    await s.page.getByTestId('group-select').selectOption('g3')
    await expect(s.page.getByTestId('play-message')).toHaveText('搶答已開始，無法換組')
    await expect(s.page.getByTestId('group-select')).toHaveValue('g1')
    expect(await groupCookie(s.page, code)).toBe('g1')
  })

  test('Cookie 被竄改：畫面以後端組別為準，並覆寫 Cookie', async ({ browser }) => {
    const t = await teacherContext(browser)
    const code = await createActivity(t)
    const s = await joinStudent(browser, code, '小明', 'g2', { open: false })
    await s.ctx.addCookies([{ name: `group_${code}`, value: 'g5', url: BASE }])
    await s.page.goto(`/play/${code}`)
    await expect(s.page.getByTestId('group-select')).toHaveValue('g2')
    await expect.poll(() => groupCookie(s.page, code)).toBe('g2')
  })
})

test.describe('6.3 等待與作答畫面', () => {
  test('開始前不能作答：顯示等待畫面，沒有輸入框與送出鈕', async ({ browser }) => {
    const t = await teacherContext(browser)
    const code = await createActivity(t)
    const s = await joinStudent(browser, code, '小明', 'g1')
    await expect(s.page.getByTestId('waiting')).toContainText('等待老師開始')
    await expect(s.page.locator('textarea')).toHaveCount(0)
    await expect(s.page.getByTestId('submit-btn')).toHaveCount(0)
  })

  test('單題顯示 1 個輸入框；題組依子填空顯示多個', async ({ browser }) => {
    const t = await teacherContext(browser)
    const code = await createActivity(t, 'group')
    const s = await joinStudent(browser, code, '小明', 'g1')
    const q = questionApi(t, code)
    await q.open('q3')
    await expect(s.page.getByTestId('question-title')).toHaveText('第 3 題')
    await expect(s.page.locator('textarea')).toHaveCount(1)
    await q.close('q3')
    await q.open('q1')
    await expect(s.page.getByTestId('question-title')).toHaveText('第 1 題')
    await expect(s.page.locator('textarea')).toHaveCount(2)
    await expect(s.page.getByText('（1）', { exact: true })).toBeVisible()
    await expect(s.page.getByText('（2）', { exact: true })).toBeVisible()
  })

  test('組員可以編輯，但送出鈕停用並提示只有組長能送出', async ({ browser }) => {
    const t = await teacherContext(browser)
    const code = await createActivity(t)
    await joinStudent(browser, code, '組長', 'g1', { open: false })
    const member = await joinStudent(browser, code, '組員', 'g1')
    await questionApi(t, code).open('q1')
    await expect(member.page.getByTestId('answer-0')).toBeEditable()
    await expect(member.page.getByTestId('submit-btn')).toBeDisabled()
    await expect(member.page.getByTestId('leader-only')).toHaveText('只有組長能送出')
  })

  test('收到 403：提示只有組長能送出，並依重新取得的快照重畫', async ({ browser }) => {
    const t = await teacherContext(browser)
    const code = await createActivity(t)
    const leader = await joinStudent(browser, code, '原組長', 'g1')
    await joinStudent(browser, code, '新組長', 'g1', { open: false })
    await questionApi(t, code).open('q1')
    await leader.page.getByTestId('answer-0').fill('CPU')
    // 組長剛因離線被遞補給其他組員，但新快照還沒送到這個畫面
    await hook('delaySnapshots', { ms: 3000 })
    await hook('presence', { code, clientId: leader.clientId, online: false })
    await leader.page.getByTestId('submit-btn').click()
    await expect(leader.page.getByTestId('play-message')).toHaveText('只有組長能送出')
    await expect(leader.page.getByTestId('leader-only')).toBeVisible()
    await hook('delaySnapshots', { ms: 0 })
  })

  test('遞補成為組長：組長離線後，組員約一秒內出現可用的送出鈕，草稿不變', async ({ browser }) => {
    const t = await teacherContext(browser)
    const code = await createActivity(t)
    const leader = await joinStudent(browser, code, '組長', 'g1', { open: false })
    const member = await joinStudent(browser, code, '組員', 'g1')
    await questionApi(t, code).open('q1')
    await member.page.getByTestId('answer-0').fill('CPU')
    await expect(member.page.getByTestId('leader-only')).toBeVisible()
    await expect(member.page.getByTestId('me-leader')).toHaveCount(0)

    await hook('presence', { code, clientId: leader.clientId, online: false })
    await expect(member.page.getByTestId('me-leader')).toBeVisible()
    await expect(member.page.getByTestId('submit-btn')).toBeEnabled()
    await expect(member.page.getByTestId('leader-only')).toHaveCount(0)
    await expect(member.page.getByTestId('answer-0')).toHaveValue('CPU')
  })
})

test.describe('6.4 送出驗證與防重複', () => {
  async function setup(browser: Parameters<typeof teacherContext>[0], kind: 'single' | 'group' = 'single') {
    const t = await teacherContext(browser)
    const code = await createActivity(t, kind)
    const s = await joinStudent(browser, code, '組長', 'g1')
    await questionApi(t, code).open('q1')
    await expect(s.page.getByTestId('answer-card')).toBeVisible()
    const submits = countRequests(s.page, (url, m) => m === 'POST' && url.includes('/submissions'))
    return { t, code, s, submits }
  }

  test('只有半形空白與換行：送出鈕停用、顯示錯誤、沒有發出請求', async ({ browser }) => {
    const { s, submits } = await setup(browser)
    await s.page.getByTestId('answer-0').fill('   \n  ')
    await expect(s.page.getByTestId('field-error-0')).toHaveText('答案不可為空白')
    await expect(s.page.getByTestId('submit-btn')).toBeDisabled()
    await s.page.getByTestId('submit-btn').click({ force: true })
    expect(submits.n).toBe(0)
  })

  test('全形空白與零寬字元也視為空白', async ({ browser }) => {
    const { s, submits } = await setup(browser)
    await s.page.getByTestId('answer-0').fill('　​　')
    await expect(s.page.getByTestId('field-error-0')).toHaveText('答案不可為空白')
    await expect(s.page.getByTestId('submit-btn')).toBeDisabled()
    expect(submits.n).toBe(0)
  })

  test('題組有一格空白：被擋下並標出那一格', async ({ browser }) => {
    const { s, submits } = await setup(browser, 'group')
    await s.page.getByTestId('answer-0').fill('CPU')
    await s.page.getByTestId('answer-1').fill(' ')
    await expect(s.page.getByTestId('field-error-1')).toHaveText('答案不可為空白')
    await expect(s.page.getByTestId('field-error-0')).toHaveCount(0)
    await expect(s.page.getByTestId('submit-btn')).toBeDisabled()
    expect(submits.n).toBe(0)
  })

  test('超過 500 字被擋下', async ({ browser }) => {
    const { s } = await setup(browser)
    await s.page.getByTestId('answer-0').fill('字'.repeat(501))
    await expect(s.page.getByTestId('field-error-0')).toHaveText('答案不可超過 500 字')
    await expect(s.page.getByTestId('submit-btn')).toBeDisabled()
  })

  test('收到 400：顯示訊息，答案維持未送出', async ({ browser }) => {
    const { s } = await setup(browser)
    await hook('forceError', { method: 'POST', path: '/submissions', status: 400, code: 'BLANK_ANSWER' })
    await s.page.getByTestId('answer-0').fill('CPU')
    await s.page.getByTestId('submit-btn').click()
    await expect(s.page.getByTestId('play-message')).toHaveText('答案不可為空白')
    await expect(s.page.getByTestId('submit-btn')).toBeEnabled()
    await expect(s.page.getByTestId('submitted-msg')).toHaveCount(0)
  })

  test('連點 5 次只發出 1 個送出請求', async ({ browser }) => {
    const { s, submits } = await setup(browser)
    await s.page.getByTestId('answer-0').fill('CPU')
    await expect(s.page.getByTestId('submit-btn')).toBeEnabled()
    await s.page.evaluate(() => {
      const b = document.querySelector<HTMLButtonElement>('[data-testid="submit-btn"]')!
      for (let i = 0; i < 5; i++) b.click()
    })
    await expect(s.page.getByTestId('submitted-msg')).toBeVisible()
    expect(submits.n).toBe(1)
  })

  test('送出得到 201 但快照還沒到：送出鈕維持停用，等快照才切成已送出', async ({ browser }) => {
    const { s, submits } = await setup(browser)
    await s.page.getByTestId('answer-0').fill('CPU')
    await s.page.waitForTimeout(500) // 讓草稿先送完，避免草稿的快照干擾
    await hook('delaySnapshots', { ms: 1500 })
    const res = s.page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/submissions'))
    await s.page.getByTestId('submit-btn').click()
    expect((await res).status()).toBe(201)
    await expect(s.page.getByTestId('submit-btn')).toHaveText('送出答案') // 已解除「送出中…」
    await expect(s.page.getByTestId('submit-btn')).toBeDisabled()
    await expect(s.page.getByTestId('submitted-msg')).toHaveCount(0)
    await expect(s.page.getByTestId('submitted-msg')).toBeVisible({ timeout: 4000 })
    expect(submits.n).toBe(1)
    await hook('delaySnapshots', { ms: 0 })
  })

  test('另一個分頁已送出（409）：顯示「本組已送出」並變為唯讀', async ({ browser }) => {
    const { code, s } = await setup(browser)
    await s.page.getByTestId('answer-0').fill('CPU')
    await hook('delaySnapshots', { ms: 3000 })
    expect((await submitViaApi(s, code, 'q1', 1, ['另一個分頁'])).status()).toBe(201)
    await s.page.getByTestId('submit-btn').click()
    await expect(s.page.getByTestId('play-message')).toHaveText('本組已送出')
    await expect(s.page.getByTestId('submitted-msg')).toBeVisible()
    await expect(s.page.getByTestId('answer-0')).toHaveAttribute('readonly', '')
    await hook('delaySnapshots', { ms: 0 })
  })

  test('題目已結束（409）：提示並依新快照重畫', async ({ browser }) => {
    const { t, code, s } = await setup(browser)
    await s.page.getByTestId('answer-0').fill('CPU')
    await hook('delaySnapshots', { ms: 3000 })
    await questionApi(t, code).close('q1')
    await s.page.getByTestId('submit-btn').click()
    await expect(s.page.getByTestId('play-message')).toHaveText('本題已結束或已重開')
    await expect(s.page.getByTestId('result-card')).toBeVisible()
    await hook('delaySnapshots', { ms: 0 })
  })
})

test.describe('6.5 已送出、結果與重開', () => {
  test('同組成員一起變成唯讀，且不顯示順位', async ({ browser }) => {
    const t = await teacherContext(browser)
    const code = await createActivity(t)
    const leader = await joinStudent(browser, code, '組長', 'g1')
    const member = await joinStudent(browser, code, '組員', 'g1')
    await questionApi(t, code).open('q1')
    await leader.page.getByTestId('answer-0').fill('CPU')
    await leader.page.getByTestId('submit-btn').click()
    for (const p of [leader.page, member.page]) {
      await expect(p.getByTestId('submitted-msg')).toHaveText('已送出，等待老師結束本題')
      await expect(p.getByTestId('answer-0')).toHaveAttribute('readonly', '')
      await expect(p.getByTestId('answer-card')).not.toContainText(/順位|第 \d+ 名/)
    }
    await expect(member.page.getByTestId('answer-0')).toHaveValue('CPU')
  })

  test('兩組同時送出：都只顯示已送出；結束後依後端快照顯示一致的順位', async ({ browser }) => {
    const t = await teacherContext(browser)
    const code = await createActivity(t)
    const a = await joinStudent(browser, code, 'A', 'g1')
    const b = await joinStudent(browser, code, 'B', 'g2')
    await questionApi(t, code).open('q1')
    await a.page.getByTestId('answer-0').fill('答案A')
    await b.page.getByTestId('answer-0').fill('答案B')
    await Promise.all([a.page.getByTestId('submit-btn').click(), b.page.getByTestId('submit-btn').click()])
    for (const p of [a.page, b.page]) {
      await expect(p.getByTestId('submitted-msg')).toBeVisible()
      await expect(p.getByTestId('result-card')).toHaveCount(0)
    }
    await questionApi(t, code).close('q1')
    const truth = (await (await t.request.get(`/api/activities/${code}/teacher`)).json()).results[0]
    const winner = truth.submissions[0].groupId === 'g1' ? '第 1 組' : '第 2 組'
    const second = winner === '第 1 組' ? '第 2 組' : '第 1 組'
    for (const p of [a.page, b.page]) {
      await expect(p.getByTestId('result-row-1')).toContainText(winner)
      await expect(p.getByTestId('result-row-1')).toContainText('搶答成功')
      await expect(p.getByTestId('result-row-2')).toContainText(second)
    }
  })

  test('結束後自動切到結果頁；沒有組送出時顯示「本題無人作答」；可切換查看其他題', async ({ browser }) => {
    const t = await teacherContext(browser)
    const code = await createActivity(t)
    const s = await joinStudent(browser, code, '組長', 'g1')
    const q = questionApi(t, code)
    await q.open('q1')
    await s.page.getByTestId('answer-0').fill('CPU')
    await s.page.getByTestId('submit-btn').click()
    await expect(s.page.getByTestId('submitted-msg')).toBeVisible()
    await q.close('q1')
    await expect(s.page.getByTestId('result-title')).toHaveText('第 1 題結果')
    await expect(s.page.getByTestId('result-row-1')).toContainText('CPU')
    await expect(s.page.getByTestId('result-row-1')).toContainText('搶答成功')

    await q.open('q2')
    await expect(s.page.getByTestId('answer-card')).toBeVisible()
    await q.close('q2')
    await expect(s.page.getByTestId('result-title')).toHaveText('第 2 題結果')
    await expect(s.page.getByTestId('no-answers')).toHaveText('本題無人作答')
    await s.page.getByTestId('result-tab-1').click()
    await expect(s.page.getByTestId('result-title')).toHaveText('第 1 題結果')
  })

  test('重開：清掉舊結果與已送出狀態，回到作答，送出帶新的 round', async ({ browser }) => {
    const t = await teacherContext(browser)
    const code = await createActivity(t)
    const s = await joinStudent(browser, code, '組長', 'g1')
    const q = questionApi(t, code)
    await q.open('q1')
    await s.page.getByTestId('answer-0').fill('舊答案')
    await s.page.getByTestId('submit-btn').click()
    await expect(s.page.getByTestId('submitted-msg')).toBeVisible()
    await q.close('q1')
    await expect(s.page.getByTestId('result-card')).toBeVisible()

    await q.reopen('q1')
    await expect(s.page.getByTestId('answer-card')).toBeVisible()
    await expect(s.page.getByTestId('submitted-msg')).toHaveCount(0)
    await expect(s.page.getByTestId('result-card')).toHaveCount(0)
    await expect(s.page.getByTestId('answer-0')).toHaveValue('')
    await s.page.getByTestId('answer-0').fill('新答案')
    const req = s.page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/submissions'))
    await s.page.getByTestId('submit-btn').click()
    expect((await req).postDataJSON()).toMatchObject({ round: 2, answers: [{ text: '新答案' }] })
    await expect(s.page.getByTestId('submitted-msg')).toBeVisible()

    // 再次結束：學生與老師看到的結果都被新一輪覆蓋，舊答案不再出現
    await q.close('q1')
    await expect(s.page.getByTestId('result-row-1')).toContainText('新答案')
    await expect(s.page.getByTestId('result-card')).not.toContainText('舊答案')
    const board = await openBoard(t, code)
    await expect(board.getByTestId('result-1')).toContainText('新答案')
    await expect(board.getByTestId('result-1')).not.toContainText('舊答案')
    await expect(board.getByTestId('result-1').locator('tbody tr')).toHaveCount(1)
  })
})
