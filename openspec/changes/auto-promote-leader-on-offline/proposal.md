# Proposal

## Why

目前組長固定是「加入順序最早的組員」，或老師手動指定的人，判定時完全不看在線狀態。組長斷線、關掉分頁或手機休眠時，整組就沒有人能送出答案，只能等老師發現後手動轉移。這個 change 改成由系統在組長離線時立即遞補，讓搶答不會因為單一學生斷線而卡住。本 change 主要是要跟 speckit 組對齊。

## What Changes

- **組長自動遞補**：組長離線（所有連線都中斷）時，立即由同組「在線且加入順序最早」的組員接任，不設等待秒數。
- **組長不會自動還回**：遞補後，原組長或加入順序更早的人重新上線，仍維持現任組長。組長只會在現任組長離線或離開本組時更換。
- **全組離線時沒有組長**：同組沒有任何在線成員可以接任時，組長清空。之後第一位上線的成員成為組長。
- **重新整理不保證恢復組長**：學生重新整理後仍以 `client_id` 恢復原本的身分、組別與作答狀態。但重新整理會讓連線中斷，如果期間有其他在線組員，組長會遞補給對方，所以不保證恢復組長資格。
- **BREAKING：移除老師手動指定組長**：刪除看板上的「轉移組長給…」選單與「設為組長」按鈕，以及 `PUT /api/activities/:code/groups/:gid/leader` 和錯誤碼 `NOT_A_MEMBER`。組長完全由系統依上述規則決定。
- **看板顯示無組長**：看板繼續顯示成員在線狀態與組長標示；某組有成員但目前沒有組長時，顯示「目前無組長」。
- **維持現狀**：草稿最後寫入者勝出；第一題開始前可以換組，換組時一併交接組長（離開的組長由原組遞補）；重開題目建立新一輪，清除草稿與提交。
- 一併更新相關文件：README 的介面約定說明與 `/__mock/presence` 說明。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `mock-backend`：「模擬基本規則」的組長規則改為離線遞補、不自動還回、全組離線時清空；「依介面約定 v1 回應」補上轉移組長路徑已移除。
- `teacher-console`：「組員名單、組長在線狀態與轉移組長」改為只顯示，不能轉移組長，並加上「目前無組長」的顯示。
- `student-participation`：「只有組長能送出」的 403 情境改為組長因離線被遞補，並補上組員遞補成為組長後可以送出的情境。
- `live-state-sync`：「重連後恢復正確狀態」的「重新整理頁面」情境改為恢復身分，但組長以快照為準、不保證恢復。

## Impact

- **介面約定**：移除 `PUT /api/activities/:code/groups/:gid/leader` 與 `NOT_A_MEMBER`；`Member.isLeader` 與 `me.isLeader` 的語意改為「依遞補規則決定」，每組最多一位、可以沒有。快照格式不變。後端組需要依 design.md 對齊。
- **mock 後端**：`mock/server.js` 的組長判定、連線與斷線處理、換組、`/__mock/presence`。
- **前端**：`web/src/pages/TeacherBoard.vue`、`web/src/api/rest.ts`、`web/src/lib/errors.ts`、`web/src/store/view.ts`。學生端 `Play.vue` 原本就依快照顯示組長，不需要改邏輯。
- **測試**：`mock/server.test.js`（學生需要有連線才算在線）、`web/src/**/*.test.ts`、`e2e/student.spec.ts`、`e2e/teacher.spec.ts`、`e2e/sync.spec.ts`。
- **文件**：`README.md`。
