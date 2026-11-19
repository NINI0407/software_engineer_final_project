// Guided Notes 題目解析器（design S3，spec google-sheets-sync，tasks 2.3）。
// 純函式：輸入 design S2 的 Grid，輸出題目、填空的作答格與 warnings；不連 Google、不寫死任何位置。
//
// Grid = { sheetId, title, index, cells: string[][], merges: { r0, r1, c0, c1 }[] }
// 欄列都從 0 起算，r1、c1 不含（與 Google GridRange 相同）；cells[r] 可能較短或不存在，沒有值視為 ''。

import { AppError } from '../domain/errors.js'

// 比對前去掉的空白：一般空白、全形空白、零寬字元與 BOM
const ALL_SPACES = /[\s\u3000\u200B\u200C\u200D\uFEFF]/g
const EDGE_SPACES = /^[\s\u3000\u200B\u200C\u200D\uFEFF]+|[\s\u3000\u200B\u200C\u200D\uFEFF]+$/g

const QUESTION_NUMBER = /^(?:第)?(\d+)(?:\.0+)?(?:題|\.|、|．)?$/
const BLANK_LABEL = /^[（(]\d+[）)]$/

export const NO_HEADER_DETAILS = '找不到題號/作答表頭'

const parseFailed = (details) => new AppError(422, 'PARSE_FAILED', '解析失敗', { details })

/** 從 0 起算的欄列轉成 A1，例如 (4, 6) -> 'G5'；支援 Z 以後的欄（AA、AB…） */
export function toA1(row, col) {
  let letters = ''
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters
  }
  return `${letters}${row + 1}`
}

const compact = (text) => text.replace(ALL_SPACES, '')
const trimSpaces = (text) => text.replace(EDGE_SPACES, '')

function cellText(grid, row, col) {
  const value = grid.cells[row]?.[col]
  return value === undefined || value === null ? '' : String(value)
}

/** 回傳包含 (row, col) 的合併範圍；沒有合併時是只含這一格的範圍 */
function mergeAt(grid, row, col) {
  const merge = grid.merges.find((m) => m.r0 <= row && row < m.r1 && m.c0 <= col && col < m.c1)
  return merge ?? { r0: row, r1: row + 1, c0: col, c1: col + 1 }
}

function rowCount(grid) {
  return grid.merges.reduce((max, m) => Math.max(max, m.r1), grid.cells.length)
}

/**
 * S3 第 1 步：由上往下找第一個同時有「題號」與「作答」儲存格的列。
 * @returns {{ row: number, numberCol: number, answerStart: number, answerEnd: number } | null}
 */
function findHeader(grid) {
  for (let row = 0; row < grid.cells.length; row += 1) {
    const line = grid.cells[row] ?? []
    let numberCol = -1
    let answerCol = -1
    for (let col = 0; col < line.length; col += 1) {
      const text = compact(cellText(grid, row, col))
      if (text === '題號' && numberCol < 0) numberCol = col
      if (text === '作答' && answerCol < 0) answerCol = col
    }
    if (numberCol >= 0 && answerCol >= 0) {
      const area = mergeAt(grid, row, answerCol)
      return { row, numberCol, answerStart: area.c0, answerEnd: area.c1 }
    }
  }
  return null
}

/** 這個工作表是否找得到題目表頭（選擇工作表時使用） */
export function hasHeader(grid) {
  return findHeader(grid) !== null
}

function blankAt(grid, label, row, col) {
  return { label, row, col, cellRef: `${grid.title}!${toA1(row, col)}` }
}

/**
 * S3 第 3 步：找出一題（涵蓋 rowStart 到 rowEnd - 1 列）的填空。
 * 作答區第一格是「（1）」之類的標籤時是子填空；都沒有標籤時是單一填空。
 */
