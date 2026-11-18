import type { Question, StudentSnapshot, TeacherSnapshot } from '../api/types'

export function q(id: string, number: number, status: Question['status'] = 'idle', blanks = 1): Question {
  return {
    id,
    number,
    status,
    round: 1,
    blanks: Array.from({ length: blanks }, (_, i) => ({
      id: `${id}b${i + 1}`,
      label: blanks > 1 ? `（${i + 1}）` : null,
    })),
  }
}

export function studentSnap(over: Partial<StudentSnapshot> = {}): StudentSnapshot {
  return {
    version: 1,
    activity: { code: 'ABC234', groups: [{ id: 'g1', name: '第 1 組' }, { id: 'g2', name: '第 2 組' }] },
    questions: [q('q1', 1), q('q2', 2)],
    currentQuestionId: null,
    groupLocked: false,
    me: { clientId: 'c1', nickname: '小明', groupId: 'g1', isLeader: true },
    myGroup: { members: [], drafts: [], submitted: false },
    results: [],
    ...over,
  }
}

export function teacherSnap(over: Partial<TeacherSnapshot> = {}): TeacherSnapshot {
  const withCell = (x: Question) => ({ ...x, blanks: x.blanks.map((b) => ({ ...b, cellRef: 'S!A1' })) })
  return {
    version: 1,
    activity: { code: 'ABC234', groups: [{ id: 'g1', name: '第 1 組' }] },
    questions: [q('q1', 1), q('q2', 2), q('q3', 3)].map(withCell),
    currentQuestionId: null,
    groupLocked: false,
    groups: [],
    results: [],
    sheet: {
      spreadsheetTitle: '測試試算表',
      worksheetTitle: 'S',
      url: 'https://docs.google.com/spreadsheets/d/test/edit',
      lastExportedAt: null,
    },
    ...over,
  }
}
