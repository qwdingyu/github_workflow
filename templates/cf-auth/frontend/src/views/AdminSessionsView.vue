<template>
  <div class="admin-page">
    <div class="toolbar">
      <div class="filters">
        <input
          v-model="query"
          type="search"
          placeholder="邮箱或用户 ID"
          aria-label="按邮箱或用户 ID 查询会话"
          @keyup.enter="load"
        />
        <button type="button" class="btn btn-ghost btn-sm" :disabled="loading" @click="load">
          查询会话
        </button>
      </div>
      <button
        type="button"
        class="btn btn-danger btn-sm"
        :disabled="!resolvedUserId || sessions.length === 0 || mutating"
        @click="revokeAll"
      >
        强制全部下线
      </button>
    </div>

    <p v-if="resolvedUserId || resolvedEmail" class="muted resolve-meta">
      <template v-if="resolvedEmail">邮箱 {{ resolvedEmail }} · </template>
      用户 ID <code class="mono">{{ resolvedUserId || '—' }}</code>
    </p>

    <div v-if="selectedCount > 0" class="bulk-bar" role="status">
      <span>已选 {{ selectedCount }} 个会话（仅当前页）</span>
      <div class="bulk-actions">
        <button type="button" class="btn btn-ghost btn-sm" :disabled="mutating" @click="clearSelection">
          清除选择
        </button>
        <button
          type="button"
          class="btn btn-danger btn-sm"
          :disabled="mutating || selectedCount === 0"
          @click="batchRevoke"
        >
          {{ mutating ? '处理中…' : `批量下线 (${selectedCount})` }}
        </button>
      </div>
    </div>

    <div v-if="loadError" class="notice">{{ loadError }}</div>
    <div v-if="infoMessage" class="notice notice-info">{{ infoMessage }}</div>
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th class="select-cell">
              <input
                type="checkbox"
                :checked="allVisibleSelected"
                :indeterminate.prop="partiallySelected"
                :disabled="loading || mutating || selectableCount === 0"
                aria-label="全选本页"
                @change="toggleAllVisible(($event.target as HTMLInputElement).checked)"
              />
            </th>
            <th>会话 ID</th>
            <th>IP</th>
            <th>浏览器 / 设备</th>
            <th>过期时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="s in sessions"
            :key="s.id"
            :class="{ 'is-selected': isSelected(s.id) }"
          >
            <td class="select-cell">
              <input
                type="checkbox"
                :checked="isSelected(s.id)"
                :disabled="loading || mutating"
                :aria-label="`选择会话 ${s.id}`"
                @click="setSelected(s.id, ($event.target as HTMLInputElement).checked, ($event as MouseEvent).shiftKey)"
              />
            </td>
            <td><code class="mono">{{ s.id }}</code></td>
            <td>{{ s.ipAddress || '—' }}</td>
            <td class="ua">{{ s.userAgent || '—' }}</td>
            <td>{{ formatDate(s.expiresAt) }}</td>
            <td>
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                :disabled="mutating"
                @click="revokeOne(s.id)"
              >
                下线
              </button>
            </td>
          </tr>
          <tr v-if="!loading && hasQueried && sessions.length === 0 && !loadError">
            <td colspan="6">{{ infoMessage || '该用户当前无有效会话' }}</td>
          </tr>
          <tr v-if="!hasQueried && !loading">
            <td colspan="6">请输入邮箱或用户 ID 后查询（也可从「用户」页点「会话」跳转）</td>
          </tr>
        </tbody>
      </table>
    </div>
    <AdminPagination
      v-if="hasQueried && !loadError"
      :page="page"
      :total="total"
      :total-pages="totalPages"
      :limit="limit"
      @prev="prevPage(); load()"
      @next="nextPage(); load()"
      @jump="(p) => { setPage(p); load() }"
      @update:limit="(l) => { setLimit(l); load() }"
    />
    <ConfirmDialog v-model="confirmVisible" :message="confirmMessage" danger @confirm="onConfirm" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AdminPagination from '@/components/AdminPagination'
