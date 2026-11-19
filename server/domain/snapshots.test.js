// 快照的單元測試（change build-quiz-backend，task 3.4）。
// 測試名稱對應 spec `quiz-backend`「快照的可見性」的 Scenario。

import { describe, expect, it, vi } from 'vitest'
import { createStore } from './store.js'
import {
  chooseGroup,
  closeQuestion,
  createActivity,
  joinActivity,
  memberConnected,
  memberDisconnected,
  openQuestion,
  reopenQuestion,
  submitAnswer,
  updateDraft,
} from './activity.js'
import { results, studentSnapshot, teacherSnapshot } from './snapshots.js'

const blank = (label, row, col, cellRef) => ({ label, row, col, cellRef })

function makeImport() {
  return {
    spreadsheetId: 'sheet-id-123',
    sheetId: 42,
    spreadsheetTitle: '資訊概論學習單',
    worksheetTitle: '學習單',
    sheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-id-123#gid=42',
    questions: [
      { number: 1, blanks: [blank('（1）', 4, 7, '學習單!H5'), blank('（2）', 5, 7, '學習單!H6')] },
      { number: 2, blanks: [blank('（1）', 7, 7, '學習單!H8'), blank('（2）', 8, 7, '學習單!H9')] },
      { number: 3, blanks: [blank(null, 10, 6, '學習單!G11')] },
      { number: 4, blanks: [blank(null, 12, 6, '學習單!G13')] },
    ],
  }
}

/** 3 組；第 1 組小明（組長）、小強，第 2 組小華，第 3 組小美；第 1 題進行中 */
function setup() {
  const act = createActivity(createStore(), makeImport(), 3)
  act.onCommit = vi.fn()
  const join = (nickname, groupId, online = true) => {
    const { clientId } = joinActivity(act, null, nickname)
    if (groupId) chooseGroup(act, clientId, groupId)
    if (online) memberConnected(act, clientId)
    return clientId
  }
  const a = join('小明', 'g1')
  const a2 = join('小強', 'g1')
  const b = join('小華', 'g2')
  const c = join('小美', 'g3')
  openQuestion(act, 'q1')
  return { act, join, a, a2, b, c }
}

const two = (x, y) => [
  { blankId: 'q1b1', text: x },
  { blankId: 'q1b2', text: y },
]

/** 收集物件中所有的 key（遞迴） */
function allKeys(value, out = new Set()) {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, out))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k)
      allKeys(v, out)
    }
  }
  return out
}

describe('快照的可見性', () => {
  it('進行中看不到他組：第 2 組已送出時，第 1 組學生的快照沒有第 2 組的答案、狀態或順位', () => {
    const { act, a, a2, b } = setup()
    updateDraft(act, b, { questionId: 'q1', round: 1, blankId: 'q1b1', text: '他組草稿' })
    submitAnswer(act, b, 'q1', { round: 1, answers: two('他組答案', '第二格') })
    updateDraft(act, a2, { questionId: 'q1', round: 1, blankId: 'q1b1', text: '本組草稿' })

    for (const id of [a, a2]) {
      const snap = studentSnapshot(act, id)
      const raw = JSON.stringify(snap)
      expect(raw).not.toContain('他組')
      expect(raw).not.toContain('第二格')
      expect(raw).not.toContain(b)
      expect(raw).not.toContain('小華')
      expect(snap).not.toHaveProperty('groups')
      expect(allKeys(snap).has('rank')).toBe(false)
      expect(allKeys(snap).has('submission')).toBe(false)
      expect(snap.results).toEqual([])
      expect(snap.myGroup.submitted).toBe(false)
      expect(snap.myGroup.members.map((m) => m.nickname)).toEqual(['小明', '小強'])
      expect(snap.myGroup.drafts).toEqual([
        { blankId: 'q1b1', text: '本組草稿', rev: 1, by: { clientId: a2, nickname: '小強' } },
      ])
    }
    // 第 2 組自己只看到已送出，不會看到順位
    const own = studentSnapshot(act, b)
    expect(own.myGroup.submitted).toBe(true)
    expect(allKeys(own).has('rank')).toBe(false)
  })

  it('學生看不到試算表：快照中沒有 sheet、試算表網址、標題或 cellRef', () => {
    const { act, a, b, join } = setup()
    submitAnswer(act, a, 'q1', { round: 1, answers: two('CPU', 'OS') })
    closeQuestion(act, 'q1')
    const noGroup = join('路人', null)
    for (const id of [a, b, noGroup, 'f'.repeat(24)]) {
      const snap = studentSnapshot(act, id)
      const keys = allKeys(snap)
      for (const k of ['sheet', 'cellRef', 'url', 'spreadsheetTitle', 'worksheetTitle', 'row', 'col', 'target', 'spreadsheetId', 'sheetId']) {
        expect(keys.has(k)).toBe(false)
      }
      const raw = JSON.stringify(snap)
      expect(raw).not.toContain('docs.google.com')
      expect(raw).not.toContain('資訊概論學習單')
      expect(raw).not.toContain('學習單!')
    }
  })

  it('結束後公開結果：所有學生的 results 包含第 1 題各組的答案與順位', () => {
    const { act, a, b, c } = setup()
    submitAnswer(act, b, 'q1', { round: 1, answers: two(' CPU ', '作業系統') })
    submitAnswer(act, a, 'q1', { round: 1, answers: two('記憶體', '硬碟') })
    closeQuestion(act, 'q1')
    for (const id of [a, b, c]) {
      const { results: r } = studentSnapshot(act, id)
      expect(r).toHaveLength(1)
      expect(r[0]).toMatchObject({ questionId: 'q1', round: 1, winnerGroupId: 'g2' })
      expect(r[0].submissions.map((s) => ({ groupId: s.groupId, rank: s.rank, answers: s.answers }))).toEqual([
        { groupId: 'g2', rank: 1, answers: two('CPU', '作業系統') },
        { groupId: 'g1', rank: 2, answers: two('記憶體', '硬碟') },
      ])
      expect(typeof r[0].submissions[0].submittedAt).toBe('string')
    }
  })
})

