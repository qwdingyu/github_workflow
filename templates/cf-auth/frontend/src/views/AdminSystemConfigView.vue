<template>
  <div class="admin-page">
    <div class="toolbar">
      <h2 class="page-title">系统配置</h2>
      <button type="button" class="btn btn-primary btn-sm" :disabled="loading" @click="loadData">
        刷新
      </button>
    </div>

    <div v-if="loadError" class="table-error" role="alert">
      <span>{{ loadError }}</span>
      <button type="button" class="btn btn-ghost btn-xs" :disabled="loading" @click="loadData">
        重新加载
      </button>
    </div>

    <div v-if="!loading && !loadError" class="tabs config-section-tabs" role="tablist" aria-label="系统配置分区">
      <button
        v-for="section in AUTH_SYSTEM_CONFIG_SECTIONS"
        :key="section.id"
        type="button"
        class="tab"
        role="tab"
        :aria-selected="activeSection === section.id"
        :class="{ active: activeSection === section.id }"
        @click="selectSection(section.id)"
      >
        {{ section.label }}
        <span class="config-tab-count">{{ sectionItemCounts[section.id] ?? 0 }}</span>
      </button>
    </div>

    <div class="config-scroll">
      <div v-if="activeSection === 'email' && !loading && !loadError" class="status-banner status-banner-info">
        开启“注册必须验证邮箱验证码”前，请先确认「邮件发送配置」已有启用通道，否则邮箱注册会被服务端拒绝。
      </div>

      <div v-if="loading" class="skeleton-list">
        <div v-for="i in 6" :key="i" class="skeleton-line w-80" />
      </div>

      <template v-else-if="!loadError">
        <section class="config-section" :aria-labelledby="`config-section-${activeSection}`">
          <div class="config-section-head">
            <div>
              <h3 :id="`config-section-${activeSection}`">{{ activeSectionDef.label }}</h3>
              <p>{{ activeSectionDef.description }}</p>
            </div>
            <span class="config-count">{{ activeSectionItemCount }} 项</span>
          </div>

          <div v-if="activeGroupedDefinitions.length === 0" class="empty-text config-empty">
            暂无配置项
          </div>

          <div v-for="group in activeGroupedDefinitions" :key="group.name" class="config-group">
            <div class="config-group-title">
              <span>{{ group.name }}</span>
              <span>{{ group.items.length }} 项</span>
            </div>
            <div class="config-grid">
              <ConfigField
                v-for="item in group.items"
                :key="item.key"
                :item="item"
                :value="config[item.key] ?? item.defaultValue ?? ''"
                :status="fieldStatus[item.key] || 'idle'"
                @change="update"
                @reset="reset"
              />
            </div>
          </div>
        </section>
      </template>
    </div>

    <ConfirmDialog v-model="confirmVisible" :message="confirmMessage" danger @confirm="onConfirm" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConfigField from '@usethink/cf-admin-fe/components/ConfigField.vue'
import type {
  AdminSystemConfigDefinition,
  ConfigFieldStatus,
} from '@usethink/cf-admin-fe/types'
import {
  buildActiveGroupedDefinitions,
  countSectionItems,
  groupDefinitionsByName,
  toErrorMessage,
} from '@usethink/cf-admin-fe/utils'
import ConfirmDialog from '@/components/ConfirmDialog'
import { adminRequest } from '@/composables/useAdminRequest'
import { useAdminListLoader } from '@/composables/useAdminListLoader'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useToast } from '@/composables/useToast'
import {
  AUTH_SYSTEM_CONFIG_DEFINITIONS,
  AUTH_SYSTEM_CONFIG_SECTIONS,
  getAuthSystemConfigSection,
  resolveSystemConfigSectionId,
  type AuthSystemConfigSectionId,
} from './system-config-definitions'

type ConfigItem = {
  key: string
  value: string
  description?: string | null
  updatedAt?: string | number | Date | null
}

const { showToast } = useToast()
const { loading, loadError, runLoad } = useAdminListLoader()
const {
  confirmVisible,
  confirmMessage,
  askConfirm,
  onConfirm,
} = useConfirmDialog()
const route = useRoute()
const router = useRouter()

const rows = ref<ConfigItem[]>([])
const config = reactive<Record<string, string>>({})
const fieldStatus = reactive<Record<string, ConfigFieldStatus>>({})
const activeSection = ref<AuthSystemConfigSectionId>(
  resolveSystemConfigSectionId(route.query.tab),
)

watch(
  () => route.query.tab,
  (tab) => {
    activeSection.value = resolveSystemConfigSectionId(tab)
  },
)

const definitions = computed(() => buildDefinitions(rows.value))
const activeSectionDef = computed(() => getAuthSystemConfigSection(activeSection.value))
const groupsByName = computed(() => groupDefinitionsByName(definitions.value, '其他'))
const sectionItemCounts = computed(() =>
  countSectionItems(groupsByName.value, AUTH_SYSTEM_CONFIG_SECTIONS),
)
const activeGroupedDefinitions = computed(() =>
  buildActiveGroupedDefinitions(activeSectionDef.value.groups, groupsByName.value),
)
const activeSectionItemCount = computed(
  () => sectionItemCounts.value[activeSection.value] ?? 0,
)

