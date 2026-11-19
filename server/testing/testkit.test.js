// 整合測試工具的冒煙測試（task 4.1）：可以啟動並關閉伺服器，完成一次匯入與建立活動。
import { describe, expect, it } from 'vitest'
import { singleSpreadsheet } from '../sheets/fixtures/single.js'
import { startServer } from './testkit.js'

describe('整合測試工具', () => {
  it('啟動正式後端（fake-sheets），老師可以匯入並建立活動，學生可以連線', async () => {
    const srv = await startServer({ spreadsheets: { single: singleSpreadsheet() } })
    try {
      const t = await srv.teacher()
      const snap = await srv.createActivity(t, 'single', 3)
      expect(snap.questions).toHaveLength(6)
      expect(snap.questions[0].blanks[0].cellRef).toBe('學習單!G5')
      const s = await srv.student(snap.activity.code, '小明', 'g1')
      expect(s.conn.socket.connected).toBe(true)
      expect(srv.fake.calls.read).toBe(1)
    } finally {
      await srv.close()
    }
  })
})
