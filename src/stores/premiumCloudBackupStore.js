import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { getToken } from '@/services/cloud/tokenRepository'
import { createIdempotencyKey } from '@/services/premium/idempotency'
import {
  CLOUD_BACKUP_ERROR,
  createCloudBackup,
  listCloudBackups,
} from '@/services/cloud/cloudBackupService'
import {
  MAX_CLOUD_BACKUP_BYTES,
  computeSha256Hex,
  getUtf8ByteLength,
  serializeCloudBackupPayload,
} from '@/services/cloud/cloudBackupPayload'
import { useCloudSessionStore } from './cloudSessionStore'
import { useSubscriptionStore } from './subscriptionStore'

/**
 * PREM-M06A — Cloud Backup store.
 *
 * Owns only the client-side Cloud Backup *presentation*: the current upload
 * attempt, its status, the backup list and its loading state. It never owns
 * auth, entitlement, device identity or local POS data — those are read from
 * the existing stores. The backend (PREM-D03) is authoritative.
 *
 * Retry semantics: one attempt = one canonical payload + checksum + size +
 * idempotency key. A retry of the same attempt always reuses them. The attempt
 * is kept in memory only for the current session; the payload may contain
 * sensitive POS data, so it is deliberately NOT persisted (documented limit).
 */

export const CLOUD_BACKUP_PHASE = Object.freeze({
  IDLE: 'idle',
  PREPARING: 'preparing',
  HASHING: 'hashing',
  UPLOADING: 'uploading',
  SUCCESS: 'success',
  NETWORK_ERROR: 'network-error',
  ENTITLEMENT_DENIED: 'entitlement-denied',
  DEVICE_ERROR: 'device-error',
  PAYLOAD_TOO_LARGE: 'payload-too-large',
  SERVER_ERROR: 'server-error',
  SESSION_ERROR: 'session-error',
})

export const CLOUD_BACKUP_MESSAGES = Object.freeze({
  offline: 'Koneksi internet diperlukan untuk Backup Cloud.',
  tooLarge: 'Ukuran backup melebihi batas Cloud 25 MB.',
  entitlementDenied: 'Backup Cloud memerlukan langganan Premium yang aktif.',
  deviceError: 'Perangkat Cloud perlu diaktifkan kembali.',
  sessionError: 'Sesi Cloud tidak valid. Silakan masuk kembali.',
  serverError: 'Backup Cloud gagal diunggah. Coba lagi.',
  listStale: 'Daftar backup belum diperbarui.',
})

const IN_FLIGHT_CODES = Object.freeze({
  PREPARE: 'IN_FLIGHT',
  UPLOAD: 'UPLOAD_IN_FLIGHT',
  LIST: 'LIST_IN_FLIGHT',
})

