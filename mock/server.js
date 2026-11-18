// 開發與測試用 mock 後端：依「前端介面約定 v1」（change switch-to-online-google-sheets 的 design.md G2）
// 回應 REST 與 Socket.IO。只存在記憶體；行為只用來支援前端開發與自動化測試，不代表正式後端的實作。
// mock 不呼叫任何 Google API，也不讀取任何 Google 憑證：試算表的匯入與寫回都只用固定資料模擬。

import crypto from 'node:crypto'
import http from 'node:http'
import express from 'express'
import { Server } from 'socket.io'
import { SHARE_WITH, pickSheet } from './fixtures.js'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 排除 0/O/1/I
const MAX_ANSWER_LENGTH = 500
const EDGE_BLANKS = /^[\s​‌‍﻿]+|[\s​‌‍﻿]+$/g

const normalize = (t) => String(t).replace(EDGE_BLANKS, '')
const randomId = (bytes = 12) => crypto.randomBytes(bytes).toString('hex')

function parseCookies(header = '') {
  const out = {}
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim()
    if (!k) continue
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim())
    } catch {
      out[k] = part.slice(i + 1).trim()
    }
  }
  return out
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

/** extra：選填的 `details`（字串）與 `shareWith`（要共用給誰的 email） */
function sendError(res, status, code, message, extra = {}) {
  const error = { code, message }
  if (extra.details) error.details = extra.details
  if (extra.shareWith) error.shareWith = extra.shareWith
  res.status(status).json({ error })
}

const COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', path: '/' }

