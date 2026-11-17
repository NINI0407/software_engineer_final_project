<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, RestError } from '../api/rest'
import type { Question, Snapshot, StudentSnapshot } from '../api/types'
import { DraftField } from '../lib/draftField'
import { describeError } from '../lib/errors'
import { formatAnswers, groupName } from '../lib/format'
import { readGroupCookie, syncGroupCookie, writeGroupCookie } from '../lib/groupCookie'
import { FIELD_ERROR_TEXT, validateAnswers, validateField } from '../lib/validate'
import { applySnapshot, onSnapshot, requestResync, store } from '../store'
import { onDraftUpdated, sendDraft, startLive, stopLive } from '../store/live'
import { canChangeGroup, studentView } from '../store/view'

const route = useRoute()
const router = useRouter()
const code = String(route.params.code).toUpperCase()

const loadError = ref('')
const message = ref('')
const ss = computed(() => (store.role === 'student' ? (store.snapshot as StudentSnapshot | null) : null))
const view = computed(() => (ss.value ? studentView(ss.value, store.ui.lastClosedQuestionId) : null))
const connected = computed(() => store.ui.connected)

// ---------- 組別 ----------
const selectedGroup = ref('')
const changingGroup = ref(false)
const groupSelectable = computed(() => !!ss.value && canChangeGroup(ss.value) && !changingGroup.value && connected.value)

async function changeGroup(gid: string) {
  const s = ss.value
  if (!s || !gid || changingGroup.value || gid === s.me.groupId) return
  changingGroup.value = true
  message.value = ''
  try {
    const res = await api.setGroup(code, gid)
    applySnapshot(res)
    if (res.me.groupId) writeGroupCookie(code, res.me.groupId)
    selectedGroup.value = res.me.groupId ?? ''
  } catch (e) {
    const info = describeError(e instanceof RestError ? e.code : undefined)
    message.value = info.message
    // 恢復成後端快照中的組別（下拉選單與 Cookie）
    const back = ss.value?.me.groupId ?? null
    selectedGroup.value = back ?? ''
    if (back) writeGroupCookie(code, back)
    requestResync()
  } finally {
    changingGroup.value = false
  }
}

function onGroupSelect(ev: Event) {
  const gid = (ev.target as HTMLSelectElement).value
  selectedGroup.value = gid
  // 已經有組別時，選擇即換組；還沒有組別時按「加入此組」
  if (ss.value?.me.groupId) changeGroup(gid)
}

// ---------- 作答欄位與草稿（design F4） ----------
const fields = reactive<Record<string, DraftField>>({})
const touched = reactive<Record<string, boolean>>({})
const editingBy = reactive<Record<string, string>>({})
const editingTimers: Record<string, ReturnType<typeof setTimeout>> = {}
let fieldsKey = ''

function resetFields() {
  for (const k of Object.keys(fields)) {
    fields[k].dispose()
    delete fields[k]
  }
  for (const k of Object.keys(touched)) delete touched[k]
  for (const k of Object.keys(editingBy)) delete editingBy[k]
}

function ensureFields(s: StudentSnapshot) {
  const v = studentView(s, store.ui.lastClosedQuestionId)
  const q = v.kind === 'answer' || v.kind === 'submitted' ? v.question : null
  const key = q ? `${q.id}:${q.round}` : ''
  if (key !== fieldsKey) {
    resetFields()
    fieldsKey = key
    if (q) {
      for (const b of q.blanks) {
        fields[b.id] = new DraftField(b.id, (text, baseRev) =>
          sendDraft({ questionId: q.id, round: q.round, blankId: b.id, text, baseRev }),
        )
      }
    }
  }
  for (const d of s.myGroup?.drafts ?? []) fields[d.blankId]?.fromSnapshot(d)
}

const offDraft = onDraftUpdated((e) => {
  const me = ss.value?.me.clientId
  const f = fields[e.draft.blankId]
  if (!me || !f) return
  f.remote(e.draft, me)
  if (e.draft.by.clientId !== me) {
    const id = e.draft.blankId
    editingBy[id] = e.draft.by.nickname
    clearTimeout(editingTimers[id])
    editingTimers[id] = setTimeout(() => delete editingBy[id], 3000)
  }
})

function onInput(blankId: string, ev: Event) {
  touched[blankId] = true
  fields[blankId]?.input((ev.target as HTMLTextAreaElement).value)
}

