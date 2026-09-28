import { pushSyncRequest } from './syncPushTransport'
import { createSyncQueueService } from './syncQueueService'
import { createSyncIdentityRegistry, generateUuid } from './syncIdentityRegistry'
import { mapOutboxEntries } from './contractMapper'
import { SYNC_ENTITY_TYPES, SYNC_RESERVED_CATEGORY } from './syncConstants'
import { getToken } from '@/services/cloud/tokenRepository'
import {
  OUTBOX_ACTION_ALLOW,
  OUTBOX_ACTION_DEFER,
  OUTBOX_ACTION_RESTRICT,
  SYNC_PUSH_MODE_CASHIER_SAFE,
  classifyOutboxEntryForPolicy,
  evaluateCashierDependency,
  isProductKnownOnServer,
  isPushEnabled,
  resolveSyncPushPolicy,
} from './syncCapabilityPolicy'

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

/**
 * INT-02: deterministic fingerprint of the conditions that produced a push
 * envelope. Used to decide whether a previously rejected envelope may be safely
 * re-planned (role/capabilities changed, or the local outbox changed).
 *
 * @param {object} params
 * @param {object|null} params.policy Resolved capability policy.
 * @param {Array<object>} params.pendingItems Current outbox snapshot.
 * @returns {string}
 */
function buildPushConditionFingerprint({ policy, pendingItems }) {
  const policyKey = policy
    ? `${policy.pushMode}|${policy.source}|${policy.role ?? ''}|${policy.contractVersion ?? ''}`
    : 'none'
  const outboxKey = (Array.isArray(pendingItems) ? pendingItems : [])
    .map((item) => `${item.id}:${item.updatedAt}:${item.operation}`)
    .join(',')
  return `${policyKey}#${outboxKey}`
}

/**
 * INT-02: resolve cashier dependency chains from the already-mapped changes so
 * canonical sync ids (never human reference strings) drive the gate.
 *
 * @param {object} params
 * @returns {object} `allow` / `defer` descriptor.
 */
