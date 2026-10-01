/**
 * PREM-M04 — Midtrans handoff launcher (hardened).
 *
 * The backend owns the payment page: checkout returns a Midtrans `redirect_url`.
 * The client only opens that URL — it never holds the Midtrans server key and
 * never calls a privileged Midtrans API.
 *
 * Native Capacitor uses `Browser.open()` from `@capacitor/browser` (a real
 * dependency, statically imported — not a dynamic import used to dodge an
 * uninstalled package). The web build falls back to `window.open`.
 *
 * Every URL is validated first and fails closed:
 * - missing / malformed URL
 * - unsupported protocol
 * - plain HTTP, unless an explicit development/test-only policy allows it on a
 *   loopback host. Production never allows anything but HTTPS.
 */

import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'

export const CHECKOUT_URL_ERROR = Object.freeze({
  MISSING: 'CHECKOUT_URL_MISSING',
  MALFORMED: 'CHECKOUT_URL_MALFORMED',
  PROTOCOL: 'CHECKOUT_URL_PROTOCOL',
  INSECURE: 'CHECKOUT_URL_INSECURE',
})

export const CHECKOUT_LAUNCH_ERROR = Object.freeze({
  BROWSER_OPEN_FAILED: 'BROWSER_OPEN_FAILED',
  NO_LAUNCHER: 'NO_LAUNCHER',
})

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTS.has(
    String(hostname ?? '')
      .trim()
      .toLowerCase(),
  )
}

/**
 * Explicit development/test-only policy. HTTP is never allowed in a production
 * build; it is only tolerated for loopback hosts while developing or testing.
 *
 * @param {Record<string, any>} [env]
 * @returns {boolean}
 */
export function isInsecureCheckoutAllowed(env = import.meta.env) {
  const mode = env?.MODE
  return env?.DEV === true || env?.VITEST === true || mode === 'development' || mode === 'test'
}

/**
 * Validate a backend-provided checkout URL. Fails closed on anything that is not
 * a safe https URL (or an explicitly permitted loopback http URL in dev/test).
 *
 * @param {*} rawUrl
 * @param {object} [options]
 * @param {Record<string, any>} [options.env]
 * @returns {{ok: boolean, url?: string, code?: string, insecure?: boolean}}
 */
export function validateCheckoutUrl(rawUrl, { env = import.meta.env } = {}) {
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
    return { ok: false, code: CHECKOUT_URL_ERROR.MISSING }
  }

  let parsed
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    return { ok: false, code: CHECKOUT_URL_ERROR.MALFORMED }
  }

  const protocol = parsed.protocol.toLowerCase()

  if (protocol === 'https:') {
    return { ok: true, url: parsed.toString() }
  }

  if (protocol === 'http:' && isInsecureCheckoutAllowed(env) && isLoopbackHost(parsed.hostname)) {
    return { ok: true, url: parsed.toString(), insecure: true }
  }

  return {
    ok: false,
    code: protocol === 'http:' ? CHECKOUT_URL_ERROR.INSECURE : CHECKOUT_URL_ERROR.PROTOCOL,
  }
}

/**
 * Open a validated checkout URL. Native uses the Capacitor Browser plugin; web
 * uses `window.open`. A browser failure never mutates the payment — the caller
 * keeps the pending payment recoverable.
 *
 * @param {string|null|undefined} rawUrl
 * @param {object} [options]
 * @param {Window|null} [options.windowRef]
 * @param {boolean} [options.native]
 * @param {{open?: Function}} [options.browser]
 * @param {Record<string, any>} [options.env]
 * @returns {Promise<{ok: boolean, mode?: string, code?: string}>}
 */
export async function openCheckoutUrl(
  rawUrl,
  {
    windowRef = typeof window !== 'undefined' ? window : null,
    native = null,
    browser = Browser,
    env = import.meta.env,
  } = {},
) {
  const validation = validateCheckoutUrl(rawUrl, { env })
  if (!validation.ok) {
    return { ok: false, code: validation.code }
  }

  const isNative =
    native ?? (typeof Capacitor?.isNativePlatform === 'function' && Capacitor.isNativePlatform())

  if (isNative) {
    try {
      await browser.open({ url: validation.url })
      return { ok: true, mode: 'native-browser' }
    } catch {
      return { ok: false, code: CHECKOUT_LAUNCH_ERROR.BROWSER_OPEN_FAILED }
    }
  }

  if (windowRef && typeof windowRef.open === 'function') {
    windowRef.open(validation.url, '_blank', 'noopener,noreferrer')
    return { ok: true, mode: 'window-open' }
  }

  return { ok: false, code: CHECKOUT_LAUNCH_ERROR.NO_LAUNCHER }
}
