import type {
  Member,
  Question,
  Result,
  StudentSnapshot,
  TeacherQuestion,
  TeacherSnapshot,
} from '../api/types'

/** 學生畫面（design D10），由上往下第一個符合的規則生效 */
export type StudentView =
  | { kind: 'chooseGroup' }
  | { kind: 'submitted'; question: Question }
  | { kind: 'answer'; question: Question; isLeader: boolean }
  | { kind: 'result'; question: Question; result: Result }
  | { kind: 'waiting' }

export function currentQuestion<Q extends { id: string }>(
  s: { currentQuestionId: string | null; questions: Q[] },
): Q | null {
  return s.currentQuestionId ? s.questions.find((q) => q.id === s.currentQuestionId) ?? null : null
}

/** 要顯示結果的題目：本機記錄的最近結束題目；無法判斷時取題號最大的已結束題目 */
export function latestResult(
  s: StudentSnapshot,
  lastClosedId: string | null,
): { question: Question; result: Result } | null {
  const closed = s.results
    .map((r) => ({ result: r, question: s.questions.find((q) => q.id === r.questionId)! }))
    .filter((x) => x.question && x.question.status === 'closed')
  if (!closed.length) return null
  return (
    closed.find((x) => x.question.id === lastClosedId) ??
    closed.reduce((a, b) => (b.question.number > a.question.number ? b : a))
  )
}

export function studentView(s: StudentSnapshot, lastClosedId: string | null = null): StudentView {
  if (s.me.groupId == null) return { kind: 'chooseGroup' }
  const q = currentQuestion(s)
  if (q && s.myGroup?.submitted) return { kind: 'submitted', question: q }
  if (q) return { kind: 'answer', question: q, isLeader: s.me.isLeader }
  const latest = latestResult(s, lastClosedId)
  if (latest) return { kind: 'result', ...latest }
  return { kind: 'waiting' }
}

/** 學生端是否可以換組（只控制下拉選單；是否允許由後端判斷） */
export function canChangeGroup(s: StudentSnapshot): boolean {
  return !s.groupLocked || s.me.groupId == null
}

/** 老師端按鈕可用性（design D11） */
export const teacherButtons = {
  canStart: (s: TeacherSnapshot, q: TeacherQuestion) => q.status === 'idle' && !s.currentQuestionId,
  canClose: (_s: TeacherSnapshot, q: TeacherQuestion) => q.status === 'open',
  canReopen: (s: TeacherSnapshot, q: TeacherQuestion) => q.status === 'closed' && !s.currentQuestionId,
  /** 「下一題」要開始的題目：題號最小的未開始題目；有題目進行中或沒有未開始題目時為 null */
  nextQuestion: (s: TeacherSnapshot): TeacherQuestion | null => {
    if (s.currentQuestionId) return null
    const idle = s.questions.filter((q) => q.status === 'idle')
    return idle.length ? idle.reduce((a, b) => (b.number < a.number ? b : a)) : null
  },
  canSetLeader: (m: Member) => !m.isLeader,
}
