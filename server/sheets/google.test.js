// Google 用戶端：錯誤分類、Grid 轉換、批次寫入（design S2、S6）。不連網，用假的 API 物件。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AppError } from '../domain/errors.js'
import {
  classifyGoogleError,
  createDisabledSheetsClient,
  createGoogleSheetsClient,
  quotedRange,
  READ_FIELDS,
  toGrid,
} from './google.js'

const SHARE = 'quiz-bot@test-project.iam.gserviceaccount.com'
// 假的金鑰內容：只用來測試讀取流程，不是真的金鑰
const FAKE_SECRET = 'not-a-real-secret-0123456789'

let dir
let keyFile
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quiz-google-test-'))
  keyFile = path.join(dir, 'key.json')
  fs.writeFileSync(keyFile, JSON.stringify({ type: 'service_account', client_email: SHARE, private_key: FAKE_SECRET }))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

const gErr = (status, message = 'boom', extra = {}) =>
  Object.assign(new Error(message), {
    status,
    response: { status, data: { error: { message, status: 'SOME_STATUS', secret: FAKE_SECRET } } },
    ...extra,
  })
const timeout = () => Object.assign(new Error('timeout of 10000ms exceeded'), { code: 'ETIMEDOUT' })
const UNSUPPORTED = 'This operation is not supported for this document'

describe('Google 錯誤分類（design S6）', () => {
  const cases = [
    // [情境, 錯誤, 匯入, 寫回讀取, 寫回寫入]
    ['401', gErr(401), ['SHEET_NOT_SHARED', 403], ['SHEET_READ_ONLY', 403], ['SHEET_READ_ONLY', 403]],
    ['403', gErr(403), ['SHEET_NOT_SHARED', 403], ['SHEET_READ_ONLY', 403], ['SHEET_READ_ONLY', 403]],
    ['404', gErr(404), ['SHEET_NOT_FOUND', 404], ['SHEET_CHANGED', 409], ['SHEET_WRITE_FAILED', 502]],
    ['未轉換的 xlsx', gErr(400, UNSUPPORTED), ['PARSE_FAILED', 422], ['SHEET_CHANGED', 409], ['SHEET_WRITE_FAILED', 502]],
    ['429', gErr(429), ['SHEETS_UNAVAILABLE', 503], ['SHEETS_UNAVAILABLE', 503], ['SHEET_WRITE_FAILED', 502]],
    ['500', gErr(500), ['SHEETS_UNAVAILABLE', 503], ['SHEETS_UNAVAILABLE', 503], ['SHEET_WRITE_FAILED', 502]],
    ['503', gErr(503), ['SHEETS_UNAVAILABLE', 503], ['SHEETS_UNAVAILABLE', 503], ['SHEET_WRITE_FAILED', 502]],
    ['逾時', timeout(), ['SHEETS_UNAVAILABLE', 503], ['SHEETS_UNAVAILABLE', 503], ['SHEET_WRITE_FAILED', 502]],
  ]
  for (const [name, err, imp, read, write] of cases) {
    it(`${name}：匯入 ${imp[0]}、寫回讀取 ${read[0]}、寫回寫入 ${write[0]}`, () => {
      for (const [phase, [code, status]] of [
        ['import', imp],
        ['export-read', read],
        ['export-write', write],
      ]) {
        const e = classifyGoogleError(err, phase, SHARE)
        expect(e).toBeInstanceOf(AppError)
        expect([e.code, e.status]).toEqual([code, status])
      }
    })
  }

  it('權限不足時附上 shareWith', () => {
    expect(classifyGoogleError(gErr(403), 'import', SHARE).shareWith).toBe(SHARE)
    expect(classifyGoogleError(gErr(403), 'export-read', SHARE).shareWith).toBe(SHARE)
    expect(classifyGoogleError(gErr(403), 'export-write', SHARE).shareWith).toBe(SHARE)
  })

  it('未轉換的 xlsx 在匯入時提示另存為 Google 試算表', () => {
    expect(classifyGoogleError(gErr(400, UNSUPPORTED), 'import', SHARE).details).toMatch('另存為 Google 試算表')
  })

  it('錯誤回應中沒有 Google 原始錯誤的內容', () => {
    for (const phase of ['import', 'export-read', 'export-write']) {
      for (const status of [400, 403, 404, 500]) {
        const body = JSON.stringify(classifyGoogleError(gErr(status, `raw ${FAKE_SECRET}`), phase, SHARE).toBody())
        expect(body).not.toContain(FAKE_SECRET)
        expect(body).not.toContain('raw ')
        expect(Object.keys(JSON.parse(body).error).every((k) => ['code', 'message', 'details', 'shareWith'].includes(k))).toBe(true)
      }
    }
  })

  it('已經是 AppError 時原樣傳回', () => {
    const e = new AppError(422, 'PARSE_FAILED', 'x', { details: 'y' })
    expect(classifyGoogleError(e, 'import', SHARE)).toBe(e)
  })
})

