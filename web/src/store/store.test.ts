import { beforeEach, describe, expect, it, vi } from 'vitest'
import { studentSnap, q } from '../test/fixtures'
import { applySnapshot, resetStore, setResyncHandler, store } from './index'

describe('applySnapshot（漏收事件與版本跳號時重新同步）', () => {
  const resync = vi.fn()
  beforeEach(() => {
    resetStore('student', 'ABC234')
    resync.mockReset()
    setResyncHandler(resync)
  })

  it('整份替換快照', () => {
    applySnapshot(studentSnap({ version: 1, groupLocked: false }))
    const next = studentSnap({ version: 2, groupLocked: true, results: [] })
    expect(applySnapshot(next)).toBe(true)
    expect(store.snapshot).toEqual(next)
    expect(resync).not.toHaveBeenCalled()
  })

  it('舊快照較晚到達：忽略，畫面不變', () => {
    applySnapshot(studentSnap({ version: 12, groupLocked: true }))
    expect(applySnapshot(studentSnap({ version: 11, groupLocked: false }))).toBe(false)
    expect(store.snapshot!.version).toBe(12)
    expect((store.snapshot as { groupLocked: boolean }).groupLocked).toBe(true)
  })

  it('相同版本也忽略', () => {
    applySnapshot(studentSnap({ version: 5 }))
    expect(applySnapshot(studentSnap({ version: 5, groupLocked: true }))).toBe(false)
  })

  it('版本跳號：套用並要求重新同步', () => {
    applySnapshot(studentSnap({ version: 12 }))
    expect(applySnapshot(studentSnap({ version: 15 }))).toBe(true)
    expect(store.snapshot!.version).toBe(15)
    expect(resync).toHaveBeenCalledTimes(1)
  })

  it('第一份快照不視為跳號', () => {
    applySnapshot(studentSnap({ version: 40 }))
    expect(resync).not.toHaveBeenCalled()
  })

  it('記錄最近由進行中變成已結束的題目', () => {
    applySnapshot(studentSnap({ version: 1, currentQuestionId: 'q2', questions: [q('q1', 1, 'closed'), q('q2', 2, 'open')] }))
    applySnapshot(studentSnap({ version: 2, questions: [q('q1', 1, 'closed'), q('q2', 2, 'closed')] }))
    expect(store.ui.lastClosedQuestionId).toBe('q2')
  })
})
