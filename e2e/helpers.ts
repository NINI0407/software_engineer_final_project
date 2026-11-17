import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test'

export const MOCK = 'http://localhost:3100'
export const BASE = 'http://localhost:5174'
export const PASSWORD = () => process.env.E2E_TEACHER_PASSWORD as string

const samplePath = (name: string) => fileURLToPath(new URL(`../samples/${name}`, import.meta.url))
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export const FILES = {
  single: { name: '軟工期末專案_單題_範例.xlsx', mimeType: XLSX, buffer: readFileSync(samplePath('軟工期末專案_單題_範例.xlsx')) },
  group: { name: '軟工期末專案_題組_範例.xlsx', mimeType: XLSX, buffer: readFileSync(samplePath('軟工期末專案_題組_範例.xlsx')) },
  /** 另一份 Guided Notes：mock 依檔名回傳 9 題、不同儲存格位置的預覽 */
  variant: { name: '另一份_變體.xlsx', mimeType: XLSX, buffer: readFileSync(samplePath('軟工期末專案_單題_範例.xlsx')) },
  invalid: { name: 'invalid_notes.xlsx', mimeType: XLSX, buffer: Buffer.from('x') },
  notXlsx: { name: 'notes.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b') },
}
export type FileKind = keyof typeof FILES

/** 呼叫 mock 測試鉤子 */
export async function hook(path: string, body: unknown = {}) {
  const res = await fetch(`${MOCK}/__mock/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(res.ok, `hook ${path} → ${res.status}`).toBeTruthy()
  return res.status === 204 ? null : res.json()
}

export const reset = () => hook('reset')

/** 每個 context 有獨立的 Cookie，等同一位獨立的使用者 */
export const newContext = (browser: Browser) => browser.newContext({ baseURL: BASE })

export async function teacherContext(browser: Browser) {
  const ctx = await newContext(browser)
  const res = await ctx.request.post('/api/teacher/login', { data: { password: PASSWORD() } })
  expect(res.status()).toBe(204)
  return ctx
}

export async function createActivity(ctx: BrowserContext, kind: FileKind = 'single', groupCount = 3) {
  const up = await ctx.request.post('/api/uploads', { multipart: { file: FILES[kind] } })
  expect(up.ok()).toBeTruthy()
  const { uploadId } = await up.json()
  const res = await ctx.request.post('/api/activities', { data: { uploadId, groupCount } })
  expect(res.status()).toBe(201)
  return (await res.json()).activity.code as string
}

export async function openBoard(ctx: BrowserContext, code: string) {
  const page = await ctx.newPage()
  await page.goto(`/teacher/board/${code}`)
  await expect(page.getByTestId('conn-status')).toHaveText('已連線')
  return page
}

export interface Student {
  ctx: BrowserContext
  page: Page
  clientId: string
}

/** 以 API 加入（並選組），再開啟學生頁面 */
export async function joinStudent(
  browser: Browser,
  code: string,
  nickname: string,
  groupId?: string,
  { open = true } = {},
): Promise<Student> {
  const ctx = await newContext(browser)
  const j = await ctx.request.post(`/api/activities/${code}/join`, { data: { nickname } })
  expect(j.ok()).toBeTruthy()
  const clientId = (await j.json()).me.clientId as string
  if (groupId) {
    const g = await ctx.request.put(`/api/activities/${code}/me/group`, { data: { groupId } })
    expect(g.ok()).toBeTruthy()
  }
  const page = await ctx.newPage()
  if (open) {
    await page.goto(`/play/${code}`)
    await expect(page.getByTestId('conn-status')).toHaveText('已連線')
  }
  return { ctx, page, clientId }
}

export function questionApi(ctx: BrowserContext, code: string) {
  const post = async (qid: string, action: string) => {
    const r = await ctx.request.post(`/api/activities/${code}/questions/${qid}/${action}`)
    expect(r.status(), `${action} ${qid}`).toBe(204)
  }
  return {
    open: (qid: string) => post(qid, 'open'),
    close: (qid: string) => post(qid, 'close'),
    reopen: (qid: string) => post(qid, 'reopen'),
  }
}

export async function submitViaApi(s: Student, code: string, qid: string, round: number, texts: string[]) {
  const answers = texts.map((text, i) => ({ blankId: `${qid}b${i + 1}`, text }))
  return s.ctx.request.post(`/api/activities/${code}/questions/${qid}/submissions`, { data: { round, answers } })
}

/** 計算頁面發出的某類請求數 */
export function countRequests(page: Page, predicate: (url: string, method: string) => boolean) {
  const counter = { n: 0 }
  page.on('request', (r) => {
    if (predicate(r.url(), r.method())) counter.n++
  })
  return counter
}
