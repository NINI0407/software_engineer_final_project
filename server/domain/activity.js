// 活動規則（change build-quiz-backend，design B3、B4、B5）。
// 純邏輯：不知道 HTTP 與 Socket.IO 的存在。規則不成立時丟出 AppError，
// 每個會改變狀態的操作最後都呼叫 commit(act)。

import { AppError } from './errors.js'
import { randomId } from './store.js'

export const MIN_GROUPS = 2
export const MAX_GROUPS = 20
export const MAX_NICKNAME_LENGTH = 20
export const MAX_ANSWER_LENGTH = 500
export const MAX_DRAFT_LENGTH = 2000

// 答案頭尾要去掉的字元：一般空白與換行（含全形空白 U+3000）、零寬字元 U+200B、U+200C、U+200D、U+FEFF
const EDGE_BLANKS = /^[\s​‌‍﻿]+|[\s​‌‍﻿]+$/g
const CLIENT_ID_PATTERN = /^[a-f0-9]{24}$/

/** 去掉答案頭尾的空白與零寬字元 */
export const normalizeAnswer = (text) => String(text).replace(EDGE_BLANKS, '')

/** 以使用者看到的字數計算長度（代理對算一個字） */
const charLength = (s) => [...s].length

/**
 * @typedef {object} ImportBlank
 * @property {string|null} label
 * @property {number} row
 * @property {number} col
 * @property {string} cellRef
 *
 * @typedef {object} ImportResult
 * @property {string} spreadsheetId
 * @property {number} sheetId
 * @property {string} spreadsheetTitle
 * @property {string} worksheetTitle
 * @property {string} sheetUrl
 * @property {{ number: number, blanks: ImportBlank[] }[]} questions
 */

// ---------- 查詢 ----------

export const groupOf = (act, gid) => act.groups.find((g) => g.id === gid) ?? null
export const questionOf = (act, qid) => act.questions.find((q) => q.id === qid) ?? null
export const currentQuestion = (act) =>
  act.currentQuestionId ? questionOf(act, act.currentQuestionId) : null

/** 某組的成員，依加入本組的先後排序 */
export function groupMembers(act, gid) {
  return [...act.members.values()]
    .filter((m) => m.groupId === gid)
    .sort((a, b) => a.groupJoinedSeq - b.groupJoinedSeq)
}

/** 成員至少有一條 Socket.IO 連線才算在線（L1） */
export const isOnline = (member) => member.sockets > 0

/** 現任組長的 clientId（可能為 null）；只由 refreshLeaders() 更新 */
export const leaderOf = (act, gid) => act.leaders[gid] ?? null

export const submissionsOf = (act, qid) => act.submissions.get(qid) ?? []
export const submissionOf = (act, qid, gid) =>
  submissionsOf(act, qid).find((s) => s.groupId === gid) ?? null

export const draftKey = (qid, round, gid, bid) => `${qid}|${round}|${gid}|${bid}`

/** 某組在某題目前輪次的草稿（依子填空順序，只列出有草稿的子填空） */
export function draftsFor(act, q, gid) {
  return q.blanks
    .map((b) => act.drafts.get(draftKey(q.id, q.round, gid, b.id)))
    .filter(Boolean)
}

// ---------- commit（B4） ----------

/**
 * 依在線狀態更新每一組的組長（L1）：現任組長仍在本組且在線就保留；
 * 否則由本組在線且加入本組最早的成員接任；沒有人在線就清空。
 */
export function refreshLeaders(act) {
  for (const g of act.groups) {
    const current = act.members.get(act.leaders[g.id])
    if (current && current.groupId === g.id && isOnline(current)) continue
    act.leaders[g.id] = groupMembers(act, g.id).find(isOnline)?.clientId ?? null
  }
}

/**
 * 每次狀態改變都呼叫（B4）：重新判定組長 → version 加 1 → 通知外層推送快照。
 * 三件事在同一個同步區塊完成，快照不會出現「組長已離線但還沒換人」的中間狀態。
 */
