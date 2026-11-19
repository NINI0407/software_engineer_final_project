# google-sheets-sync Specification

## Purpose

讓後端直接讀寫老師的線上 Guided Notes（Google 試算表）：從網址找到工作表，動態解析題號與作答格，產生匯入預覽，並在搶答結束後把順位 1 的答案安全地寫回原本的填空格。

## Requirements

### Requirement: 解析試算表網址
後端 SHALL 接受 `https://docs.google.com/spreadsheets/d/<id>` 開頭的網址，前後空白不影響判斷，並從網址的 `gid` 參數（`#gid=` 或 `?gid=`）取得指定的工作表。不符合這個格式時 SHALL 回應 400 `INVALID_SHEET_URL`。預覽中的 `sheetUrl` SHALL 是後端正規化後的網址，並保留 `gid`。

#### Scenario: 一般網址
- **WHEN** 匯入 `https://docs.google.com/spreadsheets/d/1AbC_x-9/edit#gid=0`
- **THEN** 後端讀取試算表 `1AbC_x-9` 中 `sheetId` 為 0 的工作表

#### Scenario: 不是 Google 試算表
- **WHEN** 匯入 `https://example.com/spreadsheets/d/abc` 或空字串
- **THEN** 後端回應 400 `INVALID_SHEET_URL`，沒有呼叫 Google

### Requirement: 選擇工作表
網址帶 `gid` 時，後端 SHALL 只解析該工作表；找不到這個工作表時 SHALL 回應 422 `WORKSHEET_NOT_FOUND`，`details` 說明找不到哪個工作表。網址沒有 `gid` 時，後端 SHALL 依工作表順序，選擇第一個找得到題目表頭的工作表；都找不到時回應 422 `PARSE_FAILED`。

#### Scenario: 指定的工作表不存在
- **WHEN** 網址的 `gid` 是 12345，但試算表中沒有這個工作表
- **THEN** 後端回應 422 `WORKSHEET_NOT_FOUND`

#### Scenario: 第一個工作表是說明頁
- **WHEN** 網址沒有 `gid`，第一個工作表「說明」沒有題目表頭，第二個工作表「學習單」有
- **THEN** 預覽的 `worksheetTitle` 為「學習單」，題目來自第二個工作表

### Requirement: 動態找出題目表頭
後端 MUST NOT 寫死任何儲存格位置、列號或欄號。後端 SHALL 在工作表中尋找同一列同時有「題號」與「作答」兩個表頭的列（比對時忽略空白）。「題號」所在欄是題號欄；「作答」表頭涵蓋的欄（含合併範圍）是作答區。找不到表頭時 SHALL 回應 422 `PARSE_FAILED`，`details` 為「找不到題號/作答表頭」。

#### Scenario: 範本的位置
- **WHEN** 匯入單題範本：表頭在第 4 列，「題號」在 B4，「作答」是合併的 G4:H4
- **THEN** 題號欄為 B，作答區為 G 到 H

#### Scenario: 表頭移到其他位置
- **WHEN** 同樣的內容整體往下移 3 列、往右移 2 欄，並在表頭上方多了幾列說明文字
- **THEN** 解析出的題數、題號與子填空都相同，`cellRef` 跟著移動後的位置

#### Scenario: 沒有表頭
- **WHEN** 工作表中沒有任何一列同時有「題號」與「作答」
- **THEN** 後端回應 422 `PARSE_FAILED`，`details` 為「找不到題號/作答表頭」

### Requirement: 辨識題目與題號
表頭以下，題號欄中是正整數題號的儲存格（例如 `1`、`1.`、`第 1 題`）SHALL 視為一題的開始；該儲存格的合併範圍涵蓋的列都屬於這一題，沒有合併時只有該列。題數 SHALL 等於找到的題號數量。題號重複或沒有任何題目時 SHALL 回應 422 `PARSE_FAILED` 並說明原因；題號不連續時 SHALL 在 `warnings` 中提醒，仍可匯入。

