<template>
  <div class="admin-page">
    <div class="toolbar">
      <div class="filters"><span class="muted">邮件发送配置（多通道容错链）</span></div>
      <div class="toolbar-actions">
        <button type="button" class="btn btn-primary btn-sm" @click="openAdd">新增配置</button>
        <button type="button" class="btn btn-ghost btn-sm" :disabled="loading" @click="reload">刷新</button>
      </div>
    </div>
    <p class="hint">
      SMTP / Resend 密码在创建时<strong>仅输入一次</strong>（AES-256-GCM 加密入库，列表不回显）。
      发送时按 priority 升序轮询，第一个成功即停止；全失败降级 console。
    </p>

    <div v-if="selectedCount > 0" class="bulk-bar" role="status">
      <span>已选 {{ selectedCount }} 个配置</span>
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
            <th>优先</th>
            <th>名称</th>
            <th>provider</th>
            <th>host</th>
            <th>TLS</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading"><td colspan="8">加载中…</td></tr>
          <tr v-else-if="items.length===0"><td colspan="8">暂无配置</td></tr>
          <tr v-for="it in items" :key="it.id" :class="{ 'is-selected': isSelected(it.id) }">
            <td class="select-cell">
              <input
                type="checkbox"
                :checked="isSelected(it.id)"
                :disabled="loading || mutating"
                :aria-label="`选择邮件配置 ${it.name || it.provider}`"
                @click="setSelected(it.id, ($event.target as HTMLInputElement).checked, ($event as MouseEvent).shiftKey)"
              />
            </td>
            <td><code>{{ it.priority }}</code></td>
            <td>{{ it.name || '—' }}</td>
            <td><span :class="it.provider==='resend'?'badge badge-purple':'badge badge-blue'">{{ it.provider }}</span></td>
            <td class="mono small">{{ it.host || '—' }}</td>
            <td class="mono small">{{ it.tlsMode }}</td>
            <td><span :class="it.enabled?'badge badge-ok':'badge badge-muted'">{{ it.enabled?'生效':'停用' }}</span></td>
            <td class="actions">
              <button type="button" class="btn btn-ghost btn-xs" :disabled="mutating" @click="toggle(it)">{{ it.enabled?'停用':'启用' }}</button>
              <button v-if="it.enabled" type="button" class="btn btn-ghost btn-xs" :disabled="mutating" @click="openTest(it)">测试</button>
              <button type="button" class="btn btn-ghost btn-xs" :disabled="mutating" @click="openEdit(it)">编辑</button>
              <button type="button" class="btn btn-ghost btn-xs danger-text" :disabled="mutating" @click="removeOne(it)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <AdminModal v-model="modalOpen" title="新增邮件配置" max-width="520px">
      <label class="field-label"><span>provider</span>
        <select v-model="form.provider"><option value="smtp">SMTP</option><option value="resend">Resend</option></select>
      </label>
      <label class="field-label"><span>名称</span><input v-model="form.name" :placeholder="form.provider==='resend'?'My App':'QQ企业邮箱'" /></label>
      <template v-if="form.provider==='smtp'">
        <label class="field-label"><span>host</span><input v-model="form.host" placeholder="smtp.qq.com" /></label>
        <div style="display:flex;gap:8px">
          <label class="field-label" style="flex:1"><span>port</span><input v-model.number="form.port" type="number" placeholder="587" /></label>
          <label class="field-label" style="flex:1"><span>TLS</span><select v-model="form.tlsMode"><option value="ssl">ssl (465)</option><option value="starttls">starttls (587)</option><option value="none">none (内网)</option></select></label>
        </div>
        <label class="field-label"><span>username</span><input v-model="form.username" placeholder="noreply@x.com" /></label>
      </template>
      <label class="field-label"><span>{{ form.provider==='resend' ? 'API Key（仅一次）' : '密码（仅一次）' }}</span>
        <div class="secret-input">
          <input v-model="form.plainSecret" :type="showSecret ? 'text' : 'password'" />
          <button type="button" class="btn eye-btn" tabindex="-1" @click="showSecret=!showSecret">{{ showSecret ? '🙈' : '👁' }}</button>
        </div>
      </label>
      <label class="field-label"><span>优先级（越小越优先）</span><input v-model.number="form.priority" type="number" placeholder="100" /></label>
      <template #actions>
        <button type="button" class="btn btn-ghost" @click="modalOpen=false">取消</button>
        <button type="button" class="btn btn-primary" :disabled="saving" @click="doAdd">{{ saving?'保存中…':'保存' }}</button>
      </template>
    </AdminModal>

    <AdminModal v-model="editOpen" title="编辑邮件配置" max-width="520px">
      <label class="field-label"><span>名称</span><input v-model="editForm.name" /></label>
      <template v-if="editForm.provider==='smtp'">
        <label class="field-label"><span>host</span><input v-model="editForm.host" /></label>
        <div style="display:flex;gap:8px">
          <label class="field-label" style="flex:1"><span>port</span><input v-model.number="editForm.port" type="number" /></label>
          <label class="field-label" style="flex:1"><span>TLS</span><select v-model="editForm.tlsMode"><option value="ssl">ssl</option><option value="starttls">starttls</option><option value="none">none</option></select></label>
        </div>
        <label class="field-label"><span>username</span><input v-model="editForm.username" /></label>
      </template>
      <label class="field-label"><span>优先级</span><input v-model.number="editForm.priority" type="number" /></label>
      <label class="field-label"><span>状态</span><select v-model="editForm.enabled"><option :value="true">生效</option><option :value="false">停用</option></select></label>
      <label class="field-label"><span>密钥（可选，留空不更新）</span>
        <div class="secret-input">
          <input v-model="editForm.plainSecret" :type="editShowSecret ? 'text' : 'password'" placeholder="不修改请留空" />
          <button type="button" class="btn eye-btn" tabindex="-1" @click="editShowSecret=!editShowSecret">{{ editShowSecret ? '🙈' : '👁' }}</button>
        </div>
      </label>
      <p class="hint">如需更换密钥，请在下方填写新值；留空则保留原有密钥不变。</p>
      <template #actions>
        <button type="button" class="btn btn-ghost" @click="editOpen=false">取消</button>
        <button type="button" class="btn btn-primary" :disabled="saving" @click="doEdit">{{ saving?'保存中…':'保存' }}</button>
      </template>
    </AdminModal>

    <AdminModal v-model="testOpen" title="发送测试邮件" max-width="400px">
      <label class="field-label"><span>收件邮箱</span><input v-model="testTo" type="email" placeholder="you@example.com" /></label>
      <template #actions>
        <button type="button" class="btn btn-ghost" @click="testOpen=false">取消</button>
        <button type="button" class="btn btn-primary" :disabled="saving" @click="doTest">{{ saving?'发送中…':'发送测试' }}</button>
      </template>
    </AdminModal>

    <ConfirmDialog v-model="confirmVisible" :message="confirmMessage" danger @confirm="onConfirm" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import AdminModal from '@/components/AdminModal'