describe('學生快照', () => {
  it('欄位與介面約定相同', () => {
    const { act, a } = setup()
    const snap = studentSnapshot(act, a)
    expect(Object.keys(snap)).toEqual([
      'version',
      'activity',
      'questions',
      'currentQuestionId',
      'groupLocked',
      'me',
      'myGroup',
      'results',
    ])
    expect(snap.version).toBe(act.version)
    expect(snap.activity).toEqual({
      code: act.code,
      groups: [
        { id: 'g1', name: '第 1 組' },
        { id: 'g2', name: '第 2 組' },
        { id: 'g3', name: '第 3 組' },
      ],
    })
    expect(snap.questions[0]).toEqual({
      id: 'q1',
      number: 1,
      status: 'open',
      round: 1,
      blanks: [
        { id: 'q1b1', label: '（1）' },
        { id: 'q1b2', label: '（2）' },
      ],
    })
    expect(snap.questions[2].blanks).toEqual([{ id: 'q3b1', label: null }])
    expect(snap.currentQuestionId).toBe('q1')
    expect(snap.groupLocked).toBe(true)
    expect(snap.me).toEqual({ clientId: a, nickname: '小明', groupId: 'g1', isLeader: true })
    expect(snap.myGroup).toEqual({
      members: [
        { clientId: a, nickname: '小明', online: true, isLeader: true },
        { clientId: expect.any(String), nickname: '小強', online: true, isLeader: false },
      ],
      drafts: [],
      submitted: false,
    })
  })

  it('還沒選組時 myGroup 為 null，isLeader 為 false', () => {
    const { act, join } = setup()
    const id = join('路人', null)
    const snap = studentSnapshot(act, id)
    expect(snap.me).toEqual({ clientId: id, nickname: '路人', groupId: null, isLeader: false })
    expect(snap.myGroup).toBeNull()
  })

  it('組員離線時 online 為 false；組長換人後 isLeader 跟著改變', () => {
    const { act, a, a2 } = setup()
    memberDisconnected(act, a)
    const snap = studentSnapshot(act, a2)
    expect(snap.me.isLeader).toBe(true)
    expect(snap.myGroup.members).toEqual([
      { clientId: a, nickname: '小明', online: false, isLeader: false },
      { clientId: a2, nickname: '小強', online: true, isLeader: true },
    ])
  })

  it('沒有進行中的題目時，drafts 為空、submitted 為 false', () => {
    const { act, a } = setup()
    submitAnswer(act, a, 'q1', { round: 1, answers: two('x', 'y') })
    closeQuestion(act, 'q1')
    const snap = studentSnapshot(act, a)
    expect(snap.currentQuestionId).toBeNull()
    expect(snap.myGroup.drafts).toEqual([])
    expect(snap.myGroup.submitted).toBe(false)
  })

  it('修改快照不影響活動狀態', () => {
    const { act, a } = setup()
    updateDraft(act, a, { questionId: 'q1', round: 1, blankId: 'q1b1', text: '草稿' })
    const snap = studentSnapshot(act, a)
    snap.activity.groups[0].name = '改掉'
    snap.myGroup.drafts[0].text = '改掉'
    snap.myGroup.drafts[0].by.nickname = '改掉'
    expect(act.groups[0].name).toBe('第 1 組')
    expect(act.drafts.get('q1|1|g1|q1b1')).toMatchObject({ text: '草稿', by: { nickname: '小明' } })
  })
})

