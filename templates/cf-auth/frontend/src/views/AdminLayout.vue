<template>
  <AdminShell
    brand="cf-auth 平台"
    :menu-items="shellMenuItems"
    :current-name="currentName ?? null"
    :page-title="pageTitle"
    user-name="平台管理员"
    user-avatar="A"
    logout-label="退出"
    toggle-sidebar-label="菜单"
    @logout="handleLogout"
    @navigate="onNavClick"
  >
    <RouterView v-slot="{ Component }">
      <transition name="admin-fade" mode="out-in">
        <component :is="Component" />
      </transition>
    </RouterView>
  </AdminShell>
</template>

<script setup lang="ts">
/**
 * 产品菜单 + 登出；壳/响应式侧栏来自 @usethink/cf-admin-fe AdminShell。
 * 鉴权仍是 Better Auth cookie + 本地 flag（useAdminAuth），非 Bearer。
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { AdminShell, type AdminShellMenuItem } from '@usethink/cf-admin-fe/components'
import { useAdminAuth } from '@/composables/useAdminAuth'
import { useToast } from '@/composables/useToast'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { clearToken } = useAdminAuth()
const { showToast } = useToast()

/**
 * 菜单排序（最佳实践）：
 *   运营核心 → 安全运营 → 基础设施 → 平台管理 → 合规审计
 *   总览永远在最前，审计永远在最后。
 */
const menuItems: AdminShellMenuItem[] = [
  // ── 运营核心 ──
  { name: 'AdminDashboard', to: '/admin', label: '总览', icon: '📊' },
  { name: 'AdminClients', to: '/admin/clients', label: 'OAuth 应用', icon: '🔑' },
  { name: 'AdminUsers', to: '/admin/users', label: '用户', icon: '👥' },
  { name: 'AdminSocial', to: '/admin/social', label: '社交登录', icon: '🔗' },
  // ── 安全运营 ──
  { name: 'AdminSessions', to: '/admin/sessions', label: '会话', icon: '🔐' },
  { name: 'AdminBlocklist', to: '/admin/blocklist', label: '黑名单', icon: '🚫' },
  { name: 'AdminTrustedOrigins', to: '/admin/trusted-origins', label: '信任域', icon: '🌐' },
  // ── 基础设施 ──
  { name: 'AdminEmailConfig', to: '/admin/email-config', label: '邮件配置', icon: '📧' },
  { name: 'AdminEmailLogs', to: '/admin/email-logs', label: '邮件日志', icon: '✉️' },
  // ── 平台管理 ──
  { name: 'AdminSystemConfig', to: '/admin/system-config', label: '系统配置', icon: '⚙️' },
  // ── 合规审计 ──
  { name: 'AdminAudit', to: '/admin/audit', label: '审计', icon: '📝' },
]

const shellMenuItems = computed(() => menuItems)
const currentName = computed(() => route.name as string | undefined)
const pageTitle = computed(() => {
  const item = menuItems.find((m) => m.name === currentName.value)
  return item?.label || '管理后台'
})

function onNavClick(to: string) {
  if (route.fullPath === to) return
  router.push(to)
}

async function handleLogout() {
  try {
    await fetch('/api/auth/sign-out', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
  } catch {
    /* ignore */
  }
  clearToken()
  showToast(t('adminLayout.loggedOut'), 'success')
  router.replace('/admin/login')
}
</script>
