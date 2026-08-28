export const AUTO_SYNC_TRIGGER_ONLINE = 'online'
export const AUTO_SYNC_TRIGGER_RESUME = 'resume'
export const AUTO_SYNC_TRIGGERS = Object.freeze([
  AUTO_SYNC_TRIGGER_ONLINE,
  AUTO_SYNC_TRIGGER_RESUME,
])

export const AUTO_SYNC_COOLDOWN_MS = 30_000

const KNOWN_UNSAFE_HEALTH_CODES = Object.freeze(
  new Set([
    'SYNC_OPEN_CONFLICT',
    'SYNC_PUSH_INFLIGHT',
    'SYNC_BOOTSTRAP_NOT_PREPARED',
    'SYNC_BOOTSTRAP_STAGED',
    'SYNC_PUSH_BINDING_MISMATCH',
    'SYNC_PULL_BINDING_MISMATCH',
    'SYNC_INFLIGHT_CONTEXT_MISMATCH',
    'SYNC_BOOTSTRAP_CONTEXT_MISMATCH',
    'SYNC_HEALTH_METADATA_INVALID',
  ]),
)

function isPlainObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val)
}

function isValidDateString(val) {
  if (typeof val !== 'string' || !val.trim()) return false
  const time = new Date(val).getTime()
  return Number.isFinite(time)
}

/**
 * Normalizes and strictly validates Cloud Context for Auto Sync.
 * Returns null if context is incomplete or unauthorized.
 */
export function extractValidAutoSyncContext(context) {
  if (!isPlainObject(context)) return null

  if (context.cloudAccess !== true) return null
  if (
    !context.user ||
    typeof context.user !== 'object' ||
    Array.isArray(context.user) ||
    context.user.id == null ||
    !String(context.user.id).trim()
  ) {
    return null
  }

  const businessId =
    context.businessId ??
    (context.selectedBusiness && isPlainObject(context.selectedBusiness)
      ? context.selectedBusiness.id
      : null)
  const outletId =
    context.outletId ??
    (context.selectedOutlet && isPlainObject(context.selectedOutlet)
      ? context.selectedOutlet.id
      : null)
  const registeredDeviceId = context.registeredDeviceId ?? null
  const deviceIdentifier = context.deviceIdentifier ?? null

  if (
    typeof businessId !== 'number' ||
    !Number.isInteger(businessId) ||
    businessId <= 0
  ) {
    return null
  }

  if (
    typeof outletId !== 'number' ||
    !Number.isInteger(outletId) ||
    outletId <= 0
  ) {
    return null
  }

  if (
    typeof registeredDeviceId !== 'number' ||
    !Number.isInteger(registeredDeviceId) ||
    registeredDeviceId <= 0
  ) {
    return null
  }

  if (
    typeof deviceIdentifier !== 'string' ||
    !deviceIdentifier.trim() ||
    deviceIdentifier.length > 128
  ) {
    return null
  }

  return {
    userId: context.user.id,
    businessId,
    outletId,
    deviceIdentifier: deviceIdentifier.trim(),
    registeredDeviceId,
  }
}

function isValidNormalizedContext(ctx) {
  if (!isPlainObject(ctx)) return false
  const keys = Object.keys(ctx)
  const allowed = new Set(['businessId', 'outletId', 'deviceIdentifier', 'registeredDeviceId'])
  for (const k of keys) {
    if (!allowed.has(k)) return false
  }
  return (
    typeof ctx.businessId === 'number' &&
    Number.isInteger(ctx.businessId) &&
    ctx.businessId > 0 &&
    typeof ctx.outletId === 'number' &&
    Number.isInteger(ctx.outletId) &&
    ctx.outletId > 0 &&
    typeof ctx.registeredDeviceId === 'number' &&
    Number.isInteger(ctx.registeredDeviceId) &&
    ctx.registeredDeviceId > 0 &&
    typeof ctx.deviceIdentifier === 'string' &&
    ctx.deviceIdentifier.trim().length > 0 &&
    ctx.deviceIdentifier.length <= 128
  )
}

