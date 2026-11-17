// mock 後端進入點：讀取 .env，啟動 Express + Socket.IO。
import 'dotenv/config'
import crypto from 'node:crypto'
import { createMockServer } from './server.js'

let teacherPassword = process.env.TEACHER_PASSWORD
if (!teacherPassword) {
  teacherPassword = crypto.randomBytes(9).toString('base64url')
  // 只印在本機終端機，不寫入任何檔案
  console.log(`[mock] 未設定 TEACHER_PASSWORD，本次啟動的教師密碼：${teacherPassword}`)
}

const testHooks = process.env.MOCK_TEST_HOOKS === '1'
const port = Number(process.env.PORT ?? 3000)

const mock = createMockServer({ teacherPassword, testHooks })
mock.listen(port).then((p) => {
  console.log(`[mock] listening on http://localhost:${p}${testHooks ? '（已啟用 /__mock 測試鉤子）' : ''}`)
})
