# AcctBox 渐进式迁移方案：保留 Vanilla 托底 + Vue3 新前端 + Telegram & 桌面H5 双适配

> 日期：2026-05-28
> 核心策略：**现有 index.html 做托底 → Vue3 新前端渐进替代 → 同时适配 Telegram Mini App + 桌面 H5**

---

## 一、方案总览

### 1.1 渐进式迁移三阶段

```
阶段 1（本周）：          阶段 2（下周）：           阶段 3（完成后）：
搭建 Vue3 项目            逐个页面迁移               删除旧 index.html
保留旧 index.html 托底    新旧并存，开关切换          纯 Vue3 前端

目录结构：                Worker 路由：              目录结构：
├── public/               / → 新 Vue3（默认）        ├── public/
│   ├── index.html        /fallback → 旧 Vanilla     │   └── admin.html
│   ├── app.js        →   /_app → Vue3 产物          （旧文件删除）
│   ├── styles.css    →   /admin → admin.html        │
│   └── admin.html    →   /admin/ → admin.html       acctbox-h5/
└── acctbox-h5/           /api → Hono API            （成为唯一前端）
    （新建，逐步填充）
```

### 1.2 双平台适配策略

```
                    AcctBox 前端（Vue3）
                   /                    \
          Telegram Mini App          桌面/手机 H5 浏览器
              /      \                      |
      手机 Telegram    桌面 Telegram      Chrome/Safari/Edge
         (主战场)        (次要)

共同代码：90%（组件、API、业务逻辑）
差异代码：10%（Telegram SDK 集成、主题色、安全区域）
```

---

## 二、阶段 1：项目搭建（本周）

### 2.1 目录结构

```
/Users/dingyuwang/0-X/github_workflow/
├── eshop/                              ← 后端（修改路由逻辑）
│   ├── src/
│   │   └── index.ts                    ← Worker 入口（修改路由）
│   ├── public/
│   │   ├── index.html                  ← 旧 Vanilla（托底，保留）
│   │   ├── app.js
│   │   ├── styles.css
│   │   ├── admin.html
│   │   └── _app/                       ← 新 Vue3 产物（构建后生成）
│   │       ├── index.html
│   │       └── assets/
│   │           ├── index-xxx.js
│   │           └── index-xxx.css
│   └── wrangler.jsonc
│
└── acctbox-h5/                         ← 新 Vue3 前端项目
    ├── src/
    │   ├── main.ts                     ← 入口
    │   ├── App.vue                     ← 根组件（平台检测 + 布局）
    │   ├── api/
    │   │   └── index.ts                ← API 封装
    │   ├── components/
    │   │   ├── ProductCard.vue         ← 商品卡片
    │   │   ├── PayModal.vue            ← 支付弹窗（容器）
    │   │   │   ├── PayFormStep.vue       ← 步骤1：下单
    │   │   │   ├── PayOnlineStep.vue     ← 步骤2：在线支付
    │   │   │   ├── PayOfflineStep.vue    ← 步骤3：线下支付
    │   │   │   └── PayResultStep.vue     ← 步骤4：结果
    │   │   ├── OrderLookup.vue         ← 订单查询
    │   │   ├── Turnstile.vue           ← Turnstile 人机验证
    │   │   └── HeaderBar.vue           ← 顶部导航（双平台差异）
    │   ├── views/
    │   │   ├── ShopView.vue            ← 商品列表
    │   │   ├── RedeemView.vue          ← 折扣码
    │   │   └── LookupView.vue          ← 查询
    │   ├── composables/
    │   │   ├── usePlatform.ts          ← 平台检测（Telegram / H5）
    │   │   ├── useTelegram.ts          ← Telegram WebApp SDK
    │   │   ├── useTurnstile.ts         ← Turnstile 验证
    │   │   └── usePayment.ts           ← 支付逻辑
    │   ├── router/
    │   │   └── index.ts                ← 路由（Hash 模式，兼容双平台）
    │   ├── types/
    │   │   └── index.ts                ← 共享类型
    │   ├── assets/
    │   │   ├── base.css                ← 基础样式
    │   │   ├── telegram.css            ← Telegram 主题适配
    │   │   └── desktop.css             ← 桌面 H5 适配
    │   └── env.d.ts                    ← 环境变量类型
    ├── index.html                      ← Vite 模板
    ├── vite.config.ts                  ← 构建配置
    ├── package.json
    └── tsconfig.json
```

