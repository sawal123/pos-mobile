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
   * Issue list is the sole authority for safe actions.
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

    // 1. Conflict check (Conflict beats blocked and ready)
    const hasConflict = issues.some((issue) => issue.code === 'SYNC_OPEN_CONFLICT')
    if (hasConflict) {
      return {
        recommendedAction: null,
        availableActions: [],
        message: 'Selesaikan konflik terlebih dahulu melalui panel Konflik Sinkronisasi.',
      }
    }

    // 2. Blocked check (Blocked beats ready)
    const hasBlocked =
      healthResult.status === 'blocked' ||
      healthResult.ok === false ||
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
        recommendedAction: null,
        availableActions: [],
        message: 'Kondisi sinkronisasi tidak aman untuk dipulihkan otomatis.',
      }
    }

    // 3. Ready check (Only if no conflict and no blocked)
    if (healthResult.status === 'ready' || healthResult.code === 'SYNC_HEALTH_READY') {
      return {
        recommendedAction: null,
        availableActions: [],
        message: 'Tidak diperlukan pemulihan sinkronisasi.',
      }
    }

    // 4. Issue-authoritative attention evaluation in priority order
    const hasInflight = issues.some(
      (issue) => issue.code === 'SYNC_PUSH_INFLIGHT' && issue.severity === 'attention',
    )
    const hasBootstrapStaged = issues.some(
      (issue) => issue.code === 'SYNC_BOOTSTRAP_STAGED' && issue.severity === 'attention',
    )
    const hasBootstrapNotPrepared = issues.some(
      (issue) => issue.code === 'SYNC_BOOTSTRAP_NOT_PREPARED' && issue.severity === 'attention',
    )
    const hasPending = issues.some(
      (issue) => issue.code === 'SYNC_PENDING_QUEUE' && issue.severity === 'attention',
    )

    // Priority 1: In-flight push
    if (hasInflight) {
      return {
        recommendedAction: RECOVERY_ACTIONS.RETRY_INFLIGHT,
        availableActions: [RECOVERY_ACTIONS.RETRY_INFLIGHT],
        message: 'Terdapat proses pengiriman yang terputus. Anda dapat mencoba ulang pengiriman.',
      }
    }

    // Priority 2: Staged bootstrap with pending queue
    if (hasBootstrapStaged && hasPending) {
      return {
        recommendedAction: RECOVERY_ACTIONS.CONTINUE_BOOTSTRAP,
        availableActions: [RECOVERY_ACTIONS.CONTINUE_BOOTSTRAP],
        message: 'Data lokal telah disiapkan. Lanjutkan sinkronisasi untuk mengirim data ke cloud.',
      }
    }

    // Priority 3: Bootstrap not prepared
    if (hasBootstrapNotPrepared) {
      return {
        recommendedAction: RECOVERY_ACTIONS.PREPARE_BOOTSTRAP,
        availableActions: [RECOVERY_ACTIONS.PREPARE_BOOTSTRAP],
        message: 'Data lokal belum disiapkan untuk sinkronisasi awal. Siapkan data lokal terlebih dahulu.',
      }
    }

    // Priority 4: Normal pending queue
    if (hasPending) {
      return {
        recommendedAction: RECOVERY_ACTIONS.CONTINUE_PENDING,
        availableActions: [RECOVERY_ACTIONS.CONTINUE_PENDING],
        message: 'Terdapat data antrean sinkronisasi. Lanjutkan sinkronisasi untuk memproses antrean.',
      }
    }

    // Attention but no recognizable safe recovery action
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

      const issues = Array.isArray(freshHealth.issues) ? freshHealth.issues : []

      // 4. Open conflict -> Conflict beats READY and blocked
      const hasConflict = issues.some((issue) => issue.code === 'SYNC_OPEN_CONFLICT')
      if (hasConflict) {
        return {
          ok: false,
          code: 'SYNC_RECOVERY_CONFLICT_ACTION_REQUIRED',
          action,
          healthBefore: freshHealth,
          message: 'Selesaikan konflik melalui pilihan Gunakan Cloud atau Pertahankan Lokal terlebih dahulu.',
        }
      }

      // 5. Blocked issues / metadata invalid / context mismatch -> FAIL CLOSED (beats READY)
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

      // 6. Health READY -> No recovery needed
      if (freshHealth.status === 'ready' || freshHealth.code === 'SYNC_HEALTH_READY') {
        return {
          ok: true,
          code: 'SYNC_RECOVERY_NOT_REQUIRED',
          action,
          healthBefore: freshHealth,
          message: 'Tidak diperlukan pemulihan sinkronisasi.',
        }
      }

      // 7. Derive recovery plan using issue authority
      const plan = getRecoveryPlan({ healthResult: freshHealth })

      // 8. If plan has no safe actions -> SYNC_RECOVERY_NO_SAFE_ACTION
      if (!plan.availableActions || plan.availableActions.length === 0) {
        return {
          ok: false,
          code: 'SYNC_RECOVERY_NO_SAFE_ACTION',
          action,
          healthBefore: freshHealth,
          message: 'Tidak ditemukan tindakan pemulihan yang aman untuk kondisi saat ini.',
        }
      }

      // 9. If requested action is not in available actions -> SYNC_RECOVERY_ACTION_NOT_APPLICABLE
      if (!plan.availableActions.includes(action)) {
        return {
          ok: false,
          code: 'SYNC_RECOVERY_ACTION_NOT_APPLICABLE',
          action,
          healthBefore: freshHealth,
          message: `Action recovery '${action}' tidak dapat diterapkan pada kondisi saat ini.`,
        }
      }

      // 10. Execute target service for authorized action
      if (action === RECOVERY_ACTIONS.RETRY_INFLIGHT) {
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
