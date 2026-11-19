// 寫回試算表的整合測試（tasks 5.2）：createServer + fake-sheets，透過真實 HTTP 與 Socket.IO。
// 對應 spec google-sheets-sync「寫回的內容」「答案以純文字寫入」「確認後結果變動」「寫回前比對試算表結構」
// 「單一批次寫入與寫回錯誤」「同一活動同時只有一個寫回」「寫回成功」（design S5、S6）。
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { agent, startServer, until } from './testing/testkit.js'
import { singleSpreadsheet } from './sheets/fixtures/single.js'
import { groupSpreadsheet } from './sheets/fixtures/group.js'

const TEMPLATES = { single: singleSpreadsheet, group: groupSpreadsheet }
let seq = 0

/**
 * 準備一份新的試算表與活動：老師登入、匯入、建立 3 組的活動，每組一位在線學生（即組長）。
 * @param {'single'|'group'} kind
 */
async function setup(srv, kind = 'single') {
  seq += 1
  const id = `${kind}-${seq}`
  srv.fake.set(id, TEMPLATES[kind]())
  const t = await srv.teacher()
  const snap = await srv.createActivity(t, id, 3)
  const code = snap.activity.code
  const g = {}
  for (const gid of ['g1', 'g2', 'g3']) g[gid] = await srv.student(code, `${gid} 組長`, gid)

  const ctx = {
    id,
    t,
    code,
    g,
    snap,
    control: async (qid, action) => {
      const r = await t.post(`/api/activities/${code}/questions/${qid}/${action}`)
      expect(r.status, `${action} ${qid}: ${r.text}`).toBe(204)
    },
    submit: async (gid, qid, round, texts) => {
      const answers = texts.map((text, i) => ({ blankId: `${qid}b${i + 1}`, text }))
      const r = await g[gid].post(`/api/activities/${code}/questions/${qid}/submissions`, { round, answers })
      expect(r.status, `submit ${gid} ${qid}: ${r.text}`).toBe(201)
    },
    teacherSnapshot: async () => (await t.get(`/api/activities/${code}/teacher`)).body,
    version: async () => (await ctx.teacherSnapshot()).version,
    exportNow: async (basedOnVersion) => {
      const v = basedOnVersion === undefined ? await ctx.version() : basedOnVersion
      return t.post(`/api/activities/${code}/export-to-sheet`, { basedOnVersion: v })
    },
    /** 學習單上某格目前的值（列、欄從 0 起算） */
    cell: (row, col, title = '學習單') => srv.fake.cell(id, title, row, col),
  }
  return ctx
}

/** 開始、送出（依 submissions 的順序）、結束一題 */
async function playQuestion(ctx, qid, submissions, round = 1) {
  await ctx.control(qid, round === 1 ? 'open' : 'reopen')
  for (const [gid, texts] of submissions) await ctx.submit(gid, qid, round, texts)
  await ctx.control(qid, 'close')
}

function expectError(res, status, code) {
  expect(res.status, res.text).toBe(status)
  expect(res.body.error.code).toBe(code)
}

/** 失敗時：fake 沒有新的寫入紀錄、老師快照的 lastExportedAt 不變 */
async function expectNothingWritten(srv, ctx, writesBefore, lastExportedAt = null) {
  expect(srv.fake.writes.length).toBe(writesBefore)
  expect((await ctx.teacherSnapshot()).sheet.lastExportedAt).toBe(lastExportedAt)
}

/** 在工作表的第 at 列（從 0 起算）上方插入一列，合併範圍跟著移動 */
function insertRow(fake, id, at) {
  fake.update(id, (book) => {
    const sheet = book.sheets[0]
    sheet.cells.splice(at, 0, [])
    for (const m of sheet.merges) {
      if (m.r0 >= at) {
        m.r0 += 1
        m.r1 += 1
      } else if (m.r1 > at) {
        m.r1 += 1
      }
    }
  })
}

function setCell(fake, id, row, col, value) {
  fake.update(id, (book) => {
    const cells = book.sheets[0].cells
    while (cells.length <= row) cells.push([])
    while (cells[row].length <= col) cells[row].push('')
    cells[row][col] = value
  })
}

// 單題範本的作答格：第 n 題在 (4 + 2(n-1), 6)；題組範本第 1 題在 (4, 7)、(5, 7)
const G5 = [4, 6]
const G7 = [6, 6]
const G9 = [8, 6]

