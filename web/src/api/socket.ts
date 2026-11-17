import { io, type ManagerOptions, type SocketOptions, type Socket } from 'socket.io-client'
import type { ApiError, DraftUpdatedEvent, DraftUpdatePayload, Snapshot } from './types'

export interface SocketHandlers {
  onSnapshot: (s: Snapshot) => void
  onDraft?: (e: DraftUpdatedEvent) => void
  onError?: (e: Pick<ApiError, 'code' | 'message'>) => void
  onConnectedChange: (connected: boolean) => void
}

export interface LiveSocket {
  socket: Socket
  requestSnapshot: () => void
  sendDraft: (p: DraftUpdatePayload) => void
  close: () => void
}

/**
 * 單一 Socket.IO 連線（design F5）：
 * - 自動重連；被伺服器拒絕（middleware 錯誤）時稍後手動重試
 * - 每次 connect / 重新連線成功都送出 snapshot:request
 */
export function openSocket(
  code: string,
  role: 'teacher' | 'student',
  handlers: SocketHandlers,
  options: { url?: string } & Partial<ManagerOptions & SocketOptions> = {},
): LiveSocket {
  const { url, ...rest } = options
  const opts: Partial<ManagerOptions & SocketOptions> = {
    query: { code, role },
    reconnectionDelay: 300,
    reconnectionDelayMax: 1000,
    ...rest,
  }
  const socket = url ? io(url, opts) : io(opts)
  let closed = false
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  socket.on('connect', () => {
    handlers.onConnectedChange(true)
    socket.emit('snapshot:request', {})
  })
  socket.on('disconnect', (reason) => {
    handlers.onConnectedChange(false)
    // 伺服器主動中斷時，socket.io 不會自動重連
    if (!closed && reason === 'io server disconnect') scheduleRetry()
  })
  socket.on('connect_error', () => {
    handlers.onConnectedChange(false)
    if (!closed && !socket.active) scheduleRetry()
  })
  socket.on('snapshot', (s: Snapshot) => handlers.onSnapshot(s))
  socket.on('draft:updated', (e: DraftUpdatedEvent) => handlers.onDraft?.(e))
  socket.on('error', (e: { code: string; message: string }) => handlers.onError?.(e))

  function scheduleRetry() {
    if (retryTimer) return
    retryTimer = setTimeout(() => {
      retryTimer = null
      if (!closed && !socket.connected) socket.connect()
    }, 500)
  }

  return {
    socket,
    requestSnapshot: () => {
      if (socket.connected) socket.emit('snapshot:request', {})
    },
    sendDraft: (p) => {
      if (socket.connected) socket.emit('draft:update', p)
    },
    close: () => {
      closed = true
      if (retryTimer) clearTimeout(retryTimer)
      socket.close()
    },
  }
}
