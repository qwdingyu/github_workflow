<template>
  <div class="admin-page">
    <div class="toolbar">
      <div class="filters">
        <span class="muted">信任域（env 部署锚 ∪ DB 运营扩展）</span>
      </div>
      <div class="toolbar-actions">
        <button type="button" class="btn btn-primary btn-sm" @click="openCreate">新增信任域</button>
        <button type="button" class="btn btn-ghost btn-sm" :disabled="loading" @click="reload">刷新</button>
      </div>
    </div>

    <p class="hint">
      本页管理<strong>DB 运营扩展</strong>信任域，新增/启停<strong>即时生效</strong>，无需重新部署。
      env 部署锚（<code>TRUSTED_ORIGINS</code> / <code>ADMIN_TRUSTED_ORIGINS</code>）在下方只读展示，不可在此修改。
      「业务信任」控制业务前端跨域调用本站 API；「管理信任」控制 Admin 写请求来源（CSRF 校验，默认仅同源）。
    </p>

    <div v-if="selectedCount > 0" class="bulk-bar" role="status">
      <span>已选 {{ selectedCount }} 个信任域</span>
      <div class="bulk-actions">
        <button type="button" class="btn btn-ghost btn-sm" :disabled="mutating" @click="clearSelection">
          清除选择
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          :disabled="mutating || selectedCount === 0"
          @click="batchSetEnabled(true)"
        >
          批量启用
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          :disabled="mutating || selectedCount === 0"
          @click="batchSetEnabled(false)"
        >
          批量停用
        </button>
        <button
          type="button"
          class="btn btn-danger btn-sm"
          :disabled="mutating || selectedCount === 0"
          @click="batchDelete"
        >
          {{ mutating ? '删除中…' : `批量删除 (${selectedCount})` }}
        </button>
      </div>
    </div>

    <div v-if="loadError" class="notice notice-danger">{{ loadError }}</div>

    <div v-if="envCors.length || envAdmin.length" class="env-anchors">
      <div class="env-anchor-block">
        <span class="env-anchor-label">TRUSTED_ORIGINS（业务·部署锚）</span>
        <div v-if="envCors.length" class="env-anchor-list">
          <code v-for="o in envCors" :key="o">{{ o }}</code>
        </div>
        <span v-else class="muted">未配置</span>
      </div>
      <div class="env-anchor-block">
        <span class="env-anchor-label">ADMIN_TRUSTED_ORIGINS（管理·部署锚）</span>
        <div v-if="envAdmin.length" class="env-anchor-list">
          <code v-for="o in envAdmin" :key="o">{{ o }}</code>
        </div>
        <span v-else class="muted">未配置（默认仅同源）</span>
      </div>
    </div>

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
            <th>origin</th>
            <th>用途</th>
            <th>状态</th>
            <th>创建人</th>
            <th>创建时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="7">加载中…</td>
          </tr>
          <tr v-else-if="items.length === 0">
            <td colspan="7">暂无 DB 信任域（env 部署锚见上方）</td>
          </tr>
          <tr v-for="item in items" :key="item.id" :class="{ 'is-selected': isSelected(item.id) }">
            <td class="select-cell">
              <input
                type="checkbox"
                :checked="isSelected(item.id)"
                :disabled="loading || mutating"
                :aria-label="`选择信任域 ${item.origin}`"
                @click="setSelected(item.id, ($event.target as HTMLInputElement).checked, ($event as MouseEvent).shiftKey)"
              />
            </td>
            <td><code class="mono">{{ item.origin }}</code></td>
            <td>
              <span :class="item.purpose === 'admin' ? 'badge badge-admin' : 'badge badge-cors'">
                {{ item.purpose === 'admin' ? '管理信任' : '业务信任' }}
              </span>
            </td>
            <td>
              <span :class="item.enabled ? 'badge badge-ok' : 'badge badge-muted'">
                {{ item.enabled ? '生效' : '停用' }}
              </span>
            </td>
            <td class="muted small">{{ item.createdByEmail || '—' }}</td>
            <td class="muted small">{{ formatDate(item.createdAt) }}</td>
            <td class="actions">
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                :disabled="mutating"
                @click="toggleEnabled(item)"
              >
                {{ item.enabled ? '停用' : '启用' }}
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-xs danger-text"
                :disabled="mutating"
                @click="removeOne(item)"
              >
                删除
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <AdminModal v-model="modalOpen" title="新增信任域" max-width="520px" hide-actions>
      <label class="field-label">
        <span>origin（如 https://shop.eforge.xyz）</span>
        <input v-model="form.origin" type="text" placeholder="https://shop.eforge.xyz" />
        <span class="field-hint">
          仅 https:// 或 http://localhost / 127.0.0.1 / ::1；不含路径、query、用户名密码。保存时自动规范化。
        </span>
      </label>
      <label class="field-label">
        <span>用途</span>
        <select v-model="form.purpose" class="purpose-select">
          <option value="cors">业务信任（RP 前端跨域调本站 API）</option>
          <option value="admin">管理信任（Admin 写请求来源，CSRF 校验）</option>
        </select>
      </label>
      <template #actions>
        <button type="button" class="btn btn-ghost" @click="modalOpen = false">取消</button>
        <button type="button" class="btn btn-primary" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </template>
    </AdminModal>

    <ConfirmDialog
      v-model="confirmVisible"
      :message="confirmMessage"
      danger
      @confirm="onConfirm"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import AdminModal from '@/components/AdminModal'
