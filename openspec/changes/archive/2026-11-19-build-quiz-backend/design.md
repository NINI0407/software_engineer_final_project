# Design

## Context

- 動機與範圍見 proposal.md。行為以 `specs/quiz-backend` 與 `specs/google-sheets-sync` 為準。
- 介面約定：v0 見 `archive/2026-11-17-build-quiz-buzzer-frontend/design.md` 的 D8，v1 見 `archive/2026-11-18-switch-to-online-google-sheets/design.md` 的 G2，組長規則與介面差異見 `archive/2026-11-18-auto-promote-leader-on-offline/design.md` 的 L1 與 L4。
- `mock/server.js`（約 700 行）已經實作並測試過大部分活動規則：狀態機、順位、組長遞補、依角色產生快照、`version` 與 `resultsVersion`、草稿、CSV。它把規則、HTTP、Socket.IO 與測試鉤子寫在同一個函式裡，而且依網址關鍵字回傳固定的試算表資料。
- 使用者決定：正式後端**參考 mock 重新撰寫**（探索時的方案 B），不與 mock 共用程式碼，mock 維持原狀。
- 兩份範本（`samples/`）的實際結構：

```
 單題範本（工作表「學習單」）            題組範本（工作表「學習單」）
      B      C..F        G..H                B      C..F        G       H
 4  | 題號 | 題目(合併) | 作答(合併) |    4  | 題號 | 題目(合併)  | 作答(G4:H4 合併)|
 5  |  1   | 敘述       | [G5:H5]    |    5  |  1   | 敘述 (1)    | （1） | [H5] |
 6  | (B6:H6 合併的空白列)          |    6  |(B5:B6| 敘述 (2)    | （2） | [H6] |
 7  |  2   | 敘述       | [G7:H7]    |       | 合併)|             |       |      |
 ...                                     8  |  2   | ...（同上，H8、H9）
 15 |  6   | 敘述       | [G15:H15]  |    11 |  3   | 敘述        | [G11:H11]    |
                                         13 |  4   | 敘述        | [G13:H13]    |
 [ ] = 作答格；題號是數值儲存格
```

- 只需要在本機執行，不需要部署。交件期限是 11/30。

## Goals / Non-Goals

**Goals:**

- 前端不修改任何程式，只改 `BACKEND_URL` 就能改接正式後端。
- 題目解析器是純函式，不連 Google 就能用大量版面測試，因為助教會用另一份 Guided Notes 測試。
- 憑證只存在 repo 外的金鑰檔。

**Non-Goals:**

- 不做持久化：狀態只存在記憶體，後端重新啟動後活動與匯入結果都會消失。
- 不做 HTTPS、部署、多位老師帳號、老師個人 Google OAuth。
- 不做「更公平的搶答順位機制」等額外功能，之後另開 change。
- 不修改 `web/` 與 `mock/`。

## Decisions

### B1. 參考 mock 重新撰寫，用移植測試防止兩邊不一致

使用者選擇重新撰寫，而不是從 mock 抽出共用核心（方案 A），或直接把 mock 升級成正式後端（方案 C）。

- 理由：正式後端可以照「規則、傳輸、Google」重新分層，不受 mock 的測試鉤子和單一大函式影響；mock 的 spec（不連 Google、不讀憑證）也不必改。
- 代價：同樣的規則有兩份實作，之後可能不一致。對策：把 `mock/server.test.js` 中不依賴測試鉤子的情境，逐一移植成正式後端的整合測試，測試名稱對應 spec Scenario。規則有任何修改時，兩邊的測試都要跟著改。
- 方案 A 的優點是邏輯只有一份，但要先搬動 mock 並修改 `mock-backend` spec，所以不採用。方案 C 會讓測試鉤子和憑證出現在同一個程式中，所以不採用。

### B2. 技術選型

- Node.js 20 以上、Express 4、Socket.IO 4、`cookie-parser`、`dotenv`，都沿用 repo 已有的版本。純 JavaScript（ES modules），用 JSDoc 註記型別，不加入建置步驟，風格與 mock 相同。
- 替代方案：TypeScript 可以和 `web/src/api/types.ts` 共用型別，但要多一套編譯或 `tsx` 執行設定，期限內不划算，所以不採用。
- Google：`@googleapis/sheets`（只含 Sheets API 的官方套件，內含 `google-auth-library`）。完整的 `googleapis` 套件太大；自己用 `fetch` 簽 JWT 的程式碼太多，也容易出錯，所以都不採用。

### B3. 模組結構

