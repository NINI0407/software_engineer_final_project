// Socket.IO：連線驗證、在線計數、snapshot:request、draft:update、依角色推送快照
// （spec quiz-backend「快照推送與版本」「Socket.IO 連線驗證」「同組草稿」，design B4）。
import { AppError } from '../domain/errors.js'
import { memberConnected, memberDisconnected, updateDraft } from '../domain/activity.js'
import { studentSnapshot, teacherSnapshot } from '../domain/snapshots.js'
import { parseCookies } from '../http/common.js'

/**
 * @param {import('socket.io').Server} io
 * @param {{ sessions: Set<string>, activities: Map<string, object> }} store
 * @returns {{ push: (act: object) => void, disconnectSession: (token: string) => void }}
 */
export function attachRealtime(io, store) {
  /** 同步取得某活動的所有連線（用 room，不用 async 的 fetchSockets，讓推送和 commit 在同一個同步區塊） */
  function socketsOf(code) {
    const ids = io.sockets.adapter.rooms.get(code)
    if (!ids) return []
    return [...ids].map((id) => io.sockets.sockets.get(id)).filter(Boolean)
  }

  const snapshotFor = (act, socket) =>
    socket.data.role === 'teacher' ? teacherSnapshot(act) : studentSnapshot(act, socket.data.clientId)

  /** commit(act) 之後呼叫：對該活動的每條連線各推送一次依角色產生的快照 */
  function push(act) {
    for (const s of socketsOf(act.code)) s.emit('snapshot', snapshotFor(act, s))
  }

  io.use((socket, next) => {
    const { code, role } = socket.handshake.query
    const act = store.activities.get(String(code ?? '').toUpperCase())
    if (!act) return next(new Error('ACTIVITY_NOT_FOUND'))
    const cookies = parseCookies(socket.handshake.headers.cookie)
    if (role === 'teacher') {
      if (!store.sessions.has(cookies.teacher_session)) return next(new Error('UNAUTHORIZED'))
      // 記住使用的 session，登出時才能中斷這條連線
      socket.data = { code: act.code, role: 'teacher', session: cookies.teacher_session }
      return next()
    }
    const member = act.members.get(cookies.client_id)
    if (!member) return next(new Error('NOT_JOINED'))
    socket.data = { code: act.code, role: 'student', clientId: member.clientId }
    next()
  })

  io.on('connection', (socket) => {
    const { code, role, clientId } = socket.data
    // 先加入 room，讓上線所觸發的快照也推給這條新連線
    socket.join(code)
    const act = store.activities.get(code)
    if (role === 'student') memberConnected(act, clientId)

    socket.on('snapshot:request', () => {
      const a = store.activities.get(code)
      if (a) socket.emit('snapshot', snapshotFor(a, socket))
    })

    socket.on('draft:update', (payload = {}) => {
      const a = store.activities.get(code)
      if (!a || role !== 'student') {
        return socket.emit('error', { code: 'NOT_JOINED', message: '請先加入活動' })
      }
      try {
        const { groupId, questionId, round, draft } = updateDraft(a, clientId, payload ?? {})
        // 只推給同組學生，不推給他組或老師（spec「同組草稿」）
        for (const s of socketsOf(code)) {
          if (s.data.role !== 'student') continue
          if (a.members.get(s.data.clientId)?.groupId !== groupId) continue
          s.emit('draft:updated', { questionId, round, draft })
        }
      } catch (err) {
        if (err instanceof AppError) return socket.emit('error', { code: err.code, message: err.message })
        console.error('[server] 處理 draft:update 時發生錯誤：', err?.stack ?? err)
        socket.emit('error', { code: 'INTERNAL_ERROR', message: '發生錯誤，請稍後再試' })
      }
    })

    socket.on('disconnect', () => {
      const a = store.activities.get(code)
      if (a && role === 'student') memberDisconnected(a, clientId)
    })
  })

  /** 老師登出時呼叫：中斷所有使用這個 session 的連線，讓原本的 session 完全失效 */
  function disconnectSession(token) {
    if (!token) return
    for (const s of io.sockets.sockets.values()) {
      if (s.data?.role === 'teacher' && s.data.session === token) s.disconnect(true)
    }
  }

  return { push, disconnectSession }
}
