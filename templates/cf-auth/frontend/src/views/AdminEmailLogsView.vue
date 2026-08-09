<template>
  <div class="admin-page">
    <div class="toolbar">
      <div class="filters filters-wrap">
        <select v-model="status" aria-label="邮件状态" @change="onFilter">
          <option value="">全部状态</option>
          <option value="sent">已发送</option>
          <option value="failed">失败</option>
          <option value="pending">发送中</option>
        </select>
        <input
          v-model="search"
          type="search"
          maxlength="200"
          placeholder="client / 收件邮箱 / 主题 / provider / 错误"
          aria-label="搜索邮件日志"
          @keyup.enter="onFilter"
        />
        <button type="button" class="btn btn-ghost btn-sm" :disabled="loading" @click="onFilter">
          筛选
        </button>
        <button type="button" class="btn btn-ghost btn-sm" :disabled="loading" @click="reload">
          刷新
        </button>
      </div>
    </div>

    <p class="hint">
      数据来自 <code>email_log</code> 发送记录。超过 15 分钟仍未回写的 pending 会标记为“状态未知”。
    </p>

    <div v-if="selectedCount > 0" class="bulk-bar" role="status">
      <span>已选 {{ selectedCount }} 条（仅当前页）</span>
      <div class="bulk-actions">
        <button type="button" class="btn btn-ghost btn-sm" :disabled="mutating" @click="clearSelection">
          清除选择
        </button>
        <button type="button" class="btn btn-ghost btn-sm" :disabled="mutating" @click="copySelected">
          复制选中
        </button>
        <button type="button" class="btn btn-primary btn-sm" :disabled="mutating" @click="exportSelectedCsv">
          导出选中 CSV
        </button>
        <button type="button" class="btn btn-danger btn-sm" :disabled="mutating" @click="batchDelete">
          {{ mutating ? '删除中…' : `删除选中 (${selectedCount})` }}
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
            <th>时间</th>
            <th>收件邮箱</th>
            <th>主题</th>
            <th>状态</th>
            <th>Provider</th>
            <th>错误</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id" :class="{ 'is-selected': isSelected(item.id) }">
            <td class="select-cell">
              <input
                type="checkbox"
                :checked="isSelected(item.id)"
                :disabled="loading || mutating"
                :aria-label="`选择邮件日志 ${item.toAddr}`"
                @click="setSelected(item.id, ($event.target as HTMLInputElement).checked, ($event as MouseEvent).shiftKey)"
              />
            </td>
            <td>{{ formatDate(item.createdAt) }}</td>
            <td><code>{{ item.toAddr }}</code></td>
            <td>{{ item.subject || '-' }}</td>
            <td>
              <span class="tag" :class="statusClass(item.displayStatus || item.status)">
                {{ statusLabel(item.displayStatus || item.status) }}
              </span>
            </td>
            <td>{{ item.provider || '-' }}</td>
            <td class="note-cell">{{ item.displayErrorMessage || item.error || '-' }}</td>
            <td class="actions">
              <button type="button" class="btn btn-ghost btn-xs danger-text" :disabled="mutating" @click="deleteOne(item)">
                删除
              </button>
            </td>
          </tr>
          <tr v-if="!loading && items.length === 0">
            <td colspan="8">暂无邮件日志</td>
          </tr>
        </tbody>
      </table>
    </div>

    <AdminPagination
      :page="page"
      :total="total"
      :total-pages="totalPages"
      :limit="limit"
      cursor-mode
      :has-more="hasMore"
      :disabled="loading || mutating"
      @prev="previousPage"
      @next="nextPage"
      @update:limit="changeLimit"
    />

    <ConfirmDialog v-model="confirmVisible" :message="confirmMessage" danger @confirm="onConfirm" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { copyWithToast } from '@usethink/cf-admin-fe/composables'
import { checkAdminBatchLimit, downloadCsv, toErrorMessage } from '@usethink/cf-admin-fe/utils'
import AdminPagination from '@/components/AdminPagination'
import ConfirmDialog from '@/components/ConfirmDialog'
import { adminRequest } from '@/composables/useAdminRequest'
import { useAdminListLoader } from '@/composables/useAdminListLoader'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { formatDate } from '@/composables/useFormat'
import { useTableSelection } from '@/composables/useTableSelection'
import { useToast } from '@/composables/useToast'

type EmailLogRow = {
  id: string
  orderId: string | null
  clientId: string | null
  toAddr: string
  subject: string | null
  status: string
  provider: string | null
  error: string | null
  createdAt: string | Date
  displayStatus?: string
  displayErrorMessage?: string
}

const { showToast } = useToast()
const { confirmVisible, confirmMessage, askConfirm, onConfirm } = useConfirmDialog()
const items = ref<EmailLogRow[]>([])
const status = ref('')
const search = ref('')
const page = ref(1)
const limit = ref(20)
const total = ref(0)
const snapshotAt = ref('')
const nextCursor = ref('')
const hasMore = ref(false)
const pageCursors = ref<string[]>([''])
const mutating = ref(false)
const { loading, loadError, runLoad } = useAdminListLoader()
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit.value)))

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

function resetPagination() {
  page.value = 1
  snapshotAt.value = ''
  nextCursor.value = ''
  hasMore.value = false
  pageCursors.value = ['']
}

