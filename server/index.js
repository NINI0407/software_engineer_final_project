// 正式後端進入點（change build-quiz-backend，design B8、S1）：讀取 .env，建立 Google 用戶端（或停用），啟動伺服器。
import 'dotenv/config'
import crypto from 'node:crypto'
import { createServer } from './app.js'
import { createDisabledSheetsClient, createGoogleSheetsClient } from './sheets/google.js'

let teacherPassword = process.env.TEACHER_PASSWORD
if (!teacherPassword) {
  teacherPassword = crypto.randomBytes(9).toString('base64url')
  // 只印在本機終端機，不寫入任何檔案
  console.log(`[server] 未設定 TEACHER_PASSWORD，本次啟動的教師密碼：${teacherPassword}`)
}

let sheets
const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE?.trim()
if (keyFile) {
  try {
    sheets = createGoogleSheetsClient({ keyFile })
    console.log(`[server] 已載入 Google service account：${sheets.shareWith}（請把試算表共用給這個 email）`)
  } catch (err) {
    // 錯誤訊息不含金鑰內容（readServiceAccountKey 只回報讀取或欄位問題）
    console.warn(`[server] ${err.message}；匯入與寫回試算表將無法使用`)
  }
} else {
  console.warn('[server] 未設定 Google 憑證（GOOGLE_SERVICE_ACCOUNT_KEY_FILE），匯入與寫回試算表將無法使用')
}
sheets ??= createDisabledSheetsClient()

const port = Number(process.env.SERVER_PORT ?? 4000)
const srv = createServer({ teacherPassword, sheets })
srv.listen(port).then((p) => {
  console.log(`[server] listening on http://localhost:${p}`)
})
