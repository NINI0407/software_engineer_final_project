<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, RestError } from '../api/rest'
import { describeError } from '../lib/errors'

const route = useRoute()
const router = useRouter()
const code = ref(typeof route.query.code === 'string' ? route.query.code.toUpperCase() : '')
const nickname = ref('')
const error = ref('')
const busy = ref(false)

async function join() {
  const c = code.value.trim().toUpperCase()
  if (busy.value || !c || !nickname.value.trim()) return
  busy.value = true
  error.value = ''
  try {
    await api.join(c, nickname.value.trim())
    await router.push(`/play/${c}`)
  } catch (e) {
    error.value = describeError(e instanceof RestError ? e.code : undefined).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <h1>加入搶答活動</h1>
  <form class="card stack" style="max-width: 420px" @submit.prevent="join">
    <div>
      <label for="code">活動代號</label>
      <input id="code" v-model="code" autocomplete="off" maxlength="12" data-testid="join-code" />
    </div>
    <div>
      <label for="nick">暱稱</label>
      <input id="nick" v-model="nickname" maxlength="20" data-testid="join-nickname" />
    </div>
    <p v-if="error" class="msg error" data-testid="join-error" role="alert">{{ error }}</p>
    <button class="primary" type="submit" :disabled="busy || !code.trim() || !nickname.trim()" data-testid="join-btn">加入</button>
  </form>
</template>
