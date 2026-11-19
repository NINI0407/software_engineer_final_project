// 題組範本的 Grid 資料。
// 取自 samples/軟工期末專案_題組_範例.xlsx 的工作表「學習單」（值與合併範圍逐格轉寫）。
// 題號在 xlsx 中是數值 1.0；Google 的 formattedValue 會是 "1"，這裡依 Google 的格式寫成字串。

import { makeGrid } from './make-grid.js'

export const GROUP_SPREADSHEET_TITLE = '軟工期末專案_題組_範例'

/** 題組範本的儲存格值（A1 -> 文字），每次回傳新物件 */
export function groupValues() {
  return {
    B2: '計算機概論基礎 學習單',
    B4: '題號',
    C4: '題目',
    G4: '作答',
    B5: '1',
    C5: '根據文章第一段，小明升級的電腦「大腦」硬體，其英文簡稱是什麼？',
    G5: '（1）',
    C6: '而他安裝的 Windows 負責管理電腦的軟硬體資源，這種系統軟體統稱為什麼？',
    G6: '（2）',
    B8: '2',
    C8: '為了處理角色移動，小明設計了步驟明確的邏輯，這在程式設計中稱為什麼？',
    G8: '（1）',
    C9: '而他用來實作「上一步／復原」功能，採用了「後進先出」機制的資料結構，中文稱為什麼？',
    G9: '（2）',
    B11: '3',
    C11: '無論小明寫的高階語言多麼複雜，最終都會被轉換成由數字 1 和哪一個數字構成的二進位訊號？',
    B13: '4',
    C13: '專案最後的連線失敗，是因為小明的筆電沒有成功取得一組在網路世界中用來辨識身分的獨一無二之編碼，這個號碼被稱為什麼位址？',
  }
}

/** 題組範本的合併範圍（A1），每次回傳新陣列 */
export function groupMerges() {
  return [
    'B2:H2', 'C4:F4', 'G4:H4',
    'B5:B6', 'C5:F5', 'C6:F6',
    'B8:B9', 'C8:F8', 'C9:F9',
    'C11:F11', 'G11:H11',
    'C13:F13', 'G13:H13',
  ]
}

/** 題組範本的 Grid（sheetId 0、工作表「學習單」） */
export function groupGrid({ sheetId = 0, title = '學習單', index = 0 } = {}) {
  return makeGrid({ sheetId, title, index, values: groupValues(), merges: groupMerges() })
}

/** 題組範本的整份試算表 */
export function groupSpreadsheet() {
  return { spreadsheetTitle: GROUP_SPREADSHEET_TITLE, sheets: [groupGrid()] }
}
