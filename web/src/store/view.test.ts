import { describe, expect, it } from 'vitest'
import type { Result } from '../api/types'
import { q, studentSnap, teacherSnap } from '../test/fixtures'
import { canChangeGroup, hasSheetWrites, sheetWritePlan, studentView, teacherButtons } from './view'

const result = (qid: string): Result => ({ questionId: qid, round: 1, submissions: [], winnerGroupId: null })

describe('studentView（design D10）', () => {
  const open = [q('q1', 1, 'open'), q('q2', 2)]
  const cases: [string, Parameters<typeof studentSnap>[0], string][] = [
    ['1. 尚未選組', { me: { clientId: 'c', nickname: 'a', groupId: null, isLeader: false }, myGroup: null }, 'chooseGroup'],
    [
      '2. 進行中且已送出',
      { currentQuestionId: 'q1', questions: open, myGroup: { members: [], drafts: [], submitted: true } },
      'submitted',
    ],
    ['3. 進行中、組長', { currentQuestionId: 'q1', questions: open }, 'answer'],
    [
      '4. 進行中、組員',
      { currentQuestionId: 'q1', questions: open, me: { clientId: 'c', nickname: 'a', groupId: 'g1', isLeader: false } },
      'answer',
    ],
    ['5. 沒有進行中、有結果', { questions: [q('q1', 1, 'closed'), q('q2', 2)], results: [result('q1')] }, 'result'],
    ['6. 沒有進行中、沒有結果', {}, 'waiting'],
  ]
  it.each(cases)('%s', (_name, over, kind) => {
    expect(studentView(studentSnap(over)).kind).toBe(kind)
  })

  it('組長與組員的 isLeader 不同', () => {
    const leader = studentView(studentSnap({ currentQuestionId: 'q1', questions: open }))
    const member = studentView(
      studentSnap({ currentQuestionId: 'q1', questions: open, me: { clientId: 'c', nickname: 'a', groupId: 'g1', isLeader: false } }),
    )
    expect(leader).toMatchObject({ kind: 'answer', isLeader: true })
    expect(member).toMatchObject({ kind: 'answer', isLeader: false })
  })

  it('結果頁顯示本機記錄的最近結束題目；無法判斷時取題號最大的已結束題目', () => {
    const s = studentSnap({
      questions: [q('q1', 1, 'closed'), q('q2', 2, 'closed')],
      results: [result('q1'), result('q2')],
    })
    expect(studentView(s, 'q1')).toMatchObject({ kind: 'result', question: { id: 'q1' } })
    expect(studentView(s, null)).toMatchObject({ kind: 'result', question: { id: 'q2' } })
  })

  it('換組：開始前可以；開始後只有尚未選組的人可以選一次', () => {
    expect(canChangeGroup(studentSnap({ groupLocked: false }))).toBe(true)
    expect(canChangeGroup(studentSnap({ groupLocked: true }))).toBe(false)
    expect(
      canChangeGroup(studentSnap({ groupLocked: true, me: { clientId: 'c', nickname: 'a', groupId: null, isLeader: false } })),
    ).toBe(true)
  })
})

describe('teacherButtons（design D11）', () => {
  const cell = (x: ReturnType<typeof q>) => ({ ...x, blanks: x.blanks.map((b) => ({ ...b, cellRef: 'S!A1' })) })

  it('沒有題目進行中：未開始可開始、已結束可重開、不能結束', () => {
    const s = teacherSnap({ questions: [q('q1', 1, 'closed'), q('q2', 2), q('q3', 3)].map(cell) })
    const [q1, q2] = s.questions
    expect(teacherButtons.canStart(s, q2)).toBe(true)
    expect(teacherButtons.canStart(s, q1)).toBe(false)
    expect(teacherButtons.canReopen(s, q1)).toBe(true)
    expect(teacherButtons.canReopen(s, q2)).toBe(false)
    expect(teacherButtons.canClose(s, q1)).toBe(false)
    expect(teacherButtons.nextQuestion(s)?.id).toBe('q2')
  })

  it('第 3 題進行中：其他題的開始、重開都停用，只有第 3 題可以結束', () => {
    const s = teacherSnap({
      currentQuestionId: 'q3',
      questions: [q('q1', 1, 'closed'), q('q2', 2), q('q3', 3, 'open')].map(cell),
    })
    for (const x of s.questions) {
      expect(teacherButtons.canStart(s, x)).toBe(false)
      expect(teacherButtons.canReopen(s, x)).toBe(false)
      expect(teacherButtons.canClose(s, x)).toBe(x.id === 'q3')
    }
    expect(teacherButtons.nextQuestion(s)).toBeNull()
  })

  it('下一題：題號最小的未開始題目；全部結束時為 null', () => {
    const s = teacherSnap({ questions: [q('a', 4), q('b', 3), q('c', 1, 'closed'), q('d', 2, 'closed')].map(cell) })
    expect(teacherButtons.nextQuestion(s)?.number).toBe(3)
    const done = teacherSnap({ questions: [q('c', 1, 'closed')].map(cell) })
    expect(teacherButtons.nextQuestion(done)).toBeNull()
  })

  it('設為組長：只有不是組長的成員可以', () => {
    expect(teacherButtons.canSetLeader({ clientId: 'a', nickname: 'a', online: true, isLeader: true })).toBe(false)
    expect(teacherButtons.canSetLeader({ clientId: 'b', nickname: 'b', online: true, isLeader: false })).toBe(true)
  })
})

