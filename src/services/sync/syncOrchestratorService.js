/**
 * Creates a P16 Manual Full Sync Orchestrator Service.
 * Coordinates manual push of local outbox mutations followed by cloud pull.
 *
 * Sequence:
 * 1. Push local mutations (pushNow)
 * 2. If push produces error or conflict -> STOP (do not pull)
 * 3. Check open conflicts in conflictService -> If any, STOP (SYNC_CONFLICT_PENDING)
 * 4. Validate remaining -> If invalid, STOP (SYNC_INVALID_PUSH_RESULT)
 * 5. If blocked entries exist and remaining > 0 -> STOP (SYNC_PUSH_BLOCKED_PENDING)
 * 6. If remaining > 0 -> STOP (SYNC_MORE_PUSH_PENDING)
 * 7. Pull cloud changes (pullNow)
 *
 * @param {object} options
 * @param {object} options.pushService SyncPushService instance
 * @param {object} options.pullService SyncPullService instance
 * @param {object} [options.conflictService] SyncConflictService instance
 * @returns {object}
 */
export function createSyncOrchestratorService({
  pushService,
  pullService,
  conflictService = null,
} = {}) {
  let isSyncing = false

  /**
   * Executes a single manual full sync iteration (Push then Pull).
   *
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async function syncAll(options = {}) {
    if (isSyncing) {
      return {
        ok: false,
        code: 'SYNC_ALREADY_IN_PROGRESS',
        message: 'A full sync operation is already in progress.',
        stage: 'init',
        push: null,
        pull: null,
        error: {
          code: 'SYNC_ALREADY_IN_PROGRESS',
          message: 'A full sync operation is already in progress.',
        },
      }
    }

    if (!pushService || typeof pushService.pushNow !== 'function') {
      return {
        ok: false,
        code: 'PUSH_SERVICE_MISSING',
        message: 'Sync push service is not configured.',
        stage: 'init',
        push: null,
        pull: null,
      }
    }

    if (!pullService || typeof pullService.pullNow !== 'function') {
      return {
        ok: false,
        code: 'PULL_SERVICE_MISSING',
        message: 'Sync pull service is not configured.',
        stage: 'init',
        push: null,
        pull: null,
      }
    }

    isSyncing = true

    try {
      // ── Step 1: Execute Push (wrapped for unexpected exceptions) ───────────
      let pushResult
      try {
        pushResult = await pushService.pushNow(options)
      } catch (err) {
        return {
          ok: false,
          code: 'SYNC_PUSH_EXCEPTION',
          stage: 'push',
          message: err instanceof Error ? err.message : String(err),
          push: null,
          pull: null,
          error: {
            code: 'SYNC_PUSH_EXCEPTION',
            message: err instanceof Error ? err.message : String(err),
          },
        }
      }

      // ── Step 2: Evaluate Push Result ─────────────────────────────────────
      if (!pushResult || !pushResult.ok) {
        // Push produced error or conflict -> STOP, DO NOT PULL
        return {
          ok: false,
          code: pushResult?.code ?? 'SYNC_PUSH_FAILED',
          stage: 'push',
          message:
            pushResult?.message ??
            pushResult?.error?.message ??
            'Sinkronisasi push data lokal gagal.',
          push: pushResult ?? null,
          pull: null,
          error: pushResult?.error ?? null,
        }
      }

      // ── Step 3: Check Open Conflicts ─────────────────────────────────────
      if (conflictService && typeof conflictService.countOpenConflicts === 'function') {
        let openConflictCount = 0
        try {
          openConflictCount = await conflictService.countOpenConflicts()
        } catch (err) {
          return {
            ok: false,
            code: 'SYNC_CONFLICT_STATE_READ_FAILED',
            stage: 'push',
            message: 'Gagal memeriksa status konflik sinkronisasi.',
            push: pushResult,
            pull: null,
            error: {
              code: 'SYNC_CONFLICT_STATE_READ_FAILED',
              message: err instanceof Error ? err.message : String(err),
            },
          }
        }

        if (openConflictCount > 0) {
          return {
            ok: false,
            code: 'SYNC_CONFLICT_PENDING',
            stage: 'push',
            message: 'Ada konflik sinkronisasi yang harus diselesaikan terlebih dahulu.',
            push: pushResult,
            pull: null,
            openConflictCount,
          }
        }
      }

      // ── Step 4: Validate remaining Fail Closed ────────────────────────────
      const isRemainingValid =
        pushResult.remaining !== null &&
        pushResult.remaining !== undefined &&
        pushResult.remaining !== '' &&
        Number.isInteger(Number(pushResult.remaining)) &&
        Number(pushResult.remaining) >= 0

      if (!isRemainingValid) {
        return {
          ok: false,
          code: 'SYNC_INVALID_PUSH_RESULT',
          stage: 'push',
          message: 'Hasil push tidak valid.',
          push: pushResult,
          pull: null,
        }
      }

      const remaining = Number(pushResult.remaining)

      // ── Step 5: Check Blocked Pending ────────────────────────────────────
      // INT-02: role-restricted and dependency-deferred rows are durable and
      // visible, but they must not stop a pull: pulling can supply a missing
      // dependency (for example an owner-created product) and keeps the local
      // dataset converging without ever dropping data.
      const restrictedEntries = Array.isArray(pushResult.restricted) ? pushResult.restricted : []
      const deferredEntries = Array.isArray(pushResult.deferred) ? pushResult.deferred : []
      const hasUnsendablePending = restrictedEntries.length > 0 || deferredEntries.length > 0

      if (
        remaining > 0 &&
        Array.isArray(pushResult.blocked) &&
        pushResult.blocked.length > 0
      ) {
        return {
          ok: false,
          code: 'SYNC_PUSH_BLOCKED_PENDING',
          stage: 'push',
          message: 'Ada data lokal yang belum dapat disinkronkan dan perlu diperiksa.',
          push: pushResult,
          pull: null,
          blocked: pushResult.blocked,
          restricted: restrictedEntries,
          deferred: deferredEntries,
          remaining,
        }
      }

      // ── Step 6: Check Normal More Pending ────────────────────────────────
      if (remaining > 0 && !hasUnsendablePending) {
        return {
          ok: false,
          code: 'SYNC_MORE_PUSH_PENDING',
          stage: 'push',
          message: 'Masih ada data lokal yang menunggu dikirim. Tekan Sinkronkan Semua kembali.',
          push: pushResult,
          pull: null,
          remaining,
        }
      }

      // ── Step 7: Execute Pull (only when push is completely clean) ─────────
      let pullResult
      try {
        pullResult = await pullService.pullNow(options)
      } catch (err) {
        return {
          ok: false,
          code: 'SYNC_PULL_EXCEPTION',
          stage: 'pull',
          message: err instanceof Error ? err.message : String(err),
          push: pushResult,
          pull: null,
          error: {
            code: 'SYNC_PULL_EXCEPTION',
            message: err instanceof Error ? err.message : String(err),
          },
        }
      }

      if (!pullResult || !pullResult.ok) {
        return {
          ok: false,
          code: pullResult?.code ?? 'SYNC_PULL_FAILED',
          stage: 'pull',
          message:
            pullResult?.message ??
            pullResult?.error?.message ??
            'Gagal menarik data cloud.',
          push: pushResult,
          pull: pullResult ?? null,
          error: pullResult?.error ?? null,
        }
      }

      // ── Step 8: Both Push & Pull Completed Successfully ───────────────────
      return {
        ok: true,
        code: hasUnsendablePending ? 'SYNC_ALL_COMPLETED_WITH_RESTRICTED' : 'SYNC_ALL_COMPLETED',
        stage: 'completed',
        message: hasUnsendablePending
          ? 'Sinkronisasi selesai, namun sebagian data belum dapat dikirim karena izin peran atau dependensi.'
          : 'Sinkronisasi selesai.',
        restricted: restrictedEntries,
        deferred: deferredEntries,
        partial: hasUnsendablePending,
        push: pushResult,
        pull: pullResult,
      }
    } finally {
      isSyncing = false
    }
  }

  return {
    syncAll,
    isSyncing: () => isSyncing,
    pushService,
    pullService,
    conflictService,
  }
}
