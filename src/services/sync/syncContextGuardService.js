/**
 * Canonical Sync Context Guard Service (P23)
 *
 * Implements a strict, fail-closed, read-only tenant isolation guard for all
 * local sync operations.
 *
 * Rules:
 * - Read-only: zero writes, zero metadata updates, zero network calls.
 * - Fail-closed: invalid schema, missing preconditions, or tenant mismatch blocks operations.
 * - Multi-source consistency: checks push_binding, pull_binding, push_inflight,
 *   bootstrap_state, and auto_settings.
 * - Fresh/unbound device: returns ok: true, status: 'unbound'.
 * - Safe matching context: returns ok: true, status: 'safe'.
 */

function isPlainObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val)
}

function isValidNormalizedContext(ctx) {
  if (!isPlainObject(ctx)) return false
  const hasValidBiz =
    typeof ctx.businessId === 'number' &&
    Number.isInteger(ctx.businessId) &&
    ctx.businessId > 0
  const hasValidOutlet =
    typeof ctx.outletId === 'number' &&
    Number.isInteger(ctx.outletId) &&
    ctx.outletId > 0
  const hasValidDevId =
    typeof ctx.deviceIdentifier === 'string' &&
    ctx.deviceIdentifier.trim().length > 0
  const hasValidRegDevId =
    typeof ctx.registeredDeviceId === 'number' &&
    Number.isInteger(ctx.registeredDeviceId) &&
    ctx.registeredDeviceId > 0

  return hasValidBiz && hasValidOutlet && hasValidDevId && hasValidRegDevId
}

function normalizeContext(raw) {
  if (!isPlainObject(raw)) return null
  const businessId =
    raw.businessId !== null && raw.businessId !== undefined
      ? Number(raw.businessId)
      : null
  const outletId =
    raw.outletId !== null && raw.outletId !== undefined
      ? Number(raw.outletId)
      : null
  const deviceIdentifier =
    raw.deviceIdentifier !== null && raw.deviceIdentifier !== undefined
      ? String(raw.deviceIdentifier).trim()
      : null
  const registeredDeviceId =
    raw.registeredDeviceId !== null && raw.registeredDeviceId !== undefined
      ? Number(raw.registeredDeviceId)
      : null

  return {
    businessId,
    outletId,
    deviceIdentifier,
    registeredDeviceId,
  }
}

function extractAutoSettingsContext(autoSettings) {
  if (!autoSettings || typeof autoSettings !== 'object') return null
  if (autoSettings.context && typeof autoSettings.context === 'object') {
    return normalizeContext(autoSettings.context)
  }
  return normalizeContext(autoSettings)
}

function validateCurrentContext(context) {
  if (!isPlainObject(context)) return null

  const {
    user = null,
    cloudAccess = false,
    selectedBusiness = null,
    selectedOutlet = null,
    deviceIdentifier = null,
    registeredDeviceId = null,
  } = context

  const hasValidUser =
    user !== null &&
    user !== undefined &&
    user.id !== null &&
    user.id !== undefined &&
    String(user.id).trim().length > 0
  const hasCloudAccess = cloudAccess === true
  const hasValidBiz =
    selectedBusiness !== null &&
    selectedBusiness !== undefined &&
    selectedBusiness.id !== null &&
    selectedBusiness.id !== undefined &&
    Number.isInteger(Number(selectedBusiness.id)) &&
    Number(selectedBusiness.id) > 0
  const hasValidOutlet =
    selectedOutlet !== null &&
    selectedOutlet !== undefined &&
    selectedOutlet.id !== null &&
    selectedOutlet.id !== undefined &&
    Number.isInteger(Number(selectedOutlet.id)) &&
    Number(selectedOutlet.id) > 0
  const hasValidDevId =
    deviceIdentifier !== null &&
    deviceIdentifier !== undefined &&
    typeof deviceIdentifier === 'string' &&
    deviceIdentifier.trim().length > 0
  const hasValidRegDevId =
    registeredDeviceId !== null &&
    registeredDeviceId !== undefined &&
    Number.isInteger(Number(registeredDeviceId)) &&
    Number(registeredDeviceId) > 0

  if (
    !hasValidUser ||
    !hasCloudAccess ||
    !hasValidBiz ||
    !hasValidOutlet ||
    !hasValidDevId ||
    !hasValidRegDevId
  ) {
    return null
  }

  return {
    businessId: Number(selectedBusiness.id),
    outletId: Number(selectedOutlet.id),
    deviceIdentifier: String(deviceIdentifier).trim(),
    registeredDeviceId: Number(registeredDeviceId),
  }
}

