/**
 * Minimal vue-i18n for kit components ($t on ConfirmDialog / Pagination / Shell).
 * Product page copy stays hard-coded Chinese; host messages can grow later.
 */
import { createI18n } from 'vue-i18n'
import { mergeAdminKitMessages } from '@usethink/cf-admin-fe/i18n'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': mergeAdminKitMessages(
      {
        adminLayout: {
          title: 'cf-auth 平台',
          admin: '平台管理员',
          logout: '退出',
          loggedOut: '已退出',
          toggleSidebar: '菜单',
        },
      },
      'zh-CN',
    ),
    en: mergeAdminKitMessages(
      {
        adminLayout: {
          title: 'cf-auth',
          admin: 'Admin',
          logout: 'Log out',
          loggedOut: 'Signed out',
          toggleSidebar: 'Menu',
        },
      },
      'en',
    ),
  },
})

export default i18n
