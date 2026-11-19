// 活動規則的單元測試（change build-quiz-backend，tasks 3.1 到 3.3）。
// 測試名稱對應 spec `quiz-backend` 的 Scenario。

import crypto from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppError } from './errors.js'
import { CODE_ALPHABET, createStore, randomId } from './store.js'
import {
  chooseGroup,
  closeQuestion,
  commit,
  createActivity,
  exportPlan,
  joinActivity,
  leaderOf,
  markExported,
  memberConnected,
  memberDisconnected,
  openQuestion,
  reopenQuestion,
  requireMember,
  submitAnswer,
  updateDraft,
} from './activity.js'
import { results, teacherSnapshot } from './snapshots.js'

// ---------- 測試用資料 ----------

const blank = (label, row, col, cellRef) => ({ label, row, col, cellRef })

/** 題組 2 題（各 2 個子填空）加上 singleCount 題單題 */
function makeImport(singleCount = 2) {
  return {
    spreadsheetId: 'sheet-id-123',
    sheetId: 42,
    spreadsheetTitle: '資訊概論學習單',
    worksheetTitle: '學習單',
    sheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-id-123#gid=42',
    questions: [
      { number: 1, blanks: [blank('（1）', 4, 7, '學習單!H5'), blank('（2）', 5, 7, '學習單!H6')] },
      { number: 2, blanks: [blank('（1）', 7, 7, '學習單!H8'), blank('（2）', 8, 7, '學習單!H9')] },
      ...Array.from({ length: singleCount }, (_, i) => ({
        number: 3 + i,
        blanks: [blank(null, 10 + i * 2, 6, `學習單!G${11 + i * 2}`)],
      })),
    ],
  }
}

function setup({ groupCount = 3, singleCount = 2 } = {}) {
  const store = createStore()
  const act = createActivity(store, makeImport(singleCount), groupCount)
  act.onCommit = vi.fn()
  /** 加入並選組；預設建立一條連線（在線） */
  const join = (nickname, groupId, { online = true } = {}) => {
    const { clientId } = joinActivity(act, null, nickname)
    if (groupId) chooseGroup(act, clientId, groupId)
    if (online) memberConnected(act, clientId)
    return clientId
  }
  const nameOfLeader = (gid) => act.members.get(leaderOf(act, gid))?.nickname ?? null
  return { store, act, join, nameOfLeader }
}

/** 執行 fn，確認 version 恰好加 1，且 onCommit 被呼叫一次 */
function expectOneCommit(act, fn) {
  const version = act.version
  const calls = act.onCommit.mock.calls.length
  const out = fn()
  expect(act.version).toBe(version + 1)
  expect(act.onCommit).toHaveBeenCalledTimes(calls + 1)
  expect(act.onCommit).toHaveBeenLastCalledWith(act)
  return out
}

/** 執行 fn，確認 version 不變，也沒有呼叫 onCommit */
function expectNoCommit(act, fn) {
  const version = act.version
  const calls = act.onCommit.mock.calls.length
  const out = fn()
  expect(act.version).toBe(version)
  expect(act.onCommit).toHaveBeenCalledTimes(calls)
  return out
}

/** 執行 fn，確認丟出指定的 AppError，且沒有 commit */
function expectError(act, fn, status, code) {
  let err
  expectNoCommit(act, () => {
    try {
      fn()
    } catch (e) {
      err = e
    }
  })
  expect(err).toBeInstanceOf(AppError)
  expect(err.code).toBe(code)
  if (status !== undefined) expect(err.status).toBe(status)
  return err
}

const two = (a, b) => [
  { blankId: 'q1b1', text: a },
  { blankId: 'q1b2', text: b },
]

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------- store ----------

describe('store', () => {
  it('活動代號為 6 個字元，只用不易混淆的字元集', () => {
    const store = createStore()
    for (let i = 0; i < 50; i++) {
      const code = store.newCode()
      expect(code).toHaveLength(6)
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch)
    }
    expect(CODE_ALPHABET).not.toMatch(/[0O1I]/)
  })

  it('活動代號與現有活動重複時重新產生', () => {
    const store = createStore()
    store.activities.set('AAAAAA', {})
    let n = 0
    vi.spyOn(crypto, 'randomInt').mockImplementation(() => (n++ < 6 ? 0 : 1))
    expect(store.newCode()).toBe('BBBBBB')
  })

  it('randomId 預設產生 24 個十六進位字元', () => {
    expect(randomId()).toMatch(/^[a-f0-9]{24}$/)
    expect(randomId(32)).toMatch(/^[a-f0-9]{64}$/)
    expect(randomId()).not.toBe(randomId())
  })

  it('store 有 sessions、imports、activities', () => {
    const store = createStore()
    expect(store.sessions).toBeInstanceOf(Set)
    expect(store.imports).toBeInstanceOf(Map)
    expect(store.activities).toBeInstanceOf(Map)
  })
})

// ---------- 建立活動 ----------

