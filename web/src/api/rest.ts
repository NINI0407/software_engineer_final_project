import type {
  Answer,
  ApiError,
  ExportToSheetResult,
  SheetImportPreview,
  StudentSnapshot,
  TeacherSnapshot,
} from './types'

export class RestError extends Error implements ApiError {
  status: number
  code: string
  details?: string
  shareWith?: string
  constructor(e: ApiError) {
    super(e.message)
    this.status = e.status
    this.code = e.code
    this.details = e.details
    this.shareWith = e.shareWith
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
 * - 非 2xx：丟出 RestError { status, code, message, details?, shareWith? }
 * - 網路錯誤：丟出 RestError { status: 0, code: 'NETWORK_ERROR' }
 */
export async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: {} }
  if (body !== undefined) {
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
  let shareWith: string | undefined
  try {
    const data = await res.json()
    if (data && data.error && typeof data.error.code === 'string') {
      code = data.error.code
      message = data.error.message ?? message
      if (typeof data.error.details === 'string') details = data.error.details
      if (typeof data.error.shareWith === 'string') shareWith = data.error.shareWith
    }
  } catch {
    // 非 JSON 錯誤內容：保留預設值
  }
  throw new RestError({ status: res.status, code, message, details, shareWith })
}

export const api = {
  // 老師
  login: (password: string) => request<void>('POST', '/api/teacher/login', { password }),
  logout: () => request<void>('POST', '/api/teacher/logout'),
  session: () => request<{ authenticated: boolean }>('GET', '/api/teacher/session'),
  // 試算表的讀寫都由後端完成：前端只送網址，不接觸任何 Google 憑證
  importSheet: (sheetUrl: string) =>
    request<SheetImportPreview>('POST', '/api/sheets/import', { sheetUrl }),
  createActivity: (importId: string, groupCount: number) =>
    request<TeacherSnapshot>('POST', '/api/activities', { importId, groupCount }),
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
  exportToSheet: (code: string, basedOnVersion: number) =>
    request<ExportToSheetResult>('POST', `/api/activities/${enc(code)}/export-to-sheet`, {
      basedOnVersion,
    }),
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
