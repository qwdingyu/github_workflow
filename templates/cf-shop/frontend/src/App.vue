<template>
  <div class="app" :class="`platform-${platform}`">
    <!-- Header -->
    <HeaderBar />

    <!-- Main content -->
    <main class="app-main">
      <RouterView />
    </main>

    <!-- Payment Modal -->
    <PayModal />
  </div>
</template>

<script setup lang="ts">
import HeaderBar from '@/components/HeaderBar.vue'
import PayModal from '@/components/PayModal.vue'
import { usePlatform } from '@/composables/usePlatform'
import { useTelegram } from '@/composables/useTelegram'

const { platform } = usePlatform()
useTelegram()
</script>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-main {
  flex: 1;
  padding-top: 16px;
}
</style>
