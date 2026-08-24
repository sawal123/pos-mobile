/**
 * Stable device identifier service.
 *
 * Generates a UUID once per installation and persists it durably in
 * app_meta table (key = 'device_identifier') so it survives:
 *   - app restarts
 *   - logout
 *   - business/outlet changes
 *
 * Rules:
 * - Never uses user ID, business ID, outlet ID, hardware serial, or IMEI
 * - Never uses localStorage
 * - Not part of P7 backup
 * - Idempotent: reading twice returns the same value
 */

export const DEVICE_IDENTIFIER_KEY = 'device_identifier'

/**
 * Generate a new UUID using crypto.randomUUID() when available,
 * with a math-random fallback for environments that don't have it.
 *
 * @returns {string}
 */
function generateUUID() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  // Fallback: RFC-4122 v4 UUID using Math.random
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Get or create the stable device identifier using the persistence adapter.
 *
 * @param {object} adapter  Adapter with loadDeviceIdentifier / saveDeviceIdentifier methods.
 *                          Falls back to readMetaValue / writeMetaValue signature.
 * @returns {Promise<string>}
 */
export async function resolveDeviceIdentifier(adapter) {
  const existing = await adapter.loadDeviceIdentifier()

  if (existing) {
    return existing
  }

  const newId = generateUUID()
  await adapter.saveDeviceIdentifier(newId)
  return newId
}
