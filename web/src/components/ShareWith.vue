<script setup lang="ts">
// 顯示「要把試算表共用給誰」的 email 與複製按鈕。
// 這個 email 是後端錯誤回應中的公開資訊（shareWith），不是憑證。
import { ref } from 'vue'

const props = defineProps<{ email: string }>()
const copied = ref(false)
const canCopy = typeof navigator !== 'undefined' && !!navigator.clipboard?.writeText

async function copy() {
  try {
    await navigator.clipboard.writeText(props.email)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    // 瀏覽器拒絕存取剪貼簿：email 仍以文字顯示，老師可以自行選取
  }
}
</script>

<template>
  <div class="row">
    <code data-testid="share-with" style="user-select: all">{{ email }}</code>
    <button v-if="canCopy" type="button" data-testid="copy-share-with" @click="copy">
      {{ copied ? '已複製' : '複製 email' }}
    </button>
  </div>
</template>
