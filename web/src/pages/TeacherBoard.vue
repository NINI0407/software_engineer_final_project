<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api, RestError } from '../api/rest'
import type { TeacherQuestion, TeacherSnapshot } from '../api/types'
import SheetExport from '../components/SheetExport.vue'
import { describeError } from '../lib/errors'
import { formatAnswers, groupName, GROUP_STATUS_TEXT, STATUS_TEXT } from '../lib/format'
import { onSnapshot, requestResync, store } from '../store'
import { startLive, stopLive } from '../store/live'
import { groupHasNoLeader, teacherButtons as tb } from '../store/view'

const route = useRoute()
const code = String(route.params.code).toUpperCase()
const loadError = ref('')
const message = ref('')
const snap = computed(() => (store.role === 'teacher' ? (store.snapshot as TeacherSnapshot | null) : null))
const connected = computed(() => store.ui.connected)

/**
 * 處理中狀態：按下按鈕後一直維持，直到收到比按下時更新的快照（畫面切換一律等快照），
 * 或收到錯誤。
 */
const pending = ref<{ key: string; since: number } | null>(null)
let pendingTimer: ReturnType<typeof setTimeout> | null = null
const off = onSnapshot((next) => {
  if (pending.value && next.version > pending.value.since) clearPending()
})
function clearPending() {
  pending.value = null
  if (pendingTimer) clearTimeout(pendingTimer)
  pendingTimer = null
}

async function run(key: string, fn: () => Promise<unknown>) {
  if (pending.value || !connected.value || !snap.value) return
  message.value = ''
  pending.value = { key, since: snap.value.version }
  pendingTimer = setTimeout(clearPending, 5000)
  try {
    await fn()
  } catch (e) {
    clearPending()
    const info = describeError(e instanceof RestError ? e.code : undefined)
    message.value = info.message
    if (info.action === 'resync') requestResync()
  }
}

const busy = computed(() => !!pending.value || !connected.value)
const isPending = (key: string) => pending.value?.key === key
const next = computed(() => (snap.value ? tb.nextQuestion(snap.value) : null))
const current = computed(() =>
  snap.value?.currentQuestionId ? snap.value.questions.find((q) => q.id === snap.value!.currentQuestionId) : null,
)

const start = (q: TeacherQuestion) => run(`open-${q.id}`, () => api.openQuestion(code, q.id))
const close = (q: TeacherQuestion) => run(`close-${q.id}`, () => api.closeQuestion(code, q.id))
const reopen = (q: TeacherQuestion) => run(`reopen-${q.id}`, () => api.reopenQuestion(code, q.id))
const startNext = () => next.value && run('next', () => api.openQuestion(code, next.value!.id))

const closedResults = computed(() => {
  const s = snap.value
  if (!s) return []
  return [...s.results]
    .map((r) => ({ r, q: s.questions.find((q) => q.id === r.questionId)! }))
    .sort((a, b) => a.q.number - b.q.number)
})

onMounted(async () => {
  try {
    const initial = await api.teacherSnapshot(code)
    startLive(code, 'teacher', initial)
  } catch (e) {
    loadError.value = describeError(e instanceof RestError ? e.code : undefined).message
  }
})
onUnmounted(() => {
  off()
  clearPending()
  stopLive()
})
</script>

