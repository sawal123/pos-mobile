/**
 * Secure token repository abstraction.
 *
 * Native (Android / iOS):
 * Uses @aparajita/capacitor-secure-storage which is backed by
 * Android Keystore and iOS Keychain.
 *
 * Web / Vitest / Browser:
 * Uses an in-memory fallback.
 * DILARANG menyimpan token di localStorage, sessionStorage, SQLite, app_meta, Pinia state.
 *
 * The Bearer token is never exposed to Pinia and never logged.
 */

import { Capacitor } from '@capacitor/core'

const TOKEN_KEY = 'cloud_bearer_token'

let _inMemoryToken = null
let tokenMutationTail = Promise.resolve()

function enqueueTokenOperation(operation) {
  const result = tokenMutationTail.then(operation, operation)
  tokenMutationTail = result.catch(() => {})
  return result
}

/**
 * In-memory fallback for web/Vitest environments.
 * Never touches localStorage/sessionStorage.
 */
const inMemoryStore = {
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

/**
 * Native secure store using @aparajita/capacitor-secure-storage.
 * Uses Android Keystore and iOS Keychain.
 */
const nativeStore = {
  async save(token) {
    const { SecureStorage } = await import('@aparajita/capacitor-secure-storage')
    await SecureStorage.set(TOKEN_KEY, token)
  },
  async get() {
    const { SecureStorage } = await import('@aparajita/capacitor-secure-storage')
    const value = await SecureStorage.get(TOKEN_KEY)
    return value ? String(value) : null
  },
  async remove() {
    const { SecureStorage } = await import('@aparajita/capacitor-secure-storage')
    await SecureStorage.remove(TOKEN_KEY)
  },
}

function resolveStore() {
  if (Capacitor.isNativePlatform()) {
    return nativeStore
  }

  return inMemoryStore
}

/**
 * Save Bearer token to secure credential storage.
 * @param {string} token
 */
export async function saveToken(token) {
  if (!token) return
  await enqueueTokenOperation(() => resolveStore().save(token))
}

/**
 * Get stored Bearer token.
 * @returns {Promise<string|null>}
 */
export async function getToken() {
  return enqueueTokenOperation(() => resolveStore().get())
}

/**
 * Remove stored Bearer token.
 */
export async function removeToken() {
  await enqueueTokenOperation(() => resolveStore().remove())
}

/**
 * Remove a token only when it is still the value owned by the caller.
 * The read/compare/remove sequence is serialized with all token mutations so
 * a stale operation cannot remove a newer account's token between awaits.
 */
export async function removeTokenIfMatches(expectedToken) {
  const result = await removeTokenIfMatchesDetailed(expectedToken)
  return result.ok
}

/**
 * Atomically classify an ownership-aware token removal.
 *
 * The read/compare/remove sequence is serialized with every token mutation so
 * callers can distinguish an already-absent token from a newer owner's token
 * without introducing a second read/compare/remove race.
 *
 * @returns {Promise<{ok: boolean, state: 'removed'|'missing'|'ownership_mismatch'}>}
 */
export async function removeTokenIfMatchesDetailed(expectedToken) {
  if (typeof expectedToken !== 'string' || expectedToken.length === 0) {
    return { ok: false, state: 'ownership_mismatch' }
  }

  return enqueueTokenOperation(async () => {
    const store = resolveStore()
    const currentToken = await store.get()
    if (currentToken === null || currentToken === undefined || currentToken === '') {
      return { ok: false, state: 'missing' }
    }
    if (currentToken !== expectedToken) {
      return { ok: false, state: 'ownership_mismatch' }
    }
    await store.remove()
    return { ok: true, state: 'removed' }
  })
}

/** Reset for tests */
export function _resetTokenStore() {
  _inMemoryToken = null
  tokenMutationTail = Promise.resolve()
}
