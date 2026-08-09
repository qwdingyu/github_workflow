/**
 * Unit: cookie adminRequest heals flag on success; 401 clears via writeAdminFlag.
 * Mocks global fetch; does not hit network.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ADMIN_FLAG_KEY, readAdminFlag, writeAdminFlag } from './useAdminAuth'

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
}

function stubLocation() {
  vi.stubGlobal('window', {
    location: {
      href: 'http://localhost/admin/users',
      pathname: '/admin/users',
      search: '',
      hash: '',
      assign: vi.fn(),
      replace: vi.fn(),
    },
  })
  // some handlers read location from globalThis
  vi.stubGlobal('location', (window as unknown as { location: Location }).location)
}

describe('adminRequest cookie + flag', () => {
  beforeEach(() => {
    vi.resetModules()
    stubStorage()
    stubLocation()
  })

  it('successful ok-envelope sets flag when missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        // kit returns full JSON body (ok-envelope does not unwrap a nested data field)
        json: async () => ({ ok: true, hello: 1 }),
      })),
    )
    expect(readAdminFlag()).toBe(false)
    const { adminRequest } = await import('./useAdminRequest')
    const data = await adminRequest<{ ok: boolean; hello: number }>('/api/admin/health')
    expect(data).toEqual({ ok: true, hello: 1 })
    expect(readAdminFlag()).toBe(true)
  })

  it('401 clears flag via unauthorized handler', async () => {
    writeAdminFlag(true)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({ ok: false, message: 'unauthorized' }),
      })),
    )
    const { adminRequest } = await import('./useAdminRequest')
    await expect(adminRequest('/api/admin/users')).rejects.toBeTruthy()
    expect(localStorage.getItem(ADMIN_FLAG_KEY)).toBeNull()
    expect(readAdminFlag()).toBe(false)
  })
})
