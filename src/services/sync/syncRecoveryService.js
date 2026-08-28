export const RECOVERY_ACTIONS = Object.freeze({
  RETRY_INFLIGHT: 'RETRY_INFLIGHT',
  CONTINUE_PENDING: 'CONTINUE_PENDING',
  PREPARE_BOOTSTRAP: 'PREPARE_BOOTSTRAP',
  CONTINUE_BOOTSTRAP: 'CONTINUE_BOOTSTRAP',
})

function sanitizeContext(source = {}) {
  const user = source.user
    ? { id: source.user.id, email: source.user.email }
    : null

  const selectedBusiness = source.selectedBusiness
    ? { id: source.selectedBusiness.id, name: source.selectedBusiness.name }
    : null

  const selectedOutlet = source.selectedOutlet
    ? { id: source.selectedOutlet.id, name: source.selectedOutlet.name }
    : null

  const cloudAccess = source.cloudAccess === true
  const deviceIdentifier = source.deviceIdentifier != null ? String(source.deviceIdentifier) : null
  const registeredDeviceId = source.registeredDeviceId != null ? source.registeredDeviceId : null

  return {
    user,
    selectedBusiness,
    selectedOutlet,
    cloudAccess,
    deviceIdentifier,
    registeredDeviceId,
  }
}

/**
 * Creates a P18 Manual Sync Recovery Service.
 * Allows safe, non-destructive recovery actions based on fresh P17 health diagnostics.
 *
 * @param {object} options
 * @param {object} options.healthService SyncHealthService instance
 * @param {object} [options.pushService] SyncPushService instance
 * @param {object} [options.bootstrapService] SyncBootstrapService instance
 * @param {object} [options.orchestratorService] SyncOrchestratorService instance
 * @param {object} [options.conflictService] SyncConflictService instance
 * @returns {object}
 */
