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
  await resolveStore().save(token)
}

/**
 * Get stored Bearer token.
 * @returns {Promise<string|null>}
 */
export async function getToken() {
  return resolveStore().get()
}

/**
 * Remove stored Bearer token.
 */
export async function removeToken() {
  await resolveStore().remove()
}

/** Reset for tests */
export function _resetTokenStore() {
  _inMemoryToken = null
}
