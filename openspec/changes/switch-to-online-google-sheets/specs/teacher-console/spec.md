## ADDED Requirements

### Requirement: 匯入線上 Guided Notes 並顯示解析預覽
老師端 SHALL 提供 Google Sheets 網址欄位，把老師貼上的網址送到後端匯入，並依後端回應顯示預覽：試算表標題、工作表名稱、題數、每題的題號與各填空格的 `cellRef`（題組依序列出各子填空及其標籤），以及所有 warnings。題數、題號與儲存格 MUST 完全來自後端回應，畫面 MUST NOT 寫死任何題數或儲存格位置。網址欄位為空白時 SHALL 停用匯入按鈕；網址格式由後端判斷，前端 MUST NOT 自行判斷網址是否有效。

#### Scenario: 單題試算表預覽
- **WHEN** 老師貼上單題試算表的網址並按「匯入」，後端回傳 6 題，每題各有 1 個填空
- **THEN** 預覽顯示試算表標題、工作表名稱與「共 6 題」，並列出 6 列題號與各自的儲存格位置

#### Scenario: 題組試算表預覽
- **WHEN** 後端回傳 4 題，其中第 1 題有標籤「（1）」「（2）」兩個子填空
- **THEN** 預覽顯示「共 4 題」，第 1 題下方列出兩個子填空與各自的儲存格位置

#### Scenario: 換一份試算表
- **WHEN** 老師先匯入單題試算表，再改貼另一份網址，後端回傳 9 題，且儲存格位置不同
- **THEN** 預覽改為顯示 9 題與新的儲存格位置，畫面上沒有任何前一份試算表的標題、題數或儲存格

#### Scenario: 顯示 warnings
- **WHEN** 後端回應中含有 warnings（例如「第 9 題的填空格原本已有內容，匯出時會被覆寫」）
- **THEN** 預覽區上方逐條顯示這些 warnings，且仍可以繼續建立活動

#### Scenario: 網址欄位空白
- **WHEN** 網址欄位為空白或只有空白字元
- **THEN** 「匯入」按鈕停用，前端不發出匯入請求

### Requirement: 顯示匯入失敗
後端拒絕匯入時，老師端 SHALL 依錯誤碼顯示提示，不顯示預覽，並 MUST NOT 允許用這次匯入建立活動。網址欄位 SHALL 保留老師輸入的內容，讓老師修正後可以直接重新匯入。

#### Scenario: 網址無效
- **WHEN** 後端回應 400 `INVALID_SHEET_URL`
- **THEN** 畫面顯示「這不是有效的 Google 試算表網址」，不顯示預覽，網址欄位保留原輸入

#### Scenario: 試算表沒有共用
- **WHEN** 後端回應 403 `SHEET_NOT_SHARED`，`shareWith` 為 `quiz-bot@example.iam.gserviceaccount.com`
- **THEN** 畫面顯示「無法讀取此試算表，請先共用給 quiz-bot@example.iam.gserviceaccount.com」，並提供複製這個 email 的按鈕，「建立活動」按鈕停用

#### Scenario: 找不到試算表
- **WHEN** 後端回應 404 `SHEET_NOT_FOUND`
- **THEN** 畫面顯示「找不到這份試算表，請確認網址」，不顯示預覽

#### Scenario: 找不到工作表
- **WHEN** 後端回應 422 `WORKSHEET_NOT_FOUND`，`details` 為「網址指定的工作表不存在」
- **THEN** 畫面顯示「找不到指定的工作表：網址指定的工作表不存在」，「建立活動」按鈕停用

#### Scenario: 解析失敗
- **WHEN** 後端回應 422 `PARSE_FAILED`，`details` 為「找不到題號/作答表頭」
- **THEN** 畫面顯示「解析失敗：找不到題號/作答表頭」，「建立活動」按鈕停用

#### Scenario: 匯入成功後再匯入失敗
- **WHEN** 老師已成功匯入一份試算表，接著改貼另一個網址，後端回應任一匯入錯誤
- **THEN** 前一次的預覽被清除，「建立活動」按鈕停用

#### Scenario: Google 服務無法連線
- **WHEN** 後端回應 503 `SHEETS_UNAVAILABLE`
- **THEN** 畫面顯示「Google 服務暫時無法連線，請稍後再試」，不顯示預覽

