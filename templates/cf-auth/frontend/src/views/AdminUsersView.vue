<template>
  <div class="admin-page">
    <div class="toolbar">
      <div class="filters">
        <input v-model="q" type="search" placeholder="搜索邮箱 / 用户 ID / 显示名" @keyup.enter="onSearch" />
        <button type="button" class="btn btn-ghost btn-sm" :disabled="loading" @click="onSearch">
          搜索
        </button>
      </div>
    </div>

    <div v-if="selectedCount > 0" class="bulk-bar" role="status">
      <span>已选 {{ selectedCount }} 人（仅当前页）</span>
      <div class="bulk-actions">
        <button type="button" class="btn btn-ghost btn-sm" :disabled="mutating" @click="clearSelection">
          清除选择
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          :disabled="mutating || selectedCount === 0"
          @click="batchRevokeAccess"
        >
          批量下线（不封禁）
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          :disabled="mutating || selectedCount === 0"
          @click="batchBlock"
        >
          批量封禁并下线
        </button>
        <button
          type="button"
          class="btn btn-danger btn-sm"
          :disabled="mutating || selectedCount === 0"
          @click="batchDelete"
        >
          {{ mutating ? '处理中…' : `硬删除 (${selectedCount})` }}
        </button>
      </div>
    </div>

    <div v-if="loadError" class="notice">{{ loadError }}</div>
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
            <th>邮箱</th>
            <th>显示名</th>
            <th>邮箱已验证</th>
            <th>登录方式</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id" :class="{ 'is-selected': isSelected(u.id) }">
            <td class="select-cell">
              <input
                type="checkbox"
                :checked="isSelected(u.id)"
                :disabled="loading || mutating"
                :aria-label="`选择 ${u.email}`"
                @click="setSelected(u.id, ($event.target as HTMLInputElement).checked, ($event as MouseEvent).shiftKey)"
              />
            </td>
            <td>{{ u.email }}</td>
            <td>{{ u.name }}</td>
            <td>{{ u.emailVerified ? '是' : '否' }}</td>
            <td class="providers">
              <span v-for="p in u.providers" :key="p.providerId + p.accountId" class="chip">
                {{ p.providerId }}
              </span>
              <span v-if="!u.providers?.length">—</span>
            </td>
            <td class="actions">
              <button type="button" class="btn btn-ghost btn-xs" @click="goSessions(u.id)">会话</button>
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                :disabled="mutating"
                @click="revokeOne(u)"
              >
                仅下线
              </button>
              <button v-if="!u.blocked"
                type="button"
                class="btn btn-ghost btn-xs danger-text"
                :disabled="mutating"
                @click="blockOne(u)"
              >
                封禁并下线
              </button>
              <button v-else
                type="button"
                class="btn btn-ghost btn-xs"
                :disabled="mutating"
                @click="enableOne(u)"
              >
                解禁
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-xs danger-text"
                :disabled="mutating"
                @click="deleteOne(u)"
              >
                硬删除
              </button>
            </td>
          </tr>
          <tr v-if="!loading && users.length === 0">
            <td colspan="6">无用户</td>
          </tr>
        </tbody>
      </table>
    </div>
    <AdminPagination
      :page="page"
      :total="total"
      :total-pages="totalPages"
      :limit="limit"
      @prev="prevPage(); reload()"
      @next="nextPage(); reload()"
      @jump="(p) => { setPage(p); reload() }"
      @update:limit="(l) => { setLimit(l); reload() }"
    />
    <ConfirmDialog
      v-model="confirmVisible"
      :message="confirmMessage"
      :require-phrase="confirmRequirePhrase"
      danger
      @confirm="onConfirm"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AdminPagination from '@/components/AdminPagination'
import ConfirmDialog from '@/components/ConfirmDialog'
import { adminRequest } from '@/composables/useAdminRequest'
import { useAdminListLoader } from '@/composables/useAdminListLoader'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useTablePagination } from '@/composables/useTablePagination'
import { useTableSelection } from '@/composables/useTableSelection'
import { useToast } from '@/composables/useToast'
import { toErrorMessage, buildBatchToast, checkAdminBatchLimit } from '@usethink/cf-admin-fe/utils'

/** 与服务端 isDeleteConfirmed / HARD_DELETE_BATCH_MAX 对齐 */
const HARD_DELETE_PHRASE = 'DELETE'
const HARD_DELETE_MAX = 10

type UserRow = {
  id: string
  email: string
  name: string
  emailVerified: boolean
  blocked: boolean
  providers: Array<{ providerId: string; accountId: string }>
}

