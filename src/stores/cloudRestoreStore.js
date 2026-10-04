import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { CLOUD_BACKUP_ERROR, downloadCloudBackup } from '@/services/cloud/cloudBackupService'
import {
  CLOUD_RESTORE_ERROR,
  verifyCloudRestorePayload,
} from '@/services/cloud/cloudRestoreService'
import { getToken } from '@/services/cloud/tokenRepository'
import {
  RESTORE_MODE,
  RESTORE_RESULT_CODE,
  getActiveRestoreSafetyEngine,
} from '@/services/restoreSafetyEngine'
import { useCloudSessionStore } from './cloudSessionStore'
import { useSubscriptionStore } from './subscriptionStore'

/**
 * PREM-M06B3 — Cloud Restore presentation + orchestration store.
 *
 * Owns only the client-side restore flow: download, integrity/schema
 * verification, mode decision and the confirmation UX. It never mutates local
 * data and never writes a restore journal or safety snapshot — the only
 * destructive path is `restoreSafetyEngine.restore()`, and durable truth stays
 * in the engine.
 *
 * The verified payload is kept in memory only (never localStorage,
 * sessionStorage or app_meta) and is released on cancel/finish.
 */

export const CLOUD_RESTORE_PHASE = Object.freeze({
  IDLE: 'idle',
  DOWNLOADING: 'downloading',
  VERIFYING: 'verifying',
  VALIDATING: 'validating',
  BLOCKED: 'blocked',
  AWAITING_CONFIRMATION: 'awaiting-confirmation',
  RESTORING: 'restoring',
  ROLLING_BACK: 'rolling-back',
  SUCCESS: 'success',
  RECOVERY_REQUIRED: 'recovery-required',
  ERROR: 'error',
})

export const CLOUD_RESTORE_CONFIRMATION_MESSAGE =
  'Restore akan mengganti data POS lokal pada perangkat ini dengan data dari backup Cloud yang dipilih.'

export const CLOUD_RESTORE_CROSS_DEVICE_WARNING = 'Backup ini dibuat dari perangkat lain.'

export const CLOUD_RESTORE_MESSAGES = Object.freeze({
  offline: 'Koneksi internet diperlukan untuk Restore Cloud.',
  tooLarge: 'Ukuran backup melebihi batas Cloud 25 MB.',
  entitlementDenied: 'Restore Cloud memerlukan langganan Premium yang aktif.',
  deviceError: 'Perangkat Cloud perlu diaktifkan kembali.',
  sessionError: 'Sesi Cloud tidak valid. Silakan masuk kembali.',
  serverError: 'Restore Cloud gagal. Coba lagi.',
  backupNotFound: 'Backup tidak ditemukan. Perbarui daftar backup.',
  fileMissing: 'Snapshot backup tidak tersedia di server.',
  checksum: 'Backup tidak lolos verifikasi integritas.',
  schema: 'Versi backup tidak kompatibel dengan aplikasi ini.',
  payload: 'Isi backup tidak valid.',
  crossDevice: 'Backup lintas perangkat ini tidak aman untuk dipulihkan.',
  blocked: 'Restore belum dapat dijalankan.',
  rollback: 'Restore gagal, tetapi data lokal telah dikembalikan.',
  recovery:
    'Restore memerlukan pemulihan. Aplikasi memblokir transaksi baru hingga pemulihan selesai.',
  success: 'Data POS berhasil dipulihkan dari backup Cloud.',
  engineUnavailable: 'Mesin restore aman belum siap. Tutup dan buka kembali aplikasi.',
})

/** Human-readable, machine-keyed reasons for a blocked eligibility preflight. */
const ELIGIBILITY_REASONS = Object.freeze({
  [RESTORE_RESULT_CODE.PENDING_SYNC]: 'Masih ada antrean sinkronisasi yang belum terkirim.',
  [RESTORE_RESULT_CODE.IN_FLIGHT_SYNC]: 'Sedang ada sinkronisasi yang berjalan.',
  [RESTORE_RESULT_CODE.P38_JOURNAL_UNRESOLVED]: 'Ada operasi lokal (P38) yang belum selesai.',
  [RESTORE_RESULT_CODE.RESTORE_JOURNAL_UNRESOLVED]:
    'Ada proses restore sebelumnya yang belum selesai.',
  [RESTORE_RESULT_CODE.PERSISTENCE_UNAVAILABLE]: 'Penyimpanan lokal belum siap untuk restore aman.',
  [RESTORE_RESULT_CODE.CROSS_DEVICE_UNSAFE]: 'Backup lintas perangkat ini tidak aman.',
  [RESTORE_RESULT_CODE.SHIFT_OPEN]: 'Tutup shift aktif sebelum melakukan restore.',
  [RESTORE_RESULT_CODE.UNSUPPORTED_BACKUP_VERSION]: 'Versi backup tidak didukung.',
  [RESTORE_RESULT_CODE.INVALID_SNAPSHOT]: 'Isi backup tidak valid.',
})