function buildDefinitions(items: ConfigItem[]): AdminSystemConfigDefinition[] {
  const knownKeys = new Set(AUTH_SYSTEM_CONFIG_DEFINITIONS.map((item) => item.key))
  const unknown = items
    .filter((item) => !knownKeys.has(item.key))
    .map((item, index): AdminSystemConfigDefinition => ({
      key: item.key,
      label: item.key,
      description: item.description || '自定义系统配置项',
      type: item.value === 'true' || item.value === 'false' ? 'boolean' : 'string',
      defaultValue: item.value,
      group: '其他',
      order: 1000 + index,
    }))

  return [...AUTH_SYSTEM_CONFIG_DEFINITIONS, ...unknown]
}

function selectSection(id: AuthSystemConfigSectionId) {
  if (activeSection.value === id && route.query.tab === id) return
  activeSection.value = id
  void router.replace({ query: { ...route.query, tab: id } })
}

async function loadData() {
  await runLoad(async (ctx) => {
    const data = await adminRequest<{ items: ConfigItem[] }>('/api/admin/system-config')
    if (ctx.isStale()) return
    rows.value = data.items
    for (const key of Object.keys(config)) delete config[key]
    for (const item of AUTH_SYSTEM_CONFIG_DEFINITIONS) {
      config[item.key] = item.defaultValue ?? ''
    }
    for (const item of data.items) {
      config[item.key] = item.value
    }
  }, {
    onError: (err) => toErrorMessage(err, '加载系统配置失败'),
  })
  if (loadError.value) {
    showToast(loadError.value, 'error')
  }
}

async function update(key: string, value: string) {
  fieldStatus[key] = 'saving'
  try {
    const res = await adminRequest<{ key: string; value: string }>(
      `/api/admin/system-config/${encodeURIComponent(key)}`,
      { method: 'PUT', body: JSON.stringify({ value }) },
    )
    config[key] = res.value
    rows.value = upsertRow(rows.value, res.key, res.value)
    fieldStatus[key] = 'saved'
    showToast('已保存', 'success')
  } catch (e) {
    fieldStatus[key] = 'error'
    showToast(toErrorMessage(e, '保存失败'), 'error')
  }
}

async function reset(key: string) {
  const def = definitions.value.find((item) => item.key === key)
  if (!def) return
  const ok = await askConfirm(`确认重置 ${key} 为默认值？`)
  if (!ok) return
  await update(key, def.defaultValue ?? '')
}

function upsertRow(items: ConfigItem[], key: string, value: string): ConfigItem[] {
  const now = new Date().toISOString()
  const existing = items.find((item) => item.key === key)
  if (!existing) return [...items, { key, value, updatedAt: now }]
  return items.map((item) => item.key === key ? { ...item, value, updatedAt: now } : item)
}

onMounted(loadData)
</script>

<style>
@import '@/assets/admin.css';
</style>

<style scoped>
.config-section-tabs {
  flex-shrink: 0;
  flex-wrap: nowrap;
  overflow-x: auto;
  padding-bottom: 2px;
  margin: 0 0 4px;
  -webkit-overflow-scrolling: touch;
}

.config-tab-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.25em;
  margin-left: 2px;
  padding: 0 5px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.4;
  color: var(--tg-hint, #9aa4b2);
  background: rgba(255, 255, 255, 0.06);
}

.tab.active .config-tab-count,
.tab[aria-selected='true'] .config-tab-count {
  color: var(--admin-accent-text, #fbbf24);
  background: rgba(245, 158, 11, 0.16);
}

.config-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 2px 24px;
  display: flex;
  flex-direction: column;
  gap: var(--admin-stack-gap, 8px);
}

.config-group {
  display: flex;
  flex-direction: column;
  gap: var(--admin-stack-gap, 8px);
}

.config-group-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--tg-text, #f0f2f5);
  font-size: 13px;
  font-weight: 600;
}

.config-group-title span:last-child {
  color: var(--tg-hint, #9aa4b2);
  font-size: 12px;
  font-weight: 400;
}

.config-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--admin-card-gap, 10px);
  align-items: stretch;
}

.config-grid :deep(.config-card) {
  min-width: 0;
  height: 100%;
  padding: 10px;
}

.config-grid :deep(.config-label) {
  gap: 8px;
}

.config-grid :deep(.config-label > span) {
  min-width: 0;
  font-size: 13px;
  line-height: 1.35;
}

.config-grid :deep(.config-help),
.config-grid :deep(.config-effect),
.config-grid :deep(.config-range) {
  font-size: 11px;
  line-height: 1.45;
}

.config-grid :deep(textarea) {
  min-height: 72px;
}

.config-grid :deep(input),
.config-grid :deep(textarea) {
  min-width: 0;
}

@media (max-width: 1199px) {
  .config-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .config-grid {
    grid-template-columns: 1fr;
  }
}
</style>
