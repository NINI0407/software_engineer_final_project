<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, RestError } from '../api/rest'
import type { SheetImportPreview } from '../api/types'
import ShareWith from '../components/ShareWith.vue'
import { describeError } from '../lib/errors'

const router = useRouter()
const sheetUrl = ref('')
const preview = ref<SheetImportPreview | null>(null)
const importError = ref('')
const importShareWith = ref<string | null>(null)
const createError = ref('')
const importing = ref(false)
const creating = ref(false)
const groupCount = ref(6)
let importSeq = 0

// 網址格式由後端判斷；前端只擋空白
const canImport = computed(() => sheetUrl.value.trim().length > 0)

async function importSheet() {
  if (!canImport.value) return
  // 開始匯入就清掉上一份的預覽與錯誤，畫面不殘留任何題數或儲存格
  preview.value = null
  importError.value = ''
  importShareWith.value = null
  createError.value = ''
  const seq = ++importSeq
  importing.value = true
  try {
    const p = await api.importSheet(sheetUrl.value.trim())
    if (seq === importSeq) preview.value = p
  } catch (e) {
    if (seq !== importSeq) return
    const err = e instanceof RestError ? e : undefined
    importError.value = describeError(err?.code, err?.details, err?.shareWith).message
    importShareWith.value = err?.shareWith ?? null
  } finally {
    if (seq === importSeq) importing.value = false
  }
}

async function create() {
  if (!preview.value || creating.value) return
  creating.value = true
  createError.value = ''
  try {
    const snap = await api.createActivity(preview.value.importId, Number(groupCount.value))
    await router.push(`/teacher/board/${snap.activity.code}`)
  } catch (e) {
    createError.value = describeError(e instanceof RestError ? e.code : undefined).message
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <h1>建立搶答活動</h1>

  <section class="card stack">
    <h2>1. 匯入 Guided Notes（Google 試算表）</h2>
    <form class="row" style="flex-wrap: nowrap" @submit.prevent="importSheet">
      <input
        v-model="sheetUrl"
        type="url"
        inputmode="url"
        aria-label="Google 試算表網址"
        placeholder="貼上 Google 試算表網址，例如 https://docs.google.com/spreadsheets/d/…"
        data-testid="sheet-url-input"
      />
      <button class="primary" type="submit" :disabled="!canImport || importing" data-testid="import-btn">匯入</button>
    </form>
    <p class="muted">請先把試算表共用給本系統，讀取與寫回都由伺服器完成。</p>
    <p v-if="importing" class="muted">讀取並解析中…</p>
    <div v-if="importError" class="msg error stack" data-testid="import-error-box">
      <div data-testid="import-error" role="alert">{{ importError }}</div>
      <ShareWith v-if="importShareWith" :email="importShareWith" />
    </div>
  </section>

  <section v-if="preview" class="card stack" data-testid="preview">
    <h2>2. 確認解析結果</h2>
    <p>
      <span class="muted" data-testid="preview-title">{{ preview.spreadsheetTitle }} / {{ preview.worksheetTitle }}</span>
      <strong data-testid="preview-count" style="margin-left: 8px">共 {{ preview.questions.length }} 題</strong>
    </p>
    <ul v-if="preview.warnings.length" class="msg warn" data-testid="preview-warnings" style="margin: 0; padding-left: 28px">
      <li v-for="(w, i) in preview.warnings" :key="i">{{ w }}</li>
    </ul>
    <table>
      <thead>
        <tr><th style="width: 80px">題號</th><th>填空格</th></tr>
      </thead>
      <tbody>
        <tr v-for="q in preview.questions" :key="q.number" :data-testid="`preview-row-${q.number}`">
          <td>第 {{ q.number }} 題</td>
          <td>
            <div v-for="(b, i) in q.blanks" :key="i" data-testid="preview-blank">
              <span v-if="b.label">{{ b.label }} </span><code>{{ b.cellRef }}</code>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </section>

  <section class="card stack">
    <h2>3. 設定組數並建立活動</h2>
    <div style="max-width: 200px">
      <label for="groups">組數</label>
      <input id="groups" v-model.number="groupCount" type="number" min="2" max="20" data-testid="group-count" />
    </div>
    <p v-if="createError" class="msg error" data-testid="create-error" role="alert">{{ createError }}</p>
    <button class="primary" :disabled="!preview || creating || importing" data-testid="create-btn" @click="create">
      建立活動
    </button>
  </section>
</template>
