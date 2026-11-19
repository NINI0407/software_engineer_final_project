# Spec Delta

## Purpose

正式後端的活動規則與對外介面：驗證老師、管理活動與題目狀態、判定搶答順位與組長、依角色推送快照，並讓前端不修改任何程式就能從 mock 改接到正式後端。

## ADDED Requirements

### Requirement: 依介面約定回應
後端 SHALL 實作介面約定 v1 加上 L4 差異中的所有 REST 路徑、請求與回應格式、錯誤碼、快照欄位與 Socket.IO 事件。錯誤回應 SHALL 使用 `{ error: { code, message, details?, shareWith? } }`。約定中已移除的路徑 SHALL 回應 404。

#### Scenario: 前端改接正式後端
- **WHEN** 把 `BACKEND_URL` 指向正式後端，只啟動前端，依序完成老師登入、匯入、建立活動、學生加入並選組、開始題目、組長送出、結束題目、寫回試算表、下載 CSV
- **THEN** 每個請求都得到約定中定義的成功回應，前端畫面與接 mock 時相同，前端程式沒有任何修改

#### Scenario: 已移除的路徑
- **WHEN** 請求 `POST /api/uploads`、`GET /api/activities/ABC234/export.xlsx` 或 `PUT /api/activities/ABC234/groups/g1/leader`
- **THEN** 後端回應 404

#### Scenario: 錯誤格式
- **WHEN** 組員（不是組長）送出答案
- **THEN** 後端回應 403，內容為 `{ "error": { "code": "NOT_LEADER", "message": ... } }`

### Requirement: 教師密碼驗證
後端 SHALL 只從環境變數 `TEACHER_PASSWORD` 讀取教師密碼；沒有設定時 SHALL 在啟動時隨機產生一組，只印在終端機。登入成功時 SHALL 發出 httpOnly 的 `teacher_session` Cookie。所有老師用的 REST 路徑與老師的 Socket.IO 連線，在沒有有效 session 時 SHALL 拒絕（REST 回應 401）。

#### Scenario: 密碼正確
- **WHEN** `POST /api/teacher/login` 帶正確密碼
- **THEN** 後端回應 204，設定 httpOnly 的 `teacher_session` Cookie；之後 `GET /api/teacher/session` 回傳 `authenticated: true`

#### Scenario: 密碼錯誤
- **WHEN** `POST /api/teacher/login` 帶錯誤密碼
- **THEN** 後端回應 401 `INVALID_PASSWORD`，不設定 Cookie

#### Scenario: 未登入呼叫老師路徑
- **WHEN** 沒有 `teacher_session` 時呼叫 `POST /api/sheets/import` 或 `POST /api/activities/ABC234/questions/q1/open`
- **THEN** 後端回應 401

#### Scenario: 未設定密碼
- **WHEN** 沒有設定 `TEACHER_PASSWORD` 就啟動後端
- **THEN** 終端機印出一組隨機密碼，可以用它登入

#### Scenario: 登出
- **WHEN** 老師呼叫 `POST /api/teacher/logout`
- **THEN** 原本的 `teacher_session` 失效，之後用它呼叫老師路徑都回應 401；使用它建立的 Socket.IO 連線也被中斷

### Requirement: 建立活動
後端 SHALL 以匯入結果的 `importId` 與組數建立活動。組數 MUST 是 2 到 20 的整數，否則回應 400 `INVALID_GROUP_COUNT`；`importId` 不存在時回應 404 `IMPORT_NOT_FOUND`。活動代號 SHALL 是 6 個字元、在目前所有活動中不重複；組別依序命名為「第 N 組」；題目與子填空完全來自該次匯入。成功時回應 201 與老師快照。

#### Scenario: 建立成功
- **WHEN** 老師用一份 6 題的匯入結果、組數 4 建立活動
- **THEN** 後端回應 201，老師快照有 6 題（全部為未開始、`round` 為 1）、4 組（第 1 組到第 4 組），以及試算表資訊

#### Scenario: 組數不合法
- **WHEN** 組數為 1、21 或 2.5
- **THEN** 後端回應 400 `INVALID_GROUP_COUNT`，沒有建立活動

#### Scenario: 匯入結果不存在
- **WHEN** 使用不存在的 `importId`
- **THEN** 後端回應 404 `IMPORT_NOT_FOUND`

