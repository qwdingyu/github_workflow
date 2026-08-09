<template>
  <div class="admin-page">
    <div class="toolbar">
      <div class="filters">
        <select v-model="typeFilter" @change="onFilterChange">
          <option value="">全部类型</option>
          <option value="email">email</option>
          <option value="user_id">user_id</option>
          <option value="email_domain">email_domain</option>
        </select>
        <button type="button" class="btn btn-ghost btn-sm" :disabled="loading" @click="reload">
          刷新
        </button>
      </div>
      <button type="button" class="btn btn-primary btn-sm" @click="openAdd">添加</button>
    </div>

    <p class="hint">
      平台登录黑名单：命中后无法新建登录会话（邮箱与社交登录均拦截）。与业务站自身的活动/抽奖黑名单无关。
      添加时会对已匹配用户执行强制下线（会话与相关令牌）。
      「批量移除」只删黑名单条目（上限 20，仅当前页），不删除用户账号；移除后对方可再次登录。
      审计日志不可在此删除。
    </p>

    <div v-if="selectedCount > 0" class="bulk-bar" role="status">
      <span>已选 {{ selectedCount }} 条（仅当前页）</span>
      <div class="bulk-actions">
        <button type="button" class="btn btn-ghost btn-sm" :disabled="mutating" @click="clearSelection">
          清除选择
        </button>
        <button
          type="button"
          class="btn btn-danger btn-sm"
          :disabled="mutating || selectedCount === 0"
          @click="batchRemove"
        >
          {{ mutating ? '处理中…' : `批量移除 (${selectedCount})` }}
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
            <th>类型</th>
            <th>值</th>
            <th>原因</th>
            <th>添加时间</th>
            <th>过期</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in items"
            :key="item.id"
            :class="{ 'is-selected': isSelected(item.id) }"
          >
            <td class="select-cell">
              <input
                type="checkbox"
                :checked="isSelected(item.id)"
                :disabled="loading || mutating"
                :aria-label="`选择 ${item.type}:${item.value}`"
                @click="setSelected(item.id, ($event.target as HTMLInputElement).checked, ($event as MouseEvent).shiftKey)"
              />
            </td>
            <td><code>{{ item.type }}</code></td>
            <td class="mono">{{ item.value }}</td>
            <td>{{ item.reason || '—' }}</td>
            <td>{{ formatDate(item.createdAt) }}</td>
            <td>{{ item.expiresAt ? formatDate(item.expiresAt) : '永久' }}</td>
            <td>
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                :disabled="mutating || operatingId === item.id"
                @click="removeOne(item)"
              >
                {{ operatingId === item.id ? '删除中…' : '移除' }}
              </button>
            </td>
          </tr>
          <tr v-if="!loading && items.length === 0">
            <td colspan="7">暂无黑名单</td>
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

    <AdminModal v-model="modalOpen" title="添加黑名单" max-width="480px" hide-actions>
      <label class="field-label">
        <span>类型</span>
        <select v-model="form.type">
          <option value="email">email</option>
          <option value="user_id">user_id</option>
          <option value="email_domain">email_domain</option>
        </select>
      </label>
      <label class="field-label">
        <span>值</span>
        <input
          v-model="form.value"
          type="text"
          :placeholder="form.type === 'email' ? 'user@example.com' : form.type === 'email_domain' ? 'example.com' : 'user id'"
        />
      </label>
      <label class="field-label">
        <span>原因（可选）</span>
        <input v-model="form.reason" type="text" maxlength="200" placeholder="运营备注" />
      </label>
      <template #actions>
        <button type="button" class="btn btn-ghost" @click="modalOpen = false">取消</button>
        <button type="button" class="btn btn-primary" :disabled="saving" @click="save">
          {{ saving ? '提交中…' : '添加' }}
        </button>
      </template>
    </AdminModal>

    <ConfirmDialog v-model="confirmVisible" :message="confirmMessage" danger @confirm="onConfirm" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import AdminModal from '@/components/AdminModal'
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

type BlockRow = {
  id: string
  type: string
  value: string
  reason: string | null
  createdAt: string | Date
  expiresAt: string | Date | null
}

