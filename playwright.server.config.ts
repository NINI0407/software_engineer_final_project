import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { defineConfig } from '@playwright/test'

// 正式後端的 e2e（change build-quiz-backend，design B9、task 7.1）。
// 後端用測試專用進入點 server/testing/e2e-entry.js 啟動（試算表換成 fake-sheets），不依賴 /__mock 鉤子。
// 教師密碼在執行時隨機產生，只透過環境變數傳給後端與測試（不寫入任何檔案）。
if (!process.env.E2E_TEACHER_PASSWORD) {
  process.env.E2E_TEACHER_PASSWORD = crypto.randomBytes(12).toString('base64url')
}

const SERVER_PORT = 4100
const WEB_PORT = 5175

export default defineConfig({
  testDir: 'e2e-server',
  outputDir: path.join(os.tmpdir(), 'quiz-buzzer-server-test-results'),
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  // 「約一秒內同步」：斷言逾時設為 2 秒
  expect: { timeout: 2_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    acceptDownloads: true,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: [
    {
      command: 'node server/testing/e2e-entry.js',
      url: `http://localhost:${SERVER_PORT}/api/teacher/session`,
      reuseExistingServer: false,
      env: {
        SERVER_PORT: String(SERVER_PORT),
        TEACHER_PASSWORD: process.env.E2E_TEACHER_PASSWORD,
      },
    },
    {
      command: 'npx vite --config web/vite.config.ts',
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      env: {
        WEB_PORT: String(WEB_PORT),
        BACKEND_URL: `http://localhost:${SERVER_PORT}`,
      },
    },
  ],
})
