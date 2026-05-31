<template>
  <div :id="containerId" class="turnstile-wrapper" />
</template>

<script setup lang="ts">
import { watch, onMounted } from 'vue'
import { siteKey, useTurnstile } from '@/composables/useTurnstile'

const props = defineProps<{
  containerId: string
}>()

const { renderPageTurnstile, renderModalTurnstile } = useTurnstile()

function tryRender() {
  if (props.containerId === 'turnstile-container') {
    renderPageTurnstile()
  } else if (props.containerId === 'pay-turnstile') {
    renderModalTurnstile()
  }
}

// Render on mount (if siteKey is already loaded)
onMounted(() => {
  tryRender()
})

// Re-render when siteKey becomes available (async loadSiteKey resolves after mount)
watch(siteKey, (key) => {
  if (key) tryRender()
})
</script>

<style scoped>
.turnstile-wrapper {
  display: flex;
  justify-content: center;
  margin: 10px 0;
}
</style>
