# Tasks

## 1. 專案骨架

- [ ] 1.1 建立根目錄 `package.json`，以及 `web/`、`mock/`、`e2e/` 目錄（結構見 design D13）；安裝 `vue`、`vue-router`、`vite`、`@vitejs/plugin-vue`、`socket.io-client`、`express`、`socket.io`、`multer`、`cookie-parser`、`dotenv`、`vitest`、`@playwright/test`、`concurrently`。驗證：`npm install` 成功，`npx vite --version` 與 `npx playwright --version` 都有輸出
- [ ] 1.2 建立 `.gitignore`（含 `node_modules/`、`dist/`、`.env`、`test-results/`、`playwright-report/`），以及只含佔位值的 `.env.example`（`TEACHER_PASSWORD=change-me`、`PORT=3000`、`MOCK_TEST_HOOKS=0`、`BACKEND_URL=http://localhost:3000`）。驗證：`git check-ignore .env` 有輸出，且 `.env.example` 沒有真實密碼
- [ ] 1.3 設定 `web/vite.config`：代理 `/api` 與 `/socket.io`（含 `ws: true`），代理目標讀取 `BACKEND_URL`；設定 `npm run dev`、`dev:web`、`dev:mock` 指令。驗證：`npm run dev:web` 後開啟 `http://localhost:5173` 看到 Vue 預設頁
- [ ] 1.4 撰寫 README 的「本機啟動」章節：需求（Node 版本）、複製 `.env.example` 為 `.env`、`npm install`、`npm run dev`、開啟網址；並說明手動測試多位學生時要用不同的瀏覽器或無痕視窗。驗證：在乾淨的 clone 中照 README 操作，可以開啟首頁

## 2. 共用型別、API 層與輸入驗證

- [ ] 2.1 在 `web/src/api/types.ts` 定義介面約定 v0 的所有型別（Question、Blank、Snapshot、Result、Draft、錯誤格式等），並在檔案開頭註明「v0 草案，待後端確認」。驗證：`npx vue-tsc --noEmit`（或 `tsc`）沒有型別錯誤
- [ ] 2.2 在 `web/src/api/rest.ts` 實作所有 REST 呼叫，並統一把錯誤轉成 `{ status, code, message }`。驗證：Vitest 以模擬的 fetch 測試成功回應、`{error:{code}}` 回應、網路錯誤三種情況都能正確轉換
- [ ] 2.3 在 `web/src/lib/errors.ts` 建立錯誤碼到提示文字與額外動作的對照表（design D8 錯誤碼表）。驗證：Vitest 確認表中每個 code 都有對應的提示，未知的 code 使用預設訊息
- [ ] 2.4 在 `web/src/lib/validate.ts` 實作 normalize 與送出驗證（半形空白、Tab、換行、U+3000、U+200B、U+200C、U+200D、U+FEFF；題組每格必填；500 字上限）。驗證：Vitest 涵蓋 student-participation spec「送出前檢查空白與長度」的每個情境，並確認 trim 後的文字正確

## 3. mock 後端

- [ ] 3.1 建立 `mock/server` 的 Express + Socket.IO 骨架，從 `.env` 讀取設定；沒有設定 `TEACHER_PASSWORD` 時隨機產生並印在終端機。驗證：不設密碼啟動時，終端機印出密碼，且可以用它呼叫 `POST /api/teacher/login` 得到 204
- [ ] 3.2 實作老師的 REST（login、logout、session、uploads、activities、open、close、reopen、leader、export）。uploads 依檔名回傳內建的預覽資料（單題 6 題、題組 4 題、變體 9 題；`invalid` 回 422；非 .xlsx 回 400）；export 回傳附 `Content-Disposition` 的佔位檔。驗證：Vitest 以真實 HTTP 呼叫 mock，逐一檢查成功回應與 design D8 表中的每個錯誤碼
- [ ] 3.3 實作學生的 REST（join、student、me/group、submissions），包含組長判定、換組鎖定、`round`、一次送出、空白與長度檢查、依接收順序給順位，以及不回傳順位。驗證：Vitest 涵蓋 NOT_LEADER、GROUP_LOCKED、ALREADY_SUBMITTED、STALE_ROUND、BLANK_ANSWER，以及兩組並行送出後順位為 1、2 且不重複
- [ ] 3.4 實作 Socket.IO：連線時依 Cookie 判斷身分；每次 `version` 遞增時對所有連線推送依角色過濾的快照；`snapshot:request`；`draft:update` 只廣播給同組。驗證：Vitest 以 `socket.io-client` 連線，確認進行中時學生的快照不含他組資料、草稿只送到同組、`version` 連續遞增
- [ ] 3.5 實作只在 `MOCK_TEST_HOOKS=1` 時啟用的 `/__mock`（reset、presence、forceError、skipVersions、delaySnapshots、disconnect）。驗證：Vitest 確認啟用時各端點有效，未啟用時回應 404
- [ ] 3.6 在 README 補充 mock 的環境變數與測試鉤子說明。驗證：照 README 設定 `MOCK_TEST_HOOKS=1` 啟動後，`POST /__mock/reset` 回應 2xx

