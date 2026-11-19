# Tasks

## 1. 專案設定

- [x] 1.1 安裝 `@googleapis/sheets`；在 `package.json` 新增 `dev:server`（`node --watch server/index.js`）、`start:server`（`node server/index.js`）與 `test:server-e2e`（`playwright test -c playwright.server.config.ts`）；`vitest.config.ts` 的 `include` 加入 `server/**/*.test.js`。執行 `npm install` 與 `npm test`，確認既有測試仍全部通過
- [x] 1.2 建立 design B3 的目錄結構（`server/domain`、`server/http`、`server/realtime`、`server/sheets`、`server/testing`）與 `server/domain/errors.js` 的 `AppError(status, code, message, extra)`；`.env.example` 加入 `SERVER_PORT=4000` 與 `GOOGLE_SERVICE_ACCOUNT_KEY_FILE=`（空值與說明註解）；`.gitignore` 加入 `secrets/`、`*service-account*.json`、`*-key.json`。確認 `git status` 中沒有任何金鑰檔，`.env.example` 只有佔位值

## 2. 試算表網址與題目解析器（純函式）

- [x] 2.1 實作 `server/sheets/url.js` 的 `parseSheetUrl`：接受 `https://docs.google.com/spreadsheets/d/<id>` 開頭（忽略前後空白），取出 `#gid=` 或 `?gid=`，回傳正規化網址；其他輸入丟出 400 `INVALID_SHEET_URL`。在 `server/sheets/url.test.js` 驗證一般網址、帶 `gid`、`?gid=`、非 Google 網址與空字串
- [x] 2.2 在 `server/sheets/fixtures/` 依 `samples/` 兩份範本轉寫 Grid 資料（值與合併範圍，檔頭註明來源），並寫出變形版面：整體平移、表頭上方有說明列、多工作表（第一個是說明頁）、題號寫法（`1`、`1.0`、`1.`、`第 1 題`）、重複題號、不連續題號、作答格已有內容、標籤右邊沒有作答格、沒有表頭。確認每份資料都能被 2.3 的測試載入
- [x] 2.3 實作 `server/sheets/parser.js`，依 design S3 找表頭、題目、子填空並產生 `cellRef`、`warnings` 與 `PARSE_FAILED` 的 `details`，以及外層的工作表選擇（有 `gid` 只解析該工作表，找不到回 `WORKSHEET_NOT_FOUND`；沒有 `gid` 取第一個有表頭的工作表）。在 `server/sheets/parser.test.js` 涵蓋 spec `google-sheets-sync` 中「選擇工作表」「動態找出題目表頭」「辨識題目與題號」「辨識作答格與題組子填空」的每個 Scenario，並驗證單題範本得到 `學習單!G5`…`G15`、題組範本得到 `H5`、`H6`、`H8`、`H9`、`G11`、`G13`，與 `mock/fixtures.js` 一致

## 3. 活動規則（domain）

- [x] 3.1 實作 `server/domain/store.js`（sessions、imports、activities、6 字元活動代號、ID 產生）與 `server/domain/activity.js` 的建立活動、選組與組別鎖定、題目狀態機與 `round`、`commit(act)`（組長判定 → `version` 加 1 → 通知推送，design B4）、`resultsVersion`。在 `server/domain/activity.test.js` 驗證 spec `quiz-backend`「建立活動」「選組與組別鎖定」「題目狀態與輪次」的 Scenario，以及每次狀態改變 `version` 恰好加 1
- [x] 3.2 在 `activity.js` 實作在線計數與組長遞補（L1 規則），涵蓋上線、離線、換組、全組離線、多分頁。在 `activity.test.js` 驗證「依在線狀態遞補組長」的每個 Scenario
- [x] 3.3 在 `activity.js` 實作送出驗證（依 spec 的檢查順序；trim 的字元集與 mock 相同）、依接收順序給順位、重開時清除提交與草稿，以及草稿（最後寫入者勝出、`rev`、第一筆草稿才 `commit`）。在 `activity.test.js` 驗證「送出答案的驗證」「依接收順序給順位」「同組草稿」的 Scenario
- [x] 3.4 實作 `server/domain/snapshots.js`（學生與老師快照、`results`）與 `server/domain/csv.js`。在 `snapshots.test.js` 驗證「快照的可見性」的每個 Scenario（學生快照沒有他組資料、沒有 `sheet` 與 `cellRef`），在 `csv.test.js` 驗證「CSV 匯出」的表頭、排序、題組串接、逗號與雙引號跳脫、BOM

