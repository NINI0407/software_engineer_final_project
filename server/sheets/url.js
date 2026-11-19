// Google 試算表網址解析（spec google-sheets-sync「解析試算表網址」，tasks 2.1）。
// 純函式，不連網；不合法的網址在呼叫 Google 之前就擋下。

import { AppError } from '../domain/errors.js'

// 只接受 https://docs.google.com/spreadsheets/d/<id> 開頭，id 後面必須是結尾或 / ? #
const SHEET_URL = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?=$|[/?#])/
const HASH_GID = /#(?:.*&)?gid=(\d+)/
const QUERY_GID = /\?(?:[^#]*&)?gid=(\d+)/

const invalid = () => new AppError(400, 'INVALID_SHEET_URL', '這不是有效的 Google 試算表網址')

/**
 * 解析老師貼上的試算表網址。
 * `#gid=` 優先於 `?gid=`（Google 的分享網址常常兩者都有，而且值相同）。
 * @param {unknown} url
 * @returns {{ spreadsheetId: string, gid: number | null, normalizedUrl: string }}
 */
export function parseSheetUrl(url) {
  if (typeof url !== 'string') throw invalid()
  const text = url.trim()
  const m = SHEET_URL.exec(text)
  if (!m) throw invalid()

  const spreadsheetId = m[1]
  const rest = text.slice(m[0].length)
  const gidText = (HASH_GID.exec(rest) ?? QUERY_GID.exec(rest))?.[1]
  const gid = gidText === undefined ? null : Number(gidText)
  if (gid !== null && !Number.isSafeInteger(gid)) throw invalid()

  const base = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
  return { spreadsheetId, gid, normalizedUrl: gid === null ? base : `${base}#gid=${gid}` }
}
