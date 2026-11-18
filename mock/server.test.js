import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createMockServer } from './server.js'
import { agent, connect, createActivity, sheetUrl, until, wait } from './testkit.js'

const PASSWORD = crypto.randomBytes(9).toString('base64url')

let mock
let base
beforeAll(async () => {
  mock = createMockServer({ teacherPassword: PASSWORD, testHooks: true })
  base = `http://localhost:${await mock.listen(0)}`
})
afterAll(() => mock.close())
beforeEach(async () => {
  await fetch(`${base}/__mock/reset`, { method: 'POST' })
})

const sockets = []
afterEach(() => {
  while (sockets.length) sockets.pop().close()
})

async function teacher() {
  const t = agent(base)
  expect((await t.post('/api/teacher/login', { password: PASSWORD })).status).toBe(204)
  return t
}

const activity = (t, id = 'mock-single', groupCount = 3) => createActivity(t, id, groupCount)
const importSheet = (t, id) => t.post('/api/sheets/import', { sheetUrl: sheetUrl(id) })

async function student(code, nickname, groupId) {
  const s = agent(base)
  const j = await s.post(`/api/activities/${code}/join`, { nickname })
  expect(j.status).toBe(200)
  if (groupId) expect((await s.put(`/api/activities/${code}/me/group`, { groupId })).status).toBe(200)
  return s
}

const hook = (path, body) =>
  fetch(`${base}/__mock/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })

describe('3.1 啟動與密碼', () => {
  it('未設定 TEACHER_PASSWORD 時印出隨機密碼，且可以用它登入', async () => {
    const entry = fileURLToPath(new URL('./index.js', import.meta.url))
    const child = spawn(process.execPath, [entry], {
      env: { ...process.env, PORT: '0', TEACHER_PASSWORD: '', MOCK_TEST_HOOKS: '0' },
    })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    try {
      await until(() => /listening on http:\/\/localhost:(\d+)/.test(out), 10000)
      const pw = out.match(/教師密碼：(\S+)/)[1]
      const port = out.match(/listening on http:\/\/localhost:(\d+)/)[1]
      const a = agent(`http://localhost:${port}`)
      expect((await a.post('/api/teacher/login', { password: pw })).status).toBe(204)
      expect((await a.post('/__mock/reset')).status).toBe(404) // 未啟用測試鉤子
    } finally {
      child.kill()
    }
  })
})

