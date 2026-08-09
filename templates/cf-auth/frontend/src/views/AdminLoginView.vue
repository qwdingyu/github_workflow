<template>
  <!-- 壳来自 kit；登录路径（OAuth / session / 邮箱）全是 cf-auth 产品逻辑 -->
  <AdminLoginShell>
    <template #title>
      <h1 class="login-title">管理入口</h1>
    </template>
    <template #subtitle>
      <p class="login-subtitle">
        仅限已授权账号。优先使用统一登录；已有邮箱密码账号也可以进入。
      </p>
    </template>

    <div v-if="checking" class="login-status">正在检测已有登录会话…</div>

    <template v-else>
      <div v-if="sessionHint" class="session-box">
        <p class="session-line">{{ sessionHint }}</p>
        <button
          class="btn btn-primary login-btn"
          type="button"
          :disabled="loading"
          @click="enterWithSession"
        >
          {{ loading ? '进入中…' : '使用当前会话进入' }}
        </button>
      </div>

      <a class="btn btn-primary login-btn social-link" :href="signInHref">
        前往统一登录
      </a>
      <p class="login-hint tight social-hint">
        将打开认证站登录页；成功后回到
        <code>{{ redirectTarget }}</code>
      </p>

      <details class="email-details">
        <summary>邮箱登录</summary>
        <p class="login-hint tight">仅适用于曾经用邮箱注册并设过密码的账号。纯社交账号请用上方按钮。</p>
        <form class="login-form" @submit.prevent="handleEmailLogin">
          <label class="field-label">
            <span>邮箱</span>
            <input
              v-model="email"
              type="email"
              placeholder="you@eforge.xyz"
              autocomplete="username"
              :disabled="loading"
            />
          </label>
          <label class="field-label">
            <span>密码</span>
            <input
              v-model="password"
              type="password"
              placeholder="账号密码"
              autocomplete="current-password"
              :disabled="loading"
            />
          </label>
          <button class="btn btn-ghost login-btn" type="submit" :disabled="loading">
            {{ loading ? '登录中…' : '邮箱登录' }}
          </button>
        </form>
      </details>

      <p v-if="error" class="login-error">{{ error }}</p>
    </template>
  </AdminLoginShell>
</template>

<script setup lang="ts">
/**
 * 平台 Admin 入口（cf-auth 特有，不进 kit）：
 * - 主路径：Better Auth 已有 session（Google 等）+ 白名单 → 直接进
 * - 次路径：邮箱密码（仅 credential 账号）
 * 壳：AdminLoginShell；redirect：resolveAdminLoginRedirect
 */
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AdminLoginShell from '@usethink/cf-admin-fe/components/AdminLoginShell.vue'
import { resolveAdminLoginRedirect } from '@usethink/cf-admin-fe/utils'
import { useAdminAuth } from '@/composables/useAdminAuth'
import { useToast } from '@/composables/useToast'
import { adminRequest } from '@/composables/useAdminRequest'

const email = ref('')
const password = ref('')
const loading = ref(false)
const checking = ref(true)
const error = ref('')
const sessionHint = ref('')
const route = useRoute()
const router = useRouter()
const { markLoggedIn, clearToken } = useAdminAuth()
const { showToast } = useToast()

const redirectTarget = computed(() =>
  resolveAdminLoginRedirect(route.query.redirect, { defaultPath: '/admin', allowPrefix: '/admin' }),
)

/** 社交登录成功后回到 Admin（或原 redirect） */
const signInHref = computed(() => {
  const cb = encodeURIComponent(redirectTarget.value)
  return `/sign-in?callbackURL=${cb}`
})

async function probeAdminSession(): Promise<boolean> {
  const res = await fetch('/api/admin/health', { credentials: 'include' })
  if (res.status === 200) {
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean }
    return data.ok === true
  }
  return false
}

async function loadSessionHint() {
  try {
    const res = await fetch('/api/auth/get-session', { credentials: 'include' })
    const data = (await res.json().catch(() => null)) as { user?: unknown } | null
    if (data?.user) {
      sessionHint.value = '已检测到当前会话，可直接尝试进入后台。'
      return true
    }
  } catch {
    /* ignore */
  }
  sessionHint.value = ''
  return false
}

