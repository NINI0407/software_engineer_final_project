# Design

## Context

動機見 proposal.md 的 Why。這個 change 是在已封存的 `build-quiz-buzzer-frontend` 之上修改，沿用它 design.md 的 D8「前端介面約定 v0」，並把它升為 v1。

目前與這次變更有關的現況：

- 前端 `TeacherNew.vue` 用 `<input type="file">` 上傳，呼叫 `api.upload()`（multipart 送到 `POST /api/uploads`），再用 `uploadId` 建立活動；它用遞增序號忽略較舊的上傳回應。
- `TeacherBoard.vue` 的「匯出 Excel」與「下載 CSV」都是 `<a download>`，直接指向後端網址。
- mock 用 `multer` 接收檔案，`fixtures.js` 依檔名挑選單題、題組、變體三份固定預覽；`export.xlsx` 回傳佔位內容。
- 錯誤格式是 `{ error: { code, message, details?: string } }`，前端用 `lib/errors.ts` 的表把 `code` 轉成提示文字。
- `ActivityInfo`（`activity` 欄位）同時出現在學生與老師快照中。
- mock 已經有通用的 `forceError` 鉤子，能比對 method 與 path，強制下一次請求回傳指定錯誤。

## Goals / Non-Goals

**Goals:**

- 確定介面約定 v1，讓後端可以照著實作，前端與 mock 不必等後端完成。
- 讓前端從頭到尾都不需要、也拿不到任何 Google 憑證。
- 用 mock 的寫入紀錄，讓「答案寫入對應填空格」與「不寫死儲存格」可以在前端的自動化測試中驗證。

**Non-Goals:**

- 不實作真正的 Google Sheets 讀寫、授權或金鑰管理，這些都屬於後端。
- 不支援老師用自己的 Google 帳號授權（OAuth），見 D1。
- 不處理匯入後到建立活動前，試算表又被修改的情況；這段時間通常很短，寫回時的 `SHEET_CHANGED` 已經能擋住寫錯格子。
- 不提供寫回的復原功能，靠 Google 試算表本身的版本紀錄。

## Decisions

### G1. 憑證只存在後端

```
  瀏覽器（老師／學生）              自家後端                       Google
 +--------------------+      +-------------------------+     +----------------+
 | 只知道：            |      | 保管：                   |     |                |
 |  - 試算表網址       | ---> |  - service account 金鑰  | --> | Sheets API     |
 |  - shareWith email  | REST |    （只在後端的 .env）   |     |                |
 | 不知道：            | <--- |  - 存取權杖              | <-- |                |
 |  - 金鑰、權杖       |      |                         |     |                |
 +--------------------+      +-------------------------+     +----------------+
          x  瀏覽器永遠不直接連到 googleapis.com / accounts.google.com
```

- **授權模式採用 service account（待後端確認）。** 老師把試算表共用給一個固定的 email，後端用自己的金鑰讀寫。前端唯一需要知道的是這個 email（錯誤回應中的 `shareWith`），它是公開資訊，不是憑證。
- **不採用老師個人的 Google OAuth。** OAuth 需要前端導向 Google 授權頁、處理回呼，權杖也比較容易在瀏覽器端流轉，違反「前端不接觸憑證」，而且會改變整個匯入流程。
- 本 repo（前端＋mock）**不新增任何 Google 相關的環境變數**。Vite 只會把 `VITE_` 開頭的變數打包進前端，因此規定不得新增 `VITE_GOOGLE_*`。後端的金鑰變數名稱由後端決定，放在後端自己的 `.env`。
- 驗證方式：
  1. 建置後掃描 `dist/`，不得出現 `private_key`、`client_secret`、`ya29.`、`AIza`、`VITE_GOOGLE_`。
  2. E2E 監聽瀏覽器的所有請求，不得出現 Google 的網域。

### G2. 介面約定 v1（相對 v0 的差異，待後端確認）

共通約定的變動：錯誤物件新增選填欄位 `shareWith: string`，只在需要老師調整共用設定時出現。`details` 仍然是字串，與 v0 相同。

```
{ "error": { "code": "SHEET_NOT_SHARED", "message": "...", "shareWith": "quiz-bot@...iam.gserviceaccount.com" } }
```

**REST：老師**

