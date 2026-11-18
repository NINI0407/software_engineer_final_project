import crypto from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// @ts-expect-error mock 是 JS 模組，沒有型別宣告
import { createMockServer } from '../../../mock/server.js'
// @ts-expect-error mock 是 JS 模組，沒有型別宣告
import { agent, createActivity, until } from '../../../mock/testkit.js'
import { openSocket } from './socket'
import type { Snapshot } from './types'

const PASSWORD = crypto.randomBytes(9).toString('base64url')
let mock: { listen: (p: number) => Promise<number>; close: () => Promise<void> }
let base = ''

beforeAll(async () => {
  mock = createMockServer({ teacherPassword: PASSWORD, testHooks: true })
  base = `http://localhost:${await mock.listen(0)}`
})
afterAll(() => mock.close())

describe('openSocket（對 mock 連線）', () => {
  it('connected 狀態正確變化，且連線與重連後都會收到新的快照', async () => {
    const t = agent(base)
    await t.post('/api/teacher/login', { password: PASSWORD })
    const code = (await createActivity(t, 'mock-single', 2)).activity.code
    const s = agent(base)
    await s.post(`/api/activities/${code}/join`, { nickname: '小明' })

    const states: boolean[] = []
    const snaps: Snapshot[] = []
    const live = openSocket(
      code,
      'student',
      { onConnectedChange: (c) => states.push(c), onSnapshot: (x) => snaps.push(x) },
      { url: base, transports: ['websocket'], extraHeaders: { cookie: s.cookieHeader() } },
    )
    try {
      await until(() => states.at(-1) === true && snaps.length > 0, 3000)
      const before = snaps.length

      await fetch(`${base}/__mock/disconnect`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      await until(() => states.includes(false), 3000)
      await until(() => states.at(-1) === true && snaps.length > before, 5000)
      expect(states).toEqual([true, false, true])
      expect(snaps.at(-1)!.activity.code).toBe(code)
    } finally {
      live.close()
    }
  })

  it('伺服器拒絕連線時會稍後重試', async () => {
    const t = agent(base)
    await t.post('/api/teacher/login', { password: PASSWORD })
    const code = (await createActivity(t, 'mock-single', 2)).activity.code
    const states: boolean[] = []
    const live = openSocket(
      code,
      'teacher',
      { onConnectedChange: (c) => states.push(c), onSnapshot: () => {} },
      { url: base, transports: ['websocket'], extraHeaders: { cookie: t.cookieHeader() } },
    )
    try {
      await until(() => states.at(-1) === true, 3000)
      await fetch(`${base}/__mock/disconnect`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, role: 'teacher', blockMs: 800 }),
      })
      await until(() => states.at(-1) === false, 3000)
      await until(() => states.at(-1) === true, 6000)
    } finally {
      live.close()
    }
  })
})
