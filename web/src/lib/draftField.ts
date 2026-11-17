import type { Draft } from '../api/types'

export const DRAFT_DEBOUNCE_MS = 300

/**
 * 單一子填空的草稿編輯狀態（design F4）
 * - 輸入後 300ms 才送出；IME 組字期間不送出
 * - 本機有未送出的修改（dirty）或正在組字時，不套用他人的遠端更新，先暫存為 pendingRemote
 * - 收到自己的回音且之後沒有新修改 → 不再 dirty，以後端廣播的版本為準（最後寫入者勝出）
 */
export class DraftField {
  value = ''
  dirty = false
  composing = false
  pendingRemote: Draft | null = null
  lastRev = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    readonly blankId: string,
    private readonly send: (text: string, baseRev: number) => void,
    private readonly delay = DRAFT_DEBOUNCE_MS,
  ) {}

  input(text: string) {
    this.value = text
    this.dirty = true
    if (!this.composing) this.schedule()
  }

  compositionStart() {
    this.composing = true
    this.clearTimer()
  }

  compositionEnd(text: string) {
    this.composing = false
    this.input(text)
  }

  /** 立即送出尚未送出的修改（例如按下送出前） */
  flush() {
    this.clearTimer()
    if (!this.dirty || this.composing) return
    this.send(this.value, this.lastRev)
  }

  /** draft:updated 事件 */
  remote(d: Draft, myClientId: string) {
    if (d.rev <= this.lastRev) return
    this.lastRev = d.rev
    if (d.by.clientId === myClientId) {
      if (!this.timer && !this.composing && this.value === d.text) {
        this.dirty = false
        const p = this.pendingRemote
        this.pendingRemote = null
        if (p && p.rev > d.rev) this.value = p.text
      }
      return
    }
    if (this.dirty || this.composing) {
      this.pendingRemote = d
      return
    }
    this.value = d.text
  }

  /** 快照中的草稿（例如重新連線後）：只在沒有本機修改時套用 */
  fromSnapshot(d: Draft) {
    if (d.rev <= this.lastRev) return
    this.lastRev = d.rev
    if (!this.dirty && !this.composing) this.value = d.text
  }

  get hasPendingSend() {
    return this.timer !== null
  }

  dispose() {
    this.clearTimer()
  }

  private schedule() {
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, this.delay)
  }

  private clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
