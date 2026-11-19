# 課堂搶答系統

用來取代「學生上台把 Guided Notes 答案寫在黑板上」的課堂搶答系統。本 repo 包含**前端**、**正式後端**與**開發用 mock 後端**，三者依同一份「介面約定」實作：基礎是 `openspec/changes/archive/2026-11-17-build-quiz-buzzer-frontend/design.md` 的 v0，Google 試算表的匯入與寫回見 `openspec/changes/archive/2026-11-18-switch-to-online-google-sheets/design.md` 的 v1（G2），組長遞補的規則與介面差異見 `openspec/changes/archive/2026-11-18-auto-promote-leader-on-offline/design.md` 的 L4。正式後端的設計見 `openspec/changes/archive/2026-11-19-build-quiz-backend/design.md`。

- 前端：Vite + Vue 3（`web/`）
- 正式後端：Express + Socket.IO，用 Google service account 讀寫試算表，狀態只存在記憶體（`server/`）
- mock 後端：Express + Socket.IO，不連 Google，只用固定資料模擬（`mock/`），用於前端開發與 e2e 測試
- 測試：Vitest 單元與整合測試、Playwright 端對端測試（`e2e/` 對 mock，`e2e-server/` 對正式後端）

Guided Notes 直接使用**線上 Google 試算表**：老師貼上試算表網址匯入，搶答結束後由後端把搶答成功的答案寫回原試算表的對應填空格。

> **憑證只在後端。** 呼叫 Google Sheets API、授權與金鑰都由正式後端（`server/`）負責，設定方式見下方「正式後端」。前端與 mock 都不需要、也不會讀取任何 Google 憑證；前端只會送出試算表網址，最多只會看到後端提供的「要共用給哪個 email」。不要在 `.env` 中新增任何 `VITE_GOOGLE_*` 變數（Vite 會把 `VITE_` 開頭的變數打包進瀏覽器端程式）。
>
> mock 不會真的連到 Google：它依網址中的關鍵字回傳固定的預覽資料，寫回時只在記憶體中記錄「會寫到哪些儲存格」，用來開發與測試前端。

## 本機啟動

需求：Node.js 20 以上（開發時使用 Node 24）。

1. 複製環境設定檔，並把 `TEACHER_PASSWORD` 改成你自己的密碼：

   ```bash
   cp .env.example .env
   ```

   `.env` 已列入 `.gitignore`，**不要提交**。如果把 `TEACHER_PASSWORD` 留空，mock 每次啟動時會隨機產生一組密碼，並只印在終端機。

2. 安裝套件：

   ```bash
   npm install
   ```

3. 同時啟動 mock 後端（`http://localhost:3000`）與前端開發伺服器（`http://localhost:5173`）：

   ```bash
   npm run dev
   ```

   也可以分開啟動：`npm run dev:mock`、`npm run dev:web`。

4. 用瀏覽器開啟 <http://localhost:5173>：
   - 老師：選「我是老師」，輸入 `.env` 中的教師密碼，貼上 Google 試算表網址並按「匯入」（用 mock 時可貼 `https://docs.google.com/spreadsheets/d/mock-group/edit`，其他測試網址見下方對照表），確認預覽後設定組數並建立活動，看板上會顯示活動代號。題目結束後，在看板按「寫回試算表」，確認要寫入的組別、答案與儲存格後送出。
   - 學生：選「我是學生」，輸入活動代號與暱稱，再選擇組別。

### 手動測試多位學生

同一個瀏覽器的分頁共用 Cookie，會被視為**同一位學生**。手動模擬多位學生時，請使用不同的瀏覽器、不同的瀏覽器設定檔或無痕視窗，或分別用 `http://localhost:5173` 與 `http://127.0.0.1:5173` 開啟（兩者的 Cookie 互相獨立）。

### 接上正式後端

見下方「正式後端」。簡單說：把 `.env` 的 `BACKEND_URL` 改成 `http://localhost:4000`，分別執行 `npm run dev:server` 與 `npm run dev:web`。Vite 會把 `/api` 與 `/socket.io` 代理到該位址，前端程式不需要修改。