### 2.2 Worker 路由修改

```typescript
// eshop/src/index.ts — 修改 fetch 函数中的路由逻辑

async fetch(request: Request, env: AppEnv["Bindings"], ctx: ExecutionContext) {
  // ... 前面的安全头逻辑不变 ...

  const url = new URL(request.url);

  // API 路由不变
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    url.pathname = url.pathname.replace(/^\/api/, "") || "/";
    return await api.fetch(new Request(url, request), env, ctx);
  }

  // 管理后台不变
  if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
    url.pathname = "/admin.html";
    return withHeaders(await env.ASSETS.fetch(new Request(url, request)));
  }

  // === 新逻辑：优先用 Vue3，失败则托底到旧 Vanilla ===

  // Vue3 产物在 /_app/ 下
  // 如果 /_app/index.html 存在，说明 Vue3 已部署
  if (url.pathname === "/" || url.pathname === "/shop" ||
      url.pathname === "/redeem" || url.pathname === "/lookup" ||
      url.pathname === "/order") {
    // 尝试返回 Vue3 页面
    const vuePath = "/_app/index.html";
    const vueResponse = await env.ASSETS.fetch(
      new Request(new URL(vuePath, request.url), request)
    );
    if (vueResponse.ok) {
      return withHeaders(vueResponse);
    }
    // Vue3 未部署，托底到旧页面
    url.pathname = "/index.html";
    return withHeaders(await env.ASSETS.fetch(new Request(url, request)));
  }

  // Vue3 静态资源（/_app/assets/*）
  if (url.pathname.startsWith("/_app/")) {
    return withHeaders(await env.ASSETS.fetch(request));
  }

  // 根路径兜底
  if (url.pathname === "/") {
    url.pathname = "/index.html";
    return withHeaders(await env.ASSETS.fetch(new Request(url, request)));
  }

  // 其他路径交给 Static Assets（旧 styles.css、app.js 等）
  return withHeaders(await env.ASSETS.fetch(request));
}
```

**优势：**
- 旧 `index.html` 不动，随时可以回滚
- Vue3 产物放到 `/_app/`，不覆盖旧文件
- Worker 自动检测：Vue3 存在就用 Vue3，不存在就回退到旧页面
- 零风险：即使 Vue3 构建失败，旧页面仍然正常工作

### 2.3 Vue3 项目初始化

```bash
cd /Users/dingyuwang/0-X/github_workflow
npm create vite@latest acctbox-h5 -- --template vue-ts
cd acctbox-h5
npm install vue-router@4
npm install -D @vitejs/plugin-legacy
```

### 2.4 package.json

```json
{
  "name": "acctbox-h5",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc -b && vite build",
    "preview": "vite preview",
    "deploy": "vite build && cp -r dist/* ../eshop/public/_app/"
  },
  "dependencies": {
    "vue": "^3.5.0",
    "vue-router": "^4.5.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.2.0",
    "@vitejs/plugin-legacy": "^6.0.0",
    "@types/node": "^22.0.0",
    "typescript": "~5.7.0",
    "vite": "^6.0.0",
    "vue-tsc": "^2.2.0"
  }
}
```

**注意：不加 Pinia。** 状态管理用 `ref` + `provide/inject` 足够。

### 2.5 vite.config.ts

```typescript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import legacy from '@vitejs/plugin-legacy'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    vue(),
    legacy({
      targets: ['defaults', 'not IE 11', 'android > 5'],
      additionalLegacyPolyfills: ['regenerator-runtime/runtime']
    })
  ],
  build: {
    target: 'es2015',  // 兼容 Telegram 低端 Android WebView
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['vue', 'vue-router'],
        }
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',  // wrangler dev 默认端口
        changeOrigin: true
      }
    }
  },
  // Telegram Mini App 和 H5 都使用 Hash 路由，不需要 history 模式
  base: '/_app/'  // 产物放到 /_app/ 目录下
})
```