import ConfirmDialog from '@/components/ConfirmDialog'
import { adminRequest } from '@/composables/useAdminRequest'
import { useAdminListLoader } from '@/composables/useAdminListLoader'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useTableSelection } from '@/composables/useTableSelection'
import { useToast } from '@/composables/useToast'
import { buildBatchToast, checkAdminBatchLimit, formatDate, toErrorMessage } from '@usethink/cf-admin-fe/utils'

type TrustedOriginItem = {
  id: string
  origin: string
  purpose: 'cors' | 'admin'
  enabled: boolean
  createdByEmail: string | null
  createdAt: string
  updatedAt: string
}

const { showToast } = useToast()
const mutating = ref(false)
const saving = ref(false)
const items = ref<TrustedOriginItem[]>([])
const envCors = ref<string[]>([])
const envAdmin = ref<string[]>([])
const { loading, loadError, runLoad } = useAdminListLoader()

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

const {
  confirmVisible,
  confirmMessage,
  askConfirm,
  onConfirm,
} = useConfirmDialog()

const modalOpen = ref(false)
const form = reactive({
  origin: '',
  purpose: 'cors' as 'cors' | 'admin',
})

function openCreate() {
  form.origin = ''
  form.purpose = 'cors'
  modalOpen.value = true
}

async function reload() {
  await runLoad(async (ctx) => {
    const data = await adminRequest<{
      items: TrustedOriginItem[]
      total: number
      envCors: string[]
      envAdmin: string[]
      note?: string
    }>('/api/admin/trusted-origins', {
      params: { limit: '200' },
    })
    if (ctx.isStale()) return
    items.value = data.items
    envCors.value = data.envCors ?? []
    envAdmin.value = data.envAdmin ?? []
  })
}

async function save() {
  if (!form.origin.trim()) {
    showToast('请填写 origin', 'error')
    return
  }
  saving.value = true
  try {
    await adminRequest('/api/admin/trusted-origins', {
      method: 'POST',
      body: JSON.stringify({ origin: form.origin, purpose: form.purpose }),
    })
    showToast('已新增（即时生效）', 'success')
    modalOpen.value = false
    await reload()
  } catch (e) {
    showToast(toErrorMessage(e), 'error')
  } finally {
    saving.value = false
  }
}

async function toggleEnabled(item: TrustedOriginItem) {
  const next = !item.enabled
  const ok = await askConfirm(
    next
      ? `确认启用 ${item.origin}？该来源将立即重新获得${item.purpose === 'admin' ? '管理写权限' : '跨域访问权限'}。`
      : `确认停用 ${item.origin}？该来源将立即失去${item.purpose === 'admin' ? '管理写权限' : '跨域访问权限'}（不删行，可随时恢复）。`,
  )
  if (!ok) return
  mutating.value = true
  try {
    await adminRequest(`/api/admin/trusted-origins/${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: next }),
    })
    showToast(next ? '已启用' : '已停用', 'success')
    await reload()
  } catch (e) {
    showToast(toErrorMessage(e), 'error')
  } finally {
    mutating.value = false
  }
}

/** 硬删行：删除后该 origin 立即失去信任；env 部署锚不受影响 */
async function removeOne(item: TrustedOriginItem) {
  const ok = await askConfirm(
    `【不可逆】删除信任域 ${item.origin}（${item.purpose === 'admin' ? '管理' : '业务'}）？\n` +
      `删除后该来源立即失去${item.purpose === 'admin' ? '管理写权限' : '跨域访问权限'}。` +
      `env 部署锚不受影响；如需保留记录请用「停用」。`,
  )
  if (!ok) return
  mutating.value = true
  try {
    await adminRequest(`/api/admin/trusted-origins/${item.id}`, {
      method: 'DELETE',
    })
    showToast('已删除', 'success')
    await reload()
  } catch (e) {
    showToast(toErrorMessage(e), 'error')
  } finally {
    mutating.value = false
  }
}

async function batchSetEnabled(enabled: boolean) {
  const ids = [...selectedIds.value]
  if (ids.length === 0 || mutating.value) return
  const limitCheck = checkAdminBatchLimit(ids, { unit: '个信任域' })
  if (!limitCheck.ok) {
    showToast(limitCheck.message, 'error')
    return
  }
  const ok = await askConfirm(`确认${enabled ? '启用' : '停用'} ${ids.length} 个信任域？`)
  if (!ok) return
  mutating.value = true
  try {
    let success = 0
    let failed = 0
    for (const id of ids) {
      try {
        await adminRequest(`/api/admin/trusted-origins/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) })
        success++
      } catch {
        failed++
      }
    }
    const toast = buildBatchToast({ success, failed }, {
      mixed: `操作完成：成功 ${success}，失败 ${failed}`,
      success: `已${enabled ? '启用' : '停用'} ${success} 个信任域`,
    })
    showToast(toast.message, toast.type)
    clearSelection()
    await reload()
  } catch (e) {
    showToast(toErrorMessage(e, 'error'), 'error')
  } finally {
    mutating.value = false
  }
}

