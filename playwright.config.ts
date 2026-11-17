import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { defineConfig } from '@playwright/test'

// 測試用教師密碼在執行時隨機產生，只透過環境變數傳給 mock 與測試（不寫入任何檔案）。
// 在主程序設定後，worker 程序會繼承同一個值。
if (!process.env.E2E_TEACHER_PASSWORD) {
  process.env.E2E_TEACHER_PASSWORD = crypto.randomBytes(12).toString('base64url')
}

const MOCK_PORT = 3100
const WEB_PORT = 5174

export default defineConfig({
  testDir: 'e2e',
  // 測試產物（trace、截圖）寫到系統暫存資料夾，避免雲端同步資料夾鎖檔拖慢或卡住 teardown
  outputDir: path.join(os.tmpdir(), 'quiz-buzzer-test-results'),
  // mock 的狀態是全域的，每個測試前都會 reset，所以依序執行
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  // 「約一秒內同步」：斷言逾時設為 2 秒
  expect: { timeout: 2_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    acceptDownloads: true,
    // 在這台 Windows 環境上 trace 錄製 fixture 偶爾逾時；需要除錯時改用 `npx playwright test --trace on`
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: [
    {
      command: 'node mock/index.js',
      url: `http://localhost:${MOCK_PORT}/api/teacher/session`,
      reuseExistingServer: false,
      env: {
        PORT: String(MOCK_PORT),
        TEACHER_PASSWORD: process.env.E2E_TEACHER_PASSWORD,
        MOCK_TEST_HOOKS: '1',
      },
    },
    {
      command: 'npx vite --config web/vite.config.ts',
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      env: {
        WEB_PORT: String(WEB_PORT),
        BACKEND_URL: `http://localhost:${MOCK_PORT}`,
      },
    },
  ],
})

export { MOCK_PORT, WEB_PORT }
