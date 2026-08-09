<template>
  <div class="admin-page">
    <div class="toolbar">
      <div class="filters">
        <span class="muted">社交登录渠道</span>
      </div>
      <div class="toolbar-actions">
        <button type="button" class="btn btn-ghost btn-sm" @click="goClients">
          OAuth 应用管理 →
        </button>
        <button type="button" class="btn btn-ghost btn-sm" :disabled="loading" @click="reload">
          刷新
        </button>
      </div>
    </div>

    <p class="hint">
      本页管理<strong>登录来源</strong>：社交渠道的<strong>启用/禁用</strong>、<strong>排序</strong>、<strong>展示名</strong>与<strong>重置为默认</strong>；
      接入本站的<strong>业务项目</strong>（OAuth Client：创建/编辑/启停/轮换密钥/删除）请前往「OAuth 应用管理」。
      Client ID/Secret 仍在服务器环境变量（Cloudflare secrets），不在此填写。
      某渠道要真正出现在登录页，需同时满足：密钥已配置、环境允许列表（ENABLED_SOCIAL_PROVIDERS）包含它、且本页为「启用」。
      无密钥时无法启用；禁用后登录按钮会隐藏，接口调用也会被拒绝。
      「重置为默认」删除该渠道的运营配置，恢复默认启用（env 密钥与 allowlist 仍生效）；要下线请用「禁用」，不是重置。
    </p>

    <div v-if="loadError" class="notice notice-danger">{{ loadError }}</div>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 56px">顺序</th>
            <th>渠道</th>
            <th>展示名</th>
            <th>密钥</th>
            <th>环境允许</th>
            <th>本页启用</th>
            <th>登录页可用</th>
            <th>回调路径</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in providers" :key="row.id">
            <td>
              <div class="order-btns">
                <button
                  type="button"
                  class="btn btn-ghost btn-xs"
                  :disabled="mutating || index === 0"
                  title="上移"
                  @click="move(index, -1)"
                >
                  ↑
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs"
                  :disabled="mutating || index === providers.length - 1"
                  title="下移"
                  @click="move(index, 1)"
                >
                  ↓
                </button>
              </div>
            </td>
            <td><code>{{ row.id }}</code></td>
            <td>
              <span class="provider-icon">{{ row.icon }}</span>
              <input
                v-model="draftLabels[row.id]"
                class="label-input"
                type="text"
                maxlength="64"
                :placeholder="row.defaultLabel"
                :disabled="mutating || savingId === row.id"
              />
            </td>
            <td>
              <span :class="row.credentialsConfigured ? 'badge ok' : 'badge warn'">
                {{ row.credentialsConfigured ? '已配置' : '未配置' }}
              </span>
            </td>
            <td>
              <span :class="row.inEnvAllowlist ? 'badge ok' : 'badge muted'">
                {{ row.inEnvAllowlist ? '是' : '否' }}
              </span>
            </td>
            <td>
              <label class="switch">
                <input
                  type="checkbox"
                  :checked="row.enabled"
                  :disabled="mutating || toggleId === row.id || (!row.enabled && !canEnable(row))"
                  @change="onToggle(row, ($event.target as HTMLInputElement).checked)"
                />
                <span>{{ row.enabled ? '开' : '关' }}</span>
              </label>
            </td>
            <td>
              <span :class="row.effective ? 'badge ok' : 'badge muted'">
                {{ row.effective ? '有效' : '无效' }}
              </span>
            </td>
            <td class="mono small">{{ row.callbackPath }}</td>
            <td>
              <div class="row-actions">
                <button
                  type="button"
                  class="btn btn-ghost btn-xs"
                  :disabled="mutating || savingId === row.id || !labelDirty(row)"
                  @click="saveLabel(row)"
                >
                  {{ savingId === row.id ? '保存中…' : '保存名称' }}
                </button>
                <button
                  v-if="row.configured"
                  type="button"
                  class="btn btn-ghost btn-xs danger-text"
                  :disabled="mutating"
                  title="删除运营配置，恢复默认启用/顺序/名称"
                  @click="resetRow(row)"
                >
                  重置为默认
                </button>
              </div>
            </td>
          </tr>
          <tr v-if="!loading && providers.length === 0">
            <td colspan="9">暂无渠道数据</td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-if="note" class="muted tip">{{ note }}</p>

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
import { useRouter } from 'vue-router'
import ConfirmDialog from '@/components/ConfirmDialog'
import { adminRequest } from '@/composables/useAdminRequest'
import { useAdminListLoader } from '@/composables/useAdminListLoader'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useToast } from '@/composables/useToast'
import { toErrorMessage } from '@usethink/cf-admin-fe/utils'

type ProviderRow = {
  id: string
  label: string
  icon: string
  defaultLabel: string
  sortOrder: number
  enabled: boolean
  credentialsConfigured: boolean
  inEnvAllowlist: boolean
  effective: boolean
  /** 是否有 DB 运营配置行（false=默认状态：启用、注册表顺序、默认名） */
  configured: boolean
  callbackPath: string
  notes?: string
}

