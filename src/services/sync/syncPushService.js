import { pushSyncRequest } from './syncPushTransport'
import { createSyncQueueService } from './syncQueueService'
import { createSyncIdentityRegistry, generateUuid } from './syncIdentityRegistry'
import { mapOutboxEntries } from './contractMapper'
import { SYNC_ENTITY_TYPES, SYNC_RESERVED_CATEGORY } from './syncConstants'
import { getToken } from '@/services/cloud/tokenRepository'

const MAX_ENTITY_PER_TYPE = 100

function isBootstrapContextMatch(
  bootstrapState,
  { businessId, outletId, deviceIdentifier, registeredDeviceId },
) {
  return (
    Number(bootstrapState.businessId) === Number(businessId) &&
    Number(bootstrapState.outletId) === Number(outletId) &&
    String(bootstrapState.deviceIdentifier) === String(deviceIdentifier) &&
    String(bootstrapState.registeredDeviceId) === String(registeredDeviceId)
  )
}

async function mapServerConflictToQueueSnapshot(conflict, envelope, activeRegistry) {
  const { entity, sync_id } = conflict
  const queueSnapshots = Array.isArray(envelope?.queueSnapshots) ? envelope.queueSnapshots : []
  const changes = envelope?.changes || {}

  const entityTypeMap = {
    categories: SYNC_ENTITY_TYPES.CATEGORY,
    products: SYNC_ENTITY_TYPES.PRODUCT,
    customers: SYNC_ENTITY_TYPES.CUSTOMER,
    expenses: SYNC_ENTITY_TYPES.EXPENSE,
    sales: SYNC_ENTITY_TYPES.TRANSACTION,
    sale_items: SYNC_ENTITY_TYPES.TRANSACTION,
  }
  const targetEntityType = entityTypeMap[entity]
  if (!targetEntityType) {
    return {
      snapshot: null,
      queueId: null,
      entityType: null,
      entityId: null,
    }
  }

  if (activeRegistry && typeof activeRegistry.ensureLoaded === 'function') {
    await activeRegistry.ensureLoaded()
  }

  // 1. Transaction / Sale / SaleItem mapping
  if (entity === 'sales' || entity === 'sale_items') {
    let targetSaleSyncId = sync_id
    if (entity === 'sale_items') {
      const item = (changes.sale_items || []).find((si) => si.sync_id === sync_id)
      if (item && item.sale_sync_id) {
        targetSaleSyncId = item.sale_sync_id
      } else {
        return {
          snapshot: null,
          queueId: null,
          entityType: SYNC_ENTITY_TYPES.TRANSACTION,
          entityId: null,
        }
      }
    }

    for (const snap of queueSnapshots) {
      if (snap.entityType !== SYNC_ENTITY_TYPES.TRANSACTION) continue
      const trxId = snap.payload?.id ?? snap.entityId
      const snapSyncId = activeRegistry && typeof activeRegistry.peekSyncId === 'function'
        ? activeRegistry.peekSyncId(SYNC_ENTITY_TYPES.TRANSACTION, trxId)
        : null
      if (
        (snapSyncId && snapSyncId.toLowerCase() === targetSaleSyncId.toLowerCase()) ||
        String(snap.entityId).toLowerCase() === targetSaleSyncId.toLowerCase() ||
        String(snap.id).toLowerCase() === targetSaleSyncId.toLowerCase()
      ) {
        return {
          snapshot: snap,
          queueId: snap.id,
          entityType: SYNC_ENTITY_TYPES.TRANSACTION,
          entityId: trxId,
        }
      }
    }

    return {
      snapshot: null,
      queueId: null,
      entityType: SYNC_ENTITY_TYPES.TRANSACTION,
      entityId: null,
    }
  }

  // 2. Product mapping
  if (entity === 'products') {
    for (const snap of queueSnapshots) {
      if (snap.entityType !== SYNC_ENTITY_TYPES.PRODUCT) continue
      const prodId = snap.payload?.id ?? snap.entityId
      const snapSyncId = activeRegistry && typeof activeRegistry.peekSyncId === 'function'
        ? activeRegistry.peekSyncId(SYNC_ENTITY_TYPES.PRODUCT, prodId)
        : null
      if (
        (snapSyncId && snapSyncId.toLowerCase() === sync_id.toLowerCase()) ||
        String(snap.entityId).toLowerCase() === sync_id.toLowerCase() ||
        String(snap.id).toLowerCase() === sync_id.toLowerCase()
      ) {
        return {
          snapshot: snap,
          queueId: snap.id,
          entityType: SYNC_ENTITY_TYPES.PRODUCT,
          entityId: prodId,
        }
      }
    }

    return {
      snapshot: null,
      queueId: null,
      entityType: SYNC_ENTITY_TYPES.PRODUCT,
      entityId: null,
    }
  }

  // 3. Customer mapping
  if (entity === 'customers') {
    for (const snap of queueSnapshots) {
      if (snap.entityType !== SYNC_ENTITY_TYPES.CUSTOMER) continue
      const custId = snap.payload?.id ?? snap.entityId
      const snapSyncId = activeRegistry && typeof activeRegistry.peekSyncId === 'function'
        ? activeRegistry.peekSyncId(SYNC_ENTITY_TYPES.CUSTOMER, custId)
        : null
      if (
        (snapSyncId && snapSyncId.toLowerCase() === sync_id.toLowerCase()) ||
        String(snap.entityId).toLowerCase() === sync_id.toLowerCase() ||
        String(snap.id).toLowerCase() === sync_id.toLowerCase()
      ) {
        return {
          snapshot: snap,
          queueId: snap.id,
          entityType: SYNC_ENTITY_TYPES.CUSTOMER,
          entityId: custId,
        }
      }
    }

    return {
      snapshot: null,
      queueId: null,
      entityType: SYNC_ENTITY_TYPES.CUSTOMER,
      entityId: null,
    }
  }

  // 4. Category mapping
  if (entity === 'categories') {
    for (const snap of queueSnapshots) {
      if (snap.entityType !== SYNC_ENTITY_TYPES.CATEGORY) continue
      const catName = snap.payload?.name || snap.entityId
      const snapSyncId = activeRegistry && typeof activeRegistry.peekSyncId === 'function'
        ? activeRegistry.peekSyncId(SYNC_ENTITY_TYPES.CATEGORY, catName)
        : null
      if (
        (snapSyncId && snapSyncId.toLowerCase() === sync_id.toLowerCase()) ||
        String(snap.entityId).toLowerCase() === sync_id.toLowerCase() ||
        String(snap.id).toLowerCase() === sync_id.toLowerCase()
      ) {
        return {
          snapshot: snap,
          queueId: snap.id,
          entityType: SYNC_ENTITY_TYPES.CATEGORY,
          entityId: catName,
        }
      }
    }

    return {
      snapshot: null,
      queueId: null,
      entityType: SYNC_ENTITY_TYPES.CATEGORY,
      entityId: null,
    }
  }

  // 5. Expense mapping
  if (entity === 'expenses') {
    for (const snap of queueSnapshots) {
      if (snap.entityType !== SYNC_ENTITY_TYPES.EXPENSE) continue
      const expId = snap.payload?.id ?? snap.entityId
      const snapSyncId = activeRegistry && typeof activeRegistry.peekSyncId === 'function'
        ? activeRegistry.peekSyncId(SYNC_ENTITY_TYPES.EXPENSE, expId)
        : null
      if (
        (snapSyncId && snapSyncId.toLowerCase() === sync_id.toLowerCase()) ||
        String(snap.entityId).toLowerCase() === sync_id.toLowerCase() ||
        String(snap.id).toLowerCase() === sync_id.toLowerCase()
      ) {
        return {
          snapshot: snap,
          queueId: snap.id,
          entityType: SYNC_ENTITY_TYPES.EXPENSE,
          entityId: expId,
        }
      }
    }

    return {
      snapshot: null,
      queueId: null,
      entityType: SYNC_ENTITY_TYPES.EXPENSE,
      entityId: null,
    }
  }

  return {
    snapshot: null,
    queueId: null,
    entityType: null,
    entityId: null,
  }
}

