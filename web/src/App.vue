<script setup lang="ts">
import { store } from './store'
</script>

<template>
  <header class="topbar">
    <RouterLink to="/" class="brand">課堂搶答系統</RouterLink>
    <span
      v-if="store.ui.socketActive"
      class="conn"
      :class="store.ui.connected ? 'ok' : 'down'"
      data-testid="conn-status"
      role="status"
    >
      {{ store.ui.connected ? '已連線' : '重新連線中…' }}
    </span>
  </header>
  <main class="page">
    <RouterView />
  </main>
</template>
