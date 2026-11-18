<script setup lang="ts">
// 寫回線上試算表（design G4、G5）：
// 按「寫回試算表」→ 確認視窗（只依當下快照呈現，並固定那時的 version）→ 確認後才送出請求。
// 要寫到哪一份試算表、哪幾格都由後端決定；前端只送 basedOnVersion，不接觸任何 Google 憑證。
import { computed, ref } from 'vue'
import { api, RestError } from '../api/rest'
import type { ExportToSheetResult, TeacherSnapshot } from '../api/types'
import { describeError } from '../lib/errors'
import { requestResync } from '../store'
import { hasSheetWrites, sheetWritePlan, type SheetWriteItem } from '../store/view'
import ShareWith from './ShareWith.vue'

const props = defineProps<{ code: string; snap: TeacherSnapshot; connected: boolean }>()

const confirm = ref<{ items: SheetWriteItem[]; version: number } | null>(null)
const exporting = ref(false)
const result = ref<ExportToSheetResult | null>(null)
const error = ref<{ message: string; shareWith: string | null } | null>(null)

const canOpen = computed(() => props.connected && !exporting.value && hasSheetWrites(props.snap))
const sheetUrl = computed(() => result.value?.sheetUrl ?? props.snap.sheet.url)
const lastExported = computed(() =>
  props.snap.sheet.lastExportedAt ? new Date(props.snap.sheet.lastExportedAt).toLocaleString('zh-TW') : '尚未寫回',
)

function openConfirm() {
  if (!canOpen.value) return
  // 打開的當下固定內容與版本；之後快照更新（例如學生上下線）不影響視窗
  // 快照是 Vue 的 reactive proxy，structuredClone 無法複製，改用 JSON 取得純資料副本
  const items = JSON.parse(JSON.stringify(sheetWritePlan(props.snap))) as SheetWriteItem[]
  confirm.value = { items, version: props.snap.version }
  result.value = null
  error.value = null
}

function cancel() {
  confirm.value = null
}

async function submit() {
  if (!confirm.value || exporting.value || !props.connected) return
  exporting.value = true
  const basedOnVersion = confirm.value.version
  try {
    result.value = await api.exportToSheet(props.code, basedOnVersion)
  } catch (e) {
    const err = e instanceof RestError ? e : undefined
    const info = describeError(err?.code, err?.details, err?.shareWith)
    error.value = { message: info.message, shareWith: err?.shareWith ?? null }
    // STALE_VERSION、NOTHING_TO_EXPORT：取得最新快照，請老師重新確認；不自動重送
    if (info.action === 'resync') requestResync()
  } finally {
    exporting.value = false
    confirm.value = null
  }
}

const skippedText = (nums: number[]) => `第 ${nums.join('、')} 題未寫入`
</script>

<template>
  <section class="card stack" data-testid="sheet-export">
    <div class="row" style="justify-content: space-between">
      <h2 style="margin: 0">線上試算表</h2>
      <div class="row">
        <button class="primary" :disabled="!canOpen" data-testid="export-sheet-btn" @click="openConfirm">
          {{ exporting ? '寫回中…' : '寫回試算表' }}
        </button>
        <a class="btn" :href="api.exportCsvUrl(code)" download data-testid="export-csv">下載 CSV</a>
      </div>
    </div>
    <div class="muted">
      <a :href="sheetUrl" target="_blank" rel="noopener noreferrer" data-testid="sheet-link">
        {{ snap.sheet.spreadsheetTitle }} / {{ snap.sheet.worksheetTitle }}
      </a>
      ・上次寫回：<span data-testid="last-exported">{{ lastExported }}</span>
    </div>

    <div v-if="result" class="msg info stack" data-testid="export-result" role="status">
      <div>
        已寫入 {{ result.writtenCells }} 格<template v-if="result.skippedQuestions.length">；{{ skippedText(result.skippedQuestions) }}</template>
      </div>
      <a :href="result.sheetUrl" target="_blank" rel="noopener noreferrer" data-testid="export-result-link">開啟試算表</a>
    </div>
    <div v-if="error" class="msg error stack" data-testid="export-error-box">
      <div data-testid="export-error" role="alert">{{ error.message }}</div>
      <ShareWith v-if="error.shareWith" :email="error.shareWith" />
    </div>

    <div v-if="confirm" class="overlay" @click.self="cancel">
      <div class="card stack dialog" role="dialog" aria-modal="true" aria-labelledby="export-confirm-title" data-testid="export-confirm">
        <h2 id="export-confirm-title">確認寫回試算表</h2>
        <div class="muted">
          目標：{{ snap.sheet.spreadsheetTitle }} / {{ snap.sheet.worksheetTitle }}・上次寫回：{{ lastExported }}
        </div>
        <table>
          <thead>
            <tr><th style="width: 72px">題號</th><th style="width: 96px">搶答成功</th><th>答案與寫入位置</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in confirm.items" :key="item.question.id" :data-testid="`export-item-${item.question.number}`">
              <td>第 {{ item.question.number }} 題</td>
              <template v-if="item.kind === 'write'">
                <td>{{ item.groupName }}</td>
                <td>
                  <div v-for="c in item.cells" :key="c.cellRef" data-testid="export-cell">
                    <span v-if="c.label">{{ c.label }} </span>{{ c.text }} → <code>{{ c.cellRef }}</code>
                  </div>
                </td>
              </template>
              <td v-else colspan="2" class="muted" data-testid="export-skip">
                {{
                  item.kind === 'noAnswer'
                    ? '本題無人作答，不寫入'
                    : item.kind === 'open'
                      ? '進行中，不寫入'
                      : '未開始，不寫入'
                }}
              </td>
            </tr>
          </tbody>
        </table>
        <p class="msg warn" data-testid="export-overwrite-warning">將覆寫這些儲存格的現有內容</p>
        <div class="row" style="justify-content: flex-end">
          <button type="button" data-testid="export-confirm-cancel" @click="cancel">取消</button>
          <button class="primary" type="button" :disabled="exporting || !connected" data-testid="export-confirm-ok" @click="submit">
            {{ exporting ? '寫回中…' : '確認寫回' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(20, 24, 33, 0.45);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 48px 16px;
  overflow-y: auto;
  z-index: 10;
}
.dialog {
  width: 100%;
  max-width: 720px;
  margin: 0;
}
</style>
