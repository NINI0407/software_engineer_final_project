# 課堂搶答系統（前端 + 開發用 mock 後端）

用來取代「學生上台把 Guided Notes 答案寫在黑板上」的課堂搶答系統。本 repo 是**前端**與**開發用 mock 後端**；正式後端由其他組員負責，雙方依「前端介面約定」溝通：基礎是 `openspec/changes/archive/2026-11-17-build-quiz-buzzer-frontend/design.md` 的 v0，Google 試算表的匯入與寫回見 `openspec/changes/switch-to-online-google-sheets/design.md` 的 v1（G2）。

- 前端：Vite + Vue 3（`web/`）
- mock 後端：Express + Socket.IO，只存在記憶體（`mock/`）
- 測試：Vitest 單元測試、Playwright 端對端測試（`e2e/`）

Guided Notes 直接使用**線上 Google 試算表**：老師貼上試算表網址匯入，搶答結束後由後端把搶答成功的答案寫回原試算表的對應填空格。

> **憑證只在後端。** 呼叫 Google Sheets API、授權與金鑰都由正式後端負責。前端與 mock 都不需要、也不會讀取任何 Google 憑證；前端只會送出試算表網址，最多只會看到後端提供的「要共用給哪個 email」。不要在 `.env` 中新增任何 `VITE_GOOGLE_*` 變數（Vite 會把 `VITE_` 開頭的變數打包進瀏覽器端程式）。
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

### 接上真正的後端

把 `.env` 的 `BACKEND_URL` 改成後端位址（例如 `http://localhost:4000`），只執行 `npm run dev:web`。Vite 會把 `/api` 與 `/socket.io` 代理到該位址，前端程式不需要修改。

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
| `/__mock/presence` `{ code, clientId, online }` | 強制成員顯示為在線/離線（`online: null` 取消） |
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

單元測試（前端邏輯與 mock 後端）：

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

其他指令：

| 指令 | 用途 |
|---|---|
| `npm run typecheck` | 前端型別檢查（vue-tsc） |
| `npm run build` | 建置前端到 `dist/` |
| `npm run check:secrets` | 建置前端並掃描 `dist/`，確認沒有 Google 憑證、權杖或 `VITE_GOOGLE_` 變數 |

## 專案結構

```
web/        Vite + Vue 3 前端
  src/api/        介面約定 v1 的型別、REST、Socket.IO
  src/store/      快照狀態、畫面狀態推導（含寫回預覽）、即時連線
  src/lib/        輸入驗證、錯誤碼對照、草稿共編、組別 Cookie
  src/pages/      老師端與學生端頁面
  src/components/ 寫回試算表、共用對象 email
mock/       開發用 mock 後端（fixtures.js：依網址選擇的固定匯入結果）
e2e/        Playwright 測試
scripts/    check-no-secrets.mjs（建置產物的憑證掃描）
samples/    Guided Notes 範本（mock 固定資料的儲存格位置取自這兩份）
openspec/   規格文件（proposal、design、specs、tasks）
```
