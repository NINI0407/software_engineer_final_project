# Design

## Context

- 專案目前沒有程式碼，只有 OpenSpec 設定、作業說明 PDF，以及 `samples/` 裡的兩份 Guided Notes 範本（單題 6 題、題組 4 題）。動機與範圍見 proposal.md。
- 後端由其他組員開發，雙方目前還沒有介面約定，所以由前端起草「介面約定 v0」（本文件第 D8 節），交給後端確認。
- 只需要在本機執行，不需要部署，也不需要讓其他裝置連線。
- 範本分析結果（供 mock 預覽資料參考）：表頭為「題號／題目／作答」，題號是數值儲存格，作答欄是合併儲存格；題組用跨列合併的題號，加上「（n）」子填空標籤。

## Goals / Non-Goals

**Goals:**
- 前端完全依後端快照呈現，換成真正的後端時不需要修改前端程式。
- 介面約定清楚到後端可以照著實作，mock 也照同一份實作。
- 所有前端驗收情境都能用 Playwright 對 mock 自動化執行。

**Non-Goals:**
- 不實作或模擬正式後端的完整邏輯：mock 只求「行為符合約定」，不追求效能或持久化。
- 不支援行動裝置以外的特殊瀏覽器相容性，以目前版本的 Chromium、Firefox、Edge 為準。
- 不做多國語系，介面只有繁體中文。

## Decisions

### 前後端分界

```
+---------------------- 前端（本 change）---------------------+
|  畫面與流程、輸入驗證（第一道）、依快照重畫、               |
|  組別 Cookie（預選用）、草稿共編體驗、錯誤提示、上傳/下載觸發 |
+--------------------------+----------------------------------+
                           |  介面約定 v0：REST + Socket.IO
+--------------------------v----------------------------------+
|  後端（其他組員；開發期間由 mock 代替）                       |
|  密碼驗證、活動代號產生、狀態機、順位判定、可見性控管、       |
|  空白檢查（最後一道）、Excel 解析/寫回、CSV 產生、資料保存    |
+-------------------------------------------------------------+
```

### F1. 技術選型：Vite + Vue 3

- 前端使用 Vue 3（Composition API）與 `vue-router`。狀態管理使用自訂的 `reactive` store，不引入 Pinia，因為狀態只有「一份快照加上少量本機 UI 狀態」。
- Vite 開發伺服器（`:5173`）把 `/api` 和 `/socket.io`（含 WebSocket）代理到後端，代理目標由環境變數 `BACKEND_URL` 設定，預設 `http://localhost:3000`。前後端算同一個來源，Cookie 可以直接使用，不需要處理 CORS。
- 替代方案：
  - 原生 HTML/JS：依多個狀態切換畫面時，手動操作 DOM 容易出錯。
  - React：同樣可行，但團隊選擇 Vue，因為它的範本語法較直觀。

### F2. 組別 Cookie

- 選組成功後，前端寫入 `group_<代號>`：`path=/`、`SameSite=Lax`，不設 httpOnly，以便前端讀取。
- 這個 Cookie 只用來在重新整理後預選下拉選單。每次收到快照時，如果 `me.groupId` 和 Cookie 不一致，就用快照的值覆寫 Cookie。
- 身分（`client_id`）是後端發的 httpOnly Cookie，前端不讀也不寫。

### F3. 送出流程

```
按下送出
  -> 檢查連線、角色（me.isLeader）、題目狀態（快照）
  -> 每個子填空 normalize：去掉前後的 \s、U+3000、U+200B、U+200C、U+200D、U+FEFF
  -> 任何一格為空，或超過 500 字 -> 在該格顯示錯誤，結束
  -> 設定 submitting = true（鎖住按鈕；之後的點擊直接忽略）
  -> POST submissions { round, answers }（answers 內容使用 trim 後的文字）
  -> 201：submitting = false，等快照把 myGroup.submitted 變成 true
  -> 錯誤：submitting = false，依錯誤碼顯示提示（見 D8 的錯誤碼表）；
          遇到 403、409 時送出 snapshot:request
```

