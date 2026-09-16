import { getToken } from '@/services/cloud/tokenRepository'
import { createSyncQueueService } from './syncQueueService'
import { createSyncIdentityRegistry } from './syncIdentityRegistry'
import { mapOutboxEntries } from './contractMapper'
import { pullSyncChanges } from './syncPullTransport'
import { SYNC_RESERVED_CATEGORY, SYNC_ENTITY_TYPES, SYNC_OPERATIONS } from './syncConstants'
import { useProductStore } from '../../stores/productStore'
import { useCashStore } from '../../stores/cashStore'
import { useCustomerStore } from '../../stores/customerStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useShiftStore } from '../../stores/shiftStore'
import { useTransactionStore } from '../../stores/transactionStore'

/**
 * Mobile P14 — Free to Cloud Initial Bootstrap Service.
 *
 * Prepares and stages local offline (FREE) data into the P9 sync_queue outbox
 * after validating Cloud preconditions, verifying the target Cloud is empty,
 * and performing a fail-closed preflight check with the P11 contract mapper.
 *
 * @param {object} options
 * @param {object} [options.adapter] Database adapter.
 * @param {object} [options.scheduler] Task scheduler.
 * @param {object} [options.queueService] Outbox queue service.
 * @param {object} [options.registry] Shared sync identity registry.
 * @param {Function} [options.tokenFetcher] Function returning Bearer token.
 * @param {object} [options.cloudStore] Cloud session store instance.
 * @param {Function} [options.transport] Transport function for server-empty check.
 * @param {object} [options.stores] Injected Pinia domain stores.
 * @param {object} [options.pinia] Pinia instance.
 */