## 4. 狀態管理與 Socket.IO 連線

- [ ] 4.1 在 `web/src/store` 實作 `snapshot` 與 `ui` 兩部分的 store，以及 `applySnapshot`：忽略較舊的版本、整份替換、跳號時觸發重新同步（design D9）。驗證：Vitest 涵蓋 live-state-sync spec「漏收事件與版本跳號時重新同步」的情境
- [ ] 4.2 實作學生的 `viewState` computed（design D10 對應表）與老師的按鈕可用性 computed（design D11）。驗證：Vitest 以表格驅動測試，覆蓋 D10 的 6 條規則與 D11 的每個按鈕
- [ ] 4.3 在 `web/src/api/socket.ts` 實作單一 Socket.IO 連線：自動重連、`connected` 狀態、在 connect 或重新連線時送出 `snapshot:request`、處理 `snapshot` 與 `draft:updated` 事件。驗證：Vitest 對 mock 連線、中斷再重連，確認 `connected` 正確變化，且重連後收到新的快照
- [ ] 4.4 實作組別 Cookie 工具：寫入 `group_<代號>`；與快照不一致時以快照覆寫（design F2）。驗證：Vitest 在 jsdom 環境中確認寫入與覆寫的行為

## 5. 老師端頁面

- [ ] 5.1 設定 Playwright：測試啟動腳本隨機產生教師密碼，並以環境變數傳給 mock（`MOCK_TEST_HOOKS=1`）與測試；提供建立老師或學生 browser context 的 helper；每個測試前呼叫 `/__mock/reset`；設定 `npm run test:e2e` 並寫入 README。驗證：一個開啟首頁的冒煙測試通過
- [ ] 5.2 實作 `/`、`/teacher/login` 與路由守衛（未登入時導向登入頁）。驗證：Playwright 涵蓋 teacher-console spec「教師登入」的 3 個情境，並檢查 localStorage、sessionStorage、URL 中都沒有密碼
- [ ] 5.3 實作 `/teacher/new`：上傳、預覽（題數、題號、儲存格、子填空、warnings）、錯誤顯示、組數輸入、建立活動。驗證：Playwright 上傳 `samples/` 中的兩份範本與「變體」及 `invalid` 檔名，涵蓋「上傳並顯示解析預覽」「顯示上傳與解析失敗」「建立活動並顯示活動代號」的所有情境，並確認換檔後沒有殘留上一份的題數或儲存格
- [ ] 5.4 實作 `/teacher/board/:code`：題目列表、開始、結束、重開、下一題，按鈕可用性依 D11，狀態等快照才改變。驗證：Playwright 涵蓋「題目看板與控制按鈕」的情境（用 `delaySnapshots` 驗證「狀態等快照才改變」，用 `forceError` 驗證 409）
- [ ] 5.5 在看板加入各組即時狀態、答案、順位與搶答成功標示，以及組員名單、在線狀態與轉移組長。驗證：Playwright 涵蓋「各組即時作答狀態與順位」「組員名單、組長在線狀態與轉移組長」的情境（用 `presence` 讓組長離線）
- [ ] 5.6 加入「匯出 Excel」與「下載 CSV」。驗證：Playwright 以 `waitForEvent('download')` 確認兩者都觸發下載，且 `suggestedFilename()` 與 mock 的 `Content-Disposition` 檔名一致

