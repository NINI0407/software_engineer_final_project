// 正式後端 Socket.IO 的整合測試（change build-quiz-backend，task 4.3）。
// 用真實的 socket.io-client 連線，移植 mock/server.test.js「3.4 Socket.IO」與「依在線狀態遞補組長」的情境；
// 正式後端沒有 presence 鉤子，所以上下線都用真實連線的建立與中斷觸發。測試名稱對應 spec Scenario。

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { singleSpreadsheet } from './sheets/fixtures/single.js'
import { groupSpreadsheet } from './sheets/fixtures/group.js'
import { agent, connect, startServer, until, wait } from './testing/testkit.js'

const spreadsheets = () => ({ single: singleSpreadsheet(), group: groupSpreadsheet() })

/** 每個 describe 啟動自己的伺服器，結束時關閉；每個測試結束時關閉連線 */
function useServer() {
  const ctx = {}
  beforeAll(async () => {
    ctx.srv = await startServer({ spreadsheets: spreadsheets() })
  })
  afterEach(() => ctx.srv.closeSockets())
  afterAll(() => ctx.srv.close())
  return ctx
}

/** 每個測試建立新的活動（題組範本，3 組） */
function useActivity(ctx, id = 'group', groupCount = 3) {
  const a = {}
  beforeEach(async () => {
    a.t = await ctx.srv.teacher()
    a.code = (await ctx.srv.createActivity(a.t, id, groupCount)).activity.code
  })
  return a
}

const two = (x, y) => [
  { blankId: 'q1b1', text: x },
  { blankId: 'q1b2', text: y },
]

const draft = (blankId, text, round = 1, questionId = 'q1') => ({ questionId, round, blankId, text })

/** 等待並回傳連線最新的快照 */
const last = (c) => c.snapshots.at(-1)

/** 老師快照中某組的組長暱稱 */
const leaderIn = (snap, gid) =>
  snap?.groups.find((g) => g.group.id === gid)?.members.find((m) => m.isLeader)?.nickname ?? null

/** 老師快照中某位成員 */
const memberIn = (snap, gid, nickname) =>
  snap?.groups.find((g) => g.group.id === gid)?.members.find((m) => m.nickname === nickname)

/** 確認在一段時間內沒有收到新的事件 */
async function expectQuiet(list, ms = 150) {
  const n = list.length
  await wait(ms)
  expect(list.length).toBe(n)
}

// ---------- Socket.IO 連線驗證 ----------

