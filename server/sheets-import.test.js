// 試算表匯入的整合測試（tasks 4.4、5.3）：createServer + fake-sheets，透過真實 HTTP。
// 對應 spec google-sheets-sync「解析試算表網址」「選擇工作表」「動態找出題目表頭」「辨識題目與題號」
// 「辨識作答格與題組子填空」「匯入預覽與 warnings」「匯入錯誤的對應」，以及 quiz-backend 快照的可見性。
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { agent, sheetUrl, startServer } from './testing/testkit.js'
import { createDisabledSheetsClient } from './sheets/google.js'
import { singleSpreadsheet } from './sheets/fixtures/single.js'
import { groupSpreadsheet } from './sheets/fixtures/group.js'
import {
  duplicateNumberGrid,
  explanationGrid,
  multiSheetSpreadsheet,
  noHeaderGrid,
  prefilledAnswerGrid,
  shiftedSingleGrid,
} from './sheets/fixtures/variants.js'

const book = (spreadsheetTitle, ...sheets) => ({ spreadsheetTitle, sheets })

const SPREADSHEETS = {
  '1AbC_x-9': singleSpreadsheet(),
  single: singleSpreadsheet(),
  group: groupSpreadsheet(),
  multi: multiSheetSpreadsheet(),
  shifted: book('平移版面', shiftedSingleGrid()),
  prefilled: book('已有內容', prefilledAnswerGrid()),
  duplicate: book('重複題號', duplicateNumberGrid()),
  noheader: book('沒有表頭', explanationGrid({ sheetId: 0, index: 0 }), { ...noHeaderGrid(), sheetId: 9, index: 1 }),
  readonly: singleSpreadsheet(),
  notshared: singleSpreadsheet(),
}

const cellRefs = (questions) => questions.flatMap((q) => q.blanks.map((b) => b.cellRef))

function expectError(res, status, code) {
  expect(res.status, res.text).toBe(status)
  expect(res.body.error.code).toBe(code)
  expect(typeof res.body.error.message).toBe('string')
}

