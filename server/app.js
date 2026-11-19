// 正式後端：組裝 HTTP 與 Socket.IO（change build-quiz-backend，design B3）。
// 試算表用戶端由參數注入：正式啟動用 GoogleSheetsClient，測試用 fake-sheets，
// 所以正式程式中沒有任何測試開關或 /__mock 鉤子（spec「不提供測試鉤子」）。
import http from 'node:http'
import express from 'express'
import { Server } from 'socket.io'
import { AppError } from './domain/errors.js'
import { createStore } from './domain/store.js'
import { attachRealtime } from './realtime/socket.js'
import { errorHandler } from './http/common.js'
import { teacherRoutes } from './http/teacher.js'
import { studentRoutes } from './http/student.js'
import { sheetsRoutes } from './http/sheets.js'

/**
 * @param {{ teacherPassword: string, sheets: { read: Function, writeCells: Function, shareWith: string|null } }} options
 */
export function createServer({ teacherPassword, sheets } = {}) {
  if (!teacherPassword) throw new Error('teacherPassword is required')
  if (!sheets) throw new Error('sheets client is required')

  const app = express()
  app.disable('x-powered-by')
  const server = http.createServer(app)
  const io = new Server(server)
  const store = createStore()
  const realtime = attachRealtime(io, store)

  // 每個新活動的狀態改變（commit）都推送快照給該活動的所有連線（design B4）
  const onActivityCreated = (act) => {
    act.onCommit = realtime.push
  }

  app.use(express.json({ limit: '1mb' }))
  // 登出時一併中斷使用該 session 的 Socket.IO 連線（spec「教師密碼驗證」的「登出」）
  app.use('/api', teacherRoutes({ store, teacherPassword, onActivityCreated, onLogout: realtime.disconnectSession }))
  app.use('/api', studentRoutes({ store }))
  app.use('/api', sheetsRoutes({ store, sheets }))
  // 約定中不存在（或已移除）的 /api 路徑一律 404
  app.use('/api', (_req, _res, next) => next(new AppError(404, 'NOT_FOUND', '找不到這個路徑')))
  app.use(errorHandler)

  return {
    app,
    server,
    io,
    store,
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
