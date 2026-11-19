// HTTP 層共用的工具：Cookie、身分檢查、載入活動、錯誤處理（change build-quiz-backend，design B3、B6）。
import { AppError } from '../domain/errors.js'

/** Cookie 一律 httpOnly；只在 localhost 用 http 執行，所以不設 Secure（design B6） */
export const COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', path: '/' }

/** 解析 Cookie 標頭（HTTP 與 Socket.IO 握手共用） */
export function parseCookies(header = '') {
  const out = {}
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim()
    if (!k) continue
    const v = part.slice(i + 1).trim()
    try {
      out[k] = decodeURIComponent(v)
    } catch {
      out[k] = v
    }
  }
  return out
}

export const cookiesOf = (req) => parseCookies(req.headers.cookie)

/** 讓 async 路由的錯誤交給錯誤處理中介軟體（Express 4 不會自動處理 rejected promise） */
export const handle = (fn) => (req, res, next) => {
  Promise.resolve()
    .then(() => fn(req, res, next))
    .catch(next)
}

export function isTeacher(store, req) {
  const token = cookiesOf(req).teacher_session
  return typeof token === 'string' && store.sessions.has(token)
}

export const requireTeacher = (store) => (req, _res, next) => {
  if (!isTeacher(store, req)) return next(new AppError(401, 'UNAUTHORIZED', '請先登入'))
  next()
}

export const loadActivity = (store) => (req, _res, next) => {
  const act = store.activities.get(String(req.params.code ?? '').toUpperCase())
  if (!act) return next(new AppError(404, 'ACTIVITY_NOT_FOUND', '找不到此活動代號'))
  req.act = act
  next()
}

export function sendAppError(res, err) {
  res.status(err.status).json(err.toBody())
}

/** 最後的錯誤處理：AppError 依約定回應；JSON 格式錯誤回 400；其他回 500，不洩漏內部細節 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err instanceof AppError) return sendAppError(res, err)
  if (err?.type === 'entity.parse.failed') {
    return sendAppError(res, new AppError(400, 'INVALID_REQUEST', '請求內容不是有效的 JSON'))
  }
  if (err?.type === 'entity.too.large') {
    return sendAppError(res, new AppError(413, 'INVALID_REQUEST', '請求內容過大'))
  }
  // Google 的錯誤都已在 sheets/google.js 分類成 AppError，走到這裡的是程式本身的錯誤
  console.error('[server] 未預期的錯誤：', err?.stack ?? err)
  sendAppError(res, new AppError(500, 'INTERNAL_ERROR', '發生錯誤，請稍後再試'))
}