async function batchDelete() {
  const ids = [...selectedIds.value]
  if (ids.length === 0 || mutating.value) return
  const limitCheck = checkAdminBatchLimit(ids, { unit: '个信任域' })
  if (!limitCheck.ok) {
    showToast(limitCheck.message, 'error')
    return
  }
  const ok = await askConfirm(`确认批量删除 ${ids.length} 个信任域？删除后对应来源立即失去信任。`)
  if (!ok) return
  mutating.value = true
  try {
    const data = await adminRequest<{ success: number; failed: number; errors: Array<{ id: string; message: string }> }>('/api/admin/trusted-origins/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    })
    const toast = buildBatchToast(data, {
      mixed: `删除完成：成功 ${data.success}，失败 ${data.failed}`,
      success: `已删除 ${data.success} 个信任域`,
    })
    showToast(toast.message, toast.type)
    clearSelection()
    await reload()
  } catch (e) {
    showToast(toErrorMessage(e, '删除信任域失败'), 'error')
  } finally {
    mutating.value = false
  }
}

onMounted(reload)
</script>

<style scoped>
.toolbar-actions {
  display: flex;
  gap: 6px;
  margin-left: auto;
}
.hint {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--tg-hint, #9aa4b2);
  line-height: 1.6;
}
.hint code {
  font-size: 11px;
}
.env-anchors {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
  padding: 10px 12px;
  border-radius: var(--r-md, 8px);
  border: 1px dashed var(--border, rgba(255, 255, 255, 0.15));
  background: rgba(148, 163, 184, 0.06);
}
.env-anchor-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.env-anchor-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--tg-hint, #9aa4b2);
}
.env-anchor-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.env-anchor-list code {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.25);
  word-break: break-all;
}
.table-wrap {
  overflow: auto;
  border-radius: var(--r-lg, 12px);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  background: var(--tg-secondary-bg, #151b28);
}
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.data-table th,
.data-table td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.08));
  vertical-align: top;
}
.data-table th {
  color: var(--tg-hint, #9aa4b2);
  font-weight: 600;
  font-size: 12px;
}
.mono {
  font-size: 11px;
  word-break: break-all;
}
.small {
  font-size: 11px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.select-cell {
  width: 36px;
  text-align: center;
}
.is-selected {
  background: rgba(251, 191, 36, 0.06);
}
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}
.badge-ok {
  background: rgba(34, 197, 94, 0.18);
  color: #4ade80;
}
.badge-muted {
  background: rgba(148, 163, 184, 0.15);
  color: #94a3b8;
}
.badge-cors {
  background: rgba(59, 130, 246, 0.18);
  color: #60a5fa;
}
.badge-admin {
  background: rgba(168, 85, 247, 0.18);
  color: #c084fc;
}
.danger-text {
  color: var(--admin-danger, #fca5a5);
}
.notice {
  padding: 10px 12px;
  border-radius: var(--r-md, 8px);
  font-size: 13px;
}
.notice-danger {
  background: var(--admin-danger-soft, rgba(248, 113, 113, 0.12));
  color: var(--admin-danger, #fca5a5);
}
.field-label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--tg-hint);
}
.field-label input,
.field-label select {
  padding: 8px 10px;
  border-radius: var(--r-md, 8px);
  border: 1px solid var(--border);
  background: var(--tg-secondary-bg);
  color: var(--tg-text);
  font-size: 13px;
  font-family: inherit;
}
.field-hint {
  font-size: 11px;
  color: var(--tg-hint);
  line-height: 1.5;
}
.purpose-select {
  cursor: pointer;
}
</style>
