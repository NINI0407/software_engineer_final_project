## ADDED Requirements

### Requirement: 組員名單、在線狀態與組長標示
看板 SHALL 依快照顯示各組成員的暱稱與在線狀態，並標示組長。組長由後端依在線狀態決定，看板 MUST NOT 提供轉移或指定組長的操作。某組有成員但快照中沒有任何成員是組長時，看板 SHALL 在該組顯示「目前無組長」。

#### Scenario: 組長離線後看板改標新組長
- **WHEN** 第 1 組組長小明離線，後端推送的新快照中小明的 `online` 為 false、小華的 `isLeader` 為 true
- **THEN** 看板約一秒內在小明旁顯示離線標示，並改為標示小華是組長

#### Scenario: 離線標示
- **WHEN** 快照中第 1 組某位成員的 `online` 為 false
- **THEN** 看板在該成員旁顯示離線標示

#### Scenario: 全組離線
- **WHEN** 快照中第 1 組有兩位成員，都離線，且沒有人的 `isLeader` 為 true
- **THEN** 看板在第 1 組顯示「目前無組長」

#### Scenario: 沒有轉移組長的操作
- **WHEN** 老師開啟看板
- **THEN** 畫面上沒有「轉移組長給…」選單或「設為組長」按鈕

## REMOVED Requirements

### Requirement: 組員名單、組長在線狀態與轉移組長
**Reason**: 組長改由後端在組長離線時自動遞補，老師不再手動指定組長。
**Migration**: 改用「組員名單、在線狀態與組長標示」；前端移除 `PUT /api/activities/:code/groups/:gid/leader` 的呼叫。
