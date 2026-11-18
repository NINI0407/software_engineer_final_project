# Tasks

## 1. mock：試算表匯入

- [x] 1.1 在 `mock/fixtures.js` 把 `pickPreview(fileName)` 改成 `pickSheet(sheetUrl)`：先解析 `<id>`，再依 design G6 的關鍵字表與比對順序，回傳預覽或錯誤；三份固定資料各加上 `spreadsheetTitle` 與 `worksheetTitle`（工作表名稱與 `cellRef` 前綴一致），結果並標示寫回模式（正常／`readonly`／`changed`）。在 `mock/server.test.js` 為每個關鍵字與格式錯誤的網址各加一個測試，並確認測試通過
- [x] 1.2 在 `mock/server.js` 新增 `POST /api/sheets/import`（需老師身分），回傳 `SheetImportPreview` 或錯誤（`shareWith`、`details` 欄位依 G2），把結果存進 `state.imports`；移除 `/api/uploads`、`multer` 依賴與 `state.uploads`。用 mock 測試驗證成功回應的欄位、四種匯入錯誤，以及 `POST /api/uploads` 回 404
- [x] 1.3 讓 `POST /api/activities` 改收 `importId`（找不到時回 404 `IMPORT_NOT_FOUND`），活動保存 `sheet` 資訊與寫回模式；`teacherSnapshot()` 輸出 `sheet`（`lastExportedAt` 一開始是 null），`studentSnapshot()` 不輸出。用 mock 測試驗證老師快照有 `sheet`、學生快照不含任何試算表網址、標題或 `cellRef`

## 2. mock：模擬寫回與測試鉤子

- [x] 2.1 在活動中記錄 `resultsVersion`：題目結束或重開時，設為 `bump()` 之後的 `version`。用 mock 測試驗證學生上下線只讓 `version` 遞增，`resultsVersion` 不變
- [x] 2.2 新增 `POST /api/activities/:code/export-to-sheet`，依 G6 的順序檢查：寫回模式、`STALE_VERSION`、計算寫入內容、`NOTHING_TO_EXPORT`；成功時寫入 `state.sheetWrites`、更新 `sheet.lastExportedAt`、`bump()`，並回傳 `ExportToSheetResult`。用 mock 測試涵蓋 spec「模擬試算表寫回」的每個 Scenario（單題、變體、題組、重開、無人作答與進行中、沒有可寫入的格子、結果變動、只有出席變動、readonly、changed），並驗證失敗時沒有寫入紀錄
- [x] 2.3 移除 `GET export.xlsx`；新增測試鉤子 `GET /__mock/sheetWrites?code=`，`reset` 一併清空 `imports` 與 `sheetWrites`；確認既有的 `forceError` 可以套用在 `export-to-sheet`。用 mock 測試驗證：`export.xlsx` 回 404、能讀到寫入紀錄、強制 502 `SHEET_WRITE_FAILED` 時不產生紀錄也不更新 `lastExportedAt`、非測試模式下 `/__mock/sheetWrites` 回 404
- [x] 2.4 更新 `mock/testkit.js` 的輔助函式，改用匯入網址建立活動，並確認 `npm test` 中所有 mock 測試都通過
- [x] 2.5 確認 mock 不讀取任何 Google 相關的環境變數，也不發出對外連線：在 mock 測試中攔截 `http`/`https` 的對外請求，跑一次完整流程，確認請求數為 0

## 3. 前端：API、型別與錯誤表

- [x] 3.1 在 `web/src/api/types.ts` 把 `UploadPreview` 改成 `SheetImportPreview`，新增 `ExportToSheetResult`、`SheetInfo`，`TeacherSnapshot` 加上 `sheet`；`ErrorBody`、`ApiError` 加上選填的 `shareWith`。執行 `npm run typecheck`，確認沒有錯誤（依賴舊型別的頁面先跟著修正編譯錯誤）
- [x] 3.2 在 `web/src/api/rest.ts` 把 `upload()` 改成 `importSheet(sheetUrl)`，`createActivity(importId, groupCount)`，新增 `exportToSheet(code, basedOnVersion)`，移除 `exportXlsxUrl`；`RestError` 保留 `shareWith`。在 `rest.test.ts` 驗證三個請求的路徑與內容，以及錯誤回應中 `shareWith` 的解析
- [x] 3.3 在 `web/src/lib/errors.ts` 依 G2 錯誤表新增錯誤碼，移除 `NOT_XLSX`，把 `UPLOAD_NOT_FOUND` 改成 `IMPORT_NOT_FOUND`，`disableCreate` 改名為 `clearPreview`；`describeError()` 支援代入 `〈details〉` 與 `〈shareWith〉`。在 `errors.test.ts` 驗證每個新錯誤碼的文字與代入結果

## 4. 前端：匯入頁

- [x] 4.1 把 `TeacherNew.vue` 的檔案選擇改成網址欄位（`sheet-url-input`）與「匯入」按鈕（`import-btn`），欄位 `trim()` 後是空的就停用按鈕；保留遞增序號，只採用最後一次匯入的回應；開始匯入時先清除舊的預覽與錯誤。預覽顯示試算表標題、工作表名稱、題數、題號與 `cellRef`，以及 warnings。用 `npm run dev` 手動貼上 `mock-group` 網址，確認預覽正確
- [x] 4.2 匯入錯誤顯示在 `import-error`；有 `shareWith` 時顯示 email（`share-with`）與複製按鈕（`copy-share-with`，`navigator.clipboard` 不可用時只顯示文字）；網址欄位保留原輸入。用 `npm run dev` 手動貼上 `mock-notshared` 網址，確認提示與複製按鈕
- [x] 4.3 改寫 `e2e/helpers.ts`：`FILES` 改成 `SHEETS`（各情境的測試網址），`createActivity()` 改用 `/api/sheets/import`。把 `e2e/teacher.spec.ts` 的「5.3」改成匯入情境，涵蓋 spec「匯入線上 Guided Notes 並顯示解析預覽」與「顯示匯入失敗」的每個 Scenario（含空白網址不發請求、匯入成功後再失敗會清除預覽），以及「建立活動」的 `IMPORT_NOT_FOUND`；刪除「檔案格式錯誤」測試。執行 `npm run test:e2e -- e2e/teacher.spec.ts`，確認通過

