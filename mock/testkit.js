// mock 單元測試用的小工具：有獨立 Cookie 的 HTTP agent 與 Socket.IO 連線。
import { io as ioClient } from 'socket.io-client'

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

/** mock 用的測試試算表網址；id 中的關鍵字決定匯入與寫回的結果（design.md G6） */
export const sheetUrl = (id) => `https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`

/** 老師匯入試算表並建立活動，回傳 201 的 TeacherSnapshot */
export async function createActivity(t, id = 'mock-single', groupCount = 3) {
  const imp = await t.post('/api/sheets/import', { sheetUrl: sheetUrl(id) })
  if (imp.status !== 200) throw new Error(`import failed: ${imp.status} ${imp.text}`)
  const res = await t.post('/api/activities', { importId: imp.body.importId, groupCount })
  if (res.status !== 201) throw new Error(`create failed: ${res.status} ${res.text}`)
  return res.body
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
  socket.on('snapshot', (s) => snapshots.push(s))
  socket.on('draft:updated', (d) => drafts.push(d))
  return {
    socket,
    snapshots,
    drafts,
    ready: () =>
      new Promise((resolve, reject) => {
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
