import {
  getSystemConfigSection,
  resolveSystemConfigSectionId as resolveKitSystemConfigSectionId,
} from '@usethink/cf-admin-fe/utils'
import type {
  AdminSystemConfigDefinition,
  SystemConfigSectionLike,
} from '@usethink/cf-admin-fe'

export const AUTH_SYSTEM_CONFIG_DEFINITIONS = [
  {
    key: 'email.signup_verification_required',
    label: '注册必须验证邮箱验证码',
    description: '开启后，邮箱密码注册会发送验证码；未验证邮箱的账号不能登录。',
    effect: '用于拦截注册机批量创建可用账号。启用前请先在「邮件发送配置」中配置 SMTP 或 Resend。',
    type: 'boolean',
    defaultValue: 'false',
    group: '注册与验证码',
    order: 10,
  },
  {
    key: 'email.block_plus_alias',
    label: '禁止所有邮箱 + 别名',
    description: '拦截 user+tag@domain 形式的邮箱注册。',
    effect: '优先阻断常见批量注册绕过方式；开启后覆盖 Gmail 专项开关。',
    type: 'boolean',
    defaultValue: 'true',
    group: '邮箱策略',
    order: 20,
  },
  {
    key: 'email.block_gmail_plus_alias',
    label: '禁止 Gmail + 别名',
    description: '仅拦截 Gmail 的 user+tag@gmail.com 注册。',
    effect: '当「禁止所有邮箱 + 别名」关闭时仍可保留 Gmail 专项拦截。',
    type: 'boolean',
    defaultValue: 'true',
    group: '邮箱策略',
    order: 30,
  },
  {
    key: 'email.domain_restriction_enabled',
    label: '启用邮箱域名白名单',
    description: '开启后只允许白名单内域名注册邮箱密码账号。',
    effect: '适合内测、企业白名单或羊毛攻击期间临时收口。',
    type: 'boolean',
    defaultValue: 'false',
    group: '邮箱策略',
    order: 40,
  },
  {
    key: 'email.domain_whitelist',
    label: '邮箱域名白名单',
    description: '每行一个域名；仅在域名白名单开关开启时生效。',
    effect: '示例：qq.com、gmail.com。不要填写协议、路径或通配符。',
    type: 'string',
    defaultValue: 'qq.com\ngmail.com',
    group: '邮箱策略',
    order: 50,
  },
  {
    key: 'ui.show_non_admin_logout',
    label: '普通用户显示退出',
    description: '开启后，已登录但未获得后台权限的普通账号会在认证站首页看到退出按钮。',
    effect: '默认关闭，减少同一浏览器频繁退出、重新登录造成的业务侧反复薅取。',
    type: 'boolean',
    defaultValue: 'false',
    group: '访问与界面',
    order: 110,
  },
] satisfies AdminSystemConfigDefinition[]

export type AuthSystemConfigSectionId = 'email' | 'access' | 'general'

export type AuthSystemConfigSection = SystemConfigSectionLike & {
  id: AuthSystemConfigSectionId
  label: string
  description: string
}

export const AUTH_SYSTEM_CONFIG_SECTIONS = [
  {
    id: 'email',
    label: '邮箱与注册',
    description: '邮箱注册验证码、别名拦截、域名白名单等防批量注册策略。',
    groups: ['注册与验证码', '邮箱策略'],
  },
  {
    id: 'access',
    label: '访问与界面',
    description: '登录后的普通用户入口、退出展示等认证站界面策略。',
    groups: ['访问与界面'],
  },
  {
    id: 'general',
    label: '其他',
    description: '未归入邮箱策略的系统配置项。',
    groups: ['其他'],
  },
] as const satisfies readonly AuthSystemConfigSection[]

const SECTION_IDS = AUTH_SYSTEM_CONFIG_SECTIONS.map((section) => section.id)

export function resolveSystemConfigSectionId(raw: unknown): AuthSystemConfigSectionId {
  return resolveKitSystemConfigSectionId(raw, SECTION_IDS, 'email')
}

export function getAuthSystemConfigSection(id: AuthSystemConfigSectionId): AuthSystemConfigSection {
  return getSystemConfigSection(AUTH_SYSTEM_CONFIG_SECTIONS, id)
}