### Requirement: 學生加入與身分
學生 SHALL 以活動代號與暱稱加入。暱稱 trim 後 MUST 為 1 到 20 個字，否則回應 400 `INVALID_NICKNAME`；代號不存在時回應 404 `ACTIVITY_NOT_FOUND`。第一次加入時後端 SHALL 發出 httpOnly 的 `client_id` Cookie；同一個 `client_id` 再次加入或重新取得快照時，SHALL 恢復原本的暱稱、組別與作答狀態。

#### Scenario: 第一次加入
- **WHEN** 學生以代號 `ABC234`、暱稱「小明」加入
- **THEN** 後端回應 200 與學生快照，設定 httpOnly 的 `client_id` Cookie，快照中 `me.groupId` 為 null

#### Scenario: 重新整理後恢復
- **WHEN** 已選第 2 組的學生帶同一個 `client_id` 呼叫 `GET /api/activities/ABC234/student`
- **THEN** 快照中的暱稱與組別和之前相同

#### Scenario: 沒有加入就取得快照
- **WHEN** 沒有 `client_id`，或 `client_id` 不屬於這個活動時呼叫 `GET /api/activities/ABC234/student`
- **THEN** 後端回應 401 `NOT_JOINED`

#### Scenario: 暱稱不合法
- **WHEN** 暱稱只有空白，或超過 20 個字
- **THEN** 後端回應 400 `INVALID_NICKNAME`

### Requirement: 題目狀態與輪次
後端 SHALL 讓每題在「未開始、進行中、已結束」之間轉換，同時最多一題進行中。開始只適用未開始的題目，結束只適用進行中的題目，重開只適用已結束的題目；不符合時回應 409 `INVALID_STATE`，已有其他題目進行中時回應 409 `ANOTHER_QUESTION_OPEN`。重開時 `round` SHALL 加 1，並清除該題的草稿與提交。

#### Scenario: 開始與結束
- **WHEN** 老師開始第 1 題，再結束第 1 題
- **THEN** 兩次都回應 204；第一次之後快照中第 1 題為進行中、`currentQuestionId` 為第 1 題；第二次之後第 1 題為已結束、`currentQuestionId` 為 null

#### Scenario: 已有題目進行中
- **WHEN** 第 1 題進行中，老師開始第 2 題或重開第 3 題
- **THEN** 後端回應 409 `ANOTHER_QUESTION_OPEN`，狀態不變

#### Scenario: 狀態不符
- **WHEN** 老師結束一題未開始的題目，或重開一題進行中的題目
- **THEN** 後端回應 409 `INVALID_STATE`

#### Scenario: 重開
- **WHEN** 第 1 題已結束且有 2 組送出，老師重開第 1 題
- **THEN** 第 1 題變為進行中、`round` 為 2，各組在第 1 題的提交與草稿都被清除，`results` 不再包含第 1 題

### Requirement: 選組與組別鎖定
學生 SHALL 可以選擇快照中的任一組；組別不存在時回應 400 `INVALID_GROUP`。第一題開始後組別 SHALL 鎖定：已有組別的學生換組時回應 409 `GROUP_LOCKED`；還沒有組別的學生仍可選一次。

#### Scenario: 開始前換組
- **WHEN** 第一題開始前，第 2 組的學生改選第 3 組
- **THEN** 後端回應 200，快照中的組別為第 3 組

#### Scenario: 開始後換組
- **WHEN** 第一題開始後，已有組別的學生換組
- **THEN** 後端回應 409 `GROUP_LOCKED`，組別不變

#### Scenario: 開始後才加入
- **WHEN** 第一題開始後才加入、還沒有組別的學生選第 1 組
- **THEN** 後端回應 200，該學生屬於第 1 組；之後再換組時回應 409 `GROUP_LOCKED`

### Requirement: 依在線狀態遞補組長
後端 SHALL 為每組保存一位現任組長（可以沒有），老師 MUST NOT 能指定或轉移。成員至少有一條 Socket.IO 連線才算在線。現任組長離線或換組時，SHALL 立即由同組在線且加入本組最早的成員接任；沒有在線成員時清空。沒有組長時，第一位在線的成員接任。現任組長在線期間，組長 MUST NOT 因其他成員上線而改變。

#### Scenario: 組長離線後立即遞補
- **WHEN** 第 1 組依加入順序有小明（組長）、小華、小美，小華離線、小美在線，接著小明的所有連線都中斷
- **THEN** 後端立即推送新快照，第 1 組的組長為小美

#### Scenario: 原組長回來不會拿回組長
- **WHEN** 小明離線後由小華接任，之後小明重新連線
- **THEN** 組長仍是小華

#### Scenario: 全組離線後第一位上線者接任
- **WHEN** 第 1 組全組離線，小華先重新連線，小明之後才連線
- **THEN** 小華成為組長；小明連線後，組長仍是小華