const fieldTexts = computed(() => {
  const v = view.value
  if (!v || (v.kind !== 'answer' && v.kind !== 'submitted')) return []
  return v.question.blanks.map((b) => ({ blankId: b.id, text: fields[b.id]?.value ?? '' }))
})
const allValid = computed(() => validateAnswers(fieldTexts.value).ok)
const fieldError = (blankId: string) => {
  if (!touched[blankId]) return null
  const e = validateField(fields[blankId]?.value ?? '')
  return e ? FIELD_ERROR_TEXT[e] : null
}

// ---------- 送出（design F3） ----------
let inFlight = false // 同步鎖：連點只會發出一個請求
const submitting = ref(false)
/** 送出成功後，等快照版本大於此值才解除停用（畫面切換一律等快照） */
const awaitVersion = ref<number | null>(null)

async function submit() {
  if (inFlight) return
  const s = ss.value
  const v = view.value
  if (!s || !v || v.kind !== 'answer' || !v.isLeader || !connected.value) return
  const q = v.question
  const res = validateAnswers(q.blanks.map((b) => ({ blankId: b.id, text: fields[b.id]?.value ?? '' })))
  for (const b of q.blanks) touched[b.id] = true
  if (!res.ok) return
  inFlight = true
  submitting.value = true
  message.value = ''
  for (const f of Object.values(fields)) f.flush() // 讓組員的唯讀畫面顯示最終版本
  try {
    await api.submit(code, q.id, q.round, res.answers)
    if (view.value?.kind === 'answer') awaitVersion.value = store.snapshot?.version ?? 0
  } catch (e) {
    const info = describeError(e instanceof RestError ? e.code : undefined)
    message.value = info.message
    if (info.action === 'resync') requestResync()
  } finally {
    inFlight = false
    submitting.value = false
  }
}

// ---------- 結果 ----------
const resultPick = ref<string | null>(null)
watch(
  () => store.ui.lastClosedQuestionId,
  () => (resultPick.value = null),
)
const closedResults = computed(() => {
  const s = ss.value
  if (!s) return []
  return s.results
    .map((r) => ({ r, q: s.questions.find((q) => q.id === r.questionId) as Question }))
    .filter((x) => x.q && x.q.status === 'closed')
    .sort((a, b) => a.q.number - b.q.number)
})
const shownResult = computed(() => {
  const v = view.value
  if (!v || v.kind !== 'result') return null
  return closedResults.value.find((x) => x.q.id === resultPick.value) ?? { r: v.result, q: v.question }
})

// ---------- 快照與生命週期 ----------
const offSnap = onSnapshot((next: Snapshot) => {
  if (store.role !== 'student') return
  const s = next as StudentSnapshot
  syncGroupCookie(code, s.me.groupId)
  if (!changingGroup.value && s.me.groupId) selectedGroup.value = s.me.groupId
  if (awaitVersion.value !== null && s.version > awaitVersion.value) awaitVersion.value = null
  ensureFields(s)
})

onMounted(async () => {
  let initial: StudentSnapshot
  try {
    initial = await api.studentSnapshot(code)
  } catch (e) {
    const err = e instanceof RestError ? e : null
    if (err?.code === 'NOT_JOINED' || err?.status === 401) {
      await router.replace({ path: '/join', query: { code } })
      return
    }
    loadError.value = describeError(err?.code).message
    return
  }
  selectedGroup.value = initial.me.groupId ?? readGroupCookie(code) ?? ''
  startLive(code, 'student', initial)
})

onUnmounted(() => {
  offSnap()
  offDraft()
  resetFields()
  for (const t of Object.values(editingTimers)) clearTimeout(t)
  stopLive()
})
</script>

