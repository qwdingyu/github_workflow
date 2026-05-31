<template>
  <div class="shop-view">
    <!-- Section header -->
    <div class="page-section">
      <div class="section-label">商品</div>
      <div class="section-row">
        <h1 class="section-title">商品列表</h1>
        <button class="btn btn-ghost btn-sm" @click="refresh" :disabled="loading">
          {{ loading ? '加载中…' : '刷新' }}
        </button>
      </div>
    </div>

    <!-- Category filter -->
    <div v-if="categories.length > 0" class="category-bar">
      <button
        class="cat-btn"
        :class="{ active: activeCategory === null }"
        @click="activeCategory = null"
      >
        全部
        <span class="cat-count">{{ products.length }}</span>
      </button>
      <button
        v-for="cat in categories"
        :key="cat"
        class="cat-btn"
        :class="{ active: activeCategory === cat }"
        @click="activeCategory = cat"
      >
        {{ cat }}
        <span class="cat-count">{{ categoryCounts.get(cat) || 0 }}</span>
      </button>
    </div>

    <!-- Search -->
    <div v-if="products.length > 5" class="search-row">
      <input
        v-model="searchQuery"
        type="search"
        placeholder="搜索商品名称…"
      />
    </div>

    <!-- Skeleton loading -->
    <div v-if="loading" class="product-grid">
      <div v-for="i in 6" :key="i" class="skeleton-card">
        <div class="skeleton skeleton-cover" />
        <div class="skeleton skeleton-line w-70" />
        <div class="skeleton skeleton-line w-40" />
      </div>
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="empty-state">
      <div class="empty-icon">&#x26A0;</div>
      <p class="empty-text">{{ error }}</p>
      <button class="btn btn-primary" style="margin-top:12px" @click="refresh">重试</button>
    </div>

    <!-- Empty state -->
    <div v-else-if="filteredProducts.length === 0" class="empty-state">
      <div class="empty-icon">&#x1F6D2;</div>
      <p class="empty-text">暂无商品</p>
    </div>

    <!-- Product grid -->
    <div v-else class="product-grid">
      <ProductCard
        v-for="p in filteredProducts"
        :key="p.id"
        :product="p"
        @pay="handlePay"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import ProductCard from '@/components/ProductCard.vue'
import { fetchProducts } from '@/api'
import { usePayment } from '@/composables/usePayment'
import type { Product } from '@/types'

const products = ref<Product[]>([])
const loading = ref(true)
const error = ref('')
const searchQuery = ref('')
const activeCategory = ref<string | null>(null)

const categories = computed(() => {
  const cats = new Set<string>()
  products.value.forEach(p => {
    if (p.category) cats.add(p.category)
  })
  return [...cats]
})

const categoryCounts = computed(() => {
  const counts = new Map<string, number>()
  products.value.forEach(p => {
    if (p.category) {
      counts.set(p.category, (counts.get(p.category) || 0) + 1)
    }
  })
  return counts
})

const filteredProducts = computed(() => {
  let result = products.value
  if (activeCategory.value !== null) {
    result = result.filter(p => p.category === activeCategory.value)
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    result = result.filter(p => p.title.toLowerCase().includes(q))
  }
  return result
})

async function loadData() {
  loading.value = true
  error.value = ''
  try {
    products.value = await fetchProducts()
  } catch (err: any) {
    products.value = []
    error.value = err.message || '加载商品失败'
  } finally {
    loading.value = false
  }
}

function refresh() {
  loadData()
}

const { open } = usePayment()
function handlePay(product: Product) {
  open({
    id: product.id,
    title: product.title,
    priceCents: product.priceCents,
    currency: product.currency,
    coverUrl: product.coverUrl,
  })
}

onMounted(loadData)
</script>

<style scoped>
.shop-view {
  padding-bottom: 16px;
}

.section-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.btn-sm {
  padding: 6px 12px;
  font-size: 13px;
}

/* Category filter */
.category-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 16px 0;
}

.cat-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  border: 0.5px solid var(--border);
  border-radius: var(--r-full);
  background: transparent;
  color: var(--tg-hint);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
}

.cat-btn:hover {
  color: var(--tg-text);
  border-color: var(--border-strong);
  background: var(--surface);
}

.cat-btn.active {
  background: var(--tg-btn);
  color: var(--tg-btn-text);
  border-color: var(--tg-btn);
}

.cat-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: var(--r-full);
  font-size: 11px;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.12);
}

.cat-btn.active .cat-count {
  background: rgba(255, 255, 255, 0.25);
}

/* Search */
.search-row {
  margin-bottom: 16px;
}

.search-row input {
  width: 100%;
  max-width: 400px;
}

/* Skeleton */
.skeleton-card {
  border-radius: var(--r-lg);
  overflow: hidden;
  background: var(--tg-secondary-bg);
}

.skeleton-cover {
  width: 100%;
  aspect-ratio: 16 / 10;
}

.skeleton-line {
  height: 14px;
  margin: 10px 12px;
}

.skeleton-line.w-70 { width: 70%; }
.skeleton-line.w-40 { width: 40%; }

/* Empty */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: var(--tg-hint);
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
  opacity: 0.5;
}

.empty-text {
  font-size: 15px;
}
</style>