- 鎖定以同步變數實作：點擊處理函式一開始就檢查並設定 `submitting`，不依賴按鈕的 disabled 屬性重新渲染，所以連點只會發出一個請求。
- 驗證函式獨立成純函式，前端單元測試直接覆蓋各種空白字元。

### F4. 同組草稿共編

每個子填空在本機保存 `{ value, dirty, composing, lastSentRev }`：

- **輸入時**：`dirty = true`，並重設 300ms 的 debounce 計時。IME 組字期間（`compositionstart` 到 `compositionend`）不送出，避免中文輸入法打到一半就被同步出去。
- **debounce 到期**：送出 `draft:update { questionId, round, blankId, text, baseRev }`。
- **收到 `draft:updated`**：
  - 本人送出的回音：如果送出後沒有新的本機修改，`dirty = false`，`value` 改為廣播的版本。
  - 其他人的更新：只在 `dirty === false` 且 `composing === false` 時才套用到 `value`；否則先保存為 `pendingRemote`，等本機修改送出後，以後端最新的版本為準。
- **衝突**：後端以收到的順序廣播，最後寫入者勝出。前端不做合併。
- **編輯提示**：收到他人的 `draft:updated` 後，在該格旁顯示「〈暱稱〉正在編輯」3 秒。
- 替代方案：用 CRDT 或 OT 做到逐字合併。對短答案而言成本過高，因此不採用。

### F5. 連線狀態與重新同步

- 使用單一 Socket.IO 連線，啟用自動重連。斷線時把 `connected` 設為 false：頂部顯示「重新連線中」，所有會改變狀態的操作都停用。
- 觸發 `snapshot:request` 的時機：
  - 每次 `connect` 或重新連線成功
  - 收到的快照 `version` 比目前大超過 1
  - 收到的 `draft:updated` 的 `questionId` 或 `round` 和目前快照不一致
  - REST 回應 403 或 409

### F6. 不保存也不洩漏他組資料

- 學生端只保存快照與草稿事件中屬於本人的資料，不寫入 localStorage 或 sessionStorage（組別 Cookie 除外）。
- 正式建置時移除 debug 用的 console 輸出；store 不掛到 `window` 上。
- 真正的控管在後端，前端的責任是「沒收到就不顯示，收到也只顯示自己的」。

### F7. mock 後端

- 使用 Express、Socket.IO、`multer`（處理上傳）、`cookie-parser`，狀態只存在記憶體，位置在 `mock/`。
- 解析預覽採用內建的固定資料，依上傳檔名選擇（見 `mock-backend` spec）。匯出回傳附有 `Content-Disposition` 檔名的佔位檔案。
- 測試鉤子 `/__mock/*` 只在 `MOCK_TEST_HOOKS=1` 時啟用，提供以下功能：
  - `reset`：重設狀態
  - `presence`：讓成員離線或上線
  - `forceError`：讓下一個指定請求回傳指定錯誤
  - `skipVersions`：跳過若干版本號後推送快照
  - `delaySnapshots`：延遲推送快照
  - `disconnect`：中斷指定連線
- 教師密碼從 `TEACHER_PASSWORD` 讀取；沒有設定時隨機產生，只印在終端機。

### D8. 前端介面約定 v0（v0 草案，待後端確認）

#### 共通約定

- 所有 REST 路徑都在 `/api` 底下，使用 JSON；上傳使用 multipart。
- 錯誤一律回傳 `{ "error": { "code": "<CODE>", "message": "<給人看的文字>" } }`。前端依 `code` 決定提示文字，`message` 只是備用。
- 身分：
  - `teacher_session`（老師）和 `client_id`（學生）都是後端發的 httpOnly Cookie。
  - `group_<代號>` 由前端寫入，只用於預選。