#### Scenario: 單題範本
- **WHEN** 匯入單題範本（題號 1 到 6 分別在 B5、B7、B9、B11、B13、B15）
- **THEN** 預覽有 6 題，題號為 1 到 6

#### Scenario: 題號重複
- **WHEN** 題號欄中有兩個「3」
- **THEN** 後端回應 422 `PARSE_FAILED`，`details` 指出第 3 題重複

#### Scenario: 題號不連續
- **WHEN** 題號依序為 1、2、4
- **THEN** 預覽有 3 題，`warnings` 包含題號不連續的提醒

### Requirement: 辨識作答格與題組子填空
一題涵蓋的每一列中，作答區第一格是子填空標籤（例如「（1）」「(2)」）時，該列 SHALL 是一個子填空：標籤取自該格，作答格是作答區中標籤右邊的第一格。一題沒有任何標籤列時，SHALL 是單一填空：標籤為 null，作答格是第一列作答區的左上角。`cellRef` SHALL 使用 `<工作表名稱>!<欄列>` 的格式，指向合併範圍的左上角。

#### Scenario: 單題的作答格
- **WHEN** 單題範本第 1 題在第 5 列，作答區 G5:H5 是合併儲存格
- **THEN** 第 1 題只有一個填空，標籤為 null，`cellRef` 為 `學習單!G5`

#### Scenario: 題組的子填空
- **WHEN** 題組範本第 1 題的題號 B5:B6 合併，G5 為「（1）」、G6 為「（2）」
- **THEN** 第 1 題有兩個子填空，標籤為「（1）」「（2）」，`cellRef` 分別為 `學習單!H5`、`學習單!H6`

#### Scenario: 題組與單題混合
- **WHEN** 匯入題組範本
- **THEN** 預覽有 4 題：第 1、2 題各有兩個子填空，第 3 題的 `cellRef` 為 `學習單!G11`，第 4 題為 `學習單!G13`

#### Scenario: 標籤右邊沒有作答格
- **WHEN** 作答區只有一欄，該欄是「（1）」標籤
- **THEN** 後端回應 422 `PARSE_FAILED`，`details` 指出哪一題找不到作答格

### Requirement: 匯入預覽與 warnings
匯入成功時，後端 SHALL 回應 200 `SheetImportPreview`，包含 `importId`、正規化後的網址、試算表標題、工作表名稱、每題的題號與各填空的標籤與 `cellRef`，以及 `warnings`。作答格原本已有內容時，SHALL 加入「第 N 題的填空格原本已有內容，匯出時會被覆寫」的 warning。匯入只需要讀取權限。匯入結果 SHALL 保存到後端重新啟動為止。

#### Scenario: 作答格已有內容
- **WHEN** 第 2 題的作答格中已經寫了「CPU」
- **THEN** 預覽仍然成功，`warnings` 包含「第 2 題的填空格原本已有內容，匯出時會被覆寫」

#### Scenario: 只有檢視權限也能匯入
- **WHEN** service account 對試算表只有檢視權限
- **THEN** 匯入成功

### Requirement: 匯入錯誤的對應
後端 SHALL 把 Google 的回應轉成約定的錯誤碼：沒有讀取權限回應 403 `SHEET_NOT_SHARED` 並附 `shareWith`；試算表不存在回應 404 `SHEET_NOT_FOUND`；無法連線、逾時、配額用完、Google 服務錯誤或後端沒有設定憑證時，回應 503 `SHEETS_UNAVAILABLE`。

#### Scenario: 沒有共用
- **WHEN** 試算表沒有共用給 service account
- **THEN** 後端回應 403 `SHEET_NOT_SHARED`，`shareWith` 為 service account 的 email

#### Scenario: 找不到試算表
- **WHEN** 網址中的試算表 ID 不存在
- **THEN** 後端回應 404 `SHEET_NOT_FOUND`