import ConfirmDialog from '@/components/ConfirmDialog'
import { adminRequest } from '@/composables/useAdminRequest'
import { useAdminListLoader } from '@/composables/useAdminListLoader'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { formatDate } from '@/composables/useFormat'
import { useTablePagination } from '@/composables/useTablePagination'
import { useTableSelection } from '@/composables/useTableSelection'
import { useToast } from '@/composables/useToast'
import { toErrorMessage, buildBatchToast, checkAdminBatchLimit } from '@usethink/cf-admin-fe/utils'

type SessionRow = {
  id: string
  ipAddress: string | null
  userAgent: string | null
  expiresAt: string | Date
}

const route = useRoute()
const { showToast } = useToast()
const { confirmVisible, confirmMessage, askConfirm, onConfirm } = useConfirmDialog()

/** 查询框：邮箱或 userId */
const query = ref('')
/** 解析后的用户 id（下线 API 需要） */
const resolvedUserId = ref('')
const resolvedEmail = ref('')
const sessions = ref<SessionRow[]>([])
const mutating = ref(false)
const infoMessage = ref('')
const hasQueried = ref(false)
const { loading, loadError, runLoad } = useAdminListLoader()
const { page, limit, total, totalPages, setPage, setLimit, setTotal, nextPage, prevPage } =
  useTablePagination({ initialLimit: 20 })

const {
  selectedCount,
  selectableCount,
  allVisibleSelected,
  partiallySelected,
  isSelected,
  setSelected,
  toggleAllVisible,
  clearSelection,
  selectedIds,
} = useTableSelection(sessions, (row) => row.id)

function applyRouteQuery() {
  const q = route.query
  if (typeof q.email === 'string' && q.email.trim()) {
    query.value = q.email.trim()
    return true
  }
  if (typeof q.userId === 'string' && q.userId.trim()) {
    query.value = q.userId.trim()
    return true
  }
  if (typeof q.q === 'string' && q.q.trim()) {
    query.value = q.q.trim()
    return true
  }
  return false
}

async function load() {
  const q = query.value.trim()
  if (!q) {
    sessions.value = []
    resolvedUserId.value = ''
    resolvedEmail.value = ''
    infoMessage.value = ''
    hasQueried.value = false
    setTotal(0)
    setPage(1)
    clearSelection()
    return
  }
  setPage(1)
  infoMessage.value = ''
  hasQueried.value = true
  const ok = await runLoad(async (ctx) => {
    const data = await adminRequest<{
      sessions: SessionRow[]
      userId?: string | null
      email?: string | null
      message?: string
      queryKind?: string
      total?: number
      totalPages?: number
      page?: number
      limit?: number
    }>('/api/admin/sessions', { params: { q, page: String(page.value), limit: String(limit.value) } })
    if (ctx.isStale()) return
    sessions.value = data.sessions ?? []
    resolvedUserId.value = data.userId ?? ''
    resolvedEmail.value = data.email ?? ''
    if (data.total !== undefined) setTotal(data.total)
    if (data.message) infoMessage.value = data.message
    clearSelection()
  })
  // 仅真实失败时清空；stale 竞态由较新请求覆盖，勿擦掉
  if (!ok && loadError.value) {
    sessions.value = []
    resolvedUserId.value = ''
    resolvedEmail.value = ''
  }
}

