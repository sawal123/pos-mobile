const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Checks whether a value is a valid UUID string.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isUuid(value) {
  return typeof value === 'string' && UUID_REGEX.test(value.trim())
}

/**
 * Generates a standard RFC4122 v4 UUID string.
 * Uses native crypto.randomUUID() when available.
 *
 * @returns {string}
 */
export function generateUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().toLowerCase()
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Deterministic helper to construct the product sync SKU required by Laravel contract.
 * Used by both product mapper and sale item mapper.
 *
 * @param {string} syncId
 * @returns {string}
 */
export function buildProductSyncSku(syncId) {
  if (!syncId || typeof syncId !== 'string') return ''
  return `MOBILE-${syncId.trim()}`
}

/**
 * Creates a durable sync identity registry.
 * Maps non-UUID local entity identifiers (categories, legacy transactions, synthetic sale items)
 * to stable, persisted UUIDs across application restarts and logouts.
 *
 * @param {object} options
 * @param {object} [options.adapter] Database adapter providing loadSyncIdentityMap / saveSyncIdentityMap.
 * @param {object} [options.scheduler] Optional serialized task scheduler.
 */
export function createSyncIdentityRegistry({ adapter = null, scheduler = null } = {}) {
  let map = {}
  let isLoaded = false

  async function ensureLoaded() {
    if (isLoaded) return
    if (adapter && typeof adapter.loadSyncIdentityMap === 'function') {
      try {
        const stored = await adapter.loadSyncIdentityMap()
        if (stored && typeof stored === 'object') {
          map = { ...stored }
        }
      } catch (err) {
        console.error('Failed to load sync identity map from adapter.', err)
      }
    }
    isLoaded = true
  }

  async function persistMap() {
    if (!adapter || typeof adapter.saveSyncIdentityMap !== 'function') return

    const mapSnapshot = { ...map }
    const saveTask = () => adapter.saveSyncIdentityMap(mapSnapshot)

    if (scheduler && typeof scheduler.runSerialized === 'function') {
      await scheduler.runSerialized('sync_identity_map_write', saveTask)
    } else {
      await saveTask()
    }
  }

  /**
   * Resolves or generates a stable UUID for a given entity type and local key.
   *
   * Rules:
   * 1. If localKey is already a valid UUID -> returns localKey directly (no entry created).
   * 2. If localKey is not a UUID -> returns existing UUID from registry or creates and persists a new one.
   *
   * @param {string} entityType (e.g. 'category', 'product', 'customer', 'expense', 'transaction', 'sale_item')
   * @param {string|number} localKey
   * @returns {Promise<string|null>}
   */
  async function resolveSyncId(entityType, localKey) {
    if (localKey === null || localKey === undefined || localKey === '') {
      return null
    }

    const keyStr = String(localKey).trim()
    if (!keyStr) return null

    // If local ID is already a valid UUID, use it directly
    if (isUuid(keyStr)) {
      return keyStr.toLowerCase()
    }

    await ensureLoaded()

    const registryKey = `${entityType}:${keyStr}`
    if (map[registryKey]) {
      return map[registryKey]
    }

    const newUuid = generateUuid()
    map[registryKey] = newUuid
    await persistMap()

    return newUuid
  }

  /**
   * Synchronously inspects or gets a previously resolved syncId if already loaded.
   *
   * @param {string} entityType
   * @param {string|number} localKey
   * @returns {string|null}
   */
  function peekSyncId(entityType, localKey) {
    if (localKey === null || localKey === undefined || localKey === '') {
      return null
    }
    const keyStr = String(localKey).trim()
    if (isUuid(keyStr)) return keyStr.toLowerCase()
    return map[`${entityType}:${keyStr}`] ?? null
  }

  return {
    resolveSyncId,
    peekSyncId,
    ensureLoaded,
    getMap: () => ({ ...map }),
  }
}