export const usePremiumCloudBackupStore = defineStore('premiumCloudBackup', () => {
  // ── State ──────────────────────────────────────────────────────────────────
  const phase = ref(CLOUD_BACKUP_PHASE.IDLE)
  /** In-flight attempt: canonical payload + checksum + size + idempotency key. */
  const attempt = ref(null)
  /** Authoritative metadata returned by the server for the last upload. */
  const lastResult = ref(null)
  const error = ref(null)
  const errorCode = ref(null)
  const inFlight = ref(false)

  /** Current-session backup list (server ordered, newest first). */
  const backups = ref([])
  const listLoading = ref(false)
  const listError = ref(null)
  /** True when the last refresh failed but a cached list is still shown. */
  const listStale = ref(false)
  const lastCheckedAt = ref(null)

  let _runtime = null
  // Synchronous guards — reserved before the first await so a double tap can
  // never start a second serialization or a second POST.
  let _active = false
  let _uploading = false

  // ── Computed ───────────────────────────────────────────────────────────────
  const cloudStore = useCloudSessionStore()
  const subscriptionStore = useSubscriptionStore()

  const isBusy = computed(() =>
    [
      CLOUD_BACKUP_PHASE.PREPARING,
      CLOUD_BACKUP_PHASE.HASHING,
      CLOUD_BACKUP_PHASE.UPLOADING,
    ].includes(phase.value),
  )

  /** Client-side UX gate. The backend stays authoritative. */
  const canUseCloudBackup = computed(
    () =>
      cloudStore.isAuthenticated === true &&
      cloudStore.isLinked === true &&
      cloudStore.capabilityState === 'verified' &&
      cloudStore.hasCloudAccess === true &&
      subscriptionStore.isPremium === true,
  )

  const isCloudBackupLocked = computed(() => canUseCloudBackup.value !== true)

  const hasAttempt = computed(() => attempt.value !== null)

  const canRetry = computed(
    () =>
      attempt.value !== null &&
      [
        CLOUD_BACKUP_PHASE.NETWORK_ERROR,
        CLOUD_BACKUP_PHASE.SERVER_ERROR,
        CLOUD_BACKUP_PHASE.ENTITLEMENT_DENIED,
        CLOUD_BACKUP_PHASE.DEVICE_ERROR,
      ].includes(phase.value),
  )

  // ── Helpers ────────────────────────────────────────────────────────────────
  function init({ runtimeSignalService = null } = {}) {
    _runtime = runtimeSignalService ?? null
  }

  function isOnline() {
    if (!_runtime || typeof _runtime.getSnapshot !== 'function') return true
    return _runtime.getSnapshot()?.online === true
  }

  async function safeToken() {
    try {
      return await getToken()
    } catch {
      return null
    }
  }

  function setError(code, message) {
    errorCode.value = code
    error.value = message
  }

  function clearAttempt() {
    attempt.value = null
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  /**
   * Serialize the snapshot ONCE and derive the exact payload string, UTF-8 byte
   * length and SHA-256 checksum for a new attempt.
   *
   * @param {object} params
   * @param {object} params.snapshot existing local backup payload object
   * @param {string|null} [params.appVersion]
   * @returns {Promise<{ok: boolean, attempt?: object, code?: string}>}
   */
  async function createAttempt({ snapshot, appVersion = null } = {}) {
    const businessId = cloudStore.selectedBusiness?.id ?? null
    const deviceIdentifier =
      typeof cloudStore.deviceIdentifier === 'string' ? cloudStore.deviceIdentifier.trim() : ''

    if (businessId === null) return { ok: false, code: 'NO_BUSINESS' }
    if (deviceIdentifier.length === 0) return { ok: false, code: 'NO_DEVICE_IDENTIFIER' }

    const schemaVersion = Number(snapshot?.version)
    if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
      return { ok: false, code: 'INVALID_SNAPSHOT' }
    }

    error.value = null
    errorCode.value = null
    phase.value = CLOUD_BACKUP_PHASE.PREPARING

    // One canonical serialization for the whole attempt.
    const payload = serializeCloudBackupPayload(snapshot)
    const sizeBytes = getUtf8ByteLength(payload)

    // Client preflight only — the server re-validates and stays authoritative.
    if (sizeBytes > MAX_CLOUD_BACKUP_BYTES) {
      clearAttempt()
      phase.value = CLOUD_BACKUP_PHASE.PAYLOAD_TOO_LARGE
      setError(CLOUD_BACKUP_ERROR.BACKUP_TOO_LARGE, CLOUD_BACKUP_MESSAGES.tooLarge)
      return { ok: false, code: CLOUD_BACKUP_ERROR.BACKUP_TOO_LARGE }
    }

    phase.value = CLOUD_BACKUP_PHASE.HASHING
    const checksumSha256 = await computeSha256Hex(payload)

    attempt.value = {
      idempotencyKey: createIdempotencyKey('backup'),
      businessId,
      deviceIdentifier,
      schemaVersion,
      appVersion: typeof appVersion === 'string' ? appVersion : null,
      payload,
      checksumSha256,
      sizeBytes,
      createdAt: new Date().toISOString(),
    }
    phase.value = CLOUD_BACKUP_PHASE.IDLE

    return { ok: true, attempt: attempt.value }
  }

  /**
   * Upload the current attempt. Reuses the exact payload/checksum/size/key — it
   * never rebuilds the snapshot from live POS state.
   *
   * @returns {Promise<{ok: boolean, backup?: object, code?: string}>}
   */
  async function uploadCurrentAttempt() {
    if (_uploading) return { ok: false, code: IN_FLIGHT_CODES.UPLOAD }
    if (attempt.value === null) return { ok: false, code: 'NO_ATTEMPT' }

    const currentBusinessId = cloudStore.selectedBusiness?.id ?? null
    if (currentBusinessId !== attempt.value.businessId) {
      // Business relinked mid-attempt: never leak the old tenant's snapshot.
      clearAttempt()
      phase.value = CLOUD_BACKUP_PHASE.IDLE
      setError('BUSINESS_SCOPE_CHANGED', CLOUD_BACKUP_MESSAGES.sessionError)
      return { ok: false, code: 'BUSINESS_SCOPE_CHANGED' }
    }

    _uploading = true

    try {
      if (!isOnline()) {
        phase.value = CLOUD_BACKUP_PHASE.NETWORK_ERROR
        setError(CLOUD_BACKUP_ERROR.NETWORK_ERROR, CLOUD_BACKUP_MESSAGES.offline)
        return { ok: false, code: CLOUD_BACKUP_ERROR.NETWORK_ERROR }
      }

      phase.value = CLOUD_BACKUP_PHASE.UPLOADING
      const token = await safeToken()

      if (!token) {
        phase.value = CLOUD_BACKUP_PHASE.SESSION_ERROR
        setError(CLOUD_BACKUP_ERROR.UNAUTHENTICATED, CLOUD_BACKUP_MESSAGES.sessionError)
        await cloudStore.invalidateCloudSession()
        return { ok: false, code: CLOUD_BACKUP_ERROR.UNAUTHENTICATED }
      }

      const result = await createCloudBackup({
        token,
        businessId: attempt.value.businessId,
        deviceIdentifier: attempt.value.deviceIdentifier,
        schemaVersion: attempt.value.schemaVersion,
        appVersion: attempt.value.appVersion,
        payload: attempt.value.payload,
        checksumSha256: attempt.value.checksumSha256,
        sizeBytes: attempt.value.sizeBytes,
        idempotencyKey: attempt.value.idempotencyKey,
      })

      if (!result.ok) {
        return await handleUploadError(result)
      }

      lastResult.value = result.backup
      phase.value = CLOUD_BACKUP_PHASE.SUCCESS
      error.value = null
      errorCode.value = null
      clearAttempt()

      // Best-effort, guarded — a list failure never invalidates the success.
      await refreshList()

      return { ok: true, backup: result.backup }
    } finally {
      _uploading = false
    }
  }

  async function handleUploadError(result) {
    switch (result.code) {
      case CLOUD_BACKUP_ERROR.UNAUTHENTICATED:
        phase.value = CLOUD_BACKUP_PHASE.SESSION_ERROR
        setError(result.code, CLOUD_BACKUP_MESSAGES.sessionError)
        await cloudStore.invalidateCloudSession()
        break
      case CLOUD_BACKUP_ERROR.CLOUD_SUBSCRIPTION_REQUIRED:
        phase.value = CLOUD_BACKUP_PHASE.ENTITLEMENT_DENIED
        setError(result.code, CLOUD_BACKUP_MESSAGES.entitlementDenied)
        // Refresh the authoritative context so the UI reflects the real state.
        await cloudStore.refreshContext()
        break
      case CLOUD_BACKUP_ERROR.DEVICE_NOT_FOUND:
      case CLOUD_BACKUP_ERROR.DEVICE_INACTIVE:
        phase.value = CLOUD_BACKUP_PHASE.DEVICE_ERROR
        setError(result.code, CLOUD_BACKUP_MESSAGES.deviceError)
        break
      case CLOUD_BACKUP_ERROR.BACKUP_TOO_LARGE:
        phase.value = CLOUD_BACKUP_PHASE.PAYLOAD_TOO_LARGE
        setError(result.code, CLOUD_BACKUP_MESSAGES.tooLarge)
        break
      case CLOUD_BACKUP_ERROR.NETWORK_ERROR:
        phase.value = CLOUD_BACKUP_PHASE.NETWORK_ERROR
        setError(result.code, CLOUD_BACKUP_MESSAGES.offline)
        break
      default:
        // Size/checksum mismatch, storage failure, malformed response, 4xx/5xx.
        phase.value = CLOUD_BACKUP_PHASE.SERVER_ERROR
        setError(result.code, CLOUD_BACKUP_MESSAGES.serverError)
        break
    }

    return { ok: false, code: result.code }
  }

  /**
   * Start a brand-new Cloud Backup: build a fresh attempt, then upload it.
   * The synchronous guard makes a double tap produce exactly one POST.
   *
   * @param {object} params
   * @param {object} params.snapshot
   * @param {string|null} [params.appVersion]
   * @returns {Promise<{ok: boolean, backup?: object, code?: string}>}
   */
  async function startBackup({ snapshot, appVersion = null } = {}) {
    if (_active) return { ok: false, code: IN_FLIGHT_CODES.PREPARE }
    _active = true

    try {
      if (!canUseCloudBackup.value) {
        return { ok: false, code: 'NOT_ELIGIBLE' }
      }
      if (snapshot === null || typeof snapshot !== 'object') {
        return { ok: false, code: 'NO_SNAPSHOT' }
      }

      const created = await createAttempt({ snapshot, appVersion })
      if (!created.ok) return created

      return await uploadCurrentAttempt()
    } finally {
      _active = false
    }
  }

  /** Retry the current attempt (same payload/checksum/size/key). */
  async function retry() {
    if (_active) return { ok: false, code: IN_FLIGHT_CODES.PREPARE }
    if (attempt.value === null) return { ok: false, code: 'NO_ATTEMPT' }

    _active = true
    try {
      return await uploadCurrentAttempt()
    } finally {
      _active = false
    }
  }

  /**
   * Refresh the Cloud backup list. Concurrent refreshes are guarded; a network
   * failure preserves the cached list and marks it stale.
   *
   * @param {object} [options]
   * @param {number} [options.limit]
   * @returns {Promise<{ok: boolean, backups?: object[], code?: string}>}
   */
  async function refreshList({ limit = 10 } = {}) {
    if (listLoading.value) return { ok: false, code: IN_FLIGHT_CODES.LIST }

    const businessId = cloudStore.selectedBusiness?.id ?? null
    if (businessId === null || cloudStore.isAuthenticated !== true) {
      return { ok: false, code: 'NOT_ELIGIBLE' }
    }

    listLoading.value = true

    try {
      const token = await safeToken()
      if (!token) {
        listStale.value = backups.value.length > 0
        return { ok: false, code: CLOUD_BACKUP_ERROR.UNAUTHENTICATED }
      }

      const result = await listCloudBackups({ token, businessId, limit })
      lastCheckedAt.value = new Date().toISOString()

      if (!result.ok) {
        // Keep the current-session cache; only flag it as not refreshed.
        listStale.value = backups.value.length > 0
        listError.value = CLOUD_BACKUP_MESSAGES.listStale

        if (result.code === CLOUD_BACKUP_ERROR.UNAUTHENTICATED) {
          await cloudStore.invalidateCloudSession()
        } else if (result.code === CLOUD_BACKUP_ERROR.CLOUD_SUBSCRIPTION_REQUIRED) {
          await cloudStore.refreshContext()
        }

        return { ok: false, code: result.code }
      }

      backups.value = result.backups
      listError.value = null
      listStale.value = false

      return { ok: true, backups: result.backups }
    } finally {
      listLoading.value = false
    }
  }

  /** Discard the in-flight attempt, e.g. when the user asks for a new backup. */
  function resetAttempt() {
    clearAttempt()
    phase.value = CLOUD_BACKUP_PHASE.IDLE
    error.value = null
    errorCode.value = null
  }

  /**
   * Clear every piece of Cloud Backup state. Used when the Cloud session is
   * disconnected or the linked business changes — local POS data is untouched.
   */
  function clear() {
    clearAttempt()
    lastResult.value = null
    backups.value = []
    listLoading.value = false
    listError.value = null
    listStale.value = false
    lastCheckedAt.value = null
    phase.value = CLOUD_BACKUP_PHASE.IDLE
    error.value = null
    errorCode.value = null
    _active = false
    _uploading = false
  }

  return {
    // state
    phase,
    attempt,
    lastResult,
    error,
    errorCode,
    inFlight,
    backups,
    listLoading,
    listError,
    listStale,
    lastCheckedAt,
    // computed
    isBusy,
    canUseCloudBackup,
    isCloudBackupLocked,
    hasAttempt,
    canRetry,
    // actions
    init,
    createAttempt,
    uploadCurrentAttempt,
    startBackup,
    retry,
    refreshList,
    resetAttempt,
    clear,
  }
})