## 6. 學生端頁面

- [ ] 6.1 實作 `/join`（支援 `?code=` 預填）與 `/play/:code` 的進入守衛及重新整理後恢復。驗證：Playwright 涵蓋「輸入活動代號與暱稱加入」的 3 個情境
- [ ] 6.2 實作選組下拉選單、換組、開始後鎖定、開始後才加入的第一次選組，以及後端拒絕時恢復。驗證：Playwright 涵蓋「用下拉選單選組並以後端的值為準」的所有情境（用 `forceError` 觸發 GROUP_LOCKED；用 `context.addCookies` 竄改 Cookie）
- [ ] 6.3 實作等待畫面與作答畫面（單題與題組輸入框、組長與組員的送出鈕差異、提示文字）。驗證：Playwright 涵蓋「等待畫面」「依題目顯示作答輸入框」「只有組長能送出」的情境，包括收到 403
- [ ] 6.4 串接送出流程（design F3）：前端驗證、同步鎖防連點、依錯誤碼提示與重新同步。驗證：Playwright 涵蓋「送出前檢查空白與長度」（含 `forceError` 回 400）與「防止重複送出」，用 `page.on('request')` 計數確認連點只發出 1 個請求
- [ ] 6.5 實作已送出唯讀畫面、結果頁（含「本題無人作答」與切換查看其他已結束題目），以及重開時回到作答狀態。驗證：Playwright 涵蓋「已送出的唯讀畫面」「結束後顯示結果」「重開時回到作答狀態」的情境，並確認重開後送出請求帶有新的 `round`

## 7. 同組草稿共編

- [ ] 7.1 實作 design F4 的子填空編輯狀態（dirty、composing、pendingRemote）、300ms debounce、IME 組字時不送出、送出 `draft:update`。驗證：Vitest 以假計時器確認 300ms 內連續輸入只送出一次，組字期間不送出
- [ ] 7.2 實作套用遠端更新的規則與「〈暱稱〉正在編輯」提示。驗證：Playwright 以同組兩個 context 涵蓋「同組草稿共編」的 3 個情境；「打字時不被覆寫」的情境要斷言輸入框的 `selectionStart` 與內容在收到遠端更新前後不變

## 8. 整合驗證

- [ ] 8.1 多瀏覽器同步：1 個老師 context 加 3 個學生 context（2 組，其中一組 2 人），依序開始、送出、結束、重開。驗證：Playwright 涵蓋 live-state-sync spec「多瀏覽器之間的階段一致」，每一步在 2 秒逾時內全部同步（目標約 1 秒）
- [ ] 8.2 斷線重連與版本跳號：用 `disconnect` 在題目結束前中斷學生連線、用 `skipVersions` 製造跳號。驗證：Playwright 涵蓋「連線狀態顯示與斷線處理」「重連後恢復正確狀態」「漏收事件與版本跳號時重新同步」的情境
- [ ] 8.3 他組資料不洩漏：題目進行中時，從第 1 組學生頁面讀取 store 的快照並收集 console 輸出。驗證：Playwright 確認其中沒有第 2 組的答案、草稿、狀態或順位；結束後才出現
- [ ] 8.4 機敏資訊檢查：在 repo 與 `web` 的建置產物中搜尋密碼與金鑰相關字樣。驗證：`npm run build` 後，`git grep -i -E "password\s*=|secret|api[_-]?key"` 只命中 `.env.example` 的佔位值和程式中的欄位名稱，沒有任何真實的值
- [ ] 8.5 全部測試通過。驗證：`npm test` 與 `npm run test:e2e` 都以結束碼 0 完成

## Workflow follow-up

- 把 design.md 的「介面約定 v0」交給後端組員確認，若有修改，以 `openspec-update-change` 更新本 change。
- 接上真正的後端後（把 `BACKEND_URL` 指向後端），重新執行標示「需後端」的 Playwright 情境，並人工驗證匯出檔案的內容。
- 審查通過後再封存本 change。
