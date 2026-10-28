import { Capacitor, registerPlugin } from '@capacitor/core'

const GoogleNativeAuth = registerPlugin('GoogleNativeAuth')
const GOOGLE_CLIENT_ID_PATTERN = /^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/

let initializedClientId = null
let initializePromise = null
let activeOperation = null
let operationSequence = 0

function resolvePlatform() {
  return typeof Capacitor.getPlatform === 'function' ? Capacitor.getPlatform() : 'web'
}

export function getGoogleWebClientId() {
  const configured = import.meta.env?.VITE_GOOGLE_WEB_CLIENT_ID
  return typeof configured === 'string' ? configured.trim() : ''
}

export function isValidGoogleWebClientId(clientId) {
  return typeof clientId === 'string' && GOOGLE_CLIENT_ID_PATTERN.test(clientId.trim())
}

function providerErrorCode(error) {
  return typeof error?.code === 'string' ? error.code.toUpperCase() : ''
}

function normalizeProviderError(error) {
  const code = providerErrorCode(error)
  if (code === 'USER_CANCELLED' || code === 'CANCELLED' || code === 'CANCELED') {
    return { state: 'cancelled', code: 'USER_CANCELLED' }
  }
  if (code === 'CONFIGURATION_INVALID') {
    return { state: 'not_configured', code }
  }
  if (code === 'PROVIDER_UNAVAILABLE' || code === 'NO_CREDENTIAL') {
    return { state: 'provider_unavailable', code: 'PROVIDER_UNAVAILABLE' }
  }
  if (code === 'CONCURRENT_OPERATION') {
    return { state: 'provider_error', code: 'REQUEST_IN_PROGRESS' }
  }
  if (code === 'NOT_INITIALIZED') {
    return { state: 'provider_error', code }
  }
  return { state: 'provider_error', code: code || 'PROVIDER_ERROR' }
}

async function initialize(clientId) {
  if (initializedClientId === clientId) return
  if (!initializePromise) {
    initializePromise = GoogleNativeAuth.initialize({ webClientId: clientId })
      .then(() => {
        initializedClientId = clientId
      })
      .finally(() => {
        initializePromise = null
      })
  }
  await initializePromise
}

/**
 * Acquire one fresh Google ID token from the Android Credential Manager.
 * The token is never persisted, logged, or reused by this adapter.
 */
export async function signInWithGoogle({ webClientId = getGoogleWebClientId() } = {}) {
  if (resolvePlatform() !== 'android') {
    return { ok: false, state: 'unsupported_platform', code: 'UNSUPPORTED_PLATFORM' }
  }

  const clientId = typeof webClientId === 'string' ? webClientId.trim() : ''
  if (!isValidGoogleWebClientId(clientId)) {
    return { ok: false, state: 'not_configured', code: 'CONFIGURATION_INVALID' }
  }

  if (activeOperation !== null) {
    return { ok: false, state: 'provider_error', code: 'REQUEST_IN_PROGRESS' }
  }

  const operationId = ++operationSequence
  activeOperation = operationId

  try {
    await initialize(clientId)

    let result
    try {
      result = await GoogleNativeAuth.signIn()
    } catch (error) {
      // Activity recreation can reset the native plugin while the WebView
      // survives. Reinitialize once; no assertion has been received yet.
      if (providerErrorCode(error) === 'NOT_INITIALIZED') {
        initializedClientId = null
        await initialize(clientId)
        result = await GoogleNativeAuth.signIn()
      } else {
        throw error
      }
    }

    if (activeOperation !== operationId) {
      return { ok: false, state: 'provider_error', code: 'STALE_OPERATION' }
    }

    const idToken = typeof result?.idToken === 'string' ? result.idToken.trim() : ''
    if (!idToken) {
      return { ok: false, state: 'provider_error', code: 'PROVIDER_ERROR' }
    }

    return { ok: true, state: 'success', idToken }
  } catch (error) {
    if (activeOperation !== operationId) {
      return { ok: false, state: 'provider_error', code: 'STALE_OPERATION' }
    }
    return { ok: false, ...normalizeProviderError(error) }
  } finally {
    if (activeOperation === operationId) activeOperation = null
  }
}

/** Invalidate a provider callback when the login page is left or destroyed. */
export function cancelGoogleSignIn() {
  operationSequence += 1
  activeOperation = null
}

/** Test-only reset; it does not expose or persist any credential. */
export function _resetGoogleNativeAuthForTests() {
  initializedClientId = null
  initializePromise = null
  activeOperation = null
  operationSequence = 0
}
