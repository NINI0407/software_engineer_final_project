<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, RestError } from '../api/rest'
import type { UploadPreview } from '../api/types'
import { describeError } from '../lib/errors'

const router = useRouter()
const preview = ref<UploadPreview | null>(null)
const uploadError = ref('')
const createError = ref('')
const uploading = ref(false)
const creating = ref(false)
const groupCount = ref(6)
let uploadSeq = 0

async function onFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  // 換檔時先清掉上一份的預覽，畫面不殘留任何題數或儲存格
  preview.value = null
  uploadError.value = ''
  createError.value = ''
  if (!file) return
  const seq = ++uploadSeq
  uploading.value = true
  try {
    const p = await api.upload(file)
    if (seq === uploadSeq) preview.value = p
  } catch (e) {
    if (seq !== uploadSeq) return
    const err = e instanceof RestError ? e : undefined
    uploadError.value = describeError(err?.code, err?.details).message
  } finally {
    if (seq === uploadSeq) uploading.value = false
  }
}

async function create() {
  if (!preview.value || creating.value) return
  creating.value = true
  createError.value = ''
  try {
    const snap = await api.createActivity(preview.value.uploadId, Number(groupCount.value))
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
    <h2>1. 上傳 Guided Notes（.xlsx）</h2>
    <input type="file" accept=".xlsx" data-testid="upload-input" @change="onFile" />
    <p v-if="uploading" class="muted">上傳並解析中…</p>
    <p v-if="uploadError" class="msg error" data-testid="upload-error" role="alert">{{ uploadError }}</p>
  </section>

  <section v-if="preview" class="card stack" data-testid="preview">
    <h2>2. 確認解析結果</h2>
    <p>
      <span class="muted">{{ preview.fileName }}</span>
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
    <button class="primary" :disabled="!preview || creating || uploading" data-testid="create-btn" @click="create">
      建立活動
    </button>
  </section>
</template>
