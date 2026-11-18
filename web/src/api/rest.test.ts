import { afterEach, describe, expect, it } from 'vitest'
import { api, RestError, setFetch } from './rest'

function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  setFetch(((url: string, init: RequestInit) => impl(url, init)) as typeof fetch)
}

afterEach(() => setFetch((...a) => fetch(...a)))

describe('rest 錯誤轉換', () => {
  it('成功回應回傳 JSON；204 回傳 undefined', async () => {
    mockFetch(async () => new Response(JSON.stringify({ authenticated: true }), { status: 200 }))
    await expect(api.session()).resolves.toEqual({ authenticated: true })
    mockFetch(async () => new Response(null, { status: 204 }))
    await expect(api.login('x')).resolves.toBeUndefined()
  })

  it('{error:{code}} 轉成 { status, code, message }', async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify({ error: { code: 'NOT_LEADER', message: '只有組長能送出' } }), {
          status: 403,
        }),
    )
    const err = await api.submit('ABC234', 'q1', 1, []).catch((e) => e)
    expect(err).toBeInstanceOf(RestError)
    expect(err).toMatchObject({ status: 403, code: 'NOT_LEADER', message: '只有組長能送出' })
  })

  it('保留 details', async () => {
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({ error: { code: 'PARSE_FAILED', message: 'x', details: '找不到表頭' } }),
          { status: 422 },
        ),
    )
    const err = await api.importSheet('https://docs.google.com/spreadsheets/d/x').catch((e) => e)
    expect(err).toMatchObject({ status: 422, code: 'PARSE_FAILED', details: '找不到表頭' })
    expect(err.shareWith).toBeUndefined()
  })

  it('保留 shareWith', async () => {
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: 'SHEET_NOT_SHARED', message: 'x', shareWith: 'bot@example.iam.gserviceaccount.com' },
          }),
          { status: 403 },
        ),
    )
    const err = await api.importSheet('https://docs.google.com/spreadsheets/d/x').catch((e) => e)
    expect(err).toBeInstanceOf(RestError)
    expect(err).toMatchObject({
      status: 403,
      code: 'SHEET_NOT_SHARED',
      shareWith: 'bot@example.iam.gserviceaccount.com',
    })
  })

  it('網路錯誤轉成 NETWORK_ERROR', async () => {
    mockFetch(async () => {
      throw new TypeError('failed to fetch')
    })
    const err = await api.session().catch((e) => e)
    expect(err).toMatchObject({ status: 0, code: 'NETWORK_ERROR' })
  })

  it('非 JSON 的錯誤內容使用 UNKNOWN_ERROR', async () => {
    mockFetch(async () => new Response('oops', { status: 500 }))
    const err = await api.session().catch((e) => e)
    expect(err).toMatchObject({ status: 500, code: 'UNKNOWN_ERROR' })
  })

  it('送出時帶 round 與 answers，並以 JSON 傳送', async () => {
    let seen: { url: string; init: RequestInit } | null = null
    mockFetch(async (url, init) => {
      seen = { url, init }
      return new Response(JSON.stringify({ submittedAt: 't' }), { status: 201 })
    })
    await api.submit('ABC234', 'q1', 2, [{ blankId: 'b1', text: 'CPU' }])
    expect(seen!.url).toBe('/api/activities/ABC234/questions/q1/submissions')
    expect(JSON.parse(seen!.init.body as string)).toEqual({
      round: 2,
      answers: [{ blankId: 'b1', text: 'CPU' }],
    })
  })
})

describe('試算表相關請求', () => {
  function capture(status: number, body: unknown) {
    const seen: { url: string; init: RequestInit }[] = []
    mockFetch(async (url, init) => {
      seen.push({ url, init })
      return new Response(JSON.stringify(body), { status })
    })
    return seen
  }
  const jsonBody = (init: RequestInit) => JSON.parse(init.body as string)

  it('匯入：POST /api/sheets/import { sheetUrl }', async () => {
    const seen = capture(200, { importId: 'i1' })
    const url = 'https://docs.google.com/spreadsheets/d/abc/edit'
    await expect(api.importSheet(url)).resolves.toEqual({ importId: 'i1' })
    expect(seen[0].url).toBe('/api/sheets/import')
    expect(seen[0].init.method).toBe('POST')
    expect(jsonBody(seen[0].init)).toEqual({ sheetUrl: url })
  })

  it('建立活動：POST /api/activities { importId, groupCount }', async () => {
    const seen = capture(201, {})
    await api.createActivity('i1', 6)
    expect(seen[0].url).toBe('/api/activities')
    expect(jsonBody(seen[0].init)).toEqual({ importId: 'i1', groupCount: 6 })
  })

  it('寫回：POST /api/activities/:code/export-to-sheet { basedOnVersion }', async () => {
    const seen = capture(200, { writtenCells: 3 })
    await expect(api.exportToSheet('ABC234', 12)).resolves.toEqual({ writtenCells: 3 })
    expect(seen[0].url).toBe('/api/activities/ABC234/export-to-sheet')
    expect(seen[0].init.method).toBe('POST')
    expect(jsonBody(seen[0].init)).toEqual({ basedOnVersion: 12 })
  })

  it('不再提供上傳與 Excel 下載', () => {
    expect(api).not.toHaveProperty('upload')
    expect(api).not.toHaveProperty('exportXlsxUrl')
    expect(api.exportCsvUrl('ABC234')).toBe('/api/activities/ABC234/export.csv')
  })
})
