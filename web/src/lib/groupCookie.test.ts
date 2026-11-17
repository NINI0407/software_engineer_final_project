// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { readGroupCookie, syncGroupCookie, writeGroupCookie } from './groupCookie'

function clearCookies() {
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0].trim()
    if (name) document.cookie = `${name}=; path=/; max-age=0`
  }
}

describe('組別 Cookie（design F2）', () => {
  beforeEach(clearCookies)

  it('寫入 group_<代號>', () => {
    writeGroupCookie('ABC234', 'g3')
    expect(document.cookie).toContain('group_ABC234=g3')
    expect(readGroupCookie('ABC234')).toBe('g3')
    expect(readGroupCookie('OTHER1')).toBeNull()
  })

  it('Cookie 被竄改：以快照的組別覆寫', () => {
    writeGroupCookie('ABC234', 'g5')
    expect(syncGroupCookie('ABC234', 'g2')).toBe(true)
    expect(readGroupCookie('ABC234')).toBe('g2')
  })

  it('一致或快照沒有組別時不覆寫', () => {
    writeGroupCookie('ABC234', 'g2')
    expect(syncGroupCookie('ABC234', 'g2')).toBe(false)
    expect(syncGroupCookie('ABC234', null)).toBe(false)
    expect(readGroupCookie('ABC234')).toBe('g2')
  })
})