const { showToast } = useToast()
const { confirmVisible, confirmMessage, askConfirm, onConfirm } = useConfirmDialog()
const {
  page, limit, total, totalPages, setPage, setLimit, setTotal, nextPage, prevPage, offset,
} = useTablePagination({ initialLimit: 20 })

const typeFilter = ref('')
const saving = ref(false)
const mutating = ref(false)
const operatingId = ref('')
const items = ref<BlockRow[]>([])
const { loading, loadError, runLoad } = useAdminListLoader()
const modalOpen = ref(false)
const form = reactive({
  type: 'email' as 'email' | 'user_id' | 'email_domain',
  value: '',
  reason: '',
})

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
} = useTableSelection(items, (row) => row.id)

function onFilterChange() {
  setPage(1)
  clearSelection()
  void reload()
}

async function reload() {
  await runLoad(async (ctx) => {
    const data = await adminRequest<{ items: BlockRow[]; total: number }>('/api/admin/blocklist', {
      params: {
        limit: limit.value,
        offset: offset.value,
        type: typeFilter.value || undefined,
      },
    })
    if (ctx.isStale()) return
    items.value = data.items
    setTotal(data.total)
  })
}

function openAdd() {
  form.type = 'email'
  form.value = ''
  form.reason = ''
  modalOpen.value = true
}

async function save() {
  if (!form.value.trim()) {
    showToast('请填写值', 'error')
    return
  }
  saving.value = true
  try {
    await adminRequest('/api/admin/blocklist', {
      method: 'POST',
      body: JSON.stringify({
        type: form.type,
        value: form.value.trim(),
        reason: form.reason.trim() || undefined,
      }),
    })
    showToast('已添加（已匹配用户已下线）', 'success')
    modalOpen.value = false
    await reload()
  } catch (e) {
    showToast(toErrorMessage(e), 'error')
  } finally {
    saving.value = false
  }
}

async function removeOne(item: BlockRow) {
  if (operatingId.value || mutating.value) return
  const ok = await askConfirm(`确认移除黑名单 ${item.type}:${item.value}？移除后对方可再次登录。`)
  if (!ok) return
  operatingId.value = item.id
  try {
    await adminRequest(`/api/admin/blocklist/${item.id}`, { method: 'DELETE' })
    showToast('已移除', 'success')
    await reload()
  } catch (e) {
    showToast(toErrorMessage(e), 'error')
  } finally {
    operatingId.value = ''
  }
}

/** 批量移除：POST /blocklist/batch-remove，上限 20（docs/020） */
async function batchRemove() {
  const ids = [...selectedIds.value]
  if (ids.length === 0 || mutating.value) return
  const limitCheck = checkAdminBatchLimit(ids, { unit: '条' })
  if (!limitCheck.ok) {
    showToast(limitCheck.message, 'error')
    return
  }
  const ok = await askConfirm(
    `确认批量移除 ${ids.length} 条黑名单？移除后对应账号/域名可再次登录（不删除用户数据）。`,
  )
  if (!ok) return
  mutating.value = true
  try {
    const res = await adminRequest<{ success: number; failed: number }>(
      '/api/admin/blocklist/batch-remove',
      {
        method: 'POST',
        body: JSON.stringify({ ids }),
      },
    )
    const toast = buildBatchToast(res, {
      mixed: '完成：成功 {success}，失败 {failed}',
      success: '已移除 {count} 条',
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

onMounted(reload)
</script>

<style scoped>
.hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--tg-hint);
  line-height: 1.5;
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
.mono {
  font-size: 12px;
  word-break: break-all;
}
.notice {
  padding: 10px;
  color: var(--admin-danger);
  font-size: 13px;
}
.field-label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--tg-hint);
  margin-bottom: 10px;
}
.field-label input,
.field-label select {
  padding: 8px 10px;
  border-radius: var(--r-md, 8px);
  border: 1px solid var(--border);
  background: var(--tg-secondary-bg);
  color: var(--tg-text);
  font-size: 13px;
}
.filters select {
  height: 34px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--tg-secondary-bg);
  color: var(--tg-text);
  padding: 0 8px;
}
</style>