<template>
  <p v-if="loadError" class="msg error" role="alert">{{ loadError }}</p>
  <template v-if="ss && view">
    <section class="card row" style="justify-content: space-between">
      <div>
        <div class="muted">活動 {{ ss.activity.code }}</div>
        <strong data-testid="me">{{ ss.me.nickname }}</strong>
        <span v-if="ss.me.isLeader" class="badge leader" data-testid="me-leader" style="margin-left: 6px">組長</span>
      </div>
      <div style="min-width: 220px">
        <label for="group">組別</label>
        <select
          id="group"
          :value="selectedGroup"
          :disabled="!groupSelectable"
          data-testid="group-select"
          @change="onGroupSelect"
        >
          <option value="" disabled>請選擇組別</option>
          <option v-for="g in ss.activity.groups" :key="g.id" :value="g.id">{{ g.name }}</option>
        </select>
        <p v-if="ss.groupLocked && ss.me.groupId" class="muted" data-testid="group-locked">搶答已開始，無法換組</p>
      </div>
    </section>

    <p v-if="message" class="msg error" data-testid="play-message" role="alert">{{ message }}</p>

    <!-- 1. 選組 -->
    <section v-if="view.kind === 'chooseGroup'" class="card stack" data-testid="choose-group">
      <p>請從上方下拉選單選擇你的組別。</p>
      <button class="primary" :disabled="!selectedGroup || !groupSelectable" data-testid="join-group-btn" @click="changeGroup(selectedGroup)">
        加入此組
      </button>
    </section>

    <!-- 6. 等待 -->
    <section v-else-if="view.kind === 'waiting'" class="card" data-testid="waiting">
      <h2>{{ ss.groupLocked ? '等待下一題' : '等待老師開始' }}</h2>
      <p class="muted">搶答開始前可以換組；開始後組別會鎖定。</p>
    </section>

    <!-- 2~4. 作答 / 已送出 -->
    <section v-else-if="view.kind === 'answer' || view.kind === 'submitted'" class="card stack" data-testid="answer-card">
      <h2 data-testid="question-title">第 {{ view.question.number }} 題</h2>
      <div v-for="(b, i) in view.question.blanks" :key="b.id">
        <label :for="`ans-${b.id}`">{{ b.label ?? '答案' }}</label>
        <textarea
          v-if="fields[b.id]"
          :id="`ans-${b.id}`"
          :value="fields[b.id].value"
          :readonly="view.kind === 'submitted'"
          :disabled="!connected"
          :data-testid="`answer-${i}`"
          @input="onInput(b.id, $event)"
          @compositionstart="fields[b.id].compositionStart()"
          @compositionend="fields[b.id].compositionEnd(($event.target as HTMLTextAreaElement).value)"
        />
        <div v-if="view.kind === 'answer' && fieldError(b.id)" class="field-error" :data-testid="`field-error-${i}`">
          {{ fieldError(b.id) }}
        </div>
        <div class="editing-hint" :data-testid="`editing-${i}`">
          <template v-if="view.kind === 'answer' && editingBy[b.id]">{{ editingBy[b.id] }} 正在編輯</template>
        </div>
      </div>

      <template v-if="view.kind === 'answer'">
        <button
          v-if="view.isLeader"
          class="primary"
          :disabled="!allValid || submitting || awaitVersion !== null || !connected"
          data-testid="submit-btn"
          @click="submit"
        >
          {{ submitting ? '送出中…' : '送出答案' }}
        </button>
        <template v-else>
          <button disabled data-testid="submit-btn">送出答案</button>
          <p class="msg info" data-testid="leader-only">只有組長能送出</p>
        </template>
      </template>
      <p v-else class="msg info" data-testid="submitted-msg">已送出，等待老師結束本題</p>
    </section>

    <!-- 5. 結果 -->
    <section v-else-if="view.kind === 'result' && shownResult" class="card stack" data-testid="result-card">
      <div class="row" style="justify-content: space-between">
        <h2 style="margin: 0" data-testid="result-title">第 {{ shownResult.q.number }} 題結果</h2>
        <div class="row">
          <button
            v-for="x in closedResults"
            :key="x.q.id"
            :class="{ primary: x.q.id === shownResult.q.id }"
            :data-testid="`result-tab-${x.q.number}`"
            @click="resultPick = x.q.id"
          >
            第 {{ x.q.number }} 題
          </button>
        </div>
      </div>
      <p v-if="!shownResult.r.submissions.length" class="muted" data-testid="no-answers">本題無人作答</p>
      <table v-else>
        <thead><tr><th>順位</th><th>組別</th><th>答案</th></tr></thead>
        <tbody>
          <tr v-for="s in shownResult.r.submissions" :key="s.groupId" :data-testid="`result-row-${s.rank}`">
            <td>
              {{ s.rank }}
              <span v-if="s.groupId === shownResult.r.winnerGroupId" class="badge win">搶答成功</span>
            </td>
            <td>{{ groupName(ss.activity.groups, s.groupId) }}</td>
            <td>{{ formatAnswers(shownResult.q.blanks, s.answers) }}</td>
          </tr>
        </tbody>
      </table>
      <p class="muted">等待老師開始下一題</p>
    </section>

    <section v-if="ss.myGroup" class="card">
      <h2>{{ groupName(ss.activity.groups, ss.me.groupId) }} 成員</h2>
      <ul style="margin: 0; padding-left: 18px" data-testid="my-members">
        <li v-for="m in ss.myGroup.members" :key="m.clientId">
          {{ m.nickname }}<span v-if="m.clientId === ss.me.clientId" class="muted">（你）</span>
          <span v-if="m.isLeader" class="badge leader">組長</span>
          <span v-if="!m.online" class="badge offline">離線</span>
        </li>
      </ul>
    </section>
  </template>
</template>
