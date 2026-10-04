/**
 * PREM-M06B3 â€” raw response transport.
 *
 * Verifies the minimal raw-bytes support added to the JSON-only API client:
 * exact body bytes, exposed headers, size guards that never read an oversized
 * body, and fail-closed decoding. Existing JSON requests are unaffected.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { API_RAW_ERROR, apiRawRequest } from '@/services/cloud/apiClient'

const originalFetch = globalThis.fetch

beforeEach(() => {
  globalThis.fetch = vi.fn()
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

function encode(text) {
  return new TextEncoder().encode(text)
}

describe('apiRawRequest', () => {
  it('3. returns the exact raw body bytes and decoded text', async () => {
    const body = 'cafÃ© ðŸ˜€ {"schema":"pos-mobile-backup"}'
    const bytes = encode(body)

    globalThis.fetch.mockResolvedValueOnce(
      new Response(bytes, {
        status: 200,
        headers: {
          'X-Checksum-Sha256': 'a'.repeat(64),
          'Content-Type': 'application/octet-stream',
        },
      }),
    )

    const result = await apiRawRequest('/api/mobile/backups/u/download')

    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
    expect(result.byteLength).toBe(bytes.byteLength)
    expect(Array.from(result.bytes)).toEqual(Array.from(bytes))
    expect(result.text).toBe(body)
  })

  it('exposes response headers in a lowercase map', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response('{}', {
        status: 200,
        headers: { 'X-Checksum-Sha256': 'b'.repeat(64), 'X-Backup-Schema-Version': '3' },
      }),
    )

    const result = await apiRawRequest('/api/mobile/backups/u/download')

    expect(result.headers['x-checksum-sha256']).toBe('b'.repeat(64))
    expect(result.headers['x-backup-schema-version']).toBe('3')
  })

  it('4. aborts without reading when Content-Length already exceeds maxBytes', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response('small', {
        status: 200,
        headers: { 'Content-Length': String(50 * 1024 * 1024) },
      }),
    )

    const result = await apiRawRequest('/api/mobile/backups/u/download', { maxBytes: 1024 })

    expect(result.ok).toBe(false)
    expect(result.error.code).toBe(API_RAW_ERROR.TOO_LARGE)
  })

  it('5. rejects an oversized actual body after measuring real UTF-8 bytes', async () => {
    globalThis.fetch.mockResolvedValueOnce(new Response('x'.repeat(2048), { status: 200 }))

    const result = await apiRawRequest('/api/mobile/backups/u/download', { maxBytes: 1024 })

    expect(result.ok).toBe(false)
    expect(result.error.code).toBe(API_RAW_ERROR.TOO_LARGE)
  })

  it('fails closed on a non-UTF-8 body', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(new Uint8Array([0xff, 0xfe, 0xfd]), { status: 200 }),
    )

    const result = await apiRawRequest('/api/mobile/backups/u/download')

    expect(result.ok).toBe(false)
    expect(result.error.code).toBe(API_RAW_ERROR.DECODE_FAILED)
  })

  it('surfaces the backend JSON error code for non-2xx responses', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'BACKUP_FILE_MISSING', message: 'missing' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await apiRawRequest('/api/mobile/backups/u/download')

    expect(result.ok).toBe(false)
    expect(result.status).toBe(404)
    expect(result.error.code).toBe('BACKUP_FILE_MISSING')
  })

  it('reports network failures without throwing', async () => {
    globalThis.fetch.mockRejectedValueOnce(new Error('offline'))

    const result = await apiRawRequest('/api/mobile/backups/u/download')

    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('NETWORK_ERROR')
  })
})