**关键点：`base: '/_app/'`** — Vue3 产物会输出到 `dist/`，部署时复制到 `eshop/public/_app/`，资源路径自动带 `/_app/` 前缀，不与旧文件冲突。

---

## 三、双平台适配核心设计

### 3.1 平台检测

```typescript
// src/composables/usePlatform.ts
import { ref, computed, onMounted } from 'vue'

export type Platform = 'telegram-mobile' | 'telegram-desktop' | 'h5-mobile' | 'h5-desktop'

export function usePlatform() {
  const platform = ref<Platform>('h5-desktop')
  const isTelegram = computed(() => platform.value.startsWith('telegram'))
  const isMobile = computed(() => platform.value.includes('mobile'))
  const isDesktop = computed(() => platform.value.includes('desktop'))

  onMounted(() => {
    const isTg = !!(window as any).Telegram?.WebApp
    const isMobileUA = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)

    if (isTg) {
      // Telegram 内：检测是移动端还是桌面端
      platform.value = isMobileUA ? 'telegram-mobile' : 'telegram-desktop'
    } else {
      // 独立浏览器
      platform.value = isMobileUA ? 'h5-mobile' : 'h5-desktop'
    }
  })

  return { platform, isTelegram, isMobile, isDesktop }
}
```

### 3.2 Telegram 集成

```typescript
// src/composables/useTelegram.ts
import { ref, computed, onMounted, watch } from 'vue'

export interface TgUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
  allows_write_to_pm?: boolean
}

export function useTelegram() {
  const tg = ref<any>(null)
  const user = ref<TgUser | null>(null)
  const themeParams = ref<Record<string, string>>({})

  onMounted(() => {
    const webApp = (window as any).Telegram?.WebApp
    if (!webApp) return

    tg.value = webApp
    webApp.ready()
    webApp.expand()

    user.value = webApp.initDataUnsafe?.user ?? null
    themeParams.value = { ...webApp.themeParams }

    // 应用 Telegram 主题色到 CSS 变量
    applyTheme(webApp.themeParams)

    // 监听主题变化（用户切换 Telegram 主题时）
    webApp.onEvent('themeChanged', () => {
      themeParams.value = { ...webApp.themeParams }
      applyTheme(webApp.themeParams)
    })
  })

  // Telegram MainButton（主按钮）
  const mainButton = computed(() => tg.value?.MainButton ?? null)

  function showMainButton(text: string, onClick: () => void) {
    if (!tg.value?.MainButton) return
    tg.value.MainButton.setText(text)
    tg.value.MainButton.show()
    tg.value.MainButton.onClick(onClick)
  }

  function hideMainButton() {
    tg.value?.MainButton?.offClick()
    tg.value?.MainButton?.hide()
  }

  // Telegram BackButton
  function showBackButton(onClick: () => void) {
    tg.value?.BackButton?.show()
    tg.value.BackButton.onClick(onClick)
  }

  function hideBackButton() {
    tg.value?.BackButton?.offClick()
    tg.value.BackButton.hide()
  }

  return {
    tg, user, themeParams, mainButton,
    showMainButton, hideMainButton,
    showBackButton, hideBackButton,
  }
}

function applyTheme(params: Record<string, string>) {
  const root = document.documentElement
  const map: Record<string, string> = {
    bg_color: '--tg-bg',
    text_color: '--tg-text',
    hint_color: '--tg-hint',
    link_color: '--tg-link',
    button_color: '--tg-btn',
    button_text_color: '--tg-btn-text',
    secondary_bg_color: '--tg-secondary-bg',
    header_bg_color: '--tg-header-bg',
    bottom_bar_bg_color: '--tg-bottom-bar-bg',
  }
  for (const [tgKey, cssVar] of Object.entries(map)) {
    if (params[tgKey]) {
      root.style.setProperty(cssVar, params[tgKey])
    }
  }
}
```

### 3.3 根组件 — 双平台布局

