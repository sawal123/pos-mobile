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

    // ── 1. Strict Context Validation ────────────────────────────────────────
    const isUserValid =
      Boolean(user) &&
      typeof user === 'object' &&
      user.id != null &&
      String(user.id).trim().length > 0

    const isBusinessValid =
      Boolean(selectedBusiness) &&
      typeof selectedBusiness === 'object' &&
      selectedBusiness.id != null &&
      Number.isInteger(Number(selectedBusiness.id)) &&
      Number(selectedBusiness.id) > 0

    const isOutletValid =
      Boolean(selectedOutlet) &&
      typeof selectedOutlet === 'object' &&
      selectedOutlet.id != null &&
      Number.isInteger(Number(selectedOutlet.id)) &&
      Number(selectedOutlet.id) > 0

    const isCloudAccessValid = cloudAccess === true

    const isDeviceIdentifierValid =
      typeof deviceIdentifier === 'string' && deviceIdentifier.trim().length > 0

    const isRegisteredDeviceIdValid =
      registeredDeviceId != null &&
      Number.isInteger(Number(registeredDeviceId)) &&
      Number(registeredDeviceId) > 0

    const isContextComplete =
      isUserValid &&
      isBusinessValid &&
      isOutletValid &&
      isCloudAccessValid &&
      isDeviceIdentifierValid &&
      isRegisteredDeviceIdValid

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

    // ── 2. Required Reader Capability Check (Fail Closed) ───────────────────
    const hasQueueReader =
      (queueService && typeof queueService.countPending === 'function') ||
      (adapter && typeof adapter.countSyncQueueItems === 'function')

    const hasPushBindingReader = adapter && typeof adapter.loadSyncPushBinding === 'function'
    const hasPullBindingReader = adapter && typeof adapter.loadSyncPullBinding === 'function'
    const hasPullStateReader = adapter && typeof adapter.loadSyncPullState === 'function'
    const hasPushInflightReader = adapter && typeof adapter.loadSyncPushInflight === 'function'
    const hasBootstrapStateReader = adapter && typeof adapter.loadSyncBootstrapState === 'function'
    const hasConflictsReader = adapter && typeof adapter.loadSyncConflicts === 'function'

    if (
      !hasQueueReader ||
      !hasPushBindingReader ||
      !hasPullBindingReader ||
      !hasPullStateReader ||
      !hasPushInflightReader ||
      !hasBootstrapStateReader ||
      !hasConflictsReader
    ) {
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
            message: 'Required local sync diagnostic readers are not supported by adapter.',
          },
        ],
      }
    }

    const currentBusinessId = Number(selectedBusiness.id)
    const currentOutletId = Number(selectedOutlet.id)
    const currentDeviceIdentifier = String(deviceIdentifier).trim()
    const currentRegisteredDeviceId = String(registeredDeviceId)

    const issues = []

    try {
      // ── 3. Read & Validate Outbox Pending Count ────────────────────────────
      let rawPendingCount
      if (queueService && typeof queueService.countPending === 'function') {
        rawPendingCount = await queueService.countPending()
      } else {
        rawPendingCount = await adapter.countSyncQueueItems()
      }

      let pendingCount = 0
      const isPendingValid =
        rawPendingCount != null &&
        Number.isInteger(Number(rawPendingCount)) &&
        Number(rawPendingCount) >= 0

      if (!isPendingValid) {
        issues.push({
          code: 'SYNC_HEALTH_METADATA_INVALID',
          severity: 'blocked',
          message: 'Metadata pending queue count lokal tidak valid.',
        })
      } else {
        pendingCount = Number(rawPendingCount)
        if (pendingCount > 0) {
          issues.push({
            code: 'SYNC_PENDING_QUEUE',
            severity: 'attention',
            message: `Terdapat ${pendingCount} perubahan data lokal yang menunggu sinkronisasi.`,
          })
        }
      }

      // ── 4. Read & Validate Raw sync_conflicts_v1 ───────────────────────────
      const rawConflictState = await adapter.loadSyncConflicts()
      let openConflictCount = 0

      if (rawConflictState != null) {
        let isConflictStateValid =
          typeof rawConflictState === 'object' &&
          rawConflictState.version === 1 &&
          Array.isArray(rawConflictState.conflicts)

        if (isConflictStateValid) {
          for (const c of rawConflictState.conflicts) {
            const isConflictItemValid =
              c &&
              typeof c === 'object' &&
              typeof c.id === 'string' &&
              c.id.trim().length > 0 &&
              typeof c.requestId === 'string' &&
              c.requestId.trim().length > 0 &&
              typeof c.queueId === 'string' &&
              c.queueId.trim().length > 0 &&
              typeof c.entityType === 'string' &&
              c.entityType.trim().length > 0 &&
              typeof c.serverEntity === 'string' &&
              c.serverEntity.trim().length > 0 &&
              typeof c.syncId === 'string' &&
              c.syncId.trim().length > 0 &&
              c.serverSyncVersion != null &&
              Number.isInteger(Number(c.serverSyncVersion)) &&
              Number(c.serverSyncVersion) >= 0 &&
              (c.status === 'open' || c.status === 'resolved') &&
              (c.status !== 'open' || (typeof c.queueSnapshot === 'object' && c.queueSnapshot !== null))

            if (!isConflictItemValid) {
              isConflictStateValid = false
              break
            }
          }
        }

        if (!isConflictStateValid) {
          issues.push({
            code: 'SYNC_HEALTH_METADATA_INVALID',
            severity: 'blocked',
            message: 'Metadata konflik sinkronisasi lokal tidak valid.',
          })
        } else {
          openConflictCount = rawConflictState.conflicts.filter((c) => c.status === 'open').length
        }
      }

      if (openConflictCount > 0) {
        issues.push({
          code: 'SYNC_OPEN_CONFLICT',
          severity: 'blocked',
          message: `Terdapat ${openConflictCount} konflik sinkronisasi yang memerlukan penyelesaian manual.`,
        })
      }

      // ── 5. Read & Validate Push Binding ───────────────────────────────────
      const pushBinding = await adapter.loadSyncPushBinding()

      if (pushBinding != null) {
        const isPushBindingValid =
          typeof pushBinding === 'object' &&
          pushBinding.businessId != null &&
          Number.isInteger(Number(pushBinding.businessId)) &&
          Number(pushBinding.businessId) > 0

        if (!isPushBindingValid) {
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

      // ── 6. Read & Validate Pull Binding ───────────────────────────────────
      const pullBinding = await adapter.loadSyncPullBinding()

      if (pullBinding != null) {
        const isPullBindingValid =
          typeof pullBinding === 'object' &&
          pullBinding.businessId != null &&
          Number.isInteger(Number(pullBinding.businessId)) &&
          Number(pullBinding.businessId) > 0 &&
          pullBinding.outletId != null &&
          Number.isInteger(Number(pullBinding.outletId)) &&
          Number(pullBinding.outletId) > 0 &&
          typeof pullBinding.deviceIdentifier === 'string' &&
          pullBinding.deviceIdentifier.trim().length > 0 &&
          pullBinding.registeredDeviceId != null &&
          Number.isInteger(Number(pullBinding.registeredDeviceId)) &&
          Number(pullBinding.registeredDeviceId) > 0

        if (!isPullBindingValid) {
          issues.push({
            code: 'SYNC_HEALTH_METADATA_INVALID',
            severity: 'blocked',
            message: 'Metadata pull binding lokal tidak valid.',
          })
        } else {
          const isPullMatch =
            Number(pullBinding.businessId) === currentBusinessId &&
            Number(pullBinding.outletId) === currentOutletId &&
            String(pullBinding.deviceIdentifier).trim() === currentDeviceIdentifier &&
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

      // ── 7. Read & Validate Full In-flight Envelope P12 ────────────────────
      const inflightEnvelope = await adapter.loadSyncPushInflight()
      const hasInflight = Boolean(inflightEnvelope)

      if (inflightEnvelope != null) {
        let isInflightValid =
          typeof inflightEnvelope === 'object' &&
          inflightEnvelope.version === 1 &&
          typeof inflightEnvelope.requestId === 'string' &&
          inflightEnvelope.requestId.trim().length > 0 &&
          inflightEnvelope.businessId != null &&
          Number.isInteger(Number(inflightEnvelope.businessId)) &&
          Number(inflightEnvelope.businessId) > 0 &&
          inflightEnvelope.outletId != null &&
          Number.isInteger(Number(inflightEnvelope.outletId)) &&
          Number(inflightEnvelope.outletId) > 0 &&
          typeof inflightEnvelope.deviceIdentifier === 'string' &&
          inflightEnvelope.deviceIdentifier.trim().length > 0 &&
          inflightEnvelope.registeredDeviceId != null &&
          Number.isInteger(Number(inflightEnvelope.registeredDeviceId)) &&
          Number(inflightEnvelope.registeredDeviceId) > 0 &&
          inflightEnvelope.createdAt != null &&
          String(inflightEnvelope.createdAt).trim().length > 0 &&
          Array.isArray(inflightEnvelope.queueSnapshots) &&
          inflightEnvelope.queueSnapshots.length > 0 &&
          typeof inflightEnvelope.changes === 'object' &&
          inflightEnvelope.changes !== null

        if (isInflightValid) {
          for (const snap of inflightEnvelope.queueSnapshots) {
            const isSnapValid =
              snap &&
              typeof snap === 'object' &&
              typeof snap.id === 'string' &&
              snap.id.trim().length > 0 &&
              typeof snap.entityType === 'string' &&
              snap.entityType.trim().length > 0 &&
              snap.entityId != null &&
              String(snap.entityId).trim().length > 0 &&
              typeof snap.operation === 'string' &&
              snap.operation.trim().length > 0 &&
              snap.updatedAt != null &&
              String(snap.updatedAt).trim().length > 0

            if (!isSnapValid) {
              isInflightValid = false
              break
            }
          }
        }

        if (!isInflightValid) {
          issues.push({
            code: 'SYNC_HEALTH_METADATA_INVALID',
            severity: 'blocked',
            message: 'Metadata in-flight push lokal tidak valid.',
          })
        } else {
          const isInflightMatch =
            Number(inflightEnvelope.businessId) === currentBusinessId &&
            Number(inflightEnvelope.outletId) === currentOutletId &&
            String(inflightEnvelope.deviceIdentifier).trim() === currentDeviceIdentifier &&
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

      // ── 8. Read & Validate Bootstrap State ────────────────────────────────
      const bootstrapState = await adapter.loadSyncBootstrapState()
      let bootstrapStatus = 'none'

      if (bootstrapState != null) {
        const isBootstrapStructValid =
          typeof bootstrapState === 'object' &&
          bootstrapState.version === 1 &&
          (bootstrapState.status === 'staged' || bootstrapState.status === 'completed') &&
          bootstrapState.businessId != null &&
          Number.isInteger(Number(bootstrapState.businessId)) &&
          Number(bootstrapState.businessId) > 0 &&
          bootstrapState.outletId != null &&
          Number.isInteger(Number(bootstrapState.outletId)) &&
          Number(bootstrapState.outletId) > 0 &&
          typeof bootstrapState.deviceIdentifier === 'string' &&
          bootstrapState.deviceIdentifier.trim().length > 0 &&
          bootstrapState.registeredDeviceId != null &&
          Number.isInteger(Number(bootstrapState.registeredDeviceId)) &&
          Number(bootstrapState.registeredDeviceId) > 0

        if (!isBootstrapStructValid) {
          bootstrapStatus = 'invalid'
          issues.push({
            code: 'SYNC_HEALTH_METADATA_INVALID',
            severity: 'blocked',
            message: 'Metadata bootstrap lokal tidak valid.',
          })
        } else {
          bootstrapStatus = bootstrapState.status
          const isBootstrapMatch =
            Number(bootstrapState.businessId) === currentBusinessId &&
            Number(bootstrapState.outletId) === currentOutletId &&
            String(bootstrapState.deviceIdentifier).trim() === currentDeviceIdentifier &&
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
      } else if (!pushBinding) {
        issues.push({
          code: 'SYNC_BOOTSTRAP_NOT_PREPARED',
          severity: 'attention',
          message: 'Data lokal belum disiapkan untuk sinkronisasi cloud pertama kali.',
        })
      }

      // ── 9. Read & Validate Pull State ─────────────────────────────────────
      const pullState = await adapter.loadSyncPullState()
      let pullCursor = 0

      if (pullState != null) {
        const isPullStateValid =
          typeof pullState === 'object' &&
          pullState.version === 1 &&
          pullState.cursor != null &&
          Number.isInteger(Number(pullState.cursor)) &&
          Number(pullState.cursor) >= 0 &&
          pullState.serverSequence != null &&
          Number.isInteger(Number(pullState.serverSequence)) &&
          Number(pullState.serverSequence) >= 0

        if (!isPullStateValid) {
          issues.push({
            code: 'SYNC_HEALTH_METADATA_INVALID',
            severity: 'blocked',
            message: 'Metadata pull state lokal tidak valid.',
          })
        } else {
          pullCursor = Number(pullState.cursor)
        }
      }

      // ── 10. Calculate Final Status & Code ─────────────────────────────────
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