describe('Grid 轉換（design S2）', () => {
  it('把顯示值與合併範圍轉成從 0 起算的 Grid，省略的索引視為 0', () => {
    const grid = toGrid({
      properties: { sheetId: 7, title: '學習單', index: 1 },
      merges: [
        { sheetId: 7, startRowIndex: 3, endRowIndex: 4, startColumnIndex: 6, endColumnIndex: 8 },
        { sheetId: 7, endRowIndex: 1, endColumnIndex: 2 },
      ],
      data: [
        {
          rowData: [
            { values: [{ formattedValue: 'A1' }] },
            {},
            { values: [{}, { formattedValue: '題號' }, { formattedValue: 1 }] },
          ],
        },
      ],
    })
    expect(grid.sheetId).toBe(7)
    expect(grid.title).toBe('學習單')
    expect(grid.index).toBe(1)
    expect(grid.cells[0]).toEqual(['A1'])
    expect(grid.cells[1]).toEqual([])
    expect(grid.cells[2]).toEqual(['', '題號', '1'])
    expect(grid.merges).toEqual([
      { r0: 3, r1: 4, c0: 6, c1: 8 },
      { r0: 0, r1: 1, c0: 0, c1: 2 },
    ])
  })

  it('有起始列、起始欄的資料區塊', () => {
    const grid = toGrid({ properties: { sheetId: 0, title: 'S' }, data: [{ startRow: 2, startColumn: 1, rowData: [{ values: [{ formattedValue: 'x' }] }] }] })
    expect(grid.cells[2][1]).toBe('x')
    expect(grid.cells[2][0]).toBe('')
  })
})

describe('寫入範圍', () => {
  it('工作表名稱以單引號包住，名稱中的單引號重複一次', () => {
    expect(quotedRange('學習單', 4, 6)).toBe("'學習單'!G5")
    expect(quotedRange("Tom's", 0, 0)).toBe("'Tom''s'!A1")
  })
})

