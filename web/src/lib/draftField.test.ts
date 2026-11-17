import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Draft } from '../api/types'
import { DraftField } from './draftField'

const draft = (text: string, rev: number, clientId: string, nickname = clientId): Draft => ({
  blankId: 'b1',
  text,
  rev,
  by: { clientId, nickname },
})

describe('DraftField（design F4）', () => {
  let sent: { text: string; baseRev: number }[]
  let f: DraftField
  beforeEach(() => {
    vi.useFakeTimers()
    sent = []
    f = new DraftField('b1', (text, baseRev) => sent.push({ text, baseRev }))
  })
  afterEach(() => vi.useRealTimers())

  it('300ms 內連續輸入只送出一次，送出最後的內容', () => {
    f.input('C')
    vi.advanceTimersByTime(100)
    f.input('CP')
    vi.advanceTimersByTime(100)
    f.input('CPU')
    vi.advanceTimersByTime(299)
    expect(sent).toEqual([])
    vi.advanceTimersByTime(1)
    expect(sent).toEqual([{ text: 'CPU', baseRev: 0 }])
  })

  it('IME 組字期間不送出；組字結束後 300ms 送出', () => {
    f.compositionStart()
    f.input('ㄓ')
    f.input('ㄓㄨㄥ')
    vi.advanceTimersByTime(1000)
    expect(sent).toEqual([])
    f.compositionEnd('中')
    vi.advanceTimersByTime(300)
    expect(sent).toEqual([{ text: '中', baseRev: 0 }])
  })

  it('沒有本機修改時套用他人的遠端更新', () => {
    f.remote(draft('CPU', 1, 'other'), 'me')
    expect(f.value).toBe('CPU')
    expect(f.lastRev).toBe(1)
  })

  it('打字時（未送出）不被遠端更新覆寫；送出並收到自己的回音後以後端版本為準', () => {
    f.input('我正在打')
    f.remote(draft('別人的字', 1, 'other'), 'me')
    expect(f.value).toBe('我正在打')
    expect(f.pendingRemote?.text).toBe('別人的字')
    vi.advanceTimersByTime(300)
    expect(sent).toEqual([{ text: '我正在打', baseRev: 1 }])
    f.remote(draft('我正在打', 2, 'me'), 'me')
    expect(f.dirty).toBe(false)
    expect(f.value).toBe('我正在打') // 自己較晚寫入，最後寫入者勝出
    expect(f.pendingRemote).toBeNull()
  })

  it('組字中不被遠端更新覆寫', () => {
    f.compositionStart()
    f.remote(draft('x', 1, 'other'), 'me')
    expect(f.value).toBe('')
  })

  it('收到自己的回音時若之後又有新輸入，仍維持 dirty', () => {
    f.input('A')
    vi.advanceTimersByTime(300)
    f.input('AB')
    f.remote(draft('A', 1, 'me'), 'me')
    expect(f.dirty).toBe(true)
    expect(f.value).toBe('AB')
  })

  it('忽略舊版本；快照草稿只在沒有本機修改時套用', () => {
    f.remote(draft('新', 3, 'other'), 'me')
    f.remote(draft('舊', 2, 'other'), 'me')
    expect(f.value).toBe('新')
    f.input('本機')
    f.fromSnapshot(draft('快照', 4, 'other'))
    expect(f.value).toBe('本機')
  })

  it('flush 立即送出未送出的修改', () => {
    f.input('CPU')
    f.flush()
    expect(sent).toEqual([{ text: 'CPU', baseRev: 0 }])
    vi.advanceTimersByTime(500)
    expect(sent).toHaveLength(1)
  })
})