```vue
<!-- src/App.vue -->
<template>
  <div class="app" :class="`platform-${platform}`">
    <!-- Telegram 特有：顶部状态栏占位 -->
    <div v-if="isTelegram" class="tg-status-bar"></div>

    <!-- 导航栏 -->
    <HeaderBar
      :is-telegram="isTelegram"
      :is-mobile="isMobile"
    />

    <!-- 主内容区 -->
    <main class="app-main">
      <RouterView />
    </main>

    <!-- Telegram 特有：底部安全区域占位 -->
    <div v-if="isTelegram" class="tg-safe-bottom"></div>
  </div>
</template>

<script setup lang="ts">
import { usePlatform } from './composables/usePlatform'
import { useTelegram } from './composables/useTelegram'
import HeaderBar from './components/HeaderBar.vue'

const { platform, isTelegram, isMobile } = usePlatform()
useTelegram()  // 初始化 Telegram SDK
</script>
```

### 3.4 导航栏 — 双平台差异

```vue
<!-- src/components/HeaderBar.vue -->
<template>
  <header class="header" :class="{ 'tg-header': isTelegram }">
    <!-- Telegram 桌面端：用 Telegram 原生 BackButton -->
    <template v-if="isTelegram">
      <!-- Telegram 移动端：底部 Tab 导航 -->
      <nav v-if="isMobile" class="tg-tab-bar">
        <RouterLink to="/shop" class="tab-item" active-class="active">
          <span class="tab-icon">🛒</span>
          <span class="tab-label">商品</span>
        </RouterLink>
        <RouterLink to="/redeem" class="tab-item" active-class="active">
          <span class="tab-icon">🎫</span>
          <span class="tab-label">折扣码</span>
        </RouterLink>
        <RouterLink to="/lookup" class="tab-item" active-class="active">
          <span class="tab-icon">🔍</span>
          <span class="tab-label">查询</span>
        </RouterLink>
      </nav>

      <!-- Telegram 桌面端：顶部水平导航 -->
      <nav v-else class="tg-desktop-nav">
        <RouterLink to="/shop" class="nav-link" active-class="active">商品</RouterLink>
        <RouterLink to="/redeem" class="nav-link" active-class="active">折扣码</RouterLink>
        <RouterLink to="/lookup" class="nav-link" active-class="active">查询</RouterLink>
      </nav>
    </template>

    <!-- H5 浏览器：顶部 Logo + 水平 Tab -->
    <template v-else>
      <nav class="h5-nav" :class="{ 'h5-desktop': !isMobile }">
        <RouterLink to="/" class="logo">AcctBox</RouterLink>
        <div class="h5-tabs">
          <RouterLink to="/shop" class="tab-link" active-class="active">商品</RouterLink>
          <RouterLink to="/redeem" class="tab-link" active-class="active">折扣码</RouterLink>
          <RouterLink to="/lookup" class="tab-link" active-class="active">查询</RouterLink>
        </div>
      </nav>
    </template>
  </header>
</template>

<script setup lang="ts">
defineProps<{
  isTelegram: boolean
  isMobile: boolean
}>()
</script>
```

### 3.5 CSS — 双平台样式

```css
/* src/assets/base.css — 共享基础样式 */
:root {
  /* 默认主题（H5 浏览器使用） */
  --tg-bg: #0f172a;
  --tg-text: #f8fafc;
  --tg-hint: #94a3b8;
  --tg-link: #38bdf8;
  --tg-btn: #38bdf8;
  --tg-btn-text: #0f172a;
  --tg-secondary-bg: #1e293b;
  --tg-header-bg: #0f172a;
  --tg-bottom-bar-bg: #1e293b;

  --radius: 14px;
  --spacing: 16px;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--tg-bg);
  color: var(--tg-text);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
```

