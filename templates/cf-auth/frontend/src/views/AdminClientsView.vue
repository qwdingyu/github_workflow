<template>
  <div class="admin-page">
    <div class="toolbar">
      <div class="filters">
        <input v-model="q" type="search" placeholder="搜索名称或 client_id" @keyup.enter="onSearch" />
        <label class="filter-check">
          <input v-model="disabledOnly" type="checkbox" @change="onSearch" />
          <span>仅已禁用</span>
        </label>
        <button type="button" class="btn btn-ghost btn-sm" @click="onSearch">搜索</button>
      </div>
      <button type="button" class="btn btn-primary btn-sm" @click="openCreate">新建应用</button>
    </div>

    <div v-if="loadError" class="notice notice-danger">{{ loadError }}</div>
    <div v-if="createOnce" class="notice notice-warn create-once">
      <strong>请立即保存接入凭证（应用密钥仅此一次展示）：</strong>
      <div v-if="createOnce.clientSecret" class="secret-row">
        <span>client_secret</span>
        <code class="secret">{{ createOnce.clientSecret }}</code>
        <button type="button" class="btn btn-ghost btn-xs" @click="copyText(createOnce.clientSecret!, '已复制 client_secret')">
          复制密钥
        </button>
      </div>
      <pre v-if="createOnce.envSnippet" class="env-snippet">{{ createOnce.envSnippet }}</pre>
      <div class="create-once-actions">
        <button
          v-if="createOnce.envSnippet"
          type="button"
          class="btn btn-primary btn-xs"
          @click="copyText(createOnce.envSnippet!, '已复制环境变量片段')"
        >
          复制环境变量片段
        </button>
        <button type="button" class="btn btn-primary btn-xs" @click="createOnce = null">
          我已保存，关闭
        </button>
      </div>
    </div>

    <div v-if="selectedCount > 0" class="bulk-bar" role="status">
      <span>已选 {{ selectedCount }} 个应用（仅当前页）</span>
      <div class="bulk-actions">
        <button type="button" class="btn btn-ghost btn-sm" :disabled="batchOperating" @click="clearSelection">
          清除选择
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          :disabled="batchOperating || selectedCount === 0"
          @click="batchSetDisabled(false)"
        >
          批量启用
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          :disabled="batchOperating || selectedCount === 0"
          @click="batchSetDisabled(true)"
        >
          批量禁用
        </button>
        <button
          type="button"
          class="btn btn-danger btn-sm"
          :disabled="batchOperating || selectedCount === 0"
          @click="batchDelete"
        >
          {{ batchOperating ? '处理中…' : `硬删除 (${selectedCount})` }}
        </button>
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
                :disabled="loading || batchOperating || selectableCount === 0"
                aria-label="全选本页"
                @change="toggleAllVisible(($event.target as HTMLInputElement).checked)"
              />
            </th>
            <th>名称</th>
            <th>client_id</th>
            <th>状态</th>
            <th title="跳过用户授权确认页（仅第一方）">跳过同意</th>
            <th title="强制使用 PKCE（授权码校验）">强制 PKCE</th>
            <th>回调地址</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="8">加载中…</td>
          </tr>
          <tr v-else-if="clients.length === 0">
            <td colspan="8">暂无 OAuth 应用</td>
          </tr>
          <tr
            v-for="c in clients"
            :key="c.clientId"
            :class="{ 'is-selected': isSelected(c.clientId) }"
          >
            <td class="select-cell">
              <input
                type="checkbox"
                :checked="isSelected(c.clientId)"
                :disabled="loading || batchOperating"
                :aria-label="`选择 ${c.clientId}`"
                @click="setSelected(c.clientId, ($event.target as HTMLInputElement).checked, ($event as MouseEvent).shiftKey)"
              />
            </td>
            <td>{{ c.name || '—' }}</td>
            <td><code class="mono">{{ c.clientId }}</code></td>
            <td>
              <span :class="c.disabled ? 'badge badge-danger' : 'badge badge-ok'">
                {{ c.disabled ? '已禁用' : '启用' }}
              </span>
            </td>
            <td>{{ c.skipConsent ? '是' : '否' }}</td>
            <td>{{ c.requirePKCE !== false ? '是' : '否' }}</td>
            <td class="uris">{{ (c.redirectUris || []).join(', ') }}</td>
            <td class="actions">
              <button type="button" class="btn btn-ghost btn-xs" @click="openEdit(c)">编辑</button>
              <button type="button" class="btn btn-ghost btn-xs" @click="toggleDisabled(c)">
                {{ c.disabled ? '启用' : '禁用' }}
              </button>
              <button type="button" class="btn btn-ghost btn-xs" @click="rotateSecret(c)">轮换 secret</button>
              <button
                type="button"
                class="btn btn-ghost btn-xs danger-text"
                :disabled="batchOperating"
                @click="deleteOne(c)"
              >
                硬删除
              </button>
            </td>
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

    <AdminModal v-model="modalOpen" :title="editing ? '编辑应用' : '新建 OAuth 应用'" max-width="560px" hide-actions>
      <label class="field-label">
        <span>名称</span>
        <input v-model="form.name" type="text" placeholder="cf-lottery-web" />
      </label>
      <label class="field-label">
        <span>回调地址 redirect_uris（每行一个）</span>
        <textarea v-model="form.redirectText" rows="4" placeholder="https://lucky.eforge.xyz/auth/callback" />
        <span class="field-hint">仅 https，或本地 http://localhost / 127.0.0.1。须与业务回调 URL 完全一致。</span>
      </label>
      <div class="field-check-block">
        <label class="field-check">
          <input v-model="form.skipConsent" type="checkbox" />
          <span>跳过用户授权确认页（仅第一方应用）</span>
        </label>
        <span class="field-hint">
          用户已登录后不再展示「是否允许此应用」确认页，直接返回授权码；不跳过登录。
          勾选时，全部回调域名须在第一方白名单内，否则保存失败。
        </span>
        <span v-if="firstPartyHosts.length" class="field-hint hosts-readonly">
          当前第一方主机（只读）：
          <code>{{ firstPartyHosts.join(', ') }}</code>
        </span>
      </div>
      <div class="field-check-block">
        <label class="field-check">
          <input v-model="form.requirePkce" type="checkbox" />
          <span>强制 PKCE（强烈建议开启）</span>
        </label>
        <span class="field-hint">
          开启后，授权请求须带 code_challenge，换令牌须带匹配的 code_verifier（S256）。生产接入请保持开启。
        </span>
      </div>

      <hr class="field-separator" />
      <div class="field-block-title">邮件发送</div>
      <div class="field-check-block">
        <label class="field-check">
          <input v-model="form.emailEnabled" type="checkbox" />
          <span>允许该应用发送邮件</span>
        </label>
        <span class="field-hint">
          开启后，该应用可通过 POST /api/email/send（OAuth client 认证）发送邮件。
          邮件由 cf-auth 集中发送（email_config 多通道链 + email-log 日志）。
        </span>
      </div>
      <label class="field-label" v-if="form.emailEnabled">
        <span>发件人邮箱（sender_email）</span>
        <input v-model="form.senderEmail" type="email" placeholder="noreply@eforge.xyz" />
        <span class="field-hint">可选。留空则使用 cf-auth 通道默认发件人。</span>
      </label>
      <label class="field-label" v-if="form.emailEnabled">
        <span>发件人名称（sender_name）</span>
        <input v-model="form.senderName" type="text" placeholder="Shop" />
        <span class="field-hint">可选。显示在收件人收件箱中的发件人名称。</span>
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
      :require-phrase="confirmRequirePhrase"
      danger
      @confirm="onConfirm"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AdminModal from '@/components/AdminModal'
