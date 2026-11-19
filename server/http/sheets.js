// 試算表的 REST 路徑：匯入（design S4）與寫回（design S5）。
import express from 'express'
import { randomId } from '../domain/store.js'
import { parseSheetUrl } from '../sheets/url.js'
import { selectAndParse } from '../sheets/parser.js'
import { exportToSheet } from '../sheets/export.js'
import { handle, loadActivity, requireTeacher } from './common.js'

export function sheetsRoutes({ store, sheets }) {
  const r = express.Router()
  const teacherOnly = requireTeacher(store)

  r.post(
    '/sheets/import',
    teacherOnly,
    handle(async (req, res) => {
      const { spreadsheetId, gid } = parseSheetUrl(req.body?.sheetUrl)
      const book = await sheets.read(spreadsheetId, { purpose: 'import' })
      const parsed = selectAndParse(book, gid)
      // 正規化網址一律指向實際使用的工作表
      const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${parsed.sheetId}`
      const importId = randomId(8)
      store.imports.set(importId, {
        spreadsheetId,
        sheetId: parsed.sheetId,
        spreadsheetTitle: book.spreadsheetTitle,
        worksheetTitle: parsed.worksheetTitle,
        sheetUrl,
        questions: parsed.questions,
      })
      res.json({
        importId,
        sheetUrl,
        spreadsheetTitle: book.spreadsheetTitle,
        worksheetTitle: parsed.worksheetTitle,
        questions: parsed.questions.map((q) => ({
          number: q.number,
          blanks: q.blanks.map((b) => ({ label: b.label, cellRef: b.cellRef })),
        })),
        warnings: parsed.warnings,
      })
    }),
  )

  r.post(
    '/activities/:code/export-to-sheet',
    teacherOnly,
    loadActivity(store),
    handle(async (req, res) => {
      res.json(await exportToSheet({ act: req.act, sheets, basedOnVersion: req.body?.basedOnVersion }))
    }),
  )

  return r
}
