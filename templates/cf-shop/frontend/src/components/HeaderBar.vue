<template>
  <header class="header" :class="headerClass">
    <!-- Telegram: platform-native navigation -->
    <template v-if="isTelegram">
      <!-- Mobile: bottom tab bar -->
      <nav v-if="isMobile" class="tg-tab-bar">
        <RouterLink to="/shop" class="tg-tab-item" active-class="active">
          <span class="tg-tab-icon">&#x1F6D2;</span>
          <span class="tg-tab-label">商品</span>
        </RouterLink>
        <RouterLink to="/redeem" class="tg-tab-item" active-class="active">
          <span class="tg-tab-icon">&#x1F3AB;</span>
          <span class="tg-tab-label">折扣码</span>
        </RouterLink>
        <RouterLink to="/lookup" class="tg-tab-item" active-class="active">
          <span class="tg-tab-icon">&#x1F50D;</span>
          <span class="tg-tab-label">查询</span>
        </RouterLink>
      </nav>

      <!-- Desktop: top horizontal nav -->
      <nav v-else class="tg-desktop-nav">
        <RouterLink to="/shop" class="nav-link" active-class="active">商品</RouterLink>
        <RouterLink to="/redeem" class="nav-link" active-class="active">折扣码</RouterLink>
        <RouterLink to="/lookup" class="nav-link" active-class="active">查询</RouterLink>
      </nav>
    </template>

    <!-- H5 Browser: brand + tabs -->
    <template v-else>
      <div class="h5-header">
        <RouterLink to="/shop" class="brand">AcctBox</RouterLink>
        <nav class="h5-tabs">
          <RouterLink to="/shop" class="tab-link" active-class="active">商品</RouterLink>
          <RouterLink to="/redeem" class="tab-link" active-class="active">折扣码</RouterLink>
          <RouterLink to="/lookup" class="tab-link" active-class="active">查询</RouterLink>
        </nav>
      </div>
    </template>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { usePlatform } from '@/composables/usePlatform'

const { isTelegram, isMobile } = usePlatform()
const headerClass = computed(() => ({
  'is-telegram': isTelegram,
  'is-mobile': isMobile,
}))
</script>

<style scoped>
.header {
  position: relative;
  z-index: 100;
}
</style>