- `version`：每個活動有一個遞增的整數。**每次 `version` 遞增時，後端都要對活動中所有連線各推送一次快照（內容依角色過濾）**，所以正常情況下前端看到的版本號是連續的；出現跳號就代表漏收，需要重新同步。草稿事件不會讓 `version` 遞增。
- `round`：每題從 1 開始，每重開一次就加 1。送出答案和更新草稿時都要附上 `round`，後端拒絕不是目前輪次的請求。

#### 資料型別

```ts
type QuestionStatus = "idle" | "open" | "closed";

interface Blank    { id: string; label: string | null }       // 題組子填空 "（1）"；單題為 null
interface Question { id: string; number: number; blanks: Blank[]; status: QuestionStatus; round: number }
interface Group    { id: string; name: string }                // "第 1 組"
interface Member   { clientId: string; nickname: string; online: boolean; isLeader: boolean }

interface Answer     { blankId: string; text: string }
interface Submission { groupId: string; answers: Answer[]; rank: number; submittedAt: string }  // ISO 8601
interface Result     { questionId: string; round: number; submissions: Submission[]; winnerGroupId: string | null }

interface Draft { blankId: string; text: string; rev: number; by: { clientId: string; nickname: string } }
```

#### 快照

```ts
interface StudentSnapshot {
  version: number;
  activity: { code: string; groups: Group[] };
  questions: Question[];                 // 不含儲存格位置
  currentQuestionId: string | null;
  groupLocked: boolean;                  // 第一題開始後為 true
  me: { clientId: string; nickname: string; groupId: string | null; isLeader: boolean };
  myGroup: null | {
    members: Member[];
    drafts: Draft[];                     // 只有目前進行中題目、目前輪次的草稿
    submitted: boolean;                  // 本組在目前進行中題目、目前輪次是否已送出
  };
  results: Result[];                     // 只包含 status = closed 的題目；依 rank 排序
}

interface TeacherSnapshot {
  version: number;
  activity: { code: string; groups: Group[] };
  questions: (Question & { blanks: (Blank & { cellRef: string })[] })[];  // 例如 "學習單!G5"
  currentQuestionId: string | null;
  groupLocked: boolean;
  groups: {
    group: Group;
    members: Member[];
    current: null | {
      status: "idle" | "editing" | "submitted";
      submission: Submission | null;
    };
  }[];
  results: Result[];
}
```

#### REST：老師

| 方法 | 路徑 | 請求內容 | 成功 | 錯誤 |
|---|---|---|---|---|
| POST | `/api/teacher/login` | `{ password }` | 204，並設定 `teacher_session` | 401 `INVALID_PASSWORD` |
| POST | `/api/teacher/logout` | – | 204 | – |
| GET | `/api/teacher/session` | – | 200 `{ authenticated }` | – |
| POST | `/api/uploads` | multipart 欄位 `file` | 200 `{ uploadId, fileName, questions: [{ number, blanks: [{ label, cellRef }] }], warnings: string[] }` | 400 `NOT_XLSX`、422 `PARSE_FAILED`（附 `details: string`）、401 |
| POST | `/api/activities` | `{ uploadId, groupCount }` | 201 `TeacherSnapshot` | 400 `INVALID_GROUP_COUNT`、404 `UPLOAD_NOT_FOUND`、401 |
| GET | `/api/activities/:code/teacher` | – | 200 `TeacherSnapshot` | 401、404 `ACTIVITY_NOT_FOUND` |
| POST | `/api/activities/:code/questions/:qid/open` | – | 204 | 409 `ANOTHER_QUESTION_OPEN`、409 `INVALID_STATE`、401 |
| POST | `/api/activities/:code/questions/:qid/close` | – | 204 | 409 `INVALID_STATE`、401 |
| POST | `/api/activities/:code/questions/:qid/reopen` | – | 204 | 409 `ANOTHER_QUESTION_OPEN`、409 `INVALID_STATE`、401 |
| PUT | `/api/activities/:code/groups/:gid/leader` | `{ clientId }` | 204 | 400 `NOT_A_MEMBER`、401 |
| GET | `/api/activities/:code/export.xlsx` | – | 200 檔案（Content-Disposition） | 401 |
| GET | `/api/activities/:code/export.csv` | – | 200 檔案（Content-Disposition） | 401 |

