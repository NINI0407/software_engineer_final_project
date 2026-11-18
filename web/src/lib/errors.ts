/**
 * 錯誤碼 → 提示文字與前端額外動作（design D8 錯誤碼表；試算表相關見 change
 * switch-to-online-google-sheets 的 design G2）。提示中的〈details〉〈shareWith〉由 describeError 代入。
 */

export type ErrorAction = 'none' | 'resync' | 'clearPassword' | 'clearPreview' | 'restoreGroup'

export interface ErrorInfo {
  message: string
  action: ErrorAction
}

export const ERROR_TABLE: Record<string, ErrorInfo> = {
  INVALID_PASSWORD: { message: '密碼錯誤', action: 'clearPassword' },
  // 匯入試算表：任何錯誤都清除預覽，「建立活動」因此停用
  INVALID_SHEET_URL: { message: '這不是有效的 Google 試算表網址', action: 'clearPreview' },
  SHEET_NOT_SHARED: { message: '無法讀取此試算表，請先共用給 〈shareWith〉', action: 'clearPreview' },
  SHEET_NOT_FOUND: { message: '找不到這份試算表，請確認網址', action: 'clearPreview' },
  WORKSHEET_NOT_FOUND: { message: '找不到指定的工作表：〈details〉', action: 'clearPreview' },
  PARSE_FAILED: { message: '解析失敗：〈details〉', action: 'clearPreview' },
  SHEETS_UNAVAILABLE: { message: 'Google 服務暫時無法連線，請稍後再試', action: 'clearPreview' },
  INVALID_GROUP_COUNT: { message: '組數不合法', action: 'none' },
  IMPORT_NOT_FOUND: { message: '匯入結果已失效，請重新匯入', action: 'none' },
  // 寫回試算表：失敗時不得出現「成功」「已寫入」
  SHEET_READ_ONLY: { message: '試算表只有檢視權限，請把 〈shareWith〉 設為編輯者', action: 'none' },
  SHEET_CHANGED: { message: '試算表的題目結構已變更，未寫入任何資料：〈details〉', action: 'none' },
  SHEET_WRITE_FAILED: { message: '寫回失敗，試算表未被修改，請稍後再試', action: 'none' },
  STALE_VERSION: { message: '結果已更新，請重新確認', action: 'resync' },
  NOTHING_TO_EXPORT: { message: '目前沒有可寫回的結果', action: 'resync' },
  EXPORT_IN_PROGRESS: { message: '正在寫回中，請稍候', action: 'none' },
  ANOTHER_QUESTION_OPEN: { message: '已有題目進行中', action: 'resync' },
  INVALID_STATE: { message: '題目狀態已變更', action: 'resync' },
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

/**
 * 依錯誤碼取得提示與動作，並代入〈details〉〈shareWith〉。
 * 沒有 details 時連同前面的「：」一起去掉；沒有 shareWith 時改用「本系統的服務帳號」。
 */
export function describeError(code: string | undefined, details?: string, shareWith?: string): ErrorInfo {
  const info = (code && ERROR_TABLE[code]) || DEFAULT_ERROR
  const message = info.message
    .replace(/：?〈details〉/, details ? `：${details}` : '')
    .replace(/ ?〈shareWith〉 ?/, (m) => (shareWith ? m.replace('〈shareWith〉', shareWith) : '本系統的服務帳號'))
  return message === info.message ? info : { ...info, message }
}
