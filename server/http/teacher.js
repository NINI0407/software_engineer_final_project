// 老師的 REST 路徑：登入、登出、session、建立活動、題目控制、CSV（spec quiz-backend）。
import crypto from 'node:crypto'
import express from 'express'
import { AppError } from '../domain/errors.js'
import { closeQuestion, createActivity, openQuestion, reopenQuestion } from '../domain/activity.js'
import { teacherSnapshot } from '../domain/snapshots.js'
import { buildCsv } from '../domain/csv.js'
import { randomId } from '../domain/store.js'
import { COOKIE_OPTS, cookiesOf, isTeacher, loadActivity, requireTeacher } from './common.js'

const sha256 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest()

/** 兩邊先取 SHA-256 再比較，長度固定，避免依長度或內容洩漏時間差（design B6） */
export function passwordMatches(input, expected) {
  if (typeof input !== 'string') return false
  return crypto.timingSafeEqual(sha256(input), sha256(expected))
}

function contentDisposition(name) {
  const ascii = name.replace(/[^\x20-\x7E]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/**
 * @param {{ store: object, teacherPassword: string, onActivityCreated: (act: object) => void,
 *   onLogout?: (token: string) => void }} ctx
 */
export function teacherRoutes({ store, teacherPassword, onActivityCreated, onLogout = () => {} }) {
  const r = express.Router()
  const teacherOnly = requireTeacher(store)
  const withActivity = loadActivity(store)

  r.post('/teacher/login', (req, res, next) => {
    if (!passwordMatches(req.body?.password, teacherPassword)) {
      return next(new AppError(401, 'INVALID_PASSWORD', '密碼錯誤'))
    }
    const token = randomId(32)
    store.sessions.add(token)
    res.cookie('teacher_session', token, COOKIE_OPTS)
    res.status(204).end()
  })

  r.post('/teacher/logout', (req, res) => {
    const token = cookiesOf(req).teacher_session
    store.sessions.delete(token)
    onLogout(token)
    res.clearCookie('teacher_session', COOKIE_OPTS)
    res.status(204).end()
  })

  r.get('/teacher/session', (req, res) => {
    res.json({ authenticated: isTeacher(store, req) })
  })

  r.post('/activities', teacherOnly, (req, res) => {
    const { importId, groupCount } = req.body ?? {}
    // 檢查順序與 mock 相同：先檢查組數，再找匯入結果
    if (!Number.isInteger(groupCount) || groupCount < 2 || groupCount > 20) {
      throw new AppError(400, 'INVALID_GROUP_COUNT', '組數須為 2 到 20 的整數')
    }
    const imported = typeof importId === 'string' ? store.imports.get(importId) : undefined
    if (!imported) throw new AppError(404, 'IMPORT_NOT_FOUND', '找不到匯入結果，請重新匯入')
    const act = createActivity(store, imported, groupCount)
    onActivityCreated(act)
    res.status(201).json(teacherSnapshot(act))
  })

  r.get('/activities/:code/teacher', teacherOnly, withActivity, (req, res) => {
    res.json(teacherSnapshot(req.act))
  })

  const control = (fn) => (req, res) => {
    fn(req.act, req.params.qid)
    res.status(204).end()
  }
  const qBase = '/activities/:code/questions/:qid'
  r.post(`${qBase}/open`, teacherOnly, withActivity, control(openQuestion))
  r.post(`${qBase}/close`, teacherOnly, withActivity, control(closeQuestion))
  r.post(`${qBase}/reopen`, teacherOnly, withActivity, control(reopenQuestion))

  r.get('/activities/:code/export.csv', teacherOnly, withActivity, (req, res) => {
    const { fileName, content } = buildCsv(req.act)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', contentDisposition(fileName))
    res.send(content)
  })

  return r
}