describe('匯入預覽', () => {
  let srv
  let t
  beforeAll(async () => {
    srv = await startServer({ spreadsheets: SPREADSHEETS })
    t = await srv.teacher()
  })
  afterAll(() => srv.close())

  const importUrl = (url) => t.post('/api/sheets/import', { sheetUrl: url })

  it('一般網址：讀取 sheetId 為 0 的工作表，回應約定的預覽欄位', async () => {
    const res = await importUrl('https://docs.google.com/spreadsheets/d/1AbC_x-9/edit#gid=0')
    expect(res.status).toBe(200)
    expect(Object.keys(res.body).sort()).toEqual(
      ['importId', 'questions', 'sheetUrl', 'spreadsheetTitle', 'warnings', 'worksheetTitle'].sort(),
    )
    expect(typeof res.body.importId).toBe('string')
    expect(res.body.importId.length).toBeGreaterThan(0)
    expect(res.body.sheetUrl).toBe('https://docs.google.com/spreadsheets/d/1AbC_x-9/edit#gid=0')
    expect(res.body.spreadsheetTitle).toBe('軟工期末專案_單題_範例')
    expect(res.body.worksheetTitle).toBe('學習單')
    expect(res.body.warnings).toEqual([])
    // questions 只有 number 與 blanks 的 { label, cellRef }，沒有 row、col 等內部欄位
    for (const q of res.body.questions) {
      expect(Object.keys(q).sort()).toEqual(['blanks', 'number'])
      for (const b of q.blanks) expect(Object.keys(b).sort()).toEqual(['cellRef', 'label'])
    }
  })

  it('前後空白與 ?gid= 的網址也能匯入，sheetUrl 為正規化網址並保留 gid', async () => {
    const res = await importUrl('  https://docs.google.com/spreadsheets/d/single/edit?usp=sharing&gid=0  ')
    expect(res.status).toBe(200)
    expect(res.body.sheetUrl).toBe('https://docs.google.com/spreadsheets/d/single/edit#gid=0')
  })

  it('單題範本：預覽有 6 題，cellRef 為 學習單!G5 到 G15', async () => {
    const res = await importUrl(sheetUrl('single'))
    expect(res.status).toBe(200)
    expect(res.body.questions.map((q) => q.number)).toEqual([1, 2, 3, 4, 5, 6])
    expect(res.body.questions.every((q) => q.blanks.length === 1 && q.blanks[0].label === null)).toBe(true)
    expect(cellRefs(res.body.questions)).toEqual([
      '學習單!G5', '學習單!G7', '學習單!G9', '學習單!G11', '學習單!G13', '學習單!G15',
    ])
  })

  it('題組與單題混合：題組範本預覽有 4 題，子填空為 H5、H6、H8、H9，第 3、4 題為 G11、G13', async () => {
    const res = await importUrl(sheetUrl('group'))
    expect(res.status).toBe(200)
    expect(res.body.spreadsheetTitle).toBe('軟工期末專案_題組_範例')
    expect(res.body.questions).toEqual([
      { number: 1, blanks: [{ label: '（1）', cellRef: '學習單!H5' }, { label: '（2）', cellRef: '學習單!H6' }] },
      { number: 2, blanks: [{ label: '（1）', cellRef: '學習單!H8' }, { label: '（2）', cellRef: '學習單!H9' }] },
      { number: 3, blanks: [{ label: null, cellRef: '學習單!G11' }] },
      { number: 4, blanks: [{ label: null, cellRef: '學習單!G13' }] },
    ])
  })

  it('表頭移到其他位置：平移後的版面也能匯入，cellRef 跟著移動', async () => {
    const res = await importUrl(sheetUrl('shifted'))
    expect(res.status).toBe(200)
    expect(cellRefs(res.body.questions)).toEqual([
      '學習單!I8', '學習單!I10', '學習單!I12', '學習單!I14', '學習單!I16', '學習單!I18',
    ])
  })

  it('第一個工作表是說明頁：沒有 gid 時取第一個有表頭的工作表「學習單」', async () => {
    const res = await importUrl(sheetUrl('multi', null))
    expect(res.status).toBe(200)
    expect(res.body.worksheetTitle).toBe('學習單')
    expect(res.body.spreadsheetTitle).toBe('軟工期末專案_多工作表_範例')
    expect(cellRefs(res.body.questions)[0]).toBe('學習單!G5')
    // 正規化網址指向實際使用的工作表
    expect(res.body.sheetUrl).toBe('https://docs.google.com/spreadsheets/d/multi/edit#gid=2002')
  })

  it('指定 gid 時只解析該工作表', async () => {
    const res = await importUrl(sheetUrl('multi', 3003))
    expect(res.status).toBe(200)
    expect(res.body.worksheetTitle).toBe('題組')
    expect(res.body.sheetUrl).toBe('https://docs.google.com/spreadsheets/d/multi/edit#gid=3003')
    expect(cellRefs(res.body.questions)[0]).toBe('題組!H5')
  })

  it('作答格已有內容：預覽仍然成功，warnings 包含第 2 題的覆寫提醒', async () => {
    const res = await importUrl(sheetUrl('prefilled'))
    expect(res.status).toBe(200)
    expect(res.body.questions).toHaveLength(6)
    expect(res.body.warnings).toContain('第 2 題的填空格原本已有內容，匯出時會被覆寫')
  })

  it('只有檢視權限也能匯入', async () => {
    srv.fake.setPermission('readonly', 'read')
    const res = await importUrl(sheetUrl('readonly'))
    expect(res.status).toBe(200)
    expect(res.body.questions).toHaveLength(6)
  })

  it('每次匯入都產生新的 importId', async () => {
    const a = await importUrl(sheetUrl('single'))
    const b = await importUrl(sheetUrl('single'))
    expect(a.body.importId).not.toBe(b.body.importId)
  })
})

