// 測試用的 Grid 產生工具（design S2 的 Grid 格式）。
// fixture 用 A1 表示法撰寫，比較好對照試算表；這裡轉成從 0 起算的 cells 與 merges。

/** 'G5' -> { row: 4, col: 6 } */
export function parseA1(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)
  if (!m) throw new Error(`不是有效的 A1 位置：${ref}`)
  let col = 0
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { row: Number(m[2]) - 1, col: col - 1 }
}

/** 'G4:H4' -> { r0: 3, r1: 4, c0: 6, c1: 8 }（r1、c1 不含，與 Google GridRange 相同） */
export function parseRange(range) {
  const [from, to = from] = range.split(':')
  const a = parseA1(from)
  const b = parseA1(to)
  return {
    r0: Math.min(a.row, b.row),
    r1: Math.max(a.row, b.row) + 1,
    c0: Math.min(a.col, b.col),
    c1: Math.max(a.col, b.col) + 1,
  }
}

/** 從 0 起算的欄列轉回 A1，例如 (4, 6) -> 'G5' */
export function a1(row, col) {
  let letters = ''
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters
  }
  return `${letters}${row + 1}`
}

/** 把 A1 位置平移 dRows 列、dCols 欄 */
export function shiftA1(ref, dRows, dCols) {
  const { row, col } = parseA1(ref)
  return a1(row + dRows, col + dCols)
}

/** 把 A1 範圍平移 dRows 列、dCols 欄 */
export function shiftRange(range, dRows, dCols) {
  return range
    .split(':')
    .map((ref) => shiftA1(ref, dRows, dCols))
    .join(':')
}

/**
 * 平移一份版面（values 與 merges 一起移動）。
 * @param {{ values: Record<string, string|number>, merges: string[] }} layout
 */
export function shiftLayout({ values, merges }, dRows, dCols) {
  return {
    values: Object.fromEntries(Object.entries(values).map(([ref, v]) => [shiftA1(ref, dRows, dCols), v])),
    merges: merges.map((range) => shiftRange(range, dRows, dCols)),
  }
}

/**
 * 回傳覆寫後的新 values；覆寫值為 null 時刪除該格。
 * @param {Record<string, string|number>} values
 * @param {Record<string, string|number|null>} overrides
 */
export function withValues(values, overrides) {
  const out = { ...values }
  for (const [ref, v] of Object.entries(overrides)) {
    if (v === null) delete out[ref]
    else out[ref] = v
  }
  return out
}

/**
 * 產生新的 Grid 物件。數值會轉成字串（Google 的 formattedValue 是字串）。
 * cells 只排到有值的最後一列；每列只排到該列有值的最後一欄（模擬 Google 省略尾端空白）。
 * @param {{ sheetId: number, title: string, index?: number,
 *           values?: Record<string, string|number>, merges?: string[] }} spec
 * @returns {{ sheetId: number, title: string, index: number, cells: string[][],
 *             merges: { r0: number, r1: number, c0: number, c1: number }[] }}
 */
export function makeGrid({ sheetId, title, index = 0, values = {}, merges = [] }) {
  const cells = []
  for (const [ref, v] of Object.entries(values)) {
    const { row, col } = parseA1(ref)
    while (cells.length <= row) cells.push([])
    const line = cells[row]
    while (line.length <= col) line.push('')
    line[col] = String(v)
  }
  return { sheetId, title, index, cells, merges: merges.map(parseRange) }
}