export function createMockServer({ teacherPassword, testHooks = false } = {}) {
  if (!teacherPassword) throw new Error('teacherPassword is required')

  const app = express()
  const server = http.createServer(app)
  const io = new Server(server)

  let state = freshState()
  function freshState() {
    return {
      sessions: new Set(),
      imports: new Map(), // importId → 匯入結果
      sheetWrites: new Map(), // 活動代號 → 模擬寫回的紀錄
      activities: new Map(),
      forced: [], // 測試鉤子：強制下一次請求回傳錯誤
      skip: 0, // 測試鉤子：下一次推送前跳過的版本數
      delayMs: 0, // 測試鉤子：延遲推送快照
      blocked: new Map(), // 測試鉤子：clientId/teacher → 拒絕重新連線直到某時間
    }
  }

  // ---------- 活動資料的計算 ----------

  const groupOf = (act, gid) => act.groups.find((g) => g.id === gid)
  const questionOf = (act, qid) => act.questions.find((q) => q.id === qid)
  const currentQ = (act) => (act.currentQuestionId ? questionOf(act, act.currentQuestionId) : null)

  function groupMembers(act, gid) {
    return [...act.members.values()]
      .filter((m) => m.groupId === gid)
      .sort((a, b) => a.groupJoinedSeq - b.groupJoinedSeq)
  }

  function leaderId(act, gid) {
    const members = groupMembers(act, gid)
    const override = act.leaderOverride[gid]
    if (override && members.some((m) => m.clientId === override)) return override
    return members[0]?.clientId ?? null
  }

  const isOnline = (m) => (m.forcedOnline ?? null) !== null ? m.forcedOnline : m.sockets > 0

  function memberView(act, gid) {
    const lid = leaderId(act, gid)
    return groupMembers(act, gid).map((m) => ({
      clientId: m.clientId,
      nickname: m.nickname,
      online: isOnline(m),
      isLeader: m.clientId === lid,
    }))
  }

  const subsOf = (act, qid) => act.submissions.get(qid) ?? []
  const subOf = (act, qid, gid) => subsOf(act, qid).find((s) => s.groupId === gid) ?? null
  const draftKey = (qid, round, gid, bid) => `${qid}|${round}|${gid}|${bid}`

  function draftsFor(act, q, gid) {
    return q.blanks
      .map((b) => act.drafts.get(draftKey(q.id, q.round, gid, b.id)))
      .filter(Boolean)
  }

  const publicSubmission = (s) => ({
    groupId: s.groupId,
    answers: s.answers,
    rank: s.rank,
    submittedAt: s.submittedAt,
  })

  function results(act) {
    return act.questions
      .filter((q) => q.status === 'closed')
      .map((q) => {
        const subs = [...subsOf(act, q.id)].sort((a, b) => a.rank - b.rank)
        return {
          questionId: q.id,
          round: q.round,
          submissions: subs.map(publicSubmission),
          winnerGroupId: subs[0]?.groupId ?? null,
        }
      })
  }

  function studentSnapshot(act, clientId) {
    const m = act.members.get(clientId)
    const q = currentQ(act)
    const gid = m?.groupId ?? null
    return {
      version: act.version,
      activity: { code: act.code, groups: act.groups },
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
        isLeader: gid ? leaderId(act, gid) === clientId : false,
      },
      myGroup: gid
        ? {
            members: memberView(act, gid),
            drafts: q ? draftsFor(act, q, gid) : [],
            submitted: q ? !!subOf(act, q.id, gid) : false,
          }
        : null,
      results: results(act),
    }
  }

  function teacherSnapshot(act) {
    const q = currentQ(act)
    return {
      version: act.version,
      activity: { code: act.code, groups: act.groups },
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
          const sub = subOf(act, q.id, g.id)
          const status = sub ? 'submitted' : draftsFor(act, q, g.id).length ? 'editing' : 'idle'
          current = { status, submission: sub ? publicSubmission(sub) : null }
        }
        return { group: g, members: memberView(act, g.id), current }
      }),
      results: results(act),
      // 只放在老師快照；學生快照不含任何試算表資訊
      sheet: { ...act.sheet },
    }
  }

  // ---------- 推送 ----------

  const socketsOf = (code) => [...io.sockets.sockets.values()].filter((s) => s.data.code === code)

  function snapshotFor(act, socket) {
    return socket.data.role === 'teacher'
      ? teacherSnapshot(act)
      : studentSnapshot(act, socket.data.clientId)
  }

  function pushSnapshots(act) {
    const send = () => {
      for (const s of socketsOf(act.code)) s.emit('snapshot', snapshotFor(act, s))
    }
    if (state.delayMs > 0) setTimeout(send, state.delayMs)
    else send()
  }

  /** 每次狀態改變：version 遞增，並推送快照給活動中所有連線（依角色過濾） */
  function bump(act) {
    act.version += 1 + state.skip
    state.skip = 0
    pushSnapshots(act)
  }

  // ---------- REST ----------

  app.use(express.json({ limit: '1mb' }))

  // 測試鉤子：強制下一次符合的請求回傳指定錯誤
  app.use('/api', (req, res, next) => {
    const i = state.forced.findIndex(
      (f) =>
        (!f.method || f.method.toUpperCase() === req.method) &&
        (!f.path || req.originalUrl.includes(f.path)),
    )
    if (i < 0) return next()
    const f = state.forced[i]
    f.times -= 1
    if (f.times <= 0) state.forced.splice(i, 1)
    sendError(res, f.status, f.code, f.message ?? f.code, { details: f.details, shareWith: f.shareWith })
  })

  const cookies = (req) => parseCookies(req.headers.cookie)
  const isTeacher = (req) => state.sessions.has(cookies(req).teacher_session)

  function requireTeacher(req, res, next) {
    if (!isTeacher(req)) return sendError(res, 401, 'UNAUTHORIZED', '請先登入')
    next()
  }

  function loadActivity(req, res, next) {
    const act = state.activities.get(String(req.params.code).toUpperCase())
    if (!act) return sendError(res, 404, 'ACTIVITY_NOT_FOUND', '找不到此活動代號')
    req.act = act
    next()
  }

  function loadMember(req, res, next) {
    const m = req.act.members.get(cookies(req).client_id)
    if (!m) return sendError(res, 401, 'NOT_JOINED', '請先加入活動')
    req.member = m
    next()
  }

  // 老師
  app.post('/api/teacher/login', (req, res) => {
    const password = req.body?.password
    if (typeof password !== 'string' || !safeEqual(password, teacherPassword)) {
      return sendError(res, 401, 'INVALID_PASSWORD', '密碼錯誤')
    }
    const token = randomId(24)
    state.sessions.add(token)
    res.cookie('teacher_session', token, COOKIE_OPTS)
    res.status(204).end()
  })

  app.post('/api/teacher/logout', (req, res) => {
    state.sessions.delete(cookies(req).teacher_session)
    res.clearCookie('teacher_session', COOKIE_OPTS)
    res.status(204).end()
  })

  app.get('/api/teacher/session', (req, res) => {
    res.json({ authenticated: isTeacher(req) })
  })

  app.post('/api/sheets/import', requireTeacher, (req, res) => {
    const picked = pickSheet(req.body?.sheetUrl)
    if (picked.kind === 'error') {
      return sendError(res, picked.status, picked.code, picked.message, picked)
    }
    const importId = randomId(8)
    const preview = { importId, sheetUrl: picked.sheetUrl, ...picked.preview }
    state.imports.set(importId, { preview, writeMode: picked.writeMode })
    res.json(preview)
  })

  function newCode() {
    for (;;) {
      let c = ''
      for (let i = 0; i < 6; i++) c += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]
      if (!state.activities.has(c)) return c
    }
  }

  app.post('/api/activities', requireTeacher, (req, res) => {
    const { importId, groupCount } = req.body ?? {}
    if (!Number.isInteger(groupCount) || groupCount < 2 || groupCount > 20) {
      return sendError(res, 400, 'INVALID_GROUP_COUNT', '組數須為 2 到 20 的整數')
    }
    const imported = state.imports.get(importId)
    if (!imported) return sendError(res, 404, 'IMPORT_NOT_FOUND', '找不到匯入結果')
    const up = imported.preview
    const code = newCode()
    const act = {
      code,
      groups: Array.from({ length: groupCount }, (_, i) => ({ id: `g${i + 1}`, name: `第 ${i + 1} 組` })),
      questions: up.questions.map((q, i) => ({
        id: `q${i + 1}`,
        number: q.number,
        status: 'idle',
        round: 1,
        blanks: q.blanks.map((b, j) => ({ id: `q${i + 1}b${j + 1}`, label: b.label, cellRef: b.cellRef })),
      })),
      currentQuestionId: null,
      groupLocked: false,
      version: 1,
      members: new Map(),
      leaderOverride: {},
      submissions: new Map(),
      drafts: new Map(),
      seq: 0,
      sheet: {
        spreadsheetTitle: up.spreadsheetTitle,
        worksheetTitle: up.worksheetTitle,
        url: up.sheetUrl,
        lastExportedAt: null,
      },
      writeMode: imported.writeMode,
      resultsVersion: 0, // 最後一次有題目結束或重開時的 version
    }
    state.activities.set(code, act)
    res.status(201).json(teacherSnapshot(act))
  })

  app.get('/api/activities/:code/teacher', requireTeacher, loadActivity, (req, res) => {
    res.json(teacherSnapshot(req.act))
  })

  function loadQuestion(req, res, next) {
    const q = questionOf(req.act, req.params.qid)
    if (!q) return sendError(res, 404, 'QUESTION_NOT_FOUND', '找不到題目')
    req.q = q
    next()
  }

  const qBase = '/api/activities/:code/questions/:qid'

  app.post(`${qBase}/open`, requireTeacher, loadActivity, loadQuestion, (req, res) => {
    const { act, q } = req
    if (q.status === 'open') return sendError(res, 409, 'INVALID_STATE', '題目已在進行中')
    if (act.currentQuestionId) return sendError(res, 409, 'ANOTHER_QUESTION_OPEN', '已有題目進行中')
    if (q.status !== 'idle') return sendError(res, 409, 'INVALID_STATE', '題目已結束，請使用重開')
    q.status = 'open'
    act.currentQuestionId = q.id
    act.groupLocked = true
    bump(act)
    res.status(204).end()
  })

  app.post(`${qBase}/close`, requireTeacher, loadActivity, loadQuestion, (req, res) => {
    const { act, q } = req
    if (q.status !== 'open') return sendError(res, 409, 'INVALID_STATE', '題目不在進行中')
    q.status = 'closed'
    act.currentQuestionId = null
    bump(act)
    act.resultsVersion = act.version
    res.status(204).end()
  })

  app.post(`${qBase}/reopen`, requireTeacher, loadActivity, loadQuestion, (req, res) => {
    const { act, q } = req
    if (q.status !== 'closed') return sendError(res, 409, 'INVALID_STATE', '只能重開已結束的題目')
    if (act.currentQuestionId) return sendError(res, 409, 'ANOTHER_QUESTION_OPEN', '已有題目進行中')
    q.round += 1
    q.status = 'open'
    act.submissions.delete(q.id)
    for (const k of [...act.drafts.keys()]) if (k.startsWith(`${q.id}|`)) act.drafts.delete(k)
    act.currentQuestionId = q.id
    bump(act)
    act.resultsVersion = act.version
    res.status(204).end()
  })

  app.put('/api/activities/:code/groups/:gid/leader', requireTeacher, loadActivity, (req, res) => {
    const { act } = req
    const gid = req.params.gid
    const m = act.members.get(req.body?.clientId)
    if (!groupOf(act, gid) || !m || m.groupId !== gid) {
      return sendError(res, 400, 'NOT_A_MEMBER', '此成員不屬於該組')
    }
    act.leaderOverride[gid] = m.clientId
    bump(act)
    res.status(204).end()
  })

  function contentDisposition(name) {
    const ascii = name.replace(/[^\x20-\x7E]/g, '_')
    return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
  }

  /** 每一題已結束、目前輪次順位 1 的提交，依 blankId 對應到 cellRef */
  function sheetWritePlan(act) {
    const cells = []
    const skippedQuestions = []
    for (const q of act.questions) {
      const winner = q.status === 'closed' ? subsOf(act, q.id).find((s) => s.rank === 1) : null
      if (!winner) {
        skippedQuestions.push(q.number)
        continue
      }
      for (const b of q.blanks) {
        const a = winner.answers.find((x) => x.blankId === b.id)
        if (a) cells.push({ cellRef: b.cellRef, value: a.text })
      }
    }
    return { cells, skippedQuestions }
  }

  app.post('/api/activities/:code/export-to-sheet', requireTeacher, loadActivity, (req, res) => {
    const act = req.act
    if (act.writeMode === 'readonly') {
      return sendError(res, 403, 'SHEET_READ_ONLY', '試算表只有檢視權限', { shareWith: SHARE_WITH })
    }
    if (act.writeMode === 'changed') {
      return sendError(res, 409, 'SHEET_CHANGED', '試算表的題目結構已變更', {
        details: '第 3 題的作答格位置已改變',
      })
    }
    const basedOnVersion = req.body?.basedOnVersion
    if (!Number.isInteger(basedOnVersion) || act.resultsVersion > basedOnVersion) {
      return sendError(res, 409, 'STALE_VERSION', '結果已更新，請重新確認')
    }
    const { cells, skippedQuestions } = sheetWritePlan(act)
    if (cells.length === 0) return sendError(res, 409, 'NOTHING_TO_EXPORT', '目前沒有可寫回的結果')
    // 以下在同一個同步區塊中完成：任何錯誤都在這之前回傳，失敗時不會留下寫入紀錄
    const exportedAt = new Date().toISOString()
    const log = state.sheetWrites.get(act.code) ?? []
    log.push({ exportedAt, cells })
    state.sheetWrites.set(act.code, log)
    act.sheet.lastExportedAt = exportedAt
    bump(act)
    res.json({ sheetUrl: act.sheet.url, writtenCells: cells.length, skippedQuestions, exportedAt })
  })

  app.get('/api/activities/:code/export.csv', requireTeacher, loadActivity, (req, res) => {
    const act = req.act
    const esc = (v) => (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
    const lines = ['題號,組別,答案,搶答順位']
    for (const r of results(act)) {
      const q = questionOf(act, r.questionId)
      for (const s of r.submissions) {
        const text =
          s.answers.length > 1
            ? s.answers
                .map((a) => `${q.blanks.find((b) => b.id === a.blankId)?.label ?? ''}${a.text}`)
                .join('；')
            : s.answers[0]?.text ?? ''
        lines.push([q.number, groupOf(act, s.groupId).name, text, s.rank].map(esc).join(','))
      }
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', contentDisposition(`${act.code}_results.csv`))
    res.send('﻿' + lines.join('\r\n') + '\r\n')
  })

  // 學生
  app.post('/api/activities/:code/join', loadActivity, (req, res) => {
    const act = req.act
    const nickname = typeof req.body?.nickname === 'string' ? req.body.nickname.trim() : ''
    if (nickname.length < 1 || [...nickname].length > 20) {
      return sendError(res, 400, 'INVALID_NICKNAME', '請輸入 1 到 20 字的暱稱')
    }
    let clientId = cookies(req).client_id
    if (!clientId || !/^[a-f0-9]{24}$/.test(clientId)) {
      clientId = randomId(12)
      res.cookie('client_id', clientId, COOKIE_OPTS)
    }
    const existing = act.members.get(clientId)
    if (existing) existing.nickname = nickname
    else act.members.set(clientId, { clientId, nickname, groupId: null, groupJoinedSeq: 0, sockets: 0 })
    bump(act)
    res.json(studentSnapshot(act, clientId))
  })

  app.get('/api/activities/:code/student', loadActivity, loadMember, (req, res) => {
    res.json(studentSnapshot(req.act, req.member.clientId))
  })

  app.put('/api/activities/:code/me/group', loadActivity, loadMember, (req, res) => {
    const { act, member: m } = req
    const gid = req.body?.groupId
    if (!groupOf(act, gid)) return sendError(res, 400, 'INVALID_GROUP', '組別不存在')
    if (m.groupId !== gid) {
      if (act.groupLocked && m.groupId) return sendError(res, 409, 'GROUP_LOCKED', '搶答已開始，無法換組')
      if (m.groupId && act.leaderOverride[m.groupId] === m.clientId) delete act.leaderOverride[m.groupId]
      m.groupId = gid
      m.groupJoinedSeq = ++act.seq
      bump(act)
    }
    res.json(studentSnapshot(act, m.clientId))
  })

  app.post(`${qBase}/submissions`, loadActivity, loadMember, (req, res) => {
    const { act, member: m } = req
    const q = questionOf(act, req.params.qid)
    const { round, answers } = req.body ?? {}
    if (!q || q.status !== 'open') return sendError(res, 409, 'QUESTION_NOT_OPEN', '本題不在進行中')
    if (round !== q.round) return sendError(res, 409, 'STALE_ROUND', '本題已重開')
    if (!m.groupId || leaderId(act, m.groupId) !== m.clientId) {
      return sendError(res, 403, 'NOT_LEADER', '只有組長能送出')
    }
    if (subOf(act, q.id, m.groupId)) return sendError(res, 409, 'ALREADY_SUBMITTED', '本組已送出')
    if (
      !Array.isArray(answers) ||
      answers.length !== q.blanks.length ||
      !q.blanks.every((b) => answers.some((a) => a && a.blankId === b.id && typeof a.text === 'string'))
    ) {
      return sendError(res, 400, 'BLANKS_MISMATCH', '作答格數與題目不符')
    }
    const cleaned = q.blanks.map((b) => ({
      blankId: b.id,
      text: normalize(answers.find((a) => a.blankId === b.id).text),
    }))
    if (cleaned.some((a) => a.text.length === 0)) return sendError(res, 400, 'BLANK_ANSWER', '答案不可為空白')
    if (cleaned.some((a) => [...a.text].length > MAX_ANSWER_LENGTH)) {
      return sendError(res, 400, 'ANSWER_TOO_LONG', '答案不可超過 500 字')
    }
    const subs = subsOf(act, q.id)
    const submittedAt = new Date().toISOString()
    // Node 單執行緒：rank 在同一個同步區塊中計算並寫入，不會重複
    subs.push({ groupId: m.groupId, answers: cleaned, rank: subs.length + 1, submittedAt })
    act.submissions.set(q.id, subs)
    bump(act)
    res.status(201).json({ submittedAt })
  })

  // ---------- 測試鉤子 ----------

  if (testHooks) {
    const hooks = express.Router()
    hooks.post('/reset', (_req, res) => {
      for (const s of io.sockets.sockets.values()) s.disconnect(true)
      state = freshState()
      res.status(204).end()
    })
    hooks.post('/presence', (req, res) => {
      const { code, clientId, online } = req.body ?? {}
      const act = state.activities.get(code)
      const m = act?.members.get(clientId)
      if (!m) return sendError(res, 404, 'NOT_FOUND', 'member not found')
      m.forcedOnline = typeof online === 'boolean' ? online : null
      bump(act)
      res.status(204).end()
    })
    hooks.get('/sheetWrites', (req, res) => {
      const code = String(req.query.code ?? '').toUpperCase()
      res.json(state.sheetWrites.get(code) ?? [])
    })
    hooks.post('/forceError', (req, res) => {
      const { method, path, status, code, message, details, shareWith, times = 1 } = req.body ?? {}
      state.forced.push({ method, path, status, code, message, details, shareWith, times })
      res.status(204).end()
    })
    hooks.post('/skipVersions', (req, res) => {
      state.skip = Number(req.body?.count) || 0
      res.status(204).end()
    })
    hooks.post('/delaySnapshots', (req, res) => {
      state.delayMs = Number(req.body?.ms) || 0
      res.status(204).end()
    })
    hooks.post('/disconnect', (req, res) => {
      const { code, clientId, role, blockMs = 0 } = req.body ?? {}
      const targets = [...io.sockets.sockets.values()].filter(
        (s) =>
          (!code || s.data.code === code) &&
          (!clientId || s.data.clientId === clientId) &&
          (!role || s.data.role === role),
      )
      const key = clientId ?? role
      if (blockMs > 0 && key) state.blocked.set(key, Date.now() + blockMs)
      // 只關閉底層連線，用戶端會自動重連（模擬網路中斷）
      for (const s of targets) s.conn.close()
      res.json({ disconnected: targets.length })
    })
    hooks.post('/bump', (req, res) => {
      const act = state.activities.get(req.body?.code)
      if (!act) return sendError(res, 404, 'NOT_FOUND', 'activity not found')
      bump(act)
      res.status(204).end()
    })
    app.use('/__mock', hooks)
  }

  // ---------- Socket.IO ----------

  io.use((socket, next) => {
    const { code, role } = socket.handshake.query
    const act = state.activities.get(String(code ?? '').toUpperCase())
    if (!act) return next(new Error('ACTIVITY_NOT_FOUND'))
    const c = parseCookies(socket.handshake.headers.cookie)
    if (role === 'teacher') {
      if (!state.sessions.has(c.teacher_session)) return next(new Error('UNAUTHORIZED'))
      if ((state.blocked.get('teacher') ?? 0) > Date.now()) return next(new Error('BLOCKED'))
      socket.data = { code: act.code, role: 'teacher' }
      return next()
    }
    const m = act.members.get(c.client_id)
    if (!m) return next(new Error('NOT_JOINED'))
    if ((state.blocked.get(m.clientId) ?? 0) > Date.now()) return next(new Error('BLOCKED'))
    socket.data = { code: act.code, role: 'student', clientId: m.clientId }
    next()
  })

  io.on('connection', (socket) => {
    const act = state.activities.get(socket.data.code)
    const member = socket.data.role === 'student' ? act.members.get(socket.data.clientId) : null

    if (member) {
      member.sockets += 1
      if (member.sockets === 1) bump(act)
    }

    socket.on('snapshot:request', () => {
      const a = state.activities.get(socket.data.code)
      if (a) socket.emit('snapshot', snapshotFor(a, socket))
    })

    socket.on('draft:update', (p = {}) => {
      const a = state.activities.get(socket.data.code)
      const m = a?.members.get(socket.data.clientId)
      if (!a || !m) return socket.emit('error', { code: 'NOT_JOINED', message: '請先加入活動' })
      const q = currentQ(a)
      if (!q || q.id !== p.questionId) {
        return socket.emit('error', { code: 'QUESTION_NOT_OPEN', message: '本題不在進行中' })
      }
      if (p.round !== q.round) return socket.emit('error', { code: 'STALE_ROUND', message: '本題已重開' })
      if (!m.groupId) return socket.emit('error', { code: 'INVALID_GROUP', message: '尚未選組' })
      if (subOf(a, q.id, m.groupId)) {
        return socket.emit('error', { code: 'ALREADY_SUBMITTED', message: '本組已送出' })
      }
      if (!q.blanks.some((b) => b.id === p.blankId) || typeof p.text !== 'string') {
        return socket.emit('error', { code: 'BLANKS_MISMATCH', message: '作答格數與題目不符' })
      }
      const hadDrafts = draftsFor(a, q, m.groupId).length > 0
      const key = draftKey(q.id, q.round, m.groupId, p.blankId)
      const prev = a.drafts.get(key)
      const draft = {
        blankId: p.blankId,
        text: p.text.slice(0, 2000),
        rev: (prev?.rev ?? 0) + 1,
        by: { clientId: m.clientId, nickname: m.nickname },
      }
      a.drafts.set(key, draft) // 最後寫入者勝出
      for (const s of socketsOf(a.code)) {
        if (s.data.role !== 'student') continue
        if (a.members.get(s.data.clientId)?.groupId !== m.groupId) continue
        s.emit('draft:updated', { questionId: q.id, round: q.round, draft })
      }
      if (!hadDrafts) bump(a) // 老師端的狀態由「未作答」變為「編輯中」
    })

    socket.on('disconnect', () => {
      const a = state.activities.get(socket.data.code)
      const m = a?.members.get(socket.data.clientId)
      if (m) {
        m.sockets = Math.max(0, m.sockets - 1)
        if (m.sockets === 0) bump(a)
      }
    })
  })

  return {
    app,
    server,
    io,
    listen(port = 0) {
      return new Promise((resolve) => server.listen(port, () => resolve(server.address().port)))
    },
    close() {
      return new Promise((resolve) => {
        io.close()
        server.close(() => resolve())
      })
    },
  }
}
