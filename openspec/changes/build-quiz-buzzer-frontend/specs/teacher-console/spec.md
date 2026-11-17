# Spec Delta

## Purpose

提供老師操作搶答活動的畫面，包含登入、上傳 Guided Notes 並確認解析預覽、建立活動、控制題目進行、監看各組作答狀態，以及觸發匯出下載。畫面一律依後端回傳的資料呈現。

## ADDED Requirements

### Requirement: 教師登入
老師端 SHALL 在 `/teacher/login` 提供密碼輸入欄位，並把密碼送給後端驗證。前端 MUST NOT 在程式碼、瀏覽器儲存空間或 URL 中保存或比對任何密碼。未登入時開啟其他老師頁面，SHALL 被導向登入頁。

#### Scenario: 密碼正確
- **WHEN** 老師輸入密碼並送出，後端回應 204
- **THEN** 畫面導向 `/teacher/new`，且密碼沒有出現在 URL、localStorage、sessionStorage 或可由 JavaScript 讀取的 Cookie 中

#### Scenario: 密碼錯誤
- **WHEN** 後端回應 401 `INVALID_PASSWORD`
- **THEN** 畫面停留在登入頁，顯示「密碼錯誤」，並清空密碼欄位

#### Scenario: 未登入時開啟看板
- **WHEN** 未登入的使用者直接開啟 `/teacher/board/ABC234`，且 `GET /api/teacher/session` 回傳 `authenticated: false`
- **THEN** 畫面導向 `/teacher/login`

### Requirement: 上傳 Guided Notes 並顯示解析預覽
老師端 SHALL 允許選擇一個 `.xlsx` 檔並上傳到後端，並依後端回傳的資料顯示預覽：檔名、題數、每題的題號與各填空格的 `cellRef`（題組依序列出各子填空及其標籤），以及所有 warnings。題數、題號與儲存格 MUST 完全來自後端回應，畫面 MUST NOT 寫死任何題數或儲存格位置。

#### Scenario: 單題範本預覽
- **WHEN** 老師上傳單題範本，後端回傳 6 題，每題各有 1 個填空
- **THEN** 預覽顯示「共 6 題」，並列出 6 列題號與各自的儲存格位置

#### Scenario: 題組範本預覽
- **WHEN** 後端回傳 4 題，其中第 1 題有標籤「（1）」「（2）」兩個子填空
- **THEN** 預覽顯示「共 4 題」，第 1 題下方列出兩個子填空與各自的儲存格位置

#### Scenario: 換一份 Guided Notes
- **WHEN** 老師改上傳另一份檔案，後端回傳 9 題，且儲存格位置不同
- **THEN** 預覽改為顯示 9 題與新的儲存格位置，畫面上沒有任何前一份檔案的題數或儲存格

#### Scenario: 顯示 warnings
- **WHEN** 後端回應中含有 warnings（例如「題號 5 之後跳號」）
- **THEN** 預覽區上方逐條顯示這些 warnings，且仍可以繼續建立活動

### Requirement: 顯示上傳與解析失敗
後端拒絕上傳時，老師端 SHALL 顯示錯誤原因，並 MUST NOT 允許用這次上傳建立活動。

#### Scenario: 解析失敗
- **WHEN** 後端回應 422 `PARSE_FAILED`，`details` 為「找不到題號/作答表頭」
- **THEN** 畫面顯示解析失敗與該原因，「建立活動」按鈕維持停用

#### Scenario: 檔案格式錯誤
- **WHEN** 後端回應 400 `NOT_XLSX`
- **THEN** 畫面顯示「請上傳 .xlsx 檔」，且不顯示預覽

### Requirement: 建立活動並顯示活動代號
老師端 SHALL 讓老師在預覽成功後輸入組數，並用 `uploadId` 與組數向後端建立活動。建立成功後 SHALL 導向該活動的看板，並醒目顯示後端回傳的活動代號。

#### Scenario: 建立成功
- **WHEN** 老師輸入組數 6 並按「建立活動」，後端回應 201，代號為 `ABC234`
- **THEN** 畫面導向 `/teacher/board/ABC234`，並顯示活動代號 `ABC234`

