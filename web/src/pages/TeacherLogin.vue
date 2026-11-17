<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, RestError } from '../api/rest'
import { describeError } from '../lib/errors'

const router = useRouter()
const route = useRoute()
const password = ref('')
const error = ref('')
const busy = ref(false)

async function submit() {
  if (busy.value || !password.value) return
  busy.value = true
  error.value = ''
  const pw = password.value
  // 密碼只在送出請求時存在於表單狀態，送出後立即清空（design D14）
  password.value = ''
  try {
    await api.login(pw)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : ''
    await router.push(redirect.startsWith('/teacher/') ? redirect : '/teacher/new')
  } catch (e) {
    error.value = describeError(e instanceof RestError ? e.code : undefined).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <h1>教師登入</h1>
  <form class="card stack" style="max-width: 420px" @submit.prevent="submit">
    <div>
      <label for="pw">教師密碼</label>
      <input id="pw" v-model="password" type="password" autocomplete="current-password" data-testid="password" />
    </div>
    <p v-if="error" class="msg error" data-testid="login-error" role="alert">{{ error }}</p>
    <button class="primary" type="submit" :disabled="busy || !password" data-testid="login-btn">登入</button>
  </form>
</template>
