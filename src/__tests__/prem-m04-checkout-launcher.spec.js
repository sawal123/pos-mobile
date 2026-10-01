/**
 * PREM-M04 hardening — checkout launcher (Midtrans handoff).
 *
 * Exercises the REAL launcher module (not mocked): native uses the Capacitor
 * Browser plugin, web falls back to window.open, and every URL is validated
 * fail-closed (missing / malformed / unsupported protocol / insecure http).
 */

import { describe, expect, it, vi } from 'vitest'

import {
  CHECKOUT_LAUNCH_ERROR,
  CHECKOUT_URL_ERROR,
  isInsecureCheckoutAllowed,
  isLoopbackHost,
  openCheckoutUrl,
  validateCheckoutUrl,
} from '../services/premium/checkoutLauncher'

const PROD_ENV = { PROD: true, DEV: false, MODE: 'production' }
const DEV_ENV = { PROD: false, DEV: true, MODE: 'development' }
const TEST_ENV = { PROD: false, DEV: false, MODE: 'test', VITEST: true }

const HTTPS_URL = 'https://app.sandbox.midtrans.com/snap/v2/vtweb/abc'
const LOOPBACK_HTTP_URL = 'http://localhost:8000/snap/redirect'

describe('validateCheckoutUrl', () => {
  it('accepts https in production', () => {
    const res = validateCheckoutUrl(HTTPS_URL, { env: PROD_ENV })
    expect(res.ok).toBe(true)
    expect(res.url).toBe(HTTPS_URL)
  })

  it('rejects a missing URL', () => {
    expect(validateCheckoutUrl('', { env: PROD_ENV })).toMatchObject({
      ok: false,
      code: CHECKOUT_URL_ERROR.MISSING,
    })
    expect(validateCheckoutUrl(null, { env: PROD_ENV }).ok).toBe(false)
  })

  it('rejects a malformed URL', () => {
    const res = validateCheckoutUrl('not a url', { env: PROD_ENV })
    expect(res.ok).toBe(false)
    expect(res.code).toBe(CHECKOUT_URL_ERROR.MALFORMED)
  })

  it('rejects an unsupported protocol', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x/y']) {
      const res = validateCheckoutUrl(url, { env: PROD_ENV })
      expect(res.ok).toBe(false)
      expect(res.code).toBe(CHECKOUT_URL_ERROR.PROTOCOL)
    }
  })

  it('rejects plain HTTP in production', () => {
    const res = validateCheckoutUrl('http://example.com/pay', { env: PROD_ENV })
    expect(res.ok).toBe(false)
    expect(res.code).toBe(CHECKOUT_URL_ERROR.INSECURE)
  })

  it('allows loopback HTTP only in an explicit dev/test environment', () => {
    expect(validateCheckoutUrl(LOOPBACK_HTTP_URL, { env: TEST_ENV })).toMatchObject({ ok: true })
    expect(validateCheckoutUrl(LOOPBACK_HTTP_URL, { env: DEV_ENV })).toMatchObject({ ok: true })
    // Non-loopback HTTP is never allowed, even in dev.
    expect(validateCheckoutUrl('http://example.com/pay', { env: DEV_ENV }).ok).toBe(false)
    // And never in production.
    expect(validateCheckoutUrl(LOOPBACK_HTTP_URL, { env: PROD_ENV }).ok).toBe(false)
  })

  it('exposes the loopback/policy helpers', () => {
    expect(isLoopbackHost('localhost')).toBe(true)
    expect(isLoopbackHost('127.0.0.1')).toBe(true)
    expect(isLoopbackHost('example.com')).toBe(false)
    expect(isInsecureCheckoutAllowed(TEST_ENV)).toBe(true)
    expect(isInsecureCheckoutAllowed(PROD_ENV)).toBe(false)
  })
})

describe('openCheckoutUrl', () => {
  it('native uses the Capacitor Browser plugin', async () => {
    const browser = { open: vi.fn().mockResolvedValue(undefined) }
    const windowRef = { open: vi.fn() }

    const res = await openCheckoutUrl(HTTPS_URL, {
      native: true,
      browser,
      windowRef,
      env: PROD_ENV,
    })

    expect(res).toEqual({ ok: true, mode: 'native-browser' })
    expect(browser.open).toHaveBeenCalledWith({ url: HTTPS_URL })
    expect(windowRef.open).not.toHaveBeenCalled()
  })

  it('web falls back to window.open', async () => {
    const browser = { open: vi.fn() }
    const windowRef = { open: vi.fn() }

    const res = await openCheckoutUrl(HTTPS_URL, {
      native: false,
      browser,
      windowRef,
      env: PROD_ENV,
    })

    expect(res).toEqual({ ok: true, mode: 'window-open' })
    expect(windowRef.open).toHaveBeenCalledWith(HTTPS_URL, '_blank', 'noopener,noreferrer')
    expect(browser.open).not.toHaveBeenCalled()
  })

  it('does not open anything for an invalid/malformed URL', async () => {
    const browser = { open: vi.fn() }
    const windowRef = { open: vi.fn() }

    const res = await openCheckoutUrl('not-a-url', {
      native: true,
      browser,
      windowRef,
      env: PROD_ENV,
    })

    expect(res).toEqual({ ok: false, code: CHECKOUT_URL_ERROR.MALFORMED })
    expect(browser.open).not.toHaveBeenCalled()
    expect(windowRef.open).not.toHaveBeenCalled()
  })

  it('does not open an insecure URL in production', async () => {
    const browser = { open: vi.fn() }
    const res = await openCheckoutUrl('http://example.com/pay', {
      native: true,
      browser,
      env: PROD_ENV,
    })
    expect(res).toEqual({ ok: false, code: CHECKOUT_URL_ERROR.INSECURE })
    expect(browser.open).not.toHaveBeenCalled()
  })

  it('reports a safe error when Browser.open rejects', async () => {
    const browser = { open: vi.fn().mockRejectedValue(new Error('no activity')) }
    const windowRef = { open: vi.fn() }

    const res = await openCheckoutUrl(HTTPS_URL, {
      native: true,
      browser,
      windowRef,
      env: PROD_ENV,
    })

    expect(res).toEqual({ ok: false, code: CHECKOUT_LAUNCH_ERROR.BROWSER_OPEN_FAILED })
    // A native failure must not silently fall back to a web window.
    expect(windowRef.open).not.toHaveBeenCalled()
  })
})
