import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createMockServer } from './server.js'
import { agent, connect, until, wait } from './testkit.js'

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

async function activity(t, file = '軟工期末專案_單題_範例.xlsx', groupCount = 3) {
  const up = await t.upload('/api/uploads', file)
  const res = await t.post('/api/activities', { uploadId: up.body.uploadId, groupCount })
  expect(res.status).toBe(201)
  return res.body
}

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

  it('上傳需要登入；依檔名回傳預覽或錯誤', async () => {
    expect((await agent(base).upload('/api/uploads', 'a.xlsx')).status).toBe(401)
    const t = await teacher()
    const notX = await t.upload('/api/uploads', 'notes.csv')
    expect(notX.status).toBe(400)
    expect(notX.body.error.code).toBe('NOT_XLSX')
    const inv = await t.upload('/api/uploads', 'invalid.xlsx')
    expect(inv.status).toBe(422)
    expect(inv.body.error).toMatchObject({ code: 'PARSE_FAILED', details: '找不到題號/作答表頭' })

    const single = await t.upload('/api/uploads', '軟工期末專案_單題_範例.xlsx')
    expect(single.body.fileName).toBe('軟工期末專案_單題_範例.xlsx')
    expect(single.body.questions).toHaveLength(6)
    expect(single.body.questions.map((q) => q.blanks[0].cellRef)).toEqual(
      [5, 7, 9, 11, 13, 15].map((r) => `學習單!G${r}`),
    )
    const group = await t.upload('/api/uploads', '軟工期末專案_題組_範例.xlsx')
    expect(group.body.questions).toHaveLength(4)
    expect(group.body.questions[0].blanks).toEqual([
      { label: '（1）', cellRef: '學習單!H5' },
      { label: '（2）', cellRef: '學習單!H6' },
    ])
    const variant = await t.upload('/api/uploads', '另一份_變體.xlsx')
    expect(variant.body.questions).toHaveLength(9)
    expect(variant.body.warnings.length).toBeGreaterThan(0)
  })

  it('建立活動的錯誤與成功', async () => {
    const t = await teacher()
    const up = await t.upload('/api/uploads', 'a.xlsx')
    const bad = await t.post('/api/activities', { uploadId: up.body.uploadId, groupCount: 1 })
    expect(bad.body.error.code).toBe('INVALID_GROUP_COUNT')
    const missing = await t.post('/api/activities', { uploadId: 'nope', groupCount: 3 })
    expect(missing.status).toBe(404)
    expect(missing.body.error.code).toBe('UPLOAD_NOT_FOUND')
    const ok = await t.post('/api/activities', { uploadId: up.body.uploadId, groupCount: 3 })
    expect(ok.status).toBe(201)
    expect(ok.body.activity.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
    expect(ok.body.activity.groups.map((g) => g.name)).toEqual(['第 1 組', '第 2 組', '第 3 組'])
    expect(ok.body.questions[0].blanks[0].cellRef).toBe('學習單!G5')
    expect((await t.get('/api/activities/ZZZZZZ/teacher')).body.error.code).toBe('ACTIVITY_NOT_FOUND')
    expect((await agent(base).get(`/api/activities/${ok.body.activity.code}/teacher`)).status).toBe(401)
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

  it('轉移組長與匯出', async () => {
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

    const x = await t.get(`/api/activities/${a.code}/export.xlsx`)
    expect(x.headers.get('content-disposition')).toContain(`${a.code}_answers.xlsx`)
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
    code = (await activity(t, '軟工期末專案_題組_範例.xlsx')).activity.code
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