describe('3.2 老師 REST', () => {
  it('登入、session、登出', async () => {
    const t = agent(base)
    expect((await t.get('/api/teacher/session')).body).toEqual({ authenticated: false })
    const bad = await t.post('/api/teacher/login', { password: 'wrong' })
    expect(bad.status).toBe(401)
    expect(bad.body.error.code).toBe('INVALID_PASSWORD')
    expect((await t.post('/api/teacher/login', { password: PASSWORD })).status).toBe(204)
    expect((await t.get('/api/teacher/session')).body).toEqual({ authenticated: true })
    expect((await t.post('/api/teacher/logout')).status).toBe(204)
    expect((await t.get('/api/teacher/session')).body).toEqual({ authenticated: false })
  })

  it('匯入需要登入；依網址回傳預覽（含試算表標題與工作表名稱）', async () => {
    expect((await importSheet(agent(base), 'mock-single')).status).toBe(401)
    const t = await teacher()
    const single = await importSheet(t, 'mock-single')
    expect(single.status).toBe(200)
    expect(single.body).toMatchObject({
      sheetUrl: 'https://docs.google.com/spreadsheets/d/mock-single/edit',
      spreadsheetTitle: '軟工期末專案_單題_範例',
      worksheetTitle: '學習單',
      warnings: [],
    })
    expect(single.body.importId).toMatch(/^[a-f0-9]+$/)
    expect(single.body.questions).toHaveLength(6)
    expect(single.body.questions.map((q) => q.blanks[0].cellRef)).toEqual(
      [5, 7, 9, 11, 13, 15].map((r) => `學習單!G${r}`),
    )
    const group = await importSheet(t, 'mock-group')
    expect(group.body.questions).toHaveLength(4)
    expect(group.body.questions[0].blanks).toEqual([
      { label: '（1）', cellRef: '學習單!H5' },
      { label: '（2）', cellRef: '學習單!H6' },
    ])
    expect(group.body.questions[1].blanks.map((b) => b.label)).toEqual(['（1）', '（2）'])
    const variant = await importSheet(t, 'mock-VARIANT') // 關鍵字不分大小寫
    expect(variant.body).toMatchObject({ worksheetTitle: '講義B' })
    expect(variant.body.questions).toHaveLength(9)
    expect(variant.body.questions[0].blanks[0].cellRef).toBe('講義B!E8')
    expect(variant.body.warnings).toHaveLength(1)
    // readonly、changed：匯入正常，留到寫回時才失敗
    for (const id of ['mock-readonly', 'mock-changed', 'abc123']) {
      const r = await importSheet(t, id)
      expect([r.status, r.body.questions.length]).toEqual([200, 6])
    }
  })

  it('匯入錯誤：網址格式、沒有共用、找不到試算表、找不到工作表、解析失敗', async () => {
    const t = await teacher()
    for (const bad of ['https://example.com/not-a-sheet', '', 'docs.google.com/spreadsheets/d/x', undefined]) {
      const r = await t.post('/api/sheets/import', { sheetUrl: bad })
      expect([r.status, r.body.error.code]).toEqual([400, 'INVALID_SHEET_URL'])
    }
    const ns = await importSheet(t, 'mock-notshared')
    expect(ns.status).toBe(403)
    expect(ns.body.error).toMatchObject({ code: 'SHEET_NOT_SHARED', shareWith: 'quiz-bot@mock.invalid' })
    const missing = await importSheet(t, 'mock-missing')
    expect([missing.status, missing.body.error.code]).toEqual([404, 'SHEET_NOT_FOUND'])
    const nw = await importSheet(t, 'mock-noworksheet')
    expect(nw.status).toBe(422)
    expect(nw.body.error).toMatchObject({ code: 'WORKSHEET_NOT_FOUND', details: '網址指定的工作表不存在' })
    const inv = await importSheet(t, 'mock-invalid')
    expect(inv.status).toBe(422)
    expect(inv.body.error).toMatchObject({ code: 'PARSE_FAILED', details: '找不到題號/作答表頭' })
  })

  it('舊路徑已移除：POST /api/uploads 與 GET export.xlsx 回 404', async () => {
    const t = await teacher()
    expect((await t.post('/api/uploads', {})).status).toBe(404)
    const { activity: a } = await activity(t)
    expect((await t.get(`/api/activities/${a.code}/export.xlsx`)).status).toBe(404)
  })

  it('建立活動的錯誤與成功；老師快照有 sheet', async () => {
    const t = await teacher()
    const imp = await importSheet(t, 'mock-single')
    const bad = await t.post('/api/activities', { importId: imp.body.importId, groupCount: 1 })
    expect(bad.body.error.code).toBe('INVALID_GROUP_COUNT')
    const missing = await t.post('/api/activities', { importId: 'nope', groupCount: 3 })
    expect(missing.status).toBe(404)
    expect(missing.body.error.code).toBe('IMPORT_NOT_FOUND')
    const ok = await t.post('/api/activities', { importId: imp.body.importId, groupCount: 3 })
    expect(ok.status).toBe(201)
    expect(ok.body.activity.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
    expect(ok.body.activity.groups.map((g) => g.name)).toEqual(['第 1 組', '第 2 組', '第 3 組'])
    expect(ok.body.questions[0].blanks[0].cellRef).toBe('學習單!G5')
    expect(ok.body.sheet).toEqual({
      spreadsheetTitle: '軟工期末專案_單題_範例',
      worksheetTitle: '學習單',
      url: 'https://docs.google.com/spreadsheets/d/mock-single/edit',
      lastExportedAt: null,
    })
    expect(ok.body.activity).not.toHaveProperty('sheet')
    expect((await t.get('/api/activities/ZZZZZZ/teacher')).body.error.code).toBe('ACTIVITY_NOT_FOUND')
    expect((await agent(base).get(`/api/activities/${ok.body.activity.code}/teacher`)).status).toBe(401)
  })

  it('學生快照不含任何試算表網址、標題或 cellRef', async () => {
    const t = await teacher()
    const { activity: a } = await activity(t, 'mock-group')
    const s = await student(a.code, '小明', 'g1')
    const raw = (await s.get(`/api/activities/${a.code}/student`)).text
    for (const leak of ['docs.google.com', 'mock-group', '軟工期末專案_題組_範例', '學習單', 'cellRef', 'sheet']) {
      expect(raw).not.toContain(leak)
    }
  })

  it('開始、結束、重開的狀態錯誤', async () => {
    const t = await teacher()
    const { activity: a } = await activity(t)
    const q = (id, act) => t.post(`/api/activities/${a.code}/questions/${id}/${act}`)
    expect((await q('q1', 'open')).status).toBe(204)
    const another = await q('q2', 'open')
    expect([another.status, another.body.error.code]).toEqual([409, 'ANOTHER_QUESTION_OPEN'])
    expect((await q('q1', 'open')).body.error.code).toBe('INVALID_STATE')
    expect((await q('q1', 'reopen')).body.error.code).toBe('INVALID_STATE')
    expect((await q('q1', 'close')).status).toBe(204)
    expect((await q('q1', 'close')).body.error.code).toBe('INVALID_STATE')
    expect((await q('q1', 'open')).body.error.code).toBe('INVALID_STATE')
    expect((await q('q1', 'reopen')).status).toBe(204)
    const snap = (await t.get(`/api/activities/${a.code}/teacher`)).body
    expect(snap.questions[0]).toMatchObject({ status: 'open', round: 2 })
    expect((await q('q2', 'reopen')).body.error.code).toBe('INVALID_STATE')
  })

  it('轉移組長與匯出 CSV', async () => {
    const t = await teacher()
    const { activity: a } = await activity(t)
    const s1 = await student(a.code, '小明', 'g1')
    const s2 = await student(a.code, '小華', 'g1')
    const s2id = (await s2.get(`/api/activities/${a.code}/student`)).body.me.clientId
    const bad = await t.put(`/api/activities/${a.code}/groups/g2/leader`, { clientId: s2id })
    expect(bad.body.error.code).toBe('NOT_A_MEMBER')
    expect((await t.put(`/api/activities/${a.code}/groups/g1/leader`, { clientId: s2id })).status).toBe(204)
    expect((await s2.get(`/api/activities/${a.code}/student`)).body.me.isLeader).toBe(true)
    expect((await s1.get(`/api/activities/${a.code}/student`)).body.me.isLeader).toBe(false)

    const c = await t.get(`/api/activities/${a.code}/export.csv`)
    expect(c.headers.get('content-disposition')).toContain(`${a.code}_results.csv`)
    expect(c.text.replace('﻿', '').split('\r\n')[0]).toBe('題號,組別,答案,搶答順位')
    expect((await agent(base).get(`/api/activities/${a.code}/export.csv`)).status).toBe(401)
  })
})

describe('3.3 學生 REST', () => {
  let t, code
  beforeEach(async () => {
    t = await teacher()
    code = (await activity(t, 'mock-group')).activity.code
  })
  const open = (id) => t.post(`/api/activities/${code}/questions/${id}/open`)
  const submit = (s, id, round, answers) =>
    s.post(`/api/activities/${code}/questions/${id}/submissions`, { round, answers })
  const two = (a, b) => [
    { blankId: 'q1b1', text: a },
    { blankId: 'q1b2', text: b },
  ]

  it('加入的錯誤與恢復', async () => {
    const s = agent(base)
    expect((await s.post('/api/activities/ZZZZZZ/join', { nickname: 'a' })).body.error.code).toBe(
      'ACTIVITY_NOT_FOUND',
    )
    expect((await s.post(`/api/activities/${code}/join`, { nickname: '  ' })).body.error.code).toBe(
      'INVALID_NICKNAME',
    )
    expect((await s.get(`/api/activities/${code}/student`)).body.error.code).toBe('NOT_JOINED')
    const j = await s.post(`/api/activities/${code}/join`, { nickname: '小明' })
    expect(j.body.me).toMatchObject({ nickname: '小明', groupId: null, isLeader: false })
    expect(j.body.questions[0].blanks[0]).not.toHaveProperty('cellRef')
    expect((await s.get(`/api/activities/${code}/student`)).body.me.clientId).toBe(j.body.me.clientId)
  })

  it('組長為最早加入該組的人；換組；開始後鎖定，但還沒選組的人可以選一次', async () => {
    const a = await student(code, 'A', 'g1')
    const b = await student(code, 'B', 'g1')
    expect((await b.get(`/api/activities/${code}/student`)).body.me.isLeader).toBe(false)
    // A 換到第 2 組 → B 成為第 1 組組長
    expect((await a.put(`/api/activities/${code}/me/group`, { groupId: 'g2' })).body.me).toMatchObject({
      groupId: 'g2',
      isLeader: true,
    })
    expect((await b.get(`/api/activities/${code}/student`)).body.me.isLeader).toBe(true)
    expect((await a.put(`/api/activities/${code}/me/group`, { groupId: 'g9' })).body.error.code).toBe(
      'INVALID_GROUP',
    )
    await open('q1')
    const locked = await a.put(`/api/activities/${code}/me/group`, { groupId: 'g1' })
    expect([locked.status, locked.body.error.code]).toEqual([409, 'GROUP_LOCKED'])
    const late = await student(code, 'C')
    const pick = await late.put(`/api/activities/${code}/me/group`, { groupId: 'g3' })
    expect(pick.body.me).toMatchObject({ groupId: 'g3', isLeader: true })
    expect((await late.put(`/api/activities/${code}/me/group`, { groupId: 'g1' })).body.error.code).toBe(
      'GROUP_LOCKED',
    )
  })

  it('送出：NOT_LEADER、空白、長度、格數、成功（不含順位）、ALREADY_SUBMITTED', async () => {
    const leader = await student(code, 'A', 'g1')
    const member = await student(code, 'B', 'g1')
    expect((await submit(leader, 'q1', 1, two('a', 'b'))).body.error.code).toBe('QUESTION_NOT_OPEN')
    await open('q1')
    const nl = await submit(member, 'q1', 1, two('a', 'b'))
    expect([nl.status, nl.body.error.code]).toEqual([403, 'NOT_LEADER'])
    expect((await submit(leader, 'q1', 1, two(' \n', 'b'))).body.error.code).toBe('BLANK_ANSWER')
    expect((await submit(leader, 'q1', 1, two('　​', 'b'))).body.error.code).toBe('BLANK_ANSWER')
    expect((await submit(leader, 'q1', 1, two('CPU', '﻿'))).body.error.code).toBe('BLANK_ANSWER')
    expect((await submit(leader, 'q1', 1, two('字'.repeat(501), 'b'))).body.error.code).toBe(
      'ANSWER_TOO_LONG',
    )
    expect((await submit(leader, 'q1', 1, [{ blankId: 'q1b1', text: 'a' }])).body.error.code).toBe(
      'BLANKS_MISMATCH',
    )
    const ok = await submit(leader, 'q1', 1, two(' CPU ', '作業系統'))
    expect(ok.status).toBe(201)
    expect(Object.keys(ok.body)).toEqual(['submittedAt'])
    const dup = await submit(leader, 'q1', 1, two('x', 'y'))
    expect([dup.status, dup.body.error.code]).toEqual([409, 'ALREADY_SUBMITTED'])
    // 重複提交無效：答案仍是第一次的
    const snap = (await t.get(`/api/activities/${code}/teacher`)).body
    expect(snap.groups[0].current.submission.answers).toEqual(two('CPU', '作業系統'))
  })

  it('兩組並行送出：順位為 1、2 且不重複，依後端接收順序', async () => {
    const g1 = await student(code, 'A', 'g1')
    const g2 = await student(code, 'B', 'g2')
    const g3 = await student(code, 'C', 'g3')
    await open('q1')
    const res = await Promise.all([
      submit(g1, 'q1', 1, two('a', 'b')),
      submit(g2, 'q1', 1, two('c', 'd')),
      submit(g3, 'q1', 1, two('e', 'f')),
    ])
    expect(res.map((r) => r.status)).toEqual([201, 201, 201])
    await t.post(`/api/activities/${code}/questions/q1/close`)
    const result = (await g1.get(`/api/activities/${code}/student`)).body.results[0]
    const ranks = result.submissions.map((s) => s.rank)
    expect(ranks).toEqual([1, 2, 3])
    expect(new Set(result.submissions.map((s) => s.groupId)).size).toBe(3)
    // 順位 1 = 最早被接收（submittedAt 不晚於其他組）
    const times = result.submissions.map((s) => Date.parse(s.submittedAt))
    expect([...times].sort((x, y) => x - y)).toEqual(times)
    expect(result.winnerGroupId).toBe(result.submissions[0].groupId)
  })

  it('重開後舊輪次的請求回 STALE_ROUND，結果被新一輪覆蓋', async () => {
    const g1 = await student(code, 'A', 'g1')
    const g2 = await student(code, 'B', 'g2')
    await open('q1')
    await submit(g1, 'q1', 1, two('a', 'b'))
    await t.post(`/api/activities/${code}/questions/q1/close`)
    await t.post(`/api/activities/${code}/questions/q1/reopen`)
    const stale = await submit(g2, 'q1', 1, two('c', 'd'))
    expect([stale.status, stale.body.error.code]).toEqual([409, 'STALE_ROUND'])
    expect((await submit(g2, 'q1', 2, two('c', 'd'))).status).toBe(201)
    expect((await submit(g1, 'q1', 2, two('e', 'f'))).status).toBe(201)
    await t.post(`/api/activities/${code}/questions/q1/close`)
    const r = (await g1.get(`/api/activities/${code}/student`)).body.results[0]
    expect(r.round).toBe(2)
    expect(r.winnerGroupId).toBe('g2')
    expect(r.submissions).toHaveLength(2)
  })
})

describe('3.4 Socket.IO', () => {
  it('版本連續遞增；進行中學生快照沒有他組資料；草稿只送到同組', async () => {
    const t = await teacher()
    const code = (await activity(t)).activity.code
    const a1 = await student(code, 'A1', 'g1')
    const a2 = await student(code, 'A2', 'g1')
    const b1 = await student(code, 'B1', 'g2')
    const ct = connect(base, t, code, 'teacher')
    const c1 = connect(base, a1, code, 'student')
    const c2 = connect(base, a2, code, 'student')
    const c3 = connect(base, b1, code, 'student')
    sockets.push(ct, c1, c2, c3)
    await Promise.all([ct.ready(), c1.ready(), c2.ready(), c3.ready()])
    await wait(100)

    const v0 = ct.snapshots.at(-1).version
    await t.post(`/api/activities/${code}/questions/q1/open`)
    await b1.post(`/api/activities/${code}/questions/q1/submissions`, {
      round: 1,
      answers: [{ blankId: 'q1b1', text: 'CPU' }],
    })
    await until(() => ct.snapshots.at(-1).version === v0 + 2)
    const versions = ct.snapshots.map((s) => s.version).filter((v) => v > v0)
    expect(versions).toEqual([v0 + 1, v0 + 2])
    await until(() => c1.snapshots.at(-1).version === v0 + 2)

    // 第 1 組學生收到的所有快照都不含第 2 組的資料
    const raw = JSON.stringify(c1.snapshots)
    expect(raw).not.toContain('CPU')
    expect(c1.snapshots.at(-1)).not.toHaveProperty('groups')
    expect(c1.snapshots.at(-1).results).toEqual([])
    expect(c3.snapshots.at(-1).myGroup.submitted).toBe(true)
    expect(c3.snapshots.at(-1)).not.toHaveProperty('rank')

    c1.socket.emit('draft:update', { questionId: 'q1', round: 1, blankId: 'q1b1', text: '中央', baseRev: 0 })
    await until(() => c2.drafts.length === 1)
    expect(c1.drafts[0].draft).toMatchObject({ text: '中央', rev: 1, by: { nickname: 'A1' } })
    await wait(100)
    expect(c3.drafts).toEqual([])
    expect(ct.snapshots.at(-1).groups[0].current.status).toBe('editing')

    // 舊輪次的草稿被拒
    const errs = []
    c1.socket.on('error', (e) => errs.push(e))
    c1.socket.emit('draft:update', { questionId: 'q1', round: 0, blankId: 'q1b1', text: 'x', baseRev: 1 })
    await until(() => errs.length === 1)
    expect(errs[0].code).toBe('STALE_ROUND')

    // snapshot:request 回覆目前的快照
    const before = c2.snapshots.length
    c2.socket.emit('snapshot:request', {})
    await until(() => c2.snapshots.length === before + 1)

    // 結束後才出現結果
    await t.post(`/api/activities/${code}/questions/q1/close`)
    await until(() => c1.snapshots.at(-1).results.length === 1)
    expect(JSON.stringify(c1.snapshots.at(-1).results)).toContain('CPU')
  })

  it('沒有登入或沒有加入時拒絕連線', async () => {
    const t = await teacher()
    const code = (await activity(t)).activity.code
    const c = connect(base, agent(base), code, 'student')
    sockets.push(c)
    await expect(c.ready()).rejects.toThrow('NOT_JOINED')
    const d = connect(base, agent(base), code, 'teacher')
    sockets.push(d)
    await expect(d.ready()).rejects.toThrow('UNAUTHORIZED')
  })
})

describe('3.5 測試鉤子', () => {
  it('forceError、skipVersions、delaySnapshots、presence、disconnect、reset', async () => {
    const t = await teacher()
    const code = (await activity(t)).activity.code
    const s = await student(code, 'A', 'g1')

    await hook('forceError', { method: 'PUT', path: '/me/group', status: 409, code: 'GROUP_LOCKED' })
    expect((await s.put(`/api/activities/${code}/me/group`, { groupId: 'g2' })).body.error.code).toBe(
      'GROUP_LOCKED',
    )
    expect((await s.put(`/api/activities/${code}/me/group`, { groupId: 'g2' })).status).toBe(200)

    const cs = connect(base, s, code, 'student')
    sockets.push(cs)
    await cs.ready()
    await until(() => cs.snapshots.length > 0)
    const v = cs.snapshots.at(-1).version
    await hook('skipVersions', { count: 3 })
    await t.post(`/api/activities/${code}/questions/q1/open`)
    await until(() => cs.snapshots.at(-1).version === v + 4)

    await hook('delaySnapshots', { ms: 300 })
    const n = cs.snapshots.length
    await t.post(`/api/activities/${code}/questions/q1/close`)
    await wait(100)
    expect(cs.snapshots.length).toBe(n)
    await until(() => cs.snapshots.length === n + 1)
    await hook('delaySnapshots', { ms: 0 })

    const id = cs.snapshots.at(-1).me.clientId
    await hook('presence', { code, clientId: id, online: false })
    expect((await t.get(`/api/activities/${code}/teacher`)).body.groups[1].members[0].online).toBe(false)

    const closed = new Promise((r) => cs.socket.once('disconnect', r))
    const d = await (await hook('disconnect', { code, clientId: id })).json()
    expect(d.disconnected).toBe(1)
    await closed

    expect((await hook('reset')).status).toBe(204)
    expect((await t.get('/api/teacher/session')).body.authenticated).toBe(false)
  })

  it('未啟用時 /__mock 回應 404', async () => {
    const off = createMockServer({ teacherPassword: PASSWORD, testHooks: false })
    const port = await off.listen(0)
    try {
      const r = await fetch(`http://localhost:${port}/__mock/reset`, { method: 'POST' })
      expect(r.status).toBe(404)
    } finally {
      await off.close()
    }
  })
})

describe('寫回試算表（模擬）', () => {
  // 建立活動與三組各一位組長，回傳操作題目、送出、寫回與讀取寫入紀錄的小工具
  async function setup(id = 'mock-single') {
    const t = await teacher()
    const snap = await activity(t, id)
    const code = snap.activity.code
    const g = {
      g1: await student(code, 'A', 'g1'),
      g2: await student(code, 'B', 'g2'),
      g3: await student(code, 'C', 'g3'),
    }
    const qs = Object.fromEntries(snap.questions.map((q) => [q.id, { ...q, round: 1 }]))
    const call = (qid, act) => t.post(`/api/activities/${code}/questions/${qid}/${act}`)
    const submit = (gid, qid, texts) => {
      const q = qs[qid]
      return g[gid].post(`/api/activities/${code}/questions/${qid}/submissions`, {
        round: q.round,
        answers: q.blanks.map((b, i) => ({ blankId: b.id, text: texts[i] })),
      })
    }
    const version = async () => (await t.get(`/api/activities/${code}/teacher`)).body.version
    const exportToSheet = async (basedOnVersion) =>
      t.post(`/api/activities/${code}/export-to-sheet`, { basedOnVersion: basedOnVersion ?? (await version()) })
    const writes = async () => (await fetch(`${base}/__mock/sheetWrites?code=${code}`)).json()
    return { t, code, g, qs, call, submit, version, exportToSheet, writes }
  }

  it('單題：寫入順位 1 的答案到對應的儲存格，並更新 lastExportedAt', async () => {
    const x = await setup('mock-single')
    await x.call('q1', 'open')
    expect((await x.submit('g2', 'q1', ['光合作用'])).status).toBe(201)
    expect((await x.submit('g1', 'q1', ['呼吸作用'])).status).toBe(201)
    await x.call('q1', 'close')
    const r = await x.exportToSheet()
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({
      sheetUrl: 'https://docs.google.com/spreadsheets/d/mock-single/edit',
      writtenCells: 1,
      skippedQuestions: [2, 3, 4, 5, 6],
    })
    const log = await x.writes()
    expect(log).toHaveLength(1)
    expect(log[0].cells).toEqual([{ cellRef: '學習單!G5', value: '光合作用' }])
    expect(log[0].exportedAt).toBe(r.body.exportedAt)
    const snap = (await x.t.get(`/api/activities/${x.code}/teacher`)).body
    expect(snap.sheet.lastExportedAt).toBe(r.body.exportedAt)
  })

  it('變體試算表寫入變體的儲存格位置', async () => {
    const x = await setup('mock-variant')
    await x.call('q1', 'open')
    await x.submit('g3', 'q1', ['答案A'])
    await x.call('q1', 'close')
    expect((await x.exportToSheet()).status).toBe(200)
    expect((await x.writes())[0].cells).toEqual([{ cellRef: '講義B!E8', value: '答案A' }])
  })

  it('題組：子填空逐格寫入', async () => {
    const x = await setup('mock-group')
    await x.call('q1', 'open')
    await x.submit('g2', 'q1', ['CPU', '作業系統'])
    await x.call('q1', 'close')
    expect((await x.exportToSheet()).body.writtenCells).toBe(2)
    expect((await x.writes())[0].cells).toEqual([
      { cellRef: '學習單!H5', value: 'CPU' },
      { cellRef: '學習單!H6', value: '作業系統' },
    ])
  })

  it('重開後以最後一輪的順位 1 為準', async () => {
    const x = await setup('mock-single')
    await x.call('q1', 'open')
    await x.submit('g1', 'q1', ['第一輪'])
    await x.call('q1', 'close')
    await x.call('q1', 'reopen')
    x.qs.q1.round = 2
    await x.submit('g3', 'q1', ['第二輪'])
    await x.submit('g1', 'q1', ['第二輪慢'])
    await x.call('q1', 'close')
    expect((await x.exportToSheet()).status).toBe(200)
    expect((await x.writes())[0].cells).toEqual([{ cellRef: '學習單!G5', value: '第二輪' }])
  })

  it('無人作答與進行中的題目不寫入，列在 skippedQuestions', async () => {
    const x = await setup('mock-single')
    await x.call('q1', 'open')
    await x.submit('g1', 'q1', ['答案'])
    await x.call('q1', 'close')
    await x.call('q2', 'open')
    await x.call('q2', 'close')
    await x.call('q3', 'open')
    await x.submit('g2', 'q3', ['進行中'])
    const r = await x.exportToSheet()
    expect(r.body.writtenCells).toBe(1)
    expect(r.body.skippedQuestions).toEqual(expect.arrayContaining([2, 3]))
    expect(r.body.skippedQuestions).not.toContain(1)
    expect(JSON.stringify(await x.writes())).not.toContain('進行中')
  })

  it('沒有可寫入的格子：409 NOTHING_TO_EXPORT，不產生紀錄', async () => {
    const x = await setup('mock-single')
    const r = await x.exportToSheet()
    expect([r.status, r.body.error.code]).toEqual([409, 'NOTHING_TO_EXPORT'])
    await x.call('q1', 'open')
    await x.call('q1', 'close') // 無人作答
    expect((await x.exportToSheet()).body.error.code).toBe('NOTHING_TO_EXPORT')
    expect(await x.writes()).toEqual([])
  })

  it('確認後結果變動：409 STALE_VERSION；只有出席變動時正常寫回', async () => {
    const x = await setup('mock-single')
    await x.call('q1', 'open')
    await x.submit('g1', 'q1', ['答案'])
    await x.call('q1', 'close')
    const confirmedAt = await x.version()
    // 之後又結束一題 → 結果變動
    await x.call('q2', 'open')
    await x.call('q2', 'close')
    const stale = await x.exportToSheet(confirmedAt)
    expect([stale.status, stale.body.error.code]).toEqual([409, 'STALE_VERSION'])
    expect(await x.writes()).toEqual([])

    // 只有出席變動：version 遞增，但結果沒變
    const v = await x.version()
    const id = (await x.g.g1.get(`/api/activities/${x.code}/student`)).body.me.clientId
    await hook('presence', { code: x.code, clientId: id, online: false })
    await hook('presence', { code: x.code, clientId: id, online: true })
    expect(await x.version()).toBe(v + 2)
    expect((await x.exportToSheet(v)).status).toBe(200)
  })

  it('readonly：403 SHEET_READ_ONLY 附 shareWith；changed：409 SHEET_CHANGED 附 details；都不產生紀錄', async () => {
    for (const [id, status, error] of [
      ['mock-readonly', 403, { code: 'SHEET_READ_ONLY', shareWith: 'quiz-bot@mock.invalid' }],
      ['mock-changed', 409, { code: 'SHEET_CHANGED', details: '第 3 題的作答格位置已改變' }],
    ]) {
      await hook('reset')
      const x = await setup(id)
      await x.call('q1', 'open')
      await x.submit('g1', 'q1', ['答案'])
      await x.call('q1', 'close')
      const r = await x.exportToSheet()
      expect(r.status).toBe(status)
      expect(r.body.error).toMatchObject(error)
      expect(await x.writes()).toEqual([])
      expect((await x.t.get(`/api/activities/${x.code}/teacher`)).body.sheet.lastExportedAt).toBeNull()
    }
  })

  it('需要老師身分', async () => {
    const x = await setup()
    const r = await agent(base).post(`/api/activities/${x.code}/export-to-sheet`, { basedOnVersion: 1 })
    expect(r.status).toBe(401)
  })
})

describe('寫入紀錄與 forceError 鉤子', () => {
  it('forceError 套用在 export-to-sheet：502 不產生紀錄、不更新 lastExportedAt；reset 清空紀錄', async () => {
    const t = await teacher()
    const { activity: a } = await activity(t)
    const s = await student(a.code, 'A', 'g1')
    await t.post(`/api/activities/${a.code}/questions/q1/open`)
    await s.post(`/api/activities/${a.code}/questions/q1/submissions`, {
      round: 1,
      answers: [{ blankId: 'q1b1', text: '答案' }],
    })
    await t.post(`/api/activities/${a.code}/questions/q1/close`)
    const version = (await t.get(`/api/activities/${a.code}/teacher`)).body.version
    const exportToSheet = () => t.post(`/api/activities/${a.code}/export-to-sheet`, { basedOnVersion: version })
    const writes = (code = a.code) => fetch(`${base}/__mock/sheetWrites?code=${code}`).then((r) => r.json())

    await hook('forceError', {
      method: 'POST',
      path: '/export-to-sheet',
      status: 502,
      code: 'SHEET_WRITE_FAILED',
      message: '寫回失敗',
    })
    const failed = await exportToSheet()
    expect([failed.status, failed.body.error.code]).toEqual([502, 'SHEET_WRITE_FAILED'])
    expect(await writes()).toEqual([])
    expect((await t.get(`/api/activities/${a.code}/teacher`)).body.sheet.lastExportedAt).toBeNull()

    // forceError 也能附帶 shareWith
    await hook('forceError', { path: '/export-to-sheet', status: 403, code: 'SHEET_READ_ONLY', shareWith: 'x@y.z' })
    expect((await exportToSheet()).body.error).toMatchObject({ code: 'SHEET_READ_ONLY', shareWith: 'x@y.z' })

    expect((await exportToSheet()).status).toBe(200)
    expect(await writes()).toHaveLength(1)
    expect(await writes(a.code.toLowerCase())).toHaveLength(1) // 代號不分大小寫

    await hook('reset')
    expect(await writes()).toEqual([])
  })

  it('非測試模式下 /__mock/sheetWrites 回 404', async () => {
    const off = createMockServer({ teacherPassword: PASSWORD, testHooks: false })
    const port = await off.listen(0)
    try {
      expect((await fetch(`http://localhost:${port}/__mock/sheetWrites?code=X`)).status).toBe(404)
    } finally {
      await off.close()
    }
  })
})

describe('不連線 Google 服務', () => {
  it('完整流程中沒有任何對外連線', async () => {
    const outbound = []
    const original = net.Socket.prototype.connect
    net.Socket.prototype.connect = function (...args) {
      const first = Array.isArray(args[0]) ? args[0][0] : args[0]
      const opts = typeof first === 'object' && first !== null ? first : { port: first, host: args[1] }
      const host = opts.host ?? 'localhost'
      if (!opts.path && !['localhost', '127.0.0.1', '::1'].includes(host)) outbound.push(host)
      return original.apply(this, args)
    }
    try {
      const t = await teacher()
      const { activity: a } = await activity(t, 'mock-group')
      const s = await student(a.code, 'A', 'g1')
      await t.post(`/api/activities/${a.code}/questions/q1/open`)
      await s.post(`/api/activities/${a.code}/questions/q1/submissions`, {
        round: 1,
        answers: [
          { blankId: 'q1b1', text: 'a' },
          { blankId: 'q1b2', text: 'b' },
        ],
      })
      await t.post(`/api/activities/${a.code}/questions/q1/close`)
      const v = (await t.get(`/api/activities/${a.code}/teacher`)).body.version
      expect((await t.post(`/api/activities/${a.code}/export-to-sheet`, { basedOnVersion: v })).status).toBe(200)
      expect((await t.get(`/api/activities/${a.code}/export.csv`)).status).toBe(200)
    } finally {
      net.Socket.prototype.connect = original
    }
    expect(outbound).toEqual([])
  })

  it('mock 的程式不讀取任何 Google 相關的環境變數', () => {
    for (const f of ['server.js', 'fixtures.js', 'index.js']) {
      const src = readFileSync(fileURLToPath(new URL(`./${f}`, import.meta.url)), 'utf8')
      expect(src).not.toMatch(/process\.env\.[A-Z_]*GOOGLE/i)
      expect(src).not.toMatch(/googleapis/i)
    }
  })
})