export function createSyncBootstrapService({
  adapter = null,
  scheduler = null,
  queueService = null,
  registry = null,
  tokenFetcher = null,
  cloudStore = null,
  transport = null,
  stores = null,
  pinia = null,
  contextGuardService = null,
} = {}) {
  const activeQueueService = queueService ?? createSyncQueueService({ adapter, scheduler })
  const activeRegistry = registry ?? createSyncIdentityRegistry({ adapter, scheduler })
  const activeTransport = transport ?? pullSyncChanges
  const activeTokenFetcher = tokenFetcher ?? (async () => getToken())

  async function bootstrapNow(options = {}) {
    // ── 1. Validate Cloud Preconditions ───────────────────────────────────────
    let token = null
    try {
      token = await activeTokenFetcher()
    } catch {
      token = null
    }

    const ctx = options.context ?? {
      user: cloudStore?.user,
      selectedBusiness: cloudStore?.selectedBusiness,
      selectedOutlet: cloudStore?.selectedOutlet,
      cloudAccess: cloudStore?.cloudAccess,
      deviceIdentifier: cloudStore?.deviceIdentifier,
      registeredDeviceId: cloudStore?.registeredDeviceId,
    }

    if (
      !token ||
      typeof token !== 'string' ||
      !token.trim() ||
      !ctx?.user ||
      !ctx?.selectedBusiness?.id ||
      !ctx?.selectedOutlet?.id ||
      ctx?.cloudAccess !== true ||
      !ctx?.deviceIdentifier ||
      !ctx?.registeredDeviceId
    ) {
      return {
        ok: false,
        code: 'BOOTSTRAP_PRECONDITION_FAILED',
        message: 'Cloud context or credentials incomplete for initial bootstrap.',
        error: {
          code: 'BOOTSTRAP_PRECONDITION_FAILED',
          message: 'Cloud context incomplete',
        },
      }
    }

    // ── 1.5. P23 Context Guard Inspection ────────────────────────────────────
    const guardContext = {
      user: ctx?.user ? { id: ctx.user.id } : null,
      selectedBusiness: ctx?.selectedBusiness ? { id: ctx.selectedBusiness.id } : null,
      selectedOutlet: ctx?.selectedOutlet ? { id: ctx.selectedOutlet.id } : null,
      cloudAccess: ctx?.cloudAccess === true,
      deviceIdentifier: ctx?.deviceIdentifier,
      registeredDeviceId: ctx?.registeredDeviceId,
    }

    if (contextGuardService && typeof contextGuardService.inspect === 'function') {
      const guard = await contextGuardService.inspect({ context: guardContext })
      if (!guard.ok) {
        return {
          ok: false,
          code: 'SYNC_CONTEXT_GUARD_BLOCKED',
          contextGuardCode: guard.code,
          message: 'Initial bootstrap blocked by context guard.',
          error: {
            code: 'SYNC_CONTEXT_GUARD_BLOCKED',
            contextGuardCode: guard.code,
          },
        }
      }
    }

    // NOTE: a non-empty cloud target stays fail-closed here. Automatic merging
    // of existing cloud data with local Free data is intentionally NOT
    // attempted in P37 (FREE_TO_EXISTING_CLOUD_MERGE_REQUIRES_P38); P38 will
    // cover intentional multi-device conflict/recovery semantics.
    // ── 2. Verify Sync Has Not Already Started ────────────────────────────────
    if (adapter) {
      const pushBinding = await adapter.loadSyncPushBinding()
      if (pushBinding) {
        return {
          ok: false,
          code: 'BOOTSTRAP_SYNC_ALREADY_STARTED',
          message: 'Sync push binding already exists. Initial bootstrap is only allowed before cloud sync has started.',
          error: { code: 'BOOTSTRAP_SYNC_ALREADY_STARTED' },
        }
      }

      const pullBinding = await adapter.loadSyncPullBinding()
      if (pullBinding) {
        return {
          ok: false,
          code: 'BOOTSTRAP_SYNC_ALREADY_STARTED',
          message: 'Sync pull binding already exists.',
          error: { code: 'BOOTSTRAP_SYNC_ALREADY_STARTED' },
        }
      }

      const pullState = await adapter.loadSyncPullState()
      if (pullState) {
        return {
          ok: false,
          code: 'BOOTSTRAP_SYNC_ALREADY_STARTED',
          message: 'Sync pull state already exists.',
          error: { code: 'BOOTSTRAP_SYNC_ALREADY_STARTED' },
        }
      }

      const pushInflight = await adapter.loadSyncPushInflight()
      if (pushInflight) {
        return {
          ok: false,
          code: 'BOOTSTRAP_PUSH_INFLIGHT',
          message: 'Sync push is currently in-flight.',
          error: { code: 'BOOTSTRAP_PUSH_INFLIGHT' },
        }
      }

      const existingBootstrap = await adapter.loadSyncBootstrapState()
      if (existingBootstrap && (existingBootstrap.status === 'staged' || existingBootstrap.status === 'completed')) {
        return {
          ok: false,
          code: 'BOOTSTRAP_ALREADY_STAGED',
          message: 'Initial bootstrap has already been staged.',
          error: { code: 'BOOTSTRAP_ALREADY_STAGED' },
        }
      }
    }

    // ── 3. Inspect Existing Pending Outbox ─────────────────────────────────────
    const warnings = []
    let pendingItems = []
    if (activeQueueService && typeof activeQueueService.listPending === 'function') {
      if (typeof activeQueueService.countPending === 'function') {
        const count = await activeQueueService.countPending()
        if (count > 0) {
          pendingItems = await activeQueueService.listPending({ limit: count })
        }
      } else {
        pendingItems = await activeQueueService.listPending({ limit: 100000 })
      }
    }

    for (const item of pendingItems) {
      if (item.operation === SYNC_OPERATIONS.DELETE) {
        return {
          ok: false,
          code: 'BOOTSTRAP_PENDING_DELETE_CONFLICT',
          message: `Found pending delete outbox item for ${item.entityType} ${item.entityId}. Initial bootstrap cannot proceed with pending delete operations.`,
          error: { code: 'BOOTSTRAP_PENDING_DELETE_CONFLICT' },
        }
      }

      if (item.entityType === SYNC_ENTITY_TYPES.BUSINESS) {
        if (!warnings.includes('UNSUPPORTED_BUSINESS_OUTBOX_PRESENT')) {
          warnings.push('UNSUPPORTED_BUSINESS_OUTBOX_PRESENT')
        }
      }
    }

    // ── 4. Server Empty Check via Transport (GET /api/sync/pull limit=1) ─────
    let serverCheckResp = null
    try {
      serverCheckResp = await activeTransport({
        token,
        businessId: ctx.selectedBusiness.id,
        deviceIdentifier: ctx.deviceIdentifier,
        after: 0,
        limit: 1,
      })
    } catch (err) {
      return {
        ok: false,
        code: 'BOOTSTRAP_SERVER_CHECK_FAILED',
        message: err instanceof Error ? err.message : 'Network error during server empty check.',
        error: { code: 'BOOTSTRAP_SERVER_CHECK_FAILED', message: String(err) },
      }
    }

    if (!serverCheckResp || !serverCheckResp.ok) {
      return {
        ok: false,
        code: serverCheckResp?.error?.code ?? 'BOOTSTRAP_SERVER_CHECK_FAILED',
        message: serverCheckResp?.error?.message ?? serverCheckResp?.message ?? 'Server check failed.',
        error: serverCheckResp?.error ?? { code: 'BOOTSTRAP_SERVER_CHECK_FAILED' },
      }
    }

    const respData = serverCheckResp.data?.data ?? serverCheckResp.data
    const records = respData?.records
    const serverSeq = respData?.server_sequence
    const nextCursor = respData?.next_cursor
    const hasMore = respData?.has_more

    if (
      !Array.isArray(records) ||
      records.length > 0 ||
      serverSeq !== 0 ||
      nextCursor !== 0 ||
      hasMore !== false
    ) {
      return {
        ok: false,
        code: 'BOOTSTRAP_SERVER_NOT_EMPTY',
        message: 'Target cloud already contains sync records. Initial bootstrap can only proceed on an empty cloud target.',
        error: { code: 'BOOTSTRAP_SERVER_NOT_EMPTY' },
      }
    }

    // ── 5. Build Local Snapshot From Stores ───────────────────────────────────
    const productStore = stores?.productStore ?? (pinia ? useProductStore(pinia) : null)
    const cashStore = stores?.cashStore ?? (pinia ? useCashStore(pinia) : null)
    const customerStore = stores?.customerStore ?? (pinia ? useCustomerStore(pinia) : null)
    const expenseStore = stores?.expenseStore ?? (pinia ? useExpenseStore(pinia) : null)
    const transactionStore =
      stores?.transactionStore ?? (pinia ? useTransactionStore(pinia) : null)
    const shiftStore = stores?.shiftStore ?? (pinia ? useShiftStore(pinia) : null)

    const rawCategories = productStore?.categories ?? []
    const categories = rawCategories.filter(
      (cat) =>
        typeof cat === 'string' &&
        cat.trim().length > 0 &&
        cat.trim().toLowerCase() !== SYNC_RESERVED_CATEGORY.toLowerCase(),
    )

    const products = (productStore?.products ?? []).filter((p) => p && p.id !== undefined && p.id !== null)
    const customers = (customerStore?.customers ?? []).filter((c) => c && c.id !== undefined && c.id !== null)
    const expenses = (expenseStore?.expenses ?? []).filter((e) => e && e.id !== undefined && e.id !== null)
    const rawTransactions = transactionStore?.items ?? transactionStore?.transactions ?? []
    const transactions = rawTransactions.filter((t) => t && t.id !== undefined && t.id !== null)

    const syntheticEntries = []

    for (const cat of categories) {
      syntheticEntries.push({
        id: `bootstrap-cat-${cat}`,
        entityType: SYNC_ENTITY_TYPES.CATEGORY,
        entityId: cat,
        operation: SYNC_OPERATIONS.UPSERT,
        payload: { name: cat },
      })
    }

    for (const p of products) {
      syntheticEntries.push({
        id: `bootstrap-prod-${p.id}`,
        entityType: SYNC_ENTITY_TYPES.PRODUCT,
        entityId: p.id,
        operation: SYNC_OPERATIONS.UPSERT,
        payload: { ...p },
      })
    }

    for (const c of customers) {
      syntheticEntries.push({
        id: `bootstrap-cust-${c.id}`,
        entityType: SYNC_ENTITY_TYPES.CUSTOMER,
        entityId: c.id,
        operation: SYNC_OPERATIONS.UPSERT,
        payload: { ...c },
      })
    }

    for (const e of expenses) {
      syntheticEntries.push({
        id: `bootstrap-exp-${e.id}`,
        entityType: SYNC_ENTITY_TYPES.EXPENSE,
        entityId: e.id,
        operation: SYNC_OPERATIONS.UPSERT,
        payload: { ...e },
      })
    }

    for (const t of transactions) {
      syntheticEntries.push({
        id: `bootstrap-trx-${t.id}`,
        entityType: SYNC_ENTITY_TYPES.TRANSACTION,
        entityId: t.id,
        operation: SYNC_OPERATIONS.UPSERT,
        payload: { ...t },
      })
    }

    // Current meaningful shift state (open or most recently closed).
    if (shiftStore?.id && shiftStore?.openedAt) {
      syntheticEntries.push({
        id: `bootstrap-shift-${shiftStore.id}`,
        entityType: SYNC_ENTITY_TYPES.SHIFT,
        entityId: shiftStore.id,
        operation: SYNC_OPERATIONS.UPSERT,
        payload: {
          id: shiftStore.id,
          shiftNumber: shiftStore.shiftNumber ?? shiftStore.id,
          status: shiftStore.status ?? (shiftStore.isOpen ? 'open' : 'closed'),
          openingCash: shiftStore.openingBalance ?? 0,
          closingCash: shiftStore.closingBalance ?? null,
          openedAt: shiftStore.openedAt,
          closedAt: shiftStore.closedAt ?? null,
          notes: shiftStore.notes ?? '',
        },
      })
    }

    const cashEntries = (cashStore?.entries ?? []).filter((e) => e && e.id !== undefined && e.id !== null)
    for (const entry of cashEntries) {
      syntheticEntries.push({
        id: `bootstrap-cash-${entry.id}`,
        entityType: SYNC_ENTITY_TYPES.CASH_ENTRY,
        entityId: entry.id,
        operation: SYNC_OPERATIONS.UPSERT,
        payload: { ...entry },
      })
    }

    const stockMovements = (productStore?.stockMovements ?? []).filter((m) => m && m.id !== undefined && m.id !== null)
    for (const movement of stockMovements) {
      syntheticEntries.push({
        id: `bootstrap-move-${movement.id}`,
        entityType: SYNC_ENTITY_TYPES.STOCK_MOVEMENT,
        entityId: movement.id,
        operation: SYNC_OPERATIONS.UPSERT,
        payload: { ...movement },
      })
    }

    // ── 6. Fail-Closed Preflight Validation via P11 Contract Mapper ───────────
    let preflightResult = null
    try {
      preflightResult = await mapOutboxEntries(syntheticEntries, {
        registry: activeRegistry,
        adapter,
        scheduler,
      })
    } catch (err) {
      return {
        ok: false,
        code: 'BOOTSTRAP_PREFLIGHT_FAILED',
        message: 'Preflight mapping threw an unhandled error.',
        error: { code: 'BOOTSTRAP_PREFLIGHT_FAILED', message: String(err) },
      }
    }

    if (preflightResult.blocked && preflightResult.blocked.length > 0) {
      return {
        ok: false,
        code: 'BOOTSTRAP_PREFLIGHT_FAILED',
        message: 'Sebagian data lokal belum kompatibel untuk sinkronisasi.',
        blockers: preflightResult.blocked,
        blockedCount: preflightResult.blocked.length,
        error: {
          code: 'BOOTSTRAP_PREFLIGHT_FAILED',
          message: 'Sebagian data lokal belum kompatibel untuk sinkronisasi.',
          blockers: preflightResult.blocked,
        },
      }
    }

    if (preflightResult.warnings && preflightResult.warnings.length > 0) {
      for (const w of preflightResult.warnings) {
        if (!warnings.includes(w)) {
          warnings.push(w)
        }
      }
    }

    // ── 6.5. Dependency Closure Validation ───────────────────────────────────
    const mappedChanges = preflightResult.changes || {}
    const catSyncIds = new Set((mappedChanges.categories || []).map((c) => c.sync_id.toLowerCase()))
    const prodSyncIds = new Set((mappedChanges.products || []).map((p) => p.sync_id.toLowerCase()))
    const custSyncIds = new Set((mappedChanges.customers || []).map((c) => c.sync_id.toLowerCase()))
    const saleSyncIds = new Set((mappedChanges.sales || []).map((s) => s.sync_id.toLowerCase()))

    const missingDependencies = []

    // 1. Product -> Category
    for (const prod of mappedChanges.products || []) {
      if (prod.category_sync_id && !catSyncIds.has(prod.category_sync_id.toLowerCase())) {
        missingDependencies.push({
          entity: 'products',
          syncId: prod.sync_id,
          dependencyEntity: 'categories',
          dependencySyncId: prod.category_sync_id,
        })
      }
    }

    // 2. Sale -> Customer
    for (const sale of mappedChanges.sales || []) {
      if (sale.customer_sync_id && !custSyncIds.has(sale.customer_sync_id.toLowerCase())) {
        missingDependencies.push({
          entity: 'sales',
          syncId: sale.sync_id,
          dependencyEntity: 'customers',
          dependencySyncId: sale.customer_sync_id,
        })
      }
    }

    // 3. SaleItem -> Sale
    for (const item of mappedChanges.sale_items || []) {
      if (item.sale_sync_id && !saleSyncIds.has(item.sale_sync_id.toLowerCase())) {
        missingDependencies.push({
          entity: 'sale_items',
          syncId: item.sync_id,
          dependencyEntity: 'sales',
          dependencySyncId: item.sale_sync_id,
        })
      }
    }

    // 4. SaleItem -> Product
    for (const item of mappedChanges.sale_items || []) {
      if (item.product_sync_id && !prodSyncIds.has(item.product_sync_id.toLowerCase())) {
        missingDependencies.push({
          entity: 'sale_items',
          syncId: item.sync_id,
          dependencyEntity: 'products',
          dependencySyncId: item.product_sync_id,
        })
      }
    }

    // 5. Stock movement -> Product
    for (const movement of mappedChanges.stock_movements || []) {
      if (movement.product_sync_id && !prodSyncIds.has(movement.product_sync_id.toLowerCase())) {
        missingDependencies.push({
          entity: 'stock_movements',
          syncId: movement.sync_id,
          dependencyEntity: 'products',
          dependencySyncId: movement.product_sync_id,
        })
      }
    }

    // 6. Cash entry -> Sale (optional link; only when present)
    for (const entry of mappedChanges.cash_ledger || []) {
      if (entry.sale_sync_id && !saleSyncIds.has(entry.sale_sync_id.toLowerCase())) {
        missingDependencies.push({
          entity: 'cash_ledger',
          syncId: entry.sync_id,
          dependencyEntity: 'sales',
          dependencySyncId: entry.sale_sync_id,
        })
      }
    }

    if (missingDependencies.length > 0) {
      return {
        ok: false,
        code: 'BOOTSTRAP_DEPENDENCY_MISSING',
        message: 'Bootstrap dataset has missing parent dependencies.',
        dependencies: missingDependencies,
        error: {
          code: 'BOOTSTRAP_DEPENDENCY_MISSING',
          message: 'Bootstrap dataset has missing parent dependencies.',
          dependencies: missingDependencies,
        },
      }
    }

    // ── 7. Atomic Outbox Staging to P9 sync_queue ─────────────────────────────
    const stageResult = await activeQueueService.enqueueManyUpserts(syntheticEntries)
    if (!stageResult || !stageResult.ok) {
      return {
        ok: false,
        code: 'BOOTSTRAP_STAGE_FAILED',
        message: 'Failed to stage bootstrap entries to outbox.',
        error: stageResult?.error ?? { code: 'BOOTSTRAP_STAGE_FAILED' },
      }
    }

    // ── 8. Persist Durable Bootstrap State (sync_bootstrap_state_v1) ──────────
    const bootstrapState = {
      version: 1,
      businessId: ctx.selectedBusiness.id,
      outletId: ctx.selectedOutlet.id,
      deviceIdentifier: ctx.deviceIdentifier,
      registeredDeviceId: ctx.registeredDeviceId,
      status: 'staged',
      stagedAt: new Date().toISOString(),
      counts: {
        categories: categories.length,
        products: products.length,
        customers: customers.length,
        expenses: expenses.length,
        transactions: transactions.length,
        shifts: shiftStore?.id && shiftStore?.openedAt ? 1 : 0,
        cashEntries: cashEntries.length,
        stockMovements: stockMovements.length,
      },
    }

    if (adapter && typeof adapter.saveSyncBootstrapState === 'function') {
      try {
        await adapter.saveSyncBootstrapState(bootstrapState)
      } catch (err) {
        return {
          ok: false,
          code: 'BOOTSTRAP_STATE_PERSIST_FAILED',
          message: 'Failed to persist bootstrap state.',
          error: err,
        }
      }
    }

    // ── 9. Return Success ─────────────────────────────────────────────────────
    return {
      ok: true,
      staged: syntheticEntries.length,
      counts: bootstrapState.counts,
      warnings,
      state: bootstrapState,
    }
  }

  return {
    bootstrapNow,
    queueService: activeQueueService,
    registry: activeRegistry,
  }
}
