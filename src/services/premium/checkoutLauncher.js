/**
 * PREM-M04 — Midtrans handoff launcher.
 *
 * The backend owns the payment page: checkout returns a Midtrans `redirect_url`
 * (or `snap_token`). The client only opens that URL — it never holds the
 * Midtrans server key and never calls a privileged Midtrans API.
 *
 * If `@capacitor/browser` is installed it is used (dynamic, optional import);
 * otherwise the platform `window.open` is used. The import is marked
 * `@vite-ignore` so a deployment without the plugin still builds.
 */

import { Capacitor } from '@capacitor/core'

async function tryNativeBrowser(url) {
  try {
    const isNative =
      typeof Capacitor?.isNativePlatform === 'function' && Capacitor.isNativePlatform()
    if (!isNative) return false

    const specifier = '@capacitor/browser'
    const mod = await import(/* @vite-ignore */ specifier)
    const Browser = mod?.Browser ?? mod?.default
    if (Browser && typeof Browser.open === 'function') {
      await Browser.open({ url })
      return true
    }
  } catch {
    // Plugin not installed – fall through to the web launcher
  }

  return false
}

/**
 * @param {string|null|undefined} url
 * @param {object} [options]
 * @param {Window|null} [options.windowRef]
 * @param {boolean} [options.native]
 * @returns {Promise<{ok: boolean, mode?: string, code?: string}>}
 */
export async function openCheckoutUrl(
  url,
  { windowRef = typeof window !== 'undefined' ? window : null, native = null } = {},
) {
  const target = typeof url === 'string' ? url.trim() : ''
  if (target.length === 0) {
    return { ok: false, code: 'INVALID_URL' }
  }

  const shouldTryNative =
    native ?? (typeof Capacitor?.isNativePlatform === 'function' && Capacitor.isNativePlatform())

  if (shouldTryNative && (await tryNativeBrowser(target))) {
    return { ok: true, mode: 'native-browser' }
  }

  if (windowRef && typeof windowRef.open === 'function') {
    windowRef.open(target, '_blank', 'noopener,noreferrer')
    return { ok: true, mode: 'window-open' }
  }

  return { ok: false, code: 'NO_LAUNCHER' }
}
