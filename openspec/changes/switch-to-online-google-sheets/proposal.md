# Proposal

## Why

目前老師要先從 Google Sheets 下載 Guided Notes 的 `.xlsx` 再上傳，匯出時還要下載修改後的檔案、自己傳回雲端，步驟多又容易弄錯版本。直接串接線上試算表可以讓匯入與寫回都在同一份線上檔案上完成，答案也能直接寫進原本的 Guided Notes（R06）。

## What Changes

- **BREAKING** 匯入改成老師貼上 Google Sheets 網址，前端呼叫 `POST /api/sheets/import { sheetUrl }`，取代 `POST /api/uploads` 的 `.xlsx` 上傳。建立活動改用 `importId`，不再使用 `uploadId`。
- 預覽內容改成顯示試算表標題與工作表名稱，取代原本的檔名。題數、題號、儲存格與 warnings 仍完全來自後端。
- 新增匯入錯誤的畫面提示：網址無效、試算表沒有共用（顯示要共用的對象）、找不到試算表、找不到工作表。解析失敗的提示維持不變。
- **BREAKING** 移除「匯出 Excel」下載（`GET export.xlsx`）。改成「寫回試算表」：老師先在確認視窗檢視每題要寫入的組別、答案與儲存格，確認後呼叫 `POST /api/activities/:code/export-to-sheet`，由後端把搶答成功的答案寫回原本的線上試算表。目標格子已有內容時一律覆寫。
- 寫回成功時顯示寫入格數與試算表連結；失敗時依錯誤碼顯示提示（沒有編輯權限、試算表結構已變更、寫回失敗、Google 服務無法連線、結果已更新），且不得顯示成功字樣。
- 「下載 CSV」維持不變。
- 明確規定前端不得接觸任何 Google 憑證，也不得直接呼叫 Google API；呼叫 Google API、授權與金鑰都由後端負責。
- mock 後端改成依網址中的關鍵字回傳固定預覽或錯誤，模擬寫回時記錄「會寫入哪些儲存格」，並提供測試鉤子讀取這份紀錄。mock 不連線 Google，也不需要任何憑證。
- 介面約定由 v0 升為 v1；新欄位與錯誤碼都標示「待後端確認」。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `teacher-console`：上傳預覽改成網址匯入預覽；上傳失敗改成匯入失敗；建立活動改用 `importId`；移除「匯出 Excel」，新增寫回前確認、寫回結果、寫回失敗；「下載 CSV」獨立成一條 Requirement；新增「前端不接觸 Google 憑證」。
- `mock-backend`：介面約定升為 v1；固定預覽改成依網址選擇；新增模擬寫回與寫入紀錄；情境腳本加入寫入紀錄查詢；新增「不連線 Google 服務」。

`student-participation` 與 `live-state-sync` 的行為不變。

## Impact

- 前端：`web/src/pages/TeacherNew.vue`（檔案選擇改成網址欄位）、`web/src/pages/TeacherBoard.vue`（匯出 Excel 改成寫回按鈕、確認視窗與結果）、`web/src/api/rest.ts`、`web/src/api/types.ts`、`web/src/lib/errors.ts`，以及對應的單元測試。
- mock：`mock/server.js`（移除 `/api/uploads` 與 `export.xlsx`，新增兩條路徑與測試鉤子）、`mock/fixtures.js`（改依網址選擇，加上試算表與工作表名稱）、`mock/server.test.js`、`mock/testkit.js`。`multer` 不再需要。
- E2E：`e2e/helpers.ts`（`FILES` 改成測試用網址）、`e2e/teacher.spec.ts`（匯入與匯出情境改寫）。
- 文件：`README.md` 的操作說明與測試鉤子說明。
- 後端：需依 design.md 的介面約定 v1 實作，並保管 Google 憑證；前端與 mock 都沒有新增環境變數。