describe('Socket.IO 連線驗證', () => {
  const ctx = useServer()
  const act = useActivity(ctx)

  it('沒有加入的學生：沒有 client_id 時以學生身分連線被拒絕', async () => {
    const c = connect(ctx.srv.base, agent(ctx.srv.base), act.code, 'student')
    try {
      await expect(c.ready()).rejects.toThrow('NOT_JOINED')
    } finally {
      c.close()
    }
  })

  it('client_id 屬於其他活動時連線被拒絕', async () => {
    const other = (await ctx.srv.createActivity(act.t, 'single')).activity.code
    const s = await ctx.srv.student(other, '小明', null, { online: false })
    const c = connect(ctx.srv.base, s, act.code, 'student')
    try {
      await expect(c.ready()).rejects.toThrow('NOT_JOINED')
    } finally {
      c.close()
    }
  })

  it('沒有登入的老師：沒有 teacher_session、只有學生的 client_id，或 session 無效時連線被拒絕', async () => {
    // 學生的 client_id 不能拿來以老師身分連線
    const s = await ctx.srv.student(act.code, '小明', 'g1', { online: false })
    const forged = agent(ctx.srv.base)
    forged.jar.set('teacher_session', 'x'.repeat(64))
    // 建立連線後立刻等待結果，避免錯過 connect_error
    const conns = [agent(ctx.srv.base), s, forged].map((who) => connect(ctx.srv.base, who, act.code, 'teacher'))
    try {
      const results = await Promise.allSettled(conns.map((c) => c.ready()))
      expect(results.map((r) => [r.status, r.reason?.message])).toEqual([
        ['rejected', 'UNAUTHORIZED'],
        ['rejected', 'UNAUTHORIZED'],
        ['rejected', 'UNAUTHORIZED'],
      ])
    } finally {
      for (const c of conns) c.close()
    }
  })

  it('登出後用原本的 teacher_session 連線被拒絕', async () => {
    const t = await ctx.srv.teacher()
    const token = t.jar.get('teacher_session')
    const ok = await ctx.srv.open(t, act.code, 'teacher')
    expect(ok.socket.connected).toBe(true)
    await t.post('/api/teacher/logout')
    const old = agent(ctx.srv.base)
    old.jar.set('teacher_session', token)
    const c = connect(ctx.srv.base, old, act.code, 'teacher')
    try {
      await expect(c.ready()).rejects.toThrow('UNAUTHORIZED')
    } finally {
      c.close()
    }
  })

  it('登出時中斷使用該 session 的既有連線，其他 session 的連線不受影響', async () => {
    const t = await ctx.srv.teacher()
    const other = await ctx.srv.teacher()
    const mine = await ctx.srv.open(t, act.code, 'teacher')
    const theirs = await ctx.srv.open(other, act.code, 'teacher')
    const dropped = new Promise((r) => mine.socket.once('disconnect', r))
    await t.post('/api/teacher/logout')
    await dropped
    expect(mine.socket.connected).toBe(false)
    await wait(50)
    expect(theirs.socket.connected).toBe(true)
  })

  it('活動不存在時連線被拒絕', async () => {
    const c = connect(ctx.srv.base, act.t, 'ZZZZZZ', 'teacher')
    try {
      await expect(c.ready()).rejects.toThrow('ACTIVITY_NOT_FOUND')
    } finally {
      c.close()
    }
  })

  it('已登入的老師與已加入的學生可以連線（代號不分大小寫）', async () => {
    const ct = await ctx.srv.open(act.t, act.code.toLowerCase(), 'teacher')
    const s = await ctx.srv.student(act.code, '小明', 'g1', { online: false })
    const cs = await ctx.srv.open(s, act.code.toLowerCase(), 'student')
    expect(ct.socket.connected && cs.socket.connected).toBe(true)
    await until(() => memberIn(last(ct), 'g1', '小明')?.online === true)
  })
})

// ---------- 快照推送與版本 ----------