| 方法 | 路徑 | 請求內容 | 成功 | 錯誤 |
|---|---|---|---|---|
| ~~POST~~ | ~~`/api/uploads`~~ | 移除 | | |
| POST | `/api/sheets/import` | `{ sheetUrl }` | 200 `SheetImportPreview` | 400 `INVALID_SHEET_URL`、403 `SHEET_NOT_SHARED`（附 `shareWith`）、404 `SHEET_NOT_FOUND`、422 `WORKSHEET_NOT_FOUND`（附 `details`）、422 `PARSE_FAILED`（附 `details`）、503 `SHEETS_UNAVAILABLE`、401 |
| POST | `/api/activities` | `{ importId, groupCount }` | 201 `TeacherSnapshot` | 400 `INVALID_GROUP_COUNT`、404 `IMPORT_NOT_FOUND`、401 |
| ~~GET~~ | ~~`/api/activities/:code/export.xlsx`~~ | 移除 | | |
| POST | `/api/activities/:code/export-to-sheet` | `{ basedOnVersion }` | 200 `ExportToSheetResult` | 403 `SHEET_READ_ONLY`（附 `shareWith`）、409 `SHEET_CHANGED`（附 `details`）、409 `STALE_VERSION`、409 `NOTHING_TO_EXPORT`、409 `EXPORT_IN_PROGRESS`、502 `SHEET_WRITE_FAILED`、503 `SHEETS_UNAVAILABLE`、401、404 |
| GET | `/api/activities/:code/export.csv` | – | 不變 | 不變 |

其餘老師與學生的路徑、Socket.IO 事件都不變。

**資料型別**

```ts
interface SheetImportPreview {
  importId: string;
  sheetUrl: string;            // 後端正規化後的網址
  spreadsheetTitle: string;
  worksheetTitle: string;
  questions: { number: number; blanks: { label: string | null; cellRef: string }[] }[];
  warnings: string[];
}

interface ExportToSheetResult {
  sheetUrl: string;
  writtenCells: number;
  skippedQuestions: number[];  // 沒有寫入的題號（未結束、無人作答）
  exportedAt: string;          // ISO 8601
}

interface SheetInfo {
  spreadsheetTitle: string;
  worksheetTitle: string;
  url: string;
  lastExportedAt: string | null;
}

interface TeacherSnapshot {
  // ...v0 的欄位不變
  sheet: SheetInfo;            // 新增，放在最上層
}
// StudentSnapshot 不變，不含任何試算表資訊
```

**`sheet` 放在 `TeacherSnapshot` 最上層，而不是 `activity` 裡。** `activity`（`ActivityInfo`）也會出現在學生快照中，放進去就會把試算表網址洩漏給學生。如果學生拿到的試算表是「知道連結的人都能檢視」，就能看到老師的講義與寫回的答案。

**錯誤碼與前端提示（新增與移除）**

| code | 提示 | 前端額外動作 |
|---|---|---|
| ~~`NOT_XLSX`~~ | 移除 | |
| ~~`UPLOAD_NOT_FOUND`~~ | 改為 `IMPORT_NOT_FOUND`：匯入結果已失效，請重新匯入 | – |
| `INVALID_SHEET_URL` | 這不是有效的 Google 試算表網址 | 清除預覽 |
| `SHEET_NOT_SHARED` | 無法讀取此試算表，請先共用給〈shareWith〉 | 清除預覽；顯示複製 email 按鈕 |
| `SHEET_NOT_FOUND` | 找不到這份試算表，請確認網址 | 清除預覽 |
| `WORKSHEET_NOT_FOUND` | 找不到指定的工作表：〈details〉 | 清除預覽 |
| `PARSE_FAILED` | 解析失敗：〈details〉（不變） | 清除預覽 |
| `SHEETS_UNAVAILABLE` | Google 服務暫時無法連線，請稍後再試 | 匯入時清除預覽 |
| `SHEET_READ_ONLY` | 試算表只有檢視權限，請把〈shareWith〉設為編輯者 | 顯示複製 email 按鈕 |
| `SHEET_CHANGED` | 試算表的題目結構已變更，未寫入任何資料：〈details〉 | – |
| `SHEET_WRITE_FAILED` | 寫回失敗，試算表未被修改，請稍後再試 | – |
| `STALE_VERSION` | 結果已更新，請重新確認 | `snapshot:request`，不自動重送 |
| `NOTHING_TO_EXPORT` | 目前沒有可寫回的結果 | `snapshot:request` |
| `EXPORT_IN_PROGRESS` | 正在寫回中，請稍候 | – |

v0 的 `disableCreate` 動作改名為 `clearPreview`。所有匯入錯誤都會清除預覽，「建立活動」按鈕自然就停用了。

**待後端確認**（接續 v0 的 1 到 8 項）