function isValidStoredSettings(settings) {
  if (!isPlainObject(settings)) return false

  const keys = Object.keys(settings)
  const allowed = new Set(['version', 'enabled', 'context', 'updatedAt'])
  for (const k of keys) {
    if (!allowed.has(k)) return false
  }

  if (settings.version !== 1) return false
  if (typeof settings.enabled !== 'boolean') return false
  if (!isValidDateString(settings.updatedAt)) return false

  if (settings.enabled === true) {
    if (settings.context === null || !isValidNormalizedContext(settings.context)) {
      return false
    }
  } else {
    if (settings.context !== null && !isValidNormalizedContext(settings.context)) {
      return false
    }
  }

  return true
}

/**
 * Creates the P20 Safe Foreground Auto Sync Service.
 */
export function createSyncAutoSyncService({
  adapter,
  healthService,
  orchestratorService,
  activityLogService,
  now = () => Date.now(),
} = {}) {
  let isRunning = false
  let isPreferenceUpdating = false
  let lastAttemptAt = null

  async function readDurableSettings() {
    if (adapter && typeof adapter.loadSyncAutoSettings === 'function') {
      return await adapter.loadSyncAutoSettings()
    }
    if (adapter && typeof adapter.readMetaValue === 'function') {
      return await adapter.readMetaValue('sync_auto_settings_v1', null)
    }
    return null
  }

  async function writeDurableSettings(settings) {
    if (adapter && typeof adapter.saveSyncAutoSettings === 'function') {
      return await adapter.saveSyncAutoSettings(settings)
    }
    if (adapter && typeof adapter.writeMetaValue === 'function') {
      return await adapter.writeMetaValue('sync_auto_settings_v1', settings)
    }
    throw new Error('Persistence adapter tidak mendukung penyimpanan sync auto settings.')
  }

  /**
   * Loads and validates the durable Auto Sync preference.
   *
   * @param {object} [options]
   * @param {object} [options.context] Current cloud context to match against
   * @returns {Promise<object>}
   */
  async function loadPreference({ context } = {}) {
    let raw
    try {
      raw = await readDurableSettings()
    } catch {
      return {
        ok: false,
        code: 'AUTO_SYNC_SETTINGS_INVALID',
        enabled: false,
        contextMatches: false,
      }
    }

    if (raw === null || raw === undefined) {
      return {
        ok: true,
        enabled: false,
        contextMatches: false,
        preference: null,
      }
    }

    if (!isValidStoredSettings(raw)) {
      return {
        ok: false,
        code: 'AUTO_SYNC_SETTINGS_INVALID',
        enabled: false,
        contextMatches: false,
      }
    }

    const currentNormalized = context ? extractValidAutoSyncContext(context) : null
    let contextMatches = false

    if (currentNormalized && raw.context) {
      contextMatches =
        raw.context.businessId === currentNormalized.businessId &&
        raw.context.outletId === currentNormalized.outletId &&
        raw.context.deviceIdentifier === currentNormalized.deviceIdentifier &&
        raw.context.registeredDeviceId === currentNormalized.registeredDeviceId
    }

    return {
      ok: true,
      enabled: Boolean(raw.enabled),
      contextMatches,
      preference: raw,
    }
  }

  /**
   * Sets and persists the Auto Sync enabled preference for the current context.
   *
   * @param {object} options
   * @param {object} options.context Current cloud context
   * @param {boolean} options.enabled Whether Auto Sync is enabled
   * @returns {Promise<object>}
   */
  async function setEnabled({ context, enabled } = {}) {
    if (typeof enabled !== 'boolean') {
      return {
        ok: false,
        code: 'AUTO_SYNC_INVALID_PARAM',
        message: 'Parameter enabled harus bernilai boolean.',
      }
    }

    if (isPreferenceUpdating) {
      return {
        ok: false,
        code: 'AUTO_SYNC_PREFERENCE_BUSY',
        message: 'Pengaturan auto sync sedang diperbarui.',
      }
    }

    let normalized = null
    if (enabled) {
      normalized = extractValidAutoSyncContext(context)
      if (!normalized) {
        return {
          ok: false,
          code: 'AUTO_SYNC_CONTEXT_UNAVAILABLE',
          message: 'Konteks cloud tidak lengkap untuk mengaktifkan sinkronisasi otomatis.',
        }
      }
    } else {
      normalized = context ? extractValidAutoSyncContext(context) : null
    }

    const boundContext = normalized
      ? {
          businessId: normalized.businessId,
          outletId: normalized.outletId,
          deviceIdentifier: normalized.deviceIdentifier,
          registeredDeviceId: normalized.registeredDeviceId,
        }
      : null

    const payload = {
      version: 1,
      enabled,
      context: boundContext,
      updatedAt: new Date(now()).toISOString(),
    }

    isPreferenceUpdating = true
    try {
      await writeDurableSettings(payload)
      return {
        ok: true,
        code: enabled ? 'AUTO_SYNC_ENABLED' : 'AUTO_SYNC_DISABLED',
        enabled,
        preference: payload,
      }
    } catch (err) {
      return {
        ok: false,
        code: 'AUTO_SYNC_PERSIST_FAILED',
        message: err.message || 'Gagal menyimpan pengaturan auto sync.',
      }
    } finally {
      isPreferenceUpdating = false
    }
  }

  /**
   * Runs a single foreground Auto Sync operation if all preconditions & safety checks pass.
   *
   * @param {object} options
   * @param {object} options.context Current cloud context snapshot
   * @param {string} options.trigger Trigger type ('online' | 'resume')
   * @param {boolean} options.online Whether connection is online (strictly requires true)
   * @param {boolean} options.isForeground Whether app is currently visible/active in foreground (strictly requires true)
   * @returns {Promise<object>}
   */
  async function runOnce({
    context,
    trigger,
    online,
    isForeground,
  } = {}) {
    // 1. Preference mutation lock check
    if (isPreferenceUpdating) {
      return {
        ok: false,
        code: 'AUTO_SYNC_PREFERENCE_BUSY',
        message: 'Pengaturan auto sync sedang diperbarui.',
      }
    }

    // 2. Validate trigger
    if (!AUTO_SYNC_TRIGGERS.includes(trigger)) {
      return {
        ok: false,
        code: 'AUTO_SYNC_INVALID_TRIGGER',
        message: `Trigger '${trigger}' tidak valid untuk auto sync.`,
      }
    }

    // 3. Foreground check (must be explicitly true)
    if (isForeground !== true) {
      return {
        ok: false,
        code: 'AUTO_SYNC_NOT_FOREGROUND',
        message: 'Auto sync hanya berjalan di foreground.',
      }
    }

    // 4. Online check (must be explicitly true)
    if (online !== true) {
      return {
        ok: false,
        code: 'AUTO_SYNC_OFFLINE',
        message: 'Koneksi internet sedang offline.',
      }
    }

    // 5. Validate Cloud Context
    const normalizedContext = extractValidAutoSyncContext(context)
    if (!normalizedContext) {
      return {
        ok: false,
        code: 'AUTO_SYNC_CONTEXT_UNAVAILABLE',
        message: 'Konteks cloud tidak tersedia atau tidak lengkap.',
      }
    }

    // 6. Build strictly sanitized safe execution context (no tokens, credentials, or extra fields)
    const safeContext = {
      user: {
        id: normalizedContext.userId,
      },
      selectedBusiness: {
        id: normalizedContext.businessId,
      },
      selectedOutlet: {
        id: normalizedContext.outletId,
      },
      cloudAccess: true,
      deviceIdentifier: normalizedContext.deviceIdentifier,
      registeredDeviceId: normalizedContext.registeredDeviceId,
    }

    // 7. Check durable preference
    const prefRes = await loadPreference({ context: safeContext })
    if (!prefRes.ok) {
      return {
        ok: false,
        code: 'AUTO_SYNC_SETTINGS_INVALID',
        message: 'Pengaturan auto sync rusak.',
      }
    }

    if (!prefRes.enabled) {
      return {
        ok: false,
        code: 'AUTO_SYNC_DISABLED',
        message: 'Auto sync tidak aktif.',
      }
    }

    if (!prefRes.contextMatches) {
      return {
        ok: false,
        code: 'AUTO_SYNC_CONTEXT_MISMATCH',
        message: 'Pengaturan auto sync terikat pada outlet/perangkat berbeda.',
      }
    }

    // 8. Check single-run lock
    if (isRunning) {
      return {
        ok: false,
        code: 'AUTO_SYNC_ALREADY_IN_PROGRESS',
        message: 'Auto sync sedang berjalan.',
      }
    }

    // 9. Check cooldown (safe with first run when lastAttemptAt is null, safe with clock regression)
    const currentTime = now()
    if (
      lastAttemptAt !== null &&
      (currentTime < lastAttemptAt || currentTime - lastAttemptAt < AUTO_SYNC_COOLDOWN_MS)
    ) {
      return {
        ok: false,
        code: 'AUTO_SYNC_COOLDOWN',
        message: 'Auto sync masih dalam masa jeda (cooldown).',
      }
    }

    // 10. Start execution lock & cooldown
    lastAttemptAt = currentTime
    isRunning = true
    const startedAt = new Date(currentTime).toISOString()

    try {
      // 11. Fresh P17 Health Check
      if (!healthService || typeof healthService.checkHealth !== 'function') {
        return {
          ok: false,
          code: 'AUTO_SYNC_HEALTH_CHECK_FAILED',
          message: 'Health service tidak tersedia.',
        }
      }

      let healthRes
      try {
        healthRes = await healthService.checkHealth({ context: safeContext })
      } catch (err) {
        return {
          ok: false,
          code: 'AUTO_SYNC_HEALTH_CHECK_FAILED',
          message: err.message || 'Pemeriksaan kesehatan sinkronisasi gagal.',
        }
      }

      // Fail-closed validation on health response structure
      if (!healthRes || healthRes.ok !== true || !Array.isArray(healthRes.issues)) {
        return {
          ok: false,
          code: 'AUTO_SYNC_HEALTH_CHECK_FAILED',
          message: healthRes?.message || 'Pemeriksaan kesehatan sinkronisasi gagal atau bentuk respons tidak valid.',
        }
      }

      const issues = healthRes.issues

      // 1. Any blocked severity issue always blocks
      if (issues.some((issue) => issue && issue.severity === 'blocked')) {
        return {
          ok: false,
          code: 'AUTO_SYNC_UNSAFE_HEALTH',
          message: 'Kondisi sinkronisasi terblokir.',
          health: healthRes,
        }
      }

      // 2. Known unsafe issue codes always block regardless of health.status
      if (issues.some((issue) => issue && KNOWN_UNSAFE_HEALTH_CODES.has(issue.code))) {
        return {
          ok: false,
          code: 'AUTO_SYNC_UNSAFE_HEALTH',
          message: 'Kondisi sinkronisasi tidak aman untuk auto sync.',
          health: healthRes,
        }
      }

      // 3. Exact Code ↔ Status Contract Checks:
      let isSafeToSync = false
      if (healthRes.status === 'ready') {
        if (healthRes.code !== 'SYNC_HEALTH_READY') {
          return {
            ok: false,
            code: 'AUTO_SYNC_HEALTH_CHECK_FAILED',
            message: 'Respons health check tidak konsisten.',
            health: healthRes,
          }
        }
        if (issues.length === 0) {
          isSafeToSync = true
        }
      } else if (healthRes.status === 'attention') {
        if (healthRes.code !== 'SYNC_HEALTH_ATTENTION') {
          return {
            ok: false,
            code: 'AUTO_SYNC_HEALTH_CHECK_FAILED',
            message: 'Respons health check tidak konsisten.',
            health: healthRes,
          }
        }
        if (
          issues.length > 0 &&
          issues.every(
            (issue) =>
              issue &&
              issue.code === 'SYNC_PENDING_QUEUE' &&
              issue.severity === 'attention',
          )
        ) {
          isSafeToSync = true
        }
      } else {
        return {
          ok: false,
          code: 'AUTO_SYNC_HEALTH_CHECK_FAILED',
          message: 'Status health check tidak dikenali.',
          health: healthRes,
        }
      }

      if (!isSafeToSync) {
        return {
          ok: false,
          code: 'AUTO_SYNC_UNSAFE_HEALTH',
          message: 'Kondisi sinkronisasi membutuhkan tindakan manual atau terblokir.',
          health: healthRes,
        }
      }

      // 12. Execute P16 orchestratorService.syncAll exactly once with safeContext
      if (!orchestratorService || typeof orchestratorService.syncAll !== 'function') {
        return {
          ok: false,
          code: 'AUTO_SYNC_ORCHESTRATOR_UNAVAILABLE',
          message: 'Orchestrator service tidak tersedia.',
        }
      }

      let syncResult
      try {
        syncResult = await orchestratorService.syncAll({ context: safeContext })
      } catch (err) {
        syncResult = {
          ok: false,
          code: 'NETWORK_ERROR',
          message: err.message || 'Sinkronisasi gagal.',
        }
      }

      // 13. Record P19 Activity Log (non-blocking)
      const finishedAt = new Date(now()).toISOString()
      if (activityLogService && typeof activityLogService.record === 'function') {
        let status = 'failed'
        if (syncResult.ok) {
          status = 'success'
        } else if (syncResult.code === 'SYNC_MORE_PUSH_PENDING') {
          status = 'attention'
        } else if (
          [
            'SYNC_CONFLICT',
            'SYNC_CONFLICT_PENDING',
            'SYNC_PUSH_BLOCKED_PENDING',
            'LOCAL_PENDING_SYNC_CONFLICT',
            'PRECONDITION_FAILED',
            'SYNC_BUSINESS_BINDING_MISMATCH',
            'SYNC_BOOTSTRAP_CONTEXT_MISMATCH',
            'SYNC_ENVELOPE_CONTEXT_MISMATCH',
            'SYNC_BOOTSTRAP_REQUIRED',
          ].includes(syncResult.code)
        ) {
          status = 'blocked'
        } else {
          status = 'failed'
        }

        try {
          await activityLogService.record({
            type: 'full_sync',
            action: 'AUTO_SYNC',
            status,
            code: syncResult.code || (syncResult.ok ? 'SYNC_ALL_COMPLETED' : 'SYNC_ALL_FAILED'),
            startedAt,
            finishedAt,
            businessId: normalizedContext.businessId,
            outletId: normalizedContext.outletId,
            deviceIdentifier: normalizedContext.deviceIdentifier,
            registeredDeviceId: normalizedContext.registeredDeviceId,
            summary: {
              pushed: syncResult.push?.removedQueueIds?.length ?? (typeof syncResult.pushed === 'number' ? syncResult.pushed : 0),
              pulled: syncResult.pull?.applied ?? (typeof syncResult.pulled === 'number' ? syncResult.pulled : 0),
              stage: typeof syncResult.stage === 'string' ? syncResult.stage : null,
              trigger,
            },
          })
        } catch {
          // Non-blocking
        }
      }

      return {
        ...syncResult,
        autoSync: true,
        trigger,
      }
    } finally {
      isRunning = false
    }
  }

  return {
    loadPreference,
    setEnabled,
    runOnce,
    getIsRunning: () => isRunning,
    getIsPreferenceUpdating: () => isPreferenceUpdating,
    getLastAttemptAt: () => lastAttemptAt,
  }
}
