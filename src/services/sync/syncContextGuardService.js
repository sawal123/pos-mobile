/**
 * Canonical Sync Context Guard Service (P23)
 *
 * Implements a strict, fail-closed, read-only tenant isolation guard for all
 * local sync operations.
 *
 * Rules:
 * - Read-only: zero writes, zero metadata updates, zero network calls.
 * - Fail-closed: invalid schema, missing preconditions, reader failures, or tenant mismatch blocks operations.
 * - Multi-source consistency: checks push_binding (P12), pull_binding (P13),
 *   push_inflight (P12/P21), bootstrap_state (P14), and auto_settings (P20).
 * - Fresh/unbound device or push-only binding: returns ok: true, status: 'unbound'.
 * - Safe matching context with full anchor: returns ok: true, status: 'safe'.
 */

const REQUIRED_CHANGE_KEYS = Object.freeze([
  'categories',
  'products',
  'customers',
  'shifts',
  'sales',
  'sale_items',
  'expenses',
])

function isPlainObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val)
}

function isValidStrictId(val) {
  return typeof val === 'number' && Number.isInteger(val) && val > 0
}

function isValidDeviceIdentifier(val) {
  return (
    typeof val === 'string' &&
    val.trim().length > 0 &&
    val.trim().length <= 128
  )
}

function isValidNonEmptyString(val) {
  return typeof val === 'string' && val.trim().length > 0
}

function isValidDateString(val) {
  if (typeof val !== 'string' || val.trim().length === 0) return false
  const d = new Date(val)
  return !isNaN(d.getTime())
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
    isPlainObject(user) &&
    user.id !== null &&
    user.id !== undefined &&
    String(user.id).trim().length > 0
  const hasCloudAccess = cloudAccess === true
  const hasValidBiz =
    isPlainObject(selectedBusiness) && isValidStrictId(selectedBusiness.id)
  const hasValidOutlet =
    isPlainObject(selectedOutlet) && isValidStrictId(selectedOutlet.id)
  const hasValidDevId = isValidDeviceIdentifier(deviceIdentifier)
  const hasValidRegDevId = isValidStrictId(registeredDeviceId)

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
    businessId: selectedBusiness.id,
    outletId: selectedOutlet.id,
    deviceIdentifier: deviceIdentifier.trim(),
    registeredDeviceId,
  }
}

function isValidFullContext(ctx) {
  if (!isPlainObject(ctx)) return false
  return (
    isValidStrictId(ctx.businessId) &&
    isValidStrictId(ctx.outletId) &&
    isValidDeviceIdentifier(ctx.deviceIdentifier) &&
    isValidStrictId(ctx.registeredDeviceId)
  )
}