## 4. HTTP 與 Socket.IO（整合測試用 fake-sheets）

- [x] 4.1 實作 `server/testing/fake-sheets.js`：以 2.2 的 Grid 資料模擬試算表，提供 `read` 與 `writeCells`，記錄寫入內容，可以指定某次呼叫失敗（狀態碼）、延遲回應，以及在建立活動後修改 Grid（插入列、刪除或改名工作表）。另外建立整合測試輔助函式 `server/testing/testkit.js`（啟動 `createServer`、老師登入、學生加入、Socket.IO 連線）。用一個冒煙測試確認可以啟動並關閉伺服器
- [x] 4.2 實作 `server/app.js` 的 `createServer({ teacherPassword, sheets })` 與 `server/http/teacher.js`、`server/http/student.js`：登入（SHA-256 加 `timingSafeEqual`）、登出、session、建立活動、題目控制、CSV、加入、取得快照、選組、送出；`AppError` 轉成約定的錯誤格式；已移除的路徑與 `/__mock/*` 回應 404。在 `server/app.test.js` 移植 `mock/server.test.js` 中「3.1 到 3.3」不依賴測試鉤子的情境，並涵蓋「依介面約定回應」「教師密碼驗證」「學生加入與身分」「不提供測試鉤子」的 Scenario
- [x] 4.3 實作 `server/realtime/socket.js`：連線驗證（活動、老師 session、學生 `client_id`）、在線計數接到 3.2、`snapshot:request`、`draft:update` 與 `error` 事件、`commit` 時依角色推送快照。在 `server/realtime.test.js` 用 `socket.io-client` 移植 mock 的「3.4 Socket.IO」情境，並驗證「快照推送與版本」「Socket.IO 連線驗證」，以及組長遞補的情境用真實連線的建立與中斷觸發
- [x] 4.4 實作 `server/http/sheets.js` 的 `POST /api/sheets/import`（`parseSheetUrl` → `sheets.read` → parser → 保存匯入結果，design S4）。在 `server/sheets-import.test.js` 用 fake-sheets 驗證匯入成功的回應欄位、單題與題組預覽、`warnings`，以及 `INVALID_SHEET_URL`、`WORKSHEET_NOT_FOUND`、`PARSE_FAILED`，並確認建立活動後老師快照的 `sheet` 正確、學生快照沒有任何試算表資訊

## 5. Google 用戶端與寫回

- [x] 5.1 實作 `server/sheets/google.js` 的 `GoogleSheetsClient`：讀取金鑰取得 `client_email`，用 `spreadsheets.get`（design S2 的欄位遮罩）轉成 Grid，`writeCells` 用 `values.batchUpdate` 加 `RAW`，請求逾時 10 秒；依 design S6 把錯誤分類成匯入、寫回讀取、寫回寫入三種情境的錯誤碼；記錄只含狀態與錯誤代碼。另外實作未設定金鑰時的停用用戶端（一律 503 `SHEETS_UNAVAILABLE`）。在 `server/sheets/google.test.js` 用模擬的 Google 錯誤物件驗證 S6 表格的每一格，並驗證錯誤回應中沒有原始錯誤內容
- [x] 5.2 實作 `server/sheets/export.js` 與 `POST /api/activities/:code/export-to-sheet`，依 design S5 的順序：寫回鎖、`STALE_VERSION`、寫入計畫與 `NOTHING_TO_EXPORT`、重新讀取並依 `sheetId` 比對、批次寫入、成功時更新 `lastExportedAt` 並 `commit`、`finally` 解鎖。在 `server/sheets-export.test.js` 用 fake-sheets 涵蓋 spec `google-sheets-sync` 中「寫回的內容」「答案以純文字寫入」「確認後結果變動」「寫回前比對試算表結構」「單一批次寫入與寫回錯誤」「同一活動同時只有一個寫回」「寫回成功」的每個 Scenario，並驗證任何失敗都沒有寫入紀錄、`lastExportedAt` 不變
- [x] 5.3 在 `server/sheets-import.test.js` 補上匯入時的 Google 錯誤：fake-sheets 回 403 時得到 `SHEET_NOT_SHARED` 與 `shareWith`、404 得到 `SHEET_NOT_FOUND`、逾時或 5xx 得到 `SHEETS_UNAVAILABLE`、停用用戶端得到 `SHEETS_UNAVAILABLE`。執行 `npm test`，確認全部通過