```
server/
  index.js            進入點：讀 .env、建立 Google 用戶端（或停用）、啟動
  app.js              createServer({ teacherPassword, sheets })：組裝 HTTP 與 Socket.IO
  domain/
    errors.js         AppError(status, code, message, extra)
    activity.js       活動規則：狀態機、選組、組長、送出、順位、草稿、resultsVersion
    snapshots.js      studentSnapshot / teacherSnapshot / results（依角色過濾）
    store.js          記憶體：sessions、imports、activities；產生活動代號與 ID
    csv.js            CSV 內容
  http/
    teacher.js        登入、登出、session、建立活動、題目控制、CSV
    student.js        加入、取得快照、選組、送出
    sheets.js         匯入、寫回
  realtime/
    socket.js         連線驗證、在線計數、snapshot:request、draft:update、推送
  sheets/
    url.js            parseSheetUrl(url) -> { spreadsheetId, gid, normalizedUrl }
    parser.js         parseGuidedNotes(grid) -> { questions, warnings } | 錯誤（純函式）
    google.js         GoogleSheetsClient：read(spreadsheetId)、writeCells(...)；Google 錯誤分類
    export.js         寫回流程：計畫 -> 重新讀取並比對 -> 批次寫入
  testing/
    fake-sheets.js    測試用的試算表用戶端（記憶體資料、寫入紀錄、可指定失敗與延遲）
    e2e-entry.js      e2e 專用進入點：createServer + fake-sheets；正式的 index.js 不會載入
```

- `createServer` 透過參數注入 `sheets` 用戶端。整合測試與 e2e 注入 `fake-sheets`，正式啟動注入 `GoogleSheetsClient`。這樣不必在正式程式裡放測試開關，也符合「不提供測試鉤子」。
- `domain/` 不知道 HTTP 與 Socket.IO 的存在。規則不成立時丟出 `AppError`，由 HTTP 層轉成錯誤回應、由 Socket 層轉成 `error` 事件。

### B4. 狀態改變一律經過 `commit(act)`

和 mock 的 `bump()` 相同的概念：`activity.js` 中每個會改變狀態的操作，最後都呼叫 `commit(act)`。`commit` 依序做三件事：重新判定組長（L1 的規則）、`version += 1`、通知 `realtime/socket.js` 對該活動的每條連線各推送一次快照。

- 組長判定和推送在同一個同步區塊，所以快照不會出現「組長已離線但還沒換人」的中間狀態。
- 題目結束或重開時，`commit` 之後把 `resultsVersion` 設為新的 `version`（G5）。
- 草稿只推 `draft:updated`，不呼叫 `commit`；只有該組在本題的第一筆草稿會呼叫 `commit`，讓老師看到「編輯中」。

### B5. 順位與並行

Node.js 是單執行緒。送出的處理從檢查到 `rank = 目前提交數 + 1` 再寫入，中間沒有任何 `await`，所以順位不會重複，也一定照接收順序。寫回是唯一需要等待外部服務的操作，另外由 B10 的鎖處理。

### B6. 身分與 Cookie

- `teacher_session`：登入成功時產生 32 bytes 的亂數，存在記憶體的集合中；登出時移除。
- 密碼比對：把兩邊各取 SHA-256 之後，用 `crypto.timingSafeEqual` 比較，避免依字串長度或內容洩漏時間差。
- `client_id`：24 個十六進位字元，第一次加入時發出。Cookie 一律 `httpOnly`、`sameSite: 'lax'`、`path: '/'`。只在 localhost 用 http 執行，所以不設 `Secure`。
- 活動代號：6 個字元，字元集排除 0、O、1、I 等容易混淆的字元（與 mock 相同），重複時重新產生。

### S1. Google 用戶端與憑證

- 環境變數 `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` 指向 repo 外的 service account 金鑰 JSON。啟動時讀取一次，取出 `client_email` 作為 `shareWith`，再用 `GoogleAuth({ keyFile, scopes: ['https://www.googleapis.com/auth/spreadsheets'] })` 建立用戶端。
- **不使用 `GOOGLE_APPLICATION_CREDENTIALS` 或預設憑證（ADC）。** ADC 在沒有設定時，可能自動改用開發者電腦上 gcloud 登入的個人帳號，身分就和 `shareWith` 不一致。改成明確指定金鑰檔，沒有設定就是停用。
- 沒有設定或無法讀取金鑰時：終端機印出提示（不印路徑以外的內容），`sheets` 改成「停用中」的用戶端，所有呼叫都丟出 503 `SHEETS_UNAVAILABLE`。
- 每個 Google 請求的逾時設為 10 秒。

