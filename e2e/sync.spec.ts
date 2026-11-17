import { expect, test, type Page } from '@playwright/test'
import {
  createActivity,
  hook,
  joinStudent,
  openBoard,
  questionApi,
  reset,
  submitViaApi,
  teacherContext,
} from './helpers'

test.beforeEach(reset)

function collectFrames(page: Page) {
  const received: string[] = []
  const sent: string[] = []
  page.on('websocket', (ws) => {
    ws.on('framereceived', (f) => received.push(String(f.payload)))
    ws.on('framesent', (f) => sent.push(String(f.payload)))
  })
  return { received, sent }
}

test('8.1 1 位老師 + 3 位學生：開始、送出、結束、重開都在 2 秒內同步', async ({ browser }) => {
  const t = await teacherContext(browser)
  const code = await createActivity(t)
  const board = await openBoard(t, code)
  const a = await joinStudent(browser, code, 'A', 'g1')
  const b = await joinStudent(browser, code, 'B', 'g1')
  const c = await joinStudent(browser, code, 'C', 'g2')
  const students = [a.page, b.page, c.page]
  const row1 = board.getByTestId('q-row-1')

  // 開始
  await row1.getByTestId('start-btn').click()
  await expect(row1.getByTestId('q-status')).toHaveText('進行中')
  for (const p of students) await expect(p.getByTestId('question-title')).toHaveText('第 1 題')

  // 送出
  await a.page.getByTestId('answer-0').fill('CPU')
  await a.page.getByTestId('submit-btn').click()
  await expect(a.page.getByTestId('submitted-msg')).toBeVisible()
  await expect(b.page.getByTestId('submitted-msg')).toBeVisible()
  await expect(c.page.getByTestId('answer-card')).toBeVisible()
  await expect(c.page.getByTestId('submitted-msg')).toHaveCount(0)
  await expect(board.getByTestId('group-g1').getByTestId('group-status')).toHaveText('已送出')

  // 結束
  await row1.getByTestId('close-btn').click()
  await expect(row1.getByTestId('q-status')).toHaveText('已結束')
  for (const p of students) {
    await expect(p.getByTestId('result-title')).toHaveText('第 1 題結果')
    await expect(p.getByTestId('result-row-1')).toContainText('第 1 組')
  }
  await expect(board.getByTestId('result-1')).toContainText('第 1 組')

  // 重開
  await row1.getByTestId('reopen-btn').click()
  await expect(row1.getByTestId('q-status')).toHaveText('進行中')
  for (const p of students) {
    await expect(p.getByTestId('question-title')).toHaveText('第 1 題')
    await expect(p.getByTestId('submitted-msg')).toHaveCount(0)
    await expect(p.getByTestId('result-card')).toHaveCount(0)
  }
})

