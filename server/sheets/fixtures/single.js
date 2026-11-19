// 單題範本的 Grid 資料。
// 取自 samples/軟工期末專案_單題_範例.xlsx 的工作表「學習單」（值與合併範圍逐格轉寫）。
// 題號在 xlsx 中是數值 1.0；Google 的 formattedValue 會是 "1"，這裡依 Google 的格式寫成字串。

import { makeGrid } from './make-grid.js'

export const SINGLE_SPREADSHEET_TITLE = '軟工期末專案_單題_範例'

/** 單題範本的儲存格值（A1 -> 文字），每次回傳新物件 */
export function singleValues() {
  return {
    B2: '計算機概論基礎 學習單',
    B4: '題號',
    C4: '題目',
    G4: '作答',
    B5: '1',
    C5: '電腦系統中負責執行程式指令、處理資料的核心硬體元件，通常被稱為電腦的大腦，它的英文縮寫是什麼？',
    B7: '2',
    C7: '電腦底層處理的所有資料與指令，最終都會轉換為由數字 1 與哪一個數字所組成的二進位 (Binary) 系統？',
    B9: '3',
    C9: '在網際網路中，每一台連上網路的設備都需要一個獨一無二的識別號碼以便互相通訊，這個號碼被稱為什麼位址 (Address)？',
    B11: '4',
    C11: '負責管理電腦硬體資源並提供應用程式執行環境的系統軟體（例如 Windows、macOS 或 Linux），我們統稱為什麼？',
    B13: '5',
    C13: '有一種資料結構的特性是「後進先出」(Last-In, First-Out, LIFO)，就像是疊盤子一樣，最後放上去的盤子會最先被拿走，這種資料結構稱為什麼？',
    B15: '6',
    C15: '在撰寫程式時，解決特定問題的明確步驟與規則集合，我們稱之為什麼 (Algorithm)？',
  }
}

/** 單題範本的合併範圍（A1），每次回傳新陣列 */
export function singleMerges() {
  return [
    'B2:H2', 'B3:H3', 'C4:F4', 'G4:H4',
    'C5:F5', 'G5:H5', 'B6:H6',
    'C7:F7', 'G7:H7', 'B8:H8',
    'C9:F9', 'G9:H9', 'B10:H10',
    'C11:F11', 'G11:H11', 'B12:H12',
    'C13:F13', 'G13:H13', 'B14:H14',
    'C15:F15', 'G15:H15',
  ]
}

/** 單題範本的 Grid（sheetId 0、工作表「學習單」） */
export function singleGrid({ sheetId = 0, title = '學習單', index = 0 } = {}) {
  return makeGrid({ sheetId, title, index, values: singleValues(), merges: singleMerges() })
}

/** 單題範本的整份試算表 */
export function singleSpreadsheet() {
  return { spreadsheetTitle: SINGLE_SPREADSHEET_TITLE, sheets: [singleGrid()] }
}