### S2. 一次讀取工作表的值與合併範圍

用 `spreadsheets.get`，設定 `includeGridData: true` 與欄位遮罩：

```
properties.title,
sheets(properties(sheetId,title,index),merges,
       data(startRow,startColumn,rowData(values(formattedValue))))
```

一次請求就能拿到所有工作表的標題、儲存格顯示值與合併範圍。轉成解析器使用的格式：

```
Grid = { sheetId, title, cells: string[][]（formattedValue，沒有值時為 ''），
         merges: { r0, r1, c0, c1 }[]（從 0 起算，r1 與 c1 不含） }
```

替代方案：`values.get` 拿不到合併範圍，判斷不了題組的跨列題號與合併的作答格，所以不採用。

### S3. 題目解析演算法（`parser.js`，純函式）

所有比對前，先把儲存格文字去掉所有空白（含全形空白與零寬字元）。

1. **找表頭**：由上往下，找第一個同時有「題號」與「作答」儲存格的列。題號欄是「題號」所在的欄；作答區是「作答」所在合併範圍涵蓋的欄（沒有合併時只有一欄）。
2. **找題目**：從表頭下一列開始逐列掃描，已經屬於上一題的列跳過。題號欄的值符合 `^(?:第)?(\d+)(?:\.0+)?(?:題|\.|、|．)?$` 時，就是一題的開始；這一題涵蓋的列，是該儲存格所在合併範圍的列，沒有合併時只有該列。其他列（空白列、分隔列、說明文字）都跳過。
3. **找填空**：對這一題涵蓋的每一列，看作答區第一格（取其合併範圍的左上角）。內容符合 `^[（(]\d+[）)]$` 時，這一列是子填空：標籤保留原文字；作答格是同一列中，標籤合併範圍右邊、仍在作答區內的第一格。這一題沒有任何標籤列時，就是單一填空：標籤為 null，作答格是第一列作答區第一格的合併範圍左上角。
4. **檢查**：沒有任何題目、題號重複、標籤右邊沒有作答格，都是 `PARSE_FAILED`，並在 `details` 中說明。題號不連續、作答格已有內容，則加入 `warnings`。
5. **`cellRef`**：`<工作表名稱>!<欄字母><列號>`，例如 `學習單!H5`，與約定和 mock 的顯示格式相同。實際呼叫 API 時，另外把工作表名稱加上單引號跳脫（`'學習單'!H5`），但不對外顯示。

選擇工作表（spec「選擇工作表」）在解析器外層處理：有 `gid` 就只解析那一個；沒有就依 `index` 順序逐一嘗試，取第一個找得到表頭的工作表。

### S4. 匯入結果與活動綁定寫回目標

- `POST /api/sheets/import` 成功時，在記憶體保存 `{ spreadsheetId, sheetId, spreadsheetTitle, worksheetTitle, normalizedUrl, questions（含每個 blank 的列、欄） }`，以 `importId` 為鍵，保存到後端重新啟動為止。
- 建立活動時，把這份結果複製進活動，作為寫回目標（G3）。題目 ID 為 `q1`、`q2`…，子填空 ID 為 `q1b1`…，與 mock 相同，方便移植測試。

### S5. 寫回流程（`export.js`）

```
 POST export-to-sheet { basedOnVersion }
   |
   1. 該活動正在寫回？ ---------------------------> 409 EXPORT_IN_PROGRESS
   2. basedOnVersion 不是整數，或 < resultsVersion -> 409 STALE_VERSION
   3. 計算寫入計畫（已結束、最後一輪、順位 1）
      沒有任何格子 -------------------------------> 409 NOTHING_TO_EXPORT
   4. 上鎖（act.exporting = true）               以下有 await
   5. 重新讀取試算表（S2），依 sheetId 找工作表
      讀取失敗 -> 依 S6 分類（403 -> SHEET_READ_ONLY；404 或工作表不見 -> SHEET_CHANGED）
   6. 用 S3 重新解析，逐題比對題號、子填空數、作答格的欄列
      不同 ---------------------------------------> 409 SHEET_CHANGED（details 指出第一個不同）
   7. values.batchUpdate（valueInputOption: RAW），範圍用目前的工作表名稱
      403 -> SHEET_READ_ONLY；其他失敗 -> 502 SHEET_WRITE_FAILED
   8. 成功：lastExportedAt = 現在，commit(act)，回應 200
   finally：解鎖
```