describe('快照推送與版本', () => {
  const ctx = useServer()
  const act = useActivity(ctx)

  it('版本連續：學生依序看到開始、組長送出、結束時，快照 version 每次加 1', async () => {
    const { t, code } = act
    const leader = await ctx.srv.student(code, '小明', 'g1')
    const watcher = await ctx.srv.student(code, '小華', 'g2')
    await until(() => last(watcher.conn)?.myGroup?.members.length === 1)
    const v0 = last(watcher.conn).version

    expect((await t.post(`/api/activities/${code}/questions/q1/open`)).status).toBe(204)
    const sub = await leader.post(`/api/activities/${code}/questions/q1/submissions`, {
      round: 1,
      answers: two('CPU', '作業系統'),
    })
    expect(sub.status).toBe(201)
    expect((await t.post(`/api/activities/${code}/questions/q1/close`)).status).toBe(204)

    await until(() => last(watcher.conn).version === v0 + 3)
    const versions = watcher.conn.snapshots.map((s) => s.version).filter((v) => v > v0)
    expect(versions).toEqual([v0 + 1, v0 + 2, v0 + 3])
    // 推送的版本與 REST 取得的版本一致
    expect((await t.get(`/api/activities/${code}/teacher`)).body.version).toBe(v0 + 3)
  })

  it('每次狀態改變，同一活動的每條連線各收到一次快照，老師與學生的 version 相同', async () => {
    const { t, code } = act
    const ct = await ctx.srv.open(t, code, 'teacher')
    const a = await ctx.srv.student(code, '小明', 'g1')
    const b = await ctx.srv.student(code, '小華', 'g2')
    await until(() => memberIn(last(ct), 'g2', '小華')?.online === true)
    await until(() => last(a.conn).version === last(ct).version && last(b.conn).version === last(ct).version)
    await wait(50)
    const counts = [ct, a.conn, b.conn].map((c) => c.snapshots.length)
    await t.post(`/api/activities/${code}/questions/q1/open`)
    await until(() => [ct, a.conn, b.conn].every((c, i) => c.snapshots.length === counts[i] + 1))
    await expectQuiet(ct.snapshots, 100)
    expect([ct, a.conn, b.conn].map((c) => c.snapshots.length)).toEqual(counts.map((n) => n + 1))
    expect(new Set([ct, a.conn, b.conn].map((c) => last(c).version)).size).toBe(1)
    expect(last(ct)).toHaveProperty('groups')
    expect(last(a.conn)).toHaveProperty('myGroup')
  })

  it('其他活動的狀態改變不推送到這個活動的連線', async () => {
    const { t, code } = act
    const ct = await ctx.srv.open(t, code, 'teacher')
    const other = (await ctx.srv.createActivity(t, 'single')).activity.code
    await t.post(`/api/activities/${other}/questions/q1/open`)
    await ctx.srv.student(other, '小明', 'g1')
    await expectQuiet(ct.snapshots)
    expect(ct.snapshots).toEqual([])
  })

  it('要求快照：只有送出 snapshot:request 的連線收到目前的快照，version 不變', async () => {
    const { t, code } = act
    const ct = await ctx.srv.open(t, code, 'teacher')
    const a = await ctx.srv.student(code, '小明', 'g1')
    const b = await ctx.srv.student(code, '小華', 'g1')
    await until(() => last(a.conn)?.myGroup.members.length === 2 && last(ct)?.groups[0].members.length === 2)
    await wait(50)
    const counts = [ct, a.conn, b.conn].map((c) => c.snapshots.length)
    const version = last(ct).version

    a.conn.socket.emit('snapshot:request', {})
    await until(() => a.conn.snapshots.length === counts[1] + 1)
    expect(last(a.conn).version).toBe(version)
    expect(last(a.conn).me.nickname).toBe('小明')

    ct.socket.emit('snapshot:request')
    await until(() => ct.snapshots.length === counts[0] + 1)
    expect(last(ct).version).toBe(version)
    expect(last(ct)).toHaveProperty('sheet')

    await expectQuiet(b.conn.snapshots, 100)
    expect(b.conn.snapshots.length).toBe(counts[2])
    expect((await t.get(`/api/activities/${code}/teacher`)).body.version).toBe(version)
  })

  it('上下線也會推送：學生關閉唯一的分頁，老師收到新快照，該學生的 online 為 false', async () => {
    const { t, code } = act
    const ct = await ctx.srv.open(t, code, 'teacher')
    const s = await ctx.srv.student(code, '小明', 'g1')
    await until(() => memberIn(last(ct), 'g1', '小明')?.online === true)
    const v = last(ct).version
    await ctx.srv.goOffline(s.conn)
    await until(() => last(ct).version === v + 1)
    expect(memberIn(last(ct), 'g1', '小明')).toMatchObject({ online: false, isLeader: false })
    // 重新連線也推送
    await ctx.srv.open(s, code, 'student')
    await until(() => last(ct).version === v + 2)
    expect(memberIn(last(ct), 'g1', '小明')).toMatchObject({ online: true, isLeader: true })
  })

  it('學生上線時，新連線本身也收到快照', async () => {
    const s = await ctx.srv.student(act.code, '小明', 'g1', { online: false })
    const c = await ctx.srv.open(s, act.code, 'student')
    await until(() => c.snapshots.length >= 1)
    expect(last(c).me).toMatchObject({ nickname: '小明', groupId: 'g1', isLeader: true })
  })

  it('移植 mock 3.4：版本連續遞增；進行中學生快照沒有他組資料；草稿只送到同組', async () => {
    const { t, code } = act
    const a1 = await ctx.srv.student(code, 'A1', 'g1', { online: false })
    const a2 = await ctx.srv.student(code, 'A2', 'g1', { online: false })
    const b1 = await ctx.srv.student(code, 'B1', 'g2', { online: false })
    const ct = await ctx.srv.open(t, code, 'teacher')
    const c1 = await ctx.srv.open(a1, code, 'student')
    const c2 = await ctx.srv.open(a2, code, 'student')
    const c3 = await ctx.srv.open(b1, code, 'student')
    await until(() => memberIn(last(ct), 'g2', 'B1')?.online === true)
    await wait(50)

    const v0 = last(ct).version
    await t.post(`/api/activities/${code}/questions/q1/open`)
    await b1.post(`/api/activities/${code}/questions/q1/submissions`, { round: 1, answers: two('CPU', 'OS') })
    await until(() => last(ct).version === v0 + 2)
    expect(ct.snapshots.map((s) => s.version).filter((v) => v > v0)).toEqual([v0 + 1, v0 + 2])
    await until(() => last(c1).version === v0 + 2)

    expect(JSON.stringify(c1.snapshots)).not.toContain('CPU')
    expect(last(c1)).not.toHaveProperty('groups')
    expect(last(c1).results).toEqual([])
    expect(last(c3).myGroup.submitted).toBe(true)
    expect(JSON.stringify(last(c3))).not.toContain('"rank"')

    c1.socket.emit('draft:update', { ...draft('q1b1', '中央'), baseRev: 0 })
    await until(() => c2.drafts.length === 1)
    expect(c1.drafts[0].draft).toMatchObject({ text: '中央', rev: 1, by: { nickname: 'A1' } })
    await expectQuiet(c3.drafts, 100)
    expect(c3.drafts).toEqual([])
    expect(ct.drafts).toEqual([])
    await until(() => last(ct).groups[0].current.status === 'editing')

    c1.socket.emit('draft:update', { ...draft('q1b1', 'x', 0), baseRev: 1 })
    await until(() => c1.errors.length === 1)
    expect(c1.errors[0].code).toBe('STALE_ROUND')

    await t.post(`/api/activities/${code}/questions/q1/close`)
    await until(() => last(c1).results.length === 1)
    expect(JSON.stringify(last(c1).results)).toContain('CPU')
  })
})