export function commit(act) {
  refreshLeaders(act)
  act.version += 1
  act.onCommit?.(act)
}

// ---------- 建立活動 ----------

/**
 * 以匯入結果建立活動並放進 store.activities。建立本身不呼叫 commit（version 從 1 開始）。
 * @param {import('./store.js').Store} store
 * @param {ImportResult} importResult
 * @param {number} groupCount
 */
export function createActivity(store, importResult, groupCount) {
  if (!Number.isInteger(groupCount) || groupCount < MIN_GROUPS || groupCount > MAX_GROUPS) {
    throw new AppError(400, 'INVALID_GROUP_COUNT', '組數須為 2 到 20 的整數')
  }
  const code = store.newCode()
  const act = {
    code,
    groups: Array.from({ length: groupCount }, (_, i) => ({ id: `g${i + 1}`, name: `第 ${i + 1} 組` })),
    // 題目與子填空完全來自匯入結果；複製一份，之後匯入結果改變也不影響活動（S4）
    questions: importResult.questions.map((q, i) => ({
      id: `q${i + 1}`,
      number: q.number,
      status: 'idle',
      round: 1,
      blanks: q.blanks.map((b, j) => ({
        id: `q${i + 1}b${j + 1}`,
        label: b.label,
        row: b.row,
        col: b.col,
        cellRef: b.cellRef,
      })),
    })),
    currentQuestionId: null,
    groupLocked: false,
    version: 1,
    members: new Map(), // clientId → { clientId, nickname, groupId, groupJoinedSeq, sockets }
    leaders: {}, // groupId → 現任組長的 clientId（或 null）
    submissions: new Map(), // questionId → 目前輪次的提交（依順位）
    drafts: new Map(), // draftKey → { blankId, text, rev, by }
    seq: 0, // 加入組別的先後順序
    sheet: {
      spreadsheetTitle: importResult.spreadsheetTitle,
      worksheetTitle: importResult.worksheetTitle,
      url: importResult.sheetUrl,
      lastExportedAt: null,
    },
    // 寫回目標（S4）：只放在活動內部，不出現在任何快照
    target: { spreadsheetId: importResult.spreadsheetId, sheetId: importResult.sheetId },
    resultsVersion: 0, // 最後一次有題目結束或重開時的 version
    exporting: false, // 寫回進行中的鎖（S5）
    onCommit: null, // 由外層設定為 (act) => void，負責推送快照
  }
  store.activities.set(code, act)
  return act
}

// ---------- 成員 ----------

/**
 * 學生加入。clientId 不合法時產生新的；已經是成員時只更新暱稱。
 * @returns {{ clientId: string, isNew: boolean }} isNew 為 true 時需要發出新的 client_id Cookie
 */
export function joinActivity(act, clientId, nickname) {
  const name = typeof nickname === 'string' ? nickname.trim() : ''
  const len = charLength(name)
  if (len < 1 || len > MAX_NICKNAME_LENGTH) {
    throw new AppError(400, 'INVALID_NICKNAME', '請輸入 1 到 20 字的暱稱')
  }
  let id = clientId
  let isNew = false
  if (typeof id !== 'string' || !CLIENT_ID_PATTERN.test(id)) {
    id = randomId(12)
    isNew = true
  }
  const existing = act.members.get(id)
  if (existing) existing.nickname = name
  else act.members.set(id, { clientId: id, nickname: name, groupId: null, groupJoinedSeq: 0, sockets: 0 })
  commit(act)
  return { clientId: id, isNew }
}

/** 取得成員；不是成員時丟出 401 NOT_JOINED */
export function requireMember(act, clientId) {
  const m = act.members.get(clientId)
  if (!m) throw new AppError(401, 'NOT_JOINED', '請先加入活動')
  return m
}

/**
 * 選組。第一題開始後組別鎖定，但還沒有組別的學生仍可選一次。組別沒變時不 commit。
 * @returns {object} 該成員
 */