const { showToast } = useToast()
const router = useRouter()
const {
  confirmVisible,
  confirmMessage,
  askConfirm,
  onConfirm,
} = useConfirmDialog()
const mutating = ref(false)
const toggleId = ref('')
const savingId = ref('')
const note = ref('')
const providers = ref<ProviderRow[]>([])
const draftLabels = reactive<Record<string, string>>({})
const { loading, loadError, runLoad } = useAdminListLoader()

/** 双管并行入口：社交渠道（本页）↔ OAuth 应用（/admin/clients） */
function goClients() {
  void router.push('/admin/clients')
}

function canEnable(row: ProviderRow) {
  return row.credentialsConfigured && row.inEnvAllowlist
}

function labelDirty(row: ProviderRow) {
  const draft = (draftLabels[row.id] ?? '').trim()
  // 空 draft = 恢复默认：仅当当前已是自定义名时算 dirty
  if (!draft && row.label === row.defaultLabel) return false
  if (!draft && row.label !== row.defaultLabel) return true
  return draft !== row.label
}

async function reload() {
  await runLoad(async (ctx) => {
    const data = await adminRequest<{
      providers: ProviderRow[]
      note?: string
    }>('/api/admin/social-providers')
    if (ctx.isStale()) return
    providers.value = data.providers
    note.value = data.note || ''
    for (const p of data.providers) {
      draftLabels[p.id] = p.label === p.defaultLabel ? '' : p.label
    }
  })
}

async function onToggle(row: ProviderRow, enabled: boolean) {
  if (enabled && !canEnable(row)) {
    showToast('无法启用：请先配置该渠道密钥，并确保已列入 ENABLED_SOCIAL_PROVIDERS', 'error')
    await reload()
    return
  }
  toggleId.value = row.id
  mutating.value = true
  try {
    await adminRequest(`/api/admin/social-providers/${encodeURIComponent(row.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    })
    showToast(enabled ? `已启用 ${row.id}` : `已禁用 ${row.id}`, 'success')
    await reload()
  } catch (e) {
    showToast(toErrorMessage(e), 'error')
    await reload()
  } finally {
    toggleId.value = ''
    mutating.value = false
  }
}

async function saveLabel(row: ProviderRow) {
  const raw = (draftLabels[row.id] ?? '').trim()
  savingId.value = row.id
  mutating.value = true
  try {
    await adminRequest(`/api/admin/social-providers/${encodeURIComponent(row.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ displayLabel: raw === '' ? null : raw }),
    })
    showToast('展示名已更新', 'success')
    await reload()
  } catch (e) {
    showToast(toErrorMessage(e), 'error')
  } finally {
    savingId.value = ''
    mutating.value = false
  }
}

async function move(index: number, delta: number) {
  const next = index + delta
  if (next < 0 || next >= providers.value.length) return
  const ids = providers.value.map((p) => p.id)
  const tmp = ids[index]!
  ids[index] = ids[next]!
  ids[next] = tmp
  mutating.value = true
  try {
    const data = await adminRequest<{ providers: ProviderRow[] }>(
      '/api/admin/social-providers/order',
      {
        method: 'PUT',
        body: JSON.stringify({ orderedIds: ids }),
      },
    )
    providers.value = data.providers
    showToast('排序已更新', 'success')
  } catch (e) {
    showToast(toErrorMessage(e), 'error')
    await reload()
  } finally {
    mutating.value = false
  }
}

/**
 * 重置为默认：删除运营配置行（恢复启用、注册表顺序、默认展示名）。
 * 与"禁用"语义相反——要下线请用开关；env 密钥与 allowlist 仍生效。
 */
async function resetRow(row: ProviderRow) {
  const ok = await askConfirm(
    `重置 ${row.id} 为默认状态？\n将删除该渠道的运营配置，恢复：启用、注册表顺序、默认展示名。\n` +
      `env 密钥与 allowlist 仍生效；若要下线请用「禁用」开关，而不是重置。`,
  )
  if (!ok) return
  mutating.value = true
  try {
    await adminRequest(`/api/admin/social-providers/${encodeURIComponent(row.id)}`, {
      method: 'DELETE',
    })
    showToast(`已重置 ${row.id}`, 'success')
    await reload()
  } catch (e) {
    showToast(toErrorMessage(e), 'error')
    await reload()
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
  margin: 0;
  font-size: 12px;
  color: var(--tg-hint, #9aa4b2);
  line-height: 1.5;
}
.order-btns {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.danger-text {
  color: var(--admin-danger, #fca5a5);
}
.provider-icon {
  font-size: 18px;
  margin-right: 6px;
  vertical-align: middle;
}
.label-input {
  box-sizing: border-box;
  height: 32px;
  padding: 0 8px;
  min-width: 120px;
  max-width: 180px;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: var(--r-md, 8px);
  background: var(--tg-secondary-bg, #151b28);
  color: var(--tg-text, #f0f2f5);
  font-size: 13px;
}
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}
.badge.ok {
  background: rgba(34, 197, 94, 0.18);
  color: #4ade80;
}
.badge.warn {
  background: rgba(245, 158, 11, 0.18);
  color: #fbbf24;
}
.badge.muted {
  background: rgba(148, 163, 184, 0.15);
  color: #94a3b8;
}
.switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  cursor: pointer;
}
.mono.small {
  font-size: 11px;
  word-break: break-all;
}
.tip {
  font-size: 12px;
}
</style>
