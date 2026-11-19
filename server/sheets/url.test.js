// spec google-sheets-sync「解析試算表網址」（tasks 2.1）
import { describe, expect, it } from 'vitest'
import { AppError } from '../domain/errors.js'
import { parseSheetUrl } from './url.js'

function expectInvalid(url) {
  let caught
  try {
    parseSheetUrl(url)
  } catch (e) {
    caught = e
  }
  expect(caught, String(url)).toBeInstanceOf(AppError)
  expect(caught.status).toBe(400)
  expect(caught.code).toBe('INVALID_SHEET_URL')
  expect(caught.message).toBe('這不是有效的 Google 試算表網址')
}

describe('解析試算表網址', () => {
  it('一般網址：取出試算表 ID 與 #gid', () => {
    expect(parseSheetUrl('https://docs.google.com/spreadsheets/d/1AbC_x-9/edit#gid=0')).toEqual({
      spreadsheetId: '1AbC_x-9',
      gid: 0,
      normalizedUrl: 'https://docs.google.com/spreadsheets/d/1AbC_x-9/edit#gid=0',
    })
  })

  it('沒有 gid 時 gid 為 null，正規化網址不帶 gid', () => {
    expect(parseSheetUrl('https://docs.google.com/spreadsheets/d/1AbC_x-9')).toEqual({
      spreadsheetId: '1AbC_x-9',
      gid: null,
      normalizedUrl: 'https://docs.google.com/spreadsheets/d/1AbC_x-9/edit',
    })
    expect(parseSheetUrl('https://docs.google.com/spreadsheets/d/1AbC_x-9/edit?usp=sharing').gid).toBeNull()
  })

  it('分享網址中的 #gid 會保留在正規化網址', () => {
    const r = parseSheetUrl('https://docs.google.com/spreadsheets/d/abcDEF123/edit?usp=sharing#gid=123456789')
    expect(r.gid).toBe(123456789)
    expect(r.normalizedUrl).toBe('https://docs.google.com/spreadsheets/d/abcDEF123/edit#gid=123456789')
  })

  it('?gid= 參數也能取出 gid', () => {
    expect(parseSheetUrl('https://docs.google.com/spreadsheets/d/abcDEF123/edit?gid=42')).toEqual({
      spreadsheetId: 'abcDEF123',
      gid: 42,
      normalizedUrl: 'https://docs.google.com/spreadsheets/d/abcDEF123/edit#gid=42',
    })
    expect(parseSheetUrl('https://docs.google.com/spreadsheets/d/abcDEF123/edit?usp=sharing&gid=7').gid).toBe(7)
  })

  it('同時有 ?gid= 與 #gid= 時以 #gid= 為準', () => {
    expect(parseSheetUrl('https://docs.google.com/spreadsheets/d/abc/edit?gid=1#gid=2').gid).toBe(2)
  })

  it('前後空白不影響判斷', () => {
    const r = parseSheetUrl('  \n https://docs.google.com/spreadsheets/d/1AbC_x-9/edit#gid=5 \t')
    expect(r.spreadsheetId).toBe('1AbC_x-9')
    expect(r.gid).toBe(5)
  })

  it('不是 Google 試算表：回應 400 INVALID_SHEET_URL', () => {
    expectInvalid('https://example.com/spreadsheets/d/abc')
    expectInvalid('')
    expectInvalid('   ')
    expectInvalid('http://docs.google.com/spreadsheets/d/abc/edit')
    expectInvalid('https://docs.google.com/document/d/abc/edit')
    expectInvalid('https://docs.google.com/spreadsheets/d/')
    expectInvalid('https://docs.google.com/spreadsheets/d/abc.def/edit')
    expectInvalid('https://docs.google.com.evil.example/spreadsheets/d/abc')
    expectInvalid(undefined)
    expectInvalid(null)
    expectInvalid(123)
  })
})