export function chooseGroup(act, clientId, groupId) {
  const m = requireMember(act, clientId)
  if (!groupOf(act, groupId)) throw new AppError(400, 'INVALID_GROUP', '組別不存在')
  if (m.groupId !== groupId) {
    if (act.groupLocked && m.groupId) throw new AppError(409, 'GROUP_LOCKED', '搶答已開始，無法換組')
    m.groupId = groupId
    m.groupJoinedSeq = ++act.seq
    commit(act)
  }
  return m
}

/** 學生的一條連線建立；只有從離線變成在線時才 commit（L1、L2） */
export function memberConnected(act, clientId) {
  const m = act.members.get(clientId)
  if (!m) return
  m.sockets += 1
  if (m.sockets === 1) commit(act)
}

/** 學生的一條連線中斷；只有從在線變成離線時才 commit（L1、L2） */
export function memberDisconnected(act, clientId) {
  const m = act.members.get(clientId)
  if (!m || m.sockets === 0) return
  m.sockets -= 1
  if (m.sockets === 0) commit(act)
}

// ---------- 題目狀態機 ----------

function requireQuestion(act, qid) {
  const q = questionOf(act, qid)
  if (!q) throw new AppError(404, 'QUESTION_NOT_FOUND', '找不到題目')
  return q
}

/** 開始未開始的題目；開始後組別鎖定 */
export function openQuestion(act, qid) {
  const q = requireQuestion(act, qid)
  if (q.status === 'open') throw new AppError(409, 'INVALID_STATE', '題目已在進行中')
  if (act.currentQuestionId) throw new AppError(409, 'ANOTHER_QUESTION_OPEN', '已有題目進行中')
  if (q.status !== 'idle') throw new AppError(409, 'INVALID_STATE', '題目已結束，請使用重開')
  q.status = 'open'
  act.currentQuestionId = q.id
  act.groupLocked = true
  commit(act)
}

/** 結束進行中的題目；commit 之後更新 resultsVersion（B4、G5） */
export function closeQuestion(act, qid) {
  const q = requireQuestion(act, qid)
  if (q.status !== 'open') throw new AppError(409, 'INVALID_STATE', '題目不在進行中')
  q.status = 'closed'
  act.currentQuestionId = null
  commit(act)
  act.resultsVersion = act.version
}

/** 重開已結束的題目：round 加 1，清除該題的提交與草稿；commit 之後更新 resultsVersion */
export function reopenQuestion(act, qid) {
  const q = requireQuestion(act, qid)
  if (q.status !== 'closed') throw new AppError(409, 'INVALID_STATE', '只能重開已結束的題目')
  if (act.currentQuestionId) throw new AppError(409, 'ANOTHER_QUESTION_OPEN', '已有題目進行中')
  q.round += 1
  q.status = 'open'
  act.submissions.delete(q.id)
  for (const k of [...act.drafts.keys()]) if (k.startsWith(`${q.id}|`)) act.drafts.delete(k)
  act.currentQuestionId = q.id
  commit(act)
  act.resultsVersion = act.version
}

// ---------- 送出與草稿 ----------

/**
 * 組長送出答案。檢查順序照 spec「送出答案的驗證」。
 * 從檢查到寫入順位都在同一個同步區塊，中間沒有 await，所以順位不會重複（B5）。
 * @returns {{ submittedAt: string }}
 */
