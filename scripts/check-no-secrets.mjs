// 建置前端後掃描產出的檔案，確認沒有任何 Google 憑證、權杖或金鑰被打包進瀏覽器端程式。
// Google 試算表的讀寫都由後端完成，前端不應該出現任何憑證（change switch-to-online-google-sheets 的 design G1）。
// 用法：npm run check:secrets（找到時以非零狀態結束）；加上 --skip-build 只掃描現有的 dist/。

import { execSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = path.join(root, 'dist')

const PATTERNS = [
  ['service account 私鑰欄位', /private_key/],
  ['OAuth client secret', /client_secret/],
  ['Google OAuth 存取權杖', /ya29\.[0-9A-Za-z_-]{10,}/],
  ['Google API 金鑰', /AIza[0-9A-Za-z_-]{35}/],
  ['VITE_GOOGLE_ 環境變數', /VITE_GOOGLE_/],
]

if (!process.argv.includes('--skip-build')) {
  execSync('npx vite build --config web/vite.config.ts', { cwd: root, stdio: 'inherit' })
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) yield* walk(p)
    else yield p
  }
}

const findings = []
for (const file of walk(dist)) {
  const text = readFileSync(file, 'latin1')
  for (const [label, re] of PATTERNS) {
    if (re.test(text)) findings.push(`${path.relative(root, file)}：${label}`)
  }
}

// .env 範本與本機 .env 都不得宣告會被 Vite 打包的 Google 變數（只看變數名稱，不讀取或印出值）
for (const name of ['.env.example', '.env']) {
  let text
  try {
    text = readFileSync(path.join(root, name), 'utf8')
  } catch {
    continue
  }
  for (const line of text.split(/\r?\n/)) {
    const key = line.split('=')[0].trim()
    if (/^VITE_GOOGLE_/.test(key)) findings.push(`${name}：宣告了 ${key}`)
  }
}

// repo 中的檔案（已追蹤，以及尚未追蹤但沒有被忽略、可能會被提交的檔案）不得含有 service account 私鑰
// （change build-quiz-backend，design B8）。說明文件與這支腳本本身會提到欄位名稱，所以排除。
const REPO_PATTERNS = [
  ['service account 金鑰的 private_key 欄位', /"private_key"\s*:/],
  ['PEM 私鑰', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
]
const REPO_EXCLUDE = [/^scripts\/check-no-secrets\.mjs$/, /^openspec\//]

function repoFiles() {
  const out = execSync('git ls-files -z --cached --others --exclude-standard', { cwd: root, encoding: 'utf8' })
  return [...new Set(out.split('\0').filter(Boolean))]
}

for (const rel of repoFiles()) {
  if (REPO_EXCLUDE.some((re) => re.test(rel))) continue
  let text
  try {
    text = readFileSync(path.join(root, rel), 'latin1')
  } catch {
    continue // 已刪除但尚未提交的檔案
  }
  for (const [label, re] of REPO_PATTERNS) {
    if (re.test(text)) findings.push(`${rel}：${label}`)
  }
}

if (findings.length) {
  console.error('發現可能的憑證或不允許的環境變數：')
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(
  `check:secrets 通過：已掃描 dist/ 與 repo 中的檔案，沒有發現 Google 憑證、私鑰、權杖或 VITE_GOOGLE_ 變數。`,
)