#### Scenario: Google 無法連線
- **WHEN** 呼叫 Google 時逾時或收到 5xx
- **THEN** 後端回應 503 `SHEETS_UNAVAILABLE`

### Requirement: 寫回的內容
寫回的目標試算表、工作表與每個子填空的 `cellRef` SHALL 在建立活動時就固定，請求中只帶 `basedOnVersion`。後端 SHALL 只寫入已結束題目、最後一輪順位 1 的提交，逐一寫到各子填空的 `cellRef`；沒人作答、進行中與未開始的題目不寫，也不清除，列在 `skippedQuestions`。目標格子已有內容時一律覆寫。沒有任何可寫的格子時 SHALL 回應 409 `NOTHING_TO_EXPORT`。

#### Scenario: 寫入順位 1 的答案
- **WHEN** 以單題範本建立活動，第 1 題已結束，第 2 組順位 1、答案為「光合作用」，第 1 組順位 2，老師寫回
- **THEN** 試算表的 `學習單!G5` 變成「光合作用」，回應的 `writtenCells` 為 1

#### Scenario: 題組逐格寫入
- **WHEN** 以題組範本建立活動，第 1 題已結束，順位 1 的答案為「CPU」「作業系統」
- **THEN** `學習單!H5` 寫入「CPU」，`學習單!H6` 寫入「作業系統」

#### Scenario: 重開後以最後一輪為準
- **WHEN** 第 1 題第一輪由第 1 組順位 1，重開後第二輪由第 3 組順位 1，結束後寫回
- **THEN** 第 1 題的作答格寫入第 3 組的答案

#### Scenario: 無人作答與進行中
- **WHEN** 第 1 題已結束有提交，第 2 題已結束無人作答，第 3 題進行中，老師寫回
- **THEN** 只寫入第 1 題；第 2、3 題的作答格保持原內容，`skippedQuestions` 包含 2 與 3

#### Scenario: 沒有可寫的格子
- **WHEN** 沒有任何已結束且有提交的題目
- **THEN** 後端回應 409 `NOTHING_TO_EXPORT`，沒有呼叫 Google 寫入

### Requirement: 答案以純文字寫入
後端 SHALL 把答案當成純文字寫入，MUST NOT 讓試算表把答案解讀成公式、數字或日期。

#### Scenario: 答案像公式
- **WHEN** 順位 1 的答案是 `=IMPORTXML("http://example.com","//a")`
- **THEN** 作答格顯示的就是這串文字本身，試算表沒有執行任何公式

#### Scenario: 答案像數字
- **WHEN** 順位 1 的答案是 `007`
- **THEN** 作答格顯示 `007`，前面的 0 沒有被去掉

### Requirement: 確認後結果變動
後端 SHALL 記錄最後一次有題目結束或重開時的 `version`（結果版本）。結果版本大於請求的 `basedOnVersion`，或 `basedOnVersion` 不是整數時，SHALL 回應 409 `STALE_VERSION`，不寫入任何內容。只有成員上下線、選組或草稿造成的版本變動 MUST NOT 造成 `STALE_VERSION`。

#### Scenario: 確認後又有題目結束
- **WHEN** 老師以版本 12 送出寫回，但第 2 題在版本 13 結束
- **THEN** 後端回應 409 `STALE_VERSION`，試算表沒有被修改

#### Scenario: 只有出席變動
- **WHEN** 老師以版本 12 送出寫回，之後只有學生上下線讓版本變成 14
- **THEN** 後端正常寫回並回應 200

### Requirement: 寫回前比對試算表結構
寫回前，後端 SHALL 重新讀取並解析建立活動時的那個工作表（依工作表 ID，不依名稱），逐題比對題號、子填空數量與作答格位置。任何一題不同，或工作表已不存在時，SHALL 回應 409 `SHEET_CHANGED`，`details` 指出第一個不同的地方，並且一格都不寫。工作表只是改名時，SHALL 寫到改名後的工作表。

