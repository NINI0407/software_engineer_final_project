# 課堂搶答系統（前端 + 開發用 mock 後端）

用來取代「學生上台把 Guided Notes 答案寫在黑板上」的課堂搶答系統。本 repo 是**前端**與**開發用 mock 後端**；正式後端由其他組員負責，雙方依 `openspec/changes/build-quiz-buzzer-frontend/design.md` 的「前端介面約定 v0」溝通。

- 前端：Vite + Vue 3（`web/`）
- mock 後端：Express + Socket.IO，只存在記憶體（`mock/`）
- 測試：Vitest 單元測試、Playwright 端對端測試（`e2e/`）

> mock 不會真的解析或寫回 Excel，也不會依實際內容產生匯出檔；它依上傳檔名回傳固定的預覽資料，用來開發與測試前端。真正的 Guided Notes 解析、寫回與 CSV 產生由正式後端負責。

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
   - 老師：選「我是老師」，輸入 `.env` 中的教師密碼，上傳 `.xlsx`、設定組數並建立活動，看板上會顯示活動代號。
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

上傳時，mock 依**檔名**選擇預覽資料：

| 檔名 | 回應 |
|---|---|
| 含「題組」或 `group` | 4 題（第 1、2 題各有兩個子填空） |
| 含「變體」或 `variant` | 9 題，儲存格位置不同，附一則 warning（模擬另一份 Guided Notes） |
| 含 `invalid` | 422 `PARSE_FAILED` |
| 副檔名不是 `.xlsx` | 400 `NOT_XLSX` |
| 其他 `.xlsx` | 6 題單題 |

### 測試鉤子（只在 `MOCK_TEST_HOOKS=1` 時啟用）

未啟用時，所有 `/__mock/*` 都回應 404。

| 端點（POST，JSON） | 用途 |
|---|---|
| `/__mock/reset` | 清空所有活動、上傳、登入與連線 |
| `/__mock/presence` `{ code, clientId, online }` | 強制成員顯示為在線/離線（`online: null` 取消） |
| `/__mock/forceError` `{ method, path, status, code, times }` | 讓接下來符合的請求回傳指定錯誤 |
| `/__mock/skipVersions` `{ count }` | 下一次推送前跳過若干個版本號 |
| `/__mock/delaySnapshots` `{ ms }` | 延遲推送快照（`0` 取消） |
| `/__mock/disconnect` `{ code, clientId?, role?, blockMs? }` | 中斷指定的 Socket.IO 連線；`blockMs` 期間拒絕重連 |
| `/__mock/bump` `{ code }` | 讓版本號遞增並推送快照 |

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

## 專案結構

```
web/        Vite + Vue 3 前端
  src/api/    介面約定 v0 的型別、REST、Socket.IO
  src/store/  快照狀態、畫面狀態推導、即時連線
  src/lib/    輸入驗證、錯誤碼對照、草稿共編、組別 Cookie
  src/pages/  老師端與學生端頁面
mock/       開發用 mock 後端
e2e/        Playwright 測試
samples/    Guided Notes 範本（測試資料）
openspec/   規格文件（proposal、design、specs、tasks）
```