#### REST：學生

| 方法 | 路徑 | 請求內容 | 成功 | 錯誤 |
|---|---|---|---|---|
| POST | `/api/activities/:code/join` | `{ nickname }` | 200 `StudentSnapshot`，並設定 `client_id` | 404 `ACTIVITY_NOT_FOUND`、400 `INVALID_NICKNAME` |
| GET | `/api/activities/:code/student` | – | 200 `StudentSnapshot` | 401 `NOT_JOINED`、404 |
| PUT | `/api/activities/:code/me/group` | `{ groupId }` | 200 `StudentSnapshot` | 409 `GROUP_LOCKED`、400 `INVALID_GROUP` |
| POST | `/api/activities/:code/questions/:qid/submissions` | `{ round, answers: Answer[] }` | 201 `{ submittedAt }`（**不含順位**） | 403 `NOT_LEADER`；409 `QUESTION_NOT_OPEN`、`STALE_ROUND`、`ALREADY_SUBMITTED`；400 `BLANK_ANSWER`、`ANSWER_TOO_LONG`、`BLANKS_MISMATCH` |

#### 錯誤碼與前端提示

| code | 提示 | 前端額外動作 |
|---|---|---|
| `INVALID_PASSWORD` | 密碼錯誤 | 清空密碼欄 |
| `NOT_XLSX` | 請上傳 .xlsx 檔 | – |
| `PARSE_FAILED` | 解析失敗：〈details〉 | 停用建立活動 |
| `INVALID_GROUP_COUNT` | 組數不合法 | – |
| `ANOTHER_QUESTION_OPEN` | 已有題目進行中 | `snapshot:request` |
| `INVALID_STATE` | 題目狀態已變更 | `snapshot:request` |
| `ACTIVITY_NOT_FOUND` | 找不到此活動代號 | – |
| `GROUP_LOCKED` | 搶答已開始，無法換組 | 下拉選單與 Cookie 恢復成快照的值 |
| `NOT_LEADER` | 只有組長能送出 | `snapshot:request` |
| `QUESTION_NOT_OPEN` / `STALE_ROUND` | 本題已結束或已重開 | `snapshot:request` |
| `ALREADY_SUBMITTED` | 本組已送出 | `snapshot:request` |
| `BLANK_ANSWER` | 答案不可為空白 | – |
| `ANSWER_TOO_LONG` | 答案不可超過 500 字 | – |
| 其他或網路錯誤 | 發生錯誤，請稍後再試 | – |

#### Socket.IO 事件

連線方式：`io({ query: { code, role: "student" | "teacher" } })`，身分由後端從 Cookie 判斷。

| 方向 | 事件 | 內容 | 說明 |
|---|---|---|---|
| 後端 → 前端 | `snapshot` | `StudentSnapshot` 或 `TeacherSnapshot` | 每次 `version` 遞增時推送給所有連線 |
| 後端 → 前端 | `draft:updated` | `{ questionId, round, draft: Draft }` | 只推給同組成員（是否推給老師待確認） |
| 後端 → 前端 | `error` | `{ code, message }` | WebSocket 操作失敗時 |
| 前端 → 後端 | `snapshot:request` | `{}` | 後端以 `snapshot` 事件回覆 |
| 前端 → 後端 | `draft:update` | `{ questionId, round, blankId, text, baseRev }` | 只有題目進行中且本組尚未送出時有效 |

#### 送出搶答的時序

