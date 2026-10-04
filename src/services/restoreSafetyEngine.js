import {
  BACKUP_VERSION,
  buildRestoreSnapshotFromBackupPayload,
  classifyCrossDeviceRestoreSafety,
  createBackupPayload,
  createBackupPayloadFromPersistence,
  validateBackupPayload,
  validatePortableSyncMetadata,
} from '@/services/backupService'

export const RESTORE_MODE = Object.freeze({
  SAME_DEVICE: 'same-device',
  CROSS_DEVICE: 'cross-device',
})

export const RESTORE_JOURNAL_PHASE = Object.freeze({
  PREPARED: 'prepared',
  APPLYING: 'applying',
  VERIFYING: 'verifying',
  COMMITTED: 'committed',
  ROLLBACK_REQUIRED: 'rollback_required',
  ROLLING_BACK: 'rolling_back',
  ROLLED_BACK: 'rolled_back',
  RECOVERY_REQUIRED: 'recovery_required',
})

export const RESTORE_RESULT_CODE = Object.freeze({
  OK: 'RESTORE_OK',
  ELIGIBLE: 'RESTORE_ELIGIBLE',
  CONFIRMATION_REQUIRED: 'RESTORE_CONFIRMATION_REQUIRED',
  PERSISTENCE_UNAVAILABLE: 'RESTORE_BLOCKED_PERSISTENCE_UNAVAILABLE',
  INVALID_SNAPSHOT: 'RESTORE_BLOCKED_INVALID_SNAPSHOT',
  UNSUPPORTED_BACKUP_VERSION: 'RESTORE_BLOCKED_UNSUPPORTED_BACKUP_VERSION',
  CROSS_DEVICE_UNSAFE: 'RESTORE_BLOCKED_CROSS_DEVICE_UNSAFE',
  PENDING_SYNC: 'RESTORE_BLOCKED_PENDING_SYNC',
  IN_FLIGHT_SYNC: 'RESTORE_BLOCKED_SYNC_IN_FLIGHT',
  P38_JOURNAL_UNRESOLVED: 'RESTORE_BLOCKED_P38_JOURNAL_UNRESOLVED',
  RESTORE_JOURNAL_UNRESOLVED: 'RESTORE_BLOCKED_RESTORE_JOURNAL_UNRESOLVED',
  SHIFT_OPEN: 'RESTORE_BLOCKED_SHIFT_OPEN',
  SAFETY_SNAPSHOT_FAILED: 'RESTORE_SAFETY_SNAPSHOT_FAILED',
  JOURNAL_WRITE_FAILED: 'RESTORE_JOURNAL_WRITE_FAILED',
  APPLY_FAILED_ROLLED_BACK: 'RESTORE_APPLY_FAILED_ROLLED_BACK',
  VERIFY_FAILED_ROLLED_BACK: 'RESTORE_VERIFY_FAILED_ROLLED_BACK',
  ROLLBACK_FAILED: 'RESTORE_RECOVERY_REQUIRED',
  REHYDRATE_FAILED: 'RESTORE_REHYDRATE_FAILED',
  RECOVERY_ABORTED_PREPARED: 'RESTORE_RECOVERY_ABORTED_PREPARED',
  RECOVERY_ROLLED_BACK: 'RESTORE_RECOVERY_ROLLED_BACK',
  RECOVERY_FINALIZED_COMMITTED: 'RESTORE_RECOVERY_FINALIZED_COMMITTED',
  NO_RECOVERY_NEEDED: 'RESTORE_NO_RECOVERY_NEEDED',
})

export const RESTORE_STAGE = Object.freeze({
  SAFETY_SNAPSHOT_CREATE: 'safety_snapshot_create',
  SAFETY_SNAPSHOT_PERSIST: 'safety_snapshot_persist',
  JOURNAL_PREPARED: 'journal_prepared',
  JOURNAL_APPLYING: 'journal_applying',
  DOMAIN_APPLY: 'domain_apply',
  IDENTITY_MAP_APPLY: 'identity_map_apply',
  SERVER_VERSIONS_APPLY: 'server_versions_apply',
  VERIFY: 'verify',
  JOURNAL_COMMITTED: 'journal_committed',
  PINIA_REHYDRATE: 'pinia_rehydrate',
  ROLLBACK_APPLY: 'rollback_apply',
})

const RESTORE_JOURNAL_VERSION = 1

let activeRestoreSafetyEngine = null