#### Scenario: 組數不合法
- **WHEN** 後端回應 400 `INVALID_GROUP_COUNT`
- **THEN** 組數欄位旁顯示錯誤，畫面停留在建立頁

### Requirement: 題目看板與控制按鈕
看板 SHALL 列出所有題目及其狀態，並提供開始、結束、重開和「下一題」。按鈕是否可用 SHALL 依最新快照決定：
- 「開始」：該題為未開始，且沒有其他題目進行中。
- 「結束」：該題為進行中。
- 「重開」：該題為已結束，且沒有其他題目進行中。
- 「下一題」：沒有題目進行中，且有未開始的題目；按下時開始編號最小的未開始題目。

按下按鈕後，畫面狀態 SHALL 等後端推送快照才改變。

#### Scenario: 有題目進行中時不能開始其他題
- **WHEN** 快照顯示第 3 題進行中
- **THEN** 其他所有題目的「開始」和「重開」按鈕都停用，只有第 3 題的「結束」可以按

#### Scenario: 後端拒絕開始
- **WHEN** 老師按下「開始」，後端回應 409 `ANOTHER_QUESTION_OPEN`
- **THEN** 畫面顯示「已有題目進行中」，題目狀態維持最新快照的內容

#### Scenario: 狀態等快照才改變
- **WHEN** 老師按下第 1 題的「開始」，後端已回應 204，但還沒推送快照
- **THEN** 第 1 題仍顯示「未開始」，按鈕呈現處理中；收到快照後才改為「進行中」

#### Scenario: 下一題
- **WHEN** 第 1、2 題已結束，第 3、4 題未開始，且沒有題目進行中，老師按「下一題」
- **THEN** 前端送出開始第 3 題的請求

### Requirement: 各組即時作答狀態與順位
看板 SHALL 依快照顯示每一組在目前進行中題目的狀態（未作答／編輯中／已送出）。已送出的組 SHALL 顯示答案與後端給的順位，順位 1 的組 SHALL 標示為搶答成功。已結束的題目 SHALL 顯示該題結果。

#### Scenario: 進行中即時更新
- **WHEN** 第 2 組送出答案，後端推送的快照中第 2 組為已送出、順位 1
- **THEN** 看板約一秒內顯示第 2 組已送出、答案內容、順位 1，並標示為搶答成功

#### Scenario: 順位只依後端
- **WHEN** 快照中第 4 組的順位為 1、第 1 組的順位為 2
- **THEN** 看板依此顯示，不依畫面收到資料的先後或送出時間自行排序

### Requirement: 組員名單、組長在線狀態與轉移組長
看板 SHALL 顯示各組成員的暱稱、在線狀態，並標示組長。老師 SHALL 可以把組長轉移給該組的另一位成員。

#### Scenario: 組長離線
- **WHEN** 快照中第 1 組組長的 `online` 為 false
- **THEN** 看板在該組長旁顯示離線標示

#### Scenario: 轉移組長
- **WHEN** 老師在第 1 組選擇成員「小華」並按「設為組長」，後端回應 204 並推送新快照
- **THEN** 看板改為標示小華是組長

### Requirement: 觸發匯出下載
看板 SHALL 提供「匯出 Excel」與「下載 CSV」。按下後 SHALL 由瀏覽器向後端的匯出網址發出下載請求，前端 MUST NOT 自行產生或修改檔案內容。

#### Scenario: 匯出 Excel
- **WHEN** 老師按「匯出 Excel」
- **THEN** 瀏覽器下載 `GET /api/activities/ABC234/export.xlsx` 的回應，檔名與後端 `Content-Disposition` 的檔名一致（需後端：檔案內容是否正確由後端驗證）

#### Scenario: 下載 CSV
- **WHEN** 老師按「下載 CSV」
- **THEN** 瀏覽器下載 `export.csv` 的回應，檔名與 `Content-Disposition` 一致（需後端：CSV 欄位與內容由後端驗證）