describe('GoogleSheetsClient', () => {
  function fakeApi() {
    return {
      calls: [],
      spreadsheets: {
        get: vi.fn(async () => ({
          data: {
            properties: { title: '軟工期末專案_單題_範例' },
            sheets: [{ properties: { sheetId: 0, title: '學習單', index: 0 }, merges: [], data: [{ rowData: [] }] }],
          },
        })),
        values: { batchUpdate: vi.fn(async () => ({ data: {} })) },
      },
    }
  }

  it('shareWith 取自金鑰的 client_email', () => {
    const c = createGoogleSheetsClient({ keyFile, api: fakeApi() })
    expect(c.enabled).toBe(true)
    expect(c.shareWith).toBe(SHARE)
  })

  it('讀取時使用 includeGridData 與欄位遮罩，回傳標題與 Grid', async () => {
    const api = fakeApi()
    const c = createGoogleSheetsClient({ keyFile, api })
    const s = await c.read('abc')
    expect(api.spreadsheets.get).toHaveBeenCalledWith({ spreadsheetId: 'abc', includeGridData: true, fields: READ_FIELDS })
    expect(s.spreadsheetTitle).toBe('軟工期末專案_單題_範例')
    expect(s.sheets[0]).toMatchObject({ sheetId: 0, title: '學習單' })
  })

  it('寫入使用單一 batchUpdate 與 RAW，答案以純文字保存', async () => {
    const api = fakeApi()
    const c = createGoogleSheetsClient({ keyFile, api })
    await c.writeCells('abc', '學習單', [
      { row: 4, col: 6, value: '=1+1' },
      { row: 6, col: 6, value: '007' },
    ])
    expect(api.spreadsheets.values.batchUpdate).toHaveBeenCalledTimes(1)
    expect(api.spreadsheets.values.batchUpdate).toHaveBeenCalledWith({
      spreadsheetId: 'abc',
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          { range: "'學習單'!G5", values: [['=1+1']] },
          { range: "'學習單'!G7", values: [['007']] },
        ],
      },
    })
  })

  it('讀取失敗依用途分類：匯入 403 為 SHEET_NOT_SHARED，寫回讀取 403 為 SHEET_READ_ONLY', async () => {
    const api = fakeApi()
    api.spreadsheets.get.mockRejectedValue(gErr(403))
    const c = createGoogleSheetsClient({ keyFile, api })
    await expect(c.read('abc')).rejects.toMatchObject({ code: 'SHEET_NOT_SHARED', shareWith: SHARE })
    await expect(c.read('abc', { purpose: 'export' })).rejects.toMatchObject({ code: 'SHEET_READ_ONLY' })
  })

  it('寫入失敗：403 為 SHEET_READ_ONLY，其他為 SHEET_WRITE_FAILED', async () => {
    const api = fakeApi()
    const c = createGoogleSheetsClient({ keyFile, api })
    api.spreadsheets.values.batchUpdate.mockRejectedValueOnce(gErr(403))
    await expect(c.writeCells('abc', 'S', [{ row: 0, col: 0, value: 'x' }])).rejects.toMatchObject({ code: 'SHEET_READ_ONLY' })
    api.spreadsheets.values.batchUpdate.mockRejectedValueOnce(gErr(500))
    await expect(c.writeCells('abc', 'S', [{ row: 0, col: 0, value: 'x' }])).rejects.toMatchObject({ code: 'SHEET_WRITE_FAILED' })
  })

  it('記錄中只有狀態與錯誤代碼，沒有原始內容', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warn.mockClear()
    const api = fakeApi()
    api.spreadsheets.get.mockRejectedValue(gErr(500, `raw ${FAKE_SECRET}`))
    const c = createGoogleSheetsClient({ keyFile, api })
    await expect(c.read('abc')).rejects.toMatchObject({ code: 'SHEETS_UNAVAILABLE' })
    const logged = warn.mock.calls.flat().join(' ')
    expect(logged).toContain('status=500')
    expect(logged).not.toContain(FAKE_SECRET)
  })

  it('金鑰檔無法讀取時丟出錯誤，訊息不含檔案內容', () => {
    const bad = path.join(dir, 'bad.json')
    // 故意寫入不完整的 JSON（去掉最後的 }）
    fs.writeFileSync(bad, JSON.stringify({ private_key: FAKE_SECRET }).slice(0, -1))
    expect(() => createGoogleSheetsClient({ keyFile: bad })).toThrow(/金鑰檔/)
    try {
      createGoogleSheetsClient({ keyFile: bad })
    } catch (e) {
      expect(String(e.message)).not.toContain(FAKE_SECRET)
    }
    expect(() => createGoogleSheetsClient({ keyFile: path.join(dir, 'missing.json') })).toThrow(/金鑰檔/)
  })
})

describe('沒有設定憑證', () => {
  it('匯入與寫回都回應 503 SHEETS_UNAVAILABLE', async () => {
    const c = createDisabledSheetsClient()
    expect(c.enabled).toBe(false)
    expect(c.shareWith).toBe(null)
    await expect(c.read('abc')).rejects.toMatchObject({ status: 503, code: 'SHEETS_UNAVAILABLE' })
    await expect(c.writeCells('abc', 'S', [])).rejects.toMatchObject({ status: 503, code: 'SHEETS_UNAVAILABLE' })
  })
})