## 正式後端（`server/`）

正式後端照介面約定實作所有規則，並用 Google **service account** 直接讀寫老師的線上 Guided Notes。題目位置一律動態解析：後端在工作表中找同一列有「題號」與「作答」表頭的位置，再依題號欄與合併儲存格找出每題（含題組的「（1）」「（2）」子填空）的作答格，不寫死任何儲存格。

### 1. 建立 service account 與金鑰（只需做一次）

1. 到 Google Cloud Console 建立（或選擇）一個專案，啟用 **Google Sheets API**。
2. 在「IAM 與管理 → 服務帳戶」建立一個服務帳戶，不需要指派任何專案角色。
3. 在該服務帳戶的「金鑰」分頁新增一把 JSON 金鑰並下載。
4. **把金鑰檔放在 repo 以外**，例如 `C:\Users\<你>\.secrets\quiz-buzzer-key.json`。不要放進專案資料夾，也不要提交（`.gitignore` 雖然排除了 `secrets/`、`*service-account*.json`、`*-key.json`，但那只是保險）。
5. 在 `.env` 設定金鑰路徑：

   ```bash
   GOOGLE_SERVICE_ACCOUNT_KEY_FILE=C:/Users/<你>/.secrets/quiz-buzzer-key.json
   ```

啟動後端時，終端機會印出服務帳戶的 email（`...@...iam.gserviceaccount.com`）。

### 2. 共用試算表給服務帳戶

- 老師的 Guided Notes 必須是 **Google 試算表格式**。如果是上傳到雲端硬碟的 `.xlsx`，請先在 Google 試算表中「檔案 → 另存為 Google 試算表」，否則匯入會顯示解析失敗。
- 在試算表按「共用」，把服務帳戶的 email 加進去：
  - **檢視者**：可以匯入題目，但寫回時會顯示「試算表只有檢視權限」。
  - **編輯者**：可以匯入與寫回（上課使用請設為編輯者）。
- 沒有共用時，匯入頁會顯示要共用給哪個 email，並提供複製按鈕。

### 3. 啟動

```bash
npm run dev:server   # 正式後端：http://localhost:4000（修改程式時自動重新啟動）
npm run dev:web      # 前端：http://localhost:5173（.env 的 BACKEND_URL 要設為 http://localhost:4000）
```

不需要自動重新啟動時，可以用 `npm run start:server`。沒有設定 `TEACHER_PASSWORD` 時，後端每次啟動會隨機產生一組密碼並只印在終端機；沒有設定金鑰時，後端仍會啟動，但匯入與寫回會顯示「Google 服務暫時無法連線」。

| 環境變數 | 說明 | 預設 |
|---|---|---|
| `TEACHER_PASSWORD` | 教師密碼（與 mock 共用同一個變數） | 未設定時隨機產生 |
| `SERVER_PORT` | 正式後端的連接埠（和 mock 的 `PORT` 分開，兩者可以同時執行） | `4000` |
| `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` | repo 以外的服務帳戶金鑰檔路徑 | 未設定時停用試算表功能 |

### 4. 上課時的注意事項

- **狀態只存在記憶體。** 後端重新啟動後，活動、匯入結果與作答都會消失。上課期間不要重新啟動後端；活動結束時先「寫回試算表」並「下載 CSV」。
- 寫回時，後端會先重新讀取試算表並逐題比對作答格的位置。建立活動後如果在試算表中插入或刪除列，讓作答格移動，寫回會顯示「試算表的題目結構已變更」，而且一格都不會寫；工作表只是改名不影響寫回。
- 答案一律以純文字寫入：`=1+1` 會原樣顯示，不會被當成公式；`007` 不會變成 `7`。
- 目標格子已有內容時會被覆寫，可以用 Google 試算表的「版本記錄」還原。

## 組長規則

每組同時最多一位組長，只有組長能送出答案。組長完全由後端依成員的在線狀態決定，老師**不能**手動指定或轉移組長；前端只照快照的 `isLeader` 顯示。