<template>
  <p v-if="loadError" class="msg error" role="alert">{{ loadError }}</p>
  <template v-if="snap">
    <section class="card">
      <div class="muted">活動代號</div>
      <div class="code" data-testid="activity-code">{{ snap.activity.code }}</div>
      <div class="muted">學生開啟 /join 並輸入此代號加入</div>
    </section>

    <SheetExport :code="code" :snap="snap" :connected="connected" />

    <p v-if="message" class="msg error" data-testid="board-error" role="alert">{{ message }}</p>

    <section class="card">
      <div class="row" style="justify-content: space-between; margin-bottom: 8px">
        <h2 style="margin: 0">題目</h2>
        <button class="primary" :disabled="busy || !next" data-testid="next-btn" @click="startNext">
          {{ isPending('next') ? '處理中…' : next ? `下一題（第 ${next.number} 題）` : '下一題' }}
        </button>
      </div>
      <table>
        <thead>
          <tr><th>題號</th><th>填空</th><th>狀態</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="q in snap.questions" :key="q.id" :data-testid="`q-row-${q.number}`">
            <td>第 {{ q.number }} 題</td>
            <td class="muted">
              <span v-for="b in q.blanks" :key="b.id" style="margin-right: 8px">{{ b.label ?? '' }}{{ b.cellRef }}</span>
            </td>
            <td>
              <span class="badge" :class="q.status" data-testid="q-status">{{ STATUS_TEXT[q.status] }}</span>
              <span v-if="q.round > 1" class="muted"> 第 {{ q.round }} 輪</span>
            </td>
            <td class="row">
              <button v-if="q.status === 'idle'" :disabled="busy || !tb.canStart(snap, q)" data-testid="start-btn" @click="start(q)">
                {{ isPending(`open-${q.id}`) ? '處理中…' : '開始' }}
              </button>
              <button v-if="q.status === 'open'" class="primary" :disabled="busy || !tb.canClose(snap, q)" data-testid="close-btn" @click="close(q)">
                {{ isPending(`close-${q.id}`) ? '處理中…' : '結束' }}
              </button>
              <button v-if="q.status === 'closed'" :disabled="busy || !tb.canReopen(snap, q)" data-testid="reopen-btn" @click="reopen(q)">
                {{ isPending(`reopen-${q.id}`) ? '處理中…' : '重開' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="card">
      <h2>
        各組狀態
        <span v-if="current" class="muted">（第 {{ current.number }} 題進行中）</span>
        <span v-else class="muted">（目前沒有進行中的題目）</span>
      </h2>
      <div class="grid">
        <div v-for="g in snap.groups" :key="g.group.id" class="card stack" style="margin: 0" :data-testid="`group-${g.group.id}`">
          <div class="row" style="justify-content: space-between">
            <strong>{{ g.group.name }}</strong>
            <span v-if="g.current" class="badge" :class="g.current.status" data-testid="group-status">
              {{ GROUP_STATUS_TEXT[g.current.status] }}
            </span>
          </div>
          <div v-if="g.current?.submission && current" data-testid="group-submission">
            <span class="badge" :class="{ win: g.current.submission.rank === 1 }" data-testid="group-rank">
              第 {{ g.current.submission.rank }} 名<template v-if="g.current.submission.rank === 1">・搶答成功</template>
            </span>
            <div data-testid="group-answer">{{ formatAnswers(current.blanks, g.current.submission.answers) }}</div>
          </div>
          <ul style="margin: 0; padding-left: 18px" data-testid="member-list">
            <li v-for="m in g.members" :key="m.clientId" :data-testid="`member-${m.nickname}`">
              {{ m.nickname }}
              <span v-if="m.isLeader" class="badge leader">組長</span>
              <span v-if="!m.online" class="badge offline" data-testid="offline">離線</span>
            </li>
            <li v-if="!g.members.length" class="muted">尚無成員</li>
          </ul>
          <p v-if="groupHasNoLeader(g.members)" class="muted" style="margin: 0" data-testid="no-leader">目前無組長</p>
        </div>
      </div>
    </section>

    <section class="card">
      <h2>搶答結果</h2>
      <p v-if="!closedResults.length" class="muted">尚無已結束的題目</p>
      <div v-for="{ r, q } in closedResults" :key="r.questionId" class="stack" :data-testid="`result-${q.number}`" style="margin-bottom: 16px">
        <strong>第 {{ q.number }} 題<span v-if="r.round > 1" class="muted">（第 {{ r.round }} 輪）</span></strong>
        <p v-if="!r.submissions.length" class="muted">本題無人作答</p>
        <table v-else>
          <thead><tr><th>順位</th><th>組別</th><th>答案</th></tr></thead>
          <tbody>
            <tr v-for="s in r.submissions" :key="s.groupId">
              <td>
                {{ s.rank }}
                <span v-if="s.groupId === r.winnerGroupId" class="badge win">搶答成功</span>
              </td>
              <td>{{ groupName(snap.activity.groups, s.groupId) }}</td>
              <td>{{ formatAnswers(q.blanks, s.answers) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>
</template>
