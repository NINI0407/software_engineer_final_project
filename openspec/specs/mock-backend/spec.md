# mock-backend Specification

## Purpose

提供只在本機執行的開發與測試用 mock 後端。它依「前端介面約定 v0」回應 REST 與 Socket.IO，並提供可重現的情境腳本，讓前端在真正的後端完成前就能開發，並執行自動化驗收。

## Requirements

### Requirement: 依介面約定 v0 回應
mock 後端 SHALL 實作 design.md 中介面約定 v0 的所有 REST 路徑、錯誤碼、快照格式與 Socket.IO 事件，讓前端在不修改程式的情況下，能從 mock 切換到真正的後端。

#### Scenario: 完整流程
- **WHEN** 依序執行老師登入、上傳、建立活動、學生加入並選組、開始題目、組長送出、結束題目
- **THEN** 每個請求都得到約定中定義的成功回應，學生與老師也收到符合約定格式的快照

#### Scenario: 錯誤碼
- **WHEN** 組員送出答案
- **THEN** mock 回應 403，內容為 `{ "error": { "code": "NOT_LEADER", "message": ... } }`

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

### Requirement: 解析預覽使用固定資料
mock 後端 SHALL NOT 真的解析 Excel。上傳時 SHALL 依上傳檔名選擇內建的預覽資料：「單題」6 題、「題組」4 題（含子填空）、「變體」9 題（儲存格位置不同）。檔名含 `invalid` 時回應 422 `PARSE_FAILED`；副檔名不是 `.xlsx` 時回應 400 `NOT_XLSX`。匯出時 SHALL 回傳附有 `Content-Disposition` 檔名的佔位檔案。

#### Scenario: 上傳題組範本
- **WHEN** 上傳 `samples/軟工期末專案_題組_範例.xlsx`
- **THEN** mock 回傳 4 題的預覽，第 1、2 題各有標籤「（1）」「（2）」兩個子填空

#### Scenario: 匯出
- **WHEN** 請求 `GET /api/activities/ABC234/export.csv`
- **THEN** mock 回應的 `Content-Disposition` 檔名為 `ABC234_results.csv`

### Requirement: 情境腳本
mock 後端 SHALL 只在測試模式（環境變數 `MOCK_TEST_HOOKS=1`）提供 `/__mock` 控制端點，用來重設狀態，以及觸發測試需要的情境：讓某個成員離線或上線、強制下一次換組回應 409、跳過若干個版本號後推送快照、延遲推送快照、中斷指定的 Socket.IO 連線。這些端點 MUST NOT 在非測試模式下啟用。

#### Scenario: 重設狀態
- **WHEN** 測試開始前呼叫 `POST /__mock/reset`
- **THEN** mock 清空所有活動、上傳與連線狀態

#### Scenario: 非測試模式
- **WHEN** 沒有設定 `MOCK_TEST_HOOKS=1` 時呼叫 `/__mock/reset`
- **THEN** mock 回應 404

### Requirement: 不含機敏資訊
mock 後端 SHALL 從環境變數 `TEACHER_PASSWORD` 讀取教師密碼。沒有設定時 SHALL 在啟動時隨機產生一組密碼，並只印在終端機。repo 中 MUST NOT 有任何真實密碼，只提交只含佔位值的 `.env.example`。

#### Scenario: 未設定密碼
- **WHEN** 沒有 `.env` 也沒有設定 `TEACHER_PASSWORD` 就啟動 mock
- **THEN** 終端機印出一組隨機密碼，可以用它登入；repo 中沒有出現這組密碼