// ---------- 同組草稿 ----------

describe('同組草稿', () => {
  const ctx = useServer()
  const act = useActivity(ctx)
  let ct, a1, a2, b1
  beforeEach(async () => {
    const { t, code } = act
    ct = await ctx.srv.open(t, code, 'teacher')
    a1 = await ctx.srv.student(code, '小明', 'g1')
    a2 = await ctx.srv.student(code, '小強', 'g1')
    b1 = await ctx.srv.student(code, '小華', 'g2')
    await t.post(`/api/activities/${code}/questions/q1/open`)
    await until(() => last(b1.conn)?.currentQuestionId === 'q1' && last(ct)?.currentQuestionId === 'q1')
  })

  it('同組收到草稿：第 1 組所有學生的連線收到 draft:updated（含 rev 與編輯者暱稱），第 2 組與老師沒有收到', async () => {
    a1.conn.socket.emit('draft:update', draft('q1b1', '中央處理器'))
    await until(() => a1.conn.drafts.length === 1 && a2.conn.drafts.length === 1)
    const expected = {
      questionId: 'q1',
      round: 1,
      draft: { blankId: 'q1b1', text: '中央處理器', rev: 1, by: { clientId: a1.clientId, nickname: '小明' } },
    }
    expect(a1.conn.drafts[0]).toEqual(expected)
    expect(a2.conn.drafts[0]).toEqual(expected)
    await expectQuiet(b1.conn.drafts)
    expect(b1.conn.drafts).toEqual([])
    expect(ct.drafts).toEqual([])
    // 快照中也只有本組看得到草稿內容
    expect(JSON.stringify(b1.conn.snapshots)).not.toContain('中央處理器')
    expect(JSON.stringify(ct.snapshots)).not.toContain('中央處理器')
  })

  it('同一個子填空以最後收到的內容為準，rev 每次加 1', async () => {
    a1.conn.socket.emit('draft:update', draft('q1b1', '中'))
    await until(() => a2.conn.drafts.length === 1)
    a2.conn.socket.emit('draft:update', draft('q1b1', '中央'))
    await until(() => a1.conn.drafts.length === 2)
    expect(a1.conn.drafts[1].draft).toMatchObject({ text: '中央', rev: 2, by: { nickname: '小強' } })
    const snap = (await a1.get(`/api/activities/${act.code}/student`)).body
    expect(snap.myGroup.drafts).toEqual([
      { blankId: 'q1b1', text: '中央', rev: 2, by: { clientId: a2.clientId, nickname: '小強' } },
    ])
  })

  it('同組的多個分頁都收到草稿', async () => {
    const tab2 = await ctx.srv.open(a2, act.code, 'student')
    a1.conn.socket.emit('draft:update', draft('q1b2', '作業系統'))
    await until(() => a2.conn.drafts.length === 1 && tab2.drafts.length === 1)
    expect(tab2.drafts[0].draft.text).toBe('作業系統')
  })

  it('已送出後的草稿：組員送出 draft:update 時以 error 事件回覆 ALREADY_SUBMITTED，草稿不變', async () => {
    a2.conn.socket.emit('draft:update', draft('q1b1', '原本'))
    await until(() => a1.conn.drafts.length === 1)
    const sub = await a1.post(`/api/activities/${act.code}/questions/q1/submissions`, {
      round: 1,
      answers: two('CPU', 'OS'),
    })
    expect(sub.status).toBe(201)
    a2.conn.socket.emit('draft:update', draft('q1b1', '改掉'))
    await until(() => a2.conn.errors.length === 1)
    expect(a2.conn.errors[0]).toEqual({ code: 'ALREADY_SUBMITTED', message: expect.any(String) })
    await expectQuiet(a1.conn.drafts, 100)
    expect(a1.conn.drafts).toHaveLength(1)
    const snap = (await a2.get(`/api/activities/${act.code}/student`)).body
    expect(snap.myGroup.drafts.map((d) => d.text)).toEqual(['原本'])
  })

  it('老師看到編輯中：第 1 組在本題收到第一筆草稿時推送新快照，老師快照中第 1 組為 editing', async () => {
    await wait(50)
    const v = last(ct).version
    const count = ct.snapshots.length
    a1.conn.socket.emit('draft:update', draft('q1b1', '第一筆'))
    await until(() => ct.snapshots.length === count + 1)
    expect(last(ct).version).toBe(v + 1)
    expect(last(ct).groups.map((g) => g.current.status)).toEqual(['editing', 'idle', 'idle'])
    // 之後的草稿不改變 version，也不推送快照
    a2.conn.socket.emit('draft:update', draft('q1b1', '第二筆'))
    a1.conn.socket.emit('draft:update', draft('q1b2', '第三筆'))
    await until(() => a1.conn.drafts.length === 3)
    await expectQuiet(ct.snapshots, 100)
    expect(ct.snapshots.length).toBe(count + 1)
    expect((await act.t.get(`/api/activities/${act.code}/teacher`)).body.version).toBe(v + 1)
  })

  it('不符合條件的草稿以 error 事件回覆對應的錯誤碼', async () => {
    const loner = await ctx.srv.student(act.code, '路人', null)
    const cases = [
      [a1, draft('q1b1', 'x', 0), 'STALE_ROUND'],
      [a1, draft('q2b1', 'x', 1, 'q2'), 'QUESTION_NOT_OPEN'],
      [a1, draft('q9b1', 'x'), 'BLANKS_MISMATCH'],
      [a1, { questionId: 'q1', round: 1, blankId: 'q1b1', text: 42 }, 'BLANKS_MISMATCH'],
      [loner, draft('q1b1', 'x'), 'INVALID_GROUP'],
    ]
    for (const [s, payload, errCode] of cases) {
      const n = s.conn.errors.length
      s.conn.socket.emit('draft:update', payload)
      await until(() => s.conn.errors.length === n + 1)
      expect(s.conn.errors.at(-1).code).toBe(errCode)
    }
    // 老師送出草稿也被拒絕
    ct.socket.emit('draft:update', draft('q1b1', 'x'))
    await until(() => ct.errors.length === 1)
    expect(ct.errors[0].code).toBe('NOT_JOINED')
    // 沒有任何草稿被推送
    expect(a1.conn.drafts).toEqual([])
    expect(a2.conn.drafts).toEqual([])
  })

  it('題目結束後的草稿回覆 QUESTION_NOT_OPEN', async () => {
    await act.t.post(`/api/activities/${act.code}/questions/q1/close`)
    a1.conn.socket.emit('draft:update', draft('q1b1', 'x'))
    await until(() => a1.conn.errors.length === 1)
    expect(a1.conn.errors[0].code).toBe('QUESTION_NOT_OPEN')
  })
})