import AdminPagination from '@/components/AdminPagination'
import ConfirmDialog from '@/components/ConfirmDialog'
import { copyWithToast } from '@usethink/cf-admin-fe/composables'
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

type ClientRow = {
  clientId: string
  name: string | null
  disabled: boolean
  skipConsent: boolean
  requirePKCE: boolean
  redirectUris: string[]
  /** docs/093 邮件网关 */
  emailEnabled?: boolean
  senderEmail?: string | null
  senderName?: string | null
}

const route = useRoute()
const { showToast } = useToast()
const {
  page, limit, total, totalPages, setPage, setLimit, setTotal, nextPage, prevPage, offset,
} = useTablePagination({ initialLimit: 20 })
const {
  confirmVisible, confirmMessage, confirmRequirePhrase, askConfirm, onConfirm,
} = useConfirmDialog()

const q = ref('')
/** 与 Dashboard ?disabled=1 及列表筛选对齐 */
const disabledOnly = ref(false)
const saving = ref(false)
const batchOperating = ref(false)
const clients = ref<ClientRow[]>([])
const { loading, loadError, runLoad } = useAdminListLoader()
/** 创建成功：一次性 secret + 服务端生成的 env 片段 */
const createOnce = ref<{
  clientSecret?: string | null
  envSnippet?: string | null
  clientId?: string
} | null>(null)
/** 只读：与服务端 assertSkipConsentAllowed 同源 */
const firstPartyHosts = ref<string[]>([])
const modalOpen = ref(false)
const editing = ref<ClientRow | null>(null)
const form = reactive({
  name: '',
  redirectText: '',
  skipConsent: false,
  requirePkce: true,
  /** docs/093 邮件网关 */
  emailEnabled: false,
  senderEmail: '',
  senderName: '',
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
} = useTableSelection(clients, (row) => row.clientId)

function onSearch() {
  setPage(1)
  void reload()
}

async function reload() {
  await runLoad(async (ctx) => {
    const data = await adminRequest<{ clients: ClientRow[]; total: number }>('/api/admin/clients', {
      params: {
        limit: limit.value,
        offset: offset.value,
        q: q.value.trim() || undefined,
        disabled: disabledOnly.value ? '1' : undefined,
      },
    })
    if (ctx.isStale()) return
    clients.value = data.clients
    setTotal(data.total)
  })
}

function openCreate() {
  editing.value = null
  form.name = ''
  form.redirectText = ''
  form.skipConsent = false
  form.requirePkce = true
  form.emailEnabled = false
  form.senderEmail = ''
  form.senderName = ''
  modalOpen.value = true
}

function openEdit(c: ClientRow) {
  editing.value = c
  form.name = c.name || ''
  form.redirectText = (c.redirectUris || []).join('\n')
  form.skipConsent = c.skipConsent
  form.requirePkce = c.requirePKCE !== false
  form.emailEnabled = c.emailEnabled ?? false
  form.senderEmail = c.senderEmail || ''
  form.senderName = c.senderName || ''
  modalOpen.value = true
}

function parseUris(): string[] {
  return form.redirectText
    .split(/\n|,/)
    .map((s) => s.trim())
    .filter(Boolean)
}

async function save() {
  const redirect_uris = parseUris()
  if (redirect_uris.length === 0) {
    showToast('至少填写一个 redirect_uri', 'error')
    return
  }
  saving.value = true
  try {
    if (editing.value) {
      await adminRequest(`/api/admin/clients/${editing.value.clientId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: form.name,
          redirect_uris,
          skip_consent: form.skipConsent,
          require_pkce: form.requirePkce,
          email_enabled: form.emailEnabled,
          sender_email: form.senderEmail || null,
          sender_name: form.senderName || null,
        }),
      })
      showToast('已更新', 'success')
    } else {
      const data = await adminRequest<{
        clientSecret?: string | null
        envSnippet?: string | null
        client?: { clientId?: string }
      }>('/api/admin/clients', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          redirect_uris,
          skip_consent: form.skipConsent,
          require_pkce: form.requirePkce,
          email_enabled: form.emailEnabled,
          sender_email: form.senderEmail || null,
          sender_name: form.senderName || null,
        }),
      })
      if (data.clientSecret || data.envSnippet) {
        createOnce.value = {
          clientSecret: data.clientSecret,
          envSnippet: data.envSnippet,
          clientId: data.client?.clientId,
        }
      }
      showToast('已创建', 'success')
    }
    modalOpen.value = false
    await reload()
  } catch (e) {
    showToast(toErrorMessage(e), 'error')
  } finally {
    saving.value = false
  }
}

async function toggleDisabled(c: ClientRow) {
  const next = !c.disabled
  const ok = await askConfirm(next ? `确认禁用 ${c.clientId}？新授权将立即失败。` : `确认启用 ${c.clientId}？`)
  if (!ok) return
  try {
    await adminRequest(`/api/admin/clients/${c.clientId}`, {
      method: 'PATCH',
      body: JSON.stringify({ disabled: next }),
    })
    showToast(next ? '已禁用' : '已启用', 'success')
    await reload()
  } catch (e) {
    showToast(toErrorMessage(e), 'error')
  }
}

/** 批量启停：走服务端 batch-disabled（上限 20，与 docs/020 一致） */
async function batchSetDisabled(disabled: boolean) {
  const ids = [...selectedIds.value]
  if (ids.length === 0 || batchOperating.value) return
  const limitCheck = checkAdminBatchLimit(ids, { unit: '个' })
  if (!limitCheck.ok) {
    showToast(limitCheck.message, 'error')
    return
  }
  const ok = await askConfirm(
    disabled
      ? `确认批量禁用 ${ids.length} 个应用？新授权将失败（不批量轮换 secret、不删除 client）。`
      : `确认批量启用 ${ids.length} 个应用？`,
  )
  if (!ok) return
  batchOperating.value = true
  try {
    const res = await adminRequest<{ success: number; failed: number }>(
      '/api/admin/clients/batch-disabled',
      {
        method: 'POST',
        body: JSON.stringify({ clientIds: ids, disabled }),
      },
    )
    const toast = buildBatchToast(res, {
      mixed: '完成：成功 {success}，失败 {failed}',
      success: disabled ? `已禁用 ${res.success} 个` : `已启用 ${res.success} 个`,
    })
    showToast(toast.message, toast.type)
    clearSelection()
    await reload()
  } catch (e) {
    showToast(toErrorMessage(e), 'error')
  } finally {
    batchOperating.value = false
  }
}

async function rotateSecret(c: ClientRow) {
  const ok = await askConfirm(`确认轮换 ${c.clientId} 的 client_secret？旧密钥将立即失效，业务应用需同步更新配置。`)
  if (!ok) return
  try {
    const data = await adminRequest<{ clientSecret: string }>(
      `/api/admin/clients/${c.clientId}/rotate-secret`,
      { method: 'POST', body: '{}' },
    )
    createOnce.value = {
      clientSecret: data.clientSecret,
      envSnippet: null,
      clientId: c.clientId,
    }
    showToast('已轮换密钥，请立即保存下方新 secret', 'success')
  } catch (e) {
    showToast(toErrorMessage(e), 'error')
  }
}

/** 单 client 硬删除：须键入 DELETE；服务端再校验 confirm */
async function deleteOne(c: ClientRow) {
  if (batchOperating.value) return
  const ok = await askConfirm(
    `【不可逆】硬删除 OAuth 应用 ${c.name || c.clientId}（${c.clientId}）？\n` +
      `将删除该应用及其令牌、用户授权记录。生产业务请优先「禁用」，不要直接删除。`,
    { requirePhrase: HARD_DELETE_PHRASE },
  )
  if (!ok) return
  batchOperating.value = true
  try {
    await adminRequest(`/api/admin/clients/${encodeURIComponent(c.clientId)}/delete`, {
      method: 'POST',
      body: JSON.stringify({ confirm: HARD_DELETE_PHRASE }),
    })
    showToast('已硬删除应用', 'success')
    clearSelection()
    await reload()
  } catch (e) {
    showToast(toErrorMessage(e), 'error')
  } finally {
    batchOperating.value = false
  }
}

/** 批量硬删除：上限 HARD_DELETE_MAX；须键入 DELETE */
async function batchDelete() {
  const ids = [...selectedIds.value]
  if (ids.length === 0 || batchOperating.value) return
  const limitCheck = checkAdminBatchLimit(ids, {
    limit: HARD_DELETE_MAX,
    message: `硬删除单次最多 ${HARD_DELETE_MAX} 个，请缩小选择`,
  })
  if (!limitCheck.ok) {
    showToast(limitCheck.message, 'error')
    return
  }
  const ok = await askConfirm(
    `【不可逆】硬删除 ${ids.length} 个 OAuth 应用？\n` +
      `仅当前页已选；将删除各应用及其令牌、授权记录。上限 ${HARD_DELETE_MAX}。\n` +
      `测试垃圾可删；生产业务请优先用「禁用」。`,
    { requirePhrase: HARD_DELETE_PHRASE },
  )
  if (!ok) return
  batchOperating.value = true
  try {
    const res = await adminRequest<{ success: number; failed: number }>(
      '/api/admin/clients/batch-delete',
      {
        method: 'POST',
        body: JSON.stringify({ clientIds: ids, confirm: HARD_DELETE_PHRASE }),
      },
    )
    const toast = buildBatchToast(res, {
      mixed: '删除完成：成功 {success}，失败 {failed}',
      success: '已硬删除 {count} 个应用',
    })
    showToast(toast.message, toast.type)
    clearSelection()
    await reload()
  } catch (e) {
    showToast(toErrorMessage(e), 'error')
  } finally {
    batchOperating.value = false
  }
}

async function copyText(text: string, okMsg = '已复制') {
  await copyWithToast(text, {
    successMessage: okMsg,
    errorMessage: '复制失败，请手动选择',
  })
}

async function loadMeta() {
  try {
    const data = await adminRequest<{
      firstPartyRedirectHosts?: string[]
    }>('/api/admin/health')
    firstPartyHosts.value = data.firstPartyRedirectHosts ?? []
  } catch {
    firstPartyHosts.value = []
  }
}

function applyRouteFilters() {
  const d = route.query.disabled
  disabledOnly.value =
    d === '1' || d === 'true' || (Array.isArray(d) && d[0] === '1')
}

onMounted(() => {
  applyRouteFilters()
  void loadMeta()
  void reload()
})
watch(
  () => route.query.disabled,
  () => {
    applyRouteFilters()
    setPage(1)
    void reload()
  },
)
</script>

<style scoped>
.create-once {
  flex-direction: column;
  align-items: flex-start;
}
.secret-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.env-snippet {
  margin: 8px 0 0;
  padding: 10px 12px;
  width: 100%;
  max-height: 200px;
  overflow: auto;
  border-radius: var(--r-md, 8px);
  background: rgba(0, 0, 0, 0.25);
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--tg-text);
}
.create-once-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.filter-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--tg-hint);
  cursor: pointer;
  user-select: none;
}
.hosts-readonly code {
  font-size: 11px;
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
.mono { font-size: 11px; word-break: break-all; }
.uris { max-width: 220px; font-size: 11px; color: var(--tg-hint); word-break: break-all; }
.actions { display: flex; flex-wrap: wrap; gap: 4px; }
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
}
.badge-ok {
  background: var(--admin-success-soft);
  color: var(--admin-success);
  border: 1px solid var(--admin-success-border);
}
.badge-danger {
  background: var(--admin-danger-soft);
  color: var(--admin-danger);
  border: 1px solid var(--admin-danger-border);
}
.notice {
  padding: 10px 12px;
  border-radius: var(--r-md, 8px);
  font-size: 13px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.notice-danger {
  background: var(--admin-danger-soft);
  border: 1px solid var(--admin-danger-border);
  color: var(--admin-danger);
}
.notice-warn {
  background: var(--admin-warning-soft);
  border: 1px solid var(--admin-warning-border);
  color: var(--admin-warning);
}
.secret {
  word-break: break-all;
  font-size: 12px;
  color: var(--tg-text);
}
.select-cell {
  width: 36px;
}
.is-selected {
  background: rgba(251, 191, 36, 0.06);
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
.danger-text {
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
.field-label textarea {
  padding: 8px 10px;
  border-radius: var(--r-md, 8px);
  border: 1px solid var(--border);
  background: var(--tg-secondary-bg);
  color: var(--tg-text);
  font-size: 13px;
  font-family: inherit;
}
.field-check-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.field-separator {
  margin: 16px 0;
  border: none;
  border-top: 1px solid var(--border, rgba(0, 0, 0, 0.1));
}
.field-block-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 10px;
  color: var(--tg-text);
}
.field-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--tg-text);
}
.field-check-block .field-hint {
  margin-left: 24px;
}
</style>