export function createSyncContextGuardService({ adapter } = {}) {
  /**
   * Inspects current runtime cloud context against canonical local storage bindings.
   *
   * @param {object} options
   * @param {object} options.context The current active cloud context snapshot.
   * @returns {Promise<object>} Guard outcome object.
   */
  async function inspect({ context = null } = {}) {
    const currentContext = validateCurrentContext(context)
    if (!currentContext) {
      return {
        ok: false,
        code: 'SYNC_CONTEXT_INVALID',
        status: 'blocked',
        currentContext: null,
        canonicalContext: null,
        sources: [],
        issues: [{ code: 'CURRENT_CONTEXT_INVALID', source: 'runtime' }],
      }
    }

    if (!adapter) {
      return {
        ok: false,
        code: 'SYNC_CONTEXT_READ_FAILED',
        status: 'blocked',
        currentContext,
        canonicalContext: null,
        sources: [],
        issues: [{ code: 'ADAPTER_MISSING', source: 'adapter' }],
      }
    }

    let pushBinding = null
    let pullBinding = null
    let inflight = null
    let bootstrapState = null
    let autoSettings = null

    try {
      const results = await Promise.all([
        typeof adapter.loadSyncPushBinding === 'function'
          ? adapter.loadSyncPushBinding()
          : null,
        typeof adapter.loadSyncPullBinding === 'function'
          ? adapter.loadSyncPullBinding()
          : null,
        typeof adapter.loadSyncPushInflight === 'function'
          ? adapter.loadSyncPushInflight()
          : null,
        typeof adapter.loadSyncBootstrapState === 'function'
          ? adapter.loadSyncBootstrapState()
          : null,
        typeof adapter.loadSyncAutoSettings === 'function'
          ? adapter.loadSyncAutoSettings()
          : null,
      ])

      pushBinding = results[0]
      pullBinding = results[1]
      inflight = results[2]
      bootstrapState = results[3]
      autoSettings = results[4]
    } catch {
      return {
        ok: false,
        code: 'SYNC_CONTEXT_READ_FAILED',
        status: 'blocked',
        currentContext,
        canonicalContext: null,
        sources: [],
        issues: [{ code: 'READ_FAILED', source: 'adapter' }],
      }
    }

    const schemaIssues = []

    // 1. Validate push binding schema
    if (pushBinding !== null && pushBinding !== undefined) {
      if (
        !isPlainObject(pushBinding) ||
        pushBinding.version !== 1 ||
        typeof pushBinding.businessId !== 'number' ||
        !Number.isInteger(pushBinding.businessId) ||
        pushBinding.businessId <= 0
      ) {
        schemaIssues.push({
          code: 'INVALID_METADATA_SCHEMA',
          source: 'push_binding',
        })
      }
    }

    // 2. Validate pull binding schema
    if (pullBinding !== null && pullBinding !== undefined) {
      const normalizedPull = normalizeContext(pullBinding)
      if (
        !isPlainObject(pullBinding) ||
        pullBinding.version !== 1 ||
        !normalizedPull ||
        !isValidNormalizedContext(normalizedPull)
      ) {
        schemaIssues.push({
          code: 'INVALID_METADATA_SCHEMA',
          source: 'pull_binding',
        })
      }
    }

    // 3. Validate push inflight envelope schema
    if (inflight !== null && inflight !== undefined) {
      const normalizedInflight = normalizeContext(inflight)
      if (
        !isPlainObject(inflight) ||
        (inflight.version !== 1 && inflight.version !== undefined) ||
        !normalizedInflight ||
        !isValidNormalizedContext(normalizedInflight)
      ) {
        schemaIssues.push({
          code: 'INVALID_METADATA_SCHEMA',
          source: 'inflight',
        })
      }
    }

    // 4. Validate bootstrap state schema
    if (bootstrapState !== null && bootstrapState !== undefined) {
      const normalizedBootstrap = normalizeContext(bootstrapState)
      if (
        !isPlainObject(bootstrapState) ||
        bootstrapState.version !== 1 ||
        !normalizedBootstrap ||
        !isValidNormalizedContext(normalizedBootstrap)
      ) {
        schemaIssues.push({
          code: 'INVALID_METADATA_SCHEMA',
          source: 'bootstrap',
        })
      }
    }

    // 5. Validate auto settings schema
    if (autoSettings !== null && autoSettings !== undefined) {
      const autoCtx = extractAutoSettingsContext(autoSettings)
      if (
        !isPlainObject(autoSettings) ||
        autoSettings.version !== 1 ||
        typeof autoSettings.enabled !== 'boolean'
      ) {
        schemaIssues.push({
          code: 'INVALID_METADATA_SCHEMA',
          source: 'auto_sync',
        })
      } else if (autoSettings.enabled === true) {
        if (!autoCtx || !isValidNormalizedContext(autoCtx)) {
          schemaIssues.push({
            code: 'INVALID_METADATA_SCHEMA',
            source: 'auto_sync',
          })
        }
      } else if (autoCtx !== null && !isValidNormalizedContext(autoCtx)) {
        schemaIssues.push({
          code: 'INVALID_METADATA_SCHEMA',
          source: 'auto_sync',
        })
      }
    }

    if (schemaIssues.length > 0) {
      return {
        ok: false,
        code: 'SYNC_CONTEXT_METADATA_INVALID',
        status: 'blocked',
        currentContext,
        canonicalContext: null,
        sources: [],
        issues: schemaIssues,
      }
    }

    // Collect sources and full-context anchors
    const sources = []
    const fullAnchors = []

    if (pushBinding) {
      sources.push('push_binding')
    }

    if (pullBinding) {
      sources.push('pull_binding')
      fullAnchors.push({
        source: 'pull_binding',
        context: normalizeContext(pullBinding),
      })
    }

    if (inflight) {
      sources.push('inflight')
      fullAnchors.push({
        source: 'inflight',
        context: normalizeContext(inflight),
      })
    }

    if (bootstrapState) {
      sources.push('bootstrap')
      fullAnchors.push({
        source: 'bootstrap',
        context: normalizeContext(bootstrapState),
      })
    }

    if (autoSettings && autoSettings.enabled === true) {
      const autoCtx = extractAutoSettingsContext(autoSettings)
      if (autoCtx && isValidNormalizedContext(autoCtx)) {
        sources.push('auto_sync')
        fullAnchors.push({
          source: 'auto_sync',
          context: autoCtx,
        })
      }
    }

    // Check consistency between all full-context anchors
    if (fullAnchors.length > 1) {
      const primary = fullAnchors[0]
      const conflicts = []
      for (let i = 1; i < fullAnchors.length; i++) {
        const candidate = fullAnchors[i]
        if (
          candidate.context.businessId !== primary.context.businessId ||
          candidate.context.outletId !== primary.context.outletId ||
          candidate.context.deviceIdentifier !== primary.context.deviceIdentifier ||
          candidate.context.registeredDeviceId !== primary.context.registeredDeviceId
        ) {
          conflicts.push({
            code: 'METADATA_ANCHOR_CONFLICT',
            source: `${primary.source}_vs_${candidate.source}`,
          })
        }
      }
      if (conflicts.length > 0) {
        return {
          ok: false,
          code: 'SYNC_CONTEXT_METADATA_CONFLICT',
          status: 'blocked',
          currentContext,
          canonicalContext: null,
          sources,
          issues: conflicts,
        }
      }
    }

    let canonicalContext = null
    if (fullAnchors.length > 0) {
      canonicalContext = { ...fullAnchors[0].context }
    } else if (pushBinding) {
      canonicalContext = {
        businessId: pushBinding.businessId,
        outletId: null,
        deviceIdentifier: null,
        registeredDeviceId: null,
      }
    }

    // Check push business binding against current and canonical business
    if (pushBinding) {
      if (pushBinding.businessId !== currentContext.businessId) {
        return {
          ok: false,
          code: 'SYNC_CONTEXT_BUSINESS_MISMATCH',
          status: 'blocked',
          currentContext,
          canonicalContext,
          sources,
          issues: [
            {
              code: 'BUSINESS_ID_MISMATCH',
              source: 'push_binding',
            },
          ],
        }
      }
      if (
        canonicalContext &&
        canonicalContext.businessId !== null &&
        pushBinding.businessId !== canonicalContext.businessId
      ) {
        return {
          ok: false,
          code: 'SYNC_CONTEXT_BUSINESS_MISMATCH',
          status: 'blocked',
          currentContext,
          canonicalContext,
          sources,
          issues: [
            {
              code: 'BUSINESS_ID_MISMATCH',
              source: 'push_binding',
            },
          ],
        }
      }
    }

    // Check current context against canonical context if bound
    if (canonicalContext !== null) {
      if (
        canonicalContext.businessId !== null &&
        currentContext.businessId !== canonicalContext.businessId
      ) {
        return {
          ok: false,
          code: 'SYNC_CONTEXT_BUSINESS_MISMATCH',
          status: 'blocked',
          currentContext,
          canonicalContext,
          sources,
          issues: [
            {
              code: 'BUSINESS_ID_MISMATCH',
              source: 'canonical_context',
            },
          ],
        }
      }

      if (
        canonicalContext.outletId !== null &&
        currentContext.outletId !== canonicalContext.outletId
      ) {
        return {
          ok: false,
          code: 'SYNC_CONTEXT_MISMATCH',
          status: 'blocked',
          currentContext,
          canonicalContext,
          sources,
          issues: [
            {
              code: 'OUTLET_ID_MISMATCH',
              source: 'canonical_context',
            },
          ],
        }
      }

      if (
        canonicalContext.deviceIdentifier !== null &&
        currentContext.deviceIdentifier !== canonicalContext.deviceIdentifier
      ) {
        return {
          ok: false,
          code: 'SYNC_CONTEXT_MISMATCH',
          status: 'blocked',
          currentContext,
          canonicalContext,
          sources,
          issues: [
            {
              code: 'DEVICE_IDENTIFIER_MISMATCH',
              source: 'canonical_context',
            },
          ],
        }
      }

      if (
        canonicalContext.registeredDeviceId !== null &&
        currentContext.registeredDeviceId !== canonicalContext.registeredDeviceId
      ) {
        return {
          ok: false,
          code: 'SYNC_CONTEXT_MISMATCH',
          status: 'blocked',
          currentContext,
          canonicalContext,
          sources,
          issues: [
            {
              code: 'REGISTERED_DEVICE_ID_MISMATCH',
              source: 'canonical_context',
            },
          ],
        }
      }
    }

    // Fresh unbound state
    if (sources.length === 0) {
      return {
        ok: true,
        code: 'SYNC_CONTEXT_UNBOUND',
        status: 'unbound',
        currentContext,
        canonicalContext: null,
        sources: [],
        issues: [],
      }
    }

    // Safe matching state
    return {
      ok: true,
      code: 'SYNC_CONTEXT_SAFE',
      status: 'safe',
      currentContext,
      canonicalContext,
      sources,
      issues: [],
    }
  }

  return {
    inspect,
  }
}
