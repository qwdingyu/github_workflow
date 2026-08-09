/**
 * Admin 路由。
 * 守卫：优先 localStorage flag；若无 flag，探测 /api/admin/health（复用 Google 等已有 session）。
 * 真正权限仍在服务端 ADMIN_* 白名单。
 */
import { createRouter, createWebHistory } from 'vue-router'
import { readAdminFlag, writeAdminFlag } from '@/composables/useAdminAuth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/admin/login',
      name: 'AdminLogin',
      component: () => import('@/views/AdminLoginView.vue'),
      meta: { public: true },
    },
    {
      path: '/admin',
      component: () => import('@/views/AdminLayout.vue'),
      children: [
        {
          path: '',
          name: 'AdminDashboard',
          component: () => import('@/views/AdminDashboardView.vue'),
        },
        {
          path: 'clients',
          name: 'AdminClients',
          component: () => import('@/views/AdminClientsView.vue'),
        },
        {
          path: 'users',
          name: 'AdminUsers',
          component: () => import('@/views/AdminUsersView.vue'),
        },
        {
          path: 'sessions',
          name: 'AdminSessions',
          component: () => import('@/views/AdminSessionsView.vue'),
        },
        {
          path: 'blocklist',
          name: 'AdminBlocklist',
          component: () => import('@/views/AdminBlocklistView.vue'),
        },
        {
          path: 'trusted-origins',
          name: 'AdminTrustedOrigins',
          component: () => import('@/views/AdminTrustedOriginsView.vue'),
        },
        {
          path: 'email-config',
          name: 'AdminEmailConfig',
          component: () => import('@/views/AdminEmailConfigView.vue'),
        },
        {
          path: 'email-logs',
          name: 'AdminEmailLogs',
          component: () => import('@/views/AdminEmailLogsView.vue'),
        },
        {
          path: 'system-config',
          name: 'AdminSystemConfig',
          component: () => import('@/views/AdminSystemConfigView.vue'),
        },
        {
          path: 'social',
          name: 'AdminSocial',
          component: () => import('@/views/AdminSocialProvidersView.vue'),
        },
        {
          path: 'audit',
          name: 'AdminAudit',
          component: () => import('@/views/AdminAuditView.vue'),
        },
      ],
    },
    { path: '/', redirect: '/admin' },
    { path: '/:pathMatch(.*)*', redirect: '/admin' },
  ],
})

let probing = false

async function sessionIsPlatformAdmin(): Promise<boolean> {
  if (probing) return false
  probing = true
  try {
    const res = await fetch('/api/admin/health', { credentials: 'include' })
    if (!res.ok) return false
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean }
    if (data.ok) {
      writeAdminFlag(true)
      return true
    }
  } catch {
    return false
  } finally {
    probing = false
  }
  return false
}

router.beforeEach(async (to) => {
  if (to.meta.public) return true
  if (!to.path.startsWith('/admin')) return true
  if (readAdminFlag()) return true

  // Google 等已在 /sign-in 建 session，但从未写过 localStorage flag
  if (await sessionIsPlatformAdmin()) return true

  return {
    path: '/admin/login',
    query: { redirect: to.fullPath },
  }
})

export default router
