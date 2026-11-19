// CSV 匯出（change build-quiz-backend，spec「CSV 匯出」；格式與 mock 相同）。
// 欄位為「題號、組別、答案、搶答順位」，每組提交一列，依題號（題目順序）與順位排序；
// 題組的答案以「子填空標籤 + 答案」用全形分號串接。內容為 UTF-8 含 BOM，換行為 CRLF。

import { groupOf, questionOf } from './activity.js'
import { results } from './snapshots.js'

const HEADER = '題號,組別,答案,搶答順位'
const BOM = '﻿'

/** 含逗號、雙引號或換行時用雙引號包住，內部雙引號重複一次 */
export function csvField(value) {
  const s = String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function answerText(q, answers) {
  if (answers.length > 1) {
    return answers
      .map((a) => `${q.blanks.find((b) => b.id === a.blankId)?.label ?? ''}${a.text}`)
      .join('；')
  }
  return answers[0]?.text ?? ''
}

/**
 * @returns {{ fileName: string, content: string }}
 */
export function buildCsv(act) {
  const lines = [HEADER]
  for (const r of results(act)) {
    const q = questionOf(act, r.questionId)
    for (const s of r.submissions) {
      const groupName = groupOf(act, s.groupId)?.name ?? s.groupId
      lines.push([q.number, groupName, answerText(q, s.answers), s.rank].map(csvField).join(','))
    }
  }
  return { fileName: `${act.code}_results.csv`, content: BOM + lines.join('\r\n') + '\r\n' }
}