const router = useRouter()
const { showToast } = useToast()
const {
  confirmVisible, confirmMessage, confirmRequirePhrase, askConfirm, onConfirm,
} = useConfirmDialog()
const q = ref('')
const mutating = ref(false)
const users = ref<UserRow[]>([])
const { loading, loadError, runLoad } = useAdminListLoader()
const { page, limit, total, totalPages, setPage, setLimit, setTotal, nextPage, prevPage, offset } =
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
} = useTableSelection(users, (row) => row.id)

function onSearch() {
  setPage(1)
  void reload()
}

async function reload() {
  await runLoad(async (ctx) => {
    const data = await adminRequest<{ users: UserRow[]; total: number }>('/api/admin/users', {
      params: {
        limit: limit.value,
        offset: offset.value,
        q: q.value.trim() || undefined,
      },
    })
    if (ctx.isStale()) return
    users.value = data.users
    setTotal(data.total)
  })
}

function goSessions(userId: string) {
  router.push({ path: '/admin/sessions', query: { userId } })
}

async function blockUser(userId: string, email: string) {
  await adminRequest(`/api/admin/users/${encodeURIComponent(userId)}/block`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'admin', alsoEmail: true }),
  })
  showToast(`已封禁 ${email}（含会话与令牌下线）`, 'success')
}

async function blockOne(u: UserRow) {
  if (mutating.value) return
  const ok = await askConfirm(
    `确认封禁 ${u.email}？将写入黑名单并强制下线（清除登录会话与相关令牌），之后无法再登录。`,
  )
  if (!ok) return
  mutating.value = true
  try {
    await blockUser(u.id, u.email)
    clearSelection()
    await reload()
  } catch (e) {
    showToast(toErrorMessage(e), 'error')
  } finally {
    mutating.value = false
  }
}

/** 解禁用户：移除 user_id 与 email 类型的 blocklist 记录 */
async function enableOne(u: UserRow) {
  if (mutating.value) return
  const ok = await askConfirm(
    `确认解禁 ${u.email}？将从黑名单移除，该用户可重新登录。`,
  )
  if (!ok) return
  mutating.value = true
  try {
    await adminRequest(`/api/admin/users/${encodeURIComponent(u.id)}/enable`, { method: 'POST' })
    showToast(`已解禁 ${u.email}`, 'success')
    clearSelection()
    await reload()
  } catch (e) {
    showToast(toErrorMessage(e), 'error')
  } finally {
    mutating.value = false
  }
}

/** 单用户完整下线：复用 DELETE /users/:id/sessions，不写黑名单 */
async function revokeOne(u: UserRow) {
  if (mutating.value) return
  const ok = await askConfirm(
    `确认仅下线 ${u.email}？将清除其登录会话与相关令牌，不写入黑名单，对方仍可再次登录。`,
  )
  if (!ok) return
  mutating.value = true
  try {
    const res = await adminRequest<{
      sessionsDeleted?: number
      refreshRevoked?: number
      accessDeleted?: number
    }>(`/api/admin/users/${encodeURIComponent(u.id)}/sessions`, { method: 'DELETE' })
    showToast(
      `已下线 ${u.email}：session ${res.sessionsDeleted ?? 0} / refresh ${res.refreshRevoked ?? 0} / access ${res.accessDeleted ?? 0}`,
      'success',
    )
    clearSelection()
    await reload()
  } catch (e) {
    showToast(toErrorMessage(e), 'error')
  } finally {
    mutating.value = false
  }
}

async function batchBlock() {
  const ids = [...selectedIds.value]
  if (ids.length === 0 || mutating.value) return
  const limitCheck = checkAdminBatchLimit(ids, { unit: '人' })
  if (!limitCheck.ok) {
    showToast(limitCheck.message, 'error')
    return
  }
  const ok = await askConfirm(
    `确认批量封禁 ${ids.length} 人？将写入黑名单并完整下线（服务端上限 20，仅当前页已选）。`,
  )
  if (!ok) return
  mutating.value = true
  try {
    const res = await adminRequest<{ success: number; failed: number }>(
      '/api/admin/users/batch-block',
      {
        method: 'POST',
        body: JSON.stringify({
          userIds: ids,
          reason: 'admin-batch',
          alsoEmail: true,
        }),
      },
    )
    const toast = buildBatchToast(res, {
      mixed: '封禁完成：成功 {success}，失败 {failed}',
      success: '已封禁 {count} 人',
    })
    showToast(toast.message, toast.type)
    clearSelection()
    await reload()
  } catch (e) {
    showToast(toErrorMessage(e), 'error')
  } finally {
    mutating.value = false
  }
}