### Requirement: 下載 CSV
看板 SHALL 提供「下載 CSV」。按下後 SHALL 由瀏覽器向後端的 CSV 匯出網址發出下載請求，前端 MUST NOT 自行產生或修改檔案內容。

#### Scenario: 下載 CSV
- **WHEN** 老師按「下載 CSV」
- **THEN** 瀏覽器下載 `GET /api/activities/ABC234/export.csv` 的回應，檔名與 `Content-Disposition` 一致（需後端：CSV 欄位與內容由後端驗證）

#### Scenario: 不再提供 Excel 下載
- **WHEN** 老師開啟看板
- **THEN** 畫面上沒有「匯出 Excel」，也沒有任何指向 `export.xlsx` 的連結

### Requirement: 寫回前確認
看板 SHALL 提供「寫回試算表」。按下後 SHALL 先開啟確認視窗，老師確認後才發出寫回請求。確認視窗只依最新快照呈現：目標試算表與工作表名稱、上次寫回時間，以及每一題是否寫入、搶答成功的組別、答案與要寫入的儲存格；並固定顯示「將覆寫這些儲存格的現有內容」。沒有任何已結束且有提交的題目、斷線中或寫回處理中時，按鈕 SHALL 停用。

#### Scenario: 確認視窗內容
- **WHEN** 快照中第 1 題已結束且第 2 組順位 1，第 2 題已結束但無人作答，第 3 題進行中，老師按「寫回試算表」
- **THEN** 確認視窗列出第 1 題由第 2 組寫入、答案與 `學習單!G5`；第 2 題標示「本題無人作答，不寫入」；第 3 題標示「進行中，不寫入」；並顯示覆寫警告

#### Scenario: 題組的子填空
- **WHEN** 第 1 題有「（1）」「（2）」兩個子填空且已結束，第 2 組順位 1
- **THEN** 確認視窗分別列出兩個子填空的答案與各自的儲存格

#### Scenario: 取消
- **WHEN** 老師在確認視窗按「取消」
- **THEN** 視窗關閉，前端沒有發出寫回請求

#### Scenario: 沒有可寫回的結果
- **WHEN** 快照中沒有任何已結束且有提交的題目
- **THEN** 「寫回試算表」按鈕停用

#### Scenario: 確認後送出
- **WHEN** 老師在版本 12 的快照下開啟確認視窗並按「確認寫回」
- **THEN** 前端送出 `POST /api/activities/ABC234/export-to-sheet`，內容為 `{ "basedOnVersion": 12 }`，按鈕呈現處理中

#### Scenario: 連點確認
- **WHEN** 老師快速連按兩次「確認寫回」
- **THEN** 前端只發出一次寫回請求

### Requirement: 顯示寫回結果
寫回成功時，老師端 SHALL 顯示寫入的儲存格數、未寫入的題號，以及後端回傳的試算表連結。連結 SHALL 在新分頁開啟。上次寫回時間 SHALL 依快照顯示，重新整理頁面後仍然存在。

#### Scenario: 寫回成功
- **WHEN** 後端回應 200，`writtenCells` 為 3、`skippedQuestions` 為 `[2, 3]`、`sheetUrl` 為原試算表網址
- **THEN** 畫面顯示「已寫入 3 格」與「第 2、3 題未寫入」，並顯示在新分頁開啟的試算表連結（需後端：實際寫入 Google 試算表的內容由後端驗證）

#### Scenario: 重新整理後
- **WHEN** 寫回成功後老師重新整理看板，快照中的 `sheet.lastExportedAt` 有值
- **THEN** 看板顯示試算表連結與上次寫回時間

### Requirement: 顯示寫回失敗
寫回失敗時，老師端 SHALL 依錯誤碼顯示提示，MUST NOT 顯示「成功」或「已寫入」的字樣，並 SHALL 讓老師可以再次寫回。

#### Scenario: 沒有編輯權限
- **WHEN** 後端回應 403 `SHEET_READ_ONLY`，`shareWith` 為 `quiz-bot@example.iam.gserviceaccount.com`
- **THEN** 畫面顯示「試算表只有檢視權限，請把 quiz-bot@example.iam.gserviceaccount.com 設為編輯者」，並提供複製 email 的按鈕

