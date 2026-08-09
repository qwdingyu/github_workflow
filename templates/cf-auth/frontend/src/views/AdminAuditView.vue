<template>
  <div class="admin-page">
    <div class="toolbar">
      <div class="filters filters-wrap">
        <input
          v-model="action"
          type="search"
          placeholder="操作，如 client.create"
          @keyup.enter="onFilter"
        />
        <input
          v-model="targetType"
          type="search"
          placeholder="对象类型，如 user"
          @keyup.enter="onFilter"
        />
        <input
          v-model="targetId"
          type="search"
          placeholder="对象 ID"
          @keyup.enter="onFilter"
        />
        <button type="button" class="btn btn-ghost btn-sm" :disabled="loading" @click="onFilter">
          筛选
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          :disabled="loading || logs.length === 0"
          @click="exportPageCsv"
        >
          导出本页 CSV
        </button>
      </div>
    </div>

    <p class="hint">
      审计日志只读追加，本后台不提供删除。多选仅用于导出选中行。
    </p>

    <div v-if="selectedCount > 0" class="bulk-bar" role="status">
      <span>已选 {{ selectedCount }} 条（仅当前页）</span>
      <div class="bulk-actions">
        <button type="button" class="btn btn-ghost btn-sm" @click="clearSelection">
          清除选择
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="selectedCount === 0"
          @click="exportSelectedCsv"
        >
          导出选中 CSV ({{ selectedCount }})
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
                :disabled="loading || selectableCount === 0"
                aria-label="全选本页"
                @change="toggleAllVisible(($event.target as HTMLInputElement).checked)"
              />
            </th>
            <th>时间</th>
            <th>操作者</th>
            <th>action</th>
            <th>目标</th>
            <th>IP</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="log in logs"
            :key="log.id"
            :class="{ 'is-selected': isSelected(log.id) }"
          >
            <td class="select-cell">
              <input
                type="checkbox"
                :checked="isSelected(log.id)"
                :disabled="loading"
                :aria-label="`选择审计 ${log.action}`"
                @click="setSelected(log.id, ($event.target as HTMLInputElement).checked, ($event as MouseEvent).shiftKey)"
              />
            </td>
            <td>{{ formatDate(log.createdAt) }}</td>
            <td>{{ log.actorEmail || log.actorUserId || (log.viaHint) || 'api_key' }}</td>
            <td><code>{{ log.action }}</code></td>
            <td class="target">{{ log.targetType }} {{ log.targetId }}</td>
            <td>{{ log.ip || '—' }}</td>
          </tr>
          <tr v-if="!loading && logs.length === 0">
            <td colspan="6">暂无审计</td>
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
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { downloadCsv } from '@usethink/cf-admin-fe/utils'
import AdminPagination from '@/components/AdminPagination'
import { adminRequest } from '@/composables/useAdminRequest'
import { useAdminListLoader } from '@/composables/useAdminListLoader'
import { formatDate } from '@/composables/useFormat'
import { useTablePagination } from '@/composables/useTablePagination'
import { useTableSelection } from '@/composables/useTableSelection'
import { useToast } from '@/composables/useToast'

type AuditRow = {
  id: string
  actorUserId: string | null
  actorEmail: string | null
  action: string
  targetType: string | null
  targetId: string | null
  ip: string | null
  createdAt: string | Date
  viaHint?: string
}

const { showToast } = useToast()
const action = ref('')
const targetType = ref('')
const targetId = ref('')
const logs = ref<AuditRow[]>([])
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
} = useTableSelection(logs, (row) => row.id)

function onFilter() {
  setPage(1)
  clearSelection()
  void reload()
}

async function reload() {
  await runLoad(async (ctx) => {
    const data = await adminRequest<{ logs: AuditRow[]; total: number }>('/api/admin/audit', {
      params: {
        limit: limit.value,
        offset: offset.value,
        action: action.value.trim() || undefined,
        targetType: targetType.value.trim() || undefined,
        targetId: targetId.value.trim() || undefined,
      },
    })
    if (ctx.isStale()) return
    logs.value = data.logs
    setTotal(data.total)
  })
}

function auditRowsToMatrix(rows: AuditRow[]): string[][] {
  const header = ['createdAt', 'actor', 'action', 'targetType', 'targetId', 'ip']
  const body = rows.map((log) => {
    const actor = log.actorEmail || log.actorUserId || log.viaHint || 'api_key'
    return [
      formatDate(log.createdAt),
      actor,
      log.action,
      log.targetType ?? '',
      log.targetId ?? '',
      log.ip ?? '',
    ]
  })
  return [header, ...body]
}

/** 导出当前页（与列表同一筛选） */
function exportPageCsv() {
  if (logs.value.length === 0) {
    showToast('当前页无数据', 'error')
    return
  }
  downloadCsv(`admin-audit-page${page.value}-${Date.now()}.csv`, auditRowsToMatrix(logs.value))
  showToast(`已导出本页 ${logs.value.length} 条`, 'success')
}

/** 导出多选行（仅前端，无后端删除） */
function exportSelectedCsv() {
  const idSet = new Set(selectedIds.value)
  const rows = logs.value.filter((l) => idSet.has(l.id))
  if (rows.length === 0) {
    showToast('请先选择行', 'error')
    return
  }
  downloadCsv(`admin-audit-selected-${rows.length}-${Date.now()}.csv`, auditRowsToMatrix(rows))
  showToast(`已导出选中 ${rows.length} 条`, 'success')
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
.filters-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.filters-wrap input {
  min-width: 140px;
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
.target { font-size: 12px; word-break: break-all; color: var(--tg-hint); }
.notice {
  padding: 10px;
  color: var(--admin-danger);
  font-size: 13px;
}
</style>
