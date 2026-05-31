<template>
  <div
    class="product-card"
    :class="{ 'out-of-stock': product.stock <= 0 }"
    @click="handleClick"
  >
    <!-- Cover image -->
    <div class="product-cover">
      <img
        v-if="product.coverUrl"
        :src="product.coverUrl"
        :alt="product.title"
        loading="lazy"
      />
      <div v-else class="cover-placeholder">
        <span>&#x1F4E6;</span>
      </div>
      <!-- Stock badge -->
      <span v-if="product.stock <= 0" class="stock-badge empty">已售罄</span>
    </div>

    <!-- Info -->
    <div class="product-info">
      <h3 class="product-title">{{ product.title }}</h3>
      <div class="product-footer">
        <span class="product-price">{{ formatPrice }}</span>
        <span v-if="product.stock > 0" class="product-stock">
          库存 {{ product.stock }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Product } from '@/types'

const props = defineProps<{
  product: Product
}>()

const emit = defineEmits<{
  pay: [product: Product]
}>()

const formatPrice = computed(() => {
  const yuan = (props.product.priceCents / 100).toFixed(2)
  return `${props.product.currency === 'CNY' ? '¥' : props.product.currency} ${yuan}`
})

function handleClick() {
  if (props.product.stock <= 0) return
  emit('pay', props.product)
}
</script>

<style scoped>
.product-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--r-lg);
  border: 0.5px solid var(--border);
  background: var(--tg-secondary-bg);
  cursor: pointer;
  transition: transform var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out);
  opacity: 0;
  animation: fadeInUp var(--duration-slow) var(--ease-out) forwards;
}

.product-card:hover:not(.out-of-stock) {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
  border-color: var(--border-strong);
}

.product-card:active:not(.out-of-stock) {
  transform: scale(0.97);
  transition-duration: 80ms;
}

.product-card.out-of-stock {
  cursor: default;
  opacity: 0.5;
  animation: fadeInUp var(--duration-slow) var(--ease-out) forwards;
}

.product-cover {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  background: var(--surface);
}

.product-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  color: var(--tg-hint);
}

.stock-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 2px 8px;
  border-radius: var(--r-full);
  font-size: 11px;
  font-weight: 600;
  backdrop-filter: blur(8px);
}

.stock-badge.empty {
  background: rgba(239, 68, 68, 0.85);
  color: #fff;
}

.product-info {
  padding: 10px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.product-title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--tg-text);
}

.product-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.product-price {
  font-size: 16px;
  font-weight: 700;
  color: var(--tg-btn);
  white-space: nowrap;
}

.product-stock {
  font-size: 12px;
  color: var(--tg-hint);
}
</style>