// ---------- 快照的可見性 ----------

describe('快照的可見性', () => {
  const ctx = useServer()
  const act = useActivity(ctx)

  it('進行中看不到他組：第 2 組已送出時，推給第 1 組學生的快照沒有第 2 組的答案、狀態或順位', async () => {
    const { t, code } = act
    const a = await ctx.srv.student(code, '小明', 'g1')
    const b = await ctx.srv.student(code, '小華', 'g2')
    await t.post(`/api/activities/${code}/questions/q1/open`)
    b.conn.socket.emit('draft:update', draft('q1b1', '他組草稿'))
    await until(() => b.conn.drafts.length === 1)
    await b.post(`/api/activities/${code}/questions/q1/submissions`, { round: 1, answers: two('他組答案', '第二格') })
    await until(() => last(b.conn).myGroup.submitted === true)
    await until(() => last(a.conn).version === last(b.conn).version)

    const raw = JSON.stringify(a.conn.snapshots)
    for (const leak of ['他組', '第二格', b.clientId, '小華', '"rank"', '"submission"']) {
      expect(raw).not.toContain(leak)
    }
    for (const snap of a.conn.snapshots) expect(snap).not.toHaveProperty('groups')
    expect(last(a.conn).results).toEqual([])
    expect(last(a.conn).myGroup.submitted).toBe(false)
  })

  it('學生看不到試算表：推給學生的任何快照中沒有 sheet、試算表網址、標題或 cellRef', async () => {
    const { t, code } = act
    const a = await ctx.srv.student(code, '小明', 'g1')
    const loner = await ctx.srv.student(code, '路人', null)
    await t.post(`/api/activities/${code}/questions/q1/open`)
    await a.post(`/api/activities/${code}/questions/q1/submissions`, { round: 1, answers: two('a', 'b') })
    await t.post(`/api/activities/${code}/questions/q1/close`)
    a.conn.socket.emit('snapshot:request')
    await until(() => last(a.conn).results.length === 1 && last(loner.conn).results.length === 1)
    for (const c of [a.conn, loner.conn]) {
      const raw = JSON.stringify(c.snapshots)
      for (const leak of ['docs.google.com', '軟工期末專案_題組_範例', '學習單', 'cellRef', '"sheet"', '"url"', '"row"', '"col"']) {
        expect(raw).not.toContain(leak)
      }
    }
  })

  it('結束後公開結果：老師結束第 1 題後，所有學生收到的快照中 results 包含第 1 題各組的答案與順位', async () => {
    const { t, code } = act
    const a = await ctx.srv.student(code, '小明', 'g1')
    const b = await ctx.srv.student(code, '小華', 'g2')
    const c = await ctx.srv.student(code, '小美', 'g3')
    await t.post(`/api/activities/${code}/questions/q1/open`)
    await b.post(`/api/activities/${code}/questions/q1/submissions`, { round: 1, answers: two('CPU', 'OS') })
    await a.post(`/api/activities/${code}/questions/q1/submissions`, { round: 1, answers: two('GPU', 'App') })
    await t.post(`/api/activities/${code}/questions/q1/close`)
    for (const s of [a, b, c]) {
      await until(() => last(s.conn).results.length === 1)
      const [r] = last(s.conn).results
      expect(r).toMatchObject({ questionId: 'q1', round: 1, winnerGroupId: 'g2' })
      expect(r.submissions.map((x) => [x.groupId, x.rank, x.answers[0].text])).toEqual([
        ['g2', 1, 'CPU'],
        ['g1', 2, 'GPU'],
      ])
    }
  })

  it('老師的快照有各組作答狀態、cellRef 與試算表資訊', async () => {
    const { t, code } = act
    const ct = await ctx.srv.open(t, code, 'teacher')
    const a = await ctx.srv.student(code, '小明', 'g1')
    await t.post(`/api/activities/${code}/questions/q1/open`)
    await a.post(`/api/activities/${code}/questions/q1/submissions`, { round: 1, answers: two('CPU', 'OS') })
    await until(() => last(ct).groups[0].current?.status === 'submitted')
    const snap = last(ct)
    expect(snap.groups[0].current.submission).toMatchObject({ groupId: 'g1', answers: two('CPU', 'OS'), rank: 1 })
    expect(snap.questions[0].blanks[0]).toEqual({ id: 'q1b1', label: '（1）', cellRef: '學習單!H5' })
    expect(snap.sheet).toMatchObject({ spreadsheetTitle: '軟工期末專案_題組_範例', worksheetTitle: '學習單' })
  })
})

