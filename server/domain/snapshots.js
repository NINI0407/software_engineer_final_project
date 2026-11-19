// 依角色產生快照（change build-quiz-backend，design B3；欄位照介面約定 v1 與 mock）。
// 學生快照只含本人與本組的資料，沒有任何試算表資訊；
// row、col、target 等內部欄位不出現在任何快照中。

import {
  currentQuestion,
  draftsFor,
  groupMembers,
  isOnline,
  leaderOf,
  submissionOf,
  submissionsOf,
} from './activity.js'

const groupView = (g) => ({ id: g.id, name: g.name })

const draftView = (d) => ({
  blankId: d.blankId,
  text: d.text,
  rev: d.rev,
  by: { clientId: d.by.clientId, nickname: d.by.nickname },
})

const publicSubmission = (s) => ({
  groupId: s.groupId,
  answers: s.answers.map((a) => ({ blankId: a.blankId, text: a.text })),
  rank: s.rank,
  submittedAt: s.submittedAt,
})

function memberView(act, gid) {
  const lid = leaderOf(act, gid)
  return groupMembers(act, gid).map((m) => ({
    clientId: m.clientId,
    nickname: m.nickname,
    online: isOnline(m),
    isLeader: m.clientId === lid,
  }))
}

/** 已結束題目的結果：每題的提交依順位排序，順位 1 為 winnerGroupId */
export function results(act) {
  return act.questions
    .filter((q) => q.status === 'closed')
    .map((q) => {
      const subs = [...submissionsOf(act, q.id)].sort((a, b) => a.rank - b.rank)
      return {
        questionId: q.id,
        round: q.round,
        submissions: subs.map(publicSubmission),
        winnerGroupId: subs[0]?.groupId ?? null,
      }
    })
}

/** 學生快照：不含他組資料、sheet 與 cellRef */
export function studentSnapshot(act, clientId) {
  const m = act.members.get(clientId)
  const q = currentQuestion(act)
  const gid = m?.groupId ?? null
  return {
    version: act.version,
    activity: { code: act.code, groups: act.groups.map(groupView) },
    questions: act.questions.map((x) => ({
      id: x.id,
      number: x.number,
      status: x.status,
      round: x.round,
      blanks: x.blanks.map((b) => ({ id: b.id, label: b.label })),
    })),
    currentQuestionId: act.currentQuestionId,
    groupLocked: act.groupLocked,
    me: {
      clientId,
      nickname: m?.nickname ?? '',
      groupId: gid,
      isLeader: gid ? leaderOf(act, gid) === clientId : false,
    },
    myGroup: gid
      ? {
          members: memberView(act, gid),
          drafts: q ? draftsFor(act, q, gid).map(draftView) : [],
          submitted: q ? !!submissionOf(act, q.id, gid) : false,
        }
      : null,
    results: results(act),
  }
}

/** 老師快照：含各組成員、目前題目的作答狀態與提交、各題的 cellRef，以及試算表資訊 */
export function teacherSnapshot(act) {
  const q = currentQuestion(act)
  return {
    version: act.version,
    activity: { code: act.code, groups: act.groups.map(groupView) },
    questions: act.questions.map((x) => ({
      id: x.id,
      number: x.number,
      status: x.status,
      round: x.round,
      blanks: x.blanks.map((b) => ({ id: b.id, label: b.label, cellRef: b.cellRef })),
    })),
    currentQuestionId: act.currentQuestionId,
    groupLocked: act.groupLocked,
    groups: act.groups.map((g) => {
      let current = null
      if (q) {
        const sub = submissionOf(act, q.id, g.id)
        const status = sub ? 'submitted' : draftsFor(act, q, g.id).length ? 'editing' : 'idle'
        current = { status, submission: sub ? publicSubmission(sub) : null }
      }
      return { group: groupView(g), members: memberView(act, g.id), current }
    }),
    results: results(act),
    sheet: {
      spreadsheetTitle: act.sheet.spreadsheetTitle,
      worksheetTitle: act.sheet.worksheetTitle,
      url: act.sheet.url,
      lastExportedAt: act.sheet.lastExportedAt,
    },
  }
}
