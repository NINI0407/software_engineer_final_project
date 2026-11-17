/** 錯誤碼 → 提示文字與前端額外動作（design D8 錯誤碼表） */

export type ErrorAction = 'none' | 'resync' | 'clearPassword' | 'disableCreate' | 'restoreGroup'

export interface ErrorInfo {
  message: string
  action: ErrorAction
}

export const ERROR_TABLE: Record<string, ErrorInfo> = {
  INVALID_PASSWORD: { message: '密碼錯誤', action: 'clearPassword' },
  NOT_XLSX: { message: '請上傳 .xlsx 檔', action: 'none' },
  PARSE_FAILED: { message: '解析失敗', action: 'disableCreate' },
  INVALID_GROUP_COUNT: { message: '組數不合法', action: 'none' },
  UPLOAD_NOT_FOUND: { message: '上傳的檔案已失效，請重新上傳', action: 'none' },
  ANOTHER_QUESTION_OPEN: { message: '已有題目進行中', action: 'resync' },
  INVALID_STATE: { message: '題目狀態已變更', action: 'resync' },
  NOT_A_MEMBER: { message: '此成員不屬於該組', action: 'resync' },
  ACTIVITY_NOT_FOUND: { message: '找不到此活動代號', action: 'none' },
  INVALID_NICKNAME: { message: '請輸入 1 到 20 字的暱稱', action: 'none' },
  NOT_JOINED: { message: '請先加入活動', action: 'none' },
  GROUP_LOCKED: { message: '搶答已開始，無法換組', action: 'restoreGroup' },
  INVALID_GROUP: { message: '組別不存在', action: 'resync' },
  NOT_LEADER: { message: '只有組長能送出', action: 'resync' },
  QUESTION_NOT_OPEN: { message: '本題已結束或已重開', action: 'resync' },
  STALE_ROUND: { message: '本題已結束或已重開', action: 'resync' },
  ALREADY_SUBMITTED: { message: '本組已送出', action: 'resync' },
  BLANK_ANSWER: { message: '答案不可為空白', action: 'none' },
  ANSWER_TOO_LONG: { message: '答案不可超過 500 字', action: 'none' },
  BLANKS_MISMATCH: { message: '作答格數與題目不符，請重新整理', action: 'resync' },
}

export const DEFAULT_ERROR: ErrorInfo = { message: '發生錯誤，請稍後再試', action: 'none' }

export function describeError(code: string | undefined, details?: string): ErrorInfo {
  const info = (code && ERROR_TABLE[code]) || DEFAULT_ERROR
  if (code === 'PARSE_FAILED' && details) {
    return { ...info, message: `解析失敗：${details}` }
  }
  return info
}
