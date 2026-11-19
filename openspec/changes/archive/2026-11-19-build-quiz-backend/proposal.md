# Proposal

## Why

前端與 mock 已經依介面約定 v1（含組長遞補的 L4 差異）完成，但系統還沒有正式後端：匯入與寫回只是依網址關鍵字回傳固定資料，無法真的讀寫 Google 試算表。作業要求每個小組交出一套完整、可在本機操作的系統，助教也會用**另一份** Guided Notes 測試匯入與寫回，所以現在要補上真正的後端，讓「動態解析題目、把搶答成功的答案寫回原試算表」實際可用。

## What Changes

- 新增正式後端 `server/`（Node.js、Express、Socket.IO，純 JavaScript ES modules），依 mock 已驗證的規則**重新撰寫**，不與 mock 共用程式碼。mock 維持原狀，繼續供前端開發與 e2e 使用。
- 後端實作介面約定 v1 加上 L4 的全部 REST 路徑、錯誤碼、快照與 Socket.IO 事件，前端不需修改即可透過 `BACKEND_URL` 改接正式後端。介面約定**沒有新增或修改任何欄位**。
- 後端實作活動規則：教師密碼登入、活動代號、題目狀態機與 `round`、依接收順序給順位、組別鎖定、依在線狀態遞補組長、送出驗證、同組草稿、依角色過濾快照、`version` 與 `resultsVersion`、CSV 匯出。狀態只存在記憶體。
- 後端用 Google service account 讀寫試算表：
  - 匯入時解析網址（含 `gid` 指定的工作表），讀取儲存格的值與合併範圍，**動態**找出「題號／作答」表頭、每題的作答格與題組的子填空，不寫死任何儲存格位置。
  - 寫回前重新讀取並解析試算表，逐題比對作答格位置；全部相符才以單一批次寫入，否則一格都不寫。
  - 依 Google 回應對應到約定中的錯誤碼（`SHEET_NOT_SHARED`、`SHEET_READ_ONLY`、`SHEET_CHANGED` 等），`shareWith` 取自 service account 的 email。
- Google 憑證只放在 repo 外的金鑰檔，由環境變數指向；repo 只提交佔位設定。
- 新增 npm scripts 啟動正式後端與執行其測試；README 補上設定 service account 與共用試算表的步驟，並把「正式後端由其他組員負責」的描述改成實際狀況。

## Capabilities

### New Capabilities

- `quiz-backend`：正式後端的活動規則與對外介面，包含教師驗證、活動與題目狀態、搶答順位、組別與組長、送出驗證、草稿、快照推送與可見性、CSV 匯出、啟動設定與機敏資訊處理。
- `google-sheets-sync`：與線上 Guided Notes 的整合，包含網址解析與工作表選擇、動態解析題目與作答格、匯入預覽與 warnings、寫回前的結構比對、批次寫入、Google 錯誤的對應，以及 service account 憑證的保管方式。

### Modified Capabilities

（無）`teacher-console`、`student-participation`、`live-state-sync` 描述的是前端行為，介面約定不變，所以這些 Requirement 不變；`mock-backend` 也不變。原本標示「需後端驗證」的 Scenario，改由本 change 的兩個新 spec 涵蓋。

## Impact

- 新程式：`server/`（進入點、HTTP 路由、Socket.IO、活動規則、Google Sheets 讀寫與解析器）與 `server/**/*.test.js`。
- 依賴：新增 `@googleapis/sheets`（含 `google-auth-library`）。Express、Socket.IO、`cookie-parser`、`dotenv` 沿用既有版本。
- 設定：`package.json` 新增 `dev:server`、`start:server` 等 scripts；`vitest.config.ts` 納入 `server/**/*.test.js`；`.env.example` 新增後端用的佔位變數（不含 `VITE_` 前綴）；`.gitignore` 排除金鑰檔。
- 測試：新增 Playwright 設定，用測試專用的進入點（替換為假的試算表介面）啟動正式後端，跑一次不依賴 `/__mock` 鉤子的完整流程；另需以真實 Google 試算表進行人工驗證。
- 前端 `web/` 與 mock `mock/` 不修改。
- 文件：`README.md`、`openspec/config.yaml` 的專案描述（目前寫著此分支只負責前端與 mock）。
- 與 SpecKit 組：功能必須一致。本 change 不改變任何規則，但寫回時「結構比對失敗就一格都不寫」等後端行為，需要與 SpecKit 組確認做法一致。