- 寫入計畫在第 3 步就固定。等待 Google 的期間，即使老師又結束或重開題目，這次仍寫入老師確認時看到的內容，與 `basedOnVersion` 的意義一致。
- 比對只看欄列，不看工作表名稱，所以工作表改名後仍能寫回（第 7 步用重新讀取到的新名稱）。
- `RAW` 讓答案以純文字保存：`=…` 不會變成公式，`007` 不會變成數字 7。
- 單一的 `values.batchUpdate` 請求就是「全部成功或全部失敗」的邊界（G2 待確認第 12 項）。

### S6. Google 錯誤分類（`google.js`）

| Google 回應 | 匯入時 | 寫回時（讀取） | 寫回時（寫入） |
|---|---|---|---|
| 401、403 | 403 `SHEET_NOT_SHARED` + `shareWith` | 403 `SHEET_READ_ONLY` + `shareWith` | 403 `SHEET_READ_ONLY` + `shareWith` |
| 404 | 404 `SHEET_NOT_FOUND` | 409 `SHEET_CHANGED`（找不到原試算表） | 502 `SHEET_WRITE_FAILED` |
| 400 且訊息為「此文件不支援此操作」（雲端硬碟中尚未轉換的 .xlsx） | 422 `PARSE_FAILED`，`details` 請老師先另存為 Google 試算表 | 409 `SHEET_CHANGED` | 502 `SHEET_WRITE_FAILED` |
| 429、5xx、逾時、網路錯誤、未設定憑證 | 503 `SHEETS_UNAVAILABLE` | 503 `SHEETS_UNAVAILABLE` | 502 `SHEET_WRITE_FAILED` |

- 終端機只記錄 HTTP 狀態與 Google 的錯誤代碼，不記錄回應全文、請求標頭或權杖。錯誤回應只放約定中的欄位。

### B7. 介面約定：相對 v1 加 L4 沒有差異

本 change 不新增、不修改任何 REST 路徑、錯誤碼、快照欄位或 Socket.IO 事件，所以沒有差異表。過去「待後端確認」的 1 到 18 項，全部依原本的提案採用，包括：老師不收 `draft:updated`（第 6 項）、答案上限 500 字（第 7 項）、匯入只需讀取權限（第 10 項）、寫回前重新解析比對（第 11 項）、單一批次寫入（第 12 項）、一律覆寫（第 14 項）、同時只有一個寫回（第 18 項）。

**實作後記錄**

- 上述 1 到 18 項都依原提案實作，並有自動化測試（`server/**/*.test.js`、`e2e-server/`），試算表部分以 fake-sheets 模擬。
- 實作時加入的兩個行為，都不改變介面約定：
  - 老師登出時，後端一併中斷使用該 session 的 Socket.IO 連線（spec quiz-backend「教師密碼驗證」的「登出」）。
  - 匯入回應的 `sheetUrl` 一律帶上實際使用的工作表 `#gid=<sheetId>`；網址沒有 `gid` 時也一樣。
- 與 mock 的差異（不影響前端）：每組在本題的第一筆草稿，後端先推送快照、再推送 `draft:updated`，mock 的順序相反；快照本身已包含這筆草稿，所以內容相同。另外，已連線的老師登出時，正式後端會中斷該連線，mock 不會。
- 人工驗證（task 7.3）：使用者已於 2026-11-19 設定 Google Cloud 服務帳戶，並以真實 Google 試算表完成驗證。

### B8. 設定與指令

| 環境變數 | 用途 | 預設 |
|---|---|---|
| `TEACHER_PASSWORD` | 教師密碼（與 mock 共用同一個變數） | 未設定時隨機產生 |
| `SERVER_PORT` | 正式後端的連接埠（和 mock 的 `PORT` 分開，兩者可以同時執行） | `4000` |
| `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` | repo 外金鑰檔的路徑 | 未設定時停用試算表功能 |

- npm scripts：`dev:server`（`node --watch server/index.js`）、`start:server`、`test:server-e2e`。改接正式後端時，在 `.env` 把 `BACKEND_URL` 設為 `http://localhost:4000`。
- `.gitignore` 加入 `secrets/`、`*service-account*.json`、`*-key.json`。README 建議把金鑰放在 repo 以外（例如使用者家目錄）。
- `scripts/check-no-secrets.mjs` 新增掃描 git 追蹤的檔案（`git ls-files`），找到 `"private_key"` 或 `-----BEGIN PRIVATE KEY-----` 就失敗。掃描 `dist/` 的原有行為不變。
- 環境變數都不使用 `VITE_` 前綴，Vite 也只讀 `BACKEND_URL`，所以金鑰路徑不會進入前端產物。