#### Scenario: 作答格位置改變
- **WHEN** 建立活動後，老師在第 3 題上方插入一列，讓第 3 題以後的作答格往下移
- **THEN** 後端回應 409 `SHEET_CHANGED`，`details` 指出第 3 題的作答格位置已改變，試算表沒有任何格子被修改

#### Scenario: 工作表被刪除
- **WHEN** 建立活動後，老師刪除了該工作表
- **THEN** 後端回應 409 `SHEET_CHANGED`，`details` 說明找不到原本的工作表

#### Scenario: 工作表改名
- **WHEN** 建立活動後，工作表從「學習單」改名為「第一週」，題目位置不變
- **THEN** 寫回成功，答案寫到「第一週」工作表的對應儲存格

### Requirement: 單一批次寫入與寫回錯誤
後端 SHALL 用一次批次請求寫入所有格子，要嘛全部成功、要嘛全部不寫。沒有編輯權限時回應 403 `SHEET_READ_ONLY` 並附 `shareWith`；寫入請求失敗時回應 502 `SHEET_WRITE_FAILED`；寫入前讀取試算表時無法連線回應 503 `SHEETS_UNAVAILABLE`。任何失敗 MUST NOT 更新上次寫回時間。

#### Scenario: 只有檢視權限
- **WHEN** service account 對試算表只有檢視權限，老師寫回
- **THEN** 後端回應 403 `SHEET_READ_ONLY`，`shareWith` 為 service account 的 email，試算表沒有被修改

#### Scenario: 寫入失敗
- **WHEN** Google 的批次寫入請求回傳錯誤
- **THEN** 後端回應 502 `SHEET_WRITE_FAILED`，老師快照中的 `sheet.lastExportedAt` 不變

### Requirement: 同一活動同時只有一個寫回
同一個活動已有寫回在進行時，新的寫回請求 SHALL 回應 409 `EXPORT_IN_PROGRESS`。前一個寫回結束（成功或失敗）後，SHALL 可以再次寫回。

#### Scenario: 連續兩次寫回
- **WHEN** 第一個寫回還在等 Google 回應時，又收到同一活動的寫回請求
- **THEN** 第二個請求回應 409 `EXPORT_IN_PROGRESS`；第一個完成後，再次寫回可以正常進行

### Requirement: 寫回成功
寫回成功時，後端 SHALL 回應 200 `ExportToSheetResult`（試算表網址、寫入格數、未寫入的題號、寫回時間），更新老師快照中的 `sheet.lastExportedAt`，並遞增 `version` 推送新快照。

#### Scenario: 寫回後更新快照
- **WHEN** 寫回成功
- **THEN** 老師收到新快照，`sheet.lastExportedAt` 等於回應中的 `exportedAt`；學生快照仍不含任何試算表資訊

### Requirement: service account 憑證的保管
後端 SHALL 用 service account 存取 Google，金鑰檔放在 repo 以外，由環境變數指定路徑。`shareWith` SHALL 取自金鑰中的 service account email。沒有設定或無法讀取金鑰時，後端 SHALL 仍能啟動並提示，匯入與寫回回應 503 `SHEETS_UNAVAILABLE`。金鑰與存取權杖 MUST NOT 傳給前端，也 MUST NOT 被提交到 repo。

#### Scenario: 沒有設定金鑰
- **WHEN** 沒有設定金鑰路徑就啟動後端，老師匯入試算表
- **THEN** 後端正常啟動並在終端機提示未設定憑證；匯入回應 503 `SHEETS_UNAVAILABLE`

#### Scenario: 金鑰不會進 repo
- **WHEN** 檢查 repo 中所有被追蹤的檔案
- **THEN** 沒有任何 service account 金鑰檔或 `private_key` 內容；`.gitignore` 排除常見的金鑰檔名稱