#### Scenario: 同一人開多個分頁
- **WHEN** 組長小明開著兩個分頁，關掉其中一個
- **THEN** 小明仍在線，組長不變

#### Scenario: 組長在開始前換組
- **WHEN** 第一題開始前，第 1 組組長小明換到沒有組長的第 2 組，第 1 組的小華在線
- **THEN** 第 1 組的組長改為小華，小明成為第 2 組的組長

#### Scenario: 只透過 REST 加入的學生
- **WHEN** 學生加入並選了一個沒有組長的組，但還沒有建立 Socket.IO 連線
- **THEN** 該組仍沒有組長；他第一次連線後才成為組長

### Requirement: 送出答案的驗證
後端 SHALL 依序檢查送出請求：題目不在進行中回應 409 `QUESTION_NOT_OPEN`；`round` 不是目前輪次回應 409 `STALE_ROUND`；送出者不是收到請求當下的現任組長回應 403 `NOT_LEADER`；本組已送出回應 409 `ALREADY_SUBMITTED`；答案與子填空不一一對應回應 400 `BLANKS_MISMATCH`；任一答案 trim 後為空回應 400 `BLANK_ANSWER`；超過 500 字回應 400 `ANSWER_TOO_LONG`。

#### Scenario: 成功送出
- **WHEN** 組長在目前輪次送出每個子填空都有內容的答案
- **THEN** 後端回應 201 `{ submittedAt }`，回應中沒有順位；保存的答案是 trim 之後的內容

#### Scenario: 只有特殊空白
- **WHEN** 某個答案只由半形空白、換行、全形空白（U+3000）或零寬字元（U+200B、U+200C、U+200D、U+FEFF）組成
- **THEN** 後端回應 400 `BLANK_ANSWER`，沒有保存提交

#### Scenario: 超過 500 字
- **WHEN** 某個答案 trim 後有 501 個字
- **THEN** 後端回應 400 `ANSWER_TOO_LONG`

#### Scenario: 子填空數量不符
- **WHEN** 題組有兩個子填空，請求只帶一個答案
- **THEN** 後端回應 400 `BLANKS_MISMATCH`

#### Scenario: 重開前的舊請求
- **WHEN** 第 1 題已重開為第 2 輪，組長送出 `round: 1` 的答案
- **THEN** 後端回應 409 `STALE_ROUND`

#### Scenario: 重複送出
- **WHEN** 組長在同一輪已送出後再次送出
- **THEN** 後端回應 409 `ALREADY_SUBMITTED`，原本的提交不變

### Requirement: 依接收順序給順位
後端 SHALL 依收到有效送出請求的先後，給每一題目前輪次的提交 1、2、3…的順位，順位 MUST NOT 重複或跳號，也 MUST NOT 依用戶端提供的任何時間決定。順位 1 的組為搶答成功。

#### Scenario: 多組同時送出
- **WHEN** 3 組組長幾乎同時送出同一題
- **THEN** 3 個請求都回應 201；題目結束後 `results` 中 3 組的順位為 1、2、3，各不相同，且與後端收到請求的先後一致

#### Scenario: 無人作答
- **WHEN** 題目結束時沒有任何組送出
- **THEN** `results` 中該題的 `submissions` 為空，`winnerGroupId` 為 null

### Requirement: 同組草稿
後端 SHALL 接受 `draft:update`，只在題目進行中、`round` 相符、送出者已選組且本組尚未送出時有效，否則以 `error` 事件回覆對應的錯誤碼。同一個子填空以最後收到的內容為準，`rev` 每次加 1。後端 SHALL 只把 `draft:updated` 推給同組學生，MUST NOT 推給他組或老師。

#### Scenario: 同組收到草稿
- **WHEN** 題目進行中，第 1 組的小明對（1）送出 `draft:update`
- **THEN** 第 1 組所有學生的連線收到 `draft:updated`，內容含 `rev` 與編輯者暱稱；第 2 組學生與老師都沒有收到

#### Scenario: 已送出後的草稿
- **WHEN** 第 1 組已送出本題後，組員送出 `draft:update`
- **THEN** 後端以 `error` 事件回覆 `ALREADY_SUBMITTED`，草稿不變

#### Scenario: 老師看到編輯中
- **WHEN** 第 1 組在本題收到第一筆草稿
- **THEN** 後端推送新快照，老師快照中第 1 組的目前狀態為 `editing`