```css
/* src/assets/telegram.css — Telegram 特有适配 */
/* 仅在 Telegram 内生效 */
.platform-telegram-mobile .app,
.platform-telegram-desktop .app {
  /* 安全区域 */
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
}

/* Telegram 移动端：底部 Tab 栏 */
.tg-tab-bar {
  display: flex;
  justify-content: space-around;
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--tg-bottom-bar-bg);
  border-top: 1px solid rgba(255,255,255,0.1);
  padding-bottom: env(safe-area-inset-bottom);
  z-index: 100;
}

.tab-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 12px;
  text-decoration: none;
  color: var(--tg-hint);
  font-size: 12px;
}

.tab-item.active {
  color: var(--tg-btn);
}

/* Telegram 桌面端：顶部导航 */
.tg-desktop-nav {
  display: flex;
  gap: 24px;
  padding: 12px 24px;
  background: var(--tg-header-bg);
  border-bottom: 1px solid rgba(255,255,255,0.1);
}

.nav-link {
  color: var(--tg-hint);
  text-decoration: none;
  font-size: 15px;
}

.nav-link.active {
  color: var(--tg-btn);
  font-weight: 600;
}

/* Telegram 内容区底部留白（给 Tab 栏腾空间） */
.platform-telegram-mobile .app-main {
  padding-bottom: 70px;
}
```

```css
/* src/assets/desktop.css — 桌面 H5 适配 */
/* 桌面端最大宽度居中 */
.platform-h5-desktop .app-main {
  max-width: 960px;
  margin: 0 auto;
  padding: 0 24px;
}

.platform-h5-desktop .h5-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  background: var(--tg-header-bg);
  border-bottom: 1px solid rgba(255,255,255,0.08);
}

.platform-h5-desktop .h5-tabs {
  display: flex;
  gap: 24px;
}

.platform-h5-desktop .tab-link {
  color: var(--tg-hint);
  text-decoration: none;
  font-size: 15px;
}

.platform-h5-desktop .tab-link.active {
  color: var(--tg-btn);
  font-weight: 600;
}

/* 商品列表：桌面端 3 列，移动端 1-2 列 */
.platform-h5-desktop .product-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

.platform-h5-mobile .product-grid,
.platform-telegram-mobile .product-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.platform-telegram-desktop .product-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}
```

### 3.6 路由 — Hash 模式（兼容双平台）

```typescript
// src/router/index.ts
import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  // Hash 模式：兼容 Telegram Mini App 和独立 H5
  // Telegram Mini App 的 URL 由 Bot 控制，Hash 路由不会与 Bot 配置冲突
  history: createWebHashHistory('/_app/'),
  routes: [
    {
      path: '/',
      redirect: '/shop'
    },
    {
      path: '/shop',
      name: 'Shop',
      component: () => import('../views/ShopView.vue')
    },
    {
      path: '/redeem',
      name: 'Redeem',
      component: () => import('../views/RedeemView.vue')
    },
    {
      path: '/lookup',
      name: 'Lookup',
      component: () => import('../views/LookupView.vue')
    }
  ]
})

export default router
```

**为什么用 Hash 模式？**
- Telegram Mini App 的 URL 由 Bot 配置，History 模式会与 Bot 的 WebApp URL 冲突
- Hash 路由在 Telegram 和独立浏览器中都工作正常
- `/_app/#/shop` 在 Telegram 内和浏览器中都指向 Vue3 的 shop 页面

### 3.7 index.html — Telegram SDK 引入

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0,
        minimum-interaction-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <meta name="format-detection" content="telephone=no" />
  <title>AcctBox | 数字权益</title>
  <!-- Telegram WebApp SDK（在 Telegram 外无影响） -->
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <!-- Turnstile -->
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

---

## 四、阶段 2：逐个页面迁移

### 4.1 迁移顺序

| 优先级 | 页面 | 复杂度 | 预估工时 | 理由 |
|---|---|---|---|---|
| **P0** | 商品列表（ShopView） | 中 | 4-6h | 最常用，验证框架可行性 |
| **P1** | 折扣码（RedeemView） | 低 | 2-3h | 逻辑简单，快速验证 |
| **P1** | 订单查询（LookupView） | 低 | 2-3h | 逻辑简单，快速验证 |
| **P2** | 支付弹窗（PayModal） | 高 | 8-12h | 最复杂，4 步骤状态机 |

### 4.2 迁移策略：逐个验证

```
每个页面迁移完成后：
1. npm run build
2. 产物复制到 eshop/public/_app/
3. npx wrangler deploy
4. 在 Telegram 内测试该页面
5. 在桌面浏览器测试该页面
6. 确认正常 → 迁移下一个页面

如果出问题：
- 旧 index.html 仍然在，不受影响
- 用户自动走旧页面，无感知
```

### 4.3 新旧切换机制

