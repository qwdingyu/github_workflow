/**
 * Platform admin HTTP client (Better Auth cookie session).
 * Domain paths stay in views; kit factory: credentials + ok-envelope + onSuccess heal.
 */
import { createAdminRequest } from '@usethink/cf-admin-fe/composables'
import { createAdminUnauthorizedHandler } from '@usethink/cf-admin-fe/utils'
import { readAdminFlag, writeAdminFlag } from './useAdminAuth'

const handleUnauthorized = createAdminUnauthorizedHandler({
  clearSession: () => {
    writeAdminFlag(false)
  },
  loginPath: '/admin/login',
  defaultRedirectPath: '/admin',
})

/**
 * Kit onSuccess heals missing local flag after any successful admin call.
 * No per-call wrapper required for heal (still export thin adminRequest for typing).
 */
export const adminRequest = createAdminRequest({
  credentials: 'include',
  resultMode: 'ok-envelope',
  errorField: 'message',
  onUnauthorized: handleUnauthorized,
  onSuccess: () => {
    if (!readAdminFlag()) writeAdminFlag(true)
  },
})
