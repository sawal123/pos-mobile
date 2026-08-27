/**
 * Creates a P17 Sync Health & Diagnostics Service.
 * Performs strictly read-only health checks on local sync metadata, outbox, conflicts,
 * inflight state, pull state, and context bindings without initiating any mutations or network requests.
 *
 * @param {object} options
 * @param {object} options.adapter Persistence adapter (SQLite / Memory)
 * @param {object} [options.queueService] SyncQueueService instance
 * @param {object} [options.conflictService] SyncConflictService instance
 * @returns {object}
 */
export function createSyncHealthService({
  adapter,
  queueService = null,
  conflictService = null,
} = {}) {
  /**
   * Evaluates the health of the local sync subsystem against the provided Cloud Context.
   *
   * @param {object} options
   * @param {object} options.context Current cloud context snapshot
   * @returns {Promise<object>}
   */
  async function checkHealth(options = {}) {
    const context = options.context || {}
    const {
      user,
      selectedBusiness,
      selectedOutlet,
      cloudAccess,
      deviceIdentifier,
      registeredDeviceId,
    } = context

    // ── 1. Validate Context Preconditions ───────────────────────────────────
    const isContextComplete =
      Boolean(user) &&
      Boolean(selectedBusiness) &&
      selectedBusiness.id != null &&
      Boolean(selectedOutlet) &&
      selectedOutlet.id != null &&
      cloudAccess === true &&
      Boolean(deviceIdentifier) &&
      registeredDeviceId != null

    if (!isContextComplete) {
      return {
        ok: false,
        code: 'SYNC_HEALTH_CONTEXT_INCOMPLETE',
        status: 'blocked',
        checkedAt: new Date().toISOString(),
        summary: {
          pendingCount: 0,
          openConflictCount: 0,
          hasInflight: false,
          bootstrapStatus: 'none',
          pullCursor: 0,
        },
        issues: [
          {
            code: 'SYNC_HEALTH_CONTEXT_INCOMPLETE',
            severity: 'blocked',
            message: 'Cloud session context is incomplete or not authenticated.',
          },
        ],
      }
    }

    const currentBusinessId = Number(selectedBusiness.id)
    const currentOutletId = Number(selectedOutlet.id)
    const currentDeviceIdentifier = String(deviceIdentifier)
    const currentRegisteredDeviceId = String(registeredDeviceId)

    const issues = []

    try {
      // ── 2. Read Outbox Pending Count ──────────────────────────────────────
      let pendingCount = 0
      if (queueService && typeof queueService.countPending === 'function') {
        pendingCount = await queueService.countPending()
      } else if (adapter && typeof adapter.countSyncQueueItems === 'function') {
        pendingCount = await adapter.countSyncQueueItems()
      }

      if (pendingCount > 0) {
        issues.push({
          code: 'SYNC_PENDING_QUEUE',
          severity: 'attention',
          message: `Terdapat ${pendingCount} perubahan data lokal yang menunggu sinkronisasi.`,
        })
      }

      // ── 3. Read Open Conflict Count ───────────────────────────────────────
      let openConflictCount = 0
      if (conflictService && typeof conflictService.countOpenConflicts === 'function') {
        openConflictCount = await conflictService.countOpenConflicts()
      } else if (adapter && typeof adapter.loadSyncConflicts === 'function') {
        const conflictState = await adapter.loadSyncConflicts()
        const conflicts = Array.isArray(conflictState?.conflicts) ? conflictState.conflicts : []
        openConflictCount = conflicts.filter((c) => c.status === 'open').length
      }

      if (openConflictCount > 0) {
        issues.push({
          code: 'SYNC_OPEN_CONFLICT',
          severity: 'blocked',
          message: `Terdapat ${openConflictCount} konflik sinkronisasi yang memerlukan penyelesaian manual.`,
        })
      }

      // ── 4. Read Push Binding ──────────────────────────────────────────────
      const pushBinding =
        adapter && typeof adapter.loadSyncPushBinding === 'function'
          ? await adapter.loadSyncPushBinding()
          : null

      if (pushBinding) {
        if (
          pushBinding.businessId == null ||
          !Number.isInteger(Number(pushBinding.businessId)) ||
          Number(pushBinding.businessId) <= 0
        ) {
          issues.push({
            code: 'SYNC_HEALTH_METADATA_INVALID',
            severity: 'blocked',
            message: 'Metadata push binding lokal tidak valid.',
          })
        } else if (Number(pushBinding.businessId) !== currentBusinessId) {
          issues.push({
            code: 'SYNC_PUSH_BINDING_MISMATCH',
            severity: 'blocked',
            message: `Data push lokal terikat pada Business ID ${pushBinding.businessId}, berbeda dengan Business ID ${currentBusinessId}.`,
          })
        }
      }

      // ── 5. Read Pull Binding ──────────────────────────────────────────────
      const pullBinding =
        adapter && typeof adapter.loadSyncPullBinding === 'function'
          ? await adapter.loadSyncPullBinding()
          : null

      if (pullBinding) {
        if (
          pullBinding.businessId == null ||
          pullBinding.outletId == null ||
          !pullBinding.deviceIdentifier ||
          pullBinding.registeredDeviceId == null
        ) {
          issues.push({
            code: 'SYNC_HEALTH_METADATA_INVALID',
            severity: 'blocked',
            message: 'Metadata pull binding lokal tidak valid.',
          })
        } else {
          const isPullMatch =
            Number(pullBinding.businessId) === currentBusinessId &&
            Number(pullBinding.outletId) === currentOutletId &&
            String(pullBinding.deviceIdentifier) === currentDeviceIdentifier &&
            String(pullBinding.registeredDeviceId) === currentRegisteredDeviceId

          if (!isPullMatch) {
            issues.push({
              code: 'SYNC_PULL_BINDING_MISMATCH',
              severity: 'blocked',
              message: 'Data pull lokal terikat pada konteks Business/Outlet/Device yang berbeda.',
            })
          }
        }
      }

      // ── 6. Read In-flight Envelope ────────────────────────────────────────
      const inflightEnvelope =
        adapter && typeof adapter.loadSyncPushInflight === 'function'
          ? await adapter.loadSyncPushInflight()
          : null

      const hasInflight = Boolean(inflightEnvelope)

      if (inflightEnvelope) {
        if (
          inflightEnvelope.businessId == null ||
          inflightEnvelope.outletId == null ||
          !inflightEnvelope.deviceIdentifier ||
          inflightEnvelope.registeredDeviceId == null
        ) {
          issues.push({
            code: 'SYNC_HEALTH_METADATA_INVALID',
            severity: 'blocked',
            message: 'Metadata in-flight push lokal tidak valid.',
          })
        } else {
          const isInflightMatch =
            Number(inflightEnvelope.businessId) === currentBusinessId &&
            Number(inflightEnvelope.outletId) === currentOutletId &&
            String(inflightEnvelope.deviceIdentifier) === currentDeviceIdentifier &&
            String(inflightEnvelope.registeredDeviceId) === currentRegisteredDeviceId

          if (isInflightMatch) {
            issues.push({
              code: 'SYNC_PUSH_INFLIGHT',
              severity: 'attention',
              message: 'Terdapat proses push in-flight sebelumnya yang belum terselesaikan.',
            })
          } else {
            issues.push({
              code: 'SYNC_INFLIGHT_CONTEXT_MISMATCH',
              severity: 'blocked',
              message: 'In-flight envelope lokal terikat pada konteks Business/Outlet/Device yang berbeda.',
            })
          }
        }
      }

      // ── 7. Read Bootstrap State ───────────────────────────────────────────
      const bootstrapState =
        adapter && typeof adapter.loadSyncBootstrapState === 'function'
          ? await adapter.loadSyncBootstrapState()
          : null

      const bootstrapStatus = bootstrapState?.status || 'none'

      if (bootstrapState && (bootstrapState.status === 'staged' || bootstrapState.status === 'completed')) {
        if (
          bootstrapState.businessId == null ||
          bootstrapState.outletId == null ||
          !bootstrapState.deviceIdentifier ||
          bootstrapState.registeredDeviceId == null
        ) {
          issues.push({
            code: 'SYNC_HEALTH_METADATA_INVALID',
            severity: 'blocked',
            message: 'Metadata bootstrap lokal tidak valid.',
          })
        } else {
          const isBootstrapMatch =
            Number(bootstrapState.businessId) === currentBusinessId &&
            Number(bootstrapState.outletId) === currentOutletId &&
            String(bootstrapState.deviceIdentifier) === currentDeviceIdentifier &&
            String(bootstrapState.registeredDeviceId) === currentRegisteredDeviceId

          if (!isBootstrapMatch) {
            issues.push({
              code: 'SYNC_BOOTSTRAP_CONTEXT_MISMATCH',
              severity: 'blocked',
              message: 'Data bootstrap lokal terikat pada konteks Business/Outlet/Device yang berbeda.',
            })
          } else if (bootstrapState.status === 'staged') {
            issues.push({
              code: 'SYNC_BOOTSTRAP_STAGED',
              severity: 'attention',
              message: 'Data lokal sudah disiapkan (staged) dan siap disinkronkan ke cloud.',
            })
          }
        }
      } else if (!pushBinding && (!bootstrapState || (bootstrapState.status !== 'staged' && bootstrapState.status !== 'completed'))) {
        issues.push({
          code: 'SYNC_BOOTSTRAP_NOT_PREPARED',
          severity: 'attention',
          message: 'Data lokal belum disiapkan untuk sinkronisasi cloud pertama kali.',
        })
      }

      // ── 8. Read Pull Cursor ───────────────────────────────────────────────
      const pullState =
        adapter && typeof adapter.loadSyncPullState === 'function'
          ? await adapter.loadSyncPullState()
          : null

      const pullCursor =
        pullState?.cursor != null && Number.isInteger(Number(pullState.cursor))
          ? Number(pullState.cursor)
          : 0

      // ── 9. Calculate Final Status & Code ──────────────────────────────────
      const hasBlocked = issues.some((i) => i.severity === 'blocked')
      const hasAttention = issues.some((i) => i.severity === 'attention')

      let status = 'ready'
      let code = 'SYNC_HEALTH_READY'

      if (hasBlocked) {
        status = 'blocked'
        code = 'SYNC_HEALTH_BLOCKED'
      } else if (hasAttention) {
        status = 'attention'
        code = 'SYNC_HEALTH_ATTENTION'
      }

      return {
        ok: true,
        code,
        status,
        checkedAt: new Date().toISOString(),
        summary: {
          pendingCount,
          openConflictCount,
          hasInflight,
          bootstrapStatus,
          pullCursor,
        },
        issues,
      }
    } catch (err) {
      return {
        ok: false,
        code: 'SYNC_HEALTH_READ_FAILED',
        status: 'blocked',
        checkedAt: new Date().toISOString(),
        summary: {
          pendingCount: 0,
          openConflictCount: 0,
          hasInflight: false,
          bootstrapStatus: 'none',
          pullCursor: 0,
        },
        issues: [
          {
            code: 'SYNC_HEALTH_READ_FAILED',
            severity: 'blocked',
            message: err instanceof Error ? err.message : String(err),
          },
        ],
      }
    }
  }

  return {
    checkHealth,
    adapter,
    queueService,
    conflictService,
  }
}
