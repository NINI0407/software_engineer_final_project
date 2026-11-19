// spec google-sheets-sync「選擇工作表」「動態找出題目表頭」「辨識題目與題號」
// 「辨識作答格與題組子填空」與「匯入預覽與 warnings」的解析部分（design S3，tasks 2.3）
import { describe, expect, it } from 'vitest'
import { AppError } from '../domain/errors.js'
import { hasHeader, parseGuidedNotes, selectAndParse, toA1 } from './parser.js'
import { makeGrid, withValues } from './fixtures/make-grid.js'
import { singleGrid, singleMerges, singleSpreadsheet, singleValues } from './fixtures/single.js'
import { groupGrid, groupMerges, groupSpreadsheet, groupValues } from './fixtures/group.js'
import {
  duplicateNumberGrid,
  explanationGrid,
  gapNumberGrid,
  labelWithoutAnswerGrid,
  multiSheetSpreadsheet,
  noHeaderGrid,
  numberFormatsGrid,
  prefilledAnswerGrid,
  shiftedGroupGrid,
  shiftedSingleGrid,
} from './fixtures/variants.js'
import { pickSheet } from '../../mock/fixtures.js'

/** 只留下對外的欄位（number、label、cellRef），方便和 mock 的預覽比較 */
const preview = (questions) =>
  questions.map((q) => ({ number: q.number, blanks: q.blanks.map(({ label, cellRef }) => ({ label, cellRef })) }))

const cellRefs = (questions) => questions.flatMap((q) => q.blanks.map((b) => b.cellRef))

/** 用單題範本的版面，覆寫部分儲存格 */
const singleWith = (overrides, merges = singleMerges()) =>
  makeGrid({ sheetId: 0, title: '學習單', values: withValues(singleValues(), overrides), merges })

/** 用題組範本的版面，覆寫部分儲存格 */
const groupWith = (overrides) =>
  makeGrid({ sheetId: 0, title: '學習單', values: withValues(groupValues(), overrides), merges: groupMerges() })

function catchError(fn) {
  try {
    fn()
  } catch (e) {
    return e
  }
  throw new Error('預期會丟出錯誤，但沒有')
}

function expectParseFailed(fn, details) {
  const e = catchError(fn)
  expect(e).toBeInstanceOf(AppError)
  expect(e.status).toBe(422)
  expect(e.code).toBe('PARSE_FAILED')
  expect(e.message).toBe('解析失敗')
  expect(e.details).toBe(details)
}

describe('toA1', () => {
  it('從 0 起算的欄列轉成 A1', () => {
    expect(toA1(0, 0)).toBe('A1')
    expect(toA1(4, 6)).toBe('G5')
    expect(toA1(9, 25)).toBe('Z10')
  })

  it('支援 Z 以後的欄', () => {
    expect(toA1(0, 26)).toBe('AA1')
    expect(toA1(1, 27)).toBe('AB2')
    expect(toA1(2, 51)).toBe('AZ3')
    expect(toA1(3, 52)).toBe('BA4')
    expect(toA1(4, 701)).toBe('ZZ5')
    expect(toA1(5, 702)).toBe('AAA6')
  })
})

