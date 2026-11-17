/** 送出前的輸入驗證（design F3）。前端只是第一道防線，最後一道由後端檢查。 */

export const MAX_ANSWER_LENGTH = 500

/**
 * 視為「空白」的字元：JS 的 \s（含半形空白、Tab、換行、U+3000 全形空白等）
 * 以及 \s 不涵蓋的零寬字元 U+200B、U+200C、U+200D，以及 U+FEFF。
 */
const EDGE_BLANKS = /^[\s​‌‍﻿]+|[\s​‌‍﻿]+$/g

export function normalizeAnswer(text: string): string {
  return text.replace(EDGE_BLANKS, '')
}

export type FieldError = 'blank' | 'tooLong' | null

export function validateField(text: string): FieldError {
  const t = normalizeAnswer(text)
  if (t.length === 0) return 'blank'
  if ([...t].length > MAX_ANSWER_LENGTH) return 'tooLong'
  return null
}

export const FIELD_ERROR_TEXT: Record<Exclude<FieldError, null>, string> = {
  blank: '答案不可為空白',
  tooLong: `答案不可超過 ${MAX_ANSWER_LENGTH} 字`,
}

export interface ValidationResult {
  ok: boolean
  /** blankId → 錯誤 */
  errors: Record<string, FieldError>
  /** 通過時為 trim 後要送出的答案 */
  answers: { blankId: string; text: string }[]
}

/** 題組每一格都必須有內容；任一格不合法即整份不送出 */
export function validateAnswers(fields: { blankId: string; text: string }[]): ValidationResult {
  const errors: Record<string, FieldError> = {}
  let ok = fields.length > 0
  for (const f of fields) {
    const e = validateField(f.text)
    errors[f.blankId] = e
    if (e) ok = false
  }
  return {
    ok,
    errors,
    answers: fields.map((f) => ({ blankId: f.blankId, text: normalizeAnswer(f.text) })),
  }
}
