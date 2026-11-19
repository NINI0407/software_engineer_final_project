// 正式後端 REST 的整合測試（change build-quiz-backend，task 4.2）。
// 移植 mock/server.test.js「3.2 老師 REST」「3.3 學生 REST」中不依賴 /__mock 鉤子的情境
// （「3.1 啟動與密碼」的子程序啟動由 server/index.test.js 涵蓋；匯入的情境由 sheets-import.test.js 涵蓋），
// 並涵蓋 spec quiz-backend 的 REST Scenario。測試名稱對應 spec Scenario。

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { singleSpreadsheet } from './sheets/fixtures/single.js'
import { groupSpreadsheet } from './sheets/fixtures/group.js'
import { agent, sheetUrl, startServer, until } from './testing/testkit.js'

const spreadsheets = () => ({ single: singleSpreadsheet(), group: groupSpreadsheet() })

/** 每個 describe 啟動自己的伺服器，結束時關閉；每個測試結束時關閉連線 */
function useServer() {
  const ctx = {}
  beforeAll(async () => {
    ctx.srv = await startServer({ spreadsheets: spreadsheets() })
    ctx.base = ctx.srv.base
  })
  afterEach(() => ctx.srv.closeSockets())
  afterAll(() => ctx.srv.close())
  return ctx
}

const two = (a, b) => [
  { blankId: 'q1b1', text: a },
  { blankId: 'q1b2', text: b },
]
const one = (qid, text) => [{ blankId: `${qid}b1`, text }]

/** 取得某個 Cookie 的 Set-Cookie 標頭 */
const setCookieOf = (res, name) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))

/** 共用的操作：題目控制、送出、取得快照 */
function ops(t, code) {
  return {
    q: (id, action) => t.post(`/api/activities/${code}/questions/${id}/${action}`),
    submit: (s, id, round, answers) =>
      s.post(`/api/activities/${code}/questions/${id}/submissions`, { round, answers }),
    teacherSnap: async () => (await t.get(`/api/activities/${code}/teacher`)).body,
    studentSnap: async (s) => (await s.get(`/api/activities/${code}/student`)).body,
    meOf: async (s) => (await s.get(`/api/activities/${code}/student`)).body.me,
  }
}

// ---------- 依介面約定回應 ----------