export function submitAnswer(act, clientId, qid, { round, answers } = {}) {
  const m = requireMember(act, clientId)
  const q = questionOf(act, qid)
  if (!q || q.status !== 'open') throw new AppError(409, 'QUESTION_NOT_OPEN', '本題不在進行中')
  if (round !== q.round) throw new AppError(409, 'STALE_ROUND', '本題已重開')
  if (!m.groupId || leaderOf(act, m.groupId) !== m.clientId) {
    throw new AppError(403, 'NOT_LEADER', '只有組長能送出')
  }
  if (submissionOf(act, q.id, m.groupId)) throw new AppError(409, 'ALREADY_SUBMITTED', '本組已送出')
  if (
    !Array.isArray(answers) ||
    answers.length !== q.blanks.length ||
    !q.blanks.every((b) => answers.some((a) => a && a.blankId === b.id && typeof a.text === 'string'))
  ) {
    throw new AppError(400, 'BLANKS_MISMATCH', '作答格數與題目不符')
  }
  const cleaned = q.blanks.map((b) => ({
    blankId: b.id,
    text: normalizeAnswer(answers.find((a) => a && a.blankId === b.id).text),
  }))
  if (cleaned.some((a) => a.text.length === 0)) throw new AppError(400, 'BLANK_ANSWER', '答案不可為空白')
  if (cleaned.some((a) => charLength(a.text) > MAX_ANSWER_LENGTH)) {
    throw new AppError(400, 'ANSWER_TOO_LONG', '答案不可超過 500 字')
  }
  const subs = submissionsOf(act, q.id)
  const submittedAt = new Date().toISOString()
  subs.push({ groupId: m.groupId, answers: cleaned, rank: subs.length + 1, submittedAt })
  act.submissions.set(q.id, subs)
  commit(act)
  return { submittedAt }
}

/**
 * 更新同組草稿（最後寫入者勝出，rev 每次加 1）。
 * 只有該組在本題的第一筆草稿才 commit（讓老師看到「編輯中」），其他更新不改變 version。
 * 錯誤一律丟出 AppError，Socket 層只使用 code。
 * @returns {{ groupId: string, questionId: string, round: number, draft: object }}
 */
export function updateDraft(act, clientId, { questionId, round, blankId, text } = {}) {
  const m = act.members.get(clientId)
  if (!m) throw new AppError(401, 'NOT_JOINED', '請先加入活動')
  const q = currentQuestion(act)
  if (!q || q.id !== questionId) throw new AppError(409, 'QUESTION_NOT_OPEN', '本題不在進行中')
  if (round !== q.round) throw new AppError(409, 'STALE_ROUND', '本題已重開')
  if (!m.groupId) throw new AppError(400, 'INVALID_GROUP', '尚未選組')
  if (submissionOf(act, q.id, m.groupId)) throw new AppError(409, 'ALREADY_SUBMITTED', '本組已送出')
  if (!q.blanks.some((b) => b.id === blankId) || typeof text !== 'string') {
    throw new AppError(400, 'BLANKS_MISMATCH', '作答格數與題目不符')
  }
  const isFirst = draftsFor(act, q, m.groupId).length === 0
  const key = draftKey(q.id, q.round, m.groupId, blankId)
  const prev = act.drafts.get(key)
  const draft = {
    blankId,
    text: text.slice(0, MAX_DRAFT_LENGTH),
    rev: (prev?.rev ?? 0) + 1,
    by: { clientId: m.clientId, nickname: m.nickname },
  }
  act.drafts.set(key, draft)
  if (isFirst) commit(act) // 老師端的狀態由「未作答」變為「編輯中」
  return { groupId: m.groupId, questionId: q.id, round: q.round, draft }
}

// ---------- 寫回 ----------

/**
 * 寫入計畫（S5 第 3 步）：每一題已結束、目前輪次順位 1 的提交，依子填空對應到儲存格。
 * 其他題目（未開始、進行中、無人作答）的題號放進 skippedQuestions。
 */
export function exportPlan(act) {
  const cells = []
  const skippedQuestions = []
  for (const q of act.questions) {
    const winner = q.status === 'closed' ? submissionsOf(act, q.id).find((s) => s.rank === 1) : null
    if (!winner) {
      skippedQuestions.push(q.number)
      continue
    }
    for (const b of q.blanks) {
      const a = winner.answers.find((x) => x.blankId === b.id)
      if (a) {
        cells.push({
          questionNumber: q.number,
          blankId: b.id,
          row: b.row,
          col: b.col,
          cellRef: b.cellRef,
          value: a.text,
        })
      }
    }
  }
  return { cells, skippedQuestions }
}

/** 寫回成功後記錄時間（S5 第 8 步） */
export function markExported(act, exportedAt) {
  act.sheet.lastExportedAt = exportedAt
  commit(act)
}
