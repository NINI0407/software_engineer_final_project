import { openSocket, type LiveSocket } from '../api/socket'
import type { DraftUpdatedEvent, DraftUpdatePayload, Snapshot } from '../api/types'
import { applySnapshot, resetStore, setResyncHandler, store } from './index'

/**
 * 把 Socket.IO 連線接到 store：
 * - snapshot → applySnapshot
 * - 版本跳號 / REST 403、409 → snapshot:request（requestResync）
 * - draft:updated 的題目或輪次與目前快照不一致 → 重新同步，否則交給草稿監聽者
 */
let live: LiveSocket | null = null
const draftListeners = new Set<(e: DraftUpdatedEvent) => void>()

export function onDraftUpdated(fn: (e: DraftUpdatedEvent) => void) {
  draftListeners.add(fn)
  return () => draftListeners.delete(fn)
}

export function startLive(code: string, role: 'teacher' | 'student', initial?: Snapshot) {
  stopLive()
  resetStore(role, code)
  if (initial) applySnapshot(initial)
  store.ui.socketActive = true
  live = openSocket(code, role, {
    onConnectedChange: (c) => (store.ui.connected = c),
    onSnapshot: (s) => applySnapshot(s),
    onDraft: (e) => {
      const s = store.snapshot
      const q = s?.currentQuestionId ? s.questions.find((x) => x.id === s.currentQuestionId) : null
      if (!q || q.id !== e.questionId || q.round !== e.round) {
        live?.requestSnapshot()
        return
      }
      for (const l of draftListeners) l(e)
    },
  })
  setResyncHandler(() => live?.requestSnapshot())
}

export function sendDraft(p: DraftUpdatePayload) {
  live?.sendDraft(p)
}

export function stopLive() {
  live?.close()
  live = null
  setResyncHandler(() => {})
  store.ui.socketActive = false
  store.ui.connected = false
}
