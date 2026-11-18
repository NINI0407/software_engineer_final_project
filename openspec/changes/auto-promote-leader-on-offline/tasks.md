# Tasks

## 1. mock：組長遞補規則

- [x] 1.1 在 `mock/testkit.js` 與 `mock/server.test.js` 調整學生輔助函式（design L6）：`student()` 預設建立 Socket.IO 連線讓學生在線，提供不連線的選項，並在每個測試結束時關閉連線。先在目前的規則下執行 `npm test -- mock`，確認既有 mock 測試仍然通過（實作時輔助函式只放在 `mock/server.test.js`，連線沿用 `testkit.connect`，`testkit.js` 不需要修改）
- [x] 1.2 在 `mock/server.js` 把組長改成每組保存的狀態（design L1）：移除 `leaderOverride` 與現算的 `leaderId()`，新增判定函式，在「成員變在線、變離線、換組、presence 改變」時依 L1 的表格更新組長，並和 `bump()` 放在同一個同步區塊；`memberView()`、`studentSnapshot()` 與送出時的 `NOT_LEADER` 檢查改讀保存的組長。在 `mock/server.test.js` 為 spec「依在線狀態遞補組長」的每個 Scenario 各寫一個測試（立即遞補、原組長回來不拿回、全組離線、全組離線後第一位上線者接任、多分頁、presence 鉤子、開始前換組、離線成員選組、遞補後由新組長送出），並確認通過
- [x] 1.3 移除 `PUT /api/activities/:code/groups/:gid/leader` 與 `NOT_A_MEMBER`。改寫 `mock/server.test.js` 的「轉移組長與匯出 CSV」：拿掉轉移組長的部分，改驗證該路徑回 404；確認「組長為最早加入該組的人；換組……」測試在新規則下仍然成立（必要時改名），並確認 `npm test -- mock` 全部通過

## 2. 前端：移除手動指定、顯示無組長

- [x] 2.1 在 `web/src/api/rest.ts` 移除 `setLeader`，在 `web/src/lib/errors.ts` 移除 `NOT_A_MEMBER`，並同步更新 `rest.test.ts` 與 `errors.test.ts`；在 `web/src/api/types.ts` 的 `Member`、`StudentSnapshot.me` 註解寫明 `isLeader` 每組最多一位、可以沒有。執行 `npm run typecheck` 與 `npm test -- web`，確認通過
- [x] 2.2 在 `web/src/store/view.ts` 移除 `teacherButtons.canSetLeader`，新增純函式判斷「有成員但沒有組長」；在 `view.test.ts` 刪除「設為組長」測試，並為新函式加上測試（有組長、全組離線沒有組長、沒有成員）。執行 `npm test -- web`，確認通過
- [x] 2.3 在 `web/src/pages/TeacherBoard.vue` 移除 `leaderPick`、`setLeader`、`leader-select`、`leader-btn`，並在符合 2.2 條件的組顯示「目前無組長」（`data-testid="no-leader"`）。用 `npm run dev` 開兩個學生分頁加入同一組，關掉組長的分頁，確認看板改標另一人為組長；兩個都關掉時顯示「目前無組長」（實作時改以 e2e 驗證：3.1 用 presence 鉤子驗證看板，3.3 以實際關閉分頁驗證遞補）

## 3. e2e

- [x] 3.1 改寫 `e2e/teacher.spec.ts` 的「組長離線標示與轉移組長」：涵蓋 teacher-console spec「組員名單、在線狀態與組長標示」的每個 Scenario（組長離線後改標新組長、離線標示、全組離線顯示「目前無組長」、沒有轉移組長的操作）。用 presence 鉤子控制在線狀態。執行 `npm run test:e2e -- e2e/teacher.spec.ts`，確認通過
- [x] 3.2 改寫 `e2e/student.spec.ts` 的「收到 403」：依 design L6，延遲推送快照後用 presence 鉤子讓組長離線，舊組長送出時看到「只有組長能送出」；新增「遞補成為組長」：組員停在作答畫面，組長離線後約一秒內出現可用的送出鈕，草稿不變。檢查其他使用 `{ open: false }` 的測試，在新規則下是否仍依預期決定誰是組長。執行 `npm run test:e2e -- e2e/student.spec.ts`，確認通過
- [x] 3.3 改寫 `e2e/sync.spec.ts` 的「已送出的組長重新整理：恢復為已送出畫面，組長身分不變」：改為 live-state-sync spec 的三個 Scenario（只有自己在線時重新整理仍是組長且恢復已送出畫面、重新整理時組長被遞補給在線的組員、身分與組別恢復）。執行 `npm run test:e2e -- e2e/sync.spec.ts`，確認通過

## 4. 文件

- [x] 4.1 更新 `README.md`：開頭的介面約定說明改指向已封存的 `openspec/changes/archive/2026-11-18-switch-to-online-google-sheets/design.md`（G2），並註明本 change design.md 的 L4 是組長相關的差異；`/__mock/presence` 的說明加上「會觸發組長遞補」；新增一段組長規則說明（離線立即遞補、不自動還回、全組離線時無組長、重新整理不保證恢復組長，以及異常斷線要等 Socket.IO 心跳逾時才會被偵測）。逐條對照 spec，確認 README 的描述沒有矛盾，`npm run check:secrets` 通過

## 5. 整合驗證

- [x] 5.1 執行 `npm run typecheck`、`npm test`、`npm run test:e2e`、`npm run build`、`npm run check:secrets`，全部通過；並用 `grep` 確認 `web/`、`mock/`、`e2e/` 中沒有殘留 `setLeader`、`leaderOverride`、`NOT_A_MEMBER`、`leader-select`、`leader-btn`

## Workflow follow-up


- 實作完成並通過驗證後，執行 `/openspec-verify-change`，再執行 `/openspec-archive-change auto-promote-leader-on-offline`。