async function loadData() {
  const ok = await runLoad(async (ctx) => {
    const data = await adminRequest<{
      results: EmailLogRow[]
      total: number
      snapshotAt: string
      nextCursor: string
      hasMore: boolean
    }>('/api/admin/email-logs', {
      params: {
        status: status.value || undefined,
        search: search.value.trim() || undefined,
        limit: limit.value,
        snapshotAt: snapshotAt.value || undefined,
        cursor: pageCursors.value[page.value - 1] || undefined,
      },
    })
    if (ctx.isStale()) return
    items.value = data.results || []
    total.value = data.total || 0
    snapshotAt.value = data.snapshotAt || ''
    nextCursor.value = data.nextCursor || ''
    hasMore.value = Boolean(data.hasMore)
    clearSelection()
  })
  if (!ok && loadError.value) {
    items.value = []
    clearSelection()
    showToast(loadError.value, 'error')
  }
}

function reload() {
  void loadData()
}

function onFilter() {
  search.value = search.value.trim().slice(0, 200)
  status.value = status.value.trim().slice(0, 50)
  resetPagination()
  void loadData()
}

function previousPage() {
  if (loading.value || page.value <= 1) return
  page.value -= 1
  void loadData()
}

function nextPage() {
  if (loading.value || !hasMore.value || !nextCursor.value) return
  pageCursors.value[page.value] = nextCursor.value
  page.value += 1
  void loadData()
}

function changeLimit(value: number) {
  limit.value = value
  resetPagination()
  void loadData()
}

function statusLabel(value?: string) {
  return ({
    sent: '已发送',
    failed: '失败',
    pending: '发送中',
    stale_pending: '状态未知',
  } as Record<string, string>)[value || ''] || value || '-'
}

function statusClass(value?: string) {
  if (value === 'sent') return 'tag-success'
  if (value === 'failed' || value === 'stale_pending') return 'tag-danger'
  if (value === 'pending') return 'tag-warning'
  return 'tag-muted'
}

function selectedRows() {
  const idSet = new Set(selectedIds.value)
  return items.value.filter((item) => idSet.has(item.id))
}

function rowsToMatrix(rows: EmailLogRow[]): string[][] {
  return [
    ['id', 'createdAt', 'toAddr', 'subject', 'status', 'provider', 'error'],
    ...rows.map((item) => [
      item.id,
      formatDate(item.createdAt),
      item.toAddr,
      item.subject ?? '',
      item.displayStatus || item.status,
      item.provider ?? '',
      item.displayErrorMessage || item.error || '',
    ]),
  ]
}

async function copySelected() {
  const rows = selectedRows()
  const text = rowsToMatrix(rows).map((row) => row.join('\t')).join('\n')
  await copyWithToast(text, {
    successMessage: `已复制 ${rows.length} 条邮件日志`,
    errorMessage: '复制失败',
  })
}

function exportSelectedCsv() {
  const rows = selectedRows()
  if (rows.length === 0) {
    showToast('请先选择邮件日志', 'error')
    return
  }
  downloadCsv(`email-logs-${new Date().toISOString().slice(0, 10)}.csv`, rowsToMatrix(rows))
  showToast(`已导出 ${rows.length} 条邮件日志`, 'success')
}

async function deleteOne(item: EmailLogRow) {
  if (mutating.value) return
  const ok = await askConfirm(`确认删除邮件日志 ${item.toAddr}？此操作不可恢复。`)
  if (!ok) return
  mutating.value = true
  try {
    await adminRequest<{ deleted: number }>('/api/admin/email-logs/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ ids: [item.id] }),
    })
    showToast('已删除', 'success')
    void reload()
  } catch (err) {
    showToast(toErrorMessage(err, '删除邮件日志失败'), 'error')
  } finally {
    mutating.value = false
  }
}

async function batchDelete() {
  const ids = selectedIds.value
  const limitCheck = checkAdminBatchLimit(ids, { limit: 200, unit: '条' })
  if (!limitCheck.ok) {
    showToast(limitCheck.message, 'error')
    return
  }
  const ok = await askConfirm(`确认删除选中的 ${ids.length} 条邮件日志？此操作不可恢复。`)
  if (!ok) return
  mutating.value = true
  try {
    const data = await adminRequest<{ deleted: number }>('/api/admin/email-logs/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    })
    showToast(`已删除 ${data.deleted} 条邮件日志`, 'success')
    resetPagination()
    await loadData()
  } catch (err) {
    showToast(toErrorMessage(err, '删除邮件日志失败'), 'error')
  } finally {
    mutating.value = false
  }
}

onMounted(loadData)
</script>

<style scoped>
.hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--tg-hint);
  line-height: 1.5;
}
.filters-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.filters-wrap input {
  min-width: 220px;
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
.select-cell {
  width: 36px;
}
.is-selected {
  background: rgba(251, 191, 36, 0.06);
}
.note-cell {
  max-width: 360px;
  white-space: normal;
  word-break: break-word;
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
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.danger-text {
  color: var(--admin-danger, #fca5a5);
}
.notice {
  padding: 10px;
  color: var(--admin-danger);
  font-size: 13px;
}
</style>