async function enterWithSession() {
  error.value = ''
  loading.value = true
  try {
    await adminRequest('/api/admin/health')
    markLoggedIn()
    showToast('已进入平台管理', 'success')
    await router.replace(redirectTarget.value)
  } catch (e) {
    error.value = '当前会话未获得后台权限。'
    // 有 session 但不在权限范围内：清 flag，保留提示
    clearToken()
  } finally {
    loading.value = false
  }
}

async function handleEmailLogin() {
  error.value = ''
  loading.value = true
  try {
    const res = await fetch('/api/auth/sign-in/email', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email.value.trim(),
        password: password.value,
      }),
    })
    if (!res.ok) {
      throw new Error('邮箱登录失败，请改用统一登录。')
    }
    await adminRequest('/api/admin/health')
    markLoggedIn()
    showToast('登录成功', 'success')
    await router.replace(redirectTarget.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '登录失败，请改用统一登录。'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  checking.value = true
  error.value = ''
  try {
    // 1) 已有管理员 session → 直接进，不必再填表
    if (await probeAdminSession()) {
      markLoggedIn()
      showToast('已识别管理员会话', 'success')
      await router.replace(redirectTarget.value)
      return
    }
    // 2) 有普通 session 但未过白名单 / 或仅展示「进入」按钮再调 admin
    await loadSessionHint()
  } catch {
    /* 保持登录 UI */
  } finally {
    checking.value = false
  }
})
</script>

<style scoped>
.admin-login {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--tg-bg, #0a0e17);
  color-scheme: dark;
}
.login-card {
  width: 100%;
  max-width: 420px;
  padding: 28px 24px;
  border-radius: var(--r-lg, 12px);
  background: var(--tg-secondary-bg, #151b28);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  box-shadow: var(--shadow-lg, 0 8px 32px rgba(0, 0, 0, 0.35));
}
.login-title {
  margin: 0 0 8px;
  font-size: 20px;
  font-weight: 700;
  color: var(--tg-text, #f0f2f5);
}
.login-subtitle {
  margin: 0 0 20px;
  font-size: 13px;
  color: var(--tg-hint, #9aa4b2);
  line-height: 1.5;
}
.login-subtitle code {
  font-size: 12px;
  color: var(--admin-accent-text, #fbbf24);
}
.login-status {
  color: var(--tg-hint, #9aa4b2);
  font-size: 14px;
}
.session-box {
  margin-bottom: 14px;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid rgba(251, 191, 36, 0.35);
  background: rgba(251, 191, 36, 0.08);
}
.session-line {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--tg-text, #f0f2f5);
  line-height: 1.45;
}
.login-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 10px;
}
.field-label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--tg-hint, #9aa4b2);
}
.field-label input {
  height: 34px;
  padding: 0 10px;
  border-radius: var(--r-md, 8px);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  background: var(--tg-secondary-bg, #151b28);
  color: var(--tg-text, #f0f2f5);
  font-size: 14px;
}
.login-btn {
  margin-top: 8px;
  width: 100%;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  box-sizing: border-box;
}
.social-link {
  margin-bottom: 6px;
}
.social-hint {
  margin: 0 0 12px;
  text-align: center;
}
.social-hint code {
  font-size: 11px;
  word-break: break-all;
  color: var(--admin-accent-text, #fbbf24);
}
.email-details {
  margin-top: 8px;
  color: var(--tg-hint, #9aa4b2);
  font-size: 13px;
}
.email-details summary {
  cursor: pointer;
  user-select: none;
}
.login-error {
  margin: 12px 0 0;
  color: var(--admin-danger, #fca5a5);
  font-size: 13px;
}
.login-hint {
  margin-top: 16px;
  font-size: 12px;
  color: var(--tg-hint, #9aa4b2);
  line-height: 1.5;
}
.login-hint.tight {
  margin: 8px 0 0;
}
.btn-ghost {
  background: transparent;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.15));
  color: var(--tg-text, #f0f2f5);
  border-radius: 8px;
  cursor: pointer;
}
</style>