describe('動態找出題目表頭', () => {
  it('範本的位置：題號欄為 B，作答區為 G 到 H', () => {
    expect(hasHeader(singleGrid())).toBe(true)
    const { questions } = parseGuidedNotes(singleGrid())
    // 題號取自 B 欄的 B5、B7…B15；單題的作答格是作答區 G:H 的左上角 G
    expect(questions.map((q) => q.blanks[0].row)).toEqual([4, 6, 8, 10, 12, 14])
    expect(questions.every((q) => q.blanks[0].col === 6)).toBe(true)
    // 題組的子填空作答格在 H，表示作答區涵蓋到 H
    expect(parseGuidedNotes(groupGrid()).questions[0].blanks.map((b) => b.col)).toEqual([7, 7])
  })

  it('表頭移到其他位置：單題範本平移 3 列 2 欄並加上說明列，題目相同、cellRef 跟著移動', () => {
    const base = parseGuidedNotes(singleGrid())
    const shifted = parseGuidedNotes(shiftedSingleGrid())
    expect(shifted.questions.map((q) => q.number)).toEqual(base.questions.map((q) => q.number))
    expect(shifted.questions.map((q) => q.blanks.length)).toEqual(base.questions.map((q) => q.blanks.length))
    expect(cellRefs(shifted.questions)).toEqual([
      '學習單!I8', '學習單!I10', '學習單!I12', '學習單!I14', '學習單!I16', '學習單!I18',
    ])
    shifted.questions.forEach((q, i) => {
      expect(q.blanks[0].row).toBe(base.questions[i].blanks[0].row + 3)
      expect(q.blanks[0].col).toBe(base.questions[i].blanks[0].col + 2)
    })
    expect(shifted.warnings).toEqual([])
  })

  it('表頭移到其他位置：題組範本平移後子填空與標籤都相同', () => {
    expect(preview(parseGuidedNotes(shiftedGroupGrid()).questions)).toEqual([
      { number: 1, blanks: [{ label: '（1）', cellRef: '學習單!J8' }, { label: '（2）', cellRef: '學習單!J9' }] },
      { number: 2, blanks: [{ label: '（1）', cellRef: '學習單!J11' }, { label: '（2）', cellRef: '學習單!J12' }] },
      { number: 3, blanks: [{ label: null, cellRef: '學習單!I14' }] },
      { number: 4, blanks: [{ label: null, cellRef: '學習單!I16' }] },
    ])
  })

  it('說明文字中同時提到「題號」「作答」的儲存格不算表頭', () => {
    // shiftedSingleGrid 的 D3 是「請在「作答」欄填寫答案，題號欄請勿修改」，真正的表頭在第 7 列
    expect(parseGuidedNotes(shiftedSingleGrid()).questions[0].blanks[0].cellRef).toBe('學習單!I8')
  })

  it('表頭比對忽略空白（含全形空白與零寬字元）', () => {
    const grid = singleWith({ B4: ' 題　號 ', G4: '作​答﻿' })
    expect(cellRefs(parseGuidedNotes(grid).questions)).toHaveLength(6)
  })

  it('沒有表頭：回應 422 PARSE_FAILED「找不到題號/作答表頭」', () => {
    expect(hasHeader(noHeaderGrid())).toBe(false)
    expect(hasHeader(explanationGrid())).toBe(false)
    expectParseFailed(() => parseGuidedNotes(noHeaderGrid()), '找不到題號/作答表頭')
    expectParseFailed(() => parseGuidedNotes(explanationGrid()), '找不到題號/作答表頭')
    expectParseFailed(
      () => parseGuidedNotes({ sheetId: 0, title: '空白', index: 0, cells: [], merges: [] }),
      '找不到題號/作答表頭',
    )
  })
})

