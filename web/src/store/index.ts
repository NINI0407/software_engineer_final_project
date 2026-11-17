import { reactive } from 'vue'
import type { Snapshot } from '../api/types'

/**
 * 前端狀態（design D9）
 * - snapshot：唯讀，只能透過 applySnapshot 整份替換
 * - ui：本機 UI 狀態（連線狀態、結束順序等）
 * 不把 store 掛到 window 上（design F6）。
 */
export const store = reactive({
  role: null as 'teacher' | 'student' | null,
  code: null as string | null,
  snapshot: null as Snapshot | null,
  ui: {
    socketActive: false,
    connected: false,
    /** 本機觀察到最近一個由進行中變成已結束的題目 */
    lastClosedQuestionId: null as string | null,
  },
})

type Listener = (next: Snapshot, prev: Snapshot | null) => void
const listeners = new Set<Listener>()
let resync: () => void = () => {}

export function onSnapshot(fn: Listener) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function setResyncHandler(fn: () => void) {
  resync = fn
}

export function requestResync() {
  resync()
}

export function resetStore(role: 'teacher' | 'student' | null = null, code: string | null = null) {
  store.role = role
  store.code = code
  store.snapshot = null
  store.ui.connected = false
  store.ui.socketActive = false
  store.ui.lastClosedQuestionId = null
}

/**
 * 套用快照：
 * - version 不大於目前值 → 忽略，回傳 false
 * - 否則整份替換；若版本跳號（大於目前值 + 1）→ 要求重新同步
 */
export function applySnapshot(next: Snapshot): boolean {
  const prev = store.snapshot as Snapshot | null
  const cur = prev?.version ?? 0
  if (prev && next.version <= cur) return false

  if (prev) {
    for (const q of next.questions) {
      const before = prev.questions.find((p) => p.id === q.id)
      if (q.status === 'closed' && before && before.status === 'open') {
        store.ui.lastClosedQuestionId = q.id
      }
    }
  }
  store.snapshot = next
  if (prev && next.version > cur + 1) requestResync()
  for (const l of listeners) l(next, prev)
  return true
}