### Requirement: 快照推送與版本
每個活動 SHALL 有遞增的整數 `version`。每次活動狀態改變（含成員上下線與組長改變），`version` SHALL 加 1，並對該活動的每一條連線各推送一次依角色產生的快照，讓正常情況下用戶端看到的版本號連續。收到 `snapshot:request` 時 SHALL 只對該連線回覆目前的快照。草稿內容的更新 MUST NOT 讓 `version` 遞增。

#### Scenario: 版本連續
- **WHEN** 學生依序看到老師開始第 1 題、組長送出、老師結束第 1 題
- **THEN** 學生收到的快照 `version` 每次加 1，沒有跳號

#### Scenario: 要求快照
- **WHEN** 學生送出 `snapshot:request`
- **THEN** 只有這條連線收到目前的學生快照，`version` 不變

#### Scenario: 上下線也會推送
- **WHEN** 學生關閉唯一的分頁
- **THEN** 老師收到新快照，該學生的 `online` 為 false

### Requirement: 快照的可見性
學生快照 MUST 只包含本人與本組的資料：題目結束前 MUST NOT 包含他組的答案、草稿、作答狀態或順位，也 MUST NOT 包含試算表網址、標題或任何儲存格位置。題目結束後，該題的所有提交與順位才出現在 `results`。老師快照 SHALL 包含各組成員、目前題目的作答狀態與提交、各題的 `cellRef`，以及試算表資訊。

#### Scenario: 進行中看不到他組
- **WHEN** 第 1 題進行中，第 2 組已送出
- **THEN** 推給第 1 組學生的快照中沒有第 2 組的答案、狀態或順位，`results` 不含第 1 題

#### Scenario: 學生看不到試算表
- **WHEN** 學生取得任何快照
- **THEN** 快照中沒有 `sheet`、試算表網址、標題或 `cellRef`

#### Scenario: 結束後公開結果
- **WHEN** 老師結束第 1 題
- **THEN** 所有學生收到的快照中，`results` 包含第 1 題各組的答案與順位

### Requirement: Socket.IO 連線驗證
後端 SHALL 依連線參數中的活動代號與角色，以及 Cookie 判斷身分：活動不存在、老師沒有有效 session、學生沒有加入這個活動時，SHALL 拒絕連線。

#### Scenario: 沒有加入的學生
- **WHEN** 沒有 `client_id` 的用戶端以學生身分連線到 `ABC234`
- **THEN** 連線被拒絕

#### Scenario: 沒有登入的老師
- **WHEN** 沒有 `teacher_session` 的用戶端以老師身分連線
- **THEN** 連線被拒絕

### Requirement: CSV 匯出
後端 SHALL 在 `GET /api/activities/:code/export.csv` 回傳已結束題目的結果，欄位為「題號、組別、答案、搶答順位」，每組提交一列，依題號與順位排序；題組的答案以子填空標籤加答案串接。回應 SHALL 使用 UTF-8（含 BOM），並以 `Content-Disposition` 指定檔名 `<活動代號>_results.csv`。

#### Scenario: 匯出 CSV
- **WHEN** 第 1 題已結束，第 2 組順位 1、第 1 組順位 2，老師下載 CSV
- **THEN** 檔名為 `ABC234_results.csv`，第一列為 `題號,組別,答案,搶答順位`，接著依序是第 2 組與第 1 組的資料

#### Scenario: 含逗號或換行的答案
- **WHEN** 某組答案含有逗號或雙引號
- **THEN** 該欄位以雙引號包住，內部雙引號重複一次，用試算表軟體開啟時內容完整

### Requirement: 不提供測試鉤子
後端 MUST NOT 提供 mock 的 `/__mock/*` 測試端點，也 MUST NOT 有任何能略過驗證、強制錯誤或修改狀態的隱藏路徑。

#### Scenario: 呼叫測試鉤子
- **WHEN** 呼叫 `POST /__mock/reset`
- **THEN** 後端回應 404，狀態不變

### Requirement: 不含機敏資訊
repo MUST NOT 含有任何真實密碼、金鑰或存取權杖；後端的設定範例只提交佔位值。後端 MUST NOT 在終端機輸出、錯誤回應或快照中出現教師密碼（隨機產生時的那一次除外）、Google 私鑰或存取權杖。

#### Scenario: 錯誤回應不洩漏憑證
- **WHEN** Google 回應任何錯誤，後端把它轉成錯誤回應
- **THEN** 回應中沒有私鑰、存取權杖或 Google 原始錯誤的完整內容，只有約定中的 `code`、`message`，以及需要時的 `details` 或 `shareWith`
