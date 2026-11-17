import type {
  Answer,
  ApiError,
  StudentSnapshot,
  TeacherSnapshot,
  UploadPreview,
} from './types'

export class RestError extends Error implements ApiError {
  status: number
  code: string
  details?: string
  constructor(e: ApiError) {
    super(e.message)
    this.status = e.status
    this.code = e.code
    this.details = e.details
  }
}

/** 可在測試中替換的 fetch */
let fetchImpl: typeof fetch = (...args) => fetch(...args)
export function setFetch(f: typeof fetch) {
  fetchImpl = f
}

const enc = encodeURIComponent

/**
 * 發出請求並統一錯誤格式：
 * - 2xx：回傳 JSON（204 回傳 undefined）
 * - 非 2xx：丟出 RestError { status, code, message }
 * - 網路錯誤：丟出 RestError { status: 0, code: 'NETWORK_ERROR' }
 */
export async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: {} }
  if (body instanceof FormData) {
    init.body = body
  } else if (body !== undefined) {
    ;(init.headers as Record<string, string>)['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  let res: Response
  try {
    res = await fetchImpl(url, init)
  } catch {
    throw new RestError({ status: 0, code: 'NETWORK_ERROR', message: '無法連線到伺服器' })
  }
  if (res.ok) {
    if (res.status === 204) return undefined as T
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }
  let code = 'UNKNOWN_ERROR'
  let message = `HTTP ${res.status}`
  let details: string | undefined
  try {
    const data = await res.json()
    if (data && data.error && typeof data.error.code === 'string') {
      code = data.error.code
      message = data.error.message ?? message
      details = data.error.details
    }
  } catch {
    // 非 JSON 錯誤內容：保留預設值
  }
  throw new RestError({ status: res.status, code, message, details })
}

export const api = {
  // 老師
  login: (password: string) => request<void>('POST', '/api/teacher/login', { password }),
  logout: () => request<void>('POST', '/api/teacher/logout'),
  session: () => request<{ authenticated: boolean }>('GET', '/api/teacher/session'),
  upload: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return request<UploadPreview>('POST', '/api/uploads', fd)
  },
  createActivity: (uploadId: string, groupCount: number) =>
    request<TeacherSnapshot>('POST', '/api/activities', { uploadId, groupCount }),
  teacherSnapshot: (code: string) =>
    request<TeacherSnapshot>('GET', `/api/activities/${enc(code)}/teacher`),
  openQuestion: (code: string, qid: string) =>
    request<void>('POST', `/api/activities/${enc(code)}/questions/${enc(qid)}/open`),
  closeQuestion: (code: string, qid: string) =>
    request<void>('POST', `/api/activities/${enc(code)}/questions/${enc(qid)}/close`),
  reopenQuestion: (code: string, qid: string) =>
    request<void>('POST', `/api/activities/${enc(code)}/questions/${enc(qid)}/reopen`),
  setLeader: (code: string, groupId: string, clientId: string) =>
    request<void>('PUT', `/api/activities/${enc(code)}/groups/${enc(groupId)}/leader`, { clientId }),
  exportXlsxUrl: (code: string) => `/api/activities/${enc(code)}/export.xlsx`,
  exportCsvUrl: (code: string) => `/api/activities/${enc(code)}/export.csv`,

  // 學生
  join: (code: string, nickname: string) =>
    request<StudentSnapshot>('POST', `/api/activities/${enc(code)}/join`, { nickname }),
  studentSnapshot: (code: string) =>
    request<StudentSnapshot>('GET', `/api/activities/${enc(code)}/student`),
  setGroup: (code: string, groupId: string) =>
    request<StudentSnapshot>('PUT', `/api/activities/${enc(code)}/me/group`, { groupId }),
  submit: (code: string, qid: string, round: number, answers: Answer[]) =>
    request<{ submittedAt: string }>(
      'POST',
      `/api/activities/${enc(code)}/questions/${enc(qid)}/submissions`,
      { round, answers },
    ),
}