/** 单用户硬删除：须键入 DELETE；禁删白名单/本人由服务端强制 */
async function deleteOne(u: UserRow) {
  if (mutating.value) return
  const ok = await askConfirm(
    `【不可逆】硬删除用户 ${u.email}（${u.id}）？\n` +
      `将强制下线并彻底删除账号及关联登录数据。\n` +
      `业务应用若仍引用该用户 ID 会失效。管理员名单中的账号与操作者本人不可删。正式用户请优先用「封禁」。`,
    { requirePhrase: HARD_DELETE_PHRASE },
  )
  if (!ok) return
  mutating.value = true
  try {
    await adminRequest(`/api/admin/users/${encodeURIComponent(u.id)}/delete`, {
      method: 'POST',
      body: JSON.stringify({ confirm: HARD_DELETE_PHRASE }),
    })
    showToast(`已硬删除 ${u.email}`, 'success')
    clearSelection()
    await reload()
  } catch (e) {
    showToast(toErrorMessage(e), 'error')
  } finally {
    mutating.value = false
  }
}

/** 批量硬删除：上限 HARD_DELETE_MAX；须键入 DELETE */
async function batchDelete() {
  const ids = [...selectedIds.value]
  if (ids.length === 0 || mutating.value) return
  const limitCheck = checkAdminBatchLimit(ids, {
    limit: HARD_DELETE_MAX,
    message: `硬删除单次最多 ${HARD_DELETE_MAX} 人，请缩小选择`,
  })
  if (!limitCheck.ok) {
    showToast(limitCheck.message, 'error')
    return
  }
  const ok = await askConfirm(
    `【不可逆】硬删除 ${ids.length} 个用户？\n` +
      `仅当前页已选；上限 ${HARD_DELETE_MAX}。将彻底删除账号及关联数据。\n` +
      `测试垃圾账号可删；正式用户请优先「封禁」。管理员名单中的账号与操作者本人会被服务端拒绝。`,
    { requirePhrase: HARD_DELETE_PHRASE },
  )
  if (!ok) return
  mutating.value = true
  try {
    const res = await adminRequest<{ success: number; failed: number }>(
      '/api/admin/users/batch-delete',
      {
        method: 'POST',
        body: JSON.stringify({ userIds: ids, confirm: HARD_DELETE_PHRASE }),
      },
    )
    const toast = buildBatchToast(res, {
      mixed: '删除完成：成功 {success}，失败 {failed}',
      success: '已硬删除 {count} 人',
    })
    showToast(toast.message, toast.type)
    clearSelection()
    await reload()
  } catch (e) {
    showToast(toErrorMessage(e), 'error')
  } finally {
    mutating.value = false
  }
}

/** 批量仅下线：POST /users/batch-revoke-access，不写黑名单 */
async function batchRevokeAccess() {
  const ids = [...selectedIds.value]
  if (ids.length === 0 || mutating.value) return
  const limitCheck = checkAdminBatchLimit(ids, { unit: '人' })
  if (!limitCheck.ok) {
    showToast(limitCheck.message, 'error')
    return
  }
  const ok = await askConfirm(
    `确认批量下线 ${ids.length} 人（不封禁）？将清除其登录会话与相关令牌，对方仍可再次登录。`,
  )
  if (!ok) return
  mutating.value = true
  try {
    const res = await adminRequest<{
      success: number
      failed: number
      sessionsDeleted?: number
      refreshRevoked?: number
      accessDeleted?: number
    }>('/api/admin/users/batch-revoke-access', {
      method: 'POST',
      body: JSON.stringify({ userIds: ids }),
    })
    if (res.failed > 0) {
      const toast = buildBatchToast(res, {
        mixed: '下线完成：成功 {success}，失败 {failed}',
        success: '',
      })
      showToast(toast.message, toast.type)
    } else {
      showToast(
        `已下线 ${res.success} 人（session ${res.sessionsDeleted ?? 0} / refresh ${res.refreshRevoked ?? 0} / access ${res.accessDeleted ?? 0}）`,
        'success',
      )
    }
    clearSelection()
    await reload()
  } catch (e) {
    showToast(toErrorMessage(e), 'error')
  } finally {
    mutating.value = false
  }
}

onMounted(reload)
</script>

<style scoped>
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
.select-cell {
  width: 36px;
}
.is-selected {
  background: rgba(251, 191, 36, 0.06);
}
.chip {
  display: inline-block;
  margin: 2px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--surface-2);
  font-size: 11px;
}
.notice {
  padding: 10px;
  color: var(--admin-danger);
  font-size: 13px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.danger-text {
  color: var(--admin-danger, #fca5a5);
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
  flex-wrap: wrap;
  gap: 6px;
}
</style>
