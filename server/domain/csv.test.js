// CSV 匯出的單元測試（change build-quiz-backend，task 3.4）。
// 測試名稱對應 spec `quiz-backend`「CSV 匯出」的 Scenario。

import { describe, expect, it } from 'vitest'
import { createStore } from './store.js'
import {
  chooseGroup,
  closeQuestion,
  createActivity,
  joinActivity,
  memberConnected,
  openQuestion,
  submitAnswer,
} from './activity.js'
import { buildCsv, csvField } from './csv.js'

const blank = (label, row, col, cellRef) => ({ label, row, col, cellRef })

function makeImport() {
  return {
    spreadsheetId: 'sheet-id-123',
    sheetId: 0,
    spreadsheetTitle: '資訊概論學習單',
    worksheetTitle: '學習單',
    sheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-id-123',
    questions: [
      { number: 1, blanks: [blank('（1）', 4, 7, '學習單!H5'), blank('（2）', 5, 7, '學習單!H6')] },
      { number: 2, blanks: [blank('（1）', 7, 7, '學習單!H8'), blank('（2）', 8, 7, '學習單!H9')] },
      { number: 3, blanks: [blank(null, 10, 6, '學習單!G11')] },
      { number: 4, blanks: [blank(null, 12, 6, '學習單!G13')] },
    ],
  }
}

/** 3 組，各有一位在線的組長 */
function setup() {
  const store = createStore()
  const act = createActivity(store, makeImport(), 3)
  const leaders = {}
  for (const [gid, name] of [
    ['g1', '小明'],
    ['g2', '小華'],
    ['g3', '小美'],
  ]) {
    const { clientId } = joinActivity(act, null, name)
    chooseGroup(act, clientId, gid)
    memberConnected(act, clientId)
    leaders[gid] = clientId
  }
  const single = (gid, qid, text) =>
    submitAnswer(act, leaders[gid], qid, { round: 1, answers: [{ blankId: `${qid}b1`, text }] })
  const pair = (gid, qid, x, y) =>
    submitAnswer(act, leaders[gid], qid, {
      round: 1,
      answers: [
        { blankId: `${qid}b1`, text: x },
        { blankId: `${qid}b2`, text: y },
      ],
    })
  return { act, single, pair }
}

const lines = (content) => content.replace(/^﻿/, '').split('\r\n')

describe('CSV 匯出', () => {
  it('匯出 CSV：檔名為「活動代號_results.csv」，第一列為表頭，依順位列出各組', () => {
    const { act, single } = setup()
    openQuestion(act, 'q3')
    single('g2', 'q3', '光合作用')
    single('g1', 'q3', '呼吸作用')
    closeQuestion(act, 'q3')
    const { fileName, content } = buildCsv(act)
    expect(fileName).toBe(`${act.code}_results.csv`)
    expect(lines(content)).toEqual(['題號,組別,答案,搶答順位', '3,第 2 組,光合作用,1', '3,第 1 組,呼吸作用,2', ''])
  })

  it('內容為 UTF-8 含 BOM，換行為 CRLF，最後一列也以 CRLF 結束', () => {
    const { act } = setup()
    const { content } = buildCsv(act)
    expect(content.charCodeAt(0)).toBe(0xfeff)
    expect(content).toBe('﻿題號,組別,答案,搶答順位\r\n')
    expect(Buffer.from(content, 'utf8').subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
  })

  it('依題號與順位排序，只包含已結束的題目', () => {
    const { act, single, pair } = setup()
    openQuestion(act, 'q3')
    single('g3', 'q3', '丙')
    single('g1', 'q3', '甲')
    closeQuestion(act, 'q3')
    openQuestion(act, 'q1')
    pair('g1', 'q1', 'A', 'B')
    pair('g2', 'q1', 'C', 'D')
    closeQuestion(act, 'q1')
    openQuestion(act, 'q4')
    single('g1', 'q4', '進行中')
    expect(lines(buildCsv(act).content)).toEqual([
      '題號,組別,答案,搶答順位',
      '1,第 1 組,（1）A；（2）B,1',
      '1,第 2 組,（1）C；（2）D,2',
      '3,第 3 組,丙,1',
      '3,第 1 組,甲,2',
      '',
    ])
  })

  it('題組的答案以子填空標籤加答案串接', () => {
    const { act, pair } = setup()
    openQuestion(act, 'q1')
    pair('g2', 'q1', 'CPU', '作業系統')
    closeQuestion(act, 'q1')
    expect(lines(buildCsv(act).content)[1]).toBe('1,第 2 組,（1）CPU；（2）作業系統,1')
  })

  it('無人作答的題目沒有資料列', () => {
    const { act } = setup()
    openQuestion(act, 'q1')
    closeQuestion(act, 'q1')
    expect(lines(buildCsv(act).content)).toEqual(['題號,組別,答案,搶答順位', ''])
  })

  it('含逗號或換行的答案：欄位以雙引號包住，內部雙引號重複一次', () => {
    const { act, single } = setup()
    openQuestion(act, 'q3')
    single('g1', 'q3', '甲,乙')
    single('g2', 'q3', '他說"好"')
    single('g3', 'q3', '第一行\n第二行')
    closeQuestion(act, 'q3')
    const { content } = buildCsv(act)
    expect(content).toBe(
      '﻿題號,組別,答案,搶答順位\r\n' +
        '3,第 1 組,"甲,乙",1\r\n' +
        '3,第 2 組,"他說""好""",2\r\n' +
        '3,第 3 組,"第一行\n第二行",3\r\n',
    )
  })

  it('csvField 只在需要時加上雙引號', () => {
    expect(csvField('普通')).toBe('普通')
    expect(csvField(12)).toBe('12')
    expect(csvField('a,b')).toBe('"a,b"')
    expect(csvField('a"b')).toBe('"a""b"')
    expect(csvField('a\rb')).toBe('"a\rb"')
    expect(csvField('a\nb')).toBe('"a\nb"')
  })
})
