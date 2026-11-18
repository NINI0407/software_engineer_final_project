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

/** 寫回試算表前，確認視窗中每一題的預覽（design G5） */
export type SheetWriteItem =
  | {
      kind: 'write'
      question: TeacherQuestion
      groupName: string
      cells: { label: string | null; cellRef: string; text: string }[]
    }
  | { kind: 'noAnswer'; question: TeacherQuestion }
  | { kind: 'open'; question: TeacherQuestion }
  | { kind: 'idle'; question: TeacherQuestion }

/**
 * 依快照計算每一題會不會寫入、寫到哪幾格。只是把快照換個方式顯示：
 * 實際寫入的內容以後端為準。`results` 只含已結束題目目前輪次的提交，所以重開過的題目只看最後一輪。
 */
export function sheetWritePlan(s: TeacherSnapshot): SheetWriteItem[] {
  return [...s.questions]
    .sort((a, b) => a.number - b.number)
    .map((question): SheetWriteItem => {
      if (question.status === 'open') return { kind: 'open', question }
      if (question.status === 'idle') return { kind: 'idle', question }
      const result = s.results.find((r) => r.questionId === question.id)
      const winner = result?.winnerGroupId
        ? result.submissions.find((x) => x.groupId === result.winnerGroupId)
        : undefined
      if (!winner) return { kind: 'noAnswer', question }
      const groupName = s.activity.groups.find((g) => g.id === winner.groupId)?.name ?? winner.groupId
      const cells = question.blanks.flatMap((b) => {
        const a = winner.answers.find((x) => x.blankId === b.id)
        return a ? [{ label: b.label, cellRef: b.cellRef, text: a.text }] : []
      })
      return cells.length ? { kind: 'write', question, groupName, cells } : { kind: 'noAnswer', question }
    })
}

/** 是否有任何可寫回的格子（「寫回試算表」按鈕的可用條件之一） */
export const hasSheetWrites = (s: TeacherSnapshot) => sheetWritePlan(s).some((x) => x.kind === 'write')
