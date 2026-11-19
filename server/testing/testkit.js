// 正式後端整合測試用的小工具（change build-quiz-backend，task 4.1）。
// 透過真實的 HTTP 與 Socket.IO 連線操作 createServer() 啟動的伺服器；試算表改用 fake-sheets。
import crypto from 'node:crypto'
import { io as ioClient } from 'socket.io-client'
import { createServer } from '../app.js'
import { createFakeSheets } from './fake-sheets.js'

/** 有獨立 Cookie 的 HTTP 用戶端 */
export function agent(base) {
  const jar = new Map()
  async function call(method, path, body) {
    const headers = {}
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
    let payload
    if (body !== undefined) {
      headers['content-type'] = 'application/json'
      payload = JSON.stringify(body)
    }
    const res = await fetch(base + path, { method, headers, body: payload })
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';')
      const i = pair.indexOf('=')
      const v = pair.slice(i + 1)
      if (v) jar.set(pair.slice(0, i), v)
      else jar.delete(pair.slice(0, i))
    }
    const text = await res.text()
    let json
    try {
      json = text ? JSON.parse(text) : undefined
    } catch {
      json = undefined
    }
    return { status: res.status, body: json, text, headers: res.headers }
  }
  return {
    jar,
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b),
    put: (p, b) => call('PUT', p, b),
    cookieHeader: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
  }
}

export function connect(base, a, code, role) {
  const socket = ioClient(base, {
    query: { code, role },
    extraHeaders: { cookie: a.cookieHeader() },
    transports: ['websocket'],
    reconnection: false,
  })
  const snapshots = []
  const drafts = []
  const errors = []
  socket.on('snapshot', (s) => snapshots.push(s))
  socket.on('draft:updated', (d) => drafts.push(d))
  socket.on('error', (e) => errors.push(e))
  return {
    socket,
    snapshots,
    drafts,
    errors,
    ready: () =>
      new Promise((resolve, reject) => {
        if (socket.connected) return resolve()
        socket.once('connect', resolve)
        socket.once('connect_error', reject)
      }),
    close: () => socket.close(),
  }
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms))

export async function until(fn, timeout = 2000) {
  const start = Date.now()
  for (;;) {
    const v = fn()
    if (v) return v
    if (Date.now() - start > timeout) throw new Error('until: timeout')
    await wait(10)
  }
}

/** 試算表網址；id 對應 fake-sheets 中的試算表 */
export const sheetUrl = (id, gid = 0) =>
  `https://docs.google.com/spreadsheets/d/${id}/edit${gid === null ? '' : `#gid=${gid}`}`

/**
 * 啟動一個正式後端（fake-sheets），回傳操作用的工具。
 * @param {{ spreadsheets?: Record<string, object>, sheets?: object }} [options]
 */
export async function startServer({ spreadsheets = {}, sheets } = {}) {
  const password = crypto.randomBytes(9).toString('base64url')
  const fake = sheets ?? createFakeSheets({ spreadsheets })
  const srv = createServer({ teacherPassword: password, sheets: fake })
  const base = `http://localhost:${await srv.listen(0)}`
  const sockets = []

  async function teacher() {
    const t = agent(base)
    const r = await t.post('/api/teacher/login', { password })
    if (r.status !== 204) throw new Error(`login failed: ${r.status}`)
    return t
  }

  /** 老師匯入試算表並建立活動，回傳 201 的 TeacherSnapshot */
  async function createActivity(t, id, groupCount = 3, gid = 0) {
    const imp = await t.post('/api/sheets/import', { sheetUrl: sheetUrl(id, gid) })
    if (imp.status !== 200) throw new Error(`import failed: ${imp.status} ${imp.text}`)
    const res = await t.post('/api/activities', { importId: imp.body.importId, groupCount })
    if (res.status !== 201) throw new Error(`create failed: ${res.status} ${res.text}`)
    return res.body
  }

  /** 開一條連線並記錄，close() 時一起關閉 */
  async function open(a, code, role) {
    const c = connect(base, a, code, role)
    sockets.push(c)
    await c.ready()
    return c
  }

  /**
   * 以 REST 加入（並選組）的學生。預設再建立一條 Socket.IO 連線讓他在線（design L6），
   * 連線放在 `s.conn`；`online: false` 時只用 REST，算離線成員。
   */
  async function student(code, nickname, groupId, { online = true } = {}) {
    const s = agent(base)
    const j = await s.post(`/api/activities/${code}/join`, { nickname })
    if (j.status !== 200) throw new Error(`join failed: ${j.status} ${j.text}`)
    s.clientId = j.body.me.clientId
    if (groupId) {
      const g = await s.put(`/api/activities/${code}/me/group`, { groupId })
      if (g.status !== 200) throw new Error(`group failed: ${g.status} ${g.text}`)
    }
    if (online) s.conn = await open(s, code, 'student')
    return s
  }

  /** 關閉連線並等到後端處理完斷線 */
  async function goOffline(c) {
    const closed = new Promise((r) => c.socket.once('disconnect', r))
    c.close()
    await closed
    await wait(50)
  }

  return {
    base,
    password,
    fake,
    server: srv,
    teacher,
    createActivity,
    student,
    open,
    goOffline,
    /** 關閉這次測試開的連線（不關伺服器） */
    closeSockets() {
      while (sockets.length) sockets.pop().close()
    },
    async close() {
      while (sockets.length) sockets.pop().close()
      await srv.close()
    },
  }
}