#### Scenario: 試算表結構已變更
- **WHEN** 後端回應 409 `SHEET_CHANGED`，`details` 為「第 3 題的作答格位置已改變」
- **THEN** 畫面顯示「試算表的題目結構已變更，未寫入任何資料：第 3 題的作答格位置已改變」

#### Scenario: 寫回失敗
- **WHEN** 後端回應 502 `SHEET_WRITE_FAILED`
- **THEN** 畫面顯示「寫回失敗，試算表未被修改，請稍後再試」，「寫回試算表」按鈕恢復可用

#### Scenario: 結果已更新
- **WHEN** 後端回應 409 `STALE_VERSION`
- **THEN** 畫面顯示「結果已更新，請重新確認」，前端要求最新快照，且不自動重送寫回請求

#### Scenario: 其他錯誤
- **WHEN** 後端回應 503 `SHEETS_UNAVAILABLE` 或發生網路錯誤
- **THEN** 畫面顯示對應的錯誤提示，沒有出現「已寫入」字樣

### Requirement: 前端不接觸 Google 憑證
老師端與學生端 MUST NOT 在程式碼、建置產物、瀏覽器儲存空間、URL 或 console 輸出中出現任何 Google 憑證、存取權杖或 API 金鑰，也 MUST NOT 直接向 Google 的 API 發出請求。所有試算表讀寫 SHALL 只透過自家後端的介面完成。

#### Scenario: 完整流程中沒有直接呼叫 Google
- **WHEN** 老師完成匯入、建立活動、結束一題並寫回試算表
- **THEN** 瀏覽器發出的請求中沒有任何指向 `googleapis.com` 或 `accounts.google.com` 的請求

#### Scenario: 建置產物不含憑證
- **WHEN** 執行前端建置並檢查產出的檔案
- **THEN** 檔案中沒有 `private_key`、`client_secret`、`ya29.` 或 `AIza` 開頭的字串，也沒有任何 `VITE_GOOGLE_` 開頭的環境變數

## MODIFIED Requirements

### Requirement: 建立活動並顯示活動代號
老師端 SHALL 讓老師在預覽成功後輸入組數，並用 `importId` 與組數向後端建立活動。建立成功後 SHALL 導向該活動的看板，並醒目顯示後端回傳的活動代號。

#### Scenario: 建立成功
- **WHEN** 老師輸入組數 6 並按「建立活動」，後端回應 201，代號為 `ABC234`
- **THEN** 畫面導向 `/teacher/board/ABC234`，並顯示活動代號 `ABC234`

#### Scenario: 組數不合法
- **WHEN** 後端回應 400 `INVALID_GROUP_COUNT`
- **THEN** 組數欄位旁顯示錯誤，畫面停留在建立頁

#### Scenario: 匯入結果已失效
- **WHEN** 後端回應 404 `IMPORT_NOT_FOUND`
- **THEN** 畫面顯示「匯入結果已失效，請重新匯入」，畫面停留在建立頁

## REMOVED Requirements

### Requirement: 上傳 Guided Notes 並顯示解析預覽
**Reason**: Guided Notes 改成直接讀取線上 Google Sheets，不再上傳 `.xlsx`。
**Migration**: 改用「匯入線上 Guided Notes 並顯示解析預覽」：前端呼叫 `POST /api/sheets/import { sheetUrl }`，取代 `POST /api/uploads`。

### Requirement: 顯示上傳與解析失敗
**Reason**: 不再上傳檔案，`NOT_XLSX` 已不會發生；匯入有新的錯誤狀況。
**Migration**: 改用「顯示匯入失敗」，`PARSE_FAILED` 的提示保留在新的 Requirement 中。

### Requirement: 觸發匯出下載
**Reason**: 「匯出 Excel」改成由後端直接寫回線上試算表，不再下載 `.xlsx`。
**Migration**: Excel 部分改用「寫回前確認」「顯示寫回結果」「顯示寫回失敗」與 `POST /api/activities/:code/export-to-sheet`；CSV 部分改用「下載 CSV」，行為不變。