async function revokeAll() {
  if (!resolvedUserId.value) return
  const ok = await askConfirm(
    `确认强制下线用户 ${resolvedEmail.value || resolvedUserId.value} 的全部会话？将清除登录会话与相关令牌（不会自动封禁；若要禁止再登录请到「用户」页执行封禁）。`,
  )
  if (!ok) return
  mutating.value = true
  try {
    const res = await adminRequest<{
      sessionsDeleted?: number
      refreshRevoked?: number
      accessDeleted?: number
    }>(`/api/admin/users/${encodeURIComponent(resolvedUserId.value)}/sessions`, {
      method: 'DELETE',
    })
    showToast(
      `已强制下线：会话 ${res.sessionsDeleted ?? '—'} / 刷新令牌 ${res.refreshRevoked ?? '—'} / 访问令牌 ${res.accessDeleted ?? '—'}`,
      'success',
    )
    clearSelection()
    await load()
  } catch (e) {
    showToast(toErrorMessage(e), 'error')
  } finally {
    mutating.value = false
  }
}

async function revokeOne(id: string) {
  const ok = await askConfirm(`确认下线此会话？相关 OAuth 令牌会一并失效。`)
  if (!ok) return
  mutating.value = true
  try {
    await adminRequest(`/api/admin/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
    showToast('已下线', 'success')
    await load()
  } catch (e) {
    showToast(toErrorMessage(e), 'error')
  } finally {
    mutating.value = false
  }
}

/** 批量下线：POST /sessions/batch-revoke，上限 20 */
async function batchRevoke() {
  const ids = [...selectedIds.value]
  if (ids.length === 0 || mutating.value) return
  const limitCheck = checkAdminBatchLimit(ids, { message: '单次最多 20 个会话，请缩小选择' })
  if (!limitCheck.ok) {
    showToast(limitCheck.message, 'error')
    return
  }
  const ok = await askConfirm(
    `确认批量下线 ${ids.length} 个会话？将清除这些会话并撤销关联令牌。`,
  )
  if (!ok) return
  mutating.value = true
  try {
    const res = await adminRequest<{
      success: number
      failed: number
      refreshRevoked?: number
      accessDeleted?: number
    }>('/api/admin/sessions/batch-revoke', {
      method: 'POST',
      body: JSON.stringify({ sessionIds: ids }),
    })
    if (res.failed > 0) {
      const toast = buildBatchToast(res, {
        mixed: '完成：成功 {success}，失败 {failed}',
        success: '',
      })
      showToast(toast.message, toast.type)
    } else {
      showToast(
        `已下线 ${res.success} 个（refresh ${res.refreshRevoked ?? 0} / access ${res.accessDeleted ?? 0}）`,
        'success',
      )
    }
    clearSelection()
    await load()
  } catch (e) {
    showToast(toErrorMessage(e), 'error')
  } finally {
    mutating.value = false
  }
}

onMounted(() => {
  if (applyRouteQuery()) void load()
})
watch(
  () => [route.query.userId, route.query.email, route.query.q],
  () => {
    if (applyRouteQuery()) void load()
  },
)
</script>

<style scoped>
.resolve-meta {
  margin: 0 0 10px;
  font-size: 12px;
}
.bulk-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  padding: 8px 12px;
  border-radius: var(--r-md, 8px);
  border: 1px solid var(--admin-warning-border, rgba(251, 191, 36, 0.35));
  background: var(--admin-warning-soft, rgba(251, 191, 36, 0.1));
  font-size: 13px;
  color: var(--tg-text);
}
.bulk-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.select-cell {
  width: 36px;
}
.is-selected {
  background: rgba(251, 191, 36, 0.06);
}
.table-wrap {
  overflow: auto;
  border-radius: var(--r-lg, 12px);
  border: 1px solid var(--border);
  background: var(--tg-secondary-bg);
}
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.data-table th,
.data-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  text-align: left;
}
.data-table th {
  color: var(--tg-hint);
  font-size: 12px;
}
.mono { font-size: 11px; word-break: break-all; }
.ua { max-width: 240px; font-size: 11px; color: var(--tg-hint); word-break: break-all; }
.notice {
  padding: 10px;
  color: var(--admin-danger);
  font-size: 13px;
}
.notice-info { color: var(--tg-hint, #9aa4b2); }
.muted { color: var(--tg-hint, #9aa4b2); }
</style>