describe('匯入的錯誤', () => {
  let srv
  let t
  beforeAll(async () => {
    srv = await startServer({ spreadsheets: SPREADSHEETS })
    t = await srv.teacher()
  })
  afterAll(() => srv.close())

  const importUrl = (url) => t.post('/api/sheets/import', { sheetUrl: url })

  it('不是 Google 試算表：回應 400 INVALID_SHEET_URL，沒有呼叫 Google', async () => {
    const before = srv.fake.calls.read
    for (const url of ['https://example.com/spreadsheets/d/abc', '', '   ']) {
      expectError(await importUrl(url), 400, 'INVALID_SHEET_URL')
    }
    expectError(await t.post('/api/sheets/import', {}), 400, 'INVALID_SHEET_URL')
    expectError(await t.post('/api/sheets/import', { sheetUrl: 123 }), 400, 'INVALID_SHEET_URL')
    expect(srv.fake.calls.read).toBe(before)
  })

  it('指定的工作表不存在：回應 422 WORKSHEET_NOT_FOUND，details 說明找不到哪個工作表', async () => {
    const res = await importUrl(sheetUrl('single', 12345))
    expectError(res, 422, 'WORKSHEET_NOT_FOUND')
    expect(res.body.error.details).toContain('12345')
  })

  it('沒有表頭：回應 422 PARSE_FAILED「找不到題號/作答表頭」', async () => {
    const res = await importUrl(sheetUrl('noheader', null))
    expectError(res, 422, 'PARSE_FAILED')
    expect(res.body.error.details).toBe('找不到題號/作答表頭')
  })

  it('指定 gid 為說明頁時回應 422 PARSE_FAILED，不改用其他工作表', async () => {
    const res = await importUrl(sheetUrl('multi', 1001))
    expectError(res, 422, 'PARSE_FAILED')
    expect(res.body.error.details).toBe('找不到題號/作答表頭')
  })

  it('題號重複：回應 422 PARSE_FAILED，details 指出第 3 題重複', async () => {
    const res = await importUrl(sheetUrl('duplicate'))
    expectError(res, 422, 'PARSE_FAILED')
    expect(res.body.error.details).toBe('第 3 題的題號重複')
  })

  it('沒有共用：403 SHEET_NOT_SHARED，shareWith 為 service account 的 email', async () => {
    srv.fake.setPermission('notshared', 'none')
    const res = await importUrl(sheetUrl('notshared'))
    expectError(res, 403, 'SHEET_NOT_SHARED')
    expect(res.body.error.shareWith).toBe(srv.fake.shareWith)

    srv.fake.failNext('read', 403)
    const again = await importUrl(sheetUrl('single'))
    expectError(again, 403, 'SHEET_NOT_SHARED')
    expect(again.body.error.shareWith).toBe(srv.fake.shareWith)
  })

  it('找不到試算表：試算表 ID 不存在時回應 404 SHEET_NOT_FOUND', async () => {
    expectError(await importUrl(sheetUrl('does-not-exist')), 404, 'SHEET_NOT_FOUND')
    srv.fake.failNext('read', 404)
    expectError(await importUrl(sheetUrl('single')), 404, 'SHEET_NOT_FOUND')
  })

  it('Google 無法連線：逾時或 5xx 回應 503 SHEETS_UNAVAILABLE', async () => {
    for (const status of ['timeout', 500, 503, 429]) {
      srv.fake.failNext('read', status)
      const res = await importUrl(sheetUrl('single'))
      expectError(res, 503, 'SHEETS_UNAVAILABLE')
      expect(res.body.error.shareWith).toBeUndefined()
    }
    // 失敗不影響之後的匯入
    expect((await importUrl(sheetUrl('single'))).status).toBe(200)
  })

  it('雲端硬碟中未轉換的 .xlsx：回應 422 PARSE_FAILED 並請老師另存為 Google 試算表', async () => {
    srv.fake.failNext('read', 400, { message: 'This operation is not supported for this document' })
    const res = await importUrl(sheetUrl('single'))
    expectError(res, 422, 'PARSE_FAILED')
    expect(res.body.error.details).toContain('Google 試算表')
  })

  it('錯誤回應只有約定的欄位，不含 Google 的原始錯誤內容', async () => {
    srv.fake.failNext('read', 500, { message: 'secret internal google message' })
    const res = await importUrl(sheetUrl('single'))
    expect(Object.keys(res.body)).toEqual(['error'])
    for (const k of Object.keys(res.body.error)) expect(['code', 'message', 'details', 'shareWith']).toContain(k)
    expect(res.text).not.toContain('secret internal google message')
  })

  it('需要老師身分：未登入時回應 401 UNAUTHORIZED，沒有呼叫 Google', async () => {
    const before = srv.fake.calls.read
    const anon = agent(srv.base)
    expectError(await anon.post('/api/sheets/import', { sheetUrl: sheetUrl('single') }), 401, 'UNAUTHORIZED')
    expect(srv.fake.calls.read).toBe(before)
  })
})