describe('寫回的內容', () => {
  let srv
  beforeAll(async () => {
    srv = await startServer()
  })
  afterAll(() => srv.close())

  it('寫入順位 1 的答案：學習單!G5 變成「光合作用」，writtenCells 為 1', async () => {
    const ctx = await setup(srv, 'single')
    await playQuestion(ctx, 'q1', [['g2', ['光合作用']], ['g1', ['呼吸作用']]])
    const res = await ctx.exportNow()
    expect(res.status, res.text).toBe(200)
    expect(res.body.writtenCells).toBe(1)
    expect(res.body.skippedQuestions).toEqual([2, 3, 4, 5, 6])
    expect(ctx.cell(...G5)).toBe('光合作用')
    expect(srv.fake.writes.at(-1)).toEqual({
      spreadsheetId: ctx.id,
      worksheetTitle: '學習單',
      cells: [{ row: 4, col: 6, value: '光合作用' }],
    })
  })

  it('題組逐格寫入：學習單!H5 寫入「CPU」，學習單!H6 寫入「作業系統」，只用一次批次請求', async () => {
    const ctx = await setup(srv, 'group')
    await playQuestion(ctx, 'q1', [['g1', ['CPU', '作業系統']]])
    const writeCalls = srv.fake.calls.write
    const res = await ctx.exportNow()
    expect(res.status, res.text).toBe(200)
    expect(res.body.writtenCells).toBe(2)
    expect(res.body.skippedQuestions).toEqual([2, 3, 4])
    expect(ctx.cell(4, 7)).toBe('CPU')
    expect(ctx.cell(5, 7)).toBe('作業系統')
    expect(srv.fake.calls.write).toBe(writeCalls + 1)
    expect(srv.fake.writes.at(-1).cells).toHaveLength(2)
  })

  it('重開後以最後一輪為準：第 1 題的作答格寫入第 3 組的答案', async () => {
    const ctx = await setup(srv, 'single')
    await playQuestion(ctx, 'q1', [['g1', ['第一輪']]])
    await playQuestion(ctx, 'q1', [['g3', ['第二輪']], ['g1', ['第二輪慢了']]], 2)
    const res = await ctx.exportNow()
    expect(res.status, res.text).toBe(200)
    expect(ctx.cell(...G5)).toBe('第二輪')
  })

  it('無人作答與進行中：只寫入第 1 題，第 2、3 題的作答格保持原內容，skippedQuestions 包含 2 與 3', async () => {
    const ctx = await setup(srv, 'single')
    setCell(srv.fake, ctx.id, ...G7, '原本第 2 題')
    await playQuestion(ctx, 'q1', [['g1', ['答案一']]])
    await playQuestion(ctx, 'q2', [])
    await ctx.control('q3', 'open')
    await ctx.submit('g2', 'q3', 1, ['進行中的答案'])
    const res = await ctx.exportNow()
    expect(res.status, res.text).toBe(200)
    expect(res.body.writtenCells).toBe(1)
    expect(res.body.skippedQuestions).toEqual([2, 3, 4, 5, 6])
    expect(ctx.cell(...G5)).toBe('答案一')
    expect(ctx.cell(...G7)).toBe('原本第 2 題')
    expect(ctx.cell(...G9)).toBe('')
  })

  it('目標格子已有內容時一律覆寫', async () => {
    const ctx = await setup(srv, 'single')
    setCell(srv.fake, ctx.id, ...G5, '舊答案')
    await playQuestion(ctx, 'q1', [['g1', ['新答案']]])
    expect((await ctx.exportNow()).status).toBe(200)
    expect(ctx.cell(...G5)).toBe('新答案')
  })

  it('沒有可寫的格子：回應 409 NOTHING_TO_EXPORT，沒有呼叫 Google', async () => {
    const ctx = await setup(srv, 'single')
    const before = { ...srv.fake.calls }
    const writes = srv.fake.writes.length
    expectError(await ctx.exportNow(), 409, 'NOTHING_TO_EXPORT')
    await playQuestion(ctx, 'q1', []) // 已結束但無人作答
    await ctx.control('q2', 'open')
    await ctx.submit('g1', 'q2', 1, ['進行中']) // 進行中
    expectError(await ctx.exportNow(), 409, 'NOTHING_TO_EXPORT')
    expect(srv.fake.calls.write).toBe(before.write)
    expect(srv.fake.calls.read).toBe(before.read)
    await expectNothingWritten(srv, ctx, writes)
  })

  it('需要老師身分，活動必須存在', async () => {
    const ctx = await setup(srv, 'single')
    await playQuestion(ctx, 'q1', [['g1', ['答案']]])
    const v = await ctx.version()
    const anon = agent(srv.base)
    expectError(await anon.post(`/api/activities/${ctx.code}/export-to-sheet`, { basedOnVersion: v }), 401, 'UNAUTHORIZED')
    expectError(await ctx.g.g1.post(`/api/activities/${ctx.code}/export-to-sheet`, { basedOnVersion: v }), 401, 'UNAUTHORIZED')
    expectError(await ctx.t.post('/api/activities/ZZZZZZ/export-to-sheet', { basedOnVersion: v }), 404, 'ACTIVITY_NOT_FOUND')
    expect(ctx.cell(...G5)).toBe('')
  })
})