### B9. 測試策略

| 層級 | 內容 | 工具 |
|---|---|---|
| 解析器單元測試 | 依兩份範本轉寫的 Grid 資料（註明來源），加上各種變形：整體平移、多工作表、指定 `gid`、題號寫法、重複題號、不連續、已有內容、標籤沒有作答格、沒有表頭 | Vitest |
| 網址與錯誤分類 | `parseSheetUrl` 的各種網址；用模擬的 Google 錯誤物件驗證 S6 的對應 | Vitest |
| 整合測試 | `createServer` + `fake-sheets`，透過真實 HTTP 與 `socket.io-client`，移植 mock 測試的情境，並涵蓋兩份 spec 的每個 Scenario（含寫回延遲時的 `EXPORT_IN_PROGRESS`、寫入失敗不更新時間） | Vitest |
| e2e | 新的 `playwright.server.config.ts`：啟動 `server/testing/e2e-entry.js`（:4100）與前端（:5175），在 `e2e-server/` 跑一次不依賴 `/__mock` 的完整流程（兩組學生） | Playwright |
| 人工驗證 | 用真實 Google 試算表：複製兩份範本，再自製一份變形版面，依 tasks 的檢查表逐項操作 | 手動 |

- 既有的 `npm test` 與 `npm run test:e2e` 不受影響；`vitest.config.ts` 的 `include` 加入 `server/**/*.test.js`。
- 測試中的 `fake-sheets` 不發出任何對外連線，所以 `npm test` 不需要網路與憑證。

## Risks / Trade-offs

- [mock 和正式後端的規則逐漸不一致] → B1：移植 mock 的測試情境；兩邊的測試名稱都對應同一份 spec Scenario；規則改動時兩邊一起改。
- [助教的 Guided Notes 版面與範本差很多（例如沒有「題號」或「作答」表頭）] → 解析器不依賴任何位置，只依表頭文字與合併範圍；找不到時 `PARSE_FAILED` 的 `details` 會說明缺什麼，老師可以照作業說明修改表頭。用多種變形版面的單元測試降低風險。
- [Google 沒有明文保證 `values.batchUpdate` 一定是全部成功或全部失敗] → 所有格子都在同一個請求中送出，實務上以單一請求處理；在人工驗證中以權限不足的情況確認失敗時沒有任何格子被修改。
- [第 3 步到第 7 步之間，老師同時在試算表上編輯] → 第 6 步的比對可以擋住結構變動，但擋不住「比對後、寫入前」的極短時間內的修改。發生機率很低，而且可以用試算表的版本紀錄還原。
- [後端重新啟動後活動消失] → 本機上課使用，可以接受；README 提醒上課期間不要重新啟動後端，並在結束時先寫回與下載 CSV。
- [金鑰被誤放進 repo] → 不使用預設路徑、`.gitignore` 排除常見檔名、`check:secrets` 掃描 git 追蹤的檔案。
- [試算表很大，`includeGridData` 回應很大] → Guided Notes 通常只有幾十列；欄位遮罩只取顯示值與合併範圍。
- [網路異常斷線要等 Socket.IO 心跳逾時才會遞補組長] → 和 mock 相同，維持預設值，記錄在 README（L 系列已說明）。

## Migration Plan

1. 實作 `server/` 與測試，確認 `npm test`、`npm run test:e2e`（mock）、`npm run test:server-e2e`、`npm run typecheck`、`npm run build`、`npm run check:secrets` 全部通過。
2. 建立 service account、下載金鑰到 repo 以外的位置，設定 `GOOGLE_SERVICE_ACCOUNT_KEY_FILE`；把測試用的試算表共用給 service account；完成人工驗證。
3. `.env` 的 `BACKEND_URL` 改成 `http://localhost:4000`，用前端實際跑一次完整流程，並錄製 Demo。
4. 更新 README 與 `openspec/config.yaml` 的專案描述。
5. 把「寫回時結構不符就一格都不寫」「依接收順序給順位」等後端行為告知 SpecKit 組，確認兩邊做法一致。
6. 回滾：刪除 `server/` 與新增的設定；前端把 `BACKEND_URL` 改回 mock。mock 與前端都沒有修改，不需要資料遷移。

## Open Questions

- Socket.IO 的心跳間隔是否要調短，讓網路異常斷線時更快遞補組長。這只影響偵測延遲，不影響規則或介面，可以在人工驗證後再決定。