function validateInflightEnvelope(val) {
  if (!isPlainObject(val) || val.version !== 1) return false
  if (!isValidNonEmptyString(val.requestId)) return false
  if (!isValidStrictId(val.businessId)) return false
  if (!isValidStrictId(val.outletId)) return false
  if (!isValidDeviceIdentifier(val.deviceIdentifier)) return false
  if (!isValidStrictId(val.registeredDeviceId)) return false
  if (!isValidNonEmptyString(val.createdAt)) return false

  if (!Array.isArray(val.queueSnapshots) || val.queueSnapshots.length === 0) {
    return false
  }

  for (const item of val.queueSnapshots) {
    if (!isPlainObject(item)) return false
    if (!isValidNonEmptyString(item.id)) return false
    if (!isValidNonEmptyString(item.entityType)) return false
    if (item.entityId === null || item.entityId === undefined || String(item.entityId).trim().length === 0) {
      return false
    }
    if (!isValidNonEmptyString(item.operation)) return false
    if (item.updatedAt === null || item.updatedAt === undefined || String(item.updatedAt).trim().length === 0) {
      return false
    }
  }

  if (!isPlainObject(val.changes)) return false
  for (const key of REQUIRED_CHANGE_KEYS) {
    if (!Array.isArray(val.changes[key])) return false
  }

  return true
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

    // Check required reader capabilities (fail closed)
    if (
      !adapter ||
      typeof adapter.loadSyncPushBinding !== 'function' ||
      typeof adapter.loadSyncPullBinding !== 'function' ||
      typeof adapter.loadSyncPushInflight !== 'function' ||
      typeof adapter.loadSyncBootstrapState !== 'function' ||
      typeof adapter.loadSyncAutoSettings !== 'function'
    ) {
      return {
        ok: false,
        code: 'SYNC_CONTEXT_READ_FAILED',
        status: 'blocked',
        currentContext,
        canonicalContext: null,
        sources: [],
        issues: [{ code: 'REQUIRED_READER_MISSING', source: 'adapter' }],
      }
    }

    let pushBinding = null
    let pullBinding = null
    let inflight = null
    let bootstrapState = null
    let autoSettings = null

    try {
      const results = await Promise.all([
        adapter.loadSyncPushBinding(),
        adapter.loadSyncPullBinding(),
        adapter.loadSyncPushInflight(),
        adapter.loadSyncBootstrapState(),
        adapter.loadSyncAutoSettings(),
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

    // 1. Validate push binding schema (Actual P12: { businessId, boundAt }, NO version)
    if (pushBinding !== null && pushBinding !== undefined) {
      const isValidPushBinding =
        isPlainObject(pushBinding) &&
        isValidStrictId(pushBinding.businessId) &&
        isValidNonEmptyString(pushBinding.boundAt)

      if (!isValidPushBinding) {
        schemaIssues.push({
          code: 'INVALID_METADATA_SCHEMA',
          source: 'push_binding',
        })
      }
    }

    // 2. Validate pull binding schema (Actual P13: { businessId, outletId, deviceIdentifier, registeredDeviceId, boundAt }, NO version)
    if (pullBinding !== null && pullBinding !== undefined) {
      const isValidPullBinding =
        isPlainObject(pullBinding) &&
        isValidStrictId(pullBinding.businessId) &&
        isValidStrictId(pullBinding.outletId) &&
        isValidDeviceIdentifier(pullBinding.deviceIdentifier) &&
        isValidStrictId(pullBinding.registeredDeviceId) &&
        isValidNonEmptyString(pullBinding.boundAt)

      if (!isValidPullBinding) {
        schemaIssues.push({
          code: 'INVALID_METADATA_SCHEMA',
          source: 'pull_binding',
        })
      }
    }

    // 3. Validate push inflight envelope schema (Actual P12/P21 structural envelope)
    if (inflight !== null && inflight !== undefined) {
      if (!validateInflightEnvelope(inflight)) {
        schemaIssues.push({
          code: 'INVALID_METADATA_SCHEMA',
          source: 'inflight',
        })
      }
    }

    // 4. Validate bootstrap state schema (Actual P14)
    if (bootstrapState !== null && bootstrapState !== undefined) {
      const isValidBootstrapState =
        isPlainObject(bootstrapState) &&
        bootstrapState.version === 1 &&
        ['staged', 'completed'].includes(bootstrapState.status) &&
        isValidStrictId(bootstrapState.businessId) &&
        isValidStrictId(bootstrapState.outletId) &&
        isValidDeviceIdentifier(bootstrapState.deviceIdentifier) &&
        isValidStrictId(bootstrapState.registeredDeviceId) &&
        isValidNonEmptyString(bootstrapState.stagedAt) &&
        isPlainObject(bootstrapState.counts)

      if (!isValidBootstrapState) {
        schemaIssues.push({
          code: 'INVALID_METADATA_SCHEMA',
          source: 'bootstrap',
        })
      }
    }

    // 5. Validate auto settings schema (Actual P20: version: 1, enabled: boolean, context: null | {...}, updatedAt)
    if (autoSettings !== null && autoSettings !== undefined) {
      const autoKeys = Object.keys(autoSettings)
      const hasExtraKeys = autoKeys.some(key => !['version', 'enabled', 'context', 'updatedAt'].includes(key))

      const isValidBaseShape =
        isPlainObject(autoSettings) &&
        autoSettings.version === 1 &&
        typeof autoSettings.enabled === 'boolean' &&
        isValidDateString(autoSettings.updatedAt) &&
        !hasExtraKeys

      let isContextValid = true
      if (isValidBaseShape) {
        if (autoSettings.context !== null && autoSettings.context !== undefined) {
          if (!isPlainObject(autoSettings.context)) {
            isContextValid = false
          } else {
            const contextKeys = Object.keys(autoSettings.context)
            const hasExtraContextKeys = contextKeys.some(key => !['businessId', 'outletId', 'deviceIdentifier', 'registeredDeviceId'].includes(key))
            if (hasExtraContextKeys || !isValidFullContext(autoSettings.context)) {
              isContextValid = false
            }
          }
        }
      }

      if (!isValidBaseShape) {
        schemaIssues.push({
          code: 'INVALID_METADATA_SCHEMA',
          source: 'auto_sync',
        })
      } else if (autoSettings.enabled === true) {
        if (!autoSettings.context || !isContextValid) {
          schemaIssues.push({
            code: 'INVALID_METADATA_SCHEMA',
            source: 'auto_sync',
          })
        }
      } else if (autoSettings.context !== null && !isContextValid) {
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
        context: {
          businessId: pullBinding.businessId,
          outletId: pullBinding.outletId,
          deviceIdentifier: pullBinding.deviceIdentifier.trim(),
          registeredDeviceId: pullBinding.registeredDeviceId,
        },
      })
    }

    if (inflight) {
      sources.push('inflight')
      fullAnchors.push({
        source: 'inflight',
        context: {
          businessId: inflight.businessId,
          outletId: inflight.outletId,
          deviceIdentifier: inflight.deviceIdentifier.trim(),
          registeredDeviceId: inflight.registeredDeviceId,
        },
      })
    }

    if (bootstrapState) {
      sources.push('bootstrap')
      fullAnchors.push({
        source: 'bootstrap',
        context: {
          businessId: bootstrapState.businessId,
          outletId: bootstrapState.outletId,
          deviceIdentifier: bootstrapState.deviceIdentifier.trim(),
          registeredDeviceId: bootstrapState.registeredDeviceId,
        },
      })
    }

    if (autoSettings && autoSettings.enabled === true && autoSettings.context) {
      sources.push('auto_sync')
      fullAnchors.push({
        source: 'auto_sync',
        context: {
          businessId: autoSettings.context.businessId,
          outletId: autoSettings.context.outletId,
          deviceIdentifier: autoSettings.context.deviceIdentifier.trim(),
          registeredDeviceId: autoSettings.context.registeredDeviceId,
        },
      })
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

    // Form canonicalContext ONLY when at least one full anchor exists.
    // Push-only binding is business-level only, NOT canonical full context.
    const canonicalContext =
      fullAnchors.length > 0 ? { ...fullAnchors[0].context } : null

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
      if (currentContext.businessId !== canonicalContext.businessId) {
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

      if (currentContext.outletId !== canonicalContext.outletId) {
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

      if (currentContext.deviceIdentifier !== canonicalContext.deviceIdentifier) {
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

      if (currentContext.registeredDeviceId !== canonicalContext.registeredDeviceId) {
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

    // If no full anchor (fresh device OR push-only binding matching current business): UNBOUND
    if (fullAnchors.length === 0) {
      return {
        ok: true,
        code: 'SYNC_CONTEXT_UNBOUND',
        status: 'unbound',
        currentContext,
        canonicalContext: null,
        sources,
        issues: [],
      }
    }

    // Full anchor exists and matches current context: SAFE
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