describe('老師快照', () => {
  it('包含各組成員、目前題目的作答狀態與提交、各題的 cellRef，以及試算表資訊', () => {
    const { act, a, a2, b, c } = setup()
    updateDraft(act, b, { questionId: 'q1', round: 1, blankId: 'q1b1', text: '草稿' })
    const { submittedAt } = submitAnswer(act, a, 'q1', { round: 1, answers: two('CPU', 'OS') })
    const snap = teacherSnapshot(act)
    expect(Object.keys(snap)).toEqual([
      'version',
      'activity',
      'questions',
      'currentQuestionId',
      'groupLocked',
      'groups',
      'results',
      'sheet',
    ])
    expect(snap.version).toBe(act.version)
    expect(snap.questions[0].blanks).toEqual([
      { id: 'q1b1', label: '（1）', cellRef: '學習單!H5' },
      { id: 'q1b2', label: '（2）', cellRef: '學習單!H6' },
    ])
    expect(snap.questions[3].blanks).toEqual([{ id: 'q4b1', label: null, cellRef: '學習單!G13' }])
    expect(snap.groups).toEqual([
      {
        group: { id: 'g1', name: '第 1 組' },
        members: [
          { clientId: a, nickname: '小明', online: true, isLeader: true },
          { clientId: a2, nickname: '小強', online: true, isLeader: false },
        ],
        current: {
          status: 'submitted',
          submission: { groupId: 'g1', answers: two('CPU', 'OS'), rank: 1, submittedAt },
        },
      },
      {
        group: { id: 'g2', name: '第 2 組' },
        members: [{ clientId: b, nickname: '小華', online: true, isLeader: true }],
        current: { status: 'editing', submission: null },
      },
      {
        group: { id: 'g3', name: '第 3 組' },
        members: [{ clientId: c, nickname: '小美', online: true, isLeader: true }],
        current: { status: 'idle', submission: null },
      },
    ])
    expect(snap.results).toEqual([])
    expect(snap.sheet).toEqual({
      spreadsheetTitle: '資訊概論學習單',
      worksheetTitle: '學習單',
      url: 'https://docs.google.com/spreadsheets/d/sheet-id-123#gid=42',
      lastExportedAt: null,
    })
  })

  it('老師快照只顯示「編輯中」，不含草稿內容', () => {
    const { act, b } = setup()
    updateDraft(act, b, { questionId: 'q1', round: 1, blankId: 'q1b1', text: '秘密草稿' })
    expect(JSON.stringify(teacherSnapshot(act))).not.toContain('秘密草稿')
  })

  it('沒有進行中的題目時 current 為 null', () => {
    const { act } = setup()
    closeQuestion(act, 'q1')
    for (const g of teacherSnapshot(act).groups) expect(g.current).toBeNull()
  })

  it('老師快照沒有 row、col 或寫回目標等內部欄位', () => {
    const { act, a } = setup()
    submitAnswer(act, a, 'q1', { round: 1, answers: two('x', 'y') })
    closeQuestion(act, 'q1')
    const keys = allKeys(teacherSnapshot(act))
    for (const k of ['row', 'col', 'target', 'spreadsheetId', 'sheetId', 'exporting', 'onCommit', 'sockets', 'groupJoinedSeq', 'resultsVersion']) {
      expect(keys.has(k)).toBe(false)
    }
  })

  it('修改快照不影響活動狀態', () => {
    const { act } = setup()
    const snap = teacherSnapshot(act)
    snap.sheet.url = '改掉'
    snap.groups[0].group.name = '改掉'
    snap.questions[0].blanks[0].cellRef = '改掉'
    expect(act.sheet.url).toContain('docs.google.com')
    expect(act.groups[0].name).toBe('第 1 組')
    expect(act.questions[0].blanks[0].cellRef).toBe('學習單!H5')
  })
})

describe('results', () => {
  it('只包含已結束的題目，依題目順序，提交依順位排序', () => {
    const { act, a, b, c } = setup()
    submitAnswer(act, c, 'q1', { round: 1, answers: two('丙', '丙') })
    submitAnswer(act, a, 'q1', { round: 1, answers: two('甲', '甲') })
    closeQuestion(act, 'q1')
    openQuestion(act, 'q3')
    submitAnswer(act, b, 'q3', { round: 1, answers: [{ blankId: 'q3b1', text: '乙' }] })
    closeQuestion(act, 'q3')
    openQuestion(act, 'q2')
    const r = results(act)
    expect(r.map((x) => x.questionId)).toEqual(['q1', 'q3'])
    expect(r[0].submissions.map((s) => s.groupId)).toEqual(['g3', 'g1'])
    expect(r[0].winnerGroupId).toBe('g3')
    expect(r[1].winnerGroupId).toBe('g2')
  })

  it('重開的題目不在 results 中，再次結束後顯示新一輪的結果', () => {
    const { act, a, b } = setup()
    submitAnswer(act, a, 'q1', { round: 1, answers: two('舊', '舊') })
    closeQuestion(act, 'q1')
    reopenQuestion(act, 'q1')
    expect(results(act)).toEqual([])
    submitAnswer(act, b, 'q1', { round: 2, answers: two('新', '新') })
    closeQuestion(act, 'q1')
    expect(results(act)).toEqual([
      {
        questionId: 'q1',
        round: 2,
        submissions: [{ groupId: 'g2', answers: two('新', '新'), rank: 1, submittedAt: expect.any(String) }],
        winnerGroupId: 'g2',
      },
    ])
  })
})