describe('依介面約定回應', () => {
  const ctx = useServer()

  it('前端改接正式後端：從老師登入到下載 CSV，每個請求都得到約定中的成功回應', async () => {
    const { srv } = ctx
    const t = agent(ctx.base)
    expect((await t.post('/api/teacher/login', { password: srv.password })).status).toBe(204)
    expect((await t.get('/api/teacher/session')).body).toEqual({ authenticated: true })

    const imp = await t.post('/api/sheets/import', { sheetUrl: sheetUrl('group') })
    expect(imp.status).toBe(200)
    expect(imp.body.questions).toHaveLength(4)

    const created = await t.post('/api/activities', { importId: imp.body.importId, groupCount: 2 })
    expect(created.status).toBe(201)
    const code = created.body.activity.code
    const { q, submit } = ops(t, code)

    const s1 = await srv.student(code, '小明', 'g1')
    const s2 = await srv.student(code, '小華', 'g2')
    expect((await t.get(`/api/activities/${code}/teacher`)).status).toBe(200)

    expect((await q('q1', 'open')).status).toBe(204)
    expect((await submit(s2, 'q1', 1, two('CPU', '作業系統'))).status).toBe(201)
    expect((await submit(s1, 'q1', 1, two('GPU', '應用程式'))).status).toBe(201)
    expect((await q('q1', 'close')).status).toBe(204)

    const before = (await t.get(`/api/activities/${code}/teacher`)).body
    const exported = await t.post(`/api/activities/${code}/export-to-sheet`, { basedOnVersion: before.version })
    expect(exported.status).toBe(200)
    expect(exported.body).toEqual({
      sheetUrl: before.sheet.url,
      writtenCells: 2,
      skippedQuestions: [2, 3, 4],
      exportedAt: expect.any(String),
    })
    const after = (await t.get(`/api/activities/${code}/teacher`)).body
    expect(after.sheet.lastExportedAt).toBe(exported.body.exportedAt)

    const csv = await t.get(`/api/activities/${code}/export.csv`)
    expect(csv.status).toBe(200)
    expect(csv.text.replace(/^﻿/, '').split('\r\n').slice(0, 3)).toEqual([
      '題號,組別,答案,搶答順位',
      '1,第 2 組,（1）CPU；（2）作業系統,1',
      '1,第 1 組,（1）GPU；（2）應用程式,2',
    ])
  })

  it('已移除的路徑：POST /api/uploads、GET export.xlsx、PUT groups/g1/leader 回應 404', async () => {
    const { srv } = ctx
    const t = await srv.teacher()
    const { activity: a } = await srv.createActivity(t, 'single')
    const s1 = await srv.student(a.code, '小明', 'g1')
    const s2 = await srv.student(a.code, '小華', 'g1')
    for (const code of ['ABC234', a.code]) {
      expect((await t.post('/api/uploads', {})).status).toBe(404)
      expect((await t.get(`/api/activities/${code}/export.xlsx`)).status).toBe(404)
      const moved = await t.put(`/api/activities/${code}/groups/g1/leader`, { clientId: s2.clientId })
      expect(moved.status).toBe(404)
      expect(moved.body.error.code).toEqual(expect.any(String))
    }
    // 組長不變
    const { meOf } = ops(t, a.code)
    expect((await meOf(s1)).isLeader).toBe(true)
    expect((await meOf(s2)).isLeader).toBe(false)
  })

  it('錯誤格式：組員（不是組長）送出時回應 403 { error: { code: NOT_LEADER, message } }', async () => {
    const { srv } = ctx
    const t = await srv.teacher()
    const { activity: a } = await srv.createActivity(t, 'group')
    await srv.student(a.code, '小明', 'g1')
    const member = await srv.student(a.code, '小華', 'g1')
    const { q, submit } = ops(t, a.code)
    await q('q1', 'open')
    const res = await submit(member, 'q1', 1, two('a', 'b'))
    expect(res.status).toBe(403)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(res.body).toEqual({ error: { code: 'NOT_LEADER', message: expect.any(String) } })
  })

  it('請求內容不是有效的 JSON 時回應 400 錯誤格式', async () => {
    const res = await fetch(`${ctx.base}/api/teacher/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad json',
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { code: expect.any(String), message: expect.any(String) } })
  })
})

// ---------- 教師密碼驗證 ----------

describe('教師密碼驗證', () => {
  const ctx = useServer()

  it('密碼正確：回應 204，設定 httpOnly 的 teacher_session，之後 session 為 authenticated', async () => {
    const t = agent(ctx.base)
    expect((await t.get('/api/teacher/session')).body).toEqual({ authenticated: false })
    const res = await t.post('/api/teacher/login', { password: ctx.srv.password })
    expect(res.status).toBe(204)
    const cookie = setCookieOf(res, 'teacher_session')
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
    expect(cookie).toMatch(/Path=\//)
    expect(cookie).not.toMatch(/Secure/i)
    expect((await t.get('/api/teacher/session')).body).toEqual({ authenticated: true })
  })

  it('密碼錯誤：回應 401 INVALID_PASSWORD，不設定 Cookie', async () => {
    const t = agent(ctx.base)
    for (const body of [{ password: 'wrong' }, { password: `${ctx.srv.password}x` }, { password: 123 }, {}]) {
      const res = await t.post('/api/teacher/login', body)
      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('INVALID_PASSWORD')
      expect(setCookieOf(res, 'teacher_session')).toBeUndefined()
    }
    expect((await t.get('/api/teacher/session')).body).toEqual({ authenticated: false })
  })

  it('未登入呼叫老師路徑：匯入、建立活動、題目控制、快照、CSV、寫回都回應 401', async () => {
    const { srv } = ctx
    const t = await srv.teacher()
    const { activity: a } = await srv.createActivity(t, 'single')
    const anon = agent(ctx.base)
    const forged = agent(ctx.base)
    forged.jar.set('teacher_session', 'f'.repeat(64))
    for (const who of [anon, forged]) {
      expect((await who.post('/api/sheets/import', { sheetUrl: sheetUrl('single') })).status).toBe(401)
      expect((await who.post('/api/activities', { importId: 'x', groupCount: 3 })).status).toBe(401)
      for (const code of ['ABC234', a.code]) {
        for (const action of ['open', 'close', 'reopen']) {
          const res = await who.post(`/api/activities/${code}/questions/q1/${action}`)
          expect(res.status).toBe(401)
          expect(res.body.error.code).toBe('UNAUTHORIZED')
        }
        expect((await who.get(`/api/activities/${code}/teacher`)).status).toBe(401)
        expect((await who.get(`/api/activities/${code}/export.csv`)).status).toBe(401)
        expect((await who.post(`/api/activities/${code}/export-to-sheet`, { basedOnVersion: 1 })).status).toBe(401)
      }
    }
    // 狀態沒有被改變
    expect((await t.get(`/api/activities/${a.code}/teacher`)).body.questions[0].status).toBe('idle')
  })

  it('登出：原本的 teacher_session 失效，之後用它呼叫老師路徑都回應 401', async () => {
    const { srv } = ctx
    const t = await srv.teacher()
    const { activity: a } = await srv.createActivity(t, 'single')
    const token = t.jar.get('teacher_session')
    expect((await t.post('/api/teacher/logout')).status).toBe(204)
    expect((await t.get('/api/teacher/session')).body).toEqual({ authenticated: false })
    // 另一個用戶端帶著舊的 Cookie 呼叫
    const old = agent(ctx.base)
    old.jar.set('teacher_session', token)
    expect((await old.get('/api/teacher/session')).body).toEqual({ authenticated: false })
    expect((await old.get(`/api/activities/${a.code}/teacher`)).status).toBe(401)
    expect((await old.post(`/api/activities/${a.code}/questions/q1/open`)).status).toBe(401)
    expect((await old.post('/api/sheets/import', { sheetUrl: sheetUrl('single') })).status).toBe(401)
  })

  it('登入兩次得到不同的 session，登出其中一個不影響另一個', async () => {
    const { srv } = ctx
    const t1 = await srv.teacher()
    const t2 = await srv.teacher()
    expect(t1.jar.get('teacher_session')).not.toBe(t2.jar.get('teacher_session'))
    await t1.post('/api/teacher/logout')
    expect((await t2.get('/api/teacher/session')).body).toEqual({ authenticated: true })
  })
})

// ---------- 建立活動 ----------

describe('建立活動', () => {
  const ctx = useServer()

  it('建立成功：6 題的匯入結果、組數 4，回應 201 與老師快照', async () => {
    const t = await ctx.srv.teacher()
    const imp = await t.post('/api/sheets/import', { sheetUrl: sheetUrl('single') })
    const res = await t.post('/api/activities', { importId: imp.body.importId, groupCount: 4 })
    expect(res.status).toBe(201)
    const snap = res.body
    expect(snap.activity.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
    expect(snap.activity.groups).toEqual([1, 2, 3, 4].map((n) => ({ id: `g${n}`, name: `第 ${n} 組` })))
    expect(snap.questions).toHaveLength(6)
    for (const q of snap.questions) expect(q).toMatchObject({ status: 'idle', round: 1 })
    expect(snap.questions.map((q) => q.blanks[0].cellRef)).toEqual(
      [5, 7, 9, 11, 13, 15].map((r) => `學習單!G${r}`),
    )
    expect(snap.questions[0].blanks[0]).toEqual({ id: 'q1b1', label: null, cellRef: '學習單!G5' })
    expect(snap.sheet).toEqual({
      spreadsheetTitle: '軟工期末專案_單題_範例',
      worksheetTitle: '學習單',
      url: imp.body.sheetUrl,
      lastExportedAt: null,
    })
    expect(snap.activity).not.toHaveProperty('sheet')
    expect(snap).toMatchObject({ currentQuestionId: null, groupLocked: false, results: [] })
    expect(snap.groups.map((g) => g.current)).toEqual([null, null, null, null])
    // 建立後可以再取得同樣的老師快照
    const again = await t.get(`/api/activities/${snap.activity.code}/teacher`)
    expect(again.body).toEqual(snap)
    // 代號不分大小寫
    expect((await t.get(`/api/activities/${snap.activity.code.toLowerCase()}/teacher`)).status).toBe(200)
  })

  it('題組的子填空完全來自匯入結果', async () => {
    const t = await ctx.srv.teacher()
    const snap = await ctx.srv.createActivity(t, 'group', 3)
    expect(snap.questions).toHaveLength(4)
    expect(snap.questions[0].blanks).toEqual([
      { id: 'q1b1', label: '（1）', cellRef: '學習單!H5' },
      { id: 'q1b2', label: '（2）', cellRef: '學習單!H6' },
    ])
    expect(snap.questions.slice(2).map((q) => q.blanks[0].cellRef)).toEqual(['學習單!G11', '學習單!G13'])
  })

  it('組數不合法：組數為 1、21 或 2.5 時回應 400 INVALID_GROUP_COUNT，沒有建立活動', async () => {
    const t = await ctx.srv.teacher()
    const imp = await t.post('/api/sheets/import', { sheetUrl: sheetUrl('single') })
    const count = ctx.srv.server.store.activities.size
    for (const groupCount of [1, 21, 2.5, '4', undefined]) {
      const res = await t.post('/api/activities', { importId: imp.body.importId, groupCount })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('INVALID_GROUP_COUNT')
    }
    expect(ctx.srv.server.store.activities.size).toBe(count)
  })

  it('匯入結果不存在：回應 404 IMPORT_NOT_FOUND', async () => {
    const t = await ctx.srv.teacher()
    for (const importId of ['nope', undefined, 123]) {
      const res = await t.post('/api/activities', { importId, groupCount: 3 })
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('IMPORT_NOT_FOUND')
    }
  })

  it('活動不存在：取得老師快照回應 404 ACTIVITY_NOT_FOUND', async () => {
    const t = await ctx.srv.teacher()
    const res = await t.get('/api/activities/ZZZZZZ/teacher')
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('ACTIVITY_NOT_FOUND')
  })
})

// ---------- 學生加入與身分 ----------

describe('學生加入與身分', () => {
  const ctx = useServer()
  let t, code
  beforeEach(async () => {
    t = await ctx.srv.teacher()
    code = (await ctx.srv.createActivity(t, 'group')).activity.code
  })

  it('第一次加入：回應 200 與學生快照，設定 httpOnly 的 client_id，me.groupId 為 null', async () => {
    const s = agent(ctx.base)
    const res = await s.post(`/api/activities/${code}/join`, { nickname: '  小明 ' })
    expect(res.status).toBe(200)
    const cookie = setCookieOf(res, 'client_id')
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
    expect(s.jar.get('client_id')).toMatch(/^[a-f0-9]{24}$/)
    expect(res.body.me).toEqual({
      clientId: s.jar.get('client_id'),
      nickname: '小明',
      groupId: null,
      isLeader: false,
    })
    expect(res.body.myGroup).toBeNull()
    expect(res.body.questions[0].blanks[0]).toEqual({ id: 'q1b1', label: '（1）' })
  })

  it('重新整理後恢復：已選第 2 組的學生帶同一個 client_id 取得快照，暱稱與組別相同', async () => {
    const s = await ctx.srv.student(code, '小明', 'g2', { online: false })
    const { studentSnap } = ops(t, code)
    const snap = await studentSnap(s)
    expect(snap.me).toMatchObject({ clientId: s.clientId, nickname: '小明', groupId: 'g2' })
    // 再次加入：不發新的 Cookie，組別保留，只更新暱稱
    const again = await s.post(`/api/activities/${code}/join`, { nickname: '小明明' })
    expect(again.status).toBe(200)
    expect(setCookieOf(again, 'client_id')).toBeUndefined()
    expect(again.body.me).toMatchObject({ clientId: s.clientId, nickname: '小明明', groupId: 'g2' })
    expect((await t.get(`/api/activities/${code}/teacher`)).body.groups[1].members).toHaveLength(1)
  })

  it('沒有加入就取得快照：沒有 client_id，或 client_id 不屬於這個活動時回應 401 NOT_JOINED', async () => {
    const anon = agent(ctx.base)
    const res = await anon.get(`/api/activities/${code}/student`)
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('NOT_JOINED')

    // 加入另一個活動的學生
    const other = (await ctx.srv.createActivity(t, 'single')).activity.code
    const s = await ctx.srv.student(other, '小明', null, { online: false })
    const wrong = await s.get(`/api/activities/${code}/student`)
    expect([wrong.status, wrong.body.error.code]).toEqual([401, 'NOT_JOINED'])
    // 選組與送出也一樣
    expect((await s.put(`/api/activities/${code}/me/group`, { groupId: 'g1' })).body.error.code).toBe('NOT_JOINED')
    const sub = await s.post(`/api/activities/${code}/questions/q1/submissions`, { round: 1, answers: [] })
    expect([sub.status, sub.body.error.code]).toEqual([401, 'NOT_JOINED'])
  })

  it('暱稱不合法：只有空白或超過 20 個字時回應 400 INVALID_NICKNAME', async () => {
    const s = agent(ctx.base)
    for (const nickname of ['   ', '　\n', '字'.repeat(21), '', undefined, 42]) {
      const res = await s.post(`/api/activities/${code}/join`, { nickname })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('INVALID_NICKNAME')
    }
    expect(s.jar.has('client_id')).toBe(false)
    expect((await s.post(`/api/activities/${code}/join`, { nickname: '字'.repeat(20) })).status).toBe(200)
  })

  it('活動代號不存在：回應 404 ACTIVITY_NOT_FOUND', async () => {
    const s = agent(ctx.base)
    const res = await s.post('/api/activities/ZZZZZZ/join', { nickname: '小明' })
    expect([res.status, res.body.error.code]).toEqual([404, 'ACTIVITY_NOT_FOUND'])
    expect((await s.get('/api/activities/ZZZZZZ/student')).body.error.code).toBe('ACTIVITY_NOT_FOUND')
  })

  it('學生快照不含任何試算表網址、標題或 cellRef', async () => {
    const s = await ctx.srv.student(code, '小明', 'g1', { online: false })
    const raw = (await s.get(`/api/activities/${code}/student`)).text
    for (const leak of ['docs.google.com', '軟工期末專案_題組_範例', '學習單', 'cellRef', 'sheet', '"row"', '"col"']) {
      expect(raw).not.toContain(leak)
    }
  })
})

// ---------- 選組與組別鎖定 ----------

describe('選組與組別鎖定', () => {
  const ctx = useServer()
  let t, code, o
  beforeEach(async () => {
    t = await ctx.srv.teacher()
    code = (await ctx.srv.createActivity(t, 'group')).activity.code
    o = ops(t, code)
  })
  const choose = (s, groupId) => s.put(`/api/activities/${code}/me/group`, { groupId })

  it('開始前換組：第 2 組的學生改選第 3 組，回應 200，快照中的組別為第 3 組', async () => {
    const s = await ctx.srv.student(code, '小明', 'g2')
    const res = await choose(s, 'g3')
    expect(res.status).toBe(200)
    expect(res.body.me.groupId).toBe('g3')
    expect((await o.meOf(s)).groupId).toBe('g3')
  })

  it('開始後換組：已有組別的學生換組時回應 409 GROUP_LOCKED，組別不變', async () => {
    const s = await ctx.srv.student(code, '小明', 'g2')
    await o.q('q1', 'open')
    const res = await choose(s, 'g1')
    expect([res.status, res.body.error.code]).toEqual([409, 'GROUP_LOCKED'])
    expect((await o.meOf(s)).groupId).toBe('g2')
    // 重選同一組不算換組
    expect((await choose(s, 'g2')).status).toBe(200)
  })

  it('開始後才加入：還沒有組別的學生選第 1 組回應 200，之後再換組回應 409 GROUP_LOCKED', async () => {
    await o.q('q1', 'open')
    const late = await ctx.srv.student(code, '小華')
    const pick = await choose(late, 'g1')
    expect(pick.status).toBe(200)
    expect(pick.body.me).toMatchObject({ groupId: 'g1', isLeader: true })
    const again = await choose(late, 'g2')
    expect([again.status, again.body.error.code]).toEqual([409, 'GROUP_LOCKED'])
  })

  it('組別不存在：回應 400 INVALID_GROUP', async () => {
    const s = await ctx.srv.student(code, '小明', 'g1')
    for (const groupId of ['g9', '', null, undefined]) {
      const res = await choose(s, groupId)
      expect([res.status, res.body.error.code]).toEqual([400, 'INVALID_GROUP'])
    }
    expect((await o.meOf(s)).groupId).toBe('g1')
  })

  it('組長為最早加入該組的在線成員；換組時交接（移植 mock 3.3）', async () => {
    const a = await ctx.srv.student(code, 'A', 'g1')
    const b = await ctx.srv.student(code, 'B', 'g1')
    expect((await o.meOf(b)).isLeader).toBe(false)
    const moved = await choose(a, 'g2')
    expect(moved.body.me).toMatchObject({ groupId: 'g2', isLeader: true })
    expect((await o.meOf(b)).isLeader).toBe(true)
  })
})

// ---------- 題目狀態與輪次 ----------

describe('題目狀態與輪次', () => {
  const ctx = useServer()
  let t, code, o
  beforeEach(async () => {
    t = await ctx.srv.teacher()
    code = (await ctx.srv.createActivity(t, 'group')).activity.code
    o = ops(t, code)
  })

  it('開始與結束：兩次都回應 204，快照的狀態與 currentQuestionId 隨之改變', async () => {
    expect((await o.q('q1', 'open')).status).toBe(204)
    let snap = await o.teacherSnap()
    expect(snap.questions[0].status).toBe('open')
    expect(snap.currentQuestionId).toBe('q1')
    expect(snap.groupLocked).toBe(true)
    expect(snap.groups.map((g) => g.current)).toEqual([
      { status: 'idle', submission: null },
      { status: 'idle', submission: null },
      { status: 'idle', submission: null },
    ])
    expect((await o.q('q1', 'close')).status).toBe(204)
    snap = await o.teacherSnap()
    expect(snap.questions[0].status).toBe('closed')
    expect(snap.currentQuestionId).toBeNull()
  })

  it('已有題目進行中：開始第 2 題或重開第 3 題回應 409 ANOTHER_QUESTION_OPEN，狀態不變', async () => {
    await o.q('q3', 'open')
    await o.q('q3', 'close')
    await o.q('q1', 'open')
    const before = await o.teacherSnap()
    const another = await o.q('q2', 'open')
    expect([another.status, another.body.error.code]).toEqual([409, 'ANOTHER_QUESTION_OPEN'])
    const reopen = await o.q('q3', 'reopen')
    expect([reopen.status, reopen.body.error.code]).toEqual([409, 'ANOTHER_QUESTION_OPEN'])
    expect(await o.teacherSnap()).toEqual(before)
  })

  it('狀態不符：結束未開始的題目、重開進行中的題目回應 409 INVALID_STATE（移植 mock 3.2）', async () => {
    const expectState = async (id, action) => {
      const res = await o.q(id, action)
      expect([res.status, res.body.error.code]).toEqual([409, 'INVALID_STATE'])
    }
    await expectState('q1', 'close')
    expect((await o.q('q1', 'open')).status).toBe(204)
    await expectState('q1', 'open')
    await expectState('q1', 'reopen')
    expect((await o.q('q1', 'close')).status).toBe(204)
    await expectState('q1', 'close')
    await expectState('q1', 'open')
    expect((await o.q('q1', 'reopen')).status).toBe(204)
    expect((await o.teacherSnap()).questions[0]).toMatchObject({ status: 'open', round: 2 })
    await expectState('q2', 'reopen')
  })

  it('題目不存在：回應 404 QUESTION_NOT_FOUND', async () => {
    for (const action of ['open', 'close', 'reopen']) {
      const res = await o.q('q99', action)
      expect([res.status, res.body.error.code]).toEqual([404, 'QUESTION_NOT_FOUND'])
    }
  })

  it('重開：第 1 題已結束且有 2 組送出，重開後 round 為 2，提交與草稿被清除，results 不含第 1 題', async () => {
    const g1 = await ctx.srv.student(code, 'A', 'g1')
    const g2 = await ctx.srv.student(code, 'B', 'g2')
    await o.q('q1', 'open')
    g1.conn.socket.emit('draft:update', { questionId: 'q1', round: 1, blankId: 'q1b1', text: '草稿' })
    await until(() => g1.conn.drafts.length === 1)
    expect((await o.submit(g2, 'q1', 1, two('a', 'b'))).status).toBe(201)
    expect((await o.submit(g1, 'q1', 1, two('c', 'd'))).status).toBe(201)
    await o.q('q1', 'close')
    expect((await o.studentSnap(g1)).results.map((r) => r.questionId)).toEqual(['q1'])

    expect((await o.q('q1', 'reopen')).status).toBe(204)
    const snap = await o.teacherSnap()
    expect(snap.questions[0]).toMatchObject({ status: 'open', round: 2 })
    expect(snap.currentQuestionId).toBe('q1')
    expect(snap.results).toEqual([])
    expect(snap.groups.map((g) => g.current.status)).toEqual(['idle', 'idle', 'idle'])
    const mine = await o.studentSnap(g1)
    expect(mine.results).toEqual([])
    expect(mine.myGroup).toMatchObject({ drafts: [], submitted: false })
  })
})

// ---------- 送出答案的驗證 ----------

describe('送出答案的驗證', () => {
  const ctx = useServer()
  let t, code, o
  beforeEach(async () => {
    t = await ctx.srv.teacher()
    code = (await ctx.srv.createActivity(t, 'group')).activity.code
    o = ops(t, code)
  })

  const expectError = async (promise, status, errCode) => {
    const res = await promise
    expect([res.status, res.body?.error?.code]).toEqual([status, errCode])
  }

  it('送出的各種錯誤：QUESTION_NOT_OPEN、NOT_LEADER、BLANK_ANSWER、ANSWER_TOO_LONG、BLANKS_MISMATCH（移植 mock 3.3）', async () => {
    const leader = await ctx.srv.student(code, 'A', 'g1')
    const member = await ctx.srv.student(code, 'B', 'g1')
    const noGroup = await ctx.srv.student(code, 'C')
    await expectError(o.submit(leader, 'q1', 1, two('a', 'b')), 409, 'QUESTION_NOT_OPEN')
    await expectError(o.submit(leader, 'q99', 1, two('a', 'b')), 409, 'QUESTION_NOT_OPEN')
    await o.q('q1', 'open')
    await expectError(o.submit(member, 'q1', 1, two('a', 'b')), 403, 'NOT_LEADER')
    await expectError(o.submit(noGroup, 'q1', 1, two('a', 'b')), 403, 'NOT_LEADER')
    await expectError(o.submit(leader, 'q1', 1, two(' \n', 'b')), 400, 'BLANK_ANSWER')
    await expectError(o.submit(leader, 'q1', 1, two('字'.repeat(501), 'b')), 400, 'ANSWER_TOO_LONG')
    await expectError(o.submit(leader, 'q1', 1, [{ blankId: 'q1b1', text: 'a' }]), 400, 'BLANKS_MISMATCH')
    await expectError(o.submit(leader, 'q1', 1, 'not-an-array'), 400, 'BLANKS_MISMATCH')
    // 都沒有保存提交
    expect((await o.teacherSnap()).groups[0].current).toEqual({ status: 'idle', submission: null })
  })

  it('成功送出：回應 201 { submittedAt }，沒有順位；保存的答案是 trim 之後的內容', async () => {
    const leader = await ctx.srv.student(code, 'A', 'g1')
    await o.q('q1', 'open')
    const ok = await o.submit(leader, 'q1', 1, two(' CPU ', '　作業系統\n'))
    expect(ok.status).toBe(201)
    expect(Object.keys(ok.body)).toEqual(['submittedAt'])
    expect(new Date(ok.body.submittedAt).toISOString()).toBe(ok.body.submittedAt)
    const sub = (await o.teacherSnap()).groups[0].current.submission
    expect(sub).toEqual({ groupId: 'g1', answers: two('CPU', '作業系統'), rank: 1, submittedAt: ok.body.submittedAt })
    expect((await o.studentSnap(leader)).myGroup.submitted).toBe(true)
  })

  it('只有特殊空白：半形空白、換行、全形空白或零寬字元組成的答案回應 400 BLANK_ANSWER', async () => {
    const leader = await ctx.srv.student(code, 'A', 'g1')
    await o.q('q1', 'open')
    for (const text of [' ', '\n', '　', '​', '‌', '‍', '﻿', '　​ \n﻿']) {
      await expectError(o.submit(leader, 'q1', 1, two('CPU', text)), 400, 'BLANK_ANSWER')
    }
    expect((await o.teacherSnap()).groups[0].current.submission).toBeNull()
  })

  it('超過 500 字：trim 後 501 個字回應 400 ANSWER_TOO_LONG；500 字可以送出', async () => {
    const leader = await ctx.srv.student(code, 'A', 'g1')
    await o.q('q1', 'open')
    await expectError(o.submit(leader, 'q1', 1, two('字'.repeat(501), 'b')), 400, 'ANSWER_TOO_LONG')
    expect((await o.submit(leader, 'q1', 1, two(` ${'字'.repeat(500)} `, 'b'))).status).toBe(201)
  })

  it('子填空數量不符：題組有兩個子填空，請求只帶一個答案時回應 400 BLANKS_MISMATCH', async () => {
    const leader = await ctx.srv.student(code, 'A', 'g1')
    await o.q('q1', 'open')
    await expectError(o.submit(leader, 'q1', 1, [{ blankId: 'q1b1', text: 'a' }]), 400, 'BLANKS_MISMATCH')
    await expectError(
      o.submit(leader, 'q1', 1, [
        { blankId: 'q1b1', text: 'a' },
        { blankId: 'q2b1', text: 'b' },
      ]),
      400,
      'BLANKS_MISMATCH',
    )
  })

  it('重開前的舊請求：第 1 題已重開為第 2 輪，送出 round 1 回應 409 STALE_ROUND，結果被新一輪覆蓋', async () => {
    const g1 = await ctx.srv.student(code, 'A', 'g1')
    const g2 = await ctx.srv.student(code, 'B', 'g2')
    await o.q('q1', 'open')
    await o.submit(g1, 'q1', 1, two('a', 'b'))
    await o.q('q1', 'close')
    await o.q('q1', 'reopen')
    await expectError(o.submit(g2, 'q1', 1, two('c', 'd')), 409, 'STALE_ROUND')
    expect((await o.submit(g2, 'q1', 2, two('c', 'd'))).status).toBe(201)
    expect((await o.submit(g1, 'q1', 2, two('e', 'f'))).status).toBe(201)
    await o.q('q1', 'close')
    const r = (await o.studentSnap(g1)).results[0]
    expect(r.round).toBe(2)
    expect(r.winnerGroupId).toBe('g2')
    expect(r.submissions).toHaveLength(2)
  })

  it('重複送出：同一輪已送出後再次送出回應 409 ALREADY_SUBMITTED，原本的提交不變', async () => {
    const leader = await ctx.srv.student(code, 'A', 'g1')
    await o.q('q1', 'open')
    expect((await o.submit(leader, 'q1', 1, two('CPU', '作業系統'))).status).toBe(201)
    await expectError(o.submit(leader, 'q1', 1, two('x', 'y')), 409, 'ALREADY_SUBMITTED')
    expect((await o.teacherSnap()).groups[0].current.submission.answers).toEqual(two('CPU', '作業系統'))
  })

  it('檢查順序：題目狀態 → 輪次 → 組長 → 已送出 → 格數 → 空白 → 長度', async () => {
    const leader = await ctx.srv.student(code, 'A', 'g1')
    const member = await ctx.srv.student(code, 'B', 'g1')
    await o.q('q1', 'open')
    await expectError(o.submit(member, 'q2', 9, []), 409, 'QUESTION_NOT_OPEN')
    await expectError(o.submit(member, 'q1', 9, []), 409, 'STALE_ROUND')
    await expectError(o.submit(member, 'q1', 1, []), 403, 'NOT_LEADER')
    await expectError(o.submit(leader, 'q1', 1, [{ blankId: 'q1b1', text: ' ' }]), 400, 'BLANKS_MISMATCH')
    await expectError(o.submit(leader, 'q1', 1, two(' ', '字'.repeat(501))), 400, 'BLANK_ANSWER')
    await o.submit(leader, 'q1', 1, two('a', 'b'))
    await expectError(o.submit(leader, 'q1', 1, []), 409, 'ALREADY_SUBMITTED')
  })

  it('組長剛離線、由組員接任後，原組長送出回應 403 NOT_LEADER', async () => {
    const leader = await ctx.srv.student(code, 'A', 'g1')
    const member = await ctx.srv.student(code, 'B', 'g1')
    await o.q('q1', 'open')
    await ctx.srv.goOffline(leader.conn)
    await expectError(o.submit(leader, 'q1', 1, two('a', 'b')), 403, 'NOT_LEADER')
    expect((await o.submit(member, 'q1', 1, two('a', 'b'))).status).toBe(201)
  })
})

// ---------- 依接收順序給順位 ----------

describe('依接收順序給順位', () => {
  const ctx = useServer()
  let t, code, o
  beforeEach(async () => {
    t = await ctx.srv.teacher()
    code = (await ctx.srv.createActivity(t, 'group', 5)).activity.code
    o = ops(t, code)
  })

  it('多組同時送出：都回應 201，結束後順位為 1、2、3…各不相同，與後端收到的先後一致', async () => {
    const groups = ['g1', 'g2', 'g3', 'g4', 'g5']
    const leaders = []
    for (const gid of groups) leaders.push(await ctx.srv.student(code, `組長${gid}`, gid))
    await o.q('q1', 'open')
    const res = await Promise.all(leaders.map((s, i) => o.submit(s, 'q1', 1, two(`a${i}`, `b${i}`))))
    expect(res.map((r) => r.status)).toEqual([201, 201, 201, 201, 201])
    await o.q('q1', 'close')
    const result = (await o.studentSnap(leaders[0])).results[0]
    expect(result.submissions.map((s) => s.rank)).toEqual([1, 2, 3, 4, 5])
    expect(new Set(result.submissions.map((s) => s.groupId)).size).toBe(5)
    // 順位 1 最早被接收：submittedAt 依順位不遞減
    const times = result.submissions.map((s) => Date.parse(s.submittedAt))
    expect([...times].sort((x, y) => x - y)).toEqual(times)
    expect(result.winnerGroupId).toBe(result.submissions[0].groupId)
    // 每組的 submittedAt 與它收到的回應相同
    for (const [i, gid] of groups.entries()) {
      const mine = result.submissions.find((x) => x.groupId === gid)
      expect(mine.submittedAt).toBe(res[i].body.submittedAt)
    }
  })

  it('依序送出時順位與送出順序相同', async () => {
    const a = await ctx.srv.student(code, 'A', 'g1')
    const b = await ctx.srv.student(code, 'B', 'g2')
    const c = await ctx.srv.student(code, 'C', 'g3')
    await o.q('q3', 'open')
    for (const s of [c, a, b]) expect((await o.submit(s, 'q3', 1, one('q3', 'x'))).status).toBe(201)
    await o.q('q3', 'close')
    const r = (await o.teacherSnap()).results[0]
    expect(r.submissions.map((s) => [s.groupId, s.rank])).toEqual([
      ['g3', 1],
      ['g1', 2],
      ['g2', 3],
    ])
  })

  it('無人作答：題目結束時沒有任何組送出，submissions 為空，winnerGroupId 為 null', async () => {
    await o.q('q2', 'open')
    await o.q('q2', 'close')
    expect((await o.teacherSnap()).results).toEqual([
      { questionId: 'q2', round: 1, submissions: [], winnerGroupId: null },
    ])
  })
})

// ---------- CSV 匯出 ----------

describe('CSV 匯出', () => {
  const ctx = useServer()

  /** 讀取原始位元組（fetch 的 text() 會去掉 BOM） */
  async function rawCsv(t, code) {
    const res = await fetch(`${ctx.base}/api/activities/${code}/export.csv`, {
      headers: { cookie: t.cookieHeader() },
    })
    return { res, bytes: Buffer.from(await res.arrayBuffer()) }
  }

  it('匯出 CSV：第 2 組順位 1、第 1 組順位 2，檔名為「代號_results.csv」，第一列為表頭', async () => {
    const t = await ctx.srv.teacher()
    const code = (await ctx.srv.createActivity(t, 'single')).activity.code
    const o = ops(t, code)
    const g1 = await ctx.srv.student(code, 'A', 'g1')
    const g2 = await ctx.srv.student(code, 'B', 'g2')
    await o.q('q1', 'open')
    await o.submit(g2, 'q1', 1, one('q1', '光合作用'))
    await o.submit(g1, 'q1', 1, one('q1', '呼吸作用'))
    await o.q('q1', 'close')

    const { res, bytes } = await rawCsv(t, code)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    const disposition = res.headers.get('content-disposition')
    expect(disposition).toContain('attachment')
    expect(disposition).toContain(`filename="${code}_results.csv"`)
    expect(disposition).toContain(`filename*=UTF-8''${code}_results.csv`)
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(bytes.subarray(3).toString('utf8')).toBe(
      '題號,組別,答案,搶答順位\r\n1,第 2 組,光合作用,1\r\n1,第 1 組,呼吸作用,2\r\n',
    )
  })

  it('含逗號或換行的答案：欄位以雙引號包住，內部雙引號重複一次', async () => {
    const t = await ctx.srv.teacher()
    const code = (await ctx.srv.createActivity(t, 'group')).activity.code
    const o = ops(t, code)
    const g1 = await ctx.srv.student(code, 'A', 'g1')
    const g2 = await ctx.srv.student(code, 'B', 'g2')
    await o.q('q3', 'open')
    await o.submit(g1, 'q3', 1, one('q3', '1,0'))
    await o.submit(g2, 'q3', 1, one('q3', '他說"對"\n沒錯'))
    await o.q('q3', 'close')
    const { bytes } = await rawCsv(t, code)
    expect(bytes.subarray(3).toString('utf8')).toBe(
      '題號,組別,答案,搶答順位\r\n3,第 1 組,"1,0",1\r\n3,第 2 組,"他說""對""\n沒錯",2\r\n',
    )
  })

  it('沒有已結束的題目時只有表頭；未登入時回應 401', async () => {
    const t = await ctx.srv.teacher()
    const code = (await ctx.srv.createActivity(t, 'single')).activity.code
    const csv = await t.get(`/api/activities/${code}/export.csv`)
    expect(csv.text.replace(/^﻿/, '')).toBe('題號,組別,答案,搶答順位\r\n')
    expect((await agent(ctx.base).get(`/api/activities/${code}/export.csv`)).status).toBe(401)
    expect((await t.get('/api/activities/ZZZZZZ/export.csv')).body.error.code).toBe('ACTIVITY_NOT_FOUND')
  })
})

// ---------- 不提供測試鉤子 ----------

describe('不提供測試鉤子', () => {
  const ctx = useServer()

  it('呼叫測試鉤子：POST /__mock/reset 等路徑回應 404，狀態不變', async () => {
    const t = await ctx.srv.teacher()
    const code = (await ctx.srv.createActivity(t, 'single')).activity.code
    const s = await ctx.srv.student(code, '小明', 'g1')
    const before = (await t.get(`/api/activities/${code}/teacher`)).body

    const post = (path, body = {}) =>
      fetch(`${ctx.base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: t.cookieHeader() },
        body: JSON.stringify(body),
      })
    expect((await post('/__mock/reset')).status).toBe(404)
    expect((await post('/__mock/presence', { code, clientId: s.clientId, online: false })).status).toBe(404)
    expect((await post('/__mock/forceError', { path: '/api', status: 500, code: 'X' })).status).toBe(404)
    expect((await post('/__mock/skipVersions', { count: 3 })).status).toBe(404)
    expect((await post('/__mock/bump', { code })).status).toBe(404)
    expect((await post('/__mock/disconnect', { code })).status).toBe(404)
    expect((await fetch(`${ctx.base}/__mock/sheetWrites?code=${code}`)).status).toBe(404)

    expect((await t.get(`/api/activities/${code}/teacher`)).body).toEqual(before)
    expect(s.conn.socket.connected).toBe(true)
  })
})