9. 授權採用 service account，錯誤回應用 `shareWith` 告訴老師要共用給誰。
10. 匯入只需要讀取權限；寫入權限不足要到寫回時才回 `SHEET_READ_ONLY`。
11. 寫回前後端會重新讀取並解析試算表，用題號比對 `cellRef`。只要有任何一題對不上，就回 `SHEET_CHANGED`，一格都不寫。
12. 寫回以單一批次請求完成，要嘛全部成功、要嘛全部失敗，所以 `SHEET_WRITE_FAILED` 可以宣稱「試算表未被修改」。
13. 只寫入已結束題目最後一輪的順位 1 提交；沒人作答的題目不清除格子；進行中與未開始的題目不寫。
14. 目標格子已有內容時一律覆寫（G4）。
15. 寫回的目標由建立活動時的匯入結果決定，請求中不帶網址（G3）。
16. `basedOnVersion` 只和「結果」比對，不和整體版本號比對（G5）。
17. 寫回成功後，後端更新 `sheet.lastExportedAt` 並遞增 `version`，推送新快照。
18. 同一個活動同時只能有一個寫回在進行，否則回 `EXPORT_IN_PROGRESS`。

### G3. 寫回的目標由後端綁定

`export-to-sheet` 的請求只帶 `basedOnVersion`，不帶網址或儲存格。後端在建立活動時就記住「哪份試算表、哪個工作表、每個 blank 的 `cellRef`」。

- 前端無法把答案寫到其他試算表，也無法決定要寫到哪一格，符合「前端不自行產生或修改檔案內容」的精神。
- 替代方案：請求中帶 `sheetUrl` 讓老師可以寫到另一份。這樣多了一個風險面，也會把「動態解析」的責任拆成兩半，所以不採用。

### G4. 覆寫政策：一律覆寫（A 方案）

確認視窗只依快照呈現，並固定顯示「將覆寫這些儲存格的現有內容」，不另外查詢格子目前的內容。

- 理由：目標格子本來就是學生作答的位置；重複寫回自己上一次的結果是預期中的用法；誤寫可以用 Google 試算表的版本紀錄還原。
- 替代方案（B）：增加 `dryRun` 請求，逐格列出「將覆寫：〈原內容〉」。安全性較高，但要多一支介面、多一種 mock 情境，而且每次確認前都要多讀一次 Google，所以不採用。
- 匯入時如果後端發現填空格已有內容，可以用既有的 `warnings` 提醒（mock 的變體試算表就有這種 warning），不需要新增欄位。

### G5. 確認流程與 `basedOnVersion`

```
 [寫回試算表] --(可用：有已結束且有提交的題目、已連線、不在處理中)
      |
      v
 確認視窗：只讀目前快照（不發請求），記下 version = V
   - 每題：寫入 / 本題無人作答 / 進行中 / 未開始
   - 寫入的題目：搶答成功組名、每個 blank 的答案與 cellRef
   - 固定的覆寫警告
      | 確認                                    | 取消 -> 不發請求
      v
 POST export-to-sheet { basedOnVersion: V }   （處理中：按鈕停用，防止連點）
      |
  +---+-------------------------------+
  v                                   v
 200：顯示結果與連結                   錯誤：依 G2 錯誤表顯示提示
 （lastExportedAt 依稍後的快照更新）    STALE_VERSION -> 要求快照，請老師重新確認
```

- 確認視窗的「寫入」清單用 `results` 計算：對每個 `Result`，若 `winnerGroupId` 不為 null，就取 `submissions[0]` 的每個 answer，以 `blankId` 對應到 `questions[].blanks[].cellRef`。這只是把快照換個方式顯示，實際寫入的內容以後端為準。
- 打開視窗之後，快照仍然可能更新（例如學生上下線）。視窗內容在打開的當下就固定，以那時的 `version` 作為 `basedOnVersion`。
- **`STALE_VERSION` 只看結果有沒有變。** 上課時學生上下線、選組等事件都會讓 `version` 遞增，如果直接比對 `version`，老師幾乎每次都會遇到 `STALE_VERSION`。因此後端記錄 `resultsVersion`（最後一次有題目結束或重開時的 `version`），當 `resultsVersion > basedOnVersion` 時才拒絕。

### G6. mock 如何模擬 Sheets 的讀寫與錯誤

**匯入**：`POST /api/sheets/import`

1. 用 `^https://docs\.google\.com/spreadsheets/d/([A-Za-z0-9_-]+)` 取出 `<id>`；格式不符就回 400 `INVALID_SHEET_URL`。
2. 依 `<id>`（不分大小寫）中的關鍵字選擇結果，依下表順序比對，先符合的優先：

