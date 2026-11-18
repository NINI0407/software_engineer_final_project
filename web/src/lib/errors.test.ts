import { describe, expect, it } from 'vitest'
import { DEFAULT_ERROR, describeError, ERROR_TABLE } from './errors'

const CONTRACT_CODES = [
  'INVALID_PASSWORD',
  'INVALID_SHEET_URL',
  'SHEET_NOT_SHARED',
  'SHEET_NOT_FOUND',
  'WORKSHEET_NOT_FOUND',
  'PARSE_FAILED',
  'SHEETS_UNAVAILABLE',
  'INVALID_GROUP_COUNT',
  'IMPORT_NOT_FOUND',
  'SHEET_READ_ONLY',
  'SHEET_CHANGED',
  'SHEET_WRITE_FAILED',
  'STALE_VERSION',
  'NOTHING_TO_EXPORT',
  'EXPORT_IN_PROGRESS',
  'ANOTHER_QUESTION_OPEN',
  'INVALID_STATE',
  'NOT_A_MEMBER',
  'ACTIVITY_NOT_FOUND',
  'INVALID_NICKNAME',
  'NOT_JOINED',
  'GROUP_LOCKED',
  'INVALID_GROUP',
  'NOT_LEADER',
  'QUESTION_NOT_OPEN',
  'STALE_ROUND',
  'ALREADY_SUBMITTED',
  'BLANK_ANSWER',
  'ANSWER_TOO_LONG',
  'BLANKS_MISMATCH',
]

const SHARE = 'quiz-bot@example.iam.gserviceaccount.com'

describe('錯誤碼對照表', () => {
  it.each(CONTRACT_CODES)('%s 有提示文字', (code) => {
    expect(ERROR_TABLE[code]?.message).toBeTruthy()
  })

  it('已移除上傳時代的錯誤碼', () => {
    expect(ERROR_TABLE).not.toHaveProperty('NOT_XLSX')
    expect(ERROR_TABLE).not.toHaveProperty('UPLOAD_NOT_FOUND')
  })

  it('design D8 指定的提示與動作', () => {
    expect(describeError('NOT_LEADER')).toEqual({ message: '只有組長能送出', action: 'resync' })
    expect(describeError('GROUP_LOCKED').action).toBe('restoreGroup')
    expect(describeError('ALREADY_SUBMITTED').message).toBe('本組已送出')
    expect(describeError('STALE_ROUND').message).toBe('本題已結束或已重開')
    expect(describeError('BLANK_ANSWER').message).toBe('答案不可為空白')
  })

  it('匯入錯誤的提示，且都會清除預覽', () => {
    expect(describeError('INVALID_SHEET_URL').message).toBe('這不是有效的 Google 試算表網址')
    expect(describeError('SHEET_NOT_SHARED', undefined, SHARE).message).toBe(
      `無法讀取此試算表，請先共用給 ${SHARE}`,
    )
    expect(describeError('SHEET_NOT_FOUND').message).toBe('找不到這份試算表，請確認網址')
    expect(describeError('WORKSHEET_NOT_FOUND', '網址指定的工作表不存在').message).toBe(
      '找不到指定的工作表：網址指定的工作表不存在',
    )
    expect(describeError('PARSE_FAILED', '找不到題號/作答表頭').message).toBe('解析失敗：找不到題號/作答表頭')
    expect(describeError('SHEETS_UNAVAILABLE').message).toBe('Google 服務暫時無法連線，請稍後再試')
    for (const code of [
      'INVALID_SHEET_URL',
      'SHEET_NOT_SHARED',
      'SHEET_NOT_FOUND',
      'WORKSHEET_NOT_FOUND',
      'PARSE_FAILED',
      'SHEETS_UNAVAILABLE',
    ]) {
      expect(describeError(code).action).toBe('clearPreview')
    }
    expect(describeError('IMPORT_NOT_FOUND').message).toBe('匯入結果已失效，請重新匯入')
  })

  it('寫回錯誤的提示與動作，且不出現「成功」或「已寫入」', () => {
    expect(describeError('SHEET_READ_ONLY', undefined, SHARE).message).toBe(
      `試算表只有檢視權限，請把 ${SHARE} 設為編輯者`,
    )
    expect(describeError('SHEET_CHANGED', '第 3 題的作答格位置已改變').message).toBe(
      '試算表的題目結構已變更，未寫入任何資料：第 3 題的作答格位置已改變',
    )
    expect(describeError('SHEET_WRITE_FAILED').message).toBe('寫回失敗，試算表未被修改，請稍後再試')
    expect(describeError('STALE_VERSION')).toEqual({ message: '結果已更新，請重新確認', action: 'resync' })
    expect(describeError('NOTHING_TO_EXPORT').action).toBe('resync')
    for (const code of ['SHEET_READ_ONLY', 'SHEET_CHANGED', 'SHEET_WRITE_FAILED', 'STALE_VERSION', 'SHEETS_UNAVAILABLE']) {
      expect(describeError(code, 'x', SHARE).message).not.toMatch(/成功|已寫入/)
    }
  })

  it('缺少 details 或 shareWith 時不留下佔位符號', () => {
    expect(describeError('PARSE_FAILED').message).toBe('解析失敗')
    expect(describeError('SHEET_CHANGED').message).toBe('試算表的題目結構已變更，未寫入任何資料')
    expect(describeError('SHEET_NOT_SHARED').message).toBe('無法讀取此試算表，請先共用給本系統的服務帳號')
    expect(describeError('SHEET_READ_ONLY').message).toBe('試算表只有檢視權限，請把本系統的服務帳號設為編輯者')
    for (const code of CONTRACT_CODES) expect(describeError(code).message).not.toContain('〈')
  })

  it('未知或缺少的 code 使用預設訊息', () => {
    expect(describeError('SOMETHING_NEW')).toEqual(DEFAULT_ERROR)
    expect(describeError(undefined)).toEqual(DEFAULT_ERROR)
  })
})