## 6. 進入點、憑證與文件

- [x] 6.1 實作 `server/index.js`：讀 `.env`，`TEACHER_PASSWORD` 未設定時隨機產生並只印在終端機；`SERVER_PORT` 預設 4000；有 `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` 且可讀時建立 `GoogleSheetsClient`，否則印出「未設定 Google 憑證，匯入與寫回將無法使用」並改用停用用戶端。在 `server/index.test.js` 以子程序啟動，驗證未設定密碼時印出的密碼可以登入、未設定金鑰時仍能啟動且匯入回應 503，且輸出中沒有金鑰內容
- [x] 6.2 擴充 `scripts/check-no-secrets.mjs`：除了原本掃描 `dist/`，再掃描 `git ls-files` 列出的檔案，找到 `"private_key"` 或 `-----BEGIN PRIVATE KEY-----` 就失敗（排除這支腳本本身與 spec 文件中的說明文字）。執行 `npm run check:secrets` 確認通過；暫時加入一個含假私鑰標記的被追蹤檔案，確認腳本會失敗，再移除
- [x] 6.3 更新 `README.md`：把「正式後端由其他組員負責」改成實際狀況；新增「正式後端」一節：建立 service account 與金鑰、金鑰放在 repo 外並設定 `GOOGLE_SERVICE_ACCOUNT_KEY_FILE`、把試算表共用給 service account（匯入需檢視者，寫回需編輯者）、上傳的 .xlsx 要先另存為 Google 試算表、`npm run dev:server` 與把 `BACKEND_URL` 改成 `http://localhost:4000`、狀態只存在記憶體的提醒、環境變數表與專案結構。照 README 的步驟從零啟動一次，確認指令都能照寫的方式執行
- [x] 6.4 更新 `openspec/config.yaml` 的 `context`：專案描述改為「前端、開發用 mock 與正式後端」，技術堆疊加入 `server/`（Express、Socket.IO、`@googleapis/sheets`，純 JavaScript）、測試加入 `test:server-e2e`、安全加入「Google 金鑰只放在 repo 外，由 `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` 指定」。執行 `openspec validate build-quiz-backend --strict` 確認仍然通過

## 7. 端對端與整合驗證

- [x] 7.1 實作 `server/testing/e2e-entry.js`（`createServer` 加 fake-sheets，載入單題與題組 Grid）與 `playwright.server.config.ts`（後端 :4100、前端 :5175、隨機教師密碼），在 `e2e-server/full-flow.spec.ts` 用 1 位老師與 2 組學生（各自獨立的 browser context）跑完整流程：登入、匯入、建立活動、選組、開始、兩組送出、結束、學生看到順位、寫回成功顯示「已寫入」、下載 CSV。執行 `npm run test:server-e2e`，確認通過
- [x] 7.2 執行 `npm run typecheck`、`npm test`、`npm run test:e2e`（mock）、`npm run test:server-e2e`、`npm run build`、`npm run check:secrets`，確認全部通過，並確認 `web/` 與 `mock/` 沒有任何修改（`git diff --stat -- web mock` 為空）
- [x] 7.3 用真實 Google 試算表人工驗證（需要使用者提供 service account 金鑰與測試試算表）：複製單題與題組範本，再自製一份變形版面（表頭位置不同、多一個說明工作表）。逐項確認：三份都能匯入且 `cellRef` 正確；未共用時顯示 `shareWith`；只有檢視權限時可以匯入但寫回顯示 `SHEET_READ_ONLY`，試算表沒有被修改；寫回後答案出現在正確的格子，`=1+1` 與 `007` 以純文字顯示；建立活動後插入一列再寫回得到 `SHEET_CHANGED` 且沒有格子被修改；工作表改名後仍能寫回。把結果記錄在本 change 的 design.md（B7 的「實作後記錄」）

## Workflow follow-up

- 把「寫回時結構不符就一格都不寫」「依接收順序給順位」「組長依在線狀態遞補」等後端行為告知 SpecKit 組，確認兩邊的系統功能一致。
- 完成人工驗證與 Demo 錄製後，執行 `/opsx:archive` 封存本 change，並確認 `quiz-backend` 與 `google-sheets-sync` 兩份主 spec 已建立。