```
組長A(第1組)    組長B(第2組)      後端                    老師           第1組組員
   | POST submit    |               |                       |                 |
   |--------------->|               |                       |                 |
   |                | POST submit   |                       |                 |
   |                |-------------->| 依接收順序：           |                 |
   |                |               | 第1組=1，第2組=2       |                 |
   |<-- 201 ------------------------|                       |                 |
   |                |<-- 201 -------|                       |                 |
   |                |               |-- snapshot(v+1) ----->| 看到兩組與順位   |
   |<-- snapshot(v+1)：submitted=true，沒有順位 --------------------------------->|
   |                |               |                       |                 |
   |   老師按下「結束」 -> snapshot(v+2)：results 含本題，所有人都看得到順位   |
```

#### 待後端確認

1. 送出成功時不回傳順位給學生（避免學生推知已有幾組送出）。
2. 用 `round` 拒絕重開前延遲送達的請求。
3. 階段變化一律推送完整快照，不另外提供個別的狀態事件。
4. `client_id` 由後端在 join 時發放（httpOnly）。
5. 確定使用 Socket.IO，而不是原生 WebSocket。
6. 老師是否也收到 `draft:updated`（目前預設不收，老師只看到「編輯中」）。
7. 答案長度上限 500 字；組名格式「第 N 組」由後端決定。
8. 上傳後先回傳預覽（`uploadId`），老師確認後才建立活動的兩階段流程。

### D9. 前端狀態管理

```
            REST 回傳快照 / socket "snapshot"
                         |
                         v
   version <= 目前值？ --是--> 忽略
                         | 否
                         v
   store.snapshot = 新快照（整份替換）
   version 跳號？ --是--> 送出 snapshot:request
                         |
                         v
   computed：viewState = f(snapshot, me)   <- 所有畫面只讀取 computed 的結果
                         |
                         v
                     Vue 重畫
```

- store 分成兩部分：
  - `snapshot`：唯讀，只由上述流程替換。
  - `ui`：本機 UI 狀態，包括 `connected`、`submitting`、各子填空的草稿編輯狀態、錯誤訊息、正在編輯的提示。
- REST 的成功回應只清除 `submitting` 或處理中狀態；`join` 和換組的回應本身就是快照，同樣走上述流程。
- 題目從進行中變成其他狀態，或 `round` 改變時，清除本機草稿編輯狀態。

### D10. 學生畫面狀態對應表

`viewState` 依下表決定，由上往下第一個符合的規則生效：

| # | 條件 | 畫面 | 輸入框 | 送出鈕 | 顯示 |
|---|---|---|---|---|---|
| 1 | `me.groupId == null` | 選組 | – | – | 組別下拉選單（`groupLocked` 時仍可第一次選組） |
| 2 | 有進行中題目，且 `myGroup.submitted` | 已送出 | 唯讀（顯示本組草稿的最後版本） | 隱藏 | 「已送出，等待老師結束本題」，不顯示順位 |
| 3 | 有進行中題目，且 `me.isLeader` | 作答 | 可編輯 | 全部有效時才可用 | 正在編輯的提示 |
| 4 | 有進行中題目，不是組長 | 作答 | 可編輯 | 停用 | 「只有組長能送出」與正在編輯的提示 |
| 5 | 沒有進行中題目，且最近結束的題目有結果 | 結果 | – | – | 該題各組答案、順位、搶答成功組；可切換查看其他已結束題目 |
| 6 | 沒有進行中題目，也沒有任何結果 | 等待 | – | – | 本組成員與組長；`groupLocked` 為 false 時可換組 |

- 「最近結束的題目」以快照中最後一個 `closed` 題目的結果為準。前端可以在本機記錄結束順序；如果無法判斷，就以題號最大的已結束題目為準。
- 斷線時，所有可編輯的元素一律停用（F5）。

### D11. 老師端按鈕可用性

| 按鈕 | 可用條件（依快照） |
|---|---|
| 開始（第 n 題） | 該題 `idle`，且 `currentQuestionId == null` |
| 結束（第 n 題） | 該題 `open` |
| 重開（第 n 題） | 該題 `closed`，且 `currentQuestionId == null` |
| 下一題 | `currentQuestionId == null`，且存在 `idle` 題目；按下後開始題號最小的 `idle` 題目 |
| 設為組長 | 目標是該組成員，且目前不是組長 |
| 匯出 Excel / 下載 CSV | 隨時可用（沒有結果時，由後端決定檔案內容） |

