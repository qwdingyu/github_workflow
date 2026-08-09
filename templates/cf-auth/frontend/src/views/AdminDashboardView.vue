<template>
  <div class="admin-page">
    <div class="toolbar">
      <div class="filters">
        <span class="muted">平台总览</span>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" :disabled="loading" @click="load">刷新</button>
    </div>

    <div v-if="loadError" class="notice notice-danger">{{ loadError }}</div>

    <div class="stats-grid">
      <button type="button" class="stat-card stat-link" @click="go('/admin/users')">
        <div class="stat-label">用户</div>
        <div class="stat-value">{{ counts.users }}</div>
      </button>
      <button type="button" class="stat-card stat-link" @click="go('/admin/clients')">
        <div class="stat-label">OAuth 应用</div>
        <div class="stat-value">{{ counts.clients }}</div>
      </button>
      <button type="button" class="stat-card stat-link" @click="go('/admin/sessions')">
        <div class="stat-label">会话</div>
        <div class="stat-value">{{ counts.sessions }}</div>
        <div class="stat-hint">按邮箱或用户 ID 查询</div>
      </button>
      <button type="button" class="stat-card stat-link" @click="go('/admin/clients', { disabled: '1' })">
        <div class="stat-label">已禁用应用</div>
        <div class="stat-value">{{ counts.disabledClients }}</div>
      </button>
      <button type="button" class="stat-card stat-link" @click="go('/admin/social')">
        <div class="stat-label">社交渠道（启用/总数）</div>
        <div class="stat-value">{{ counts.socialEnabled }}/{{ counts.socialTotal }}</div>
        <div class="stat-hint">有效 {{ counts.socialEffective }}</div>
      </button>
      <button type="button" class="stat-card stat-link" @click="go('/admin/blocklist')">
        <div class="stat-label">黑名单条目</div>
        <div class="stat-value">{{ counts.blocklist }}</div>
      </button>
      <button type="button" class="stat-card stat-link" @click="go('/admin/sessions')">
        <div class="stat-label">近 24h 新建会话</div>
        <div class="stat-value">{{ counts.sessionsCreated24h }}</div>
        <div class="stat-hint">需按用户查询明细</div>
      </button>
    </div>

    <p class="muted tip">
      本后台用于：OAuth 应用、用户封禁/黑名单、会话下线、社交登录开关与审计。
      业务项目请用授权码 + PKCE 接入，不要共用本站登录 Cookie。点击上方卡片可进入对应列表。
      侧栏「退出」会结束本站登录会话；普通用户登录不会自动成为管理员。
    </p>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { adminRequest } from '@/composables/useAdminRequest'
import { useAdminListLoader } from '@/composables/useAdminListLoader'

const router = useRouter()
const { loading, loadError, runLoad } = useAdminListLoader()
const counts = reactive({
  users: 0,
  clients: 0,
  sessions: 0,
  disabledClients: 0,
  blocklist: 0,
  sessionsCreated24h: 0,
  socialTotal: 0,
  socialEnabled: 0,
  socialEffective: 0,
})

function go(path: string, query?: Record<string, string>) {
  void router.push({ path, query })
}

async function load() {
  await runLoad(async (ctx) => {
    const data = await adminRequest<{
      counts: {
        users: number
        clients: number
        sessions: number
        disabledClients?: number
        blocklist?: number
        sessionsCreated24h?: number
      }
      socialCounts?: {
        total: number
        enabled: number
        effective: number
      }
    }>('/api/admin/health')
    if (ctx.isStale()) return
    counts.users = data.counts.users
    counts.clients = data.counts.clients
    counts.sessions = data.counts.sessions
    counts.disabledClients = data.counts.disabledClients ?? 0
    counts.blocklist = data.counts.blocklist ?? 0
    counts.sessionsCreated24h = data.counts.sessionsCreated24h ?? 0
    counts.socialTotal = data.socialCounts?.total ?? 0
    counts.socialEnabled = data.socialCounts?.enabled ?? 0
    counts.socialEffective = data.socialCounts?.effective ?? 0
  })
}

onMounted(load)
</script>

<style scoped>
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
}
.stat-card {
  padding: 14px 16px;
  border-radius: var(--r-lg, 12px);
  background: var(--tg-secondary-bg, #151b28);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  text-align: left;
  color: inherit;
  font: inherit;
}
.stat-link {
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.stat-link:hover {
  border-color: rgba(96, 165, 250, 0.45);
  background: rgba(59, 130, 246, 0.08);
}
.stat-label {
  font-size: 12px;
  color: var(--tg-hint, #9aa4b2);
}
.stat-value {
  margin-top: 6px;
  font-size: 24px;
  font-weight: 700;
  color: var(--tg-text, #f0f2f5);
}
.stat-hint {
  margin-top: 4px;
  font-size: 11px;
  color: var(--tg-hint, #9aa4b2);
}
.muted { color: var(--tg-hint, #9aa4b2); font-size: 13px; }
.tip { margin-top: 8px; line-height: 1.5; }
.notice {
  padding: 10px 12px;
  border-radius: var(--r-md, 8px);
  font-size: 13px;
}
.notice-danger {
  background: var(--admin-danger-soft, rgba(248, 113, 113, 0.12));
  color: var(--admin-danger, #fca5a5);
}
</style>