import ConfirmDialog from '@/components/ConfirmDialog'
import { adminRequest } from '@/composables/useAdminRequest'
import { useAdminListLoader } from '@/composables/useAdminListLoader'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useTableSelection } from '@/composables/useTableSelection'
import { useToast } from '@/composables/useToast'
import { buildBatchToast, checkAdminBatchLimit, toErrorMessage } from '@usethink/cf-admin-fe/utils'

type EmailConfigItem = { id: string; provider: string; name: string|null; priority: number; enabled: boolean; host: string|null; port: number|null; username: string|null; tlsMode: string; secretHint: string }

const { showToast } = useToast()
const { confirmVisible, confirmMessage, askConfirm, onConfirm } = useConfirmDialog()
const { loading, loadError, runLoad } = useAdminListLoader()
const items = ref<EmailConfigItem[]>([])
const mutating = ref(false)
const saving = ref(false)
const showSecret = ref(false)
const modalOpen = ref(false)
const form = reactive({ provider:'smtp', name:'', host:'', port:587 as number|null, username:'', tlsMode:'starttls', plainSecret:'', priority:100 })
const editForm = reactive({ id:'', provider:'smtp' as string, name:'', host:'', port:null as number|null, username:'', tlsMode:'starttls', priority:100, enabled:true })
const editOpen = ref(false)
const editShowSecret = ref(false)
const TLS_PORT: Record<string, number> = { ssl: 465, starttls: 587, none: 25 }
const KNOWN_PORTS = new Set([465, 587, 25])
watch(() => form.tlsMode, (v) => { if (TLS_PORT[v] && (!form.port || KNOWN_PORTS.has(form.port))) form.port = TLS_PORT[v] })
watch(() => editForm.tlsMode, (v) => { if (TLS_PORT[v] && (!editForm.port || KNOWN_PORTS.has(editForm.port!))) editForm.port = TLS_PORT[v] })
const testOpen = ref(false)
const testTo = ref('')
const testId = ref('')

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