describe('辨識題目與題號', () => {
  it('單題範本：預覽有 6 題，題號為 1 到 6', () => {
    const { questions, warnings } = parseGuidedNotes(singleGrid())
    expect(questions.map((q) => q.number)).toEqual([1, 2, 3, 4, 5, 6])
    expect(questions.every((q) => q.blanks.length === 1)).toBe(true)
    expect(warnings).toEqual([])
  })

  it('題號的各種寫法：1、2.0、3.、第 4 題、5、、前後有空白的 6．', () => {
    const { questions, warnings } = parseGuidedNotes(numberFormatsGrid())
    expect(questions.map((q) => q.number)).toEqual([1, 2, 3, 4, 5, 6])
    expect(cellRefs(questions)).toEqual(cellRefs(parseGuidedNotes(singleGrid()).questions))
    expect(warnings).toEqual([])
  })

  it('第 1 題寫成「1」「1.0」「1.」「第 1 題」等寫法都是第 1 題', () => {
    for (const text of ['1', '1.0', '1.', '第 1 題', '第1題', '1、', '1．', '01', '1.00']) {
      expect(parseGuidedNotes(singleWith({ B5: text })).questions[0].number, text).toBe(1)
    }
  })

  it('不是正整數題號的列都跳過（0、小數、負數、文字）', () => {
    const grid = singleWith({ B7: '0', B9: '2.5', B11: '-4', B13: '備註', B15: '2' })
    const { questions } = parseGuidedNotes(grid)
    expect(questions.map((q) => q.number)).toEqual([1, 2])
    expect(cellRefs(questions)).toEqual(['學習單!G5', '學習單!G15'])
  })

  it('表頭上方的數字不算題目', () => {
    const grid = singleWith({ B3: '9' }, singleMerges().filter((r) => r !== 'B3:H3'))
    expect(parseGuidedNotes(grid).questions.map((q) => q.number)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('題號重複：回應 422 PARSE_FAILED，details 指出第 3 題重複', () => {
    expectParseFailed(() => parseGuidedNotes(duplicateNumberGrid()), '第 3 題的題號重複')
  })

  it('題號不連續：預覽有 3 題，warnings 包含題號不連續的提醒', () => {
    const { questions, warnings } = parseGuidedNotes(gapNumberGrid())
    expect(questions.map((q) => q.number)).toEqual([1, 2, 4])
    expect(cellRefs(questions)).toEqual(['學習單!G5', '學習單!G7', '學習單!G9'])
    expect(warnings).toEqual(['題號不連續：缺少第 3 題'])
  })

  it('題號不連續時列出所有缺少的題號', () => {
    const grid = singleWith({ B5: '2', B7: '4', B9: '8', B11: null, B13: null, B15: null })
    expect(parseGuidedNotes(grid).warnings).toEqual(['題號不連續：缺少第 1、3、5 到 7 題'])
  })

  it('沒有任何題目：回應 422 PARSE_FAILED 並說明原因', () => {
    const grid = makeGrid({
      sheetId: 0,
      title: '學習單',
      values: { B4: '題號', C4: '題目', G4: '作答', C5: '還沒有題目' },
      merges: ['G4:H4'],
    })
    expectParseFailed(() => parseGuidedNotes(grid), '找不到任何題目：「題號」欄下方沒有正整數題號')
  })
})

describe('辨識作答格與題組子填空', () => {
  it('單題的作答格：第 1 題只有一個填空，標籤為 null，cellRef 為 學習單!G5', () => {
    expect(parseGuidedNotes(singleGrid()).questions[0]).toEqual({
      number: 1,
      blanks: [{ label: null, row: 4, col: 6, cellRef: '學習單!G5' }],
    })
  })

  it('單題範本得到 學習單!G5 到 G15，與 mock 的預覽一致', () => {
    const { questions } = parseGuidedNotes(singleGrid())
    expect(cellRefs(questions)).toEqual([
      '學習單!G5', '學習單!G7', '學習單!G9', '學習單!G11', '學習單!G13', '學習單!G15',
    ])
    expect(preview(questions)).toEqual(pickSheet('https://docs.google.com/spreadsheets/d/single/edit').preview.questions)
  })

  it('題組的子填空：第 1 題有兩個子填空，標籤為「（1）」「（2）」，cellRef 為 H5、H6', () => {
    expect(parseGuidedNotes(groupGrid()).questions[0]).toEqual({
      number: 1,
      blanks: [
        { label: '（1）', row: 4, col: 7, cellRef: '學習單!H5' },
        { label: '（2）', row: 5, col: 7, cellRef: '學習單!H6' },
      ],
    })
  })

  it('題組與單題混合：預覽有 4 題，第 3 題為 G11、第 4 題為 G13，與 mock 的預覽一致', () => {
    const { questions, warnings } = parseGuidedNotes(groupGrid())
    expect(preview(questions)).toEqual([
      { number: 1, blanks: [{ label: '（1）', cellRef: '學習單!H5' }, { label: '（2）', cellRef: '學習單!H6' }] },
      { number: 2, blanks: [{ label: '（1）', cellRef: '學習單!H8' }, { label: '（2）', cellRef: '學習單!H9' }] },
      { number: 3, blanks: [{ label: null, cellRef: '學習單!G11' }] },
      { number: 4, blanks: [{ label: null, cellRef: '學習單!G13' }] },
    ])
    expect(preview(questions)).toEqual(pickSheet('https://docs.google.com/spreadsheets/d/group/edit').preview.questions)
    expect(warnings).toEqual([])
  })

  it('半形標籤「(1)」也算子填空，label 保留原文字（去掉前後空白）', () => {
    const { questions } = parseGuidedNotes(groupWith({ G5: ' (1)​', G6: '（ 2 ）' }))
    expect(questions[0].blanks.map((b) => b.label)).toEqual(['(1)', '（ 2 ）'])
    expect(cellRefs([questions[0]])).toEqual(['學習單!H5', '學習單!H6'])
  })

  it('作答格是合併範圍時取左上角', () => {
    // 作答區為 G:J，標籤在 G，作答格 H5:J5、H6:J6 合併
    const grid = makeGrid({
      sheetId: 0,
      title: '學習單',
      values: { B4: '題號', G4: '作答', B5: '1', G5: '（1）', G6: '（2）' },
      merges: ['G4:J4', 'B5:B6', 'H5:J5', 'H6:J6'],
    })
    expect(cellRefs(parseGuidedNotes(grid).questions)).toEqual(['學習單!H5', '學習單!H6'])
  })

  it('標籤右邊沒有作答格：回應 422 PARSE_FAILED，details 指出第 1 題的（1）找不到作答格', () => {
    expectParseFailed(() => parseGuidedNotes(labelWithoutAnswerGrid()), '第 1 題的（1）找不到作答格')
  })

  it('cellRef 使用工作表名稱', () => {
    expect(parseGuidedNotes(singleGrid({ title: '第一週' })).questions[0].blanks[0].cellRef).toBe('第一週!G5')
  })

  it('作答區超過 Z 欄時 cellRef 仍正確', () => {
    const grid = makeGrid({
      sheetId: 0,
      title: '學習單',
      values: { Z4: '題號', AB4: '作答', Z5: '1', AB5: '（1）' },
      merges: ['AB4:AC4'],
    })
    expect(cellRefs(parseGuidedNotes(grid).questions)).toEqual(['學習單!AC5'])
  })
})

describe('匯入預覽與 warnings', () => {
  it('作答格已有內容：預覽仍然成功，warnings 包含第 2 題的覆寫提醒', () => {
    const { questions, warnings } = parseGuidedNotes(prefilledAnswerGrid())
    expect(questions).toHaveLength(6)
    expect(warnings).toEqual(['第 2 題的填空格原本已有內容，匯出時會被覆寫'])
  })

  it('題組子填空已有內容時也提醒，同一題只提醒一次', () => {
    expect(parseGuidedNotes(groupWith({ H8: 'CPU', H9: '作業系統' })).warnings).toEqual([
      '第 2 題的填空格原本已有內容，匯出時會被覆寫',
    ])
  })

  it('作答格只有空白時不算已有內容', () => {
    expect(parseGuidedNotes(singleWith({ G5: ' 　' })).warnings).toEqual([])
  })
})

describe('選擇工作表', () => {
  it('一般網址：gid 為 0 時解析 sheetId 為 0 的工作表', () => {
    const r = selectAndParse(singleSpreadsheet(), 0)
    expect(r.sheetId).toBe(0)
    expect(r.worksheetTitle).toBe('學習單')
    expect(r.questions).toHaveLength(6)
    expect(r.warnings).toEqual([])
  })

  it('沒有 gid 時單題與題組範本都能解析', () => {
    expect(selectAndParse(singleSpreadsheet(), null).questions).toHaveLength(6)
    expect(cellRefs(selectAndParse(groupSpreadsheet(), undefined).questions)).toEqual([
      '學習單!H5', '學習單!H6', '學習單!H8', '學習單!H9', '學習單!G11', '學習單!G13',
    ])
  })

  it('指定的工作表不存在：回應 422 WORKSHEET_NOT_FOUND', () => {
    const e = catchError(() => selectAndParse(singleSpreadsheet(), 12345))
    expect(e).toBeInstanceOf(AppError)
    expect(e.status).toBe(422)
    expect(e.code).toBe('WORKSHEET_NOT_FOUND')
    expect(e.message).toBe('找不到指定的工作表')
    expect(e.details).toBe('找不到 gid 為 12345 的工作表')
  })

  it('第一個工作表是說明頁：沒有 gid 時選第二個工作表「學習單」', () => {
    const r = selectAndParse(multiSheetSpreadsheet(), null)
    expect(r.sheetId).toBe(2002)
    expect(r.worksheetTitle).toBe('學習單')
    expect(cellRefs(r.questions)[0]).toBe('學習單!G5')
  })

  it('依 index 順序選擇，而不是陣列順序', () => {
    const spreadsheet = multiSheetSpreadsheet()
    spreadsheet.sheets.reverse()
    expect(selectAndParse(spreadsheet, null).worksheetTitle).toBe('學習單')
  })

  it('有 gid 時只解析該工作表', () => {
    const r = selectAndParse(multiSheetSpreadsheet(), 3003)
    expect(r.sheetId).toBe(3003)
    expect(r.worksheetTitle).toBe('題組')
    expect(cellRefs(r.questions)[0]).toBe('題組!H5')
  })

  it('gid 指到沒有表頭的工作表時回應 PARSE_FAILED，不會改用其他工作表', () => {
    expectParseFailed(() => selectAndParse(multiSheetSpreadsheet(), 1001), '找不到題號/作答表頭')
  })

  it('沒有 gid 且所有工作表都沒有表頭：回應 422 PARSE_FAILED', () => {
    const spreadsheet = {
      spreadsheetTitle: '空的',
      sheets: [explanationGrid(), { ...noHeaderGrid(), sheetId: 5, index: 1 }],
    }
    expectParseFailed(() => selectAndParse(spreadsheet, null), '找不到題號/作答表頭')
  })
})

describe('fixtures', () => {
  it('每次呼叫都回傳新的 Grid 物件', () => {
    const a = singleGrid()
    expect(a).toEqual(singleGrid())
    expect(a).not.toBe(singleGrid())
    a.cells[4][1] = '99'
    expect(singleGrid().cells[4][1]).toBe('1')
  })

  it('整份試算表的標題與 sheetId', () => {
    expect(singleSpreadsheet().spreadsheetTitle).toBe('軟工期末專案_單題_範例')
    expect(groupSpreadsheet().spreadsheetTitle).toBe('軟工期末專案_題組_範例')
    expect(singleSpreadsheet().sheets[0].sheetId).toBe(0)
    expect(groupSpreadsheet().sheets[0].sheetId).toBe(0)
  })
})
