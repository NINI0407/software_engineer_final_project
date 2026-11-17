/**
 * 組別 Cookie（design F2）：`group_<代號>` 只用來在重新整理後預選下拉選單。
 * 畫面上的組別一律以後端快照為準，不一致時以快照覆寫。
 */

export const groupCookieName = (code: string) => `group_${code}`

export function readGroupCookie(code: string, doc: Document = document): string | null {
  const name = groupCookieName(code)
  for (const part of doc.cookie.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}

export function writeGroupCookie(code: string, groupId: string, doc: Document = document) {
  doc.cookie = `${groupCookieName(code)}=${encodeURIComponent(groupId)}; path=/; SameSite=Lax; max-age=86400`
}

/** 快照中的組別與 Cookie 不一致時，以快照覆寫 Cookie；回傳是否有覆寫 */
export function syncGroupCookie(code: string, snapshotGroupId: string | null, doc: Document = document) {
  if (!snapshotGroupId) return false
  if (readGroupCookie(code, doc) === snapshotGroupId) return false
  writeGroupCookie(code, snapshotGroupId, doc)
  return true
}