## 5. 前端：寫回試算表

- [x] 5.1 在 `web/src/store/view.ts` 新增純函式：輸入老師快照，輸出每一題的寫入計畫（寫入／本題無人作答／進行中／未開始；寫入的題目附組名，以及每個 blank 的答案與 `cellRef`），算法依 G5。在 `view.test.ts` 驗證單題、題組、無人作答、進行中、重開後只看最後一輪
- [x] 5.2 在 `TeacherBoard.vue` 移除「匯出 Excel」，保留「下載 CSV」；新增「寫回試算表」（`export-sheet-btn`）與試算表連結（`sheet-link`，`target="_blank" rel="noopener noreferrer"`），以及「上次寫回：時間／尚未寫回」。按鈕在沒有可寫入的題目、斷線或處理中時停用。用 `npm run dev` 手動確認：沒有結束的題目時按鈕停用，結束一題後變為可用
- [x] 5.3 新增確認視窗（`export-confirm`）：打開時固定當下快照的內容與 `version`，列出 5.1 的寫入計畫與固定的覆寫警告；「取消」不發請求；「確認寫回」送出 `{ basedOnVersion }`，處理中停用按鈕防止連點。用 `npm run dev` 手動確認取消與確認的行為
- [x] 5.4 顯示寫回結果（`export-result`）：成功時顯示「已寫入 N 格」、未寫入的題號與試算表連結；失敗時依錯誤表顯示提示，不出現「成功」或「已寫入」，有 `shareWith` 時顯示複製按鈕；`STALE_VERSION` 與 `NOTHING_TO_EXPORT` 要求最新快照，不自動重送。用 `npm run dev` 搭配 `mock-readonly` 網址，手動確認錯誤提示
- [x] 5.5 改寫 `e2e/teacher.spec.ts` 的「5.6 匯出」：涵蓋 spec「下載 CSV」「寫回前確認」「顯示寫回結果」「顯示寫回失敗」的每個 Scenario。寫入位置用 `/__mock/sheetWrites` 驗證（單題寫到 `學習單!G5`、變體寫到 `講義B!E8`、題組寫到兩格）；失敗用 `mock-readonly`、`mock-changed` 與 `forceError`（`SHEET_WRITE_FAILED`、`STALE_VERSION`、`SHEETS_UNAVAILABLE`）。另外驗證看板上沒有 `export.xlsx` 連結，重新整理後仍顯示上次寫回時間。執行 `npm run test:e2e -- e2e/teacher.spec.ts`，確認通過

## 6. 憑證檢查

- [x] 6.1 新增 `scripts/check-no-secrets.mjs` 與 npm script `check:secrets`：先執行 `vite build`，再掃描 `dist/` 中的 `private_key`、`client_secret`、`ya29.`、`AIza`、`VITE_GOOGLE_`，找到就以非零狀態結束。執行 `npm run check:secrets`，確認通過；暫時在程式中放一個 `AIza` 字串，確認腳本會失敗，再移除
- [x] 6.2 在 E2E 加一個測試：全程記錄瀏覽器請求，跑完匯入、建立活動、結束一題、寫回的流程，並驗證沒有任何請求送往 `googleapis.com` 或 `accounts.google.com`，localStorage、sessionStorage 與可讀 Cookie 中也沒有 Google 權杖。執行 `npm run test:e2e`，確認通過

## 7. 文件

- [x] 7.1 更新 `README.md`：老師操作改成「貼上 Google 試算表網址匯入、在看板寫回試算表」；列出 mock 的測試網址與關鍵字表（G6）；在測試鉤子段落加上 `GET /__mock/sheetWrites`；說明前端與 mock 不需要任何 Google 憑證，憑證只放在後端。依 README 的步驟操作一次，確認內容正確
- [x] 7.2 確認 `.env.example` 沒有新增任何 Google 相關的變數，並在 README 的環境變數表說明原因

## 8. 整體驗證

- [x] 8.1 依序執行 `npm run typecheck`、`npm test`、`npm run check:secrets`、`npm run test:e2e`，全部通過；並確認 `student.spec.ts`、`sync.spec.ts`、`drafts.spec.ts` 沒有因為 `createActivity()` 改用匯入而失敗
- [x] 8.2 執行 `openspec validate switch-to-online-google-sheets --strict`，確認通過

## Workflow follow-up

- 把 design.md 的 G2（介面約定 v1）交給後端確認，並把「待後端確認」第 9 到 18 項的結論補回 design.md。
- 封存之前，更新 `openspec/specs/teacher-console/spec.md` 的 Purpose：「上傳 Guided Notes」改成「匯入線上 Guided Notes」，「觸發匯出下載」改成「寫回試算表與下載 CSV」。delta spec 不能修改 Purpose，只能直接改主規格。
- 通過審查後，用 `openspec-archive-change` 封存這個 change。