上述條件只控制按鈕是否可用，是否允許操作一律由後端判斷；所有按鈕在斷線或處理中時都停用。

### D12. 頁面路由

| 路徑 | 說明 | 進入條件 |
|---|---|---|
| `/` | 選擇身分：「我是老師」或「我是學生」 | – |
| `/teacher/login` | 教師登入 | – |
| `/teacher/new` | 上傳、預覽、設定組數、建立活動 | 已登入，否則導向登入頁 |
| `/teacher/board/:code` | 題目看板 | 已登入，否則導向登入頁 |
| `/join` | 輸入活動代號與暱稱（可用 `?code=` 預填） | – |
| `/play/:code` | 學生流程，依 D10 在選組、等待、作答、已送出、結果之間切換 | 已加入；否則導向 `/join?code=:code` |

### D13. 專案結構與指令

```
/web        Vite + Vue 3 前端（src/pages, src/components, src/store, src/api, src/lib/validate.ts）
/mock       mock 後端（Express + Socket.IO）
/e2e        Playwright 測試
/samples    Guided Notes 範本（測試資料）
.env.example
```

- 根目錄只有一個 `package.json`，提供以下指令：
  - `npm run dev`：同時啟動 mock 與 Vite
  - `npm run dev:web` / `npm run dev:mock`：分別啟動
  - `npm test`：Vitest 單元測試
  - `npm run test:e2e`：啟動 mock（含 `MOCK_TEST_HOOKS=1`）與 Vite，再執行 Playwright
- Playwright 用多個獨立的 browser context 模擬老師與學生，每個 context 有自己的 Cookie。

### D14. 機敏資訊處理

- 前端程式與建置產物中不含任何密碼、金鑰或 token。登入密碼只在送出請求時存在於表單狀態，送出後立即清空。
- mock 從 `.env` 讀取 `TEACHER_PASSWORD`、`PORT`、`MOCK_TEST_HOOKS`。`.env` 列入 `.gitignore`，repo 只提交 `.env.example`，其中的密碼欄位為 `TEACHER_PASSWORD=change-me`。
- 測試的教師密碼由測試啟動腳本在執行時隨機產生，並以環境變數傳給 mock 和 Playwright，不寫入任何檔案。

## Risks / Trade-offs

- **[介面約定 v0 尚未經後端確認]**：如果後端改動欄位或事件，前端和 mock 都要跟著改。
  → 所有 REST 和 Socket 呼叫集中在 `web/src/api`，型別集中定義在一個檔案；後端確認後以 `openspec-update-change` 更新本 change。
- **[mock 和真正後端的行為有落差]**：測試對 mock 通過，不代表對真正的後端也會通過。
  → spec 中標示「需後端」的情境，在接上真正的後端後重新執行同一套 Playwright 測試。
- **[`version` 跳號偵測依賴後端「每次遞增都推送給所有連線」]**：如果後端只推送給相關的人，學生會經常看到跳號，並多送出 `snapshot:request`。
  → 重新同步是冪等且成本很低的操作，即使多送也只是浪費一點流量；這個前提也已寫進約定。
- **[草稿採最後寫入者勝出]**：兩人同時編輯同一格時，較早送出的人的內容會被覆蓋。
  → 顯示「正在編輯」提示讓組員協調。短答案的衝突機率低，所以接受這個取捨。
- **[同一個瀏覽器的分頁共用 Cookie]**：手動測試時，同一瀏覽器的多個分頁會被視為同一位學生。
  → README 說明手動測試要用不同的瀏覽器或無痕視窗；自動化測試使用獨立的 browser context。
- **[「約一秒內同步」在測試中可能不穩定]**：CI 或較慢的機器可能逾時。
  → Playwright 斷言的逾時設為 2 秒，正常應在 1 秒內完成；mock 不加入人為延遲（除非測試明確要求）。
