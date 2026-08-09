/**
 * Unit: admin flag via kit createAdminFlagSession (module singleton).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

function stubStorage() {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v))
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
    clear: () => store.clear(),
  })
  return store
}

describe('useAdminAuth flag API', () => {
  beforeEach(() => {
    vi.resetModules()
    stubStorage()
  })

  it('readAdminFlag is false when missing', async () => {
    const { readAdminFlag } = await import('./useAdminAuth')
    expect(readAdminFlag()).toBe(false)
  })

  it('writeAdminFlag(true) sets canonical key', async () => {
    const { ADMIN_FLAG_KEY, readAdminFlag, writeAdminFlag } = await import('./useAdminAuth')
    writeAdminFlag(true)
    expect(localStorage.getItem(ADMIN_FLAG_KEY)).toBe('1')
    expect(readAdminFlag()).toBe(true)
  })

  it('writeAdminFlag(false) removes key', async () => {
    const { ADMIN_FLAG_KEY, readAdminFlag, writeAdminFlag } = await import('./useAdminAuth')
    writeAdminFlag(true)
    writeAdminFlag(false)
    expect(localStorage.getItem(ADMIN_FLAG_KEY)).toBeNull()
    expect(readAdminFlag()).toBe(false)
  })

  it('useAdminAuth mark/clear keep ref in sync with storage', async () => {
    const { useAdminAuth, readAdminFlag } = await import('./useAdminAuth')
    const auth = useAdminAuth()
    expect(auth.isLoggedIn.value).toBe(false)
    auth.markLoggedIn()
    expect(auth.isLoggedIn.value).toBe(true)
    expect(readAdminFlag()).toBe(true)
    auth.clearToken()
    expect(auth.isLoggedIn.value).toBe(false)
    expect(readAdminFlag()).toBe(false)
  })
})