Worker 路由中已经实现了自动检测：

```typescript
// 如果 /_app/index.html 存在 → 用 Vue3
// 如果不存在 → 用旧 index.html
// 无需手动切换，部署即生效
```

**回滚方法：** 删除 `eshop/public/_app/` 目录，部署即可回退到旧页面。

---

## 五、双平台关键差异处理

### 5.1 支付弹窗 — 桌面 vs 移动端

```vue
<!-- src/components/PayModal.vue -->
<template>
  <!-- 移动端 / Telegram：全屏弹窗 -->
  <Teleport to="body">
    <transition name="slide-up">
      <div v-if="isVisible" class="pay-overlay" :class="overlayClass">
        <div class="pay-box" :class="boxClass">
          <!-- 关闭按钮（Telegram 用 BackButton，H5 用 X 按钮） -->
          <button v-if="!isTelegram" class="pay-close" @click="close">✕</button>

          <!-- 4 步骤 -->
          <PayFormStep v-if="step === 1" @submit="handleSubmit" />
          <PayOnlineStep v-else-if="step === 2" @back="step--" />
          <PayOfflineStep v-else-if="step === 3" @back="step--" />
          <PayResultStep v-else-if="step === 4" @close="close" />
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { usePlatform } from '../composables/usePlatform'
import { useTelegram } from '../composables/useTelegram'

const { isTelegram, isMobile } = usePlatform()
const { showBackButton, hideBackButton } = useTelegram()

// 桌面 H5：居中模态框
// 移动端 / Telegram：底部滑出面板
const overlayClass = computed(() =>
  isTelegram || isMobile ? 'overlay-fullscreen' : 'overlay-centered'
)
const boxClass = computed(() =>
  isTelegram || isMobile ? 'box-bottom-sheet' : 'box-dialog'
)

// Telegram 中打开弹窗时显示 BackButton
function open() {
  if (isTelegram) showBackButton(() => close())
}
function close() {
  if (isTelegram) hideBackButton()
  // ... 关闭逻辑
}
</script>
```

### 5.2 桌面端特有优化

```css
/* 桌面端支付弹窗：居中对话框 */
.overlay-centered {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.box-dialog {
  width: 480px;
  max-height: 80vh;
  background: var(--tg-secondary-bg);
  border-radius: var(--radius);
  padding: 24px;
  overflow-y: auto;
}

/* 移动端支付弹窗：底部滑出 */
.overlay-fullscreen {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1000;
}

.box-bottom-sheet {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  max-height: 90vh;
  background: var(--tg-bg);
  border-radius: var(--radius) var(--radius) 0 0;
  padding: 20px;
  padding-bottom: calc(20px + env(safe-area-inset-bottom));
  overflow-y: auto;
}
```

### 5.3 Telegram 桌面端特殊处理

Telegram 桌面端（Windows/Mac/Linux）的 Mini App 运行在与移动端不同的容器中：

```typescript
// src/composables/useTelegram.ts — 补充桌面端处理

// Telegram 桌面端可能没有 MainButton
function isMainButtonAvailable() {
  return !!(window as any).Telegram?.WebApp?.MainButton
}

// Telegram 桌面端窗口尺寸可能更大，需要响应式布局
function getViewportWidth() {
  const tg = (window as any).Telegram?.WebApp
  return tg?.viewport?.width || window.innerWidth
}
```

---

## 六、CSP 更新

```typescript
// eshop/src/index.ts — CSP 需要允许 Telegram SDK
const csp = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline' https://unpkg.com",
  `script-src 'self' 'unsafe-inline'${isAdmin ? " 'unsafe-eval'" : ""}
    https://unpkg.com
    https://static.cloudflareinsights.com
    https://challenges.cloudflare.com
    https://telegram.org`,  // ← 新增：Telegram WebApp SDK
  "img-src 'self' data: https:",
  "connect-src 'self' https://unpkg.com https://challenges.cloudflare.com",
  "frame-src 'self' https://challenges.cloudflare.com",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");
```

---

## 七、部署流程

### 7.1 开发

```bash
# 终端 1：启动后端（不变）
cd eshop
npx wrangler dev

