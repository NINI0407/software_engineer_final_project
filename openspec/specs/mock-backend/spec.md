# mock-backend Specification

## Purpose

提供只在本機執行的開發與測試用 mock 後端。它依「前端介面約定 v1」回應 REST 與 Socket.IO，以固定資料模擬 Google 試算表的匯入與寫回（不連線任何 Google 服務），並提供可重現的情境腳本，讓前端在真正的後端完成前就能開發，並執行自動化驗收。

## Requirements

### Requirement: 模擬基本規則
mock 後端 SHALL 以記憶體保存狀態，並模擬下列規則，讓前端的錯誤處理與畫面可以被驗證：
- 同時只能有一題進行中，重開時 `round` 加 1
- 組長為最早加入的成員
- 第一題開始後鎖定組別
- 每組每題每輪只能有效送出一次
- 依接收順序給順位
- 空白檢查與 500 字上限
- 題目結束前不把他組資料送給學生

mock 的行為只用於開發與測試，不代表正式後端的實作。

#### Scenario: 兩組同時送出
- **WHEN** 兩組組長同時送出
- **THEN** mock 依接收順序給出順位 1 和 2，並在題目結束後的 `results` 中呈現

#### Scenario: 他組資料不外流
- **WHEN** 題目進行中，第 2 組已送出
- **THEN** mock 推給第 1 組學生的快照中沒有第 2 組的任何資料

### Requirement: 情境腳本
mock 後端 SHALL 只在測試模式（環境變數 `MOCK_TEST_HOOKS=1`）提供 `/__mock` 控制端點，用來重設狀態、讀取某個活動的試算表寫入紀錄，以及觸發測試需要的情境：讓某個成員離線或上線、強制下一次指定請求（包含匯入與寫回）回應指定錯誤、跳過若干個版本號後推送快照、延遲推送快照、中斷指定的 Socket.IO 連線。這些端點 MUST NOT 在非測試模式下啟用。

#### Scenario: 重設狀態
- **WHEN** 測試開始前呼叫 `POST /__mock/reset`
- **THEN** mock 清空所有活動、匯入結果、寫入紀錄與連線狀態

#### Scenario: 讀取寫入紀錄
- **WHEN** 寫回成功後呼叫 `GET /__mock/sheetWrites?code=ABC234`
- **THEN** mock 回傳該活動每一次寫回的時間與每一格的 `cellRef` 和寫入內容

#### Scenario: 強制寫回失敗
- **WHEN** 以 `forceError` 指定下一次 `POST /api/activities/ABC234/export-to-sheet` 回應 502 `SHEET_WRITE_FAILED`，接著老師寫回
- **THEN** mock 回應 502 `SHEET_WRITE_FAILED`，不產生寫入紀錄，也不更新上次寫回時間

#### Scenario: 非測試模式
- **WHEN** 沒有設定 `MOCK_TEST_HOOKS=1` 時呼叫 `/__mock/reset`
- **THEN** mock 回應 404

### Requirement: 不含機敏資訊
mock 後端 SHALL 從環境變數 `TEACHER_PASSWORD` 讀取教師密碼。沒有設定時 SHALL 在啟動時隨機產生一組密碼，並只印在終端機。repo 中 MUST NOT 有任何真實密碼，只提交只含佔位值的 `.env.example`。

#### Scenario: 未設定密碼
- **WHEN** 沒有 `.env` 也沒有設定 `TEACHER_PASSWORD` 就啟動 mock
- **THEN** 終端機印出一組隨機密碼，可以用它登入；repo 中沒有出現這組密碼

### Requirement: 依介面約定 v1 回應
mock 後端 SHALL 實作 design.md 中介面約定 v1 的所有 REST 路徑、錯誤碼、快照格式與 Socket.IO 事件，讓前端在不修改程式的情況下，能從 mock 切換到真正的後端。老師快照 SHALL 包含試算表資訊（標題、工作表名稱、網址、上次寫回時間）；學生快照 MUST NOT 包含任何試算表資訊。

#### Scenario: 完整流程
- **WHEN** 依序執行老師登入、匯入試算表、建立活動、學生加入並選組、開始題目、組長送出、結束題目、寫回試算表
- **THEN** 每個請求都得到約定中定義的成功回應，學生與老師也收到符合約定格式的快照

#### Scenario: 錯誤碼
- **WHEN** 組員送出答案
- **THEN** mock 回應 403，內容為 `{ "error": { "code": "NOT_LEADER", "message": ... } }`

#### Scenario: 學生看不到試算表
- **WHEN** 活動由某份試算表建立，學生加入後取得快照
- **THEN** 學生快照中沒有試算表的網址、標題或任何儲存格位置

#### Scenario: 舊路徑已移除
- **WHEN** 請求 `POST /api/uploads` 或 `GET /api/activities/ABC234/export.xlsx`
- **THEN** mock 回應 404

### Requirement: 模擬試算表寫回
mock 後端 SHALL 在收到寫回請求時，取每一題已結束且最後一輪中順位 1 的提交，依建立活動時的 `cellRef` 產生寫入紀錄並保存在記憶體，回應寫入格數、未寫入的題號、試算表網址與寫回時間，並更新老師快照中的上次寫回時間。沒有可寫入的格子時 SHALL 回應 409 `NOTHING_TO_EXPORT`；`basedOnVersion` 之後結果有變動時 SHALL 回應 409 `STALE_VERSION`。任何失敗 MUST NOT 產生寫入紀錄。