function cloneValue(value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function computeRestoreChecksum(value) {
  const text = stableStringify(value)
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 33) ^ text.charCodeAt(index)
  }
  return `djb2-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function makeOperationId() {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `restore-${random}`
}

function hasPendingLocalJournal(journal) {
  return (
    Array.isArray(journal?.entries) && journal.entries.some((entry) => entry?.status === 'pending')
  )
}

function isFinalRestorePhase(phase) {
  return [RESTORE_JOURNAL_PHASE.COMMITTED, RESTORE_JOURNAL_PHASE.ROLLED_BACK].includes(phase)
}

function isUnresolvedRestoreJournal(journal) {
  return Boolean(journal && !isFinalRestorePhase(journal.phase))
}

function canUseAdapter(adapter) {
  return (
    adapter &&
    typeof adapter.loadBusiness === 'function' &&
    typeof adapter.loadRestoreJournal === 'function' &&
    typeof adapter.saveRestoreJournal === 'function' &&
    typeof adapter.clearRestoreJournal === 'function' &&
    typeof adapter.applyRestoreSnapshotAtomic === 'function'
  )
}

async function maybeFail(failureInjection, stage, context = {}) {
  if (!failureInjection) return
  if (typeof failureInjection === 'function') {
    await failureInjection(stage, context)
    return
  }
  if (typeof failureInjection?.onStage === 'function') {
    await failureInjection.onStage(stage, context)
  }
  const failAt = failureInjection?.failAt
  if (failAt === stage || (Array.isArray(failAt) && failAt.includes(stage))) {
    throw new Error(`Injected restore failure at ${stage}.`)
  }
}

async function writeJournal(adapter, journal, phase, patch = {}) {
  const next = {
    ...journal,
    ...patch,
    phase,
    updatedAt: new Date().toISOString(),
    phaseHistory: [...(journal.phaseHistory ?? []), phase],
  }
  await adapter.saveRestoreJournal(next)
  return next
}

async function buildSafetySnapshot({ adapter, scheduler, failureInjection }) {
  await maybeFail(failureInjection, RESTORE_STAGE.SAFETY_SNAPSHOT_CREATE)
  const payload = await createBackupPayloadFromPersistence({ adapter, scheduler })
  const checksum = computeRestoreChecksum(payload)
  return { payload, checksum }
}

async function buildTargetSnapshot({ adapter, payload }) {
  const currentBusiness = await adapter.loadBusiness()
  return buildRestoreSnapshotFromBackupPayload(payload, { currentBusiness })
}

async function verifyPersistedTarget({ adapter, scheduler, payload }) {
  const target = await buildTargetSnapshot({ adapter, payload })
  if (!target.success) {
    return { ok: false, code: RESTORE_RESULT_CODE.INVALID_SNAPSHOT, error: target.error }
  }

  const persistedPayload = await createBackupPayloadFromPersistence({ adapter, scheduler })
  const expectedPayload = createBackupPayload({
    businessStore: target.snapshot.business,
    taxStore: target.snapshot.taxSettings,
    productStore: {
      products: target.snapshot.products,
      categories: target.snapshot.categories,
      stockMovements: target.snapshot.stockMovements,
    },
    cashStore: target.snapshot.cash,
    customerStore: { customers: target.snapshot.customers },
    expenseStore: { expenses: target.snapshot.expenses },
    transactionStore: { items: target.snapshot.transactions },
    syncMetadata: target.snapshot.syncMetadata ?? undefined,
  })

  const expected = validateBackupPayload(expectedPayload)
  const actual = validateBackupPayload(persistedPayload)
  if (!expected.valid) {
    return { ok: false, code: RESTORE_RESULT_CODE.INVALID_SNAPSHOT, error: expected.error }
  }
  if (!actual.valid) {
    return { ok: false, code: RESTORE_RESULT_CODE.INVALID_SNAPSHOT, error: actual.error }
  }

  const expectedData = cloneValue(expected.data)
  const actualData = cloneValue(actual.data)
  delete expectedData.business.mode
  delete actualData.business.mode

  if (stableStringify(expectedData) !== stableStringify(actualData)) {
    return {
      ok: false,
      code: RESTORE_RESULT_CODE.INVALID_SNAPSHOT,
      error: 'Persisted restore data does not match target backup.',
    }
  }

  const persistedBusiness = await adapter.loadBusiness()
  if (typeof persistedBusiness?.mode !== 'string' || persistedBusiness.mode.length === 0) {
    return {
      ok: false,
      code: RESTORE_RESULT_CODE.INVALID_SNAPSHOT,
      error: 'Persisted business mode is missing after restore.',
    }
  }

  if (payload.version === BACKUP_VERSION) {
    const expectedSync = validatePortableSyncMetadata(payload)
    const actualSync = validatePortableSyncMetadata(persistedPayload)
    if (!expectedSync.valid || !actualSync.valid) {
      return {
        ok: false,
        code: RESTORE_RESULT_CODE.INVALID_SNAPSHOT,
        error: 'Persisted portable sync metadata is invalid after restore.',
      }
    }
    if (stableStringify(expectedSync.metadata) !== stableStringify(actualSync.metadata)) {
      return {
        ok: false,
        code: RESTORE_RESULT_CODE.INVALID_SNAPSHOT,
        error: 'Persisted portable sync metadata does not match target backup.',
      }
    }
  }

  return { ok: true }
}

async function rehydratePinia({ scheduler, failureInjection }) {
  await maybeFail(failureInjection, RESTORE_STAGE.PINIA_REHYDRATE)
  if (scheduler && typeof scheduler.rehydrate === 'function') {
    await scheduler.rehydrate()
  }
}

async function rollbackFromJournal({ adapter, scheduler, journal, failureInjection }) {
  let current = await writeJournal(adapter, journal, RESTORE_JOURNAL_PHASE.ROLLING_BACK)

  try {
    await maybeFail(failureInjection, RESTORE_STAGE.ROLLBACK_APPLY)
    const safetyTarget = await buildTargetSnapshot({ adapter, payload: current.safetyPayload })
    if (!safetyTarget.success) {
      throw new Error(safetyTarget.error)
    }
    await adapter.applyRestoreSnapshotAtomic({ snapshot: safetyTarget.snapshot })
    current = await writeJournal(adapter, current, RESTORE_JOURNAL_PHASE.ROLLED_BACK)
    await rehydratePinia({ scheduler, failureInjection: null })
    await adapter.clearRestoreJournal()
    return { ok: true, code: RESTORE_RESULT_CODE.RECOVERY_ROLLED_BACK }
  } catch (error) {
    await writeJournal(adapter, current, RESTORE_JOURNAL_PHASE.RECOVERY_REQUIRED, {
      error: error instanceof Error ? error.message : String(error ?? ''),
    })
    return {
      ok: false,
      code: RESTORE_RESULT_CODE.ROLLBACK_FAILED,
      error: 'Restore rollback failed. Manual recovery is required.',
    }
  }
}

export function createRestoreSafetyEngine({ adapter = null, scheduler = null } = {}) {
  async function checkRestoreEligibility({ payload, mode = RESTORE_MODE.SAME_DEVICE } = {}) {
    if (!canUseAdapter(adapter)) {
      return {
        eligible: false,
        code: RESTORE_RESULT_CODE.PERSISTENCE_UNAVAILABLE,
        reason: 'Persistence adapter does not support crash-safe restore.',
      }
    }

    const validation = validateBackupPayload(payload)
    if (!validation.valid) {
      return {
        eligible: false,
        code:
          validation.error === 'Versi backup tidak didukung.'
            ? RESTORE_RESULT_CODE.UNSUPPORTED_BACKUP_VERSION
            : RESTORE_RESULT_CODE.INVALID_SNAPSHOT,
        reason: validation.error,
      }
    }

    if (mode === RESTORE_MODE.CROSS_DEVICE) {
      const crossDeviceSafety = classifyCrossDeviceRestoreSafety(payload)
      if (!crossDeviceSafety.safeForCrossDeviceRestore) {
        return {
          eligible: false,
          code: RESTORE_RESULT_CODE.CROSS_DEVICE_UNSAFE,
          reason: crossDeviceSafety.reason,
        }
      }
    }

    if (scheduler && typeof scheduler.flush === 'function') {
      await scheduler.flush()
    }

    const restoreJournal = await adapter.loadRestoreJournal()
    if (isUnresolvedRestoreJournal(restoreJournal)) {
      return {
        eligible: false,
        code: RESTORE_RESULT_CODE.RESTORE_JOURNAL_UNRESOLVED,
        reason: restoreJournal.phase,
      }
    }

    const queueCount =
      typeof adapter.countSyncQueueItems === 'function' ? await adapter.countSyncQueueItems() : 0
    if (queueCount > 0) {
      return {
        eligible: false,
        code: RESTORE_RESULT_CODE.PENDING_SYNC,
        reason: `${queueCount} pending sync queue item(s) would be ambiguous after replace restore.`,
      }
    }

    const inflight =
      typeof adapter.loadSyncPushInflight === 'function'
        ? await adapter.loadSyncPushInflight()
        : null
    if (inflight) {
      return {
        eligible: false,
        code: RESTORE_RESULT_CODE.IN_FLIGHT_SYNC,
        reason: 'A sync push in-flight envelope is active.',
      }
    }

    const localJournal =
      typeof adapter.loadLocalOperationJournal === 'function'
        ? await adapter.loadLocalOperationJournal()
        : null
    if (hasPendingLocalJournal(localJournal)) {
      return {
        eligible: false,
        code: RESTORE_RESULT_CODE.P38_JOURNAL_UNRESOLVED,
        reason: 'A P38 local operation journal entry is unresolved.',
      }
    }

    const shiftState =
      typeof adapter.loadShiftState === 'function' ? await adapter.loadShiftState() : null
    if (shiftState?.isOpen === true) {
      return {
        eligible: false,
        code: RESTORE_RESULT_CODE.SHIFT_OPEN,
        reason: 'An active shift is open.',
      }
    }

    return { eligible: true, code: RESTORE_RESULT_CODE.ELIGIBLE, reason: '' }
  }

  async function restore({
    payload,
    mode = RESTORE_MODE.SAME_DEVICE,
    confirmed = false,
    failureInjection = null,
  } = {}) {
    if (confirmed !== true) {
      return {
        success: false,
        code: RESTORE_RESULT_CODE.CONFIRMATION_REQUIRED,
        error: 'Explicit restore confirmation is required.',
      }
    }

    const eligibility = await checkRestoreEligibility({ payload, mode })
    if (!eligibility.eligible) {
      return {
        success: false,
        code: eligibility.code,
        error: eligibility.reason,
      }
    }

    let safety
    try {
      safety = await buildSafetySnapshot({ adapter, scheduler, failureInjection })
    } catch (error) {
      return {
        success: false,
        code: RESTORE_RESULT_CODE.SAFETY_SNAPSHOT_FAILED,
        error: error instanceof Error ? error.message : String(error ?? ''),
      }
    }

    const target = await buildTargetSnapshot({ adapter, payload })
    if (!target.success) {
      return {
        success: false,
        code: RESTORE_RESULT_CODE.INVALID_SNAPSHOT,
        error: target.error,
      }
    }

    let journal = {
      version: RESTORE_JOURNAL_VERSION,
      operationId: makeOperationId(),
      phase: RESTORE_JOURNAL_PHASE.PREPARED,
      phaseHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      mode,
      safetyPayload: safety.payload,
      safetyChecksum: safety.checksum,
      targetChecksum: computeRestoreChecksum(payload),
      targetBackupVersion: payload.version,
    }

    try {
      await maybeFail(failureInjection, RESTORE_STAGE.SAFETY_SNAPSHOT_PERSIST, { journal })
      journal = await writeJournal(adapter, journal, RESTORE_JOURNAL_PHASE.PREPARED)
      await maybeFail(failureInjection, RESTORE_STAGE.JOURNAL_PREPARED, { journal })
    } catch (error) {
      return {
        success: false,
        code: RESTORE_RESULT_CODE.JOURNAL_WRITE_FAILED,
        error: error instanceof Error ? error.message : String(error ?? ''),
      }
    }

    let destructiveApplyFinished = false

    try {
      journal = await writeJournal(adapter, journal, RESTORE_JOURNAL_PHASE.APPLYING)
      await maybeFail(failureInjection, RESTORE_STAGE.JOURNAL_APPLYING, { journal })
      await adapter.applyRestoreSnapshotAtomic({
        snapshot: target.snapshot,
        hooks: {
          afterDomainApply: () =>
            maybeFail(failureInjection, RESTORE_STAGE.DOMAIN_APPLY, { journal }),
          afterIdentityMapApply: () =>
            maybeFail(failureInjection, RESTORE_STAGE.IDENTITY_MAP_APPLY, { journal }),
          afterServerVersionsApply: () =>
            maybeFail(failureInjection, RESTORE_STAGE.SERVER_VERSIONS_APPLY, { journal }),
        },
      })
      destructiveApplyFinished = true

      journal = await writeJournal(adapter, journal, RESTORE_JOURNAL_PHASE.VERIFYING)
      await maybeFail(failureInjection, RESTORE_STAGE.VERIFY, { journal })
      const verification = await verifyPersistedTarget({ adapter, scheduler, payload })
      if (!verification.ok) {
        throw new Error(verification.error)
      }

      journal = await writeJournal(adapter, journal, RESTORE_JOURNAL_PHASE.COMMITTED)
      await maybeFail(failureInjection, RESTORE_STAGE.JOURNAL_COMMITTED, { journal })
    } catch (error) {
      const rollbackResult = await rollbackFromJournal({
        adapter,
        scheduler,
        journal: {
          ...(await adapter.loadRestoreJournal()),
          safetyPayload: safety.payload,
          safetyChecksum: safety.checksum,
        },
        failureInjection,
      })
      if (!rollbackResult.ok) {
        return {
          success: false,
          code: rollbackResult.code,
          error: rollbackResult.error,
        }
      }
      return {
        success: false,
        code: destructiveApplyFinished
          ? RESTORE_RESULT_CODE.VERIFY_FAILED_ROLLED_BACK
          : RESTORE_RESULT_CODE.APPLY_FAILED_ROLLED_BACK,
        error: error instanceof Error ? error.message : String(error ?? ''),
      }
    }

    try {
      await rehydratePinia({ scheduler, failureInjection })
      await adapter.clearRestoreJournal()
      return {
        success: true,
        code: RESTORE_RESULT_CODE.OK,
        error: '',
      }
    } catch (error) {
      return {
        success: false,
        code: RESTORE_RESULT_CODE.REHYDRATE_FAILED,
        error: error instanceof Error ? error.message : String(error ?? ''),
      }
    }
  }

  async function recoverPendingRestore({ failureInjection = null } = {}) {
    if (!canUseAdapter(adapter)) {
      return { ok: true, code: RESTORE_RESULT_CODE.NO_RECOVERY_NEEDED }
    }

    const journal = await adapter.loadRestoreJournal()
    if (!journal) {
      return { ok: true, code: RESTORE_RESULT_CODE.NO_RECOVERY_NEEDED }
    }

    if (journal.phase === RESTORE_JOURNAL_PHASE.PREPARED) {
      await adapter.clearRestoreJournal()
      return { ok: true, code: RESTORE_RESULT_CODE.RECOVERY_ABORTED_PREPARED }
    }

    if (
      journal.phase === RESTORE_JOURNAL_PHASE.COMMITTED ||
      journal.phase === RESTORE_JOURNAL_PHASE.ROLLED_BACK
    ) {
      await adapter.clearRestoreJournal()
      await rehydratePinia({ scheduler, failureInjection: null })
      return { ok: true, code: RESTORE_RESULT_CODE.RECOVERY_FINALIZED_COMMITTED }
    }

    if (
      [
        RESTORE_JOURNAL_PHASE.APPLYING,
        RESTORE_JOURNAL_PHASE.VERIFYING,
        RESTORE_JOURNAL_PHASE.ROLLBACK_REQUIRED,
        RESTORE_JOURNAL_PHASE.ROLLING_BACK,
      ].includes(journal.phase)
    ) {
      const currentChecksum = computeRestoreChecksum(journal.safetyPayload)
      if (currentChecksum !== journal.safetyChecksum) {
        await writeJournal(adapter, journal, RESTORE_JOURNAL_PHASE.RECOVERY_REQUIRED, {
          error: 'Safety snapshot checksum mismatch.',
        })
        return {
          ok: false,
          code: RESTORE_RESULT_CODE.ROLLBACK_FAILED,
          error: 'Safety snapshot checksum mismatch.',
        }
      }

      return rollbackFromJournal({ adapter, scheduler, journal, failureInjection })
    }

    return {
      ok: false,
      code: RESTORE_RESULT_CODE.ROLLBACK_FAILED,
      error: `Unknown restore journal phase: ${journal.phase}`,
    }
  }

  return {
    checkRestoreEligibility,
    restore,
    recoverPendingRestore,
  }
}

export function setActiveRestoreSafetyEngine(engine) {
  activeRestoreSafetyEngine = engine
}

export function getActiveRestoreSafetyEngine() {
  return activeRestoreSafetyEngine
}