describe('答案以純文字寫入', () => {
  let srv
  beforeAll(async () => {
    srv = await startServer()
  })
  afterAll(() => srv.close())

  it('答案像公式：作答格就是這串文字本身', async () => {
    const formula = '=IMPORTXML("http://example.com","//a")'
    const ctx = await setup(srv, 'single')
    await playQuestion(ctx, 'q1', [['g1', [formula]]])
    expect((await ctx.exportNow()).status).toBe(200)
    expect(ctx.cell(...G5)).toBe(formula)
    expect(srv.fake.writes.at(-1).cells[0].value).toBe(formula)
  })

  it('答案像數字：007 原樣寫入，前面的 0 沒有被去掉', async () => {
    const ctx = await setup(srv, 'single')
    await playQuestion(ctx, 'q1', [['g1', ['007']]])
    expect((await ctx.exportNow()).status).toBe(200)
    expect(ctx.cell(...G5)).toBe('007')
    expect(typeof srv.fake.writes.at(-1).cells[0].value).toBe('string')
  })
})

describe('確認後結果變動', () => {
  let srv
  beforeAll(async () => {
    srv = await startServer()
  })
  afterAll(() => srv.close())

  it('確認後又有題目結束：回應 409 STALE_VERSION，試算表沒有被修改', async () => {
    const ctx = await setup(srv, 'single')
    await playQuestion(ctx, 'q1', [['g1', ['答案一']]])
    const confirmed = await ctx.version()
    await playQuestion(ctx, 'q2', [['g2', ['答案二']]])
    const writes = srv.fake.writes.length
    const reads = srv.fake.calls.read
    expectError(await ctx.exportNow(confirmed), 409, 'STALE_VERSION')
    expect(srv.fake.calls.read).toBe(reads)
    expect(ctx.cell(...G5)).toBe('')
    await expectNothingWritten(srv, ctx, writes)
    // 用新的版本確認後可以寫回
    expect((await ctx.exportNow()).status).toBe(200)
  })

  it('確認後題目重開：回應 409 STALE_VERSION', async () => {
    const ctx = await setup(srv, 'single')
    await playQuestion(ctx, 'q1', [['g1', ['答案一']]])
    const confirmed = await ctx.version()
    await ctx.control('q1', 'reopen')
    expectError(await ctx.exportNow(confirmed), 409, 'STALE_VERSION')
  })

  it('只有出席變動：學生上下線讓版本遞增後，仍以原版本正常寫回', async () => {
    const ctx = await setup(srv, 'single')
    await playQuestion(ctx, 'q1', [['g1', ['答案一']]])
    const confirmed = await ctx.version()
    // 新學生上線（真實連線）再離線、既有組長離線再上線
    const late = await srv.student(ctx.code, '遲到的同學')
    await srv.goOffline(late.conn)
    await srv.goOffline(ctx.g.g2.conn)
    ctx.g.g2.conn = await srv.open(ctx.g.g2, ctx.code, 'student')
    const now = await ctx.version()
    expect(now).toBeGreaterThanOrEqual(confirmed + 4)
    const res = await ctx.exportNow(confirmed)
    expect(res.status, res.text).toBe(200)
    expect(ctx.cell(...G5)).toBe('答案一')
  })

  it('basedOnVersion 不是整數：回應 409 STALE_VERSION', async () => {
    const ctx = await setup(srv, 'single')
    await playQuestion(ctx, 'q1', [['g1', ['答案一']]])
    const v = await ctx.version()
    const writes = srv.fake.writes.length
    for (const bad of [String(v), v + 0.5, null, true, [v]]) {
      expectError(await ctx.exportNow(bad), 409, 'STALE_VERSION')
    }
    expectError(await ctx.t.post(`/api/activities/${ctx.code}/export-to-sheet`, {}), 409, 'STALE_VERSION')
    await expectNothingWritten(srv, ctx, writes)
  })
})