test.describe('8.2 斷線、重連與版本跳號', () => {
  test('斷線時顯示重新連線中並停用操作，恢復後可以繼續', async ({ browser }) => {
    const t = await teacherContext(browser)
    const code = await createActivity(t)
    const s = await joinStudent(browser, code, '組長', 'g1')
    await questionApi(t, code).open('q1')
    await s.page.getByTestId('answer-0').fill('CPU')
    await expect(s.page.getByTestId('submit-btn')).toBeEnabled()

    await hook('disconnect', { code, clientId: s.clientId, blockMs: 1500 })
    await expect(s.page.getByTestId('conn-status')).toHaveText('重新連線中…')
    await expect(s.page.getByTestId('answer-0')).toBeDisabled()
    await expect(s.page.getByTestId('submit-btn')).toBeDisabled()

    await expect(s.page.getByTestId('conn-status')).toHaveText('已連線', { timeout: 5000 })
    await expect(s.page.getByTestId('submit-btn')).toBeEnabled()
    await expect(s.page.getByTestId('answer-0')).toHaveValue('CPU')
  })

  test('老師斷線時控制按鈕全部停用，恢復後可以再操作', async ({ browser }) => {
    const t = await teacherContext(browser)
    const code = await createActivity(t)
    const board = await openBoard(t, code)
    const row1 = board.getByTestId('q-row-1')
    await expect(row1.getByTestId('start-btn')).toBeEnabled()
    await expect(board.getByTestId('next-btn')).toBeEnabled()

    await hook('disconnect', { code, role: 'teacher', blockMs: 1500 })
    await expect(board.getByTestId('conn-status')).toHaveText('重新連線中…')
    await expect(row1.getByTestId('start-btn')).toBeDisabled()
    await expect(board.getByTestId('next-btn')).toBeDisabled()

    await expect(board.getByTestId('conn-status')).toHaveText('已連線', { timeout: 5000 })
    await row1.getByTestId('start-btn').click()
    await expect(row1.getByTestId('q-status')).toHaveText('進行中')
  })

  test('斷線期間題目結束：重連後直接顯示結果頁', async ({ browser }) => {
    const t = await teacherContext(browser)
    const code = await createActivity(t)
    const s = await joinStudent(browser, code, '組長', 'g1')
    const q = questionApi(t, code)
    await q.open('q2')
    await expect(s.page.getByTestId('question-title')).toHaveText('第 2 題')

    await hook('disconnect', { code, clientId: s.clientId, blockMs: 1500 })
    await expect(s.page.getByTestId('conn-status')).toHaveText('重新連線中…')
    await q.close('q2')
    await expect(s.page.getByTestId('result-title')).toHaveText('第 2 題結果', { timeout: 5000 })
    await expect(s.page.getByTestId('conn-status')).toHaveText('已連線')
  })

  test('已送出的組長重新整理：恢復為已送出畫面，組長身分不變', async ({ browser }) => {
    const t = await teacherContext(browser)
    const code = await createActivity(t)
    const s = await joinStudent(browser, code, '組長', 'g1')
    await questionApi(t, code).open('q1')
    await s.page.getByTestId('answer-0').fill('CPU')
    await s.page.getByTestId('submit-btn').click()
    await expect(s.page.getByTestId('submitted-msg')).toBeVisible()
    await s.page.reload()
    await expect(s.page.getByTestId('submitted-msg')).toBeVisible()
    await expect(s.page.getByTestId('me-leader')).toBeVisible()
    await expect(s.page.getByTestId('answer-0')).toHaveValue('CPU')
  })

  test('版本跳號：套用快照並送出 snapshot:request 重新同步', async ({ browser }) => {
    const t = await teacherContext(browser)
    const code = await createActivity(t)
    const s = await joinStudent(browser, code, '組長', 'g1')
    const frames = collectFrames(s.page)
    await s.page.reload()
    await expect(s.page.getByTestId('conn-status')).toHaveText('已連線')
    await expect(s.page.getByTestId('waiting')).toBeVisible()
    await s.page.waitForTimeout(200)
    const requestsBefore = frames.sent.filter((x) => x.includes('snapshot:request')).length

    await hook('skipVersions', { count: 3 })
    await questionApi(t, code).open('q1')
    await expect(s.page.getByTestId('question-title')).toHaveText('第 1 題')
    await expect
      .poll(() => frames.sent.filter((x) => x.includes('snapshot:request')).length)
      .toBe(requestsBefore + 1)
  })
})

test('8.3 進行中看不到他組資料；結束後才出現', async ({ browser }) => {
  const t = await teacherContext(browser)
  const code = await createActivity(t)
  const g1 = await joinStudent(browser, code, '第一組', 'g1')
  const g2 = await joinStudent(browser, code, '第二組', 'g2', { open: false })
  const frames = collectFrames(g1.page)
  const consoleLines: string[] = []
  g1.page.on('console', (m) => consoleLines.push(m.text()))
  await g1.page.reload()
  await expect(g1.page.getByTestId('conn-status')).toHaveText('已連線')

  await questionApi(t, code).open('q1')
  await expect(g1.page.getByTestId('answer-card')).toBeVisible()
  expect((await submitViaApi(g2, code, 'q1', 1, ['G2_PRIVATE_ANSWER'])).status()).toBe(201)
  // 第二組送出後，後端會推送新快照；確認第一組也收到了這次推送，但內容沒有第二組的資料
  await expect.poll(() => frames.received.filter((x) => x.includes('"snapshot"')).length).toBeGreaterThan(1)
  await g1.page.waitForTimeout(300)

  // 前端收到的所有資料（store 只會從這些資料建立，且依 F6 不掛到 window 上）
  const all = frames.received.join('\n')
  expect(all).not.toContain('G2_PRIVATE_ANSWER')
  expect(all).not.toMatch(/"rank"/)
  expect(all).not.toContain('"groups":[{"group"') // 沒有老師端的各組狀態
  expect(consoleLines.join('\n')).not.toContain('G2_PRIVATE_ANSWER')
  const storage = await g1.page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
  expect(storage).not.toContain('G2_PRIVATE_ANSWER')
  await expect(g1.page.locator('body')).not.toContainText('G2_PRIVATE_ANSWER')
  await expect(g1.page.locator('body')).not.toContainText(/第 \d+ 名|順位/)

  await questionApi(t, code).close('q1')
  await expect(g1.page.getByTestId('result-row-1')).toContainText('G2_PRIVATE_ANSWER')
  expect(frames.received.join('\n')).toContain('G2_PRIVATE_ANSWER')
})