describe('沒有設定金鑰', () => {
  let srv
  beforeAll(async () => {
    srv = await startServer({ sheets: createDisabledSheetsClient() })
  })
  afterAll(() => srv.close())

  it('停用的用戶端：匯入回應 503 SHEETS_UNAVAILABLE', async () => {
    const t = await srv.teacher()
    const res = await t.post('/api/sheets/import', { sheetUrl: sheetUrl('single') })
    expectError(res, 503, 'SHEETS_UNAVAILABLE')
  })

  it('停用的用戶端仍會先檢查網址：不合法時回應 400 INVALID_SHEET_URL', async () => {
    const t = await srv.teacher()
    expectError(await t.post('/api/sheets/import', { sheetUrl: 'nope' }), 400, 'INVALID_SHEET_URL')
  })
})

describe('建立活動後的試算表資訊', () => {
  let srv
  beforeAll(async () => {
    srv = await startServer({ spreadsheets: SPREADSHEETS })
  })
  afterAll(() => srv.close())

  it('老師快照的 sheet 正確，學生快照沒有任何試算表資訊', async () => {
    const t = await srv.teacher()
    const snap = await srv.createActivity(t, 'group', 3, 0)
    expect(snap.sheet).toEqual({
      spreadsheetTitle: '軟工期末專案_題組_範例',
      worksheetTitle: '學習單',
      url: 'https://docs.google.com/spreadsheets/d/group/edit#gid=0',
      lastExportedAt: null,
    })
    expect(snap.questions[0].blanks).toEqual([
      { id: 'q1b1', label: '（1）', cellRef: '學習單!H5' },
      { id: 'q1b2', label: '（2）', cellRef: '學習單!H6' },
    ])
    // 內部的寫回目標不出現在老師快照
    const teacherText = JSON.stringify(snap)
    expect(teacherText).not.toContain('"row"')
    expect(teacherText).not.toContain('spreadsheetId')

    const code = snap.activity.code
    const s = await srv.student(code, '小明', 'g1')
    const res = await s.get(`/api/activities/${code}/student`)
    expect(res.status).toBe(200)
    expect(res.body.sheet).toBeUndefined()
    const studentText = res.text
    for (const word of ['cellRef', 'sheet', 'spreadsheet', 'worksheet', '學習單!', 'docs.google.com', '"row"']) {
      expect(studentText).not.toContain(word)
    }
    expect(res.body.questions[0].blanks).toEqual([
      { id: 'q1b1', label: '（1）' },
      { id: 'q1b2', label: '（2）' },
    ])
    // Socket.IO 推送的學生快照也一樣
    const last = s.conn.snapshots.at(-1)
    if (last) expect(JSON.stringify(last)).not.toContain('cellRef')
  })

  it('沒有 gid 匯入多工作表時，老師快照的網址指向實際使用的工作表', async () => {
    const t = await srv.teacher()
    const snap = await srv.createActivity(t, 'multi', 2, null)
    expect(snap.sheet.worksheetTitle).toBe('學習單')
    expect(snap.sheet.url).toBe('https://docs.google.com/spreadsheets/d/multi/edit#gid=2002')
  })
})