function findBlanks(grid, header, number, rowStart, rowEnd) {
  const blanks = []
  const seenLabels = new Set()
  for (let row = rowStart; row < rowEnd; row += 1) {
    const first = mergeAt(grid, row, header.answerStart)
    const text = trimSpaces(cellText(grid, first.r0, first.c0))
    if (!BLANK_LABEL.test(compact(text))) continue
    // 標籤格跨多列時只算一次
    const key = `${first.r0},${first.c0}`
    if (seenLabels.has(key)) continue
    seenLabels.add(key)

    if (first.c1 >= header.answerEnd) throw parseFailed(`第 ${number} 題的${text}找不到作答格`)
    const target = mergeAt(grid, row, first.c1)
    blanks.push(blankAt(grid, text, target.r0, target.c0))
  }
  if (blanks.length === 0) {
    const first = mergeAt(grid, rowStart, header.answerStart)
    blanks.push(blankAt(grid, null, first.r0, first.c0))
  }
  return blanks
}

/** 把缺少的題號整理成「3、5 到 7」的文字 */
function describeMissing(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b)
  const parts = []
  let prev = 0
  for (const n of sorted) {
    if (n - prev === 2) parts.push(`${prev + 1}`)
    else if (n - prev > 2) parts.push(`${prev + 1} 到 ${n - 1}`)
    prev = n
  }
  return parts.join('、')
}

/**
 * 解析一個工作表（design S3）。
 * @param {{ sheetId: number, title: string, cells: string[][], merges: { r0: number, r1: number, c0: number, c1: number }[] }} grid
 * @returns {{ questions: { number: number, blanks: { label: string|null, row: number, col: number, cellRef: string }[] }[],
 *             warnings: string[] }}
 * @throws {AppError} 422 PARSE_FAILED，details 說明原因
 */
export function parseGuidedNotes(grid) {
  const header = findHeader(grid)
  if (!header) throw parseFailed(NO_HEADER_DETAILS)

  // S3 第 2 步：從表頭下一列開始找題號；已屬於上一題的列跳過
  const questions = []
  const numbers = new Set()
  const total = rowCount(grid)
  let row = header.row + 1
  while (row < total) {
    const match = QUESTION_NUMBER.exec(compact(cellText(grid, row, header.numberCol)))
    const number = match ? Number(match[1]) : 0
    if (!Number.isSafeInteger(number) || number <= 0) {
      row += 1
      continue
    }
    if (numbers.has(number)) throw parseFailed(`第 ${number} 題的題號重複`)
    numbers.add(number)

    const rowEnd = Math.max(mergeAt(grid, row, header.numberCol).r1, row + 1)
    questions.push({ number, blanks: findBlanks(grid, header, number, row, rowEnd) })
    row = rowEnd
  }

  // S3 第 4 步：檢查
  if (questions.length === 0) throw parseFailed('找不到任何題目：「題號」欄下方沒有正整數題號')

  const warnings = []
  const missing = describeMissing(numbers)
  if (missing) warnings.push(`題號不連續：缺少第 ${missing} 題`)
  for (const q of questions) {
    if (q.blanks.some((b) => compact(cellText(grid, b.row, b.col)) !== '')) {
      warnings.push(`第 ${q.number} 題的填空格原本已有內容，匯出時會被覆寫`)
    }
  }
  return { questions, warnings }
}

/**
 * 選擇工作表並解析（spec「選擇工作表」）。
 * 有 gid 時只解析 sheetId 相同的工作表；沒有 gid 時依 index 順序取第一個有表頭的工作表。
 * @param {{ spreadsheetTitle: string, sheets: object[] }} spreadsheet
 * @param {number|null|undefined} gid
 * @returns {{ sheetId: number, worksheetTitle: string, questions: object[], warnings: string[] }}
 */
export function selectAndParse(spreadsheet, gid) {
  const sheets = [...spreadsheet.sheets].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  let grid
  if (gid !== null && gid !== undefined) {
    grid = sheets.find((s) => s.sheetId === gid)
    if (!grid) {
      throw new AppError(422, 'WORKSHEET_NOT_FOUND', '找不到指定的工作表', {
        details: `找不到 gid 為 ${gid} 的工作表`,
      })
    }
  } else {
    grid = sheets.find(hasHeader)
    if (!grid) throw parseFailed(NO_HEADER_DETAILS)
  }
  const { questions, warnings } = parseGuidedNotes(grid)
  return { sheetId: grid.sheetId, worksheetTitle: grid.title, questions, warnings }
}