/**
 * Creates a P12 Sync Push Service.
 * Coordinates manual push from local durable outbox to Laravel /api/sync/push.
 *
 * @param {object} options
 * @param {object} options.adapter Persistence adapter (SQLite / Memory)
 * @param {object} [options.scheduler] Persistence serializer / scheduler
 * @param {object} [options.queueService] SyncQueueService instance
 * @param {object} [options.registry] Durable sync identity registry instance
 * @param {Function} [options.tokenFetcher] Function returning Bearer token
 * @param {Function} [options.transport] Transport function (defaults to pushSyncRequest)
 * @param {object} [options.cloudStore] CloudSessionStore instance
 * @returns {object}
 */
export function createSyncPushService({
  adapter,
  scheduler = null,
  queueService = null,
  registry = null,
  tokenFetcher = getToken,
  transport = pushSyncRequest,
  cloudStore = null,
  contextGuardService = null,
} = {}) {
  const activeQueueService = queueService ?? createSyncQueueService({ adapter, scheduler })
  const activeRegistry = registry ?? createSyncIdentityRegistry({ adapter, scheduler })
  let isPushing = false

  /**
   * Evaluates if any entity collection in accumulated changes would exceed server v1 limit.
   */
  function wouldExceedLimit(accumulated, additions) {
    return (
      accumulated.categories.length + additions.categories.length > MAX_ENTITY_PER_TYPE ||
      accumulated.products.length + additions.products.length > MAX_ENTITY_PER_TYPE ||
      accumulated.customers.length + additions.customers.length > MAX_ENTITY_PER_TYPE ||
      accumulated.shifts.length + additions.shifts.length > MAX_ENTITY_PER_TYPE ||
      accumulated.sales.length + additions.sales.length > MAX_ENTITY_PER_TYPE ||
      accumulated.sale_items.length + additions.sale_items.length > MAX_ENTITY_PER_TYPE ||
      accumulated.expenses.length + additions.expenses.length > MAX_ENTITY_PER_TYPE
    )
  }

  function singleEntryExceedsLimit(changes) {
    return (
      changes.categories.length > MAX_ENTITY_PER_TYPE ||
      changes.products.length > MAX_ENTITY_PER_TYPE ||
      changes.customers.length > MAX_ENTITY_PER_TYPE ||
      changes.shifts.length > MAX_ENTITY_PER_TYPE ||
      changes.sales.length > MAX_ENTITY_PER_TYPE ||
      changes.sale_items.length > MAX_ENTITY_PER_TYPE ||
      changes.expenses.length > MAX_ENTITY_PER_TYPE
    )
  }

  /**
   * Executes a single manual push iteration from outbox to /api/sync/push.
   *
   * @param {object} [options]
   * @param {string} [options.token] Optional explicit token override
   * @param {object} [options.context] Optional explicit cloud context override
   * @returns {Promise<object>}
   */
  async function pushNow(options = {}) {
    if (isPushing) {
      return {
        ok: false,
        code: 'PUSH_ALREADY_IN_PROGRESS',
        message: 'A sync push operation is already in progress.',
        error: { code: 'PUSH_ALREADY_IN_PROGRESS', message: 'A sync push operation is already in progress.' },
        remaining: await activeQueueService.countPending(),
        sentQueueIds: [],
        removedQueueIds: [],
        preservedQueueIds: [],
        blocked: [],
        warnings: [],
      }
    }

    isPushing = true

    try {
      // ── 1. Resolve & validate preconditions ──────────────────────────────────
      const user = options.context?.user ?? cloudStore?.user
      const selectedBusiness = options.context?.selectedBusiness ?? cloudStore?.selectedBusiness
      const selectedOutlet = options.context?.selectedOutlet ?? cloudStore?.selectedOutlet
      const cloudAccess = options.context?.cloudAccess ?? cloudStore?.cloudAccess
      const deviceIdentifier = options.context?.deviceIdentifier ?? cloudStore?.deviceIdentifier
      const registeredDeviceId =
        options.context?.registeredDeviceId ?? cloudStore?.registeredDeviceId

      const token = options.token ?? (await tokenFetcher())

      const hasValidUser = user !== null && user !== undefined
      const hasToken = typeof token === 'string' && token.trim().length > 0
      const hasBusiness = selectedBusiness !== null && selectedBusiness !== undefined && selectedBusiness.id !== undefined
      const hasCloudAccess = cloudAccess === true
      const hasOutlet = selectedOutlet !== null && selectedOutlet !== undefined && selectedOutlet.id !== undefined
      const hasDeviceIdentifier = typeof deviceIdentifier === 'string' && deviceIdentifier.trim().length > 0
      const hasRegisteredDeviceId = registeredDeviceId !== null && registeredDeviceId !== undefined

      if (
        !hasValidUser ||
        !hasToken ||
        !hasBusiness ||
        !hasCloudAccess ||
        !hasOutlet ||
        !hasDeviceIdentifier ||
        !hasRegisteredDeviceId
      ) {
        const remaining = await activeQueueService.countPending()
        return {
          ok: false,
          code: 'PRECONDITION_FAILED',
          message: 'Cloud authentication, business, outlet, and registered device are required for sync push.',
          error: {
            code: 'PRECONDITION_FAILED',
            message: 'Cloud authentication, business, outlet, and registered device are required for sync push.',
          },
          remaining,
          sentQueueIds: [],
          removedQueueIds: [],
          preservedQueueIds: [],
          blocked: [],
          warnings: [],
        }
      }

      // ── 1.5. P23 Context Guard Inspection ──────────────────────────────────
      const guardContext = {
        user: user ? { id: user.id } : null,
        selectedBusiness: selectedBusiness ? { id: selectedBusiness.id } : null,
        selectedOutlet: selectedOutlet ? { id: selectedOutlet.id } : null,
        cloudAccess: cloudAccess === true,
        deviceIdentifier,
        registeredDeviceId,
      }

      if (contextGuardService && typeof contextGuardService.inspect === 'function') {
        const guard = await contextGuardService.inspect({ context: guardContext })
        if (!guard.ok) {
          const remaining = await activeQueueService.countPending()
          return {
            ok: false,
            code: 'SYNC_CONTEXT_GUARD_BLOCKED',
            contextGuardCode: guard.code,
            message: 'Sync push operation blocked by context guard.',
            error: {
              code: 'SYNC_CONTEXT_GUARD_BLOCKED',
              contextGuardCode: guard.code,
            },
            remaining,
            sentQueueIds: [],
            removedQueueIds: [],
            preservedQueueIds: [],
            blocked: [],
            warnings: [],
          }
        }
      }

      // ── 2. Business binding validation (anti-cross-tenant leakage) ───────────
      const currentBusinessId = Number(selectedBusiness.id)
      const existingBinding = adapter && typeof adapter.loadSyncPushBinding === 'function'
        ? await adapter.loadSyncPushBinding()
        : null

      if (existingBinding && existingBinding.businessId !== currentBusinessId) {
        const remaining = await activeQueueService.countPending()
        return {
          ok: false,
          code: 'SYNC_BUSINESS_BINDING_MISMATCH',
          message: `Sync push blocked: local outbox is bound to business ID ${existingBinding.businessId}, but current business is ${currentBusinessId}.`,
          error: {
            code: 'SYNC_BUSINESS_BINDING_MISMATCH',
            message: `Sync push blocked: local outbox is bound to business ID ${existingBinding.businessId}, but current business is ${currentBusinessId}.`,
          },
          remaining,
          sentQueueIds: [],
          removedQueueIds: [],
          preservedQueueIds: [],
          blocked: [],
          warnings: [],
        }
      }

      // ── 2.5. Bootstrap context validation (always enforced if staged/completed) ──
      const bootstrapState = adapter && typeof adapter.loadSyncBootstrapState === 'function'
        ? await adapter.loadSyncBootstrapState()
        : null

      if (bootstrapState && (bootstrapState.status === 'staged' || bootstrapState.status === 'completed')) {
        const isMatch = isBootstrapContextMatch(bootstrapState, {
          businessId: currentBusinessId,
          outletId: selectedOutlet.id,
          deviceIdentifier,
          registeredDeviceId,
        })
        if (!isMatch) {
          const remaining = await activeQueueService.countPending()
          return {
            ok: false,
            code: 'SYNC_BOOTSTRAP_CONTEXT_MISMATCH',
            message: 'Bootstrap context does not match current cloud context.',
            error: { code: 'SYNC_BOOTSTRAP_CONTEXT_MISMATCH' },
            remaining,
            sentQueueIds: [],
            removedQueueIds: [],
            preservedQueueIds: [],
            blocked: [],
            warnings: [],
          }
        }
      }

      // ── 3. Check for in-flight envelope (idempotent retry) ────────────────────
      const existingEnvelope = adapter && typeof adapter.loadSyncPushInflight === 'function'
        ? await adapter.loadSyncPushInflight()
        : null

      let requestId
      let envelope
      let isReusedEnvelope = false
      const blocked = []
      const warnings = []

      if (existingEnvelope) {
        const isBusinessMatch = Number(existingEnvelope.businessId) === currentBusinessId
        const isOutletMatch = Number(existingEnvelope.outletId) === Number(selectedOutlet.id)
        const isDeviceMatch = String(existingEnvelope.deviceIdentifier) === String(deviceIdentifier)
        const isRegisteredDeviceMatch =
          String(existingEnvelope.registeredDeviceId) === String(registeredDeviceId)

        if (!isBusinessMatch || !isOutletMatch || !isDeviceMatch || !isRegisteredDeviceMatch) {
          const remaining = await activeQueueService.countPending()
          return {
            ok: false,
            code: 'SYNC_ENVELOPE_CONTEXT_MISMATCH',
            message: `In-flight envelope context does not match current cloud context.`,
            error: {
              code: 'SYNC_ENVELOPE_CONTEXT_MISMATCH',
              message: `In-flight envelope context does not match current cloud context.`,
            },
            remaining,
            sentQueueIds: [],
            removedQueueIds: [],
            preservedQueueIds: [],
            blocked,
            warnings,
          }
        }

        // Defense check: if existingEnvelope already has conflicts recorded in sync_conflicts_v1
        const conflictsState =
          adapter && typeof adapter.loadSyncConflicts === 'function'
            ? (await adapter.loadSyncConflicts()) || { version: 1, conflicts: [] }
            : { version: 1, conflicts: [] }

        const matchingConflicts = (
          Array.isArray(conflictsState?.conflicts) ? conflictsState.conflicts : []
        ).filter((c) => String(c.requestId) === String(existingEnvelope.requestId))

        if (matchingConflicts.length > 0) {
          const hasOpenConflict = matchingConflicts.some((c) => c.status === 'open')
          if (hasOpenConflict) {
            const remaining = await activeQueueService.countPending()
            return {
              ok: false,
              code: 'SYNC_CONFLICT_PENDING',
              message: 'In-flight envelope has open sync conflicts that must be resolved first.',
              error: {
                code: 'SYNC_CONFLICT_PENDING',
                message: 'In-flight envelope has open sync conflicts that must be resolved first.',
              },
              remaining,
              sentQueueIds: [],
              removedQueueIds: [],
              preservedQueueIds: [],
              blocked: [],
              warnings: [],
            }
          } else {
            // All conflicts for this request were resolved, but stale envelope remained in storage
            if (adapter && typeof adapter.clearSyncPushInflight === 'function') {
              await adapter.clearSyncPushInflight()
            }
            const remaining = await activeQueueService.countPending()
            return {
              ok: false,
              code: 'SYNC_STALE_CONFLICT_ENVELOPE_CLEARED',
              message: 'Stale conflicted envelope cleared. Please sync again.',
              error: {
                code: 'SYNC_STALE_CONFLICT_ENVELOPE_CLEARED',
                message: 'Stale conflicted envelope cleared. Please sync again.',
              },
              remaining,
              sentQueueIds: [],
              removedQueueIds: [],
              preservedQueueIds: [],
              blocked: [],
              warnings: [],
            }
          }
        }

        // When envelope exists but push binding is missing, validate that bootstrap state exists
        if (!existingBinding) {
          if (!bootstrapState || (bootstrapState.status !== 'staged' && bootstrapState.status !== 'completed')) {
            const remaining = await activeQueueService.countPending()
            return {
              ok: false,
              code: 'SYNC_BOOTSTRAP_REQUIRED',
              message: 'Initial bootstrap is required before first cloud sync.',
              error: { code: 'SYNC_BOOTSTRAP_REQUIRED' },
              remaining,
              sentQueueIds: [],
              removedQueueIds: [],
              preservedQueueIds: [],
              blocked: [],
              warnings: [],
            }
          }
        }

        requestId = existingEnvelope.requestId
        envelope = existingEnvelope
        isReusedEnvelope = true
      } else {
        // ── 4. Build new batch from outbox queue ────────────────────────────────
        const totalPending = await activeQueueService.countPending()

        if (totalPending === 0) {
          return {
            ok: true,
            requestId: null,
            duplicate: false,
            sentQueueIds: [],
            removedQueueIds: [],
            preservedQueueIds: [],
            blocked: [],
            warnings: [],
            remaining: 0,
            error: null,
          }
        }

        const pendingItems = await activeQueueService.listPending({ limit: totalPending })

        if (pendingItems.length === 0) {
          return {
            ok: true,
            requestId: null,
            duplicate: false,
            sentQueueIds: [],
            removedQueueIds: [],
            preservedQueueIds: [],
            blocked: [],
            warnings: [],
            remaining: 0,
            error: null,
          }
        }

        const conflictsState =
          adapter && typeof adapter.loadSyncConflicts === 'function'
            ? (await adapter.loadSyncConflicts()) || { version: 1, conflicts: [] }
            : { version: 1, conflicts: [] }

        const openConflictQueueIds = new Set(
          (Array.isArray(conflictsState.conflicts) ? conflictsState.conflicts : [])
            .filter((c) => c.status === 'open')
            .map((c) => c.queueId),
        )

        // Build sets of pending local parent keys in outbox queue for dependency check
        const pendingCatKeys = new Set()
        const pendingCustKeys = new Set()
        const pendingProdKeys = new Set()

        for (const item of pendingItems) {
          if (item.entityType === SYNC_ENTITY_TYPES.CATEGORY) {
            const catName = item.payload?.name || item.entityId
            if (catName) pendingCatKeys.add(String(catName).trim())
          } else if (item.entityType === SYNC_ENTITY_TYPES.CUSTOMER) {
            if (item.entityId) pendingCustKeys.add(String(item.entityId))
          } else if (item.entityType === SYNC_ENTITY_TYPES.PRODUCT) {
            if (item.entityId) pendingProdKeys.add(String(item.entityId))
          }
        }

        const selectedCatKeys = new Set()
        const selectedCustKeys = new Set()
        const selectedProdKeys = new Set()

        const phase1 = []
        const phase2 = []
        const phase3 = []

        for (const item of pendingItems) {
          if (item.entityType === SYNC_ENTITY_TYPES.CATEGORY) {
            phase1.push(item)
          } else if (item.entityType === SYNC_ENTITY_TYPES.TRANSACTION) {
            phase3.push(item)
          } else {
            phase2.push(item)
          }
        }

        const orderedCandidates = [...phase1, ...phase2, ...phase3]

        const accumulatedChanges = {
          categories: [],
          products: [],
          customers: [],
          shifts: [],
          sales: [],
          sale_items: [],
          expenses: [],
        }

        const batchSnapshots = []

        for (const entry of orderedCandidates) {
          // Filter out candidates with open conflict
          if (openConflictQueueIds.has(entry.id)) {
            continue
          }

          // Dependency pre-check before mapping
          if (entry.entityType === SYNC_ENTITY_TYPES.PRODUCT) {
            const prodCat = entry.payload?.category ? String(entry.payload.category).trim() : null
            if (
              prodCat &&
              prodCat.toLowerCase() !== SYNC_RESERVED_CATEGORY.toLowerCase() &&
              pendingCatKeys.has(prodCat) &&
              !selectedCatKeys.has(prodCat)
            ) {
              // Parent Category is pending in queue but not selected in this batch -> defer
              continue
            }
          } else if (entry.entityType === SYNC_ENTITY_TYPES.TRANSACTION) {
            const custId = entry.payload?.customerId ?? entry.payload?.customer_id
            if (custId && pendingCustKeys.has(String(custId)) && !selectedCustKeys.has(String(custId))) {
              // Parent Customer is pending in queue but not selected in this batch -> defer
              continue
            }

            const trxItems = Array.isArray(entry.payload?.items) ? entry.payload.items : []
            let hasUnselectedPendingProduct = false
            for (const it of trxItems) {
              const pId = it.id ?? it.productId ?? it.product_id
              if (pId && pendingProdKeys.has(String(pId)) && !selectedProdKeys.has(String(pId))) {
                hasUnselectedPendingProduct = true
                break
              }
            }
            if (hasUnselectedPendingProduct) {
              // Parent Product is pending in queue but not selected in this batch -> defer
              continue
            }
          }

          let mapped
          try {
            mapped = await mapOutboxEntries([entry], { registry: activeRegistry, adapter })
          } catch (mapErr) {
            console.error(`Failed to map queue item ${entry.id}.`, mapErr)
            blocked.push({
              queueId: entry.id,
              entityType: entry.entityType,
              entityId: entry.entityId,
              operation: entry.operation,
              code: 'MAPPING_EXCEPTION',
              message: mapErr instanceof Error ? mapErr.message : String(mapErr),
            })
            continue
          }

          if (mapped.blocked && mapped.blocked.length > 0) {
            blocked.push(...mapped.blocked)
            continue
          }

          if (mapped.warnings && mapped.warnings.length > 0) {
            warnings.push(...mapped.warnings)
          }

          const isMapped =
            Array.isArray(mapped.mappedQueueIds) && mapped.mappedQueueIds.includes(entry.id)
          const hasServerChanges =
            mapped.changes.categories.length > 0 ||
            mapped.changes.products.length > 0 ||
            mapped.changes.customers.length > 0 ||
            mapped.changes.shifts.length > 0 ||
            mapped.changes.sales.length > 0 ||
            mapped.changes.sale_items.length > 0 ||
            mapped.changes.expenses.length > 0

          if (!isMapped || !hasServerChanges) {
            blocked.push({
              queueId: entry.id,
              entityType: entry.entityType,
              entityId: entry.entityId,
              operation: entry.operation,
              code: 'NO_MAPPED_SERVER_CHANGE',
              message: 'Queue item did not produce any server-compatible changes.',
            })
            continue
          }

          if (singleEntryExceedsLimit(mapped.changes)) {
            blocked.push({
              queueId: entry.id,
              entityType: entry.entityType,
              entityId: entry.entityId,
              operation: entry.operation,
              code: 'SERVER_V1_ENTITY_LIMIT_EXCEEDED',
              message: 'Single queue entry exceeds server v1 limit of 100 entities',
            })
            continue
          }

          if (wouldExceedLimit(accumulatedChanges, mapped.changes)) {
            // Batch limit for this entity type reached, defer candidate for next push batch
            continue
          }

          // Accumulate changes
          accumulatedChanges.categories.push(...mapped.changes.categories)
          accumulatedChanges.products.push(...mapped.changes.products)
          accumulatedChanges.customers.push(...mapped.changes.customers)
          accumulatedChanges.shifts.push(...mapped.changes.shifts)
          accumulatedChanges.sales.push(...mapped.changes.sales)
          accumulatedChanges.sale_items.push(...mapped.changes.sale_items)
          accumulatedChanges.expenses.push(...mapped.changes.expenses)

          if (entry.entityType === SYNC_ENTITY_TYPES.CATEGORY) {
            const catName = entry.payload?.name || entry.entityId
            if (catName) selectedCatKeys.add(String(catName).trim())
          } else if (entry.entityType === SYNC_ENTITY_TYPES.CUSTOMER) {
            if (entry.entityId) selectedCustKeys.add(String(entry.entityId))
          } else if (entry.entityType === SYNC_ENTITY_TYPES.PRODUCT) {
            if (entry.entityId) selectedProdKeys.add(String(entry.entityId))
          }

          batchSnapshots.push({
            id: entry.id,
            entityType: entry.entityType,
            entityId: entry.entityId,
            operation: entry.operation,
            payload: entry.payload,
            updatedAt: entry.updatedAt,
          })
        }

        if (batchSnapshots.length === 0) {
          const allPendingConflicted =
            pendingItems.length > 0 &&
            pendingItems.every((item) => openConflictQueueIds.has(item.id))

          if (allPendingConflicted) {
            const remaining = await activeQueueService.countPending()
            return {
              ok: false,
              code: 'SYNC_CONFLICT_PENDING',
              message: 'All pending sync mutations are blocked by open conflicts.',
              error: {
                code: 'SYNC_CONFLICT_PENDING',
                message: 'All pending sync mutations are blocked by open conflicts.',
              },
              remaining,
              sentQueueIds: [],
              removedQueueIds: [],
              preservedQueueIds: [],
              blocked,
              warnings,
            }
          }

          const remaining = await activeQueueService.countPending()
          return {
            ok: true,
            requestId: null,
            duplicate: false,
            sentQueueIds: [],
            removedQueueIds: [],
            preservedQueueIds: [],
            blocked,
            warnings,
            remaining,
            error: null,
          }
        }

        // ── 4.5. Verify Bootstrap State when no existing push binding
        if (!existingBinding) {
          if (!bootstrapState || (bootstrapState.status !== 'staged' && bootstrapState.status !== 'completed')) {
            const remaining = await activeQueueService.countPending()
            return {
              ok: false,
              code: 'SYNC_BOOTSTRAP_REQUIRED',
              message: 'Initial bootstrap is required before first cloud sync.',
              error: { code: 'SYNC_BOOTSTRAP_REQUIRED' },
              remaining,
              sentQueueIds: [],
              removedQueueIds: [],
              preservedQueueIds: [],
              blocked: [],
              warnings: [],
            }
          }
        }

        // ── 4.6. Persist business binding on first real push before in-flight envelope and HTTP
        if (!existingBinding && adapter && typeof adapter.saveSyncPushBinding === 'function') {
          try {
            await adapter.saveSyncPushBinding({
              businessId: currentBusinessId,
              boundAt: new Date().toISOString(),
            })
          } catch (err) {
            const remaining = await activeQueueService.countPending()
            return {
              ok: false,
              code: 'SYNC_BINDING_PERSIST_FAILED',
              message: 'Failed to persist business binding before push.',
              error: err,
              remaining,
              sentQueueIds: [],
              removedQueueIds: [],
              preservedQueueIds: [],
              blocked: [],
              warnings: [],
            }
          }
        }

        requestId = generateUuid()
        envelope = {
          version: 1,
          requestId,
          businessId: currentBusinessId,
          outletId: Number(selectedOutlet.id),
          deviceIdentifier: String(deviceIdentifier),
          registeredDeviceId,
          createdAt: new Date().toISOString(),
          queueSnapshots: batchSnapshots,
          changes: accumulatedChanges,
        }

        if (adapter && typeof adapter.saveSyncPushInflight === 'function') {
          try {
            await adapter.saveSyncPushInflight(envelope)
          } catch (err) {
            const remaining = await activeQueueService.countPending()
            return {
              ok: false,
              code: 'SYNC_ENVELOPE_PERSIST_FAILED',
              message: 'Failed to persist in-flight sync push envelope.',
              error: err,
              remaining,
              sentQueueIds: [],
              removedQueueIds: [],
              preservedQueueIds: [],
              blocked: [],
              warnings: [],
            }
          }
        }
      }

      // If envelope is reused but binding was somehow missing, ensure it's saved before HTTP
      if (!existingBinding && adapter && typeof adapter.saveSyncPushBinding === 'function') {
        try {
          await adapter.saveSyncPushBinding({
            businessId: currentBusinessId,
            boundAt: new Date().toISOString(),
          })
        } catch (err) {
          const remaining = await activeQueueService.countPending()
          return {
            ok: false,
            code: 'SYNC_BINDING_PERSIST_FAILED',
            message: 'Failed to persist business binding before push.',
            error: err,
            remaining,
            sentQueueIds: [],
            removedQueueIds: [],
            preservedQueueIds: [],
            blocked: [],
            warnings: [],
          }
        }
      }

      // ── 5. Send HTTP request via transport ────────────────────────────────────
      const requestBody = {
        business_id: envelope.businessId,
        device_identifier: envelope.deviceIdentifier,
        request_id: envelope.requestId,
        changes: envelope.changes,
      }

      const sentQueueIds = envelope.queueSnapshots.map((s) => s.id)
      const response = await transport({
        token,
        body: requestBody,
      })

      // ── 6. Process response ───────────────────────────────────────────────────
      const respData = response.data?.data ?? response.data
      const isServerSuccess =
        response.ok === true &&
        respData &&
        typeof respData === 'object' &&
        respData.request_id === requestId

      if (isServerSuccess) {
        const duplicate = Boolean(respData.duplicate)
        const removedQueueIds = []
        const preservedQueueIds = []
        const cleanupFailedQueueIds = []

        for (const snapshot of envelope.queueSnapshots) {
          const casResult = await activeQueueService.removeIfUnchanged(snapshot)
          if (casResult.ok) {
            if (casResult.removed) {
              removedQueueIds.push(snapshot.id)
            } else {
              // CAS mismatch: entity mutated locally while request was in-flight — normal, preserve it
              preservedQueueIds.push(snapshot.id)
            }
          } else {
            // Storage/SQLite error: not a CAS mismatch, local cleanup genuinely failed
            cleanupFailedQueueIds.push(snapshot.id)
          }
        }

        const hasStorageError = cleanupFailedQueueIds.length > 0

        if (!hasStorageError && adapter && typeof adapter.clearSyncPushInflight === 'function') {
          await adapter.clearSyncPushInflight()
        }

        const remaining = await activeQueueService.countPending()

        if (hasStorageError) {
          return {
            ok: false,
            code: 'LOCAL_SYNC_CLEANUP_FAILED',
            requestId,
            duplicate,
            sentQueueIds,
            removedQueueIds,
            preservedQueueIds,
            cleanupFailedQueueIds,
            blocked,
            warnings,
            remaining,
            error: {
              code: 'LOCAL_SYNC_CLEANUP_FAILED',
              message: `Server accepted the request (requestId: ${requestId}) but local queue cleanup failed for ${cleanupFailedQueueIds.length} item(s). Retry will reuse the same requestId.`,
            },
          }
        }

        return {
          ok: true,
          requestId,
          duplicate,
          sentQueueIds,
          removedQueueIds,
          preservedQueueIds,
          cleanupFailedQueueIds: [],
          blocked,
          warnings,
          remaining,
          error: null,
        }
      }

      // ── 7. Handle 409 SYNC_CONFLICT ──────────────────────────────────────────
      const responseCode =
        response.data?.code ??
        response.data?.data?.code ??
        response.error?.code ??
        response.error?.data?.code

      const responseStatus = response.status ?? response.error?.status
      const is409Conflict = responseStatus === 409 && responseCode === 'SYNC_CONFLICT'

      if (is409Conflict) {
        const rawConflicts =
          response.data?.conflicts ||
          response.data?.data?.conflicts ||
          response.error?.data?.conflicts ||
          response.error?.conflicts ||
          response.data?.conflict_details?.conflicts ||
          response.error?.data?.conflict_details?.conflicts

        const isValidConflictArray =
          Array.isArray(rawConflicts) &&
          rawConflicts.length > 0 &&
          rawConflicts.every((c) => {
            if (!c || typeof c !== 'object') return false
            const validEntities = [
              'categories',
              'products',
              'customers',
              'expenses',
              'sales',
              'sale_items',
              'shifts',
            ]
            if (!validEntities.includes(c.entity)) return false
            if (typeof c.sync_id !== 'string' || !c.sync_id.trim()) return false
            if (c.server_sync_version === undefined || c.server_sync_version === null) return false
            const ver = Number(c.server_sync_version)
            if (!Number.isInteger(ver) || ver < 0) return false
            return true
          })

        if (!isValidConflictArray) {
          // MALFORMED CONFLICT: DO NOT MUTATE QUEUE
          const remaining = await activeQueueService.countPending()
          return {
            ok: false,
            code: 'INVALID_SYNC_CONFLICT_RESPONSE',
            message: 'Server returned 409 SYNC_CONFLICT with invalid or empty conflicts array.',
            error: {
              code: 'INVALID_SYNC_CONFLICT_RESPONSE',
              message: 'Server returned 409 SYNC_CONFLICT with invalid or empty conflicts array.',
              status: 409,
              data: response.data ?? response.error?.data ?? null,
            },
            remaining,
            sentQueueIds,
            removedQueueIds: [],
            preservedQueueIds: [],
            blocked,
            warnings,
          }
        }

        // Build durable conflict records - ALL OR NOTHING exact mapping
        const newConflicts = []
        let hasMappingFailure = false

        for (const item of rawConflicts) {
          const resolved = await mapServerConflictToQueueSnapshot(item, envelope, activeRegistry)
          if (!resolved.snapshot || !resolved.queueId || !resolved.entityId) {
            hasMappingFailure = true
            break
          }

          newConflicts.push({
            id: generateUuid(),
            requestId: envelope.requestId,
            queueId: resolved.queueId,
            entityType: resolved.entityType,
            entityId: resolved.entityId,
            serverEntity: item.entity,
            syncId: item.sync_id,
            serverSyncVersion: Number(item.server_sync_version),
            queueSnapshot: resolved.snapshot,
            status: 'open',
            createdAt: new Date().toISOString(),
            resolvedAt: null,
            resolution: null,
          })
        }

        if (hasMappingFailure) {
          // MAPPING FAILED: DO NOT MUTATE QUEUE
          const remaining = await activeQueueService.countPending()
          return {
            ok: false,
            code: 'SYNC_CONFLICT_MAPPING_FAILED',
            message: 'One or more server conflicts could not be mapped to local queue snapshots.',
            error: {
              code: 'SYNC_CONFLICT_MAPPING_FAILED',
              message: 'One or more server conflicts could not be mapped to local queue snapshots.',
              status: 409,
              data: response.data ?? response.error?.data ?? null,
            },
            remaining,
            sentQueueIds,
            removedQueueIds: [],
            preservedQueueIds: [],
            blocked,
            warnings,
          }
        }

        // Load existing conflicts and append without duplicating (requestId + serverEntity + syncId)
        const existingConflictsState =
          adapter && typeof adapter.loadSyncConflicts === 'function'
            ? (await adapter.loadSyncConflicts()) || { version: 1, conflicts: [] }
            : { version: 1, conflicts: [] }

        const mergedConflicts = Array.isArray(existingConflictsState.conflicts)
          ? [...existingConflictsState.conflicts]
          : []

        for (const newConf of newConflicts) {
          const duplicate = mergedConflicts.some(
            (c) =>
              c.requestId === newConf.requestId &&
              c.serverEntity === newConf.serverEntity &&
              c.syncId === newConf.syncId &&
              c.status === 'open',
          )
          if (!duplicate) {
            mergedConflicts.push(newConf)
          }
        }

        const nextConflictsState = {
          version: 1,
          conflicts: mergedConflicts,
        }

        if (
          adapter &&
          typeof adapter.persistSyncConflictsAndClearInflightAtomic === 'function'
        ) {
          try {
            const atomicResult = await adapter.persistSyncConflictsAndClearInflightAtomic({
              expectedRequestId: envelope.requestId,
              conflictsState: nextConflictsState,
            })

            if (!atomicResult || !atomicResult.ok) {
              const remaining = await activeQueueService.countPending()
              return {
                ok: false,
                code: atomicResult?.code || 'SYNC_CONFLICT_PERSIST_FAILED',
                message: atomicResult?.message || 'Failed to persist durable sync conflict state.',
                error: {
                  code: atomicResult?.code || 'SYNC_CONFLICT_PERSIST_FAILED',
                  message: atomicResult?.message || 'Failed to persist durable sync conflict state.',
                },
                remaining,
                sentQueueIds,
                removedQueueIds: [],
                preservedQueueIds: [],
                blocked,
                warnings,
              }
            }
          } catch (err) {
            const remaining = await activeQueueService.countPending()
            return {
              ok: false,
              code: 'SYNC_CONFLICT_PERSIST_FAILED',
              message: 'Failed to persist durable sync conflict state.',
              error: {
                code: 'SYNC_CONFLICT_PERSIST_FAILED',
                message: 'Failed to persist durable sync conflict state.',
              },
              remaining,
              sentQueueIds,
              removedQueueIds: [],
              preservedQueueIds: [],
              blocked,
              warnings,
            }
          }
        } else if (adapter && typeof adapter.saveSyncConflicts === 'function') {
          try {
            await adapter.saveSyncConflicts(nextConflictsState)
            if (typeof adapter.clearSyncPushInflight === 'function') {
              await adapter.clearSyncPushInflight()
            }
          } catch (err) {
            const remaining = await activeQueueService.countPending()
            return {
              ok: false,
              code: 'SYNC_CONFLICT_PERSIST_FAILED',
              message: 'Failed to persist durable sync conflict state.',
              error: {
                code: 'SYNC_CONFLICT_PERSIST_FAILED',
                message: 'Failed to persist durable sync conflict state.',
              },
              remaining,
              sentQueueIds,
              removedQueueIds: [],
              preservedQueueIds: [],
              blocked,
              warnings,
            }
          }
        }

        const remaining = await activeQueueService.countPending()

        return {
          ok: false,
          code: 'SYNC_CONFLICT',
          message: 'Sync data conflict detected on server.',
          error: {
            code: 'SYNC_CONFLICT',
            message: 'Sync data conflict detected on server.',
            status: 409,
            data: { conflicts: rawConflicts },
          },
          conflicts: newConflicts,
          remaining,
          sentQueueIds,
          removedQueueIds: [],
          preservedQueueIds: [],
          blocked,
          warnings,
        }
      }

      // ── 8. Handle failures (network, HTTP errors, or malformed 2xx) ───────────
      let failureError = response.error

      if (response.ok && !isServerSuccess) {
        failureError = {
          code: 'INVALID_SYNC_PUSH_RESPONSE',
          message: 'Server returned a response with missing or mismatched request_id',
          status: response.status ?? 200,
          data: response.data ?? null,
        }
      } else if (!failureError && (response.data || response.status)) {
        failureError = {
          code: responseCode || 'SYNC_PUSH_FAILED',
          message: response.data?.message || response.data?.error || 'Sync push failed',
          status: response.status,
          data: response.data,
        }
      }

      // Mark failure only on unchanged snapshots that were part of this request
      for (const snapshot of envelope.queueSnapshots) {
        await activeQueueService.markFailedIfUnchanged(
          snapshot,
          failureError?.message ?? failureError?.code ?? 'Sync push failed',
        )
      }

      const remaining = await activeQueueService.countPending()

      return {
        ok: false,
        code: failureError?.code ?? 'SYNC_PUSH_FAILED',
        requestId,
        duplicate: false,
        sentQueueIds,
        removedQueueIds: [],
        preservedQueueIds: [],
        blocked,
        warnings,
        remaining,
        error: failureError,
      }
    } finally {
      isPushing = false
    }
  }

  return {
    pushNow,
    queueService: activeQueueService,
    registry: activeRegistry,
  }
}