function openAdd(){ Object.assign(form, { provider:'smtp', name:'', host:'', port:587, username:'', tlsMode:'starttls', plainSecret:'', priority:100 }); modalOpen.value=true }

function openEdit(it:EmailConfigItem){ editForm.id=it.id; editForm.provider=it.provider; editForm.name=it.name||''; editForm.host=it.host||''; editForm.port=it.port; editForm.username=it.username||''; editForm.tlsMode=it.tlsMode; editForm.priority=it.priority; editForm.enabled=it.enabled; editForm.plainSecret=''; editShowSecret.value=false; editOpen.value=true }

function openTest(it:EmailConfigItem){ testId.value=it.id; testTo.value=''; testOpen.value=true }

async function reload(){ await runLoad(async ctx => { const d = await adminRequest<{items:EmailConfigItem[]}>('/api/admin/email-config'); if(!ctx.isStale()) items.value = d.items }) }

async function doAdd(){
  if(!form.plainSecret.trim()){ showToast('password / API key required','error'); return }
  saving.value=true
  try{
    await adminRequest('/api/admin/email-config', { method:'POST', body:JSON.stringify(form) })
    showToast('已新增','success'); modalOpen.value=false; await reload()
  }catch(e){ showToast(toErrorMessage(e),'error') } finally { saving.value=false }
}

async function toggle(it:EmailConfigItem){
  const next = !it.enabled; const ok = await askConfirm(next?`启用 ${it.name||it.provider}？`:`停用 ${it.name||it.provider}？`)
  if(!ok) return; mutating.value=true
  try{ await adminRequest(`/api/admin/email-config/${it.id}`,{method:'PATCH',body:JSON.stringify({enabled:next})}); showToast(next?'已启用':'已停用','success'); await reload() }
  catch(e){ showToast(toErrorMessage(e),'error') } finally { mutating.value=false }
}

async function removeOne(it:EmailConfigItem){
  const ok = await askConfirm(`删除 ${it.name||it.provider}？删除后该通道立即失效。`)
  if(!ok) return; mutating.value=true
  try{ await adminRequest(`/api/admin/email-config/${it.id}`,{method:'DELETE'}); showToast('已删除','success'); await reload() }
  catch(e){ showToast(toErrorMessage(e),'error') } finally { mutating.value=false }
}

