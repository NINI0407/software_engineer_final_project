// e2e 專用進入點（change build-quiz-backend，task 7.1）：正式後端 + fake-sheets。
// 只給 playwright.server.config.ts 使用；正式啟動請用 server/index.js。
// 試算表 ID：`e2e-single`（單題範本）、`e2e-group`（題組範本）。
import { createServer } from '../app.js'
import { createFakeSheets } from './fake-sheets.js'
import { singleSpreadsheet } from '../sheets/fixtures/single.js'
import { groupSpreadsheet } from '../sheets/fixtures/group.js'

const teacherPassword = process.env.TEACHER_PASSWORD
if (!teacherPassword) {
  console.error('[e2e-server] 需要以環境變數 TEACHER_PASSWORD 提供教師密碼')
  process.exit(1)
}

const sheets = createFakeSheets({
  shareWith: 'quiz-bot@e2e.invalid',
  spreadsheets: { 'e2e-single': singleSpreadsheet(), 'e2e-group': groupSpreadsheet() },
})

const port = Number(process.env.SERVER_PORT ?? 4100)
createServer({ teacherPassword, sheets })
  .listen(port)
  .then((p) => console.log(`[e2e-server] listening on http://localhost:${p}`))
