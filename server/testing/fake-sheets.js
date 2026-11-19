// 測試用的試算表用戶端（change build-quiz-backend，design B3、B9）。
// 介面與 server/sheets/google.js 的 GoogleSheetsClient 相同（read、writeCells、shareWith），
// 但資料存在記憶體，不發出任何對外連線。只給整合測試與 e2e 專用進入點使用，正式的 server/index.js 不會載入。
//
// 失敗一律先做成「像 Google 回應的錯誤」，再交給 classifyGoogleError()，所以錯誤碼的對應與正式用戶端相同。

import { classifyGoogleError } from '../sheets/google.js'

const googleLikeError = (status, message = 'fake google error') =>
  status === 'timeout'
    ? Object.assign(new Error('timeout of 10000ms exceeded'), { code: 'ETIMEDOUT' })
    : Object.assign(new Error(message), { status, response: { status, data: { error: { message } } } })

/**
 * @param {{ shareWith?: string, spreadsheets?: Record<string, { spreadsheetTitle: string, sheets: object[] }> }} [options]
 */
export function createFakeSheets({ shareWith = 'quiz-bot@fake-project.iam.gserviceaccount.com', spreadsheets = {} } = {}) {
  /** @type {Map<string, { spreadsheetTitle: string, sheets: object[] }>} */
  const books = new Map(Object.entries(spreadsheets).map(([id, s]) => [id, structuredClone(s)]))
  /** id → 'read' | 'write' | 'none'（預設 write） */
  const permissions = new Map()
  /** 依序比對的強制失敗：{ op, status, times } */
  const failures = []
  /** op → 等待中的閘門 Promise（用來模擬 Google 還沒回應） */
  const gates = { read: null, write: null }
  /** 每一次成功寫入的紀錄 */
  const writes = []
  const calls = { read: 0, write: 0 }

  function takeFailure(op) {
    const i = failures.findIndex((f) => f.op === op)
    if (i < 0) return null
    const f = failures[i]
    f.times -= 1
    if (f.times <= 0) failures.splice(i, 1)
    return f
  }

  return {
    enabled: true,
    shareWith,

    async read(spreadsheetId, { purpose = 'import' } = {}) {
      calls.read += 1
      const phase = purpose === 'export' ? 'export-read' : 'import'
      if (gates.read) await gates.read
      const f = takeFailure('read')
      if (f) throw classifyGoogleError(googleLikeError(f.status, f.message), phase, shareWith)
      if (!books.has(spreadsheetId)) throw classifyGoogleError(googleLikeError(404), phase, shareWith)
      if (permissions.get(spreadsheetId) === 'none') throw classifyGoogleError(googleLikeError(403), phase, shareWith)
      return structuredClone(books.get(spreadsheetId))
    },

    async writeCells(spreadsheetId, worksheetTitle, cells) {
      calls.write += 1
      if (gates.write) await gates.write
      const f = takeFailure('write')
      if (f) throw classifyGoogleError(googleLikeError(f.status, f.message), 'export-write', shareWith)
      const book = books.get(spreadsheetId)
      if (!book) throw classifyGoogleError(googleLikeError(404), 'export-write', shareWith)
      if ((permissions.get(spreadsheetId) ?? 'write') !== 'write') {
        throw classifyGoogleError(googleLikeError(403), 'export-write', shareWith)
      }
      const sheet = book.sheets.find((s) => s.title === worksheetTitle)
      if (!sheet) throw classifyGoogleError(googleLikeError(400, 'Unable to parse range'), 'export-write', shareWith)
      // 單一批次：全部套用（失敗都已在上面丟出，所以不會只寫一部分）
      for (const c of cells) {
        while (sheet.cells.length <= c.row) sheet.cells.push([])
        const row = sheet.cells[c.row]
        while (row.length <= c.col) row.push('')
        row[c.col] = c.value
      }
      writes.push({ spreadsheetId, worksheetTitle, cells: cells.map((c) => ({ ...c })) })
    },

    // ---------- 測試用的操作 ----------

    /** 新增或取代一份試算表 */
    set(spreadsheetId, spreadsheet) {
      books.set(spreadsheetId, structuredClone(spreadsheet))
    },
    /** 取得目前的內容（複本） */
    get(spreadsheetId) {
      return structuredClone(books.get(spreadsheetId))
    },
    /** 直接修改內容，例如插入列、刪除或改名工作表 */
    update(spreadsheetId, fn) {
      fn(books.get(spreadsheetId))
    },
    /** 讀取某一格目前的值（列、欄從 0 起算） */
    cell(spreadsheetId, worksheetTitle, row, col) {
      const sheet = books.get(spreadsheetId)?.sheets.find((s) => s.title === worksheetTitle)
      return sheet?.cells[row]?.[col] ?? ''
    },
    /** service account 的權限：'write'（預設）、'read'、'none' */
    setPermission(spreadsheetId, permission) {
      permissions.set(spreadsheetId, permission)
    },
    /** 讓接下來的 read 或 write 回傳指定的 Google 狀態碼（或 'timeout'） */
    failNext(op, status, { times = 1, message } = {}) {
      failures.push({ op, status, times, message })
    },
    /** 讓接下來的 read 或 write 等待，直到呼叫回傳的 release() */
    hold(op) {
      let release
      gates[op] = new Promise((r) => {
        release = () => {
          gates[op] = null
          r()
        }
      })
      return release
    },
    writes,
    calls,
  }
}