async function batchSetEnabled(enabled: boolean) {
  const ids = [...selectedIds.value]
  if (ids.length === 0 || mutating.value) return
  const limitCheck = checkAdminBatchLimit(ids, { unit: '个配置' })
  if (!limitCheck.ok) {
    showToast(limitCheck.message, 'error')
    return
  }
  const ok = await askConfirm(`确认${enabled ? '启用' : '停用'} ${ids.length} 个邮件配置？`)
  if (!ok) return
  mutating.value = true
  try {
    let success = 0
    let failed = 0
    for (const id of ids) {
      try {
        await adminRequest(`/api/admin/email-config/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) })
        success++
      } catch {
        failed++
      }
    }
    const toast = buildBatchToast({ success, failed }, {
      mixed: `操作完成：成功 ${success}，失败 ${failed}`,
      success: `已${enabled ? '启用' : '停用'} ${success} 个配置`,
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
  const limitCheck = checkAdminBatchLimit(ids, { unit: '个配置' })
  if (!limitCheck.ok) {
    showToast(limitCheck.message, 'error')
    return
  }
  const ok = await askConfirm(`确认批量删除 ${ids.length} 个邮件配置？删除后对应通道立即失效。`)
  if (!ok) return
  mutating.value = true
  try {
    const data = await adminRequest<{ success: number; failed: number; errors: Array<{ id: string; message: string }> }>('/api/admin/email-config/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    })
    const toast = buildBatchToast(data, {
      mixed: `删除完成：成功 ${data.success}，失败 ${data.failed}`,
      success: `已删除 ${data.success} 个配置`,
    })
    showToast(toast.message, toast.type)
    clearSelection()
    await reload()
  } catch (e) {
    showToast(toErrorMessage(e, '删除邮件配置失败'), 'error')
  } finally {
    mutating.value = false
  }
}

async function doEdit(){
  saving.value=true
  try{
    const payload: Record<string, unknown> = { ...editForm };
    if (!payload.plainSecret) delete payload.plainSecret;
    await adminRequest(`/api/admin/email-config/${editForm.id}`,{method:'PATCH',body:JSON.stringify(payload)})
    showToast('已保存','success'); editOpen.value=false; await reload()
  }catch(e){ showToast(toErrorMessage(e),'error') } finally { saving.value=false }
}

async function doTest(){
  if(!testTo.value.includes('@')){ showToast('请填写收件邮箱','error'); return }
  saving.value=true
  try{
    await adminRequest(`/api/admin/email-config/${testId.value}/test`,{method:'POST',body:JSON.stringify({to:testTo.value})})
    showToast('测试邮件已发送','success'); testOpen.value=false
  }catch(e){ showToast(toErrorMessage(e),'error') } finally { saving.value=false }
}

onMounted(reload)
</script>

<style scoped>
.toolbar-actions{display:flex;gap:6px;margin-left:auto}
.hint{margin:0 0 10px;font-size:12px;color:var(--tg-hint,#9aa4b2);line-height:1.6}
.table-wrap{overflow:auto;border-radius:var(--r-lg,12px);border:1px solid var(--border,rgba(255,255,255,.1));background:var(--tg-secondary-bg,#151b28)}
.data-table{width:100%;border-collapse:collapse;font-size:13px}
.data-table th,.data-table td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--border,rgba(255,255,255,.08))}
.data-table th{color:var(--tg-hint,#9aa4b2);font-weight:600;font-size:12px}
.mono{font-size:11px;word-break:break-all}.small{font-size:11px}.muted{color:var(--tg-hint,#9aa4b2)}
.actions{display:flex;flex-wrap:wrap;gap:4px}
.select-cell{width:36px;text-align:center}
.is-selected{background:rgba(251,191,36,.06)}
.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600}
.badge-ok{background:rgba(34,197,94,.18);color:#4ade80}
.badge-muted{background:rgba(148,163,184,.15);color:#94a3b8}
.badge-purple{background:rgba(168,85,247,.18);color:#c084fc}
.badge-blue{background:rgba(59,130,246,.18);color:#60a5fa}
.danger-text{color:var(--admin-danger,#fca5a5)}
.notice{padding:10px 12px;border-radius:var(--r-md,8px);font-size:13px}
.notice-danger{background:var(--admin-danger-soft,rgba(248,113,113,.12));color:var(--admin-danger,#fca5a5)}
.field-label{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--tg-hint)}
.field-label input,.field-label select{padding:8px 10px;border-radius:var(--r-md,8px);border:1px solid var(--border);background:var(--tg-secondary-bg);color:var(--tg-text);font-size:13px;font-family:inherit;box-sizing:border-box;height:38px;line-height:1.4}
.secret-input{display:flex;gap:4px;align-items:center}
.secret-input input{flex:1}
.eye-btn{padding:6px 8px;font-size:16px;line-height:1;cursor:pointer;background:transparent;border:none;border-radius:6px}
.eye-btn:hover{background:rgba(255,255,255,.08)}
</style>