- **在線**：至少有一個分頁連著 Socket.IO。同一個瀏覽器的分頁算同一位學生，要全部關掉才算離線。
- **離線立即遞補**：組長離線時，立刻由同組「在線且加入順序最早」的組員接任，不設等待秒數。
- **不會自動還回**：原組長或加入順序更早的人重新上線，仍維持現任組長。組長只在現任組長離線或換組時更換。
- **全組離線時沒有組長**：看板在該組顯示「目前無組長」；之後第一位上線的成員成為組長。
- **換組**：第一題開始前可以換組；組長換組時，原組依上面的規則遞補，他在新組沒有組長時成為新組的組長。
- **重新整理不保證恢復組長**：學生重新整理後會以同一個 `client_id` 恢復暱稱、組別與作答狀態，但重新整理期間連線會中斷；同組有其他在線組員時，組長會遞補給對方。
- **異常斷線的偵測時間**：關閉分頁或重新整理會立即被偵測；網路中斷、手機休眠這類異常斷線，要等 Socket.IO 心跳逾時（預設約 20 到 45 秒）才會被視為離線並遞補。這是傳輸層的偵測延遲，不是規則上的等待；正式後端可以自行調整心跳設定。

## mock 後端設定

| 環境變數 | 說明 | 預設 |
|---|---|---|
| `TEACHER_PASSWORD` | 教師密碼；留空時啟動時隨機產生並印在終端機 | 無 |
| `PORT` | mock 的連接埠 | `3000` |
| `MOCK_TEST_HOOKS` | 設為 `1` 才啟用 `/__mock` 測試鉤子 | `0` |
| `BACKEND_URL` | Vite 代理目標（給前端用） | `http://localhost:3000` |

這裡**沒有任何 Google 相關的環境變數**，`.env.example` 也不會有：前端與 mock 都不需要 Google 憑證。正式後端的 Google 金鑰放在後端自己的 `.env`，變數名稱由後端決定。

匯入時，mock 先檢查網址是否為 `https://docs.google.com/spreadsheets/d/<id>`（不符合時回 400 `INVALID_SHEET_URL`），再依 `<id>` 中的**關鍵字**（不分大小寫，由上往下先符合的優先）決定結果：

| `<id>` 含 | 匯入 | 寫回 |
|---|---|---|
| `notshared` | 403 `SHEET_NOT_SHARED`（附 `shareWith`） | – |
| `missing` | 404 `SHEET_NOT_FOUND` | – |
| `noworksheet` | 422 `WORKSHEET_NOT_FOUND` | – |
| `invalid` | 422 `PARSE_FAILED` | – |
| `readonly` | 6 題單題 | 403 `SHEET_READ_ONLY`（附 `shareWith`） |
| `changed` | 6 題單題 | 409 `SHEET_CHANGED` |
| `variant` | 9 題，儲存格位置不同，附一則 warning（模擬另一份 Guided Notes） | 正常 |
| `group` | 4 題（第 1、2 題各有兩個子填空） | 正常 |
| 其他 | 6 題單題 | 正常 |

例如 `https://docs.google.com/spreadsheets/d/mock-readonly/edit`。寫回時，mock 取每一題已結束、最後一輪順位 1 的答案，依建立活動時的儲存格位置記錄下來；目標格子一律覆寫。

### 測試鉤子（只在 `MOCK_TEST_HOOKS=1` 時啟用）

未啟用時，所有 `/__mock/*` 都回應 404。

