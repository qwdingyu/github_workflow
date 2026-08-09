/**
 * Platform Admin 本地守卫 flag（Better Auth cookie 为真源；flag 仅加速路由守卫）。
 * 实现委托 kit createAdminFlagSession — 模块级单例，避免多 ref 分叉。
 * 不做 OAuth/健康探测/白名单（产品 views + router）。
 */
import { createAdminFlagSession } from '@usethink/cf-admin-fe/composables'

/** 与历史 localStorage 键兼容；亦是 recipe 默认示例键 */
export const ADMIN_FLAG_KEY = 'cf_auth_admin_ok'

const session = createAdminFlagSession({
  storageKey: ADMIN_FLAG_KEY,
})

export function readAdminFlag(): boolean {
  return session.readFlag()
}

/** 唯一写入口（router / request / login 均应走此 API 或 useAdminAuth） */
export function writeAdminFlag(ok: boolean): void {
  session.writeFlag(ok)
}

export function useAdminAuth() {
  return {
    isLoggedIn: session.isLoggedIn,
    loggedIn: session.loggedIn,
    markLoggedIn: session.markLoggedIn,
    /** 历史命名：实为 clear 本地 flag，非 Bearer token */
    clearToken: session.clearSession,
    clearSession: session.clearSession,
    writeFlag: session.writeFlag,
    readFlag: session.readFlag,
  }
}
