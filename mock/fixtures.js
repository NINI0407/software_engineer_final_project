// mock 的固定匯入結果（mock 不真的讀取 Google 試算表）。
// 單題、題組兩份的儲存格位置取自 samples/ 範本的實際結構；「變體」用來模擬另一份 Guided Notes。
// 依網址中的試算表 ID 關鍵字選擇結果，對照表見 design.md G6。

export const SHARE_WITH = 'quiz-bot@mock.invalid'

const SHEET_URL = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)/

const single = {
  spreadsheetTitle: '軟工期末專案_單題_範例',
  worksheetTitle: '學習單',
  questions: [5, 7, 9, 11, 13, 15].map((row, i) => ({
    number: i + 1,
    blanks: [{ label: null, cellRef: `學習單!G${row}` }],
  })),
  warnings: [],
}

const group = {
  spreadsheetTitle: '軟工期末專案_題組_範例',
  worksheetTitle: '學習單',
  questions: [
    { number: 1, blanks: [{ label: '（1）', cellRef: '學習單!H5' }, { label: '（2）', cellRef: '學習單!H6' }] },
    { number: 2, blanks: [{ label: '（1）', cellRef: '學習單!H8' }, { label: '（2）', cellRef: '學習單!H9' }] },
    { number: 3, blanks: [{ label: null, cellRef: '學習單!G11' }] },
    { number: 4, blanks: [{ label: null, cellRef: '學習單!G13' }] },
  ],
  warnings: [],
}

const variant = {
  spreadsheetTitle: '另一份講義_變體',
  worksheetTitle: '講義B',
  questions: Array.from({ length: 9 }, (_, i) =>
    i === 3
      ? {
          number: i + 1,
          blanks: [
            { label: '（1）', cellRef: `講義B!F${14 + i * 3}` },
            { label: '（2）', cellRef: `講義B!F${15 + i * 3}` },
          ],
        }
      : { number: i + 1, blanks: [{ label: null, cellRef: `講義B!E${8 + i * 3}` }] },
  ),
  warnings: ['第 9 題的填空格原本已有內容，匯出時會被覆寫'],
}

const fail = (status, code, message, extra = {}) => ({ kind: 'error', status, code, message, ...extra })

// 依序比對，先符合的優先
const RULES = [
  ['notshared', () => fail(403, 'SHEET_NOT_SHARED', '無法讀取此試算表', { shareWith: SHARE_WITH })],
  ['missing', () => fail(404, 'SHEET_NOT_FOUND', '找不到這份試算表')],
  ['noworksheet', () => fail(422, 'WORKSHEET_NOT_FOUND', '找不到指定的工作表', { details: '網址指定的工作表不存在' })],
  ['invalid', () => fail(422, 'PARSE_FAILED', '解析失敗', { details: '找不到題號/作答表頭' })],
  ['readonly', () => ok(single, 'readonly')],
  ['changed', () => ok(single, 'changed')],
  ['variant', () => ok(variant)],
  ['group', () => ok(group)],
]

function ok(preview, writeMode = 'normal') {
  return { kind: 'ok', preview: structuredClone(preview), writeMode }
}

/**
 * 依試算表網址選擇匯入結果。
 * @returns {{ kind: 'ok', preview: object, writeMode: 'normal'|'readonly'|'changed', sheetUrl: string }
 *   | { kind: 'error', status: number, code: string, message: string, details?: string, shareWith?: string }}
 */
export function pickSheet(sheetUrl) {
  const m = typeof sheetUrl === 'string' ? sheetUrl.trim().match(SHEET_URL) : null
  if (!m) return fail(400, 'INVALID_SHEET_URL', '這不是有效的 Google 試算表網址')
  const id = m[1].toLowerCase()
  const rule = RULES.find(([keyword]) => id.includes(keyword))
  const result = rule ? rule[1]() : ok(single)
  if (result.kind === 'ok') result.sheetUrl = `https://docs.google.com/spreadsheets/d/${m[1]}/edit`
  return result
}