describe('寫回前比對試算表結構', () => {
  let srv
  beforeAll(async () => {
    srv = await startServer()
  })
  afterAll(() => srv.close())

  it('作答格位置改變：在第 3 題上方插入一列，回應 409 SHEET_CHANGED，details 指出第 3 題，沒有任何格子被修改', async () => {
    const ctx = await setup(srv, 'single')
    await playQuestion(ctx, 'q1', [['g1', ['答案一']]])
    await playQuestion(ctx, 'q3', [['g1', ['答案三']]])
    insertRow(srv.fake, ctx.id, 8) // 第 3 題原本在第 9 列（index 8）
    const writes = srv.fake.writes.length
    const res = await ctx.exportNow()
    expectError(res, 409, 'SHEET_CHANGED')
    expect(res.body.error.details).toBe('第 3 題的作答格位置已改變')
    expect(ctx.cell(...G5)).toBe('')
    expect(ctx.cell(9, 6)).toBe('')
    await expectNothingWritten(srv, ctx, writes)
  })

  it('在第 1 題上方插入一列時，details 指出第 1 題', async () => {
    const ctx = await setup(srv, 'single')
    await playQuestion(ctx, 'q1', [['g1', ['答案一']]])
    insertRow(srv.fake, ctx.id, 4)
    const res = await ctx.exportNow()
    expectError(res, 409, 'SHEET_CHANGED')
    expect(res.body.error.details).toBe('第 1 題的作答格位置已改變')
  })

  it('工作表被刪除：回應 409 SHEET_CHANGED，details 說明找不到原本的工作表', async () => {
    const ctx = await setup(srv, 'single')
    await playQuestion(ctx, 'q1', [['g1', ['答案一']]])
    srv.fake.update(ctx.id, (book) => {
      book.sheets = [{ sheetId: 999, title: '學習單', index: 0, cells: [], merges: [] }]
    })
    const writes = srv.fake.writes.length
    const res = await ctx.exportNow()
    expectError(res, 409, 'SHEET_CHANGED')
    expect(res.body.error.details).toContain('找不到原本的工作表')
    await expectNothingWritten(srv, ctx, writes)
  })

  it('整份試算表不見了：回應 409 SHEET_CHANGED', async () => {
    const ctx = await setup(srv, 'single')
    await playQuestion(ctx, 'q1', [['g1', ['答案一']]])
    srv.fake.failNext('read', 404)
    const writes = srv.fake.writes.length
    const res = await ctx.exportNow()
    expectError(res, 409, 'SHEET_CHANGED')
    expect(res.body.error.details).toContain('找不到原本的試算表')
    await expectNothingWritten(srv, ctx, writes)
  })

  it('表頭被刪除而無法解析：回應 409 SHEET_CHANGED', async () => {
    const ctx = await setup(srv, 'single')
    await playQuestion(ctx, 'q1', [['g1', ['答案一']]])
    setCell(srv.fake, ctx.id, 3, 6, '答案')
    const res = await ctx.exportNow()
    expectError(res, 409, 'SHEET_CHANGED')
    expect(ctx.cell(...G5)).toBe('')
  })

  it('工作表改名：寫回成功，答案寫到「第一週」工作表的對應儲存格', async () => {
    const ctx = await setup(srv, 'single')
    await playQuestion(ctx, 'q1', [['g1', ['答案一']]])
    srv.fake.update(ctx.id, (book) => {
      book.sheets[0].title = '第一週'
    })
    const res = await ctx.exportNow()
    expect(res.status, res.text).toBe(200)
    expect(ctx.cell(...G5, '第一週')).toBe('答案一')
    expect(srv.fake.writes.at(-1).worksheetTitle).toBe('第一週')
  })

  it('題目內容或作答格內容改變但位置不變時仍可寫回', async () => {
    const ctx = await setup(srv, 'single')
    await playQuestion(ctx, 'q1', [['g1', ['答案一']]])
    setCell(srv.fake, ctx.id, 4, 2, '題目文字被老師修改了')
    setCell(srv.fake, ctx.id, ...G5, '有人先填了')
    expect((await ctx.exportNow()).status).toBe(200)
    expect(ctx.cell(...G5)).toBe('答案一')
  })
})

