/**
 * 前端介面約定 v0（v0 草案，待後端確認）
 * 來源：openspec/changes/build-quiz-buzzer-frontend/design.md（D8）
 * 所有與後端交換的資料型別都集中在本檔，後端約定若有修改只需更新這裡與 rest.ts / socket.ts。
 */

export type QuestionStatus = 'idle' | 'open' | 'closed'

export interface Blank {
  id: string
  /** 題組子填空標籤，例如「（1）」；單題為 null */
  label: string | null
}

export interface Question {
  id: string
  number: number
  blanks: Blank[]
  status: QuestionStatus
  round: number
}

export interface Group {
  id: string
  name: string
}

export interface Member {
  clientId: string
  nickname: string
  online: boolean
  /**
   * 是否為現任組長。組長由後端依在線狀態決定：組長離線時立即遞補給在線且加入順序最早的組員，
   * 不會自動還回；每組最多一位，全組離線時可以沒有（change auto-promote-leader-on-offline）。
   */
  isLeader: boolean
}

export interface Answer {
  blankId: string
  text: string
}

export interface Submission {
  groupId: string
  answers: Answer[]
  rank: number
  /** ISO 8601 */
  submittedAt: string
}

export interface Result {
  questionId: string
  round: number
  /** 依 rank 排序 */
  submissions: Submission[]
  winnerGroupId: string | null
}

export interface Draft {
  blankId: string
  text: string
  rev: number
  by: { clientId: string; nickname: string }
}

export interface ActivityInfo {
  code: string
  groups: Group[]
}

export interface StudentSnapshot {
  version: number
  activity: ActivityInfo
  questions: Question[]
  currentQuestionId: string | null
  groupLocked: boolean
  /** `isLeader` 以這份快照為準；斷線或重新整理後可能已遞補給其他組員 */
  me: { clientId: string; nickname: string; groupId: string | null; isLeader: boolean }
  myGroup: null | {
    members: Member[]
    drafts: Draft[]
    submitted: boolean
  }
  results: Result[]
}

export interface TeacherBlank extends Blank {
  cellRef: string
}

export interface TeacherQuestion extends Omit<Question, 'blanks'> {
  blanks: TeacherBlank[]
}

export type GroupAnswerStatus = 'idle' | 'editing' | 'submitted'

export interface TeacherGroupState {
  group: Group
  members: Member[]
  current: null | {
    status: GroupAnswerStatus
    submission: Submission | null
  }
}

export interface TeacherSnapshot {
  version: number
  activity: ActivityInfo
  questions: TeacherQuestion[]
  currentQuestionId: string | null
  groupLocked: boolean
  groups: TeacherGroupState[]
  results: Result[]
  /** 活動綁定的線上試算表；只出現在老師快照，學生快照沒有 */
  sheet: SheetInfo
}

export interface SheetInfo {
  spreadsheetTitle: string
  worksheetTitle: string
  url: string
  /** ISO 8601；尚未寫回時為 null */
  lastExportedAt: string | null
}

export type Snapshot = StudentSnapshot | TeacherSnapshot

/** POST /api/sheets/import 的回應 */
export interface SheetImportPreview {
  importId: string
  sheetUrl: string
  spreadsheetTitle: string
  worksheetTitle: string
  questions: { number: number; blanks: { label: string | null; cellRef: string }[] }[]
  warnings: string[]
}

/** POST /api/activities/:code/export-to-sheet 的回應 */
export interface ExportToSheetResult {
  sheetUrl: string
  writtenCells: number
  /** 沒有寫入的題號（未結束、無人作答） */
  skippedQuestions: number[]
  /** ISO 8601 */
  exportedAt: string
}

/** 後端錯誤回應格式 */
export interface ErrorBody {
  error: { code: string; message: string; details?: string; shareWith?: string }
}

/** 前端統一使用的錯誤物件 */
export interface ApiError {
  status: number
  code: string
  message: string
  details?: string
  /** 需要老師調整共用設定時，要共用給誰的 email（公開資訊，不是憑證） */
  shareWith?: string
}

/** Socket.IO 事件內容 */
export interface DraftUpdatedEvent {
  questionId: string
  round: number
  draft: Draft
}

export interface DraftUpdatePayload {
  questionId: string
  round: number
  blankId: string
  text: string
  baseRev: number
}
