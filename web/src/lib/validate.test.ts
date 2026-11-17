import { describe, expect, it } from 'vitest'
import { normalizeAnswer, validateAnswers, validateField } from './validate'

describe('normalizeAnswer', () => {
  it('去掉前後的半形空白、Tab、換行', () => {
    expect(normalizeAnswer(' \t\nCPU \r\n')).toBe('CPU')
  })
  it('去掉全形空白與零寬字元，但保留中間的空白', () => {
    expect(normalizeAnswer('　​Central Processing‌‍﻿　')).toBe(
      'Central Processing',
    )
  })
})

describe('validateField（送出前檢查空白與長度）', () => {
  it('全部空白：半形空白與換行', () => {
    expect(validateField('   \n  ')).toBe('blank')
  })
  it('全形空白與零寬字元', () => {
    expect(validateField('　​　')).toBe('blank')
    expect(validateField('‌‍﻿\t')).toBe('blank')
  })
  it('空字串', () => {
    expect(validateField('')).toBe('blank')
  })
  it('500 字可以、501 字超過', () => {
    expect(validateField('字'.repeat(500))).toBeNull()
    expect(validateField('字'.repeat(501))).toBe('tooLong')
  })
  it('長度以 trim 後計算', () => {
    expect(validateField(`  ${'a'.repeat(500)}  `)).toBeNull()
  })
})

describe('validateAnswers（題組每格必填）', () => {
  it('題組有一格空白就整份不通過，並標出那一格', () => {
    const r = validateAnswers([
      { blankId: 'b1', text: 'CPU' },
      { blankId: 'b2', text: ' ' },
    ])
    expect(r.ok).toBe(false)
    expect(r.errors).toEqual({ b1: null, b2: 'blank' })
  })
  it('全部有效時回傳 trim 後的答案', () => {
    const r = validateAnswers([
      { blankId: 'b1', text: ' CPU　' },
      { blankId: 'b2', text: '​作業系統\n' },
    ])
    expect(r.ok).toBe(true)
    expect(r.answers).toEqual([
      { blankId: 'b1', text: 'CPU' },
      { blankId: 'b2', text: '作業系統' },
    ])
  })
  it('沒有任何輸入框時不通過', () => {
    expect(validateAnswers([]).ok).toBe(false)
  })
})
