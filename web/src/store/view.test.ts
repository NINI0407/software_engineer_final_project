import { describe, expect, it } from 'vitest'
import type { Result } from '../api/types'
import { q, studentSnap, teacherSnap } from '../test/fixtures'
import { canChangeGroup, studentView, teacherButtons } from './view'

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
