import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  // Hash 路由：兼容 Telegram Mini App 和独立 H5 浏览器
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: '/shop',
    },
    {
      path: '/shop',
      name: 'Shop',
      component: () => import('@/views/ShopView.vue'),
    },
    {
      path: '/redeem',
      name: 'Redeem',
      component: () => import('@/views/RedeemView.vue'),
    },
    {
      path: '/lookup',
      name: 'Lookup',
      component: () => import('@/views/LookupView.vue'),
    },
    {
      path: '/order',
      name: 'Order',
      component: () => import('@/views/OrderView.vue'),
    },
  ],
})

export default router