describe('建立活動', () => {
  it('建立成功：6 題全部未開始、round 為 1，4 組依序命名，有試算表資訊', () => {
    const store = createStore()
    const act = createActivity(store, makeImport(4), 4)
    expect(store.activities.get(act.code)).toBe(act)
    expect(act.code).toMatch(/^[A-Z2-9]{6}$/)
    expect(act.groups).toEqual([
      { id: 'g1', name: '第 1 組' },
      { id: 'g2', name: '第 2 組' },
      { id: 'g3', name: '第 3 組' },
      { id: 'g4', name: '第 4 組' },
    ])
    expect(act.questions).toHaveLength(6)
    for (const q of act.questions) expect(q).toMatchObject({ status: 'idle', round: 1 })
    expect(act.questions.map((q) => q.id)).toEqual(['q1', 'q2', 'q3', 'q4', 'q5', 'q6'])
    expect(act.questions.map((q) => q.number)).toEqual([1, 2, 3, 4, 5, 6])
    expect(act.questions[0].blanks).toEqual([
      { id: 'q1b1', label: '（1）', row: 4, col: 7, cellRef: '學習單!H5' },
      { id: 'q1b2', label: '（2）', row: 5, col: 7, cellRef: '學習單!H6' },
    ])
    expect(act.questions[2].blanks).toEqual([
      { id: 'q3b1', label: null, row: 10, col: 6, cellRef: '學習單!G11' },
    ])
    expect(act.sheet).toEqual({
      spreadsheetTitle: '資訊概論學習單',
      worksheetTitle: '學習單',
      url: 'https://docs.google.com/spreadsheets/d/sheet-id-123#gid=42',
      lastExportedAt: null,
    })
    expect(act.target).toEqual({ spreadsheetId: 'sheet-id-123', sheetId: 42 })
    expect(act).toMatchObject({
      currentQuestionId: null,
      groupLocked: false,
      version: 1,
      leaders: {},
      seq: 0,
      resultsVersion: 0,
      exporting: false,
      onCommit: null,
    })
    expect(act.members.size).toBe(0)
    expect(act.submissions.size).toBe(0)
    expect(act.drafts.size).toBe(0)
  })

  it('組數不合法：1、21、2.5 或非數字時回應 400 INVALID_GROUP_COUNT，沒有建立活動', () => {
    const store = createStore()
    for (const n of [1, 21, 2.5, '4', null, undefined, NaN]) {
      let err
      try {
        createActivity(store, makeImport(), n)
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(AppError)
      expect(err).toMatchObject({ status: 400, code: 'INVALID_GROUP_COUNT' })
    }
    expect(store.activities.size).toBe(0)
  })

  it('組數 2 與 20 都可以建立', () => {
    const store = createStore()
    expect(createActivity(store, makeImport(), 2).groups).toHaveLength(2)
    expect(createActivity(store, makeImport(), 20).groups.at(-1)).toEqual({ id: 'g20', name: '第 20 組' })
    expect(store.activities.size).toBe(2)
  })

  it('活動複製匯入結果，之後修改匯入結果不影響活動', () => {
    const store = createStore()
    const imp = makeImport()
    const act = createActivity(store, imp, 3)
    imp.questions[0].blanks[0].cellRef = '學習單!Z99'
    imp.questions.push({ number: 9, blanks: [] })
    expect(act.questions[0].blanks[0].cellRef).toBe('學習單!H5')
    expect(act.questions).toHaveLength(4)
  })
})

// ---------- 學生加入 ----------

describe('學生加入與身分', () => {
  it('第一次加入：產生 24 個十六進位字元的 clientId，組別為 null', () => {
    const { act } = setup()
    const { clientId, isNew } = expectOneCommit(act, () => joinActivity(act, undefined, '  小明  '))
    expect(isNew).toBe(true)
    expect(clientId).toMatch(/^[a-f0-9]{24}$/)
    expect(act.members.get(clientId)).toEqual({
      clientId,
      nickname: '小明',
      groupId: null,
      groupJoinedSeq: 0,
      sockets: 0,
    })
  })

  it('重新整理後恢復：同一個 clientId 再次加入時保留組別，只更新暱稱', () => {
    const { act, join } = setup()
    const id = join('小明', 'g2')
    const res = expectOneCommit(act, () => joinActivity(act, id, '小明明'))
    expect(res).toEqual({ clientId: id, isNew: false })
    expect(act.members.get(id)).toMatchObject({ nickname: '小明明', groupId: 'g2', sockets: 1 })
    expect(act.members.size).toBe(1)
  })

  it('clientId 格式不對時產生新的', () => {
    const { act } = setup()
    for (const bad of ['abc', 'Z'.repeat(24), 'A'.repeat(24), 123]) {
      const { clientId, isNew } = joinActivity(act, bad, '小明')
      expect(isNew).toBe(true)
      expect(clientId).toMatch(/^[a-f0-9]{24}$/)
      expect(clientId).not.toBe(bad)
    }
  })

  it('格式正確但還不是成員的 clientId 直接沿用，不需要發新 Cookie', () => {
    const { act } = setup()
    const id = 'a'.repeat(24)
    expect(joinActivity(act, id, '小明')).toEqual({ clientId: id, isNew: false })
    expect(act.members.has(id)).toBe(true)
  })

  it('暱稱不合法：只有空白、超過 20 個字或不是字串時回應 400 INVALID_NICKNAME', () => {
    const { act } = setup()
    for (const bad of ['', '   ', '\n\t', '字'.repeat(21), null, 123]) {
      expectError(act, () => joinActivity(act, null, bad), 400, 'INVALID_NICKNAME')
    }
    expect(act.members.size).toBe(0)
  })

  it('暱稱以字數計算：20 個表情符號可以加入', () => {
    const { act } = setup()
    const { clientId } = joinActivity(act, null, '😀'.repeat(20))
    expect(act.members.get(clientId).nickname).toBe('😀'.repeat(20))
  })

  it('沒有加入就取得成員：回應 401 NOT_JOINED', () => {
    const { act, join } = setup()
    const id = join('小明')
    expect(requireMember(act, id).nickname).toBe('小明')
    for (const bad of [undefined, 'b'.repeat(24)]) {
      expectError(act, () => requireMember(act, bad), 401, 'NOT_JOINED')
    }
  })
})

// ---------- 選組與組別鎖定 ----------

describe('選組與組別鎖定', () => {
  it('開始前換組：第 2 組的學生改選第 3 組', () => {
    const { act, join } = setup()
    const id = join('小明', 'g2')
    const seq = act.members.get(id).groupJoinedSeq
    const m = expectOneCommit(act, () => chooseGroup(act, id, 'g3'))
    expect(m.groupId).toBe('g3')
    expect(m.groupJoinedSeq).toBe(seq + 1)
    expect(act.seq).toBe(seq + 1)
  })

  it('開始後換組：已有組別的學生換組時回應 409 GROUP_LOCKED，組別不變', () => {
    const { act, join } = setup()
    const id = join('小明', 'g2')
    openQuestion(act, 'q1')
    expect(act.groupLocked).toBe(true)
    expectError(act, () => chooseGroup(act, id, 'g3'), 409, 'GROUP_LOCKED')
    expect(act.members.get(id).groupId).toBe('g2')
  })

  it('開始後才加入：還沒有組別的學生可以選一次，之後換組回應 GROUP_LOCKED', () => {
    const { act, join } = setup()
    openQuestion(act, 'q1')
    const id = join('小華')
    expectOneCommit(act, () => chooseGroup(act, id, 'g1'))
    expect(act.members.get(id).groupId).toBe('g1')
    expectError(act, () => chooseGroup(act, id, 'g2'), 409, 'GROUP_LOCKED')
    expect(act.members.get(id).groupId).toBe('g1')
  })

  it('組別鎖定後重選同一組不算換組', () => {
    const { act, join } = setup()
    const id = join('小明', 'g1')
    openQuestion(act, 'q1')
    expectNoCommit(act, () => chooseGroup(act, id, 'g1'))
  })

  it('組別沒變時不 commit', () => {
    const { act, join } = setup()
    const id = join('小明', 'g1')
    const seq = act.seq
    expectNoCommit(act, () => chooseGroup(act, id, 'g1'))
    expect(act.seq).toBe(seq)
  })

  it('組別不存在：回應 400 INVALID_GROUP', () => {
    const { act, join } = setup()
    const id = join('小明')
    for (const bad of ['g4', 'g0', '', null, undefined]) {
      expectError(act, () => chooseGroup(act, id, bad), 400, 'INVALID_GROUP')
    }
    expect(act.members.get(id).groupId).toBeNull()
  })

  it('不是成員時回應 401 NOT_JOINED', () => {
    const { act } = setup()
    expectError(act, () => chooseGroup(act, 'c'.repeat(24), 'g1'), 401, 'NOT_JOINED')
  })
})

// ---------- 題目狀態與輪次 ----------

describe('題目狀態與輪次', () => {
  it('開始與結束：開始後進行中、currentQuestionId 為該題；結束後已結束、currentQuestionId 為 null', () => {
    const { act } = setup()
    expectOneCommit(act, () => openQuestion(act, 'q1'))
    expect(act.questions[0].status).toBe('open')
    expect(act.currentQuestionId).toBe('q1')
    expect(act.groupLocked).toBe(true)
    expect(act.resultsVersion).toBe(0)

    expectOneCommit(act, () => closeQuestion(act, 'q1'))
    expect(act.questions[0].status).toBe('closed')
    expect(act.currentQuestionId).toBeNull()
    expect(act.groupLocked).toBe(true)
    expect(act.resultsVersion).toBe(act.version)
  })

  it('已有題目進行中：開始第 2 題或重開第 3 題回應 409 ANOTHER_QUESTION_OPEN，狀態不變', () => {
    const { act } = setup()
    openQuestion(act, 'q3')
    closeQuestion(act, 'q3')
    openQuestion(act, 'q1')
    const rv = act.resultsVersion
    expectError(act, () => openQuestion(act, 'q2'), 409, 'ANOTHER_QUESTION_OPEN')
    expectError(act, () => reopenQuestion(act, 'q3'), 409, 'ANOTHER_QUESTION_OPEN')
    expect(act.questions.map((q) => q.status)).toEqual(['open', 'idle', 'closed', 'idle'])
    expect(act.questions[2].round).toBe(1)
    expect(act.currentQuestionId).toBe('q1')
    expect(act.resultsVersion).toBe(rv)
  })

  it('狀態不符：結束未開始的題目、重開進行中的題目回應 409 INVALID_STATE', () => {
    const { act } = setup()
    expectError(act, () => closeQuestion(act, 'q1'), 409, 'INVALID_STATE')
    expectError(act, () => reopenQuestion(act, 'q1'), 409, 'INVALID_STATE')
    openQuestion(act, 'q1')
    expectError(act, () => reopenQuestion(act, 'q1'), 409, 'INVALID_STATE')
    expectError(act, () => openQuestion(act, 'q1'), 409, 'INVALID_STATE')
    closeQuestion(act, 'q1')
    expectError(act, () => closeQuestion(act, 'q1'), 409, 'INVALID_STATE')
    expectError(act, () => openQuestion(act, 'q1'), 409, 'INVALID_STATE')
    expect(act.questions[0]).toMatchObject({ status: 'closed', round: 1 })
  })

  it('題目不存在：開始、結束、重開都回應 404 QUESTION_NOT_FOUND', () => {
    const { act } = setup()
    expectError(act, () => openQuestion(act, 'q9'), 404, 'QUESTION_NOT_FOUND')
    expectError(act, () => closeQuestion(act, 'q9'), 404, 'QUESTION_NOT_FOUND')
    expectError(act, () => reopenQuestion(act, 'q9'), 404, 'QUESTION_NOT_FOUND')
  })

  it('重開：round 加 1，該題的提交與草稿被清除，results 不再包含該題', () => {
    const { act, join } = setup()
    const a = join('小明', 'g1')
    const b = join('小華', 'g2')
    const c = join('小美', 'g3')
    // 第 2 題留下一筆草稿，確認重開第 1 題時不受影響
    openQuestion(act, 'q2')
    updateDraft(act, a, { questionId: 'q2', round: 1, blankId: 'q2b1', text: '第 2 題' })
    closeQuestion(act, 'q2')

    openQuestion(act, 'q1')
    submitAnswer(act, a, 'q1', { round: 1, answers: two('a', 'b') })
    submitAnswer(act, b, 'q1', { round: 1, answers: two('c', 'd') })
    updateDraft(act, c, { questionId: 'q1', round: 1, blankId: 'q1b1', text: '草稿' })
    closeQuestion(act, 'q1')
    expect(results(act).map((r) => r.questionId)).toEqual(['q1', 'q2'])

    expectOneCommit(act, () => reopenQuestion(act, 'q1'))
    expect(act.questions[0]).toMatchObject({ status: 'open', round: 2 })
    expect(act.currentQuestionId).toBe('q1')
    expect(act.submissions.has('q1')).toBe(false)
    expect([...act.drafts.keys()].filter((k) => k.startsWith('q1|'))).toEqual([])
    expect([...act.drafts.keys()].filter((k) => k.startsWith('q2|'))).toHaveLength(1)
    expect(results(act).map((r) => r.questionId)).toEqual(['q2'])
    expect(act.resultsVersion).toBe(act.version)

    // 再結束與重開時 round 持續累加
    closeQuestion(act, 'q1')
    reopenQuestion(act, 'q1')
    expect(act.questions[0].round).toBe(3)
  })

  it('resultsVersion 只在題目結束或重開時更新', () => {
    const { act, join } = setup()
    const a = join('小明', 'g1')
    openQuestion(act, 'q1')
    submitAnswer(act, a, 'q1', { round: 1, answers: two('a', 'b') })
    expect(act.resultsVersion).toBe(0)
    closeQuestion(act, 'q1')
    const rv = act.resultsVersion
    expect(rv).toBe(act.version)
    join('小華', 'g2')
    memberDisconnected(act, a)
    markExported(act, '2026-11-19T00:00:00.000Z')
    expect(act.resultsVersion).toBe(rv)
    expect(act.version).toBeGreaterThan(rv)
  })
})

// ---------- commit 與 version ----------

describe('commit 與版本', () => {
  it('commit 依序重新判定組長、version 加 1、呼叫 onCommit', () => {
    const { act } = setup()
    const seen = []
    act.onCommit = vi.fn((a) => seen.push({ version: a.version, leader: a.leaders.g1 }))
    const { clientId } = joinActivity(act, null, '小明')
    chooseGroup(act, clientId, 'g1')
    memberConnected(act, clientId)
    expect(seen.at(-1)).toEqual({ version: act.version, leader: clientId })
    act.members.get(clientId).sockets = 0
    commit(act)
    expect(seen.at(-1)).toEqual({ version: act.version, leader: null })
  })

  it('沒有設定 onCommit 時 commit 仍然遞增 version', () => {
    const store = createStore()
    const act = createActivity(store, makeImport(), 2)
    commit(act)
    expect(act.version).toBe(2)
  })

  it('每次狀態改變 version 恰好加 1，並呼叫一次 onCommit', () => {
    const { act } = setup()
    const a = expectOneCommit(act, () => joinActivity(act, null, '小明')).clientId
    const b = expectOneCommit(act, () => joinActivity(act, null, '小華')).clientId
    expectOneCommit(act, () => chooseGroup(act, a, 'g1'))
    expectOneCommit(act, () => chooseGroup(act, b, 'g2'))
    expectOneCommit(act, () => memberConnected(act, a))
    expectOneCommit(act, () => memberConnected(act, b))
    expectOneCommit(act, () => openQuestion(act, 'q1'))
    expectOneCommit(act, () =>
      updateDraft(act, a, { questionId: 'q1', round: 1, blankId: 'q1b1', text: 'x' }),
    )
    expectOneCommit(act, () => submitAnswer(act, a, 'q1', { round: 1, answers: two('a', 'b') }))
    expectOneCommit(act, () => submitAnswer(act, b, 'q1', { round: 1, answers: two('c', 'd') }))
    expectOneCommit(act, () => closeQuestion(act, 'q1'))
    expectOneCommit(act, () => reopenQuestion(act, 'q1'))
    expectOneCommit(act, () => closeQuestion(act, 'q1'))
    expectOneCommit(act, () => markExported(act, '2026-11-19T01:02:03.000Z'))
    expectOneCommit(act, () => memberDisconnected(act, b))
    expect(act.version).toBe(16)
    expect(act.onCommit).toHaveBeenCalledTimes(15)
  })
})

// ---------- 依在線狀態遞補組長 ----------

describe('依在線狀態遞補組長', () => {
  it('組長離線後立即遞補：由在線且加入本組最早的成員接任', () => {
    const { act, join, nameOfLeader } = setup()
    const a = join('小明', 'g1')
    const b = join('小華', 'g1')
    join('小美', 'g1')
    expect(nameOfLeader('g1')).toBe('小明')
    memberDisconnected(act, b)
    expect(nameOfLeader('g1')).toBe('小明')

    const leadersAtCommit = []
    act.onCommit = vi.fn((x) => leadersAtCommit.push(x.leaders.g1))
    expectOneCommit(act, () => memberDisconnected(act, a))
    expect(nameOfLeader('g1')).toBe('小美')
    // 推送快照時組長已經換人
    expect(act.members.get(leadersAtCommit[0]).nickname).toBe('小美')
  })

  it('原組長回來不會拿回組長', () => {
    const { act, join, nameOfLeader } = setup()
    const a = join('小明', 'g1')
    join('小華', 'g1')
    memberDisconnected(act, a)
    expect(nameOfLeader('g1')).toBe('小華')
    expectOneCommit(act, () => memberConnected(act, a))
    expect(nameOfLeader('g1')).toBe('小華')
  })

  it('全組離線後第一位上線者接任，較早加入的人之後上線也不搶回', () => {
    const { act, join, nameOfLeader } = setup()
    const a = join('小明', 'g1')
    const b = join('小華', 'g1')
    memberDisconnected(act, a)
    memberDisconnected(act, b)
    expect(leaderOf(act, 'g1')).toBeNull()
    memberConnected(act, b)
    expect(nameOfLeader('g1')).toBe('小華')
    memberConnected(act, a)
    expect(nameOfLeader('g1')).toBe('小華')
  })

  it('同一人開多個分頁：關掉其中一個仍在線，組長不變', () => {
    const { act, join, nameOfLeader } = setup()
    const a = join('小明', 'g1')
    join('小華', 'g1')
    expectNoCommit(act, () => memberConnected(act, a))
    expect(act.members.get(a).sockets).toBe(2)
    expectNoCommit(act, () => memberDisconnected(act, a))
    expect(act.members.get(a).sockets).toBe(1)
    expect(nameOfLeader('g1')).toBe('小明')
    expectOneCommit(act, () => memberDisconnected(act, a))
    expect(nameOfLeader('g1')).toBe('小華')
  })

  it('組長在開始前換組：原組由在線的組員接任，換組者成為沒有組長的新組的組長', () => {
    const { act, join, nameOfLeader } = setup()
    const a = join('小明', 'g1')
    join('小華', 'g1')
    expect(leaderOf(act, 'g2')).toBeNull()
    expectOneCommit(act, () => chooseGroup(act, a, 'g2'))
    expect(nameOfLeader('g1')).toBe('小華')
    expect(nameOfLeader('g2')).toBe('小明')
  })

  it('換到已有組長的組時不會搶走組長', () => {
    const { act, join, nameOfLeader } = setup()
    const a = join('小明', 'g1')
    join('小華', 'g2')
    chooseGroup(act, a, 'g2')
    expect(nameOfLeader('g2')).toBe('小華')
    expect(leaderOf(act, 'g1')).toBeNull()
  })

  it('只透過 REST 加入的學生：還沒有連線時不是組長，第一次連線後才成為組長', () => {
    const { act, join, nameOfLeader } = setup()
    const a = join('小明', 'g1', { online: false })
    expect(leaderOf(act, 'g1')).toBeNull()
    expectOneCommit(act, () => memberConnected(act, a))
    expect(nameOfLeader('g1')).toBe('小明')
  })

  it('沒有連線時的中斷、不存在的成員都不改變狀態', () => {
    const { act, join } = setup()
    const a = join('小明', 'g1', { online: false })
    expectNoCommit(act, () => memberDisconnected(act, a))
    expect(act.members.get(a).sockets).toBe(0)
    expectNoCommit(act, () => memberConnected(act, 'd'.repeat(24)))
    expectNoCommit(act, () => memberDisconnected(act, 'd'.repeat(24)))
  })
})

// ---------- 送出答案的驗證 ----------

describe('送出答案的驗證', () => {
  function ready() {
    const s = setup()
    const a = s.join('小明', 'g1')
    const a2 = s.join('小強', 'g1')
    const b = s.join('小華', 'g2')
    const c = s.join('小美', 'g3')
    openQuestion(s.act, 'q1') // q1 是題組，有 2 個子填空

    return { ...s, a, a2, b, c }
  }

  it('成功送出：回應只有 submittedAt，保存 trim 之後的答案', () => {
    const { act, a } = ready()
    const res = expectOneCommit(act, () =>
      submitAnswer(act, a, 'q1', { round: 1, answers: two(' 　CPU\n', '​作業系統 ') }),
    )
    expect(Object.keys(res)).toEqual(['submittedAt'])
    expect(new Date(res.submittedAt).toISOString()).toBe(res.submittedAt)
    expect(act.submissions.get('q1')).toEqual([
      {
        groupId: 'g1',
        answers: [
          { blankId: 'q1b1', text: 'CPU' },
          { blankId: 'q1b2', text: '作業系統' },
        ],
        rank: 1,
        submittedAt: res.submittedAt,
      },
    ])
  })

  it('答案順序與子填空順序不同時，依 blankId 對應並依子填空順序保存', () => {
    const { act, a } = ready()
    submitAnswer(act, a, 'q1', {
      round: 1,
      answers: [
        { blankId: 'q1b2', text: '二' },
        { blankId: 'q1b1', text: '一' },
      ],
    })
    expect(act.submissions.get('q1')[0].answers).toEqual([
      { blankId: 'q1b1', text: '一' },
      { blankId: 'q1b2', text: '二' },
    ])
  })

  it('只有特殊空白：半形空白、換行、全形空白或零寬字元回應 400 BLANK_ANSWER，沒有保存提交', () => {
    const { act, a } = ready()
    for (const blankText of [' ', '\n', '\r\n\t', '　', '​', '‌', '‍', '﻿', ' 　​\n﻿', '']) {
      expectError(
        act,
        () => submitAnswer(act, a, 'q1', { round: 1, answers: two('CPU', blankText) }),
        400,
        'BLANK_ANSWER',
      )
    }
    expect(act.submissions.has('q1')).toBe(false)
  })

  it('超過 500 字：trim 後 501 個字回應 400 ANSWER_TOO_LONG', () => {
    const { act, a } = ready()
    expectError(
      act,
      () => submitAnswer(act, a, 'q1', { round: 1, answers: two('字'.repeat(501), 'b') }),
      400,
      'ANSWER_TOO_LONG',
    )
    expect(act.submissions.has('q1')).toBe(false)
  })

  it('剛好 500 字（以字數計算，前後空白不算）可以送出', () => {
    const { act, a } = ready()
    submitAnswer(act, a, 'q1', { round: 1, answers: two(`  ${'字'.repeat(500)}  `, '😀'.repeat(500)) })
    expect(act.submissions.get('q1')[0].answers[0].text).toBe('字'.repeat(500))
  })

  it('子填空數量不符：題組有兩個子填空，請求只帶一個答案時回應 400 BLANKS_MISMATCH', () => {
    const { act, a } = ready()
    const bad = [
      [{ blankId: 'q1b1', text: 'a' }],
      [...two('a', 'b'), { blankId: 'q1b3', text: 'c' }],
      [
        { blankId: 'q1b1', text: 'a' },
        { blankId: 'q1b1', text: 'b' },
      ],
      [
        { blankId: 'q1b1', text: 'a' },
        { blankId: 'q2b1', text: 'b' },
      ],
      [{ blankId: 'q1b1', text: 'a' }, { blankId: 'q1b2', text: 5 }],
      [{ blankId: 'q1b1', text: 'a' }, null],
      'a',
      undefined,
    ]
    for (const answers of bad) {
      expectError(act, () => submitAnswer(act, a, 'q1', { round: 1, answers }), 400, 'BLANKS_MISMATCH')
    }
    expect(act.submissions.has('q1')).toBe(false)
  })

  it('重開前的舊請求：第 1 題已重開為第 2 輪，送出 round 1 回應 409 STALE_ROUND', () => {
    const { act, a } = ready()
    closeQuestion(act, 'q1')
    reopenQuestion(act, 'q1')
    expectError(act, () => submitAnswer(act, a, 'q1', { round: 1, answers: two('a', 'b') }), 409, 'STALE_ROUND')
    expectError(act, () => submitAnswer(act, a, 'q1', { round: '2', answers: two('a', 'b') }), 409, 'STALE_ROUND')
    submitAnswer(act, a, 'q1', { round: 2, answers: two('a', 'b') })
    expect(act.submissions.get('q1')).toHaveLength(1)
  })

  it('重複送出：同一輪已送出後再次送出回應 409 ALREADY_SUBMITTED，原本的提交不變', () => {
    const { act, a } = ready()
    submitAnswer(act, a, 'q1', { round: 1, answers: two('a', 'b') })
    const before = structuredClone(act.submissions.get('q1'))
    expectError(act, () => submitAnswer(act, a, 'q1', { round: 1, answers: two('x', 'y') }), 409, 'ALREADY_SUBMITTED')
    expect(act.submissions.get('q1')).toEqual(before)
  })

  it('組員（不是組長）送出：回應 403 NOT_LEADER', () => {
    const { act, a2, join } = ready()
    expectError(act, () => submitAnswer(act, a2, 'q1', { round: 1, answers: two('a', 'b') }), 403, 'NOT_LEADER')
    const noGroup = join('路人')
    expectError(act, () => submitAnswer(act, noGroup, 'q1', { round: 1, answers: two('a', 'b') }), 403, 'NOT_LEADER')
  })

  it('組長剛離線、由組員接任後，原組長的請求回應 NOT_LEADER，新組長可以送出', () => {
    const { act, a, a2 } = ready()
    memberDisconnected(act, a)
    expectError(act, () => submitAnswer(act, a, 'q1', { round: 1, answers: two('a', 'b') }), 403, 'NOT_LEADER')
    submitAnswer(act, a2, 'q1', { round: 1, answers: two('a', 'b') })
    expect(act.submissions.get('q1')[0].groupId).toBe('g1')
  })

  it('題目不在進行中：未開始、已結束或不存在的題目回應 409 QUESTION_NOT_OPEN', () => {
    const { act, a } = ready()
    expectError(act, () => submitAnswer(act, a, 'q2', { round: 1, answers: two('a', 'b') }), 409, 'QUESTION_NOT_OPEN')
    expectError(act, () => submitAnswer(act, a, 'q9', { round: 1, answers: two('a', 'b') }), 409, 'QUESTION_NOT_OPEN')
    closeQuestion(act, 'q1')
    expectError(act, () => submitAnswer(act, a, 'q1', { round: 1, answers: two('a', 'b') }), 409, 'QUESTION_NOT_OPEN')
  })

  it('不是成員：回應 401 NOT_JOINED', () => {
    const { act } = ready()
    expectError(act, () => submitAnswer(act, 'e'.repeat(24), 'q1', { round: 1, answers: two('a', 'b') }), 401, 'NOT_JOINED')
  })

  it('檢查順序：同時有多個問題時回應最先檢查到的錯誤', () => {
    const { act, a, a2 } = ready()
    // 題目不在進行中 先於 輪次
    expectError(act, () => submitAnswer(act, a2, 'q2', { round: 9, answers: [] }), 409, 'QUESTION_NOT_OPEN')
    // 輪次 先於 組長
    expectError(act, () => submitAnswer(act, a2, 'q1', { round: 9, answers: [] }), 409, 'STALE_ROUND')
    // 組長 先於 格數
    expectError(act, () => submitAnswer(act, a2, 'q1', { round: 1, answers: [] }), 403, 'NOT_LEADER')
    // 格數 先於 空白
    expectError(act, () => submitAnswer(act, a, 'q1', { round: 1, answers: [{ blankId: 'q1b1', text: ' ' }] }), 400, 'BLANKS_MISMATCH')
    // 空白 先於 長度
    expectError(act, () => submitAnswer(act, a, 'q1', { round: 1, answers: two(' ', '字'.repeat(501)) }), 400, 'BLANK_ANSWER')
    submitAnswer(act, a, 'q1', { round: 1, answers: two('a', 'b') })
    // 已送出 先於 格數
    expectError(act, () => submitAnswer(act, a, 'q1', { round: 1, answers: [] }), 409, 'ALREADY_SUBMITTED')
  })
})

// ---------- 依接收順序給順位 ----------

describe('依接收順序給順位', () => {
  it('多組同時送出：順位為 1、2、3，各不相同，與接收先後一致', () => {
    const { act, join } = setup()
    const a = join('小明', 'g1')
    const b = join('小華', 'g2')
    const c = join('小美', 'g3')
    openQuestion(act, 'q3')
    const send = (id, text) => submitAnswer(act, id, 'q3', { round: 1, answers: [{ blankId: 'q3b1', text }] })
    send(b, '乙')
    send(c, '丙')
    send(a, '甲')
    expect(act.submissions.get('q3').map((s) => [s.groupId, s.rank])).toEqual([
      ['g2', 1],
      ['g3', 2],
      ['g1', 3],
    ])
    closeQuestion(act, 'q3')
    const [r] = results(act)
    expect(r.submissions.map((s) => [s.groupId, s.rank])).toEqual([
      ['g2', 1],
      ['g3', 2],
      ['g1', 3],
    ])
    expect(r.winnerGroupId).toBe('g2')
  })

  it('無人作答：results 中該題的 submissions 為空，winnerGroupId 為 null', () => {
    const { act } = setup()
    openQuestion(act, 'q1')
    closeQuestion(act, 'q1')
    expect(results(act)).toEqual([{ questionId: 'q1', round: 1, submissions: [], winnerGroupId: null }])
  })

  it('重開後順位從 1 重新開始', () => {
    const { act, join } = setup()
    const a = join('小明', 'g1')
    const b = join('小華', 'g2')
    openQuestion(act, 'q1')
    submitAnswer(act, a, 'q1', { round: 1, answers: two('a', 'b') })
    closeQuestion(act, 'q1')
    reopenQuestion(act, 'q1')
    submitAnswer(act, b, 'q1', { round: 2, answers: two('c', 'd') })
    submitAnswer(act, a, 'q1', { round: 2, answers: two('e', 'f') })
    expect(act.submissions.get('q1').map((s) => [s.groupId, s.rank])).toEqual([
      ['g2', 1],
      ['g1', 2],
    ])
  })
})

// ---------- 同組草稿 ----------

describe('同組草稿', () => {
  function ready() {
    const s = setup()
    const a = s.join('小明', 'g1')
    const a2 = s.join('小強', 'g1')
    const b = s.join('小華', 'g2')
    openQuestion(s.act, 'q1')
    return { ...s, a, a2, b }
  }
  const draft = (blankId, text, round = 1, questionId = 'q1') => ({ questionId, round, blankId, text })

  it('同組收到草稿：回傳組別、題目、輪次與含 rev 和編輯者暱稱的草稿', () => {
    const { act, a } = ready()
    expect(updateDraft(act, a, draft('q1b1', '中央'))).toEqual({
      groupId: 'g1',
      questionId: 'q1',
      round: 1,
      draft: { blankId: 'q1b1', text: '中央', rev: 1, by: { clientId: a, nickname: '小明' } },
    })
  })

  it('同一個子填空以最後收到的內容為準，rev 每次加 1；他組的草稿分開計算', () => {
    const { act, a, a2, b } = ready()
    updateDraft(act, a, draft('q1b1', '中'))
    const second = updateDraft(act, a2, draft('q1b1', '中央處理器'))
    expect(second.draft).toMatchObject({ text: '中央處理器', rev: 2, by: { nickname: '小強' } })
    expect(updateDraft(act, a, draft('q1b2', '作業')).draft.rev).toBe(1)
    const other = updateDraft(act, b, draft('q1b1', '他組'))
    expect(other).toMatchObject({ groupId: 'g2', draft: { rev: 1 } })
    expect(act.drafts.get('q1|1|g1|q1b1').text).toBe('中央處理器')
    expect(act.drafts.get('q1|1|g2|q1b1').text).toBe('他組')
  })

  it('老師看到編輯中：該組在本題的第一筆草稿才 commit，之後的草稿不改變 version', () => {
    const { act, a, a2, b } = ready()
    expect(teacherSnapshot(act).groups[0].current.status).toBe('idle')
    expectOneCommit(act, () => updateDraft(act, a, draft('q1b1', '中')))
    expect(teacherSnapshot(act).groups[0].current.status).toBe('editing')
    expectNoCommit(act, () => updateDraft(act, a2, draft('q1b1', '中央')))
    expectNoCommit(act, () => updateDraft(act, a, draft('q1b2', '作業')))
    expectOneCommit(act, () => updateDraft(act, b, draft('q1b1', '他組')))
    expect(teacherSnapshot(act).groups[1].current.status).toBe('editing')
  })

  it('已送出後的草稿：回覆 ALREADY_SUBMITTED，草稿不變', () => {
    const { act, a, a2 } = ready()
    updateDraft(act, a2, draft('q1b1', '中央'))
    submitAnswer(act, a, 'q1', { round: 1, answers: two('CPU', 'OS') })
    const before = structuredClone([...act.drafts])
    expectError(act, () => updateDraft(act, a2, draft('q1b1', '改')), undefined, 'ALREADY_SUBMITTED')
    expect([...act.drafts]).toEqual(before)
  })

  it('重開後草稿重新計算 rev', () => {
    const { act, a } = ready()
    updateDraft(act, a, draft('q1b1', '舊'))
    closeQuestion(act, 'q1')
    reopenQuestion(act, 'q1')
    expectError(act, () => updateDraft(act, a, draft('q1b1', '舊輪次')), undefined, 'STALE_ROUND')
    expectOneCommit(act, () => {
      expect(updateDraft(act, a, draft('q1b1', '新', 2)).draft.rev).toBe(1)
    })
  })

  it('草稿最多保留 2000 個字元', () => {
    const { act, a } = ready()
    const res = updateDraft(act, a, draft('q1b1', 'x'.repeat(2500)))
    expect(res.draft.text).toHaveLength(2000)
  })

  it('不符合條件時丟出對應的錯誤碼，草稿與 version 不變', () => {
    const { act, a, join } = ready()
    const noGroup = join('路人')
    expectError(act, () => updateDraft(act, 'f'.repeat(24), draft('q1b1', 'x')), undefined, 'NOT_JOINED')
    expectError(act, () => updateDraft(act, a, draft('q2b1', 'x', 1, 'q2')), undefined, 'QUESTION_NOT_OPEN')
    expectError(act, () => updateDraft(act, a, draft('q1b1', 'x', 0)), undefined, 'STALE_ROUND')
    expectError(act, () => updateDraft(act, noGroup, draft('q1b1', 'x')), undefined, 'INVALID_GROUP')
    expectError(act, () => updateDraft(act, a, draft('q2b1', 'x')), undefined, 'BLANKS_MISMATCH')
    expectError(act, () => updateDraft(act, a, draft('q1b1', 42)), undefined, 'BLANKS_MISMATCH')
    expectError(act, () => updateDraft(act, a, {}), undefined, 'QUESTION_NOT_OPEN')
    closeQuestion(act, 'q1')
    expectError(act, () => updateDraft(act, a, draft('q1b1', 'x')), undefined, 'QUESTION_NOT_OPEN')
    expect(act.drafts.size).toBe(0)
  })
})

// ---------- 寫回計畫 ----------

describe('寫回計畫', () => {
  it('只取已結束題目、目前輪次順位 1 的提交，其他題號列在 skippedQuestions', () => {
    const { act, join } = setup()
    const a = join('小明', 'g1')
    const b = join('小華', 'g2')
    // 第 1 題：第 2 組搶到
    openQuestion(act, 'q1')
    submitAnswer(act, b, 'q1', { round: 1, answers: two('CPU', '作業系統') })
    submitAnswer(act, a, 'q1', { round: 1, answers: two('慢', '慢') })
    closeQuestion(act, 'q1')
    // 第 3 題：無人作答
    openQuestion(act, 'q3')
    closeQuestion(act, 'q3')
    // 第 4 題：進行中（有提交也不寫）
    openQuestion(act, 'q4')
    submitAnswer(act, a, 'q4', { round: 1, answers: [{ blankId: 'q4b1', text: '進行中' }] })

    expect(exportPlan(act)).toEqual({
      cells: [
        { questionNumber: 1, blankId: 'q1b1', row: 4, col: 7, cellRef: '學習單!H5', value: 'CPU' },
        { questionNumber: 1, blankId: 'q1b2', row: 5, col: 7, cellRef: '學習單!H6', value: '作業系統' },
      ],
      skippedQuestions: [2, 3, 4],
    })
  })

  it('重開後以最後一輪的順位 1 為準', () => {
    const { act, join } = setup()
    const a = join('小明', 'g1')
    const c = join('小美', 'g3')
    openQuestion(act, 'q3')
    submitAnswer(act, a, 'q3', { round: 1, answers: [{ blankId: 'q3b1', text: '第一輪' }] })
    closeQuestion(act, 'q3')
    reopenQuestion(act, 'q3')
    submitAnswer(act, c, 'q3', { round: 2, answers: [{ blankId: 'q3b1', text: '第二輪' }] })
    submitAnswer(act, a, 'q3', { round: 2, answers: [{ blankId: 'q3b1', text: '第二輪慢' }] })
    expect(exportPlan(act).cells).toEqual([])
    closeQuestion(act, 'q3')
    expect(exportPlan(act).cells).toEqual([
      { questionNumber: 3, blankId: 'q3b1', row: 10, col: 6, cellRef: '學習單!G11', value: '第二輪' },
    ])
  })

  it('沒有已結束的題目時沒有任何格子', () => {
    const { act } = setup()
    expect(exportPlan(act)).toEqual({ cells: [], skippedQuestions: [1, 2, 3, 4] })
  })

  it('markExported 記錄寫回時間並 commit', () => {
    const { act } = setup()
    expectOneCommit(act, () => markExported(act, '2026-11-19T08:00:00.000Z'))
    expect(act.sheet.lastExportedAt).toBe('2026-11-19T08:00:00.000Z')
  })
})
