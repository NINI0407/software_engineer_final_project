// 進入點：未設定密碼、未設定或無效的金鑰（spec quiz-backend「教師密碼驗證」，google-sheets-sync「service account 憑證的保管」）。
// 以子程序啟動；工作目錄設為暫存資料夾，避免讀到開發者自己的 .env。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { agent, until } from './testing/testkit.js'

const ENTRY = fileURLToPath(new URL('./index.js', import.meta.url))
const FAKE_SECRET = 'not-a-real-secret-for-index-test'

let dir
const children = []
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quiz-server-index-'))
})
// Windows 上子程序結束前仍占用工作目錄，所以要等它真的結束，暫存資料夾才刪得掉
afterEach(async () => {
  await Promise.all(
    children.splice(0).map(
      (c) =>
        new Promise((resolve) => {
          if (c.exitCode !== null || c.signalCode !== null) return resolve()
          c.once('exit', resolve)
          c.kill()
        }),
    ),
  )
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

/** 啟動後端，回傳 { base, output() } */
async function start(env) {
  const clean = { ...process.env }
  for (const k of ['TEACHER_PASSWORD', 'GOOGLE_SERVICE_ACCOUNT_KEY_FILE', 'SERVER_PORT', 'PORT']) delete clean[k]
  const child = spawn(process.execPath, [ENTRY], { cwd: dir, env: { ...clean, SERVER_PORT: '0', ...env } })
  children.push(child)
  let out = ''
  child.stdout.on('data', (d) => (out += d))
  child.stderr.on('data', (d) => (out += d))
  const m = await until(() => out.match(/listening on http:\/\/localhost:(\d+)/), 10000)
  return { base: `http://localhost:${m[1]}`, output: () => out }
}

describe('進入點', () => {
  it('未設定密碼：終端機印出一組隨機密碼，可以用它登入', async () => {
    const { base, output } = await start({})
    const pw = output().match(/本次啟動的教師密碼：(\S+)/)[1]
    const t = agent(base)
    expect((await t.post('/api/teacher/login', { password: pw })).status).toBe(204)
    expect((await agent(base).post('/api/teacher/login', { password: 'wrong' })).status).toBe(401)
  })

  it('沒有設定金鑰：正常啟動並提示未設定憑證；匯入回應 503 SHEETS_UNAVAILABLE', async () => {
    const { base, output } = await start({ TEACHER_PASSWORD: 'pw-for-test' })
    expect(output()).toContain('未設定 Google 憑證')
    const t = agent(base)
    await t.post('/api/teacher/login', { password: 'pw-for-test' })
    const r = await t.post('/api/sheets/import', { sheetUrl: 'https://docs.google.com/spreadsheets/d/abc/edit' })
    expect(r.status).toBe(503)
    expect(r.body.error.code).toBe('SHEETS_UNAVAILABLE')
  })

  it('金鑰檔無效：仍能啟動，輸出中沒有金鑰內容', async () => {
    const bad = path.join(dir, 'broken.json')
    fs.writeFileSync(bad, JSON.stringify({ private_key: FAKE_SECRET }))
    const { output } = await start({ TEACHER_PASSWORD: 'pw-for-test', GOOGLE_SERVICE_ACCOUNT_KEY_FILE: bad })
    expect(output()).toContain('匯入與寫回試算表將無法使用')
    expect(output()).not.toContain(FAKE_SECRET)
  })

  it('有效的金鑰：印出 service account 的 email，不印出私鑰', async () => {
    const key = path.join(dir, 'ok.json')
    fs.writeFileSync(
      key,
      JSON.stringify({ type: 'service_account', client_email: 'bot@p.iam.gserviceaccount.com', private_key: FAKE_SECRET }),
    )
    const { output } = await start({ TEACHER_PASSWORD: 'pw-for-test', GOOGLE_SERVICE_ACCOUNT_KEY_FILE: key })
    expect(output()).toContain('bot@p.iam.gserviceaccount.com')
    expect(output()).not.toContain(FAKE_SECRET)
  })

  it('不提供測試鉤子：POST /__mock/reset 回應 404', async () => {
    const { base } = await start({ TEACHER_PASSWORD: 'pw-for-test' })
    expect((await fetch(`${base}/__mock/reset`, { method: 'POST' })).status).toBe(404)
  })
})
