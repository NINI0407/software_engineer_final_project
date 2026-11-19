// Google Sheets 用戶端（change build-quiz-backend，design S1、S2、S6）。
// - 只用 repo 外的 service account 金鑰檔（GOOGLE_SERVICE_ACCOUNT_KEY_FILE），不使用預設憑證（ADC）
// - read() 一次取得所有工作表的顯示值與合併範圍，轉成解析器使用的 Grid
// - writeCells() 用單一的 values.batchUpdate（RAW）寫入
// - Google 的錯誤一律轉成介面約定的 AppError；記錄只含狀態與錯誤代碼，不含回應全文或權杖

import fs from 'node:fs'
import { sheets as sheetsApi, auth as googleAuth } from '@googleapis/sheets'
import { AppError } from '../domain/errors.js'
import { toA1 } from './parser.js'

export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

// design S2：只取標題、工作表屬性、合併範圍與儲存格顯示值
export const READ_FIELDS =
  'properties.title,' +
  'sheets(properties(sheetId,title,index),merges,' +
  'data(startRow,startColumn,rowData(values(formattedValue))))'

const UNSUPPORTED_DOC = /not supported for this document/i

/**
 * 把 Google API 的錯誤歸類（design S6 的列）。
 * @returns {'denied'|'notfound'|'unsupported'|'unavailable'|'other'}
 */
export function googleErrorKind(err) {
  const status = typeof err?.status === 'number' ? err.status : err?.response?.status
  if (typeof status !== 'number') return 'unavailable' // 逾時、網路錯誤
  if (status === 401 || status === 403) return 'denied'
  if (status === 404) return 'notfound'
  const message = err?.response?.data?.error?.message ?? err?.message ?? ''
  if (status === 400 && UNSUPPORTED_DOC.test(message)) return 'unsupported'
  if (status === 429 || status >= 500) return 'unavailable'
  return 'other'
}

/**
 * 依呼叫情境把 Google 錯誤轉成 AppError（design S6 的表格）。
 * @param {unknown} err
 * @param {'import'|'export-read'|'export-write'} phase
 * @param {string|null} shareWith service account 的 email
 */
export function classifyGoogleError(err, phase, shareWith) {
  if (err instanceof AppError) return err
  const kind = googleErrorKind(err)
  const share = shareWith ? { shareWith } : {}
  const unavailable = () => new AppError(503, 'SHEETS_UNAVAILABLE', 'Google 服務暫時無法連線，請稍後再試')
  const writeFailed = () => new AppError(502, 'SHEET_WRITE_FAILED', '寫回失敗，試算表未被修改')

  if (phase === 'import') {
    if (kind === 'denied') return new AppError(403, 'SHEET_NOT_SHARED', '無法讀取此試算表', share)
    if (kind === 'notfound') return new AppError(404, 'SHEET_NOT_FOUND', '找不到這份試算表')
    if (kind === 'unsupported') {
      return new AppError(422, 'PARSE_FAILED', '解析失敗', {
        details: '這份檔案不是 Google 試算表格式，請先在 Google 試算表中「另存為 Google 試算表」後再匯入',
      })
    }
    return unavailable()
  }
  if (phase === 'export-read') {
    if (kind === 'denied') return new AppError(403, 'SHEET_READ_ONLY', '試算表沒有編輯權限', share)
    if (kind === 'notfound') {
      return new AppError(409, 'SHEET_CHANGED', '試算表的題目結構已變更', { details: '找不到原本的試算表' })
    }
    if (kind === 'unsupported') {
      return new AppError(409, 'SHEET_CHANGED', '試算表的題目結構已變更', { details: '原本的試算表已無法讀取' })
    }
    return unavailable()
  }
  // export-write
  if (kind === 'denied') return new AppError(403, 'SHEET_READ_ONLY', '試算表沒有編輯權限', share)
  return writeFailed()
}

/** 只記錄狀態與錯誤代碼，不記錄回應全文、請求標頭或權杖 */
function logGoogleError(phase, err) {
  const status = err?.status ?? err?.response?.status ?? '-'
  const code = err?.response?.data?.error?.status ?? err?.code ?? '-'
  console.warn(`[server] Google API 錯誤（${phase}）：status=${status} code=${code}`)
}

/**
 * 把 spreadsheets.get 回傳的單一工作表轉成 Grid（design S2）。
 * 列與欄從 0 起算，合併範圍的 r1、c1 不含（與 GridRange 相同）。
 */
