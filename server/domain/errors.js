// 正式後端的錯誤型別（change build-quiz-backend，design B3）。
// domain 與 sheets 層遇到規則不成立時丟出 AppError，
// HTTP 層把它轉成 `{ error: { code, message, details?, shareWith? } }`，Socket 層轉成 `error` 事件。

export class AppError extends Error {
  /**
   * @param {number} status HTTP 狀態碼
   * @param {string} code 介面約定中的錯誤碼
   * @param {string} message 給人看的文字（前端只當備用）
   * @param {{ details?: string, shareWith?: string }} [extra]
   */
  constructor(status, code, message, extra = {}) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
    if (extra.details !== undefined) this.details = extra.details
    if (extra.shareWith !== undefined) this.shareWith = extra.shareWith
  }

  /** 轉成錯誤回應的內容；只放約定中的欄位 */
  toBody() {
    const error = { code: this.code, message: this.message }
    if (this.details !== undefined) error.details = this.details
    if (this.shareWith !== undefined) error.shareWith = this.shareWith
    return { error }
  }
}

export const isAppError = (e) => e instanceof AppError
