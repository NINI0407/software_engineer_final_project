// 正式後端的記憶體儲存區（change build-quiz-backend，design B3、B6）。
// 只存在記憶體，後端重新啟動就清空。

import crypto from 'node:crypto'

// 活動代號的字元集：排除 0、O、1、I 等容易混淆的字元（B6，與 mock 相同）
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 6

/** 產生 `bytes` 個位元組的亂數，以十六進位字串回傳（長度為 bytes * 2） */
export const randomId = (bytes = 12) => crypto.randomBytes(bytes).toString('hex')

/**
 * @typedef {object} Store
 * @property {Set<string>} sessions 有效的 teacher_session
 * @property {Map<string, object>} imports importId → 匯入結果（S4）
 * @property {Map<string, object>} activities 活動代號 → 活動
 * @property {() => string} newCode 產生與現有活動不重複的 6 字元活動代號
 */

/** @returns {Store} */
export function createStore() {
  const store = {
    sessions: new Set(),
    imports: new Map(),
    activities: new Map(),
    newCode() {
      for (;;) {
        let code = ''
        for (let i = 0; i < CODE_LENGTH; i++) {
          code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]
        }
        if (!store.activities.has(code)) return code
      }
    },
  }
  return store
}
