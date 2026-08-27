/**
 * Creates a P16 Manual Full Sync Orchestrator Service.
 * Coordinates manual push of local outbox mutations followed by cloud pull.
 *
 * Sequence:
 * 1. Push local mutations (pushNow)
 * 2. If push is clean & completed (remaining === 0) -> Pull cloud changes (pullNow)
 * 3. If push has remaining items or produces conflict/error -> STOP (do not pull)
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
      // ── Step 1: Execute Push ─────────────────────────────────────────────
      const pushResult = await pushService.pushNow(options)

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
          push: pushResult,
          pull: null,
          error: pushResult?.error ?? null,
        }
      }

      // If push succeeded but still has remaining items in outbox (e.g. batch limit)
      const remaining = Number(pushResult.remaining ?? 0)
      if (remaining > 0) {
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

      // ── Step 3: Execute Pull (only when push is completely clean) ─────────
      const pullResult = await pullService.pullNow(options)

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
          pull: pullResult,
          error: pullResult?.error ?? null,
        }
      }

      // ── Step 4: Both Push & Pull Completed Successfully ───────────────────
      return {
        ok: true,
        code: 'SYNC_ALL_COMPLETED',
        stage: 'completed',
        message: 'Sinkronisasi selesai.',
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