function verificationMessage(code) {
  switch (code) {
    case CLOUD_RESTORE_ERROR.CHECKSUM_HEADER_MISSING:
    case CLOUD_RESTORE_ERROR.CHECKSUM_INVALID:
    case CLOUD_RESTORE_ERROR.CHECKSUM_MISMATCH:
      return CLOUD_RESTORE_MESSAGES.checksum
    case CLOUD_RESTORE_ERROR.SCHEMA_MISMATCH:
    case CLOUD_RESTORE_ERROR.SCHEMA_UNSUPPORTED:
      return CLOUD_RESTORE_MESSAGES.schema
    case CLOUD_RESTORE_ERROR.CROSS_DEVICE_UNSAFE:
      return CLOUD_RESTORE_MESSAGES.crossDevice
    case CLOUD_RESTORE_ERROR.DOWNLOAD_TOO_LARGE:
      return CLOUD_RESTORE_MESSAGES.tooLarge
    case CLOUD_RESTORE_ERROR.PAYLOAD_INVALID:
      return CLOUD_RESTORE_MESSAGES.payload
    default:
      return CLOUD_RESTORE_MESSAGES.serverError
  }
}

export const useCloudRestoreStore = defineStore('cloudRestore', () => {
  // ── State ──────────────────────────────────────────────────────────────────
  const selectedBackup = ref(null)
  const restorePhase = ref(CLOUD_RESTORE_PHASE.IDLE)
  const restoreError = ref(null)
  const restoreErrorCode = ref(null)
  const restoreReason = ref(null)
  const downloadedMetadata = ref(null)
  const restoreMode = ref(null)
  const eligibility = ref(null)
  /** True while a verified payload is held in memory awaiting confirmation. */
  const hasPayload = ref(false)

  // Verified payload lives outside reactivity and is never persisted.
  let _payload = null
  let _runtime = null
  let _engine = null
  // Synchronous guards: reserve before the first await so a double tap can
  // never start a second download or a second destructive invocation.
  let _active = false
  let _confirming = false

  const cloudStore = useCloudSessionStore()
  const subscriptionStore = useSubscriptionStore()

  // ── Computed ───────────────────────────────────────────────────────────────
  /** Client-side UX gate. The backend stays authoritative. */
  const canUseCloudRestore = computed(
    () =>
      cloudStore.isAuthenticated === true &&
      cloudStore.isLinked === true &&
      cloudStore.capabilityState === 'verified' &&
      cloudStore.hasCloudAccess === true &&
      subscriptionStore.isPremium === true,
  )

  const isCloudRestoreLocked = computed(() => canUseCloudRestore.value !== true)

  const isBusy = computed(() =>
    [
      CLOUD_RESTORE_PHASE.DOWNLOADING,
      CLOUD_RESTORE_PHASE.VERIFYING,
      CLOUD_RESTORE_PHASE.VALIDATING,
      CLOUD_RESTORE_PHASE.RESTORING,
    ].includes(restorePhase.value),
  )

  const awaitingConfirmation = computed(
    () => restorePhase.value === CLOUD_RESTORE_PHASE.AWAITING_CONFIRMATION,
  )

  const isCrossDevice = computed(() => restoreMode.value === RESTORE_MODE.CROSS_DEVICE)

  const canConfirm = computed(() => awaitingConfirmation.value && hasPayload.value === true)

  const isTerminal = computed(() =>
    [
      CLOUD_RESTORE_PHASE.SUCCESS,
      CLOUD_RESTORE_PHASE.ROLLING_BACK,
      CLOUD_RESTORE_PHASE.RECOVERY_REQUIRED,
      CLOUD_RESTORE_PHASE.ERROR,
      CLOUD_RESTORE_PHASE.BLOCKED,
    ].includes(restorePhase.value),
  )

  // ── Helpers ────────────────────────────────────────────────────────────────
  function init({ runtimeSignalService = null, engine = null } = {}) {
    _runtime = runtimeSignalService ?? _runtime
    _engine = engine ?? _engine
  }

  function resolveEngine() {
    return _engine ?? getActiveRestoreSafetyEngine()
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

  function setError(code, message, reason = null) {
    restoreErrorCode.value = code ?? null
    restoreError.value = message ?? null
    restoreReason.value = reason ?? null
  }

  function clearError() {
    restoreErrorCode.value = null
    restoreError.value = null
    restoreReason.value = null
  }

  function releasePayload() {
    _payload = null
    hasPayload.value = false
  }

  /** Select a backup for restore, discarding any previous uncommitted flow. */
  function selectBackup(backup) {
    selectedBackup.value = backup ?? null
    downloadedMetadata.value = null
    eligibility.value = null
    restoreMode.value = null
    releasePayload()
    clearError()
    restorePhase.value = CLOUD_RESTORE_PHASE.IDLE
  }

  async function handleDownloadError(result) {
    switch (result?.code) {
      case CLOUD_BACKUP_ERROR.NETWORK_ERROR:
        restorePhase.value = CLOUD_RESTORE_PHASE.ERROR
        setError(result.code, CLOUD_RESTORE_MESSAGES.offline)
        return
      case CLOUD_BACKUP_ERROR.UNAUTHENTICATED:
        restorePhase.value = CLOUD_RESTORE_PHASE.ERROR
        setError(result.code, CLOUD_RESTORE_MESSAGES.sessionError)
        // M03: invalidate the Cloud session only — never local POS data.
        await cloudStore.invalidateCloudSession()
        return
      case CLOUD_BACKUP_ERROR.CLOUD_SUBSCRIPTION_REQUIRED:
        restorePhase.value = CLOUD_RESTORE_PHASE.BLOCKED
        setError(result.code, CLOUD_RESTORE_MESSAGES.entitlementDenied)
        await cloudStore.refreshContext()
        return
      case CLOUD_BACKUP_ERROR.DEVICE_NOT_FOUND:
      case CLOUD_BACKUP_ERROR.DEVICE_INACTIVE:
        restorePhase.value = CLOUD_RESTORE_PHASE.BLOCKED
        setError(result.code, CLOUD_RESTORE_MESSAGES.deviceError)
        return
      case CLOUD_BACKUP_ERROR.BACKUP_NOT_FOUND:
        restorePhase.value = CLOUD_RESTORE_PHASE.BLOCKED
        setError(result.code, CLOUD_RESTORE_MESSAGES.backupNotFound, result.code)
        return
      case CLOUD_BACKUP_ERROR.BACKUP_FILE_MISSING:
        restorePhase.value = CLOUD_RESTORE_PHASE.BLOCKED
        setError(result.code, CLOUD_RESTORE_MESSAGES.fileMissing, result.code)
        return
      case CLOUD_RESTORE_ERROR.DOWNLOAD_TOO_LARGE:
        restorePhase.value = CLOUD_RESTORE_PHASE.ERROR
        setError(result.code, CLOUD_RESTORE_MESSAGES.tooLarge)
        return
      default:
        restorePhase.value = CLOUD_RESTORE_PHASE.ERROR
        setError(result?.code ?? 'REQUEST_FAILED', CLOUD_RESTORE_MESSAGES.serverError)
    }
  }

  function handleVerificationError(result) {
    restorePhase.value = CLOUD_RESTORE_PHASE.BLOCKED
    setError(result.code, verificationMessage(result.code), result.reason ?? null)
  }

  /**
   * Download → verify → validate → eligibility preflight → confirmation.
   * No mutation happens anywhere in this action.
   */
  async function startRestore({ backup = null } = {}) {
    if (_active) return { ok: false, code: 'RESTORE_IN_FLIGHT' }
    _active = true

    try {
      if (backup !== null) selectBackup(backup)

      const target = selectedBackup.value
      if (!target || typeof target.uuid !== 'string' || target.uuid.trim().length === 0) {
        restorePhase.value = CLOUD_RESTORE_PHASE.ERROR
        setError('NO_BACKUP', CLOUD_RESTORE_MESSAGES.backupNotFound)
        return { ok: false, code: 'NO_BACKUP' }
      }

      if (!canUseCloudRestore.value) {
        restorePhase.value = CLOUD_RESTORE_PHASE.BLOCKED
        setError('NOT_ELIGIBLE', CLOUD_RESTORE_MESSAGES.entitlementDenied)
        return { ok: false, code: 'NOT_ELIGIBLE' }
      }

      const businessId = cloudStore.selectedBusiness?.id ?? null
      if (businessId === null) {
        restorePhase.value = CLOUD_RESTORE_PHASE.BLOCKED
        setError('NOT_LINKED', CLOUD_RESTORE_MESSAGES.entitlementDenied)
        return { ok: false, code: 'NOT_LINKED' }
      }

      if (!isOnline()) {
        restorePhase.value = CLOUD_RESTORE_PHASE.ERROR
        setError(CLOUD_BACKUP_ERROR.NETWORK_ERROR, CLOUD_RESTORE_MESSAGES.offline)
        return { ok: false, code: CLOUD_BACKUP_ERROR.NETWORK_ERROR }
      }

      const token = await safeToken()
      if (!token) {
        restorePhase.value = CLOUD_RESTORE_PHASE.ERROR
        setError(CLOUD_BACKUP_ERROR.UNAUTHENTICATED, CLOUD_RESTORE_MESSAGES.sessionError)
        await cloudStore.invalidateCloudSession()
        return { ok: false, code: CLOUD_BACKUP_ERROR.UNAUTHENTICATED }
      }

      restorePhase.value = CLOUD_RESTORE_PHASE.DOWNLOADING
      const download = await downloadCloudBackup({
        token,
        businessId,
        backupUuid: target.uuid,
      })

      if (!download.ok) {
        await handleDownloadError(download)
        return { ok: false, code: download.code }
      }

      // A relink mid-download must never send the old tenant's backup forward.
      if ((cloudStore.selectedBusiness?.id ?? null) !== businessId) {
        clear()
        restorePhase.value = CLOUD_RESTORE_PHASE.ERROR
        setError('BUSINESS_SCOPE_CHANGED', CLOUD_RESTORE_MESSAGES.sessionError)
        return { ok: false, code: 'BUSINESS_SCOPE_CHANGED' }
      }

      restorePhase.value = CLOUD_RESTORE_PHASE.VERIFYING
      const verified = await verifyCloudRestorePayload({
        bytes: download.bytes,
        text: download.text,
        headers: download.headers,
        metadata: target,
        deviceIdentifier: cloudStore.deviceIdentifier,
      })

      if (!verified.ok) {
        handleVerificationError(verified)
        return { ok: false, code: verified.code }
      }

      restorePhase.value = CLOUD_RESTORE_PHASE.VALIDATING
      restoreMode.value = verified.mode

      const engine = resolveEngine()
      if (!engine) {
        restorePhase.value = CLOUD_RESTORE_PHASE.ERROR
        setError('ENGINE_UNAVAILABLE', CLOUD_RESTORE_MESSAGES.engineUnavailable)
        return { ok: false, code: 'ENGINE_UNAVAILABLE' }
      }

      // Non-destructive preflight — never downloads again, never mutates.
      const preflight = await engine.checkRestoreEligibility({
        payload: verified.payload,
        mode: verified.mode,
      })
      eligibility.value = preflight

      if (!preflight?.eligible) {
        restorePhase.value = CLOUD_RESTORE_PHASE.BLOCKED
        setError(
          preflight?.code ?? 'ELIGIBILITY_BLOCKED',
          ELIGIBILITY_REASONS[preflight?.code] ?? CLOUD_RESTORE_MESSAGES.blocked,
          preflight?.reason ?? null,
        )
        return { ok: false, code: preflight?.code ?? 'ELIGIBILITY_BLOCKED' }
      }

      _payload = verified.payload
      hasPayload.value = true
      downloadedMetadata.value = {
        uuid: target.uuid,
        createdAt: target.createdAt ?? null,
        origin: target.device ?? null,
        sizeBytes: verified.sizeBytes,
        schemaVersion: verified.schemaVersion,
        checksumSha256: verified.checksumSha256,
        mode: verified.mode,
      }
      clearError()
      restorePhase.value = CLOUD_RESTORE_PHASE.AWAITING_CONFIRMATION

      return { ok: true, mode: verified.mode }
    } finally {
      _active = false
    }
  }

  /**
   * The single destructive invocation. Guarded so a double confirm can never
   * call `restoreSafetyEngine.restore()` twice.
   */
  async function confirmRestore() {
    if (_confirming) return { ok: false, code: 'RESTORE_IN_FLIGHT' }
    if (restorePhase.value !== CLOUD_RESTORE_PHASE.AWAITING_CONFIRMATION || _payload === null) {
      return { ok: false, code: 'NOT_AWAITING_CONFIRMATION' }
    }

    _confirming = true
    restorePhase.value = CLOUD_RESTORE_PHASE.RESTORING

    try {
      const engine = resolveEngine()
      if (!engine) {
        releasePayload()
        restorePhase.value = CLOUD_RESTORE_PHASE.ERROR
        setError('ENGINE_UNAVAILABLE', CLOUD_RESTORE_MESSAGES.engineUnavailable)
        return { ok: false, code: 'ENGINE_UNAVAILABLE' }
      }

      const payload = _payload
      const mode = restoreMode.value ?? RESTORE_MODE.SAME_DEVICE
      const result = await engine.restore({ payload, mode, confirmed: true })

      releasePayload()

      if (result?.success === true) {
        clearError()
        restorePhase.value = CLOUD_RESTORE_PHASE.SUCCESS
        return { ok: true, result }
      }

      if (result?.code === RESTORE_RESULT_CODE.ROLLBACK_FAILED) {
        setError(result.code, CLOUD_RESTORE_MESSAGES.recovery, result.code)
        restorePhase.value = CLOUD_RESTORE_PHASE.RECOVERY_REQUIRED
      } else if (
        result?.code === RESTORE_RESULT_CODE.APPLY_FAILED_ROLLED_BACK ||
        result?.code === RESTORE_RESULT_CODE.VERIFY_FAILED_ROLLED_BACK
      ) {
        setError(result.code, CLOUD_RESTORE_MESSAGES.rollback, result.code)
        restorePhase.value = CLOUD_RESTORE_PHASE.ROLLING_BACK
      } else {
        setError(
          result?.code ?? 'RESTORE_FAILED',
          result?.error || CLOUD_RESTORE_MESSAGES.serverError,
          result?.code ?? null,
        )
        restorePhase.value = CLOUD_RESTORE_PHASE.ERROR
      }

      return { ok: false, code: result?.code, result }
    } finally {
      _confirming = false
    }
  }

  /** Cancel before confirmation: no mutation, no journal, no safety snapshot. */
  function cancelRestore() {
    if (restorePhase.value === CLOUD_RESTORE_PHASE.RESTORING) {
      return { ok: false, code: 'RESTORE_IN_PROGRESS' }
    }

    releasePayload()
    downloadedMetadata.value = null
    eligibility.value = null
    restoreMode.value = null
    clearError()
    restorePhase.value = CLOUD_RESTORE_PHASE.IDLE
    return { ok: true }
  }

  /** Discard every uncommitted Cloud Restore UI state. */
  function reset() {
    releasePayload()
    selectedBackup.value = null
    downloadedMetadata.value = null
    eligibility.value = null
    restoreMode.value = null
    clearError()
    restorePhase.value = CLOUD_RESTORE_PHASE.IDLE
    _active = false
    _confirming = false
  }

  /**
   * Clear restore UI state on business relink / Cloud disconnect. An already
   * destructive engine restore is left to durable engine recovery — its
   * journal and safety snapshot are never touched here.
   */
  function clear() {
    if (restorePhase.value === CLOUD_RESTORE_PHASE.RESTORING) return

    releasePayload()
    selectedBackup.value = null
    downloadedMetadata.value = null
    eligibility.value = null
    restoreMode.value = null
    clearError()
    restorePhase.value = CLOUD_RESTORE_PHASE.IDLE
    _active = false
  }

  return {
    // state
    selectedBackup,
    restorePhase,
    restoreError,
    restoreErrorCode,
    restoreReason,
    downloadedMetadata,
    restoreMode,
    eligibility,
    hasPayload,
    // computed
    canUseCloudRestore,
    isCloudRestoreLocked,
    isBusy,
    awaitingConfirmation,
    isCrossDevice,
    canConfirm,
    isTerminal,
    // copy
    confirmationMessage: CLOUD_RESTORE_CONFIRMATION_MESSAGE,
    crossDeviceWarning: CLOUD_RESTORE_CROSS_DEVICE_WARNING,
    // actions
    init,
    selectBackup,
    startRestore,
    confirmRestore,
    cancelRestore,
    reset,
    clear,
  }
})
