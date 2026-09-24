import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { apiRequest, buildApiUrl, resolveBaseUrl } from '@/services/cloud/apiClient'

describe('apiClient URL normalization & resolution', () => {
  it('resolves clean base URL without trailing slash', () => {
    expect(resolveBaseUrl('https://pos.eradig.my.id')).toBe('https://pos.eradig.my.id')
    expect(resolveBaseUrl('https://pos.eradig.my.id/')).toBe('https://pos.eradig.my.id')
    expect(resolveBaseUrl('https://pos.eradig.my.id///')).toBe('https://pos.eradig.my.id')
  })

  it('strips redundant /api suffix from base URL to prevent /api/api/ duplicate pathing', () => {
    expect(resolveBaseUrl('https://pos.eradig.my.id/api')).toBe('https://pos.eradig.my.id')
    expect(resolveBaseUrl('https://pos.eradig.my.id/api/')).toBe('https://pos.eradig.my.id')
  })

  it('builds full endpoint URLs correctly without duplicate slashes or duplicate /api prefix', () => {
    const base = 'https://pos.eradig.my.id'
    expect(buildApiUrl('/api/auth/login', base)).toBe('https://pos.eradig.my.id/api/auth/login')
    expect(buildApiUrl('/api/auth/login', `${base}/`)).toBe('https://pos.eradig.my.id/api/auth/login')
    expect(buildApiUrl('/api/auth/login', `${base}/api`)).toBe('https://pos.eradig.my.id/api/auth/login')
    expect(buildApiUrl('/api/auth/login', `${base}/api/`)).toBe('https://pos.eradig.my.id/api/auth/login')
    expect(buildApiUrl('api/mobile/context', base)).toBe('https://pos.eradig.my.id/api/mobile/context')
  })
})

describe('apiClient HTTP transport & error contracts', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('sends Accept: application/json on all requests', async () => {
    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await apiRequest('/api/auth/me')

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/me'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/json',
        }),
      }),
    )
  })

  it('sends Content-Type: application/json when body is present', async () => {
    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: { token: 'xyz' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await apiRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'qa@example.com', password: 'secret' },
    })

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/login'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Accept: 'application/json',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ email: 'qa@example.com', password: 'secret' }),
      }),
    )
  })

  it('sends Authorization: Bearer token when token is passed', async () => {
    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: { user: { id: 1 } } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await apiRequest('/api/auth/me', { token: 'test-token-123' })

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/me'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token-123',
        }),
      }),
    )
  })

  it('handles HTTP 401 Unauthorized cleanly without throw', async () => {
    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Unauthenticated.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await apiRequest('/api/auth/me')

    expect(result.ok).toBe(false)
    expect(result.status).toBe(401)
    expect(result.error.code).toBe('HTTP_401')
    expect(result.error.message).toBe('Unauthenticated.')
  })

  it('handles HTTP 403 Forbidden cleanly', async () => {
    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'DEVICE_INACTIVE', message: 'Perangkat dinonaktifkan.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await apiRequest('/api/mobile/devices')

    expect(result.ok).toBe(false)
    expect(result.status).toBe(403)
    expect(result.error.code).toBe('DEVICE_INACTIVE')
  })

  it('handles HTTP 422 Validation Error cleanly', async () => {
    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({
      message: 'The email field is required.',
      errors: { email: ['The email field is required.'] },
    }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await apiRequest('/api/auth/login', { method: 'POST', body: {} })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(422)
    expect(result.error.data.errors.email).toBeDefined()
  })

  it('handles HTTP 429 Too Many Requests cleanly', async () => {
    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Too Many Attempts.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await apiRequest('/api/auth/login', { method: 'POST', body: {} })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(429)
    expect(result.error.message).toBe('Too Many Attempts.')
  })

  it('handles HTTP 500 Server Error cleanly', async () => {
    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Server error occurred' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await apiRequest('/api/sync/push', { method: 'POST', body: {} })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(500)
    expect(result.error.message).toBe('Server error occurred')
  })

  it('handles Network Error (fetch throws) gracefully with status 0 and NETWORK_ERROR code', async () => {
    global.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const result = await apiRequest('/api/sync/pull')

    expect(result.ok).toBe(false)
    expect(result.status).toBe(0)
    expect(result.error).toEqual({
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'Failed to fetch',
      data: null,
    })
  })
})