| 關鍵字 | 匯入結果 | 寫回結果 |
|---|---|---|
| `notshared` | 403 `SHEET_NOT_SHARED`，`shareWith: "quiz-bot@mock.invalid"` | – |
| `missing` | 404 `SHEET_NOT_FOUND` | – |
| `noworksheet` | 422 `WORKSHEET_NOT_FOUND`，`details: "網址指定的工作表不存在"` | – |
| `invalid` | 422 `PARSE_FAILED`，`details: "找不到題號/作答表頭"` | – |
| `readonly` | 單題 6 題 | 403 `SHEET_READ_ONLY`，`shareWith` 同上 |
| `changed` | 單題 6 題 | 409 `SHEET_CHANGED`，`details: "第 3 題的作答格位置已改變"` |
| `variant` | 變體 9 題（`講義B!…`，含 1 條 warning） | 正常寫回 |
| `group` | 題組 4 題（含子填空） | 正常寫回 |
| 其他 | 單題 6 題 | 正常寫回 |

3. 成功時產生 `importId`，把預覽、`sheetUrl`、試算表標題與寫回模式（正常／`readonly`／`changed`）存進 `state.imports`。`fixtures.js` 的三份資料各加上 `spreadsheetTitle` 與 `worksheetTitle`，工作表名稱與 `cellRef` 的前綴一致（`學習單`、`講義B`）。

`readonly` 與 `changed` 的錯誤要等寫回才出現，這是刻意的設計，用來模擬「匯入時讀得到，寫回時才失敗」。

**建立活動**：用 `importId` 取出匯入結果，把 `sheet` 資訊與寫回模式存進活動；`sheet.lastExportedAt` 一開始是 null。`teacherSnapshot()` 輸出 `sheet`，`studentSnapshot()` 不輸出。

**寫回**：`POST /api/activities/:code/export-to-sheet`，依序檢查：

1. 既有的 `forceError` 比對，符合就直接回傳指定錯誤。這可以模擬 `SHEET_WRITE_FAILED`、`SHEETS_UNAVAILABLE` 與 `EXPORT_IN_PROGRESS`。
2. 寫回模式是 `readonly` 或 `changed` 時，回傳對應的錯誤。
3. `act.resultsVersion > basedOnVersion` 時，回 409 `STALE_VERSION`。`resultsVersion` 在題目結束或重開時，設為 `bump()` 後的版本。
4. 計算寫入內容：對每一題 `closed` 的題目，取目前輪次順位 1 的提交，逐一用 `blankId` 對應到 `cellRef`。沒有任何格子可寫時，回 409 `NOTHING_TO_EXPORT`。
5. 把 `{ exportedAt, cells: [{ cellRef, value }] }` 加進 `state.sheetWrites[code]`，更新 `sheet.lastExportedAt`，呼叫 `bump(act)`，回 200 `ExportToSheetResult`。

任何錯誤都在第 5 步之前回傳，所以失敗時不會留下寫入紀錄。mock 是單執行緒，第 4、5 步在同一個同步區塊內完成，不會真的發生併發寫回。

**測試鉤子**：

- 新增 `GET /__mock/sheetWrites?code=ABC234`，回傳該活動的寫入紀錄陣列。
- `reset` 一併清空 `imports` 與 `sheetWrites`。
- 其餘鉤子不變。

**移除**：`/api/uploads`、`export.xlsx` 路徑、`multer` 依賴、`pickPreview()` 依檔名判斷的邏輯。

mock 完全不發出對外連線，也不讀取任何 Google 相關的環境變數。

### G7. 前端頁面

**`TeacherNew.vue`**

- 檔案選擇改成網址欄位（`sheet-url-input`）與「匯入」按鈕（`import-btn`），欄位 `trim()` 後是空的就停用按鈕。
- 保留遞增序號機制：只採用最後一次匯入的回應，避免較舊的回應蓋掉新的結果。
- 開始匯入時就先清除舊的預覽與錯誤。預覽顯示試算表標題、工作表名稱、題數、題號與 `cellRef`，以及 warnings。
- 錯誤顯示在 `import-error`。有 `shareWith` 時，另外顯示 email（`share-with`）和複製按鈕（`copy-share-with`，使用 `navigator.clipboard`；不支援時只顯示文字讓老師自行選取）。

**`TeacherBoard.vue`**

- 移除「匯出 Excel」，保留「下載 CSV」。
- 新增「寫回試算表」（`export-sheet-btn`）、確認視窗（`export-confirm`，含 `export-confirm-ok`、`export-confirm-cancel`）、結果區（`export-result`），以及試算表連結（`sheet-link`，`target="_blank" rel="noopener noreferrer"`，網址取自快照的 `sheet.url` 或寫回回應的 `sheetUrl`）。
- 確認清單的計算寫成 `store/view.ts` 中的純函式（輸入快照，輸出每題的寫入計畫），方便做單元測試。