// ---------- 依在線狀態遞補組長 ----------

describe('依在線狀態遞補組長', () => {
  const ctx = useServer()
  const act = useActivity(ctx)
  let ct
  beforeEach(async () => {
    ct = await ctx.srv.open(act.t, act.code, 'teacher')
  })
  /** 透過 REST 取得某組的組長（不依賴推送） */
  const restLeader = async (gid) => leaderIn((await act.t.get(`/api/activities/${act.code}/teacher`)).body, gid)
  const meOf = async (s) => (await s.get(`/api/activities/${act.code}/student`)).body.me

  it('組長離線後立即遞補：小明的所有連線中斷時，立即推送新快照，第 1 組的組長為小美', async () => {
    const a = await ctx.srv.student(act.code, '小明', 'g1')
    const b = await ctx.srv.student(act.code, '小華', 'g1')
    const c = await ctx.srv.student(act.code, '小美', 'g1')
    await ctx.srv.goOffline(b.conn)
    await until(() => memberIn(last(ct), 'g1', '小華')?.online === false)
    expect(leaderIn(last(ct), 'g1')).toBe('小明')

    const count = ct.snapshots.length
    await ctx.srv.goOffline(a.conn)
    await until(() => ct.snapshots.length === count + 1)
    // 小明離線的第一個快照中，組長已經是小美（沒有「組長離線但還沒換人」的中間狀態）
    expect(memberIn(last(ct), 'g1', '小明')).toMatchObject({ online: false, isLeader: false })
    expect(leaderIn(last(ct), 'g1')).toBe('小美')
    expect(last(ct).groups[0].members.filter((m) => m.isLeader)).toHaveLength(1)
    await until(() => last(c.conn).me.isLeader === true)
    expect((await meOf(a)).isLeader).toBe(false)
    expect((await meOf(c)).isLeader).toBe(true)
  })

  it('原組長回來不會拿回組長：小明離線後由小華接任，小明重新連線後組長仍是小華', async () => {
    const a = await ctx.srv.student(act.code, '小明', 'g1')
    const b = await ctx.srv.student(act.code, '小華', 'g1')
    await ctx.srv.goOffline(a.conn)
    await until(() => leaderIn(last(ct), 'g1') === '小華')
    const back = await ctx.srv.open(a, act.code, 'student')
    await until(() => memberIn(last(ct), 'g1', '小明')?.online === true)
    expect(leaderIn(last(ct), 'g1')).toBe('小華')
    expect(last(back).me.isLeader).toBe(false)
    expect((await meOf(b)).isLeader).toBe(true)
    expect(await restLeader('g1')).toBe('小華')
  })

  it('全組離線後第一位上線者接任：小華先重新連線成為組長，小明之後連線組長仍是小華', async () => {
    const a = await ctx.srv.student(act.code, '小明', 'g1')
    const b = await ctx.srv.student(act.code, '小華', 'g1')
    await ctx.srv.goOffline(a.conn)
    await ctx.srv.goOffline(b.conn)
    await until(() => memberIn(last(ct), 'g1', '小華')?.online === false)
    expect(leaderIn(last(ct), 'g1')).toBeNull()
    expect((await meOf(a)).isLeader).toBe(false)

    await ctx.srv.open(b, act.code, 'student')
    await until(() => leaderIn(last(ct), 'g1') === '小華')
    await ctx.srv.open(a, act.code, 'student')
    await until(() => memberIn(last(ct), 'g1', '小明')?.online === true)
    expect(leaderIn(last(ct), 'g1')).toBe('小華')
  })

  it('同一人開多個分頁：組長小明關掉其中一個分頁，仍在線，組長不變', async () => {
    const a = await ctx.srv.student(act.code, '小明', 'g1')
    await ctx.srv.student(act.code, '小華', 'g1')
    await until(() => memberIn(last(ct), 'g1', '小華')?.online === true)
    await wait(50)
    const count = ct.snapshots.length
    const tab2 = await ctx.srv.open(a, act.code, 'student')
    await ctx.srv.goOffline(a.conn)
    // 第二個分頁的開啟與第一個分頁的關閉都不改變狀態，不推送快照
    await expectQuiet(ct.snapshots, 100)
    expect(ct.snapshots.length).toBe(count)
    const snap = (await act.t.get(`/api/activities/${act.code}/teacher`)).body
    expect(memberIn(snap, 'g1', '小明')).toMatchObject({ online: true, isLeader: true })
    // 關掉最後一個分頁才離線
    await ctx.srv.goOffline(tab2)
    await until(() => leaderIn(last(ct), 'g1') === '小華')
  })

  it('組長在開始前換組：小明換到沒有組長的第 2 組，第 1 組的組長改為小華，小明成為第 2 組的組長', async () => {
    const a = await ctx.srv.student(act.code, '小明', 'g1')
    await ctx.srv.student(act.code, '小華', 'g1')
    await until(() => memberIn(last(ct), 'g1', '小華')?.online === true)
    expect(leaderIn(last(ct), 'g1')).toBe('小明')
    const res = await a.put(`/api/activities/${act.code}/me/group`, { groupId: 'g2' })
    expect(res.body.me).toMatchObject({ groupId: 'g2', isLeader: true })
    await until(() => leaderIn(last(ct), 'g2') === '小明')
    expect(leaderIn(last(ct), 'g1')).toBe('小華')
  })

  it('只透過 REST 加入的學生：選了沒有組長的組但還沒有連線時沒有組長，第一次連線後才成為組長', async () => {
    const s = await ctx.srv.student(act.code, '小明', 'g1', { online: false })
    await until(() => memberIn(last(ct), 'g1', '小明'))
    expect(memberIn(last(ct), 'g1', '小明')).toMatchObject({ online: false, isLeader: false })
    expect(leaderIn(last(ct), 'g1')).toBeNull()
    expect((await meOf(s)).isLeader).toBe(false)

    const c = await ctx.srv.open(s, act.code, 'student')
    await until(() => leaderIn(last(ct), 'g1') === '小明')
    await until(() => last(c)?.me.isLeader === true)
  })

  it('離線的組長不能送出，接任的組員可以送出', async () => {
    const a = await ctx.srv.student(act.code, '小明', 'g1')
    const b = await ctx.srv.student(act.code, '小華', 'g1')
    await act.t.post(`/api/activities/${act.code}/questions/q1/open`)
    await ctx.srv.goOffline(a.conn)
    const res = await a.post(`/api/activities/${act.code}/questions/q1/submissions`, {
      round: 1,
      answers: two('a', 'b'),
    })
    expect([res.status, res.body.error.code]).toEqual([403, 'NOT_LEADER'])
    const ok = await b.post(`/api/activities/${act.code}/questions/q1/submissions`, {
      round: 1,
      answers: two('a', 'b'),
    })
    expect(ok.status).toBe(201)
  })
})
