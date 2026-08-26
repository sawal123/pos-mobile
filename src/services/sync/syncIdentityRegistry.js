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
  const isDurable = Boolean(
    adapter &&
      typeof adapter.loadSyncIdentityMap === 'function' &&
      typeof adapter.saveSyncIdentityMap === 'function',
  )

  async function ensureLoaded() {
    if (isLoaded) return
    if (adapter && typeof adapter.loadSyncIdentityMap === 'function') {
      try {
        const stored = await adapter.loadSyncIdentityMap()
        if (stored && typeof stored === 'object') {
          map = { ...stored }
        }
        isLoaded = true
      } catch (err) {
        console.error('Failed to load sync identity map from adapter.', err)
        throw err
      }
    } else {
      isLoaded = true
    }
  }

  async function persistMap() {
    if (!adapter || typeof adapter.saveSyncIdentityMap !== 'function') return

    const mapSnapshot = { ...map }
    const saveTask = () => adapter.saveSyncIdentityMap(mapSnapshot)

    if (scheduler && typeof scheduler.runSerialized === 'function') {
      await scheduler.runSerialized(saveTask, 'sync_identity_map_write')
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

    try {
      await persistMap()
    } catch (err) {
      delete map[registryKey]
      throw err
    }

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

  /**
   * Reverse resolution: finds local key from a given syncId for an entity type.
   *
   * @param {string} entityType
   * @param {string} syncId
   * @returns {Promise<string|null>}
   */
  async function findLocalKeyBySyncId(entityType, syncId) {
    if (!syncId || !isUuid(syncId)) {
      return null
    }

    await ensureLoaded()

    const normalizedSyncId = String(syncId).trim().toLowerCase()
    const prefix = `${entityType}:`

    for (const [key, val] of Object.entries(map)) {
      if (key.startsWith(prefix) && typeof val === 'string' && val.toLowerCase() === normalizedSyncId) {
        return key.slice(prefix.length)
      }
    }

    return null
  }

  /**
   * Explicitly binds a local identifier to a remote sync UUID in the registry.
   * Fails closed on duplicate / collision.
   *
   * @param {string} entityType
   * @param {string|number} localKey
   * @param {string} syncId
   * @returns {Promise<string>}
   */
  async function bindSyncId(entityType, localKey, syncId) {
    if (!syncId || !isUuid(syncId)) {
      throw new Error(`Invalid sync_id UUID: ${syncId}`)
    }
    if (localKey === null || localKey === undefined || localKey === '') {
      throw new Error(`Invalid localKey: ${localKey}`)
    }

    await ensureLoaded()

    const normalizedSyncId = String(syncId).trim().toLowerCase()
    const keyStr = String(localKey).trim()
    const registryKey = `${entityType}:${keyStr}`

    // Check if this localKey is already bound to a different syncId
    if (map[registryKey]) {
      if (map[registryKey].toLowerCase() === normalizedSyncId) {
        return normalizedSyncId
      }
      throw new Error(
        `IDENTITY_COLLISION: localKey "${keyStr}" already bound to "${map[registryKey]}", cannot rebind to "${normalizedSyncId}"`,
      )
    }

    // Check if this syncId is already bound to a different localKey of same entityType
    const prefix = `${entityType}:`
    for (const [k, v] of Object.entries(map)) {
      if (k.startsWith(prefix) && typeof v === 'string' && v.toLowerCase() === normalizedSyncId) {
        if (k !== registryKey) {
          throw new Error(
            `IDENTITY_COLLISION: syncId "${normalizedSyncId}" already bound to "${k.slice(prefix.length)}", cannot bind to "${keyStr}"`,
          )
        }
      }
    }

    map[registryKey] = normalizedSyncId

    try {
      await persistMap()
    } catch (err) {
      delete map[registryKey]
      throw err
    }

    return normalizedSyncId
  }

  /**
   * Rebinds a sync identity to a renamed local identifier (e.g. category renamed).
   *
   * @param {string} entityType
   * @param {string|number} oldLocalKey
   * @param {string|number} newLocalKey
   * @param {string} syncId
   * @returns {Promise<string>}
   */
  async function rebindSyncId(entityType, oldLocalKey, newLocalKey, syncId) {
    if (!syncId || !isUuid(syncId)) {
      throw new Error(`Invalid sync_id UUID: ${syncId}`)
    }

    await ensureLoaded()

    const normalizedSyncId = String(syncId).trim().toLowerCase()
    const oldKeyStr = String(oldLocalKey).trim()
    const newKeyStr = String(newLocalKey).trim()

    if (oldKeyStr === newKeyStr) {
      return bindSyncId(entityType, newKeyStr, normalizedSyncId)
    }

    const oldRegistryKey = `${entityType}:${oldKeyStr}`
    const newRegistryKey = `${entityType}:${newKeyStr}`

    // Check if newKey is already bound to a DIFFERENT syncId
    if (map[newRegistryKey] && map[newRegistryKey].toLowerCase() !== normalizedSyncId) {
      throw new Error(
        `IDENTITY_COLLISION: target localKey "${newKeyStr}" already bound to "${map[newRegistryKey]}"`,
      )
    }

    const prevOld = map[oldRegistryKey]
    const prevNew = map[newRegistryKey]

    delete map[oldRegistryKey]
    map[newRegistryKey] = normalizedSyncId

    try {
      await persistMap()
    } catch (err) {
      if (prevOld !== undefined) map[oldRegistryKey] = prevOld
      else delete map[oldRegistryKey]

      if (prevNew !== undefined) map[newRegistryKey] = prevNew
      else delete map[newRegistryKey]

      throw err
    }

    return normalizedSyncId
  }

  return {
    resolveSyncId,
    peekSyncId,
    findLocalKeyBySyncId,
    bindSyncId,
    rebindSyncId,
    ensureLoaded,
    getMap: () => ({ ...map }),
    isDurable,
  }
}