**API 與型別**

- `api.upload()` 改成 `api.importSheet(sheetUrl)`；`createActivity(importId, groupCount)`；新增 `api.exportToSheet(code, basedOnVersion)`；移除 `exportXlsxUrl`。
- 型別：`UploadPreview` 改成 `SheetImportPreview`，新增 `ExportToSheetResult`、`SheetInfo`，`TeacherSnapshot` 加上 `sheet`。
- `ErrorBody`、`ApiError`、`RestError` 加上選填的 `shareWith`。
- `describeError(code, details, shareWith)` 負責把 `〈details〉` 與 `〈shareWith〉` 填進提示文字。

### G8. 測試策略

- **單元測試（Vitest）**：`errors.ts` 的新錯誤碼與文字代入；`rest.ts` 的新路徑、請求內容與 `shareWith` 解析；寫入計畫純函式（單題、題組、無人作答、進行中、重開）。
- **mock 測試**（`mock/server.test.js`）：每個網址關鍵字、寫回的每種錯誤、寫入紀錄的內容、`STALE_VERSION` 與「只有出席變動」的區別、學生快照不含 `sheet`、舊路徑回 404。
- **E2E（Playwright）**：
  - `helpers.ts` 的 `FILES` 改成 `SHEETS`，提供各情境的測試網址。
  - `createActivity()` 改用 `/api/sheets/import`。
  - 匯入與寫回的 Scenario 各寫一個測試，用 `/__mock/sheetWrites` 驗證寫入位置。
  - 全程記錄 `page.on('request')`，驗證沒有任何請求送往 Google 的網域。
- **建置掃描**：新增一個 npm script，執行 `vite build` 後掃描 `dist/` 中的禁止字串，找到就以非零狀態結束。

## Risks / Trade-offs

- [後端最後選了 OAuth，而不是 service account] → 匯入流程要加上授權導向，`SHEET_NOT_SHARED` 的提示也要改寫。對策：在待後端確認第 9 項明確寫出，並且越早確認越好；前端把 `shareWith` 的顯示做成選填，沒有這個欄位時只顯示一般提示。
- [直接覆寫老師在填空格裡預先寫的內容] → 確認視窗有固定的覆寫警告；後端可以在匯入時用 warnings 提早提醒；誤寫可以用試算表的版本紀錄還原。
- [匯入後老師改了試算表結構，寫回時寫錯格子] → 後端寫回前重新解析並比對，不符合就回 `SHEET_CHANGED`，一格都不寫（待後端確認第 11 項）。mock 用 `changed` 關鍵字模擬這種狀況。
- [試算表網址外流給學生] → `sheet` 只放在老師快照中；mock 測試和 spec 都驗證學生快照不含 `sheet`。
- [確認視窗的內容和後端實際寫入的不一致] → 寫入清單以後端為準，視窗只是預覽；`basedOnVersion` 擋住「確認後結果才變動」的情況；成功時顯示後端回傳的 `writtenCells` 與 `skippedQuestions`，不顯示前端自己算的數字。
- [Google API 配額或暫時失敗] → 後端回 `SHEETS_UNAVAILABLE`，前端提示稍後再試，按鈕恢復可用；前端不自動重試，避免重複寫入。
- [mock 依網址關鍵字判斷，和真實行為有落差] → mock 只用來驗證前端的畫面與錯誤處理；真實的 Google 讀寫在 spec 中標示「需後端驗證」。

## Migration Plan

1. 前端與 mock 一起切換到 v1：這個 change 不保留 `/api/uploads` 與 `export.xlsx` 的相容路徑，因為目前沒有真正的後端在使用 v0 的這兩條路徑。
2. 把本 change 的 design.md（G2）交給後端，作為介面約定 v1；後端確認後，再把「待後端確認」第 9 到 18 項的結論補回 design.md。
3. 真正的後端完成後，把 `.env` 的 `BACKEND_URL` 指向後端，再跑一次 E2E 中不依賴 `/__mock` 鉤子的情境。
4. 回滾：還原這個 change 的 commit 即可回到上傳／下載 `.xlsx`；mock 與前端會一起還原，不會有資料遷移。

## Open Questions

- 試算表連結是否要在看板上一直顯示（目前設計：建立活動後就一直顯示，標示「上次寫回：尚未寫回」）。這只影響畫面配置，不影響介面或流程。
- `shareWith` 的 email 是否也要顯示在建立活動頁的說明文字中，讓老師在匯入前就先共用。這只是新增說明文字，可以在實作時決定。
