import { expect, test, type Page } from '@playwright/test'
import { createActivity, joinStudent, questionApi, reset, teacherContext } from './helpers'

test.beforeEach(reset)

/** 收集頁面從 Socket.IO 收到的所有原始訊息 */
function collectFrames(page: Page) {
  const frames: { at: number; text: string }[] = []
  page.on('websocket', (ws) => {
    ws.on('framereceived', (f) => frames.push({ at: Date.now(), text: String(f.payload) }))
  })
  return frames
}

async function setup(browser: Parameters<typeof teacherContext>[0]) {
  const t = await teacherContext(browser)
  const code = await createActivity(t, 'group')
  const a = await joinStudent(browser, code, '小明', 'g1')
  const b = await joinStudent(browser, code, '小華', 'g1')
  return { t, code, a, b }
}

test('同組看到草稿與「某某正在編輯」', async ({ browser }) => {
  const { t, code, a, b } = await setup(browser)
  await questionApi(t, code).open('q1')
  await a.page.getByTestId('answer-0').fill('CPU')
  await expect(b.page.getByTestId('answer-0')).toHaveValue('CPU')
  await expect(b.page.getByTestId('editing-0')).toHaveText(/小明\s*正在編輯/)
  await expect(b.page.getByTestId('answer-1')).toHaveValue('')
})

test('打字時不被遠端更新覆寫：游標與內容都不跳動，停止後以後端最新版本為準', async ({ browser }) => {
  const { t, code, a, b } = await setup(browser)
  const bFrames = collectFrames(b.page)
  await b.page.reload() // 讓新的 WebSocket 連線被記錄
  await expect(b.page.getByTestId('conn-status')).toHaveText('已連線')
  await questionApi(t, code).open('q1')
  await expect(b.page.getByTestId('answer-0')).toBeVisible()

  // 在小華的頁面每 15ms 記錄一次輸入框的內容與游標位置
  await b.page.evaluate(() => {
    const el = document.querySelector<HTMLTextAreaElement>('[data-testid="answer-0"]')!
    const log: { v: string; s: number }[] = []
    ;(window as unknown as { __log: typeof log }).__log = log
    const id = setInterval(() => log.push({ v: el.value, s: el.selectionStart }), 15)
    ;(window as unknown as { __stop: () => void }).__stop = () => clearInterval(id)
  })

  const box = b.page.getByTestId('answer-0')
  await box.click()
  const typed = 'abcdefghij'
  const typing = box.pressSequentially(typed, { delay: 120 }) // 約 1.2 秒持續輸入
  await a.page.waitForTimeout(150)
  await a.page.getByTestId('answer-0').fill('REMOTE') // 300ms 後送出 → 在小華打字中途到達
  await typing
  const typingEnded = Date.now()
  await b.page.evaluate(() => (window as unknown as { __stop: () => void }).__stop())

  // 小華確實在打字期間收到了小明的遠端更新
  const remoteAt = bFrames.find((f) => f.text.includes('draft:updated') && f.text.includes('REMOTE'))?.at
  expect(remoteAt).toBeDefined()
  expect(remoteAt!).toBeLessThan(typingEnded)

  // 打字期間每一次取樣：內容都是已輸入內容的前綴，游標都在結尾（沒有跳動、沒有被覆寫）
  const log = await b.page.evaluate(() => (window as unknown as { __log: { v: string; s: number }[] }).__log)
  expect(log.length).toBeGreaterThan(20)
  for (const { v, s } of log) {
    expect(typed.startsWith(v)).toBe(true)
    expect(s).toBe(v.length)
  }
  await expect(box).toHaveValue(typed)

  // 停止輸入後送出；小華較晚寫入，雙方都以後端最新廣播的版本為準
  await expect(a.page.getByTestId('answer-0')).toHaveValue(typed)
  await expect(box).toHaveValue(typed)
})

test('他組收不到草稿', async ({ browser }) => {
  const { t, code, a } = await setup(browser)
  const c = await joinStudent(browser, code, '小強', 'g2')
  const cFrames = collectFrames(c.page)
  await c.page.reload()
  await questionApi(t, code).open('q1')
  await expect(c.page.getByTestId('answer-0')).toBeVisible()
  await a.page.getByTestId('answer-0').fill('第一組的草稿')
  await a.page.waitForTimeout(800)
  expect(cFrames.length).toBeGreaterThan(0)
  expect(cFrames.some((f) => f.text.includes('第一組的草稿'))).toBe(false)
  await expect(c.page.getByTestId('answer-0')).toHaveValue('')
  const state = await c.page.evaluate(() => document.body.innerText)
  expect(state).not.toContain('第一組的草稿')
})
