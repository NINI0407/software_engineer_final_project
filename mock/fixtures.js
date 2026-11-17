// mock 的固定解析預覽資料（mock 不真的解析 Excel）。
// 單題、題組兩份的儲存格位置取自 samples/ 範本的實際結構；「變體」用來模擬另一份 Guided Notes。

const single = {
  questions: [5, 7, 9, 11, 13, 15].map((row, i) => ({
    number: i + 1,
    blanks: [{ label: null, cellRef: `學習單!G${row}` }],
  })),
  warnings: [],
}

const group = {
  questions: [
    { number: 1, blanks: [{ label: '（1）', cellRef: '學習單!H5' }, { label: '（2）', cellRef: '學習單!H6' }] },
    { number: 2, blanks: [{ label: '（1）', cellRef: '學習單!H8' }, { label: '（2）', cellRef: '學習單!H9' }] },
    { number: 3, blanks: [{ label: null, cellRef: '學習單!G11' }] },
    { number: 4, blanks: [{ label: null, cellRef: '學習單!G13' }] },
  ],
  warnings: [],
}

const variant = {
  questions: Array.from({ length: 9 }, (_, i) =>
    i === 3
      ? {
          number: i + 1,
          blanks: [
            { label: '（1）', cellRef: `講義B!F${14 + i * 3}` },
            { label: '（2）', cellRef: `講義B!F${15 + i * 3}` },
          ],
        }
      : { number: i + 1, blanks: [{ label: null, cellRef: `講義B!E${8 + i * 3}` }] },
  ),
  warnings: ['第 9 題的填空格原本已有內容，匯出時會被覆寫'],
}

/**
 * 依檔名選擇預覽資料。
 * @returns {{ kind: 'ok', preview: object } | { kind: 'notXlsx' } | { kind: 'parseFailed', details: string }}
 */
export function pickPreview(fileName) {
  const lower = fileName.toLowerCase()
  if (!lower.endsWith('.xlsx')) return { kind: 'notXlsx' }
  if (lower.includes('invalid')) return { kind: 'parseFailed', details: '找不到題號/作答表頭' }
  if (fileName.includes('變體') || lower.includes('variant')) return { kind: 'ok', preview: variant }
  if (fileName.includes('題組') || lower.includes('group')) return { kind: 'ok', preview: group }
  return { kind: 'ok', preview: single }
}