| 端點（POST，JSON） | 用途 |
|---|---|
| `/__mock/reset` | 清空所有活動、匯入結果、寫入紀錄、登入與連線 |
| `/__mock/presence` `{ code, clientId, online }` | 強制成員為在線/離線（`online: null` 取消，改回依實際連線判斷）；和真的上下線一樣會觸發組長遞補 |
| `/__mock/forceError` `{ method, path, status, code, details?, shareWith?, times }` | 讓接下來符合的請求回傳指定錯誤（也可用在匯入與寫回，例如 502 `SHEET_WRITE_FAILED`） |
| `/__mock/skipVersions` `{ count }` | 下一次推送前跳過若干個版本號 |
| `/__mock/delaySnapshots` `{ ms }` | 延遲推送快照（`0` 取消） |
| `/__mock/disconnect` `{ code, clientId?, role?, blockMs? }` | 中斷指定的 Socket.IO 連線；`blockMs` 期間拒絕重連 |
| `/__mock/bump` `{ code }` | 讓版本號遞增並推送快照 |
| `GET /__mock/sheetWrites?code=<活動代號>` | 讀取該活動的模擬寫入紀錄：`[{ exportedAt, cells: [{ cellRef, value }] }]` |

例如在 bash / Git Bash 中（密碼改用你自己的值）：

```bash
MOCK_TEST_HOOKS=1 TEACHER_PASSWORD='<你的密碼>' npm run dev:mock
```

```bash
curl -X POST http://localhost:3000/__mock/reset
```

## 測試

單元與整合測試（前端邏輯、mock 後端、正式後端）。正式後端的測試用 `server/testing/fake-sheets.js` 代替 Google，不需要網路或金鑰：

```bash
npm test
```

端對端測試（Playwright）。第一次執行前先安裝瀏覽器：

```bash
npx playwright install chromium
```

```bash
npm run test:e2e
```

`test:e2e` 會自動啟動一組獨立的 mock（`:3100`，`MOCK_TEST_HOOKS=1`）與前端（`:5174`），教師密碼在執行時隨機產生並以環境變數傳遞，不會寫入任何檔案。每個測試開始前都會呼叫 `/__mock/reset`。測試產物（失敗截圖）寫到系統暫存資料夾的 `quiz-buzzer-test-results/`；需要逐步除錯時可加上 `--trace on`：

```bash
npx playwright test e2e/student.spec.ts --trace on
```

正式後端的端對端測試：

```bash
npm run test:server-e2e
```

`test:server-e2e` 會用測試專用的進入點 `server/testing/e2e-entry.js` 啟動正式後端（`:4100`，試算表換成 fake-sheets）與前端（`:5175`），跑一次不依賴 `/__mock` 鉤子的完整流程（`e2e-server/`）。真正連到 Google 試算表的部分需要人工驗證。

其他指令：

| 指令 | 用途 |
|---|---|
| `npm run typecheck` | 前端型別檢查（vue-tsc） |
| `npm run build` | 建置前端到 `dist/` |
| `npm run check:secrets` | 建置前端並掃描 `dist/`，確認沒有 Google 憑證、權杖或 `VITE_GOOGLE_` 變數；也掃描 repo 中會被提交的檔案，確認沒有服務帳戶私鑰 |

## 專案結構

```
web/        Vite + Vue 3 前端
  src/api/        介面約定 v1 的型別、REST、Socket.IO
  src/store/      快照狀態、畫面狀態推導（含寫回預覽）、即時連線
  src/lib/        輸入驗證、錯誤碼對照、草稿共編、組別 Cookie
  src/pages/      老師端與學生端頁面
  src/components/ 寫回試算表、共用對象 email
server/     正式後端
  domain/         活動規則、快照、CSV（不依賴 HTTP 與 Socket.IO）
  http/           REST 路徑
  realtime/       Socket.IO：連線驗證、在線狀態、草稿、快照推送
  sheets/         網址解析、題目解析器、Google 用戶端、寫回流程
  testing/        測試專用：fake-sheets、整合測試工具、e2e 進入點
mock/       開發用 mock 後端（fixtures.js：依網址選擇的固定匯入結果）
e2e/        Playwright 測試（對 mock）
e2e-server/ Playwright 測試（對正式後端）
scripts/    check-no-secrets.mjs（建置產物與 repo 的憑證掃描）
samples/    Guided Notes 範本（mock 固定資料與正式後端解析器測試資料都取自這兩份）
openspec/   規格文件（proposal、design、specs、tasks）
```