export function toGrid(sheet) {
  const props = sheet?.properties ?? {}
  const cells = []
  for (const block of sheet?.data ?? []) {
    const r0 = block.startRow ?? 0
    const c0 = block.startColumn ?? 0
    ;(block.rowData ?? []).forEach((row, i) => {
      const r = r0 + i
      ;(row?.values ?? []).forEach((v, j) => {
        const text = v?.formattedValue
        if (text === undefined || text === null || text === '') return
        if (!cells[r]) cells[r] = []
        cells[r][c0 + j] = String(text)
      })
    })
  }
  // 補齊稀疏陣列，避免解析器讀到 undefined
  for (let r = 0; r < cells.length; r++) {
    const row = cells[r] ?? []
    cells[r] = Array.from({ length: row.length }, (_, c) => row[c] ?? '')
  }
  const merges = (sheet?.merges ?? []).map((m) => ({
    r0: m.startRowIndex ?? 0,
    r1: m.endRowIndex ?? 0,
    c0: m.startColumnIndex ?? 0,
    c1: m.endColumnIndex ?? 0,
  }))
  return { sheetId: props.sheetId ?? 0, title: props.title ?? '', index: props.index ?? 0, cells, merges }
}

/** 寫入用的 A1 範圍：工作表名稱以單引號包住並跳脫（不對外顯示，design S3 第 5 點） */
export function quotedRange(worksheetTitle, row, col) {
  return `'${String(worksheetTitle).replace(/'/g, "''")}'!${toA1(row, col)}`
}

/**
 * 讀取 service account 金鑰檔，只取出需要的欄位。
 * 錯誤訊息不包含檔案內容。
 */
export function readServiceAccountKey(keyFile) {
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(keyFile, 'utf8'))
  } catch {
    throw new Error('無法讀取或解析 Google service account 金鑰檔')
  }
  if (!parsed || typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string') {
    throw new Error('Google service account 金鑰檔缺少 client_email 或 private_key')
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key }
}

/**
 * 建立正式的 Google Sheets 用戶端。
 * @param {{ keyFile: string, timeoutMs?: number, api?: object }} options
 *   `api` 只給測試注入假的 Sheets API 物件；正式使用時省略
 */
export function createGoogleSheetsClient({ keyFile, timeoutMs = 10_000, api } = {}) {
  const key = readServiceAccountKey(keyFile)
  const shareWith = key.client_email
  const client =
    api ??
    sheetsApi({
      version: 'v4',
      auth: new googleAuth.GoogleAuth({ credentials: key, scopes: [SHEETS_SCOPE] }),
      timeout: timeoutMs,
    })

  return {
    enabled: true,
    shareWith,

    /**
     * 讀取整份試算表。
     * @param {string} spreadsheetId
     * @param {{ purpose?: 'import'|'export' }} [options]
     * @returns {Promise<{ spreadsheetTitle: string, sheets: object[] }>}
     */
    async read(spreadsheetId, { purpose = 'import' } = {}) {
      const phase = purpose === 'export' ? 'export-read' : 'import'
      try {
        const res = await client.spreadsheets.get({ spreadsheetId, includeGridData: true, fields: READ_FIELDS })
        const data = res.data ?? {}
        return { spreadsheetTitle: data.properties?.title ?? '', sheets: (data.sheets ?? []).map(toGrid) }
      } catch (err) {
        logGoogleError(phase, err)
        throw classifyGoogleError(err, phase, shareWith)
      }
    },

    /**
     * 以單一批次請求寫入所有格子，答案一律以純文字（RAW）保存。
     * @param {string} spreadsheetId
     * @param {string} worksheetTitle 目前的工作表名稱
     * @param {{ row: number, col: number, value: string }[]} cells
     */
    async writeCells(spreadsheetId, worksheetTitle, cells) {
      try {
        await client.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: 'RAW',
            data: cells.map((c) => ({ range: quotedRange(worksheetTitle, c.row, c.col), values: [[c.value]] })),
          },
        })
      } catch (err) {
        logGoogleError('export-write', err)
        throw classifyGoogleError(err, 'export-write', shareWith)
      }
    },
  }
}

/** 沒有設定憑證時使用：所有呼叫都回應 503 SHEETS_UNAVAILABLE（spec「service account 憑證的保管」） */
export function createDisabledSheetsClient() {
  const fail = async () => {
    throw new AppError(503, 'SHEETS_UNAVAILABLE', '後端尚未設定 Google 憑證')
  }
  return { enabled: false, shareWith: null, read: fail, writeCells: fail }
}
