/**
 * Secure token repository abstraction.
 *
 * On native (Capacitor) → uses @capacitor/preferences which stores values
 * in Android SharedPreferences (encrypted) and iOS Keychain.
 * On web/test → uses an in-memory map (NOT localStorage).
 *
 * The store never passes through Pinia and the raw token value is never logged.
 */

const TOKEN_KEY = 'cloud_bearer_token'

let _inMemoryToken = null

/**
 * In-memory fallback for web/Vitest environments.
 * Never touches localStorage/sessionStorage.
 */
function createInMemoryTokenStore() {
  return {
    async save(token) {
      _inMemoryToken = token
    },
    async get() {
      return _inMemoryToken
    },
    async remove() {
      _inMemoryToken = null
    },
  }
}

/**
 * Native secure store using @capacitor/preferences.
 */
function createNativeTokenStore() {
  return {
    async save(token) {
      const { Preferences } = await import('@capacitor/preferences')
      await Preferences.set({ key: TOKEN_KEY, value: token })
    },
    async get() {
      const { Preferences } = await import('@capacitor/preferences')
      const { value } = await Preferences.get({ key: TOKEN_KEY })
      return value ?? null
    },
    async remove() {
      const { Preferences } = await import('@capacitor/preferences')
      await Preferences.remove({ key: TOKEN_KEY })
    },
  }
}

let _store = null

function resolveStore() {
  if (_store) return _store

  // Capacitor.isNativePlatform() is the canonical check; guard for Vitest env
  try {
    const { Capacitor } = globalThis.__CAPACITOR__ ?? {}
    if (Capacitor?.isNativePlatform?.()) {
      _store = createNativeTokenStore()
      return _store
    }
  } catch {
    // not available
  }

  // Check via import if we are in a real Capacitor context
  _store = createInMemoryTokenStore()
  return _store
}

/**
 * Initialise the store. Call once at bootstrap so Capacitor.isNativePlatform()
 * is evaluated after the Capacitor runtime is ready.
 *
 * @param {{ isNative?: boolean }} [options]
 */
export function initTokenStore({ isNative = false } = {}) {
  if (isNative) {
    _store = createNativeTokenStore()
  } else {
    _store = createInMemoryTokenStore()
  }
}

/** Reset for tests */
export function _resetTokenStore() {
  _store = null
  _inMemoryToken = null
}

/**
 * @param {string} token
 */
export async function saveToken(token) {
  await resolveStore().save(token)
}

/**
 * @returns {Promise<string|null>}
 */
export async function getToken() {
  return resolveStore().get()
}

/**
 * Remove the stored Bearer token.
 */
export async function removeToken() {
  await resolveStore().remove()
}