#### Scenario: 寫入對應的儲存格
- **WHEN** 以單題試算表建立活動，第 1 題已結束且第 2 組順位 1、答案為「光合作用」，老師寫回
- **THEN** mock 回應 200，`writtenCells` 為 1；寫入紀錄中有一筆 `學習單!G5` → 「光合作用」

#### Scenario: 不同試算表寫入不同位置
- **WHEN** 以變體試算表建立活動，第 1 題已結束且有順位 1 的提交，老師寫回
- **THEN** 寫入紀錄使用變體試算表的 `講義B!E8`，而不是單題試算表的位置

#### Scenario: 題組逐格寫入
- **WHEN** 以題組試算表建立活動，第 1 題已結束，順位 1 的提交有「（1）」「（2）」兩個答案
- **THEN** 寫入紀錄分別寫入 `學習單!H5` 與 `學習單!H6`

#### Scenario: 重開後以最後一輪為準
- **WHEN** 第 1 題第一輪由第 1 組順位 1，重開後第二輪由第 3 組順位 1，結束後寫回
- **THEN** 寫入紀錄中第 1 題的內容是第 3 組的答案

#### Scenario: 無人作答與進行中的題目
- **WHEN** 第 1 題已結束有提交、第 2 題已結束但無人作答、第 3 題進行中，老師寫回
- **THEN** 只寫入第 1 題，`skippedQuestions` 包含 2 與 3

#### Scenario: 沒有可寫入的格子
- **WHEN** 沒有任何已結束且有提交的題目時請求寫回
- **THEN** mock 回應 409 `NOTHING_TO_EXPORT`，不產生寫入紀錄

#### Scenario: 結果在確認後變動
- **WHEN** 老師以版本 12 送出寫回，但第 2 題在版本 13 結束
- **THEN** mock 回應 409 `STALE_VERSION`，不產生寫入紀錄

#### Scenario: 只能檢視的試算表
- **WHEN** 以 `https://docs.google.com/spreadsheets/d/mock-readonly/edit` 建立活動，結束一題後寫回
- **THEN** 匯入與建立活動都成功，寫回時 mock 回應 403 `SHEET_READ_ONLY` 並附 `shareWith`，不產生寫入紀錄

#### Scenario: 試算表結構已變更
- **WHEN** 以 `https://docs.google.com/spreadsheets/d/mock-changed/edit` 建立活動，結束一題後寫回
- **THEN** mock 回應 409 `SHEET_CHANGED` 並附 `details`，不產生寫入紀錄

#### Scenario: 只有出席變動不算結果變動
- **WHEN** 老師以版本 12 送出寫回，之後只有學生上下線讓版本變成 14
- **THEN** mock 正常寫回並回應 200

### Requirement: 不連線 Google 服務
mock 後端 MUST NOT 呼叫任何 Google API，也 MUST NOT 需要或讀取任何 Google 憑證。匯入與寫回的結果 SHALL 完全由內建的固定資料與記憶體狀態產生。

#### Scenario: 沒有網路也能執行
- **WHEN** 在沒有網際網路、也沒有任何 Google 相關環境變數的電腦上啟動 mock，並執行完整流程
- **THEN** 匯入與寫回都依約定回應，沒有發出任何對外連線

### Requirement: 依網址關鍵字回傳固定的匯入結果
mock 後端 SHALL NOT 真的讀取或解析 Google 試算表。網址不符合 `https://docs.google.com/spreadsheets/d/<id>` 時 SHALL 回應 400 `INVALID_SHEET_URL`；符合時依 `<id>` 中的關鍵字回傳內建結果：`group` 為題組 4 題、`variant` 為變體 9 題、`invalid` 為 422 `PARSE_FAILED`、`notshared` 為 403 `SHEET_NOT_SHARED`、`missing` 為 404 `SHEET_NOT_FOUND`、`noworksheet` 為 422 `WORKSHEET_NOT_FOUND`，其餘為單題 6 題。`readonly` 與 `changed` 匯入正常，留到寫回時才失敗。

#### Scenario: 匯入題組試算表
- **WHEN** 匯入 `https://docs.google.com/spreadsheets/d/mock-group/edit`
- **THEN** mock 回傳 4 題的預覽，第 1、2 題各有標籤「（1）」「（2）」兩個子填空，並附試算表標題與工作表名稱

#### Scenario: 網址格式錯誤
- **WHEN** 匯入 `https://example.com/not-a-sheet`
- **THEN** mock 回應 400 `INVALID_SHEET_URL`

#### Scenario: 沒有共用
- **WHEN** 匯入 `https://docs.google.com/spreadsheets/d/mock-notshared/edit`
- **THEN** mock 回應 403 `SHEET_NOT_SHARED`，錯誤中的 `shareWith` 為一個佔位 email

#### Scenario: 變體試算表
- **WHEN** 匯入 `https://docs.google.com/spreadsheets/d/mock-variant/edit`
- **THEN** mock 回傳 9 題的預覽，儲存格位置與單題試算表不同，並附 1 條 warning

### Requirement: CSV 匯出附帶檔名
mock 後端 SHALL 在 `GET /api/activities/:code/export.csv` 回傳各題結果的 CSV，並附上 `Content-Disposition` 檔名。

#### Scenario: 匯出 CSV
- **WHEN** 請求 `GET /api/activities/ABC234/export.csv`
- **THEN** mock 回應的 `Content-Disposition` 檔名為 `ABC234_results.csv`
