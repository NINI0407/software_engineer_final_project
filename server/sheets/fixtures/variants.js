// 變形版面的 Grid 資料（design B9 的解析器單元測試、tasks 2.2）。
// 都以 single.js、group.js（取自 samples/ 兩份範本）為基礎修改，模擬助教可能使用的其他 Guided Notes。
// 每個函式都回傳新的物件，呼叫端可以自由修改。

import { makeGrid, shiftLayout, withValues } from './make-grid.js'
import { singleMerges, singleValues, singleGrid } from './single.js'
import { groupMerges, groupValues, groupGrid } from './group.js'

// 平移後放在表頭上方的說明列。第二列同時提到「題號」「作答」，但不是單獨的表頭儲存格，不能被當成表頭
const NOTES = {
  D2: '使用說明',
  D3: '請在「作答」欄填寫答案，題號欄請勿修改',
  D4: '每題答案以小組為單位提交',
}

/** 單題範本整體往下 3 列、往右 2 欄，並在表頭上方加說明列。作答格為 I8、I10…I18 */
export function shiftedSingleGrid() {
  const { values, merges } = shiftLayout({ values: singleValues(), merges: singleMerges() }, 3, 2)
  return makeGrid({ sheetId: 0, title: '學習單', index: 0, values: { ...NOTES, ...values }, merges })
}

/** 題組範本整體往下 3 列、往右 2 欄，並在表頭上方加說明列。作答格為 J8、J9、J11、J12、I14、I16 */
export function shiftedGroupGrid() {
  const { values, merges } = shiftLayout({ values: groupValues(), merges: groupMerges() }, 3, 2)
  return makeGrid({ sheetId: 0, title: '學習單', index: 0, values: { ...NOTES, ...values }, merges })
}

/** 沒有題目表頭的說明頁 */
export function explanationGrid({ sheetId = 1001, title = '說明', index = 0 } = {}) {
  return makeGrid({
    sheetId,
    title,
    index,
    values: {
      A1: '計算機概論基礎 學習單說明',
      A3: '1. 請先閱讀課本第一章',
      A4: '2. 題目在「學習單」工作表，請在作答欄填寫答案',
      A6: '題號',
    },
    merges: ['A1:F1'],
  })
}

/**
 * 多工作表：第一個是說明頁，第二個是單題學習單，第三個是題組學習單。
 * sheetId 依序為 1001、2002、3003。
 */
export function multiSheetSpreadsheet() {
  return {
    spreadsheetTitle: '軟工期末專案_多工作表_範例',
    sheets: [
      explanationGrid({ sheetId: 1001, title: '說明', index: 0 }),
      singleGrid({ sheetId: 2002, title: '學習單', index: 1 }),
      groupGrid({ sheetId: 3003, title: '題組', index: 2 }),
    ],
  }
}

/**
 * 題號的各種寫法：`1`、`2.0`（xlsx 原始數值）、`3.`、`第 4 題`、`5、`，
 * 以及前後有全形空白與零寬字元的 `6．`。題號應解析為 1 到 6，作答格與單題範本相同。
 */
export function numberFormatsGrid() {
  return makeGrid({
    sheetId: 0,
    title: '學習單',
    values: withValues(singleValues(), {
      B5: '1',
      B7: '2.0',
      B9: '3.',
      B11: '第 4 題',
      B13: '5、',
      B15: '\u30006．\u200B',
    }),
    merges: singleMerges(),
  })
}

/** 題號重複：題號依序為 1、2、3、3、5、6 */
export function duplicateNumberGrid() {
  return makeGrid({
    sheetId: 0,
    title: '學習單',
    values: withValues(singleValues(), { B11: '3' }),
    merges: singleMerges(),
  })
}

/** 題號不連續：只有三題，題號依序為 1、2、4（作答格 G5、G7、G9） */
export function gapNumberGrid() {
  return makeGrid({
    sheetId: 0,
    title: '學習單',
    values: withValues(singleValues(), {
      B9: '4',
      B11: null, C11: null,
      B13: null, C13: null,
      B15: null, C15: null,
    }),
    merges: singleMerges(),
  })
}

/** 作答格已有內容：第 2 題的作答格 G7 已經寫了「CPU」 */
export function prefilledAnswerGrid() {
  return makeGrid({
    sheetId: 0,
    title: '學習單',
    values: withValues(singleValues(), { G7: 'CPU' }),
    merges: singleMerges(),
  })
}

/** 作答區只有一欄（G4 沒有合併），而且第 1 題的作答區是「（1）」「（2）」標籤，右邊沒有作答格 */
export function labelWithoutAnswerGrid() {
  return makeGrid({
    sheetId: 0,
    title: '學習單',
    values: {
      B2: '計算機概論基礎 學習單',
      B4: '題號',
      C4: '題目',
      G4: '作答',
      B5: '1',
      C5: '電腦的大腦英文簡稱是什麼？',
      G5: '（1）',
      C6: '管理軟硬體資源的系統軟體統稱為什麼？',
      G6: '（2）',
    },
    merges: ['B2:G2', 'C4:F4', 'B5:B6', 'C5:F5', 'C6:F6'],
  })
}

/** 沒有表頭：「作答」與「題號」不在同一列，而且題目表頭用的是「答案」 */
export function noHeaderGrid() {
  return makeGrid({
    sheetId: 0,
    title: '學習單',
    values: withValues(singleValues(), { G3: '作答', G4: '答案' }),
    merges: singleMerges().filter((range) => range !== 'B3:H3'),
  })
}