describe('單一批次寫入與寫回錯誤', () => {
  let srv
  beforeAll(async () => {
    srv = await startServer()
  })
  afterAll(() => srv.close())

  it('只有檢視權限：回應 403 SHEET_READ_ONLY 並附 shareWith，試算表沒有被修改', async () => {
    const ctx = await setup(srv, 'single')
    await playQuestion(ctx, 'q1', [['g1', ['答案一']]])
    srv.fake.setPermission(ctx.id, 'read')
    const writes = srv.fake.writes.length
    const res = await ctx.exportNow()
    expectError(res, 403, 'SHEET_READ_ONLY')
    expect(res.body.error.shareWith).toBe(srv.fake.shareWith)
    expect(ctx.cell(...G5)).toBe('')
    await expectNothingWritten(srv, ctx, writes)
  })

  it('寫回前讀取被拒（沒有共用）：回應 403 SHEET_READ_ONLY 並附 shareWith', async () => {
    const ctx = await setup(srv, 'single')
    await playQuestion(ctx, 'q1', [['g1', ['答案一']]])
    srv.fake.setPermission(ctx.id, 'none')
    const writes = srv.fake.writes.length
    const res = await ctx.exportNow()
    expectError(res, 403, 'SHEET_READ_ONLY')
    expect(res.body.error.shareWith).toBe(srv.fake.shareWith)
    await expectNothingWritten(srv, ctx, writes)
  })

  it('寫入失敗：回應 502 SHEET_WRITE_FAILED，sheet.lastExportedAt 不變，之後可以再寫回', async () => {
    const ctx = await setup(srv, 'single')
    await playQuestion(ctx, 'q1', [['g1', ['答案一']]])
    const writes = srv.fake.writes.length
    for (const status of [500, 404, 429, 'timeout']) {
      srv.fake.failNext('write', status)
      expectError(await ctx.exportNow(), 502, 'SHEET_WRITE_FAILED')
    }
    expect(ctx.cell(...G5)).toBe('')
    await expectNothingWritten(srv, ctx, writes)
    expect((await ctx.exportNow()).status).toBe(200)
    expect(ctx.cell(...G5)).toBe('答案一')
  })

  it('寫回前讀取時無法連線：逾時或 5xx 回應 503 SHEETS_UNAVAILABLE，沒有寫入', async () => {
    const ctx = await setup(srv, 'single')
    await playQuestion(ctx, 'q1', [['g1', ['答案一']]])
    const writeCalls = srv.fake.calls.write
    const writes = srv.fake.writes.length
    for (const status of ['timeout', 500, 503]) {
      srv.fake.failNext('read', status)
      expectError(await ctx.exportNow(), 503, 'SHEETS_UNAVAILABLE')
    }
    expect(srv.fake.calls.write).toBe(writeCalls)
    await expectNothingWritten(srv, ctx, writes)
  })

  it('寫回失敗後上次寫回時間維持前一次成功的值', async () => {
    const ctx = await setup(srv, 'single')
    await playQuestion(ctx, 'q1', [['g1', ['答案一']]])
    const ok = await ctx.exportNow()
    expect(ok.status).toBe(200)
    const writes = srv.fake.writes.length
    srv.fake.failNext('write', 500)
    expectError(await ctx.exportNow(), 502, 'SHEET_WRITE_FAILED')
    await expectNothingWritten(srv, ctx, writes, ok.body.exportedAt)
  })
})

