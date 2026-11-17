import { describe, expect, it } from 'vitest'
import { DEFAULT_ERROR, describeError, ERROR_TABLE } from './errors'

const CONTRACT_CODES = [
  'INVALID_PASSWORD',
  'NOT_XLSX',
  'PARSE_FAILED',
  'INVALID_GROUP_COUNT',
  'UPLOAD_NOT_FOUND',
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

describe('錯誤碼對照表', () => {
  it.each(CONTRACT_CODES)('%s 有提示文字', (code) => {
    expect(ERROR_TABLE[code]?.message).toBeTruthy()
  })

  it('design D8 指定的提示與動作', () => {
    expect(describeError('NOT_LEADER')).toEqual({ message: '只有組長能送出', action: 'resync' })
    expect(describeError('GROUP_LOCKED').action).toBe('restoreGroup')
    expect(describeError('ALREADY_SUBMITTED').message).toBe('本組已送出')
    expect(describeError('STALE_ROUND').message).toBe('本題已結束或已重開')
    expect(describeError('BLANK_ANSWER').message).toBe('答案不可為空白')
  })

  it('PARSE_FAILED 會帶入 details', () => {
    expect(describeError('PARSE_FAILED', '找不到題號/作答表頭').message).toBe(
      '解析失敗：找不到題號/作答表頭',
    )
  })

  it('未知或缺少的 code 使用預設訊息', () => {
    expect(describeError('SOMETHING_NEW')).toEqual(DEFAULT_ERROR)
    expect(describeError(undefined)).toEqual(DEFAULT_ERROR)
  })
})
