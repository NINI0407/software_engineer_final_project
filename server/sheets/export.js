// 寫回試算表的流程（change build-quiz-backend，design S5；spec google-sheets-sync）。
//
//  1. 寫回鎖  2. STALE_VERSION  3. 寫入計畫 / NOTHING_TO_EXPORT
//  4. 上鎖  5. 重新讀取，依 sheetId 找工作表  6. 重新解析並逐題比對
//  7. 單一批次寫入（RAW）  8. 成功：更新 lastExportedAt 並 commit  finally：解鎖
import { AppError } from '../domain/errors.js'
import { exportPlan, markExported } from '../domain/activity.js'
import { parseGuidedNotes } from './parser.js'

const changed = (details) => new AppError(409, 'SHEET_CHANGED', '試算表的題目結構已變更，未寫入任何資料', { details })

/**
 * 比對建立活動時的題目與重新解析的結果；相同時回傳 null，不同時回傳第一個不同之處的說明。
 * 只比對題號、子填空數量與作答格的列、欄，不比對工作表名稱（改名後仍可寫回）。
 * @param {{ number: number, blanks: { row: number, col: number }[] }[]} expected
 * @param {{ number: number, blanks: { row: number, col: number }[] }[]} actual
 */
export function compareStructure(expected, actual) {
  const byNumber = new Map(actual.map((q) => [q.number, q]))
  for (const q of expected) {
    const now = byNumber.get(q.number)
    if (!now) return `第 ${q.number} 題已不存在`
    if (now.blanks.length !== q.blanks.length) return `第 ${q.number} 題的子填空數量已改變`
    if (q.blanks.some((b, i) => b.row !== now.blanks[i].row || b.col !== now.blanks[i].col)) {
      return `第 ${q.number} 題的作答格位置已改變`
    }
  }
  if (actual.length !== expected.length) {
    return `題數已改變（建立活動時 ${expected.length} 題，現在 ${actual.length} 題）`
  }
  return null
}

/**
 * @param {{ act: object, sheets: object, basedOnVersion: unknown, now?: () => Date }} options
 * @returns {Promise<{ sheetUrl: string, writtenCells: number, skippedQuestions: number[], exportedAt: string }>}
 */
export async function exportToSheet({ act, sheets, basedOnVersion, now = () => new Date() }) {
  if (act.exporting) throw new AppError(409, 'EXPORT_IN_PROGRESS', '正在寫回中，請稍候')
  if (!Number.isInteger(basedOnVersion) || act.resultsVersion > basedOnVersion) {
    throw new AppError(409, 'STALE_VERSION', '結果已更新，請重新確認')
  }
  // 寫入計畫在這裡就固定：等待 Google 期間結果再變動，也只寫入老師確認時的內容
  const plan = exportPlan(act)
  if (plan.cells.length === 0) throw new AppError(409, 'NOTHING_TO_EXPORT', '目前沒有可寫回的結果')

  act.exporting = true
  try {
    const book = await sheets.read(act.target.spreadsheetId, { purpose: 'export' })
    const grid = book.sheets.find((s) => s.sheetId === act.target.sheetId)
    if (!grid) throw changed('找不到原本的工作表，可能已被刪除')

    let parsed
    try {
      parsed = parseGuidedNotes(grid)
    } catch (err) {
      if (err instanceof AppError && err.code === 'PARSE_FAILED') {
        throw changed(`試算表已無法解析：${err.details ?? err.message}`)
      }
      throw err
    }
    const diff = compareStructure(act.questions, parsed.questions)
    if (diff) throw changed(diff)

    // 依目前的工作表名稱寫入（工作表改名後仍寫到同一個工作表）
    await sheets.writeCells(
      act.target.spreadsheetId,
      grid.title,
      plan.cells.map((c) => ({ row: c.row, col: c.col, value: c.value })),
    )

    const exportedAt = now().toISOString()
    markExported(act, exportedAt)
    return {
      sheetUrl: act.sheet.url,
      writtenCells: plan.cells.length,
      skippedQuestions: plan.skippedQuestions,
      exportedAt,
    }
  } finally {
    act.exporting = false
  }
}