# 终端 2：启动前端
cd acctbox-h5
npm run dev
# 打开 http://localhost:5173/#/shop
# API 自动代理到后端
```

### 7.2 构建部署

```bash
# 构建前端
cd acctbox-h5
npm run build
# 输出到 dist/

# 复制到 eshop（不覆盖旧文件）
cp -r dist/* ../eshop/public/_app/

# 部署后端（包含新旧前端）
cd ../eshop
npx wrangler deploy
```

### 7.3 回滚

```bash
# 删除 Vue3 产物 → 自动回退到旧页面
cd eshop
rm -rf public/_app/
npx wrangler deploy
```

---

## 八、时间估算

| 阶段 | 任务 | 工时 |
|---|---|---|
| **阶段 1** | 项目搭建 + Worker 路由修改 + 平台检测 + Telegram 集成 + CSS 基础 | 6-8h |
| **阶段 2** | 商品列表迁移 | 4-6h |
| | 折扣码迁移 | 2-3h |
| | 订单查询迁移 | 2-3h |
| | 支付弹窗迁移 | 8-12h |
| **阶段 3** | 全链路测试（Telegram 手机 + 桌面 + H5 手机 + 桌面） | 4-6h |
| | 旧文件清理 | 0.5h |
| **合计** | | **27-40 小时（约 4-5 个工作日）** |

对比：如果直接改 Vanilla JS 做 Telegram 适配，约 15-23 小时，但后续维护成本更高。

---

## 九、方案总结

### 9.1 核心设计

| 设计点 | 方案 | 理由 |
|---|---|---|
| **渐进式迁移** | 旧 index.html 托底 → Vue3 逐步替代 | 零风险，随时可回滚 |
| **产物隔离** | Vue3 放 `/_app/`，旧文件放 `/` | 不冲突，共存 |
| **自动切换** | Worker 检测 `/_app/index.html` 是否存在 | 部署即生效，无需手动开关 |
| **Hash 路由** | `createWebHashHistory('/_app/')` | 兼容 Telegram Bot URL 和独立浏览器 |
| **平台检测** | `usePlatform()` 运行时检测 | 一套代码适配 4 种场景 |
| **Telegram 主题** | CSS 变量动态注入 | 自动适配 Telegram 暗色/亮色主题 |
| **轻量依赖** | 仅 Vue + Vue Router，不加 Pinia | 保持简单，减少包体积 |

### 9.2 双平台适配矩阵

| 功能 | Telegram 手机 | Telegram 桌面 | H5 手机 | H5 桌面 |
|---|---|---|---|---|
| 导航 | 底部 Tab | 顶部横排 | 顶部 Logo+Tab | 顶部 Logo+Tab |
| 支付弹窗 | 底部滑出 | 底部滑出 | 底部滑出 | 居中对话框 |
| 商品列表 | 2 列网格 | 3 列网格 | 2 列网格 | 3 列网格 |
| 主题色 | Telegram 自动 | Telegram 自动 | 固定暗色 | 固定暗色 |
| 返回 | Telegram BackButton | Telegram BackButton | 顶部 X 按钮 | 顶部 X 按钮 |
| 安全区域 | env(safe-area) | 不需要 | 不需要 | 不需要 |
| 包体积 | ~100KB gzip | ~100KB gzip | ~100KB gzip | ~100KB gzip（桌面更快） |

### 9.3 风险评估

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| Vue3 构建失败 | 低 | 用户无感知 | 旧 index.html 自动托底 |
| Telegram WebView 兼容 | 中 | 低端设备白屏 | legacy plugin + es2015 target |
| CSP 阻止 Telegram SDK | 低 | Telegram 内无法加载 | 已提前在 CSP 中添加 telegram.org |
| Hash 路由与 Bot 冲突 | 极低 | 页面 404 | Hash 路由天然不与 Bot URL 冲突 |
| 支付弹窗状态混乱 | 低 | 支付流程中断 | 组件化隔离，每个步骤独立组件 |

---

*本方案基于：*
*- AcctBox 当前代码结构（1089 行 Vanilla JS）*
*- Cloudflare Workers + assets 部署架构*
*- Telegram Mini Apps 官方文档*
*- 渐进式迁移最佳实践*
