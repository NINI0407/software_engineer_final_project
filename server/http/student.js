// 學生的 REST 路徑：加入、取得快照、選組、送出（spec quiz-backend）。
import express from 'express'
import { chooseGroup, joinActivity, requireMember, submitAnswer } from '../domain/activity.js'
import { studentSnapshot } from '../domain/snapshots.js'
import { COOKIE_OPTS, cookiesOf, loadActivity } from './common.js'

export function studentRoutes({ store }) {
  const r = express.Router()
  const withActivity = loadActivity(store)
  const clientIdOf = (req) => cookiesOf(req).client_id

  r.post('/activities/:code/join', withActivity, (req, res) => {
    const { clientId, isNew } = joinActivity(req.act, clientIdOf(req), req.body?.nickname)
    if (isNew) res.cookie('client_id', clientId, COOKIE_OPTS)
    res.json(studentSnapshot(req.act, clientId))
  })

  r.get('/activities/:code/student', withActivity, (req, res) => {
    const m = requireMember(req.act, clientIdOf(req))
    res.json(studentSnapshot(req.act, m.clientId))
  })

  r.put('/activities/:code/me/group', withActivity, (req, res) => {
    const m = requireMember(req.act, clientIdOf(req))
    chooseGroup(req.act, m.clientId, req.body?.groupId)
    res.json(studentSnapshot(req.act, m.clientId))
  })

  r.post('/activities/:code/questions/:qid/submissions', withActivity, (req, res) => {
    const m = requireMember(req.act, clientIdOf(req))
    const { round, answers } = req.body ?? {}
    const result = submitAnswer(req.act, m.clientId, req.params.qid, { round, answers })
    res.status(201).json({ submittedAt: result.submittedAt })
  })

  return r
}