export function createSyncRecoveryService({
  healthService,
  pushService = null,
  bootstrapService = null,
  orchestratorService = null,
  conflictService = null,
} = {}) {
  let isRecovering = false

  /**
   * Generates a read-only recovery plan based on a health check result.
   *
   * @param {object} options
   * @param {object} options.healthResult Result from healthService.checkHealth()
   * @returns {{ recommendedAction: string|null, availableActions: string[], message: string }}
   */
  function getRecoveryPlan({ healthResult } = {}) {
    if (!healthResult) {
      return {
        recommendedAction: null,
        availableActions: [],
        message: 'Status sinkronisasi belum diperiksa.',
      }
    }

    const issues = Array.isArray(healthResult.issues) ? healthResult.issues : []
    const hasBlocked =
      healthResult.status === 'blocked' ||
      issues.some((issue) => issue.severity === 'blocked') ||
      healthResult.ok === false

    const hasConflict =
      (healthResult.summary?.openConflictCount ?? 0) > 0 ||
      issues.some((issue) => issue.code === 'SYNC_OPEN_CONFLICT')

    if (hasConflict) {
      return {
        recommendedAction: null,
        availableActions: [],
        message: 'Selesaikan konflik terlebih dahulu melalui panel Konflik Sinkronisasi.',
      }
    }

    if (hasBlocked) {
      return {
        recommendedAction: null,
        availableActions: [],
        message: 'Kondisi sinkronisasi tidak aman untuk dipulihkan otomatis.',
      }
    }

    if (healthResult.status === 'ready' || healthResult.code === 'SYNC_HEALTH_READY') {
      return {
        recommendedAction: null,
        availableActions: [],
        message: 'Tidak diperlukan pemulihan sinkronisasi.',
      }
    }

    // Check attention conditions in priority order
    const hasInflight =
      healthResult.summary?.hasInflight === true ||
      issues.some((issue) => issue.code === 'SYNC_PUSH_INFLIGHT')

    const hasBootstrapStaged =
      healthResult.summary?.bootstrapStatus === 'staged' ||
      issues.some((issue) => issue.code === 'SYNC_BOOTSTRAP_STAGED')

    const hasBootstrapNotPrepared =
      healthResult.summary?.bootstrapStatus === 'not_prepared' ||
      issues.some((issue) => issue.code === 'SYNC_BOOTSTRAP_NOT_PREPARED')

    const hasPending =
      (healthResult.summary?.pendingCount ?? 0) > 0 ||
      issues.some((issue) => issue.code === 'SYNC_PENDING_QUEUE')

    // 1. SYNC_PUSH_INFLIGHT -> RETRY_INFLIGHT
    if (hasInflight) {
      return {
        recommendedAction: RECOVERY_ACTIONS.RETRY_INFLIGHT,
        availableActions: [RECOVERY_ACTIONS.RETRY_INFLIGHT],
        message: 'Terdapat proses pengiriman yang terputus. Anda dapat mencoba ulang pengiriman.',
      }
    }

    // 2. SYNC_BOOTSTRAP_STAGED + pending -> CONTINUE_BOOTSTRAP
    if (hasBootstrapStaged && hasPending) {
      return {
        recommendedAction: RECOVERY_ACTIONS.CONTINUE_BOOTSTRAP,
        availableActions: [RECOVERY_ACTIONS.CONTINUE_BOOTSTRAP],
        message: 'Data lokal telah disiapkan. Lanjutkan sinkronisasi untuk mengirim data ke cloud.',
      }
    }

    // 3. SYNC_BOOTSTRAP_NOT_PREPARED -> PREPARE_BOOTSTRAP
    if (hasBootstrapNotPrepared) {
      return {
        recommendedAction: RECOVERY_ACTIONS.PREPARE_BOOTSTRAP,
        availableActions: [RECOVERY_ACTIONS.PREPARE_BOOTSTRAP],
        message: 'Data lokal belum disiapkan untuk sinkronisasi awal. Siapkan data lokal terlebih dahulu.',
      }
    }

    // 4. normal SYNC_PENDING_QUEUE -> CONTINUE_PENDING
    if (hasPending) {
      return {
        recommendedAction: RECOVERY_ACTIONS.CONTINUE_PENDING,
        availableActions: [RECOVERY_ACTIONS.CONTINUE_PENDING],
        message: 'Terdapat data antrean sinkronisasi. Lanjutkan sinkronisasi untuk memproses antrean.',
      }
    }

    return {
      recommendedAction: null,
      availableActions: [],
      message: 'Kondisi sinkronisasi tidak memerlukan pemulihan atau tidak aman untuk dipulihkan otomatis.',
    }
  }

  /**
   * Executes a safe manual recovery action based on fresh local health checks.
   *
   * @param {string} action One of RECOVERY_ACTIONS
   * @param {object} [options]
   * @param {object} [options.context] Cloud context snapshot
   * @returns {Promise<object>}
   */
  async function recover(action, options = {}) {
    if (isRecovering) {
      return {
        ok: false,
        code: 'SYNC_RECOVERY_ALREADY_IN_PROGRESS',
        message: 'Pemulihan sinkronisasi sedang berjalan.',
      }
    }

    const validActions = Object.values(RECOVERY_ACTIONS)
    if (!validActions.includes(action)) {
      return {
        ok: false,
        code: 'SYNC_RECOVERY_ACTION_NOT_APPLICABLE',
        action,
        message: `Action recovery '${action}' tidak valid.`,
      }
    }

    isRecovering = true

    try {
      // 1. Sanitize the context snapshot once and use the SAME snapshot throughout
      const context = sanitizeContext(options.context || {})

      // 2. FRESH Health check is mandatory before ANY mutation
      if (!healthService || typeof healthService.checkHealth !== 'function') {
        return {
          ok: false,
          code: 'SYNC_RECOVERY_HEALTH_CHECK_FAILED',
          action,
          message: 'Health service tidak tersedia.',
        }
      }

      const freshHealth = await healthService.checkHealth({ context })

      // 3. Health read failure / context incomplete -> FAIL CLOSED
      if (
        !freshHealth ||
        freshHealth.ok === false ||
        freshHealth.code === 'SYNC_HEALTH_READ_FAILED' ||
        freshHealth.code === 'SYNC_HEALTH_CONTEXT_INCOMPLETE'
      ) {
        return {
          ok: false,
          code: 'SYNC_RECOVERY_HEALTH_CHECK_FAILED',
          action,
          healthBefore: freshHealth,
          message: 'Pemeriksaan status sinkronisasi lokal gagal.',
        }
      }

      // 4. Health READY -> No recovery needed
      if (freshHealth.status === 'ready' || freshHealth.code === 'SYNC_HEALTH_READY') {
        return {
          ok: true,
          code: 'SYNC_RECOVERY_NOT_REQUIRED',
          action,
          healthBefore: freshHealth,
          message: 'Tidak diperlukan pemulihan sinkronisasi.',
        }
      }

      const issues = Array.isArray(freshHealth.issues) ? freshHealth.issues : []

      // 5. Open conflict -> Require resolution via P15
      const hasConflict =
        (freshHealth.summary?.openConflictCount ?? 0) > 0 ||
        issues.some((issue) => issue.code === 'SYNC_OPEN_CONFLICT')

      if (hasConflict) {
        return {
          ok: false,
          code: 'SYNC_RECOVERY_CONFLICT_ACTION_REQUIRED',
          action,
          healthBefore: freshHealth,
          message: 'Selesaikan konflik melalui pilihan Gunakan Cloud atau Pertahankan Lokal terlebih dahulu.',
        }
      }

      // 6. Blocked issues / metadata invalid / context mismatch -> FAIL CLOSED
      const hasBlocked =
        freshHealth.status === 'blocked' ||
        issues.some((issue) => issue.severity === 'blocked') ||
        issues.some((issue) =>
          [
            'SYNC_HEALTH_METADATA_INVALID',
            'SYNC_PUSH_BINDING_MISMATCH',
            'SYNC_PULL_BINDING_MISMATCH',
            'SYNC_INFLIGHT_CONTEXT_MISMATCH',
            'SYNC_BOOTSTRAP_CONTEXT_MISMATCH',
          ].includes(issue.code),
        )

      if (hasBlocked) {
        return {
          ok: false,
          code: 'SYNC_RECOVERY_MANUAL_INTERVENTION_REQUIRED',
          action,
          healthBefore: freshHealth,
          message: 'Kondisi sinkronisasi tidak aman untuk dipulihkan otomatis.',
        }
      }

      // 7. Execute specific recovery actions
      const hasInflight =
        freshHealth.summary?.hasInflight === true ||
        issues.some((issue) => issue.code === 'SYNC_PUSH_INFLIGHT')

      const hasBootstrapStaged =
        freshHealth.summary?.bootstrapStatus === 'staged' ||
        issues.some((issue) => issue.code === 'SYNC_BOOTSTRAP_STAGED')

      const hasBootstrapNotPrepared =
        freshHealth.summary?.bootstrapStatus === 'not_prepared' ||
        issues.some((issue) => issue.code === 'SYNC_BOOTSTRAP_NOT_PREPARED')

      const hasPending =
        (freshHealth.summary?.pendingCount ?? 0) > 0 ||
        issues.some((issue) => issue.code === 'SYNC_PENDING_QUEUE')

      if (action === RECOVERY_ACTIONS.RETRY_INFLIGHT) {
        if (!hasInflight) {
          return {
            ok: false,
            code: 'SYNC_RECOVERY_ACTION_NOT_APPLICABLE',
            action: RECOVERY_ACTIONS.RETRY_INFLIGHT,
            healthBefore: freshHealth,
            message: 'Tidak ada push in-flight yang dapat dicoba ulang.',
          }
        }

        if (!pushService || typeof pushService.pushNow !== 'function') {
          return {
            ok: false,
            code: 'SYNC_RECOVERY_ACTION_FAILED',
            action: RECOVERY_ACTIONS.RETRY_INFLIGHT,
            message: 'Push service tidak tersedia.',
          }
        }

        const result = await pushService.pushNow({ context })
        return {
          ok: result?.ok === true,
          code: result?.code ?? (result?.ok ? 'SUCCESS' : 'PUSH_FAILED'),
          action: RECOVERY_ACTIONS.RETRY_INFLIGHT,
          stage: 'push',
          healthBefore: freshHealth,
          result,
          message: result?.message,
        }
      }

      if (action === RECOVERY_ACTIONS.CONTINUE_PENDING) {
        if (!hasPending || hasInflight || hasBootstrapStaged) {
          return {
            ok: false,
            code: 'SYNC_RECOVERY_ACTION_NOT_APPLICABLE',
            action: RECOVERY_ACTIONS.CONTINUE_PENDING,
            healthBefore: freshHealth,
            message: 'Action CONTINUE_PENDING tidak dapat diterapkan pada kondisi saat ini.',
          }
        }

        if (!orchestratorService || typeof orchestratorService.syncAll !== 'function') {
          return {
            ok: false,
            code: 'SYNC_RECOVERY_ACTION_FAILED',
            action: RECOVERY_ACTIONS.CONTINUE_PENDING,
            message: 'Orchestrator service tidak tersedia.',
          }
        }

        const result = await orchestratorService.syncAll({ context })
        return {
          ok: result?.ok === true,
          code: result?.code ?? (result?.ok ? 'SYNC_ALL_COMPLETED' : 'SYNC_FAILED'),
          action: RECOVERY_ACTIONS.CONTINUE_PENDING,
          stage: result?.stage ?? 'orchestration',
          healthBefore: freshHealth,
          result,
          message: result?.message,
        }
      }

      if (action === RECOVERY_ACTIONS.PREPARE_BOOTSTRAP) {
        if (!hasBootstrapNotPrepared || hasInflight) {
          return {
            ok: false,
            code: 'SYNC_RECOVERY_ACTION_NOT_APPLICABLE',
            action: RECOVERY_ACTIONS.PREPARE_BOOTSTRAP,
            healthBefore: freshHealth,
            message: 'Action PREPARE_BOOTSTRAP tidak dapat diterapkan pada kondisi saat ini.',
          }
        }

        if (!bootstrapService || typeof bootstrapService.bootstrapNow !== 'function') {
          return {
            ok: false,
            code: 'SYNC_RECOVERY_ACTION_FAILED',
            action: RECOVERY_ACTIONS.PREPARE_BOOTSTRAP,
            message: 'Bootstrap service tidak tersedia.',
          }
        }

        const result = await bootstrapService.bootstrapNow({ context })
        return {
          ok: result?.ok === true,
          code: result?.code ?? (result?.ok ? 'BOOTSTRAP_STAGED' : 'BOOTSTRAP_FAILED'),
          action: RECOVERY_ACTIONS.PREPARE_BOOTSTRAP,
          stage: 'bootstrap',
          healthBefore: freshHealth,
          result,
          message: result?.message,
        }
      }

      if (action === RECOVERY_ACTIONS.CONTINUE_BOOTSTRAP) {
        if (!hasBootstrapStaged || !hasPending || hasInflight) {
          return {
            ok: false,
            code: 'SYNC_RECOVERY_ACTION_NOT_APPLICABLE',
            action: RECOVERY_ACTIONS.CONTINUE_BOOTSTRAP,
            healthBefore: freshHealth,
            message: 'Action CONTINUE_BOOTSTRAP tidak dapat diterapkan pada kondisi saat ini.',
          }
        }

        if (!orchestratorService || typeof orchestratorService.syncAll !== 'function') {
          return {
            ok: false,
            code: 'SYNC_RECOVERY_ACTION_FAILED',
            action: RECOVERY_ACTIONS.CONTINUE_BOOTSTRAP,
            message: 'Orchestrator service tidak tersedia.',
          }
        }

        const result = await orchestratorService.syncAll({ context })
        return {
          ok: result?.ok === true,
          code: result?.code ?? (result?.ok ? 'SYNC_ALL_COMPLETED' : 'SYNC_FAILED'),
          action: RECOVERY_ACTIONS.CONTINUE_BOOTSTRAP,
          stage: result?.stage ?? 'orchestration',
          healthBefore: freshHealth,
          result,
          message: result?.message,
        }
      }

      return {
        ok: false,
        code: 'SYNC_RECOVERY_NO_SAFE_ACTION',
        action,
        healthBefore: freshHealth,
        message: 'Tidak ditemukan tindakan pemulihan yang aman untuk kondisi saat ini.',
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        ok: false,
        code: 'SYNC_RECOVERY_ACTION_FAILED',
        action,
        message: msg,
        error: {
          code: 'SYNC_RECOVERY_ACTION_FAILED',
          message: msg,
        },
      }
    } finally {
      isRecovering = false
    }
  }

  return {
    getRecoveryPlan,
    recover,
    get isRecovering() {
      return isRecovering
    },
  }
}