describe('同一活動同時只有一個寫回', () => {
  let srv
  beforeAll(async () => {
    srv = await startServer()
  })
  afterAll(() => srv.close())

  it('連續兩次寫回：第二個請求回應 409 EXPORT_IN_PROGRESS；第一個完成後可以再次寫回', async () => {
    const ctx = await setup(srv, 'single')
    await playQuestion(ctx, 'q1', [['g1', ['答案一']]])
    const v = await ctx.version()
    const writeCalls = srv.fake.calls.write
    const release = srv.fake.hold('write')
    let first
    try {
      first = ctx.exportNow(v)
      await until(() => srv.fake.calls.write > writeCalls)
      const second = await ctx.exportNow(v)
      expectError(second, 409, 'EXPORT_IN_PROGRESS')
      expect(ctx.cell(...G5)).toBe('')
    } finally {
      release()
    }
    const res = await first
    expect(res.status, res.text).toBe(200)
    expect(ctx.cell(...G5)).toBe('答案一')
    const again = await ctx.exportNow(v)
    expect(again.status, again.text).toBe(200)
  })

  it('等待讀取時也算寫回進行中；失敗結束後可以再寫回', async () => {
    const ctx = await setup(srv, 'single')
    await playQuestion(ctx, 'q1', [['g1', ['答案一']]])
    const readCalls = srv.fake.calls.read
    srv.fake.failNext('read', 500)
    const release = srv.fake.hold('read')
    let first
    try {
      first = ctx.exportNow()
      await until(() => srv.fake.calls.read > readCalls)
      expectError(await ctx.exportNow(), 409, 'EXPORT_IN_PROGRESS')
    } finally {
      release()
    }
    expectError(await first, 503, 'SHEETS_UNAVAILABLE')
    expect((await ctx.exportNow()).status).toBe(200)
  })

  it('不同活動的寫回互不影響', async () => {
    const a = await setup(srv, 'single')
    const b = await setup(srv, 'single')
    await playQuestion(a, 'q1', [['g1', ['A']]])
    await playQuestion(b, 'q1', [['g1', ['B']]])
    const writeCalls = srv.fake.calls.write
    const release = srv.fake.hold('write')
    let first
    try {
      first = a.exportNow()
      await until(() => srv.fake.calls.write > writeCalls)
      const other = b.exportNow()
      await until(() => srv.fake.calls.write > writeCalls + 1)
      release()
      expect((await other).status).toBe(200)
    } finally {
      release()
    }
    expect((await first).status).toBe(200)
    expect(a.cell(...G5)).toBe('A')
    expect(b.cell(...G5)).toBe('B')
  })
})

describe('寫回成功', () => {
  let srv
  beforeAll(async () => {
    srv = await startServer()
  })
  afterAll(() => srv.close())

  it('寫回後更新快照：老師收到新快照且 lastExportedAt 等於 exportedAt，學生快照仍不含試算表資訊', async () => {
    const ctx = await setup(srv, 'group')
    const tc = await srv.open(ctx.t, ctx.code, 'teacher')
    await playQuestion(ctx, 'q1', [['g1', ['CPU', '作業系統']]])
    const before = await ctx.version()
    const studentCount = ctx.g.g2.conn.snapshots.length

    const res = await ctx.exportNow(before)
    expect(res.status, res.text).toBe(200)
    expect(Object.keys(res.body).sort()).toEqual(['exportedAt', 'sheetUrl', 'skippedQuestions', 'writtenCells'])
    expect(res.body.sheetUrl).toBe(ctx.snap.sheet.url)
    expect(res.body.writtenCells).toBe(2)
    expect(res.body.skippedQuestions).toEqual([2, 3, 4])
    expect(new Date(res.body.exportedAt).toISOString()).toBe(res.body.exportedAt)

    const pushed = await until(() => tc.snapshots.find((s) => s.sheet?.lastExportedAt === res.body.exportedAt))
    expect(pushed.version).toBe(before + 1)
    expect((await ctx.teacherSnapshot()).sheet.lastExportedAt).toBe(res.body.exportedAt)

    const studentSnap = await until(() =>
      ctx.g.g2.conn.snapshots.slice(studentCount).find((s) => s.version === before + 1),
    )
    const text = JSON.stringify(studentSnap)
    expect(studentSnap.sheet).toBeUndefined()
    for (const word of ['cellRef', 'sheet', 'lastExportedAt', 'docs.google.com']) expect(text).not.toContain(word)
    const rest = await ctx.g.g2.get(`/api/activities/${ctx.code}/student`)
    expect(rest.body.sheet).toBeUndefined()
  })
})