describe('sheetWritePlan（寫回前確認，design G5）', () => {
  // 每個 blank 依題號與序號給不同的儲存格，確認不是寫死的位置
  const cells = (x: ReturnType<typeof q>) => ({
    ...x,
    blanks: x.blanks.map((b, i) => ({ ...b, cellRef: `學習單!G${x.number * 10 + i}` })),
  })
  const groups = [
    { id: 'g1', name: '第 1 組' },
    { id: 'g2', name: '第 2 組' },
    { id: 'g3', name: '第 3 組' },
  ]
  const activity = { code: 'ABC234', groups }
  const sub = (groupId: string, rank: number, answers: [string, string][]) => ({
    groupId,
    rank,
    submittedAt: '2026-11-18T00:00:00Z',
    answers: answers.map(([blankId, text]) => ({ blankId, text })),
  })

  it('單題：寫入順位 1 的組別、答案與儲存格；無人作答、進行中、未開始各自標示', () => {
    const s = teacherSnap({
      activity,
      questions: [q('q1', 1, 'closed'), q('q2', 2, 'closed'), q('q3', 3, 'open'), q('q4', 4)].map(cells),
      currentQuestionId: 'q3',
      results: [
        {
          questionId: 'q1',
          round: 1,
          winnerGroupId: 'g2',
          submissions: [sub('g2', 1, [['q1b1', '光合作用']]), sub('g1', 2, [['q1b1', '呼吸作用']])],
        },
        { questionId: 'q2', round: 1, winnerGroupId: null, submissions: [] },
      ],
    })
    const plan = sheetWritePlan(s)
    expect(plan.map((x) => [x.question.number, x.kind])).toEqual([
      [1, 'write'],
      [2, 'noAnswer'],
      [3, 'open'],
      [4, 'idle'],
    ])
    expect(plan[0]).toMatchObject({
      groupName: '第 2 組',
      cells: [{ label: null, cellRef: '學習單!G10', text: '光合作用' }],
    })
    expect(hasSheetWrites(s)).toBe(true)
  })

  it('題組：每個子填空各自一格', () => {
    const s = teacherSnap({
      activity,
      questions: [cells(q('q1', 1, 'closed', 2))],
      results: [
        {
          questionId: 'q1',
          round: 1,
          winnerGroupId: 'g3',
          submissions: [sub('g3', 1, [['q1b1', 'CPU'], ['q1b2', '作業系統']])],
        },
      ],
    })
    expect(sheetWritePlan(s)[0]).toMatchObject({
      kind: 'write',
      groupName: '第 3 組',
      cells: [
        { label: '（1）', cellRef: '學習單!G10', text: 'CPU' },
        { label: '（2）', cellRef: '學習單!G11', text: '作業系統' },
      ],
    })
  })

  it('重開過的題目只看快照中的最後一輪結果；重開進行中時不寫入', () => {
    const reopened = { ...q('q1', 1, 'closed'), round: 2 }
    const s = teacherSnap({
      activity,
      questions: [cells(reopened)],
      results: [
        { questionId: 'q1', round: 2, winnerGroupId: 'g3', submissions: [sub('g3', 1, [['q1b1', '第二輪']])] },
      ],
    })
    expect(sheetWritePlan(s)[0]).toMatchObject({ kind: 'write', cells: [{ text: '第二輪' }] })
    const reopenedOpen = teacherSnap({
      activity,
      questions: [cells({ ...q('q1', 1, 'open'), round: 2 })],
      currentQuestionId: 'q1',
      results: [],
    })
    expect(sheetWritePlan(reopenedOpen)[0].kind).toBe('open')
  })

  it('沒有已結束且有提交的題目時，沒有可寫回的內容', () => {
    expect(hasSheetWrites(teacherSnap({ questions: [q('q1', 1)].map(cells) }))).toBe(false)
    const closedEmpty = teacherSnap({
      questions: [q('q1', 1, 'closed')].map(cells),
      results: [{ questionId: 'q1', round: 1, winnerGroupId: null, submissions: [] }],
    })
    expect(hasSheetWrites(closedEmpty)).toBe(false)
  })

  it('依題號排序', () => {
    const s = teacherSnap({ questions: [q('b', 2), q('a', 1)].map(cells) })
    expect(sheetWritePlan(s).map((x) => x.question.number)).toEqual([1, 2])
  })
})