function evaluateMappedDependency({
  entry,
  policy,
  mappedChanges,
  serverVersions,
  isSaleInEnvelope,
  lookupTransaction,
}) {
  const changes = mappedChanges || {}

  if (entry.entityType === SYNC_ENTITY_TYPES.TRANSACTION) {
    const saleItems = Array.isArray(changes.sale_items) ? changes.sale_items : []
    return evaluateCashierDependency({
      entry,
      policy,
      serverVersions,
      itemProductSyncIds: saleItems.map((item) => item.product_sync_id ?? null),
    })
  }

  if (entry.entityType === SYNC_ENTITY_TYPES.CASH_ENTRY) {
    const cashRows = Array.isArray(changes.cash_ledger) ? changes.cash_ledger : []
    const transactionId = entry.payload?.transactionId ?? null
    return evaluateCashierDependency({
      entry,
      policy,
      serverVersions,
      linkedSaleSyncId: cashRows[0]?.sale_sync_id ?? null,
      saleInEnvelope: Boolean(transactionId) && isSaleInEnvelope(transactionId),
      linkedTransaction: lookupTransaction(transactionId),
    })
  }

  if (entry.entityType === SYNC_ENTITY_TYPES.STOCK_MOVEMENT) {
    const movementRows = Array.isArray(changes.stock_movements) ? changes.stock_movements : []
    const transactionId = entry.payload?.transactionId ?? null
    return evaluateCashierDependency({
      entry,
      policy,
      serverVersions,
      linkedSaleSyncId: movementRows[0]?.sale_sync_id ?? null,
      linkedProductSyncId: movementRows[0]?.product_sync_id ?? null,
      saleInEnvelope: Boolean(transactionId) && isSaleInEnvelope(transactionId),
    })
  }

  return { action: OUTBOX_ACTION_ALLOW }
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
    shifts: SYNC_ENTITY_TYPES.SHIFT,
    cash_ledger: SYNC_ENTITY_TYPES.CASH_ENTRY,
    stock_movements: SYNC_ENTITY_TYPES.STOCK_MOVEMENT,
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
      const snapSyncId =
        activeRegistry && typeof activeRegistry.peekSyncId === 'function'
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
      const snapSyncId =
        activeRegistry && typeof activeRegistry.peekSyncId === 'function'
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
      const snapSyncId =
        activeRegistry && typeof activeRegistry.peekSyncId === 'function'
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
      const snapSyncId =
        activeRegistry && typeof activeRegistry.peekSyncId === 'function'
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
      const snapSyncId =
        activeRegistry && typeof activeRegistry.peekSyncId === 'function'
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

  // 6. Generic mapping for shifts, cash entries and stock movements: the
  // queue snapshot entity type matches the conflict entity one-to-one.
  const genericEntities = {
    shifts: SYNC_ENTITY_TYPES.SHIFT,
    cash_ledger: SYNC_ENTITY_TYPES.CASH_ENTRY,
    stock_movements: SYNC_ENTITY_TYPES.STOCK_MOVEMENT,
  }
  if (genericEntities[entity]) {
    const targetType = genericEntities[entity]
    for (const snap of queueSnapshots) {
      if (snap.entityType !== targetType) continue
      const localId = snap.payload?.id ?? snap.entityId
      const snapSyncId =
        activeRegistry && typeof activeRegistry.peekSyncId === 'function'
          ? activeRegistry.peekSyncId(targetType, localId)
          : null
      if (
        (snapSyncId && snapSyncId.toLowerCase() === sync_id.toLowerCase()) ||
        String(snap.entityId).toLowerCase() === sync_id.toLowerCase() ||
        String(snap.id).toLowerCase() === sync_id.toLowerCase()
      ) {
        return {
          snapshot: snap,
          queueId: snap.id,
          entityType: targetType,
          entityId: localId,
        }
      }
    }

    return {
      snapshot: null,
      queueId: null,
      entityType: targetType,
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
  capabilityVerifier = null,
  onAuthorizationRejected = null,
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
      changes.expenses.length > MAX_ENTITY_PER_TYPE ||
      changes.cash_ledger.length > MAX_ENTITY_PER_TYPE ||
      changes.stock_movements.length > MAX_ENTITY_PER_TYPE ||
      changes.deletions.length > MAX_ENTITY_PER_TYPE
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
        error: {
          code: 'PUSH_ALREADY_IN_PROGRESS',
          message: 'A sync push operation is already in progress.',
        },
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
      const hasBusiness =
        selectedBusiness !== null &&
        selectedBusiness !== undefined &&
        selectedBusiness.id !== undefined
      const hasCloudAccess = cloudAccess === true
      const hasOutlet =
        selectedOutlet !== null && selectedOutlet !== undefined && selectedOutlet.id !== undefined
      const hasDeviceIdentifier =
        typeof deviceIdentifier === 'string' && deviceIdentifier.trim().length > 0
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
          message:
            'Cloud authentication, business, outlet, and registered device are required for sync push.',
          error: {
            code: 'PRECONDITION_FAILED',
            message:
              'Cloud authentication, business, outlet, and registered device are required for sync push.',
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
      const existingBinding =
        adapter && typeof adapter.loadSyncPushBinding === 'function'
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
      const bootstrapState =
        adapter && typeof adapter.loadSyncBootstrapState === 'function'
          ? await adapter.loadSyncBootstrapState()
          : null

      if (
        bootstrapState &&
        (bootstrapState.status === 'staged' || bootstrapState.status === 'completed')
      ) {
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
      // ── 2.6. INT-02 capability policy ───────────────────────────────────────
      // Every push path (manual, orchestrator and auto-sync) must operate on a
      // *verified* authorization context. A cached legacy/unverified contract is
      // re-confirmed online first; when that fails the push is postponed and
      // every local row is preserved. Free/local-only sessions are skipped by
      // the verifier — they cannot push anyway.
      let verifiedCapability = null

      if (typeof capabilityVerifier === 'function') {
        let verification = null
        try {
          verification = await capabilityVerifier()
        } catch {
          verification = { ok: false, code: 'CONTEXT_VERIFY_FAILED' }
        }

        if (verification && verification.ok === true && verification.skipped !== true) {
          verifiedCapability = {
            role: verification.role ?? null,
            syncCapabilities: verification.syncCapabilities ?? null,
            capabilityState: verification.capabilityState ?? null,
          }
        }

        if (verification && verification.ok === false && verification.skipped !== true) {
          const remaining = await activeQueueService.countPending()
          return {
            ok: false,
            code: 'SYNC_CAPABILITIES_UNVERIFIED',
            message:
              'Izin sinkronisasi belum dapat diverifikasi secara online. Data lokal tetap aman dan menunggu koneksi.',
            authorizationCode: verification.code ?? 'CONTEXT_REFRESH_FAILED',
            remaining,
            sentQueueIds: [],
            removedQueueIds: [],
            preservedQueueIds: [],
            blocked: [],
            restricted: [],
            deferred: [],
            warnings: [],
            error: {
              code: 'SYNC_CAPABILITIES_UNVERIFIED',
              message: 'Izin sinkronisasi belum dapat diverifikasi secara online.',
            },
          }
        }
      }

      // Deny-by-default. An unrecognised role or capability contract never
      // authorises a cloud mutation, but restricted data is never deleted.
      // Authorization authority: a freshly *verified* snapshot always wins. A
      // caller-supplied `options.context` is often older (it can be captured
      // before the online verification, or omitted entirely by the orchestrator
      // and auto-sync callers), so it must never override the verified result.
      // Only when no verification ran (skipped / unauthenticated) do we fall
      // back to the caller context and the live store — which keeps direct
      // service callers and owner/member legacy flows working.
      const policy = resolveSyncPushPolicy(
        verifiedCapability
          ? {
              role: verifiedCapability.role,
              syncCapabilities: verifiedCapability.syncCapabilities,
              capabilityState: verifiedCapability.capabilityState,
            }
          : {
              role: options.context?.role ?? cloudStore?.role ?? null,
              syncCapabilities:
                options.context?.syncCapabilities ?? cloudStore?.syncCapabilities ?? null,
              capabilityState: options.context?.capabilityState ?? null,
            },
      )

      if (!isPushEnabled(policy)) {
        const remaining = await activeQueueService.countPending()
        return {
          ok: false,
          code: 'SYNC_PUSH_ROLE_DENIED',
          message:
            'Peran pengguna ini tidak diizinkan mengirim perubahan ke cloud. Data lokal tetap aman.',
          policy,
          remaining,
          sentQueueIds: [],
          removedQueueIds: [],
          preservedQueueIds: [],
          blocked: [],
          restricted: [],
          deferred: [],
          warnings: [],
          error: {
            code: 'SYNC_PUSH_ROLE_DENIED',
            message: 'Peran pengguna ini tidak diizinkan mengirim perubahan ke cloud.',
          },
        }
      }

      const existingEnvelope =
        adapter && typeof adapter.loadSyncPushInflight === 'function'
          ? await adapter.loadSyncPushInflight()
          : null

      // An envelope flagged for reconciliation must never be re-planned and
      // must never be resent automatically: its first outcome is still unknown
      // (the server may have committed it before the response was lost), and
      // the backend authorizes before it dedupes, so an identical retry cannot
      // resolve it. The envelope + every local row are preserved and surfaced
      // as SYNC_RECONCILIATION_REQUIRED until the outcome is known (see the
      // documented backend request-status endpoint).
      if (existingEnvelope && existingEnvelope.reconciliationRequired === true) {
        const remaining = await activeQueueService.countPending()

        return {
          ok: false,
          code: 'SYNC_RECONCILIATION_REQUIRED',
          message:
            'Pengiriman sebelumnya mungkin sudah diterima server. Rekonsiliasi diperlukan sebelum mencoba lagi; data lokal tetap aman.',
          requestId: existingEnvelope.requestId,
          policy,
          acceptance: 'unknown',
          reconciliationRequired: true,
          reconciliationCode:
            existingEnvelope.reconciliationCode ?? 'SYNC_RECONCILIATION_REQUIRED',
          sentQueueIds: [],
          removedQueueIds: [],
          preservedQueueIds: [],
          blocked: [],
          restricted: [],
          deferred: [],
          warnings: [],
          remaining,
          error: {
            code: 'SYNC_RECONCILIATION_REQUIRED',
            message:
              'Pengiriman sebelumnya mungkin sudah diterima server. Rekonsiliasi diperlukan sebelum mencoba lagi.',
          },
        }
      }

      let requestId
      let envelope
      let isReusedEnvelope = false
      const blocked = []
      const warnings = []
      const restricted = []
      const deferred = []

      // INT-02: a rejected envelope must never be resent unchanged. The backend
      // preflight (403 SYNC_OPERATION_NOT_ALLOWED) is all-or-nothing, so a
      // rejected envelope was never applied server-side and re-planning cannot
      // lose acknowledged data. Re-plan only when a condition changed.
      let useExistingEnvelope = Boolean(existingEnvelope)

      if (existingEnvelope && existingEnvelope.rejectionCode) {
        const remainingForFingerprint = await activeQueueService.countPending()
        const pendingForFingerprint = await activeQueueService.listPending({
          limit: Math.max(remainingForFingerprint, 1),
        })
        const currentFingerprint = buildPushConditionFingerprint({
          policy,
          pendingItems: pendingForFingerprint,
        })

        // Compare against the conditions the envelope was *planned* under (the
        // fingerprint captured when it was built), not merely the conditions at
        // rejection time. A role/capability change (for example member ->
        // cashier) or an outbox change since the build means a fresh plan would
        // differ, so re-planning is safe and a rejected envelope can never wedge
        // the app. Only a byte-identical re-plan is short-circuited.
        const plannedFingerprint =
          existingEnvelope.conditionFingerprint ?? existingEnvelope.rejectionFingerprint ?? null

        if (plannedFingerprint !== null && currentFingerprint === plannedFingerprint) {
          const remaining = await activeQueueService.countPending()
          return {
            ok: false,
            code: 'SYNC_ENVELOPE_REJECTED_PENDING_CONTEXT_CHANGE',
            message:
              'Pengiriman sebelumnya ditolak server. Menunggu perubahan peran/izin atau data lokal sebelum mencoba lagi.',
            policy,
            rejectionCode: existingEnvelope.rejectionCode,
            remaining,
            sentQueueIds: [],
            removedQueueIds: [],
            preservedQueueIds: [],
            blocked: [],
            restricted: [],
            deferred: [],
            warnings: [],
            error: {
              code: 'SYNC_ENVELOPE_REJECTED_PENDING_CONTEXT_CHANGE',
              message:
                'Pengiriman sebelumnya ditolak server. Menunggu perubahan peran/izin atau data lokal.',
            },
          }
        }

        if (adapter && typeof adapter.clearSyncPushInflight === 'function') {
          await adapter.clearSyncPushInflight()
        }
        useExistingEnvelope = false
      }

      if (useExistingEnvelope) {
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
          if (
            !bootstrapState ||
            (bootstrapState.status !== 'staged' && bootstrapState.status !== 'completed')
          ) {
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
            restricted: [],
            deferred: [],
            warnings: [],
            remaining: 0,
            policy,
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
            restricted: [],
            deferred: [],
            warnings: [],
            remaining: 0,
            policy,
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
        const selectedTransactionIds = new Set()

        // INT-02: canonical sale-relation lookups for the cashier dependency
        // gate. Only explicit ids are used; reference strings are never parsed.
        const pendingTransactionsById = new Map()
        for (const item of pendingItems) {
          if (item.entityType === SYNC_ENTITY_TYPES.TRANSACTION) {
            const localId = item.payload?.id ?? item.entityId
            if (localId !== undefined && localId !== null) {
              pendingTransactionsById.set(String(localId), item.payload ?? null)
            }
          }
        }

        const isSaleInEnvelope = (transactionId) =>
          selectedTransactionIds.has(String(transactionId))
        const lookupTransaction = (transactionId) => {
          if (transactionId === undefined || transactionId === null) return null
          return pendingTransactionsById.get(String(transactionId)) ?? null
        }

        const serverVersions =
          adapter && typeof adapter.loadSyncServerVersions === 'function'
            ? (await adapter.loadSyncServerVersions()) || {}
            : {}

        const isCashierSafe = policy.pushMode === SYNC_PUSH_MODE_CASHIER_SAFE

        const phase1 = []
        const phase2 = []
        const phase3 = []
        const phase4 = []

        for (const item of pendingItems) {
          if (item.entityType === SYNC_ENTITY_TYPES.CATEGORY) {
            phase1.push(item)
          } else if (item.entityType === SYNC_ENTITY_TYPES.TRANSACTION) {
            phase3.push(item)
          } else if (
            isCashierSafe &&
            (item.entityType === SYNC_ENTITY_TYPES.CASH_ENTRY ||
              item.entityType === SYNC_ENTITY_TYPES.STOCK_MOVEMENT)
          ) {
            // Cash and stock rows depend on their sale: evaluate them after the
            // transactions carried by the same envelope.
            phase4.push(item)
          } else {
            phase2.push(item)
          }
        }

        const orderedCandidates = isCashierSafe
          ? [...phase1, ...phase2, ...phase3, ...phase4]
          : [...phase1, ...phase2, ...phase3]

        const accumulatedChanges = {
          categories: [],
          products: [],
          customers: [],
          shifts: [],
          sales: [],
          sale_items: [],
          expenses: [],
          cash_ledger: [],
          stock_movements: [],
          deletions: [],
        }

        const batchSnapshots = []
        const supersededSnapshots = []

        for (const entry of orderedCandidates) {
          // Filter out candidates with open conflict
          if (openConflictQueueIds.has(entry.id)) {
            continue
          }

          // INT-02: role / capability filter. Restricted entries are never
          // sent, never acknowledged and never deleted: they stay durable and
          // surface in Sync Status as "not allowed by role".
          const policyDecision = classifyOutboxEntryForPolicy(entry, policy)
          if (policyDecision.action === OUTBOX_ACTION_RESTRICT) {
            restricted.push({
              queueId: entry.id,
              entityType: entry.entityType,
              entityId: entry.entityId,
              operation: entry.operation,
              code: policyDecision.code,
              category: policyDecision.category,
              message: policyDecision.message,
            })
            continue
          }

          // Newest snapshot per entity row wins: the tracker re-enqueues a
          // full row snapshot on every local mutation, so an older snapshot
          // of the same (entityType, entityId, operation) is superseded by a
          // later one already in this batch loop. Skip it here; the latest
          // snapshot travels and the push-success cleanup clears both ids.
          const rowKey = `${entry.entityType} ${entry.entityId} ${entry.operation}`
          const latestForRow = orderedCandidates
            .filter(
              (c) =>
                `${c.entityType} ${c.entityId} ${c.operation}` === rowKey &&
                !openConflictQueueIds.has(c.id),
            )
            .at(-1)
          if (latestForRow && latestForRow.id !== entry.id) {
            const latestSnapshot = {
              id: entry.id,
              entityType: entry.entityType,
              entityId: entry.entityId,
              operation: entry.operation,
              payload: entry.payload,
              updatedAt: entry.updatedAt,
            }
            supersededSnapshots.push(latestSnapshot)
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
            if (
              custId &&
              pendingCustKeys.has(String(custId)) &&
              !selectedCustKeys.has(String(custId))
            ) {
              // Parent Customer is pending in queue but not selected in this batch -> defer
              if (isCashierSafe) {
                deferred.push({
                  queueId: entry.id,
                  entityType: entry.entityType,
                  entityId: entry.entityId,
                  operation: entry.operation,
                  code: 'SALE_CUSTOMER_NOT_AVAILABLE_ON_SERVER',
                  category: 'dependency_blocked',
                  message: 'Transaksi menunggu karena pelanggan terkait belum tersedia di server.',
                  missing: [String(custId)],
                })
              }
              continue
            }

            // INT-02: a pending *product* row must not block a sale by itself.
            // For a cashier, product mutations are always restricted and
            // therefore permanently pending, yet an item whose product already
            // exists on the server is explicitly allowed by INT-01. Only a
            // product that is NOT known on the server makes the sale
            // dependency-blocked. Product mutations are never sent.
            const trxItems = Array.isArray(entry.payload?.items) ? entry.payload.items : []
            const blockingProductIds = []

            for (const it of trxItems) {
              const pId = it.id ?? it.productId ?? it.product_id
              if (!pId) continue

              const productKey = String(pId)
              const pendingInQueue = pendingProdKeys.has(productKey) && !selectedProdKeys.has(productKey)

              if (!pendingInQueue) continue

              if (isCashierSafe) {
                // Canonical identity check against the server.
                let knownOnServer = false
                try {
                  const productSyncId = await activeRegistry.peekSyncId(
                    SYNC_ENTITY_TYPES.PRODUCT,
                    productKey,
                  )
                  knownOnServer = isProductKnownOnServer(serverVersions, productSyncId)
                } catch {
                  knownOnServer = false
                }

                if (knownOnServer) continue
              }

              blockingProductIds.push(productKey)
            }

            if (blockingProductIds.length > 0) {
              // Parent Product is pending in queue and not available on the server -> defer
              if (isCashierSafe) {
                deferred.push({
                  queueId: entry.id,
                  entityType: entry.entityType,
                  entityId: entry.entityId,
                  operation: entry.operation,
                  code: 'SALE_PRODUCT_NOT_AVAILABLE_ON_SERVER',
                  category: 'dependency_blocked',
                  message: 'Transaksi menunggu karena produk terkait belum tersedia di server.',
                  missing: blockingProductIds,
                })
              }
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
            mapped.changes.expenses.length > 0 ||
            mapped.changes.cash_ledger.length > 0 ||
            mapped.changes.stock_movements.length > 0 ||
            mapped.changes.deletions.length > 0

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

          // INT-02: cashier dependency gate. Applied only in cashier_safe mode,
          // after mapping so canonical sync ids are available. Deferred entries
          // are preserved and retried once their dependency exists server-side.
          if (isCashierSafe) {
            const dependency = evaluateMappedDependency({
              entry,
              policy,
              mappedChanges: mapped.changes,
              serverVersions,
              isSaleInEnvelope,
              lookupTransaction,
            })

            if (dependency.action === OUTBOX_ACTION_DEFER) {
              deferred.push({
                queueId: entry.id,
                entityType: entry.entityType,
                entityId: entry.entityId,
                operation: entry.operation,
                code: dependency.code,
                category: dependency.category,
                message: dependency.message,
                missing: dependency.missing ?? [],
              })
              continue
            }
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
          accumulatedChanges.cash_ledger.push(...mapped.changes.cash_ledger)
          accumulatedChanges.stock_movements.push(...mapped.changes.stock_movements)
          accumulatedChanges.deletions.push(...mapped.changes.deletions)

          if (entry.entityType === SYNC_ENTITY_TYPES.CATEGORY) {
            const catName = entry.payload?.name || entry.entityId
            if (catName) selectedCatKeys.add(String(catName).trim())
          } else if (entry.entityType === SYNC_ENTITY_TYPES.CUSTOMER) {
            if (entry.entityId) selectedCustKeys.add(String(entry.entityId))
          } else if (entry.entityType === SYNC_ENTITY_TYPES.PRODUCT) {
            if (entry.entityId) selectedProdKeys.add(String(entry.entityId))
          } else if (entry.entityType === SYNC_ENTITY_TYPES.TRANSACTION) {
            const localId = entry.payload?.id ?? entry.entityId
            if (localId !== undefined && localId !== null) {
              selectedTransactionIds.add(String(localId))
            }
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
              restricted,
              deferred,
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
            restricted,
            deferred,
            warnings,
            remaining,
            policy,
            error: null,
          }
        }

        // ── 4.5. Verify Bootstrap State when no existing push binding
        if (!existingBinding) {
          if (
            !bootstrapState ||
            (bootstrapState.status !== 'staged' && bootstrapState.status !== 'completed')
          ) {
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
          // The authorization + outbox conditions this plan was built under.
          // Uses the SAME basis as the rejection comparison (the full pending
          // outbox) so a restricted row that is simply skipped can never change
          // the fingerprint on its own. A later rejection is only
          // short-circuited when the conditions are still byte-identical;
          // otherwise it is safely re-planned.
          conditionFingerprint: buildPushConditionFingerprint({
            policy,
            pendingItems,
          }),
          queueSnapshots: batchSnapshots,
          supersededSnapshots,
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

        // Superseded snapshots never travelled, but their entity row did via
        // the newest snapshot: clear them unconditionally by id so a stale
        // duplicate row can never be sent on the next push. New server
        // versions learned from this push are persisted so the next push
        // carries fresh base_sync_version values.
        for (const snapshot of [
          ...(envelope.supersededSnapshots ?? []),
          ...envelope.queueSnapshots,
        ]) {
          const casResult =
            snapshot?.id && (envelope.supersededSnapshots ?? []).some((s) => s.id === snapshot.id)
              ? await activeQueueService.remove(snapshot.id)
              : await activeQueueService.removeIfUnchanged(snapshot)
          if (casResult.ok) {
            if (casResult.removed ?? true) {
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

        // Learn fresh server versions for every travelled row: the push just
        // created version 1 for new rows, so a follow-up mutation of the same
        // entity must carry base_sync_version 1 instead of replaying null.
        if (
          !hasStorageError &&
          adapter &&
          typeof adapter.loadSyncServerVersions === 'function' &&
          typeof adapter.saveSyncServerVersions === 'function'
        ) {
          try {
            const existingVersions = (await adapter.loadSyncServerVersions()) || {}
            const nextVersions = { ...existingVersions }
            const queueSyncId = async (entityType, entityId) => {
              try {
                return await activeRegistry.peekSyncId(entityType, entityId)
              } catch {
                return null
              }
            }
            for (const snapshot of envelope.queueSnapshots) {
              const syncId = await queueSyncId(snapshot.entityType, snapshot.entityId)
              if (!syncId) continue
              const lower = `${syncId}`.toLowerCase()
              const serverKey =
                snapshot.entityType === 'category'
                  ? `categories:${lower}`
                  : snapshot.entityType === 'product'
                    ? `products:${lower}`
                    : snapshot.entityType === 'customer'
                      ? `customers:${lower}`
                      : snapshot.entityType === 'expense'
                        ? `expenses:${lower}`
                        : snapshot.entityType === 'shift'
                          ? `shifts:${lower}`
                          : snapshot.entityType === 'transaction'
                            ? `sales:${lower}`
                            : snapshot.entityType === 'cash_entry'
                              ? `cash_ledger:${lower}`
                              : snapshot.entityType === 'stock_movement'
                                ? `stock_movements:${lower}`
                                : null
              if (serverKey && nextVersions[serverKey] === undefined) {
                nextVersions[serverKey] = { syncVersion: 1, syncSequence: 0 }
              }
              // Sale-item rows are derived deterministically from the parent
              // transaction row: learn their versions too so a follow-up
              // transaction mutation carries fresh item base versions.
              if (snapshot.entityType === 'transaction') {
                const payloadItems = Array.isArray(snapshot.payload?.items)
                  ? snapshot.payload.items
                  : []
                for (let i = 0; i < payloadItems.length; i++) {
                  const item = payloadItems[i]
                  const prodLocalId = item?.id ?? item?.productId ?? item?.product_id ?? item?.name
                  try {
                    const itemSyncId = await activeRegistry.peekSyncId(
                      'sale_item',
                      `${snapshot.entityId}:${i}:${prodLocalId}`,
                    )
                    if (itemSyncId) {
                      const itemKey = `sale_items:${`${itemSyncId}`.toLowerCase()}`
                      if (nextVersions[itemKey] === undefined) {
                        nextVersions[itemKey] = { syncVersion: 1, syncSequence: 0 }
                      }
                    }
                  } catch {
                    // best-effort only
                  }
                }
              }
            }
            await adapter.saveSyncServerVersions(nextVersions)
          } catch {
            // Version learning is best-effort: the next push still works,
            // it just replays a create-style payload on conflict.
          }
        }

        const remaining = await activeQueueService.countPending()

        if (hasStorageError) {
          return {
            ok: false,
            code: 'LOCAL_SYNC_CLEANUP_FAILED',
            requestId,
            duplicate,
            // The server accepted the request but local cleanup failed. The
            // envelope is preserved, so the retry reuses the same request_id
            // and the server deduplicates it: no acknowledged data can be lost.
            acceptance: 'accepted',
            reconciliationRequired: true,
            sentQueueIds,
            removedQueueIds,
            preservedQueueIds,
            cleanupFailedQueueIds,
            blocked,
            restricted,
            deferred,
            warnings,
            remaining,
            policy,
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
          restricted,
          deferred,
          warnings,
          remaining,
          policy,
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
              'cash_ledger',
              'stock_movements',
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

        if (adapter && typeof adapter.persistSyncConflictsAndClearInflightAtomic === 'function') {
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
                  message:
                    atomicResult?.message || 'Failed to persist durable sync conflict state.',
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
      // INT-02: authorization failures are NOT data failures. Never delete the
      // outbox, never treat the push as acknowledged, and never loop on the same
      // envelope without a condition change.
      if (responseStatus === 403) {
        const isOperationNotAllowed = responseCode === 'SYNC_OPERATION_NOT_ALLOWED'
        const violations =
          response.data?.violations ??
          response.data?.data?.violations ??
          response.error?.data?.violations ??
          []

        const rejectionMessage = isOperationNotAllowed
          ? 'Server menolak sebagian operasi untuk peran ini. Data lokal tetap aman dan akan dikirim ulang setelah izin diperbarui.'
          : (response.data?.message ??
            response.error?.message ??
            'Akses sinkronisasi ditolak oleh server.')

        const requiresContextRefresh =
          isOperationNotAllowed ||
          responseCode === 'CLOUD_SUBSCRIPTION_REQUIRED' ||
          responseCode === 'BUSINESS_ACCESS_DENIED'

        // Every push path (manual, orchestrator "Sync Semua" and auto-sync)
        // shares this single hook, so a permission change refreshes role +
        // sync_capabilities consistently no matter which path reached the 403.
        // A refresh failure is swallowed: the rejection is already surfaced.
        if (requiresContextRefresh && typeof onAuthorizationRejected === 'function') {
          try {
            await onAuthorizationRejected({
              code: responseCode,
              roleMismatch: isOperationNotAllowed,
            })
          } catch {
            // Non-blocking.
          }
        }

        // A 403 on a *retried* request whose first outcome is unknown is NOT
        // proof the original was never processed. The backend checks
        // authorization BEFORE idempotency, so a now-restricted role can 403 a
        // request that was already committed server-side. Keep the envelope and
        // every local row and require reconciliation instead of re-planning.
        if (isOperationNotAllowed && existingEnvelope?.acceptanceUnknown === true) {
          const reconciliationMessage =
            'Pengiriman sebelumnya mungkin sudah diterima server. Rekonsiliasi diperlukan sebelum mencoba lagi; data lokal tetap aman.'

          if (adapter && typeof adapter.saveSyncPushInflight === 'function') {
            try {
              await adapter.saveSyncPushInflight({
                ...envelope,
                acceptanceUnknown: true,
                reconciliationRequired: true,
                reconciliationCode: 'SYNC_RECONCILIATION_REQUIRED',
                reconciliationAt: new Date().toISOString(),
              })
            } catch {
              // Best effort: the returned status still blocks an automatic re-plan.
            }
          }

          for (const snapshot of envelope.queueSnapshots) {
            await activeQueueService.markFailedIfUnchanged(snapshot, reconciliationMessage)
          }

          const remaining = await activeQueueService.countPending()

          return {
            ok: false,
            code: 'SYNC_RECONCILIATION_REQUIRED',
            message: reconciliationMessage,
            requestId,
            policy,
            violations,
            roleMismatch: true,
            requiresContextRefresh,
            acceptance: 'unknown',
            reconciliationRequired: true,
            deviceBlocked: false,
            sentQueueIds,
            removedQueueIds: [],
            preservedQueueIds: [],
            blocked,
            restricted,
            deferred,
            warnings,
            remaining,
            error: {
              code: 'SYNC_RECONCILIATION_REQUIRED',
              message: reconciliationMessage,
              status: 403,
              data: response.data ?? response.error?.data ?? null,
            },
          }
        }

        // Persist an idempotent rejection marker so the identical envelope is
        // never resent. A first-attempt 403 preflight writes nothing
        // server-side, so keeping the envelope is safe and re-planning can
        // never lose acknowledged data.
        if (
          isOperationNotAllowed &&
          adapter &&
          typeof adapter.saveSyncPushInflight === 'function'
        ) {
          try {
            const pendingForFingerprint = await activeQueueService.listPending({
              limit: Math.max(await activeQueueService.countPending(), 1),
            })
            await adapter.saveSyncPushInflight({
              ...envelope,
              rejectionCode: responseCode,
              rejectionAt: new Date().toISOString(),
              rejectionFingerprint: buildPushConditionFingerprint({
                policy,
                pendingItems: pendingForFingerprint,
              }),
            })
          } catch {
            // Best effort: losing the marker only risks one extra guarded retry.
          }
        }

        for (const snapshot of envelope.queueSnapshots) {
          await activeQueueService.markFailedIfUnchanged(snapshot, rejectionMessage)
        }

        const remaining = await activeQueueService.countPending()

        return {
          ok: false,
          code: isOperationNotAllowed
            ? 'SYNC_OPERATION_NOT_ALLOWED'
            : (responseCode ?? 'SYNC_FORBIDDEN'),
          message: rejectionMessage,
          requestId,
          policy,
          violations,
          roleMismatch: isOperationNotAllowed,
          requiresContextRefresh,
          // A 403 is a definitive server preflight rejection: nothing was
          // applied, so the envelope is not accepted and no reconciliation is
          // pending. It is retained only so a changed condition can re-plan.
          acceptance: 'rejected',
          reconciliationRequired: false,
          deviceBlocked:
            responseCode === 'DEVICE_INACTIVE' || responseCode === 'SYNC_DEVICE_INVALID',
          sentQueueIds,
          removedQueueIds: [],
          preservedQueueIds: [],
          blocked,
          restricted,
          deferred,
          warnings,
          remaining,
          error: {
            code: isOperationNotAllowed
              ? 'SYNC_OPERATION_NOT_ALLOWED'
              : (responseCode ?? 'SYNC_FORBIDDEN'),
            message: rejectionMessage,
            status: 403,
            data: response.data ?? response.error?.data ?? null,
          },
        }
      }

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

      // INT-02 review: never delete an envelope whose acceptance is uncertain.
      // A transport error, a malformed 2xx or a 5xx leaves the server outcome
      // unknown; the envelope is kept and MUST be retried with the same
      // request_id (server idempotency) — that is the reconciliation. Only a
      // definite client-side rejection (4xx with a parsed body) is treated as
      // "rejected" rather than "unknown".
      const hasHttpResponse = typeof response.status === 'number' && response.status > 0
      const acceptanceUnknown =
        !hasHttpResponse ||
        (response.ok === true && !isServerSuccess) ||
        (typeof response.status === 'number' && response.status >= 500)

      // Persist the unknown outcome on the envelope itself. A later push must
      // be able to tell that this request may already have been committed —
      // otherwise a subsequent 403 (which the backend returns before it
      // dedupes) would be misread as proof of non-acceptance.
      if (acceptanceUnknown && adapter && typeof adapter.saveSyncPushInflight === 'function') {
        try {
          await adapter.saveSyncPushInflight({
            ...envelope,
            acceptanceUnknown: true,
            acceptanceUnknownAt: new Date().toISOString(),
          })
        } catch {
          // Best effort: the returned status still marks the uncertainty.
        }
      }

      return {
        ok: false,
        code: failureError?.code ?? 'SYNC_PUSH_FAILED',
        requestId,
        duplicate: false,
        acceptance: acceptanceUnknown ? 'unknown' : 'rejected',
        reconciliationRequired: acceptanceUnknown,
        sentQueueIds,
        removedQueueIds: [],
        preservedQueueIds: [],
        blocked,
        restricted,
        deferred,
        warnings,
        remaining,
        policy,
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
