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
    const err = await api.upload(new File(['a'], 'a.xlsx')).catch((e) => e)
    expect(err).toMatchObject({ status: 422, code: 'PARSE_FAILED', details: '找不到表頭' })
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
