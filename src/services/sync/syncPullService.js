import { pullSyncChanges } from './syncPullTransport'
import { isUuid } from './syncIdentityRegistry'
import { createSyncIdentityRegistry } from './syncIdentityRegistry'
import { createSyncQueueService } from './syncQueueService'
import { getToken } from '@/services/cloud/tokenRepository'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useProductStore } from '@/stores/productStore'
import { useCashStore } from '@/stores/cashStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useTransactionStore } from '@/stores/transactionStore'

const KNOWN_ENTITIES = new Set([
  'categories',
  'products',
  'customers',
  'shifts',
  'sales',
  'sale_items',
  'expenses',
  'cash_ledger',
  'stock_movements',
])

const BASE_URL = (import.meta.env?.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

export function isProductionApiConfigured() {
  if (!BASE_URL) {
    return false
  }

  if (/^(https?:\/\/)?localhost([:/]|$)/i.test(BASE_URL)) {
    return false
  }

  return /^https?:\/\//i.test(BASE_URL)
}

const MAX_PULL_PAGES = 1000

/**
 * Creates the durable manual pull & apply service for Laravel /api/sync/pull.
 *
 * @param {object} [options]
 * @param {object} [options.adapter] Database persistence adapter.
 * @param {object} [options.scheduler] Serialized persistence writer / flush mechanism.
 * @param {object} [options.queueService] P9 sync queue service for conflict detection.
 * @param {object} [options.registry] P11/P13 sync identity registry.
 * @param {Function} [options.tokenFetcher] Function returning Bearer token.
 * @param {object} [options.cloudStore] Pinia CloudSessionStore.
 * @param {Function} [options.transport] Pure HTTP pull transport function.
 * @param {object} [options.stores] Object containing domain stores { productStore, customerStore, expenseStore, transactionStore }.
 * @param {object} [options.pinia] Pinia instance.
 */
export function createSyncPullService({
  adapter = null,
  scheduler = null,
  queueService = null,
  registry = null,
  tokenFetcher = null,
  cloudStore = null,
  transport = pullSyncChanges,
  stores = null,
  pinia = null,
  contextGuardService = null,
} = {}) {
  const activeRegistry =
    registry ??
    createSyncIdentityRegistry({
      adapter,
      scheduler,
    })

  const activeQueueService =
    queueService ??
    createSyncQueueService({
      adapter,
      scheduler,
    })

  async function resolveToken(overrideContext = {}) {
    if (overrideContext.token) return overrideContext.token
    if (typeof tokenFetcher === 'function') {
      try {
        const t = await tokenFetcher()
        if (t) return t
      } catch {
        // continue
      }
    }
    if (cloudStore?.token) return cloudStore.token
    try {
      return await getToken()
    } catch {
      return null
    }
  }

  /**
   * Performs a complete, snapshot-safe manual pull from Laravel /api/sync/pull
   * and applies changes idempotently to local Pinia stores and persistence.
   *
   * @param {object} [options]
   * @param {object} [options.context]
   * @returns {Promise<{ok: boolean, fetched?: number, applied?: number, ignored?: number, warnings?: string[], cursorBefore?: number, cursorAfter?: number, serverSequence?: number, pages?: number, error?: any, code?: string, conflict?: any}>}
   */
  async function pullNow(options = {}) {
    const overrideContext = options.context ?? {}
    const activeCloudStore = cloudStore ?? (pinia ? useCloudSessionStore(pinia) : null)

    const token = await resolveToken(overrideContext)
    const user = overrideContext.user ?? activeCloudStore?.user
    const selectedBusiness = overrideContext.selectedBusiness ?? activeCloudStore?.selectedBusiness
    const selectedOutlet = overrideContext.selectedOutlet ?? activeCloudStore?.selectedOutlet
    const cloudAccess = overrideContext.cloudAccess ?? activeCloudStore?.cloudAccess
    const deviceIdentifier = overrideContext.deviceIdentifier ?? activeCloudStore?.deviceIdentifier
    const registeredDeviceId =
      overrideContext.registeredDeviceId ?? activeCloudStore?.registeredDeviceId

    // ── 1. Preconditions check ────────────────────────────────────────────────
    if (
      !token ||
      !user ||
      !selectedBusiness ||
      cloudAccess !== true ||
      !selectedOutlet ||
      !deviceIdentifier ||
      !registeredDeviceId
    ) {
      return {
        ok: false,
        code: 'PRECONDITION_FAILED',
        message:
          'Sync pull preconditions failed: missing authentication, cloud context, or device registration.',
        error: {
          code: 'PRECONDITION_FAILED',
          message:
            'Sync pull preconditions failed: missing authentication, cloud context, or device registration.',
        },
      }
    }

    // ── 1.5. P23 Context Guard Inspection ────────────────────────────────────
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
        return {
          ok: false,
          code: 'SYNC_CONTEXT_GUARD_BLOCKED',
          contextGuardCode: guard.code,
          message: 'Sync pull operation blocked by context guard.',
          error: {
            code: 'SYNC_CONTEXT_GUARD_BLOCKED',
            contextGuardCode: guard.code,
          },
        }
      }
    }

    // ── 2. P12 Business Binding check ─────────────────────────────────────────
    if (adapter && typeof adapter.loadSyncPushBinding === 'function') {
      const pushBinding = await adapter.loadSyncPushBinding()
      if (!pushBinding) {
        return {
          ok: false,
          code: 'SYNC_BUSINESS_NOT_BOUND',
          message: 'Business has not been bound to sync outbox yet. Push sync must be initialized first.',
          error: {
            code: 'SYNC_BUSINESS_NOT_BOUND',
            message:
              'Business has not been bound to sync outbox yet. Push sync must be initialized first.',
          },
        }
      }

      if (Number(pushBinding.businessId) !== Number(selectedBusiness.id)) {
        return {
          ok: false,
          code: 'SYNC_BUSINESS_BINDING_MISMATCH',
          message: `Business binding mismatch: current business ID ${selectedBusiness.id} does not match bound business ID ${pushBinding.businessId}.`,
          error: {
            code: 'SYNC_BUSINESS_BINDING_MISMATCH',
            message: `Business binding mismatch: current business ID ${selectedBusiness.id} does not match bound business ID ${pushBinding.businessId}.`,
          },
        }
      }
    }

    // ── 3. P13 Pull Context Binding check ─────────────────────────────────────
    let existingPullBinding = null
    if (adapter && typeof adapter.loadSyncPullBinding === 'function') {
      existingPullBinding = await adapter.loadSyncPullBinding()
      if (existingPullBinding) {
        const isMatch =
          Number(existingPullBinding.businessId) === Number(selectedBusiness.id) &&
          Number(existingPullBinding.outletId) === Number(selectedOutlet.id) &&
          String(existingPullBinding.deviceIdentifier) === String(deviceIdentifier) &&
          Number(existingPullBinding.registeredDeviceId) === Number(registeredDeviceId)

        if (!isMatch) {
          return {
            ok: false,
            code: 'SYNC_PULL_CONTEXT_MISMATCH',
            message:
              'Sync pull context mismatch: local dataset is bound to a different business/outlet/device context.',
            error: {
              code: 'SYNC_PULL_CONTEXT_MISMATCH',
              message:
                'Sync pull context mismatch: local dataset is bound to a different business/outlet/device context.',
            },
          }
        }
      }
    }

    // ── 4. Durable pull cursor ────────────────────────────────────────────────
    let pullState = null
    if (adapter && typeof adapter.loadSyncPullState === 'function') {
      pullState = await adapter.loadSyncPullState()
    }
    const cursorBefore = pullState?.cursor != null ? Number(pullState.cursor) : 0
    let currentAfter = cursorBefore
    let finalServerSequence =
      pullState?.serverSequence != null ? Number(pullState.serverSequence) : 0

    // ── 5. Paginated Fetch Loop ───────────────────────────────────────────────
    let pagesCount = 0
    let hasMore = true
    const allRecords = []

    while (hasMore) {
      if (pagesCount >= MAX_PULL_PAGES) {
        return {
          ok: false,
          code: 'PULL_PAGE_GUARD_EXCEEDED',
          message: `Pull page guard exceeded maximum allowed pages (${MAX_PULL_PAGES}).`,
          error: {
            code: 'PULL_PAGE_GUARD_EXCEEDED',
            message: `Pull page guard exceeded maximum allowed pages (${MAX_PULL_PAGES}).`,
          },
        }
      }

      const response = await transport({
        token,
        businessId: selectedBusiness.id,
        deviceIdentifier,
        after: currentAfter,
        limit: 200,
      })

      pagesCount++

      if (!response.ok) {
        return {
          ok: false,
          code: response.error?.code ?? 'PULL_TRANSPORT_ERROR',
          message: response.error?.message ?? 'Failed to pull changes from server.',
          error: response.error ?? {
            code: 'PULL_TRANSPORT_ERROR',
            message: 'Transport error',
          },
        }
      }

      const respData = response.data?.data ?? response.data
      if (!respData || typeof respData !== 'object') {
        return {
          ok: false,
          code: 'INVALID_PULL_RESPONSE',
          message: 'Server returned invalid sync pull response structure.',
          error: { code: 'INVALID_PULL_RESPONSE', message: 'Invalid response body' },
        }
      }

      const records = respData.records
      const nextCursor = respData.next_cursor
      const serverSeq = respData.server_sequence
      const respHasMore = respData.has_more

      if (
        !Array.isArray(records) ||
        !Number.isInteger(nextCursor) ||
        nextCursor < 0 ||
        !Number.isInteger(serverSeq) ||
        serverSeq < 0 ||
        typeof respHasMore !== 'boolean'
      ) {
        return {
          ok: false,
          code: 'INVALID_PULL_RESPONSE',
          message:
            'Server returned invalid response fields (records, next_cursor, server_sequence, has_more).',
          error: { code: 'INVALID_PULL_RESPONSE', message: 'Invalid response fields' },
        }
      }

      if (nextCursor < currentAfter) {
        return {
          ok: false,
          code: 'REGRESSIVE_PULL_CURSOR',
          message: `Server returned next_cursor (${nextCursor}) which regressed before after (${currentAfter}).`,
          error: { code: 'REGRESSIVE_PULL_CURSOR', message: 'Regressive cursor' },
        }
      }

      if (respHasMore && nextCursor <= currentAfter) {
        return {
          ok: false,
          code: 'NON_ADVANCING_PULL_CURSOR',
          message: `Server returned has_more=true but next_cursor (${nextCursor}) did not advance past after (${currentAfter}).`,
          error: { code: 'NON_ADVANCING_PULL_CURSOR', message: 'Non-advancing cursor' },
        }
      }

      for (const record of records) {
        if (
          !record ||
          typeof record !== 'object' ||
          !KNOWN_ENTITIES.has(record.entity) ||
          !Number.isInteger(record.sync_sequence) ||
          record.sync_sequence <= 0 ||
          !record.data ||
          typeof record.data !== 'object' ||
          !isUuid(record.data.sync_id) ||
          !Number.isInteger(record.data.sync_version) ||
          record.data.sync_version < 1
        ) {
          return {
            ok: false,
            code: 'INVALID_PULL_RECORD',
            message: `Server returned an invalid record: ${JSON.stringify(record)}`,
            error: { code: 'INVALID_PULL_RECORD', message: 'Invalid record shape' },
          }
        }
        allRecords.push(record)
      }

      currentAfter = nextCursor
      finalServerSequence = serverSeq
      hasMore = respHasMore
    }

    const cursorAfter = currentAfter

    // ── 6. Handle empty snapshot ──────────────────────────────────────────────
    if (allRecords.length === 0) {
      if (!existingPullBinding && adapter && typeof adapter.saveSyncPullBinding === 'function') {
        await adapter.saveSyncPullBinding({
          businessId: selectedBusiness.id,
          outletId: selectedOutlet.id,
          deviceIdentifier,
          registeredDeviceId,
          boundAt: new Date().toISOString(),
        })
      }

      if (
        cursorAfter !== cursorBefore &&
        adapter &&
        typeof adapter.saveSyncPullState === 'function'
      ) {
        try {
          await adapter.saveSyncPullState({
            version: 1,
            cursor: cursorAfter,
            serverSequence: finalServerSequence,
            updatedAt: new Date().toISOString(),
          })
        } catch (err) {
          return {
            ok: false,
            code: 'SYNC_PULL_CURSOR_PERSIST_FAILED',
            message: 'Failed to persist sync pull cursor after empty pull.',
            error: {
              code: 'SYNC_PULL_CURSOR_PERSIST_FAILED',
              message: err instanceof Error ? err.message : String(err),
            },
          }
        }
      }

      return {
        ok: true,
        fetched: 0,
        applied: 0,
        ignored: 0,
        warnings: [],
        cursorBefore,
        cursorAfter,
        serverSequence: finalServerSequence,
        pages: pagesCount,
        error: null,
      }
    }

    // ── 7. Sort records by sync_sequence ASC ──────────────────────────────────
    allRecords.sort((a, b) => a.sync_sequence - b.sync_sequence)

    // ── 8. Resolve domain stores and build prospective next state ─────────────
    const productStore = stores?.productStore ?? (pinia ? useProductStore(pinia) : null)
    const cashStore = stores?.cashStore ?? (pinia ? useCashStore(pinia) : null)
    const customerStore = stores?.customerStore ?? (pinia ? useCustomerStore(pinia) : null)
    const expenseStore = stores?.expenseStore ?? (pinia ? useExpenseStore(pinia) : null)
    const transactionStore =
      stores?.transactionStore ?? (pinia ? useTransactionStore(pinia) : null)
    const shiftStore = stores?.shiftStore ?? (pinia ? useShiftStore(pinia) : null)

    // Helper to scan for conflicts against all pending outbox mutations
    async function checkForPendingConflicts(records) {
      let pendingItems = []
      if (activeQueueService && typeof activeQueueService.listPending === 'function') {
        if (typeof activeQueueService.countPending === 'function') {
          const totalPending = await activeQueueService.countPending()
          if (totalPending > 0) {
            pendingItems = await activeQueueService.listPending({ limit: totalPending })
          }
        } else {
          pendingItems = await activeQueueService.listPending({ limit: 100000 })
        }
      }

      if (!pendingItems || pendingItems.length === 0) {
        return null
      }

      for (const record of records) {
        let syncId = (record.data.sync_id || '').toLowerCase()
        let outboxType = null
        if (record.entity === 'categories') outboxType = 'category'
        else if (record.entity === 'products') outboxType = 'product'
        else if (record.entity === 'customers') outboxType = 'customer'
        else if (record.entity === 'expenses') outboxType = 'expense'
        else if (record.entity === 'shifts') outboxType = 'shift'
        else if (record.entity === 'cash_ledger') outboxType = 'cash_entry'
        else if (record.entity === 'stock_movements') outboxType = 'stock_movement'
        else if (record.entity === 'sales') outboxType = 'transaction'
        else if (record.entity === 'sale_items') {
          outboxType = 'transaction'
          syncId = (record.data.sale_sync_id || '').toLowerCase()
        }

        if (!syncId) continue

        // Check if category rename affects any local product with pending outbox mutations
        if (record.entity === 'categories') {
          const newCatName = record.data.name
          let existingLocalName = null
          if (activeRegistry) {
            existingLocalName = await activeRegistry.findLocalKeyBySyncId('category', syncId)
          }
          if (existingLocalName && existingLocalName !== newCatName) {
            const localProducts = productStore ? productStore.products : []
            const affectedProducts = localProducts.filter((p) => p.category === existingLocalName)

            for (const affProd of affectedProducts) {
              for (const pending of pendingItems) {
                if (pending.entityType !== 'product') continue

                let isProdMatch = false
                if (String(pending.entityId) === String(affProd.id)) {
                  isProdMatch = true
                } else if (
                  String(pending.entityId).toLowerCase() === String(affProd.id).toLowerCase()
                ) {
                  isProdMatch = true
                } else if (activeRegistry) {
                  const resolvedProdSyncId = activeRegistry.peekSyncId('product', pending.entityId)
                  if (
                    resolvedProdSyncId &&
                    String(resolvedProdSyncId).toLowerCase() === String(affProd.id).toLowerCase()
                  ) {
                    isProdMatch = true
                  }
                  const affProdSyncId = activeRegistry.peekSyncId('product', affProd.id)
                  if (
                    affProdSyncId &&
                    String(affProdSyncId).toLowerCase() === String(pending.entityId).toLowerCase()
                  ) {
                    isProdMatch = true
                  }
                }

                if (isProdMatch) {
                  return {
                    ok: false,
                    code: 'LOCAL_PENDING_SYNC_CONFLICT',
                    conflict: {
                      entity: 'categories',
                      syncId: record.data.sync_id,
                      localEntityId: pending.entityId,
                      syncSequence: record.sync_sequence,
                    },
                    message: `Remote category rename for ${existingLocalName} -> ${newCatName} (sync_id: ${record.data.sync_id}) conflicts with pending local product outbox item ${pending.entityId}.`,
                    error: {
                      code: 'LOCAL_PENDING_SYNC_CONFLICT',
                      message: `Remote category rename for ${existingLocalName} -> ${newCatName} (sync_id: ${record.data.sync_id}) conflicts with pending local product outbox item ${pending.entityId}.`,
                    },
                  }
                }
              }
            }
          }
        }

        for (const pending of pendingItems) {
          let isMatch = false
          const matchedLocalId = pending.entityId

          if (
            pending.entityType === outboxType ||
            (record.entity === 'sale_items' && pending.entityType === 'transaction')
          ) {
            if (String(pending.entityId).toLowerCase() === syncId) {
              isMatch = true
            } else {
              const resolvedSyncId = activeRegistry
                ? activeRegistry.peekSyncId(pending.entityType, pending.entityId)
                : null
              if (resolvedSyncId && resolvedSyncId.toLowerCase() === syncId) {
                isMatch = true
              } else if (activeRegistry) {
                const localKey = await activeRegistry.findLocalKeyBySyncId(
                  pending.entityType,
                  syncId,
                )
                if (localKey && String(localKey) === String(pending.entityId)) {
                  isMatch = true
                }
              }

              if (
                !isMatch &&
                record.entity === 'categories' &&
                String(pending.entityId) === String(record.data.name)
              ) {
                isMatch = true
              }
            }
          }

          if (isMatch) {
            return {
              ok: false,
              code: 'LOCAL_PENDING_SYNC_CONFLICT',
              conflict: {
                entity: record.entity,
                syncId: record.data.sync_id,
                localEntityId: matchedLocalId,
                syncSequence: record.sync_sequence,
              },
              message: `Remote change for ${record.entity} (sync_id: ${record.data.sync_id}) conflicts with pending local outbox item ${matchedLocalId}.`,
              error: {
                code: 'LOCAL_PENDING_SYNC_CONFLICT',
                message: `Remote change for ${record.entity} (sync_id: ${record.data.sync_id}) conflicts with pending local outbox item ${matchedLocalId}.`,
              },
            }
          }
        }
      }

      return null
    }

    // ── 8.5. Early local pending outbox conflict check ────────────────────────
    const earlyConflict = await checkForPendingConflicts(allRecords)
    if (earlyConflict) {
      return earlyConflict
    }

    const nextCategories = productStore ? [...productStore.categories] : []
    const nextProducts = productStore ? productStore.products.map((p) => ({ ...p })) : []
    const nextCustomers = customerStore ? customerStore.customers.map((c) => ({ ...c })) : []
    const nextExpenses = expenseStore ? expenseStore.expenses.map((e) => ({ ...e })) : []
    const nextCashEntries = cashStore ? cashStore.entries.map((e) => ({ ...e })) : []
    const nextStockMovements = productStore
      ? productStore.stockMovements.map((m) => ({ ...m }))
      : []
    const nextShift = shiftStore
      ? {
          id: shiftStore.id,
          shiftNumber: shiftStore.shiftNumber,
          status: shiftStore.status,
          openingBalance: shiftStore.openingBalance,
          openedAt: shiftStore.openedAt,
          closingBalance: shiftStore.closingBalance,
          closedAt: shiftStore.closedAt,
          notes: shiftStore.notes,
          isOpen: shiftStore.isOpen,
        }
      : null
    const nextTransactions = transactionStore
      ? transactionStore.items.map((t) => ({
          ...t,
          items: Array.isArray(t.items) ? t.items.map((it) => ({ ...it })) : [],
        }))
      : []

    const warnings = []
    let appliedCount = 0
    let ignoredCount = 0
    const plannedRegistryBinds = []

    let serverVersionsToSave = {}
    if (adapter && typeof adapter.loadSyncServerVersions === 'function') {
      const existingVersions = await adapter.loadSyncServerVersions()
      if (existingVersions && typeof existingVersions === 'object') {
        serverVersionsToSave = { ...existingVersions }
      }
    }

    // Index pulled sale_items by sale_sync_id
    const pulledSaleItemsBySaleId = {}
    const standaloneSaleItems = []
    const pulledSalesSyncIds = new Set()

    for (const record of allRecords) {
      if (record.entity === 'sales') {
        pulledSalesSyncIds.add(record.data.sync_id.toLowerCase())
      }
    }

    for (const record of allRecords) {
      if (record.entity === 'sale_items') {
        const saleSyncId = record.data.sale_sync_id?.toLowerCase()
        if (saleSyncId && pulledSalesSyncIds.has(saleSyncId)) {
          if (!pulledSaleItemsBySaleId[saleSyncId]) {
            pulledSaleItemsBySaleId[saleSyncId] = []
          }
          pulledSaleItemsBySaleId[saleSyncId].push(record)
        } else {
          standaloneSaleItems.push(record)
        }
      }
    }

    // Process non-sale records and sales in order
    for (const record of allRecords) {
      const { entity, sync_sequence, data } = record
      const syncId = data.sync_id.toLowerCase()
      const syncVersion = data.sync_version

      if (entity === 'categories') {
        const { name, status } = data

        // Tombstone: a deleted category disappears from the local master and
        // is detached from products (which keep selling under no category).
        if (status === 'deleted') {
          const existingLocalName = await activeRegistry.findLocalKeyBySyncId('category', syncId)

          if (existingLocalName) {
            const catIdx = nextCategories.indexOf(existingLocalName)
            if (catIdx !== -1) {
              nextCategories.splice(catIdx, 1)
            }
            for (const prod of nextProducts) {
              if (prod.category === existingLocalName) {
                prod.category = ''
              }
            }
          }

          appliedCount++
          serverVersionsToSave[`categories:${syncId}`] = {
            syncVersion,
            syncSequence: sync_sequence,
          }
          continue
        }

        if (status && status !== 'active') {
          warnings.push('UNSUPPORTED_LOCAL_CATEGORY_STATUS')
        }

        const existingLocalName = await activeRegistry.findLocalKeyBySyncId('category', syncId)

        if (existingLocalName) {
          if (existingLocalName === name) {
            if (!nextCategories.includes(name)) {
              nextCategories.push(name)
            }
          } else {
            // Category renamed
            const boundSyncId = activeRegistry.peekSyncId('category', name)
            if (boundSyncId && boundSyncId.toLowerCase() !== syncId) {
              return {
                ok: false,
                code: 'CATEGORY_SYNC_IDENTITY_COLLISION',
                message: `Category name "${name}" is already bound to sync identity "${boundSyncId}".`,
                error: {
                  code: 'CATEGORY_SYNC_IDENTITY_COLLISION',
                  message: `Category name "${name}" is already bound to sync identity "${boundSyncId}".`,
                },
              }
            }

            const catIdx = nextCategories.indexOf(existingLocalName)
            if (catIdx !== -1) {
              nextCategories[catIdx] = name
            } else if (!nextCategories.includes(name)) {
              nextCategories.push(name)
            }

            for (const prod of nextProducts) {
              if (prod.category === existingLocalName) {
                prod.category = name
              }
            }

            plannedRegistryBinds.push({
              type: 'rebind',
              entityType: 'category',
              oldKey: existingLocalName,
              newKey: name,
              syncId,
            })
          }
        } else {
          // New category sync_id
          const boundSyncId = activeRegistry.peekSyncId('category', name)
          if (boundSyncId && boundSyncId.toLowerCase() !== syncId) {
            return {
              ok: false,
              code: 'CATEGORY_SYNC_IDENTITY_COLLISION',
              message: `Category name "${name}" is already bound to sync identity "${boundSyncId}".`,
              error: {
                code: 'CATEGORY_SYNC_IDENTITY_COLLISION',
                message: `Category name "${name}" is already bound to sync identity "${boundSyncId}".`,
              },
            }
          }

          if (!nextCategories.includes(name)) {
            nextCategories.push(name)
          }

          plannedRegistryBinds.push({
            type: 'bind',
            entityType: 'category',
            key: name,
            syncId,
          })
        }

        appliedCount++
        serverVersionsToSave[`categories:${syncId}`] = {
          syncVersion,
          syncSequence: sync_sequence,
        }
      } else if (entity === 'products') {
        const {
          category_sync_id,
          name,
          price,
          status,
          kind,
          cost,
          stock,
          unit,
          min_stock,
          pricing_unit,
          min_quantity,
          estimated_duration,
        } = data

        // Tombstone deletes must never require a live category: a deleted
        // product is removed purely by identity, even when its category is
        // gone or unknown.
        if (status === 'deleted') {
          const localKey = await activeRegistry.findLocalKeyBySyncId('product', syncId)
          const existingGone = localKey
            ? nextProducts.find((p) => String(p.id) === String(localKey))
            : nextProducts.find((p) => String(p.id).toLowerCase() === syncId)

          if (existingGone) {
            const prodIdx = nextProducts.findIndex((p) => p === existingGone)
            if (prodIdx !== -1) {
              nextProducts.splice(prodIdx, 1)
            }
          }

          appliedCount++
          serverVersionsToSave[`products:${syncId}`] = {
            syncVersion,
            syncSequence: sync_sequence,
          }
          continue
        }

        if (category_sync_id === null || category_sync_id === undefined) {
          return {
            ok: false,
            code: 'REMOTE_PRODUCT_CATEGORY_REQUIRED_LOCALLY',
            message: `Remote product "${name}" (${syncId}) has no category_sync_id.`,
            error: {
              code: 'REMOTE_PRODUCT_CATEGORY_REQUIRED_LOCALLY',
              message: `Remote product "${name}" (${syncId}) has no category_sync_id.`,
            },
          }
        }

        let resolvedCategoryName = await activeRegistry.findLocalKeyBySyncId(
          'category',
          category_sync_id,
        )

        if (!resolvedCategoryName) {
          const plannedBind = plannedRegistryBinds.find(
            (p) =>
              p.entityType === 'category' &&
              p.syncId.toLowerCase() === category_sync_id.toLowerCase(),
          )
          if (plannedBind) {
            resolvedCategoryName = plannedBind.newKey ?? plannedBind.key
          }
        }

        if (!resolvedCategoryName || !nextCategories.includes(resolvedCategoryName)) {
          return {
            ok: false,
            code: 'REMOTE_PRODUCT_CATEGORY_UNRESOLVED',
            message: `Remote product "${name}" category_sync_id "${category_sync_id}" could not be resolved.`,
            error: {
              code: 'REMOTE_PRODUCT_CATEGORY_UNRESOLVED',
              message: `Remote product "${name}" category_sync_id "${category_sync_id}" could not be resolved.`,
            },
          }
        }

        let existingProd = nextProducts.find((p) => String(p.id).toLowerCase() === syncId)
        if (!existingProd) {
          const localKey = await activeRegistry.findLocalKeyBySyncId('product', syncId)
          if (localKey) {
            existingProd = nextProducts.find((p) => String(p.id) === String(localKey))
          }
        }

        const remoteKind = kind === 'service' ? 'service' : 'product'
        const remoteCost = Number(cost)
        const remoteStock = Number(stock)
        const remoteMinStock = Number(min_stock)
        const remoteMinQuantity = Number(min_quantity)

        // Accepted remote records converge normal mutable fields to the server
        // value (this branch only runs when no pending local mutation
        // conflicts). Stock is the deliberate exception handled below.
        if (existingProd) {
          existingProd.name = name
          existingProd.category = resolvedCategoryName
          existingProd.price = Number(price)
          existingProd.kind = remoteKind
          if (Number.isFinite(remoteCost) && remoteCost >= 0) {
            existingProd.cost = remoteCost
          }
          if (typeof unit === 'string' && unit.trim()) {
            existingProd.unit = unit.trim()
          }
          if (Number.isFinite(remoteMinStock) && remoteMinStock >= 0) {
            existingProd.minStock = remoteMinStock
          }
          if (typeof pricing_unit === 'string' && pricing_unit.trim()) {
            existingProd.pricingUnit = pricing_unit.trim()
          }
          if (Number.isFinite(remoteMinQuantity) && remoteMinQuantity >= 0) {
            existingProd.minQuantity = remoteMinQuantity
          }
          // An emptied remote duration clears the local value: it is a real
          // server-side edit, not a missing field.
          existingProd.estimatedDuration = typeof estimated_duration === 'string'
            ? estimated_duration
            : ''
          existingProd.isActive = status === 'active'
        } else if (status !== 'deleted') {
          nextProducts.push({
            id: syncId,
            name,
            category: resolvedCategoryName,
            price: Number(price),
            kind: remoteKind,
            cost: Number.isFinite(remoteCost) && remoteCost >= 0 ? remoteCost : 0,
            stock: Number.isFinite(remoteStock) && remoteStock >= 0 ? remoteStock : 0,
            unit: typeof unit === 'string' && unit.trim() ? unit.trim() : remoteKind === 'service' ? 'kg' : 'pcs',
            minStock: Number.isFinite(remoteMinStock) && remoteMinStock >= 0 ? remoteMinStock : 0,
            pricingUnit: typeof pricing_unit === 'string' && pricing_unit.trim() ? pricing_unit.trim() : remoteKind === 'service' ? 'kg' : 'pcs',
            minQuantity: Number.isFinite(remoteMinQuantity) && remoteMinQuantity >= 0 ? remoteMinQuantity : 0,
            estimatedDuration: typeof estimated_duration === 'string' ? estimated_duration : '',
            isActive: status === 'active',
          })
          plannedRegistryBinds.push({
            type: 'bind',
            entityType: 'product',
            key: syncId,
            syncId,
          })
        }

        appliedCount++
        serverVersionsToSave[`products:${syncId}`] = {
          syncVersion,
          syncSequence: sync_sequence,
        }
      } else if (entity === 'customers') {
        const { name, phone, email, status: customerStatus } = data

        let existingCust = nextCustomers.find((c) => String(c.id).toLowerCase() === syncId)
        if (!existingCust) {
          const localKey = await activeRegistry.findLocalKeyBySyncId('customer', syncId)
          if (localKey) {
            existingCust = nextCustomers.find((c) => String(c.id) === String(localKey))
          }
        }

        if (existingCust) {
          existingCust.name = name
          existingCust.phone = phone ?? ''
          existingCust.email = email ?? ''

          // Tombstone: a deleted customer disappears from the local master.
          if (customerStatus === 'deleted') {
            const custIdx = nextCustomers.findIndex((c) => c === existingCust)
            if (custIdx !== -1) {
              nextCustomers.splice(custIdx, 1)
            }
          }
        } else if (customerStatus !== 'deleted') {
          nextCustomers.push({
            id: syncId,
            name,
            phone: phone ?? '',
            email: email ?? '',
          })
          plannedRegistryBinds.push({
            type: 'bind',
            entityType: 'customer',
            key: syncId,
            syncId,
          })
        }

        appliedCount++
        serverVersionsToSave[`customers:${syncId}`] = {
          syncVersion,
          syncSequence: sync_sequence,
        }
      } else if (entity === 'expenses') {
        const { description, amount, occurred_at, notes, category } = data

        let existingExp = nextExpenses.find((e) => String(e.id).toLowerCase() === syncId)
        if (!existingExp) {
          const localKey = await activeRegistry.findLocalKeyBySyncId('expense', syncId)
          if (localKey) {
            existingExp = nextExpenses.find((e) => String(e.id) === String(localKey))
          }
        }

        if (existingExp) {
          existingExp.title = description
          // Restore the authoritative server category instead of forcing
          // every pulled expense into 'Lainnya'.
          if (typeof category === 'string' && category.trim()) {
            existingExp.category = category.trim()
          }
          existingExp.amount = Number(amount)
          existingExp.note = notes ?? ''
          existingExp.createdAt = occurred_at
        } else {
          nextExpenses.push({
            id: syncId,
            title: description,
            category: typeof category === 'string' && category.trim() ? category.trim() : 'Lainnya',
            amount: Number(amount),
            note: notes ?? '',
            createdAt: occurred_at,
          })
          plannedRegistryBinds.push({
            type: 'bind',
            entityType: 'expense',
            key: syncId,
            syncId,
          })
        }

        // Tombstone: a deleted/void expense disappears from the local master,
        // exactly like product/customer tombstones. Historical sales keep
        // their own copies and are never touched.
        if (data.status === 'deleted' || data.status === 'void') {
          const idx = existingExp
            ? nextExpenses.findIndex((e) => e === existingExp)
            : nextExpenses.findIndex((e) => String(e.id).toLowerCase() === syncId)
          if (idx !== -1) {
            nextExpenses.splice(idx, 1)
          }
        }

        appliedCount++
        serverVersionsToSave[`expenses:${syncId}`] = {
          syncVersion,
          syncSequence: sync_sequence,
        }
      } else if (entity === 'shifts') {
        const {
          shift_number,
          status: shiftStatus,
          opening_cash,
          closing_cash,
          opened_at,
          closed_at,
          notes: shiftNotes,
        } = data

        if (nextShift) {
          if (!nextShift.id) {
            nextShift.id = syncId
          }
          nextShift.shiftNumber = shift_number ?? nextShift.shiftNumber
          nextShift.status = shiftStatus ?? nextShift.status
          nextShift.openingBalance = opening_cash !== null && opening_cash !== undefined
            ? Number(opening_cash)
            : nextShift.openingBalance
          nextShift.openedAt = opened_at ?? nextShift.openedAt
          nextShift.closingBalance = closing_cash !== null && closing_cash !== undefined
            ? Number(closing_cash)
            : nextShift.closingBalance
          nextShift.closedAt = closed_at ?? nextShift.closedAt
          nextShift.notes = shiftNotes ?? nextShift.notes
          nextShift.isOpen = (shiftStatus ?? nextShift.status) === 'open'
        }

        plannedRegistryBinds.push({
          type: 'bind',
          entityType: 'shift',
          key: shift_number ?? syncId,
          syncId,
        })

        appliedCount++
        serverVersionsToSave[`shifts:${syncId}`] = {
          syncVersion,
          syncSequence: sync_sequence,
        }
      } else if (entity === 'cash_ledger') {
        const {
          type: cashType,
          amount: cashAmount,
          category: cashCategory,
          note: cashNote,
          reference_id,
          occurred_at: cashOccurredAt,
        } = data

        let existingCash = nextCashEntries.find((e) => String(e.id).toLowerCase() === syncId)
        if (!existingCash) {
          const localKey = await activeRegistry.findLocalKeyBySyncId('cash_entry', syncId)
          if (localKey) {
            existingCash = nextCashEntries.find((e) => String(e.id) === String(localKey))
          }
        }
        if (!existingCash && reference_id) {
          existingCash = nextCashEntries.find((e) => e.referenceId === reference_id)
        }

        if (existingCash) {
          existingCash.type = cashType ?? existingCash.type
          existingCash.amount = Number(cashAmount ?? existingCash.amount)
          existingCash.category = cashCategory ?? existingCash.category
          existingCash.note = cashNote ?? existingCash.note
          if (reference_id && !existingCash.referenceId) {
            existingCash.referenceId = reference_id
          }
          if (data.sale_sync_id && !existingCash.transactionId) {
            const saleLocalKey = activeRegistry
              ? await activeRegistry.findLocalKeyBySyncId('transaction', data.sale_sync_id)
              : null
            existingCash.transactionId = saleLocalKey ?? data.sale_sync_id
          }
          existingCash.createdAt = cashOccurredAt ?? existingCash.createdAt
        } else {
          const cashLocalKey = activeRegistry && data.sale_sync_id
            ? await activeRegistry.findLocalKeyBySyncId('transaction', data.sale_sync_id)
            : null
          nextCashEntries.push({
            id: syncId,
            type: cashType,
            amount: Number(cashAmount),
            category: cashCategory ?? (cashType === 'out' ? 'Kas Keluar' : 'Kas Masuk'),
            note: cashNote ?? '',
            referenceId: reference_id ?? null,
            transactionId: data.sale_sync_id ? (cashLocalKey ?? data.sale_sync_id) : null,
            createdAt: cashOccurredAt,
          })
          plannedRegistryBinds.push({
            type: 'bind',
            entityType: 'cash_entry',
            key: syncId,
            syncId,
          })
        }

        appliedCount++
        serverVersionsToSave[`cash_ledger:${syncId}`] = {
          syncVersion,
          syncSequence: sync_sequence,
        }
      } else if (entity === 'stock_movements') {
        const {
          product_sync_id,
          movement_type,
          quantity_change,
          stock_before,
          stock_after,
          reference_id: movementRef,
          category: movementCategory,
          note: movementNote,
          occurred_at: movementOccurredAt,
        } = data

        let resolvedProductId = await activeRegistry.findLocalKeyBySyncId('product', product_sync_id)
        if (!resolvedProductId) {
          const plannedProdBind = plannedRegistryBinds.find(
            (p) =>
              p.entityType === 'product' &&
              p.syncId.toLowerCase() === `${product_sync_id ?? ''}`.toLowerCase(),
          )
          if (plannedProdBind) {
            resolvedProductId = plannedProdBind.key
          }
        }
        const targetProductId = resolvedProductId ?? product_sync_id

        const targetProduct = nextProducts.find(
          (p) => String(p.id) === String(targetProductId) || String(p.id).toLowerCase() === syncId,
        )

        let existingMovement = nextStockMovements.find((m) => String(m.id).toLowerCase() === syncId)
        if (!existingMovement) {
          const localKey = await activeRegistry.findLocalKeyBySyncId('stock_movement', syncId)
          if (localKey) {
            existingMovement = nextStockMovements.find((m) => String(m.id) === String(localKey))
          }
        }
        if (!existingMovement && movementRef) {
          existingMovement = nextStockMovements.find((m) => m.referenceId === movementRef)
        }

        if (!existingMovement) {
          const movementLocalKey = activeRegistry && data.sale_sync_id
            ? await activeRegistry.findLocalKeyBySyncId('transaction', data.sale_sync_id)
            : null
          nextStockMovements.push({
            id: syncId,
            productId: targetProductId,
            productName: targetProduct?.name ?? '',
            type: movement_type,
            movementType: movement_type,
            quantityChange: Number(quantity_change),
            stockBefore: Number(stock_before ?? targetProduct?.stock ?? 0),
            stockAfter: Number(stock_after ?? targetProduct?.stock ?? 0),
            referenceId: movementRef ?? null,
            transactionId: data.sale_sync_id ? (movementLocalKey ?? data.sale_sync_id) : null,
            category: movementCategory ?? 'Adjustment',
            note: movementNote ?? '',
            createdAt: movementOccurredAt,
          })
          plannedRegistryBinds.push({
            type: 'bind',
            entityType: 'stock_movement',
            key: syncId,
            syncId,
          })

          // Authoritative chronology: the accepted remote stock_after wins.
          if (targetProduct && Number.isFinite(Number(stock_after))) {
            targetProduct.stock = Number(stock_after)
          }
        }

        appliedCount++
        serverVersionsToSave[`stock_movements:${syncId}`] = {
          syncVersion,
          syncSequence: sync_sequence,
        }
      } else if (entity === 'sales') {
        const {
          transaction_number,
          status,
          subtotal,
          tax_amount,
          total_amount,
          sold_at,
          discount_amount,
          customer_sync_id,
          payment_method,
          payment_status,
          paid_at,
          cash_received,
          change_amount,
          gross_profit,
          order_status,
          estimated_completed_at,
          note,
          customer_snapshot,
          business_snapshot,
        } = data

        if (discount_amount && Number(discount_amount) > 0) {
          warnings.push('UNSUPPORTED_LOCAL_SALE_DISCOUNT_FIELD')
        }

        const saleItemRecords = pulledSaleItemsBySaleId[syncId] ?? []

        let existingTrx = nextTransactions.find((t) => String(t.id).toLowerCase() === syncId)
        if (!existingTrx) {
          const localKey = await activeRegistry.findLocalKeyBySyncId('transaction', syncId)
          if (localKey) {
            existingTrx = nextTransactions.find((t) => String(t.id) === String(localKey))
          }
        }

        if (!existingTrx && saleItemRecords.length === 0) {
          return {
            ok: false,
            code: 'INCOMPLETE_REMOTE_SALE',
            message: `New remote sale ${syncId} has no sale_items in snapshot.`,
            error: {
              code: 'INCOMPLETE_REMOTE_SALE',
              message: `New remote sale ${syncId} has no sale_items in snapshot.`,
            },
          }
        }

        let customerName = 'Walk-in Customer'
        let resolvedCustomerId = null
        let customerSnapshot = null

        if (customer_sync_id) {
          let localCustKey = null
          if (activeRegistry) {
            localCustKey = await activeRegistry.findLocalKeyBySyncId('customer', customer_sync_id)
          }
          if (!localCustKey) {
            const plannedCustBind = plannedRegistryBinds.find(
              (p) =>
                p.entityType === 'customer' &&
                p.syncId.toLowerCase() === customer_sync_id.toLowerCase(),
            )
            if (plannedCustBind) {
              localCustKey = plannedCustBind.key
            }
          }

          const targetCustId = localCustKey ?? customer_sync_id
          resolvedCustomerId = targetCustId

          let matchedCust = nextCustomers.find(
            (c) => String(c.id).toLowerCase() === String(targetCustId).toLowerCase(),
          )
          if (!matchedCust && localCustKey) {
            matchedCust = nextCustomers.find(
              (c) => String(c.id).toLowerCase() === String(localCustKey).toLowerCase(),
            )
          }
          if (!matchedCust) {
            matchedCust = nextCustomers.find(
              (c) => String(c.id).toLowerCase() === customer_sync_id.toLowerCase(),
            )
          }

          if (matchedCust) {
            customerName = matchedCust.name
            resolvedCustomerId = matchedCust.id
            customerSnapshot = {
              id: matchedCust.id,
              name: matchedCust.name,
              phone: matchedCust.phone,
              email: matchedCust.email,
            }
          }
        }

        let mappedItems = []
        if (saleItemRecords.length > 0) {
          mappedItems = await Promise.all(
            saleItemRecords.map(async (siRecord) => {
              const siData = siRecord.data
              let localProdKey = null
              if (activeRegistry) {
                localProdKey = await activeRegistry.findLocalKeyBySyncId(
                  'product',
                  siData.product_sync_id,
                )
              }
              if (!localProdKey) {
                const plannedProdBind = plannedRegistryBinds.find(
                  (p) =>
                    p.entityType === 'product' &&
                    p.syncId.toLowerCase() === siData.product_sync_id.toLowerCase(),
                )
                if (plannedProdBind) {
                  localProdKey = plannedProdBind.key
                }
              }
              const resolvedProductId = localProdKey ?? siData.product_sync_id
              const snapshotHpp = Number(siData.cost_snapshot)
              const snapshotLineCost = Number(siData.line_cost)

              return {
                id: resolvedProductId,
                name: siData.product_name,
                price: Number(siData.unit_price),
                qty: Number(siData.quantity),
                hppSnapshot: Number.isFinite(snapshotHpp) && snapshotHpp >= 0 ? snapshotHpp : 0,
                costSnapshot: Number.isFinite(snapshotHpp) && snapshotHpp >= 0 ? snapshotHpp : 0,
                unit: typeof siData.unit === 'string' && siData.unit.trim() ? siData.unit.trim() : 'pcs',
                kind: siData.kind === 'service' ? 'service' : 'product',
                pricingUnit: typeof siData.pricing_unit === 'string' && siData.pricing_unit.trim()
                  ? siData.pricing_unit.trim()
                  : 'pcs',
                lineCost: Number.isFinite(snapshotLineCost) && snapshotLineCost >= 0
                  ? snapshotLineCost
                  : (Number.isFinite(snapshotHpp) ? snapshotHpp * Number(siData.quantity) : 0),
              }
            }),
          )
        } else if (existingTrx) {
          mappedItems = existingTrx.items
        }

        const itemCount = mappedItems.reduce((acc, it) => acc + (Number(it.qty) || 0), 0)

        const remotePaidAt = typeof paid_at === 'string' && paid_at.trim() ? paid_at : null
        const remoteCashReceived = Number(cash_received)
        const remoteChangeAmount = Number(change_amount)
        const remoteGrossProfit = Number(gross_profit)

        // The pulled payment/lifecycle fields are authoritative here: this
        // branch only runs when no pending local mutation conflicts, so an
        // unpaid -> paid settlement from another device must converge —
        // including explicit nulls (e.g. a reopened order clearing paidAt).
        // The customer snapshot is likewise authoritative history: the live
        // master record keeps its own name while the receipt keeps the name
        // at sale time.
        const remoteCustomerSnapshot = customer_snapshot && typeof customer_snapshot === 'object'
          ? {
              id: resolvedCustomerId ?? customer_snapshot.id ?? null,
              name: typeof customer_snapshot.name === 'string' ? customer_snapshot.name : '',
              phone: customer_snapshot.phone != null ? `${customer_snapshot.phone}` : '',
              email: customer_snapshot.email != null ? `${customer_snapshot.email}` : '',
            }
          : customerSnapshot
        const remoteBusinessSnapshot = business_snapshot && typeof business_snapshot === 'object'
          ? {
              name: typeof business_snapshot.name === 'string' ? business_snapshot.name : '',
              outlet: typeof business_snapshot.outlet === 'string' ? business_snapshot.outlet : '',
              phone: business_snapshot.phone != null ? `${business_snapshot.phone}` : '',
            }
          : null

        if (existingTrx) {
          existingTrx.invoiceNumber = transaction_number
          existingTrx.status = status
          existingTrx.subtotal = Number(subtotal)
          existingTrx.tax = Number(tax_amount)
          existingTrx.total = Number(total_amount)
          existingTrx.createdAt = sold_at
          existingTrx.items = mappedItems
          existingTrx.itemCount = itemCount
          existingTrx.customer = customerName
          existingTrx.customerId = resolvedCustomerId
          existingTrx.customerSnapshot = remoteCustomerSnapshot
          existingTrx.businessSnapshot = remoteBusinessSnapshot
          existingTrx.paymentMethod = typeof payment_method === 'string' && payment_method.trim()
            ? payment_method.trim()
            : null
          existingTrx.paymentStatus = payment_status === 'paid' || payment_status === 'unpaid'
            ? payment_status
            : null
          existingTrx.paidAt = remotePaidAt
          existingTrx.cashReceived = Number.isInteger(remoteCashReceived) && remoteCashReceived >= 0
            ? remoteCashReceived
            : null
          existingTrx.changeAmount = Number.isInteger(remoteChangeAmount) && remoteChangeAmount >= 0
            ? remoteChangeAmount
            : null
          existingTrx.grossProfit = Number.isFinite(remoteGrossProfit) ? remoteGrossProfit : 0
          existingTrx.orderStatus = typeof order_status === 'string' ? order_status : null
          existingTrx.estimatedCompletedAt = typeof estimated_completed_at === 'string' && estimated_completed_at.trim()
            ? estimated_completed_at
            : null
          existingTrx.note = typeof note === 'string' ? note : ''
        } else {
          nextTransactions.push({
            id: syncId,
            invoiceNumber: transaction_number,
            customer: customerName,
            customerId: resolvedCustomerId,
            customerSnapshot: remoteCustomerSnapshot,
            businessSnapshot: remoteBusinessSnapshot,
            status,
            orderStatus: typeof order_status === 'string' ? order_status : null,
            paymentStatus: payment_status === 'paid' || payment_status === 'unpaid' ? payment_status : null,
            items: mappedItems,
            itemCount,
            subtotal: Number(subtotal),
            tax: Number(tax_amount),
            total: Number(total_amount),
            grossProfit: Number.isFinite(remoteGrossProfit) ? remoteGrossProfit : 0,
            paymentMethod: typeof payment_method === 'string' && payment_method.trim() ? payment_method.trim() : null,
            paidAt: remotePaidAt,
            cashReceived: Number.isInteger(remoteCashReceived) && remoteCashReceived >= 0 ? remoteCashReceived : null,
            changeAmount: Number.isInteger(remoteChangeAmount) && remoteChangeAmount >= 0 ? remoteChangeAmount : null,
            estimatedCompletedAt: typeof estimated_completed_at === 'string' && estimated_completed_at.trim()
              ? estimated_completed_at
              : null,
            note: typeof note === 'string' ? note : '',
            createdAt: sold_at,
          })
          plannedRegistryBinds.push({
            type: 'bind',
            entityType: 'transaction',
            key: syncId,
            syncId,
          })
        }

        appliedCount++
        serverVersionsToSave[`sales:${syncId}`] = {
          syncVersion,
          syncSequence: sync_sequence,
        }

        for (const siRecord of saleItemRecords) {
          appliedCount++
          serverVersionsToSave[`sale_items:${siRecord.data.sync_id.toLowerCase()}`] = {
            syncVersion: siRecord.data.sync_version,
            syncSequence: siRecord.sync_sequence,
          }
        }
      }
      // sale_items processed together with sales above or as standalone below
    }

    // Process standalone sale_items
    for (const record of standaloneSaleItems) {
      const { sync_sequence, data } = record
      const siSyncId = data.sync_id.toLowerCase()
      const saleSyncId = data.sale_sync_id?.toLowerCase()

      let existingTrx = nextTransactions.find((t) => String(t.id).toLowerCase() === saleSyncId)
      if (!existingTrx) {
        const localKey = await activeRegistry.findLocalKeyBySyncId('transaction', saleSyncId)
        if (localKey) {
          existingTrx = nextTransactions.find((t) => String(t.id) === String(localKey))
        }
      }

      if (!existingTrx) {
        return {
          ok: false,
          code: 'REMOTE_SALE_ITEM_UNRESOLVED',
          message: `Standalone sale item ${siSyncId} references unknown sale ${saleSyncId}.`,
          error: {
            code: 'REMOTE_SALE_ITEM_UNRESOLVED',
            message: `Standalone sale item ${siSyncId} references unknown sale ${saleSyncId}.`,
          },
        }
      }

      let localProdKey = null
      if (activeRegistry) {
        localProdKey = await activeRegistry.findLocalKeyBySyncId(
          'product',
          data.product_sync_id,
        )
      }
      if (!localProdKey) {
        const plannedProdBind = plannedRegistryBinds.find(
          (p) =>
            p.entityType === 'product' &&
            p.syncId.toLowerCase() === data.product_sync_id.toLowerCase(),
        )
        if (plannedProdBind) {
          localProdKey = plannedProdBind.key
        }
      }
      const resolvedProductId = localProdKey ?? data.product_sync_id

      const itemIdx = existingTrx.items.findIndex(
        (it) =>
          String(it.id).toLowerCase() === String(resolvedProductId).toLowerCase() ||
          String(it.id).toLowerCase() === data.product_sync_id.toLowerCase(),
      )
      const standaloneHpp = Number(data.cost_snapshot)
      const standaloneLineCost = Number(data.line_cost)
      const newItem = {
        id: resolvedProductId,
        name: data.product_name,
        price: Number(data.unit_price),
        qty: Number(data.quantity),
        hppSnapshot: Number.isFinite(standaloneHpp) && standaloneHpp >= 0 ? standaloneHpp : 0,
        costSnapshot: Number.isFinite(standaloneHpp) && standaloneHpp >= 0 ? standaloneHpp : 0,
        unit: typeof data.unit === 'string' && data.unit.trim() ? data.unit.trim() : 'pcs',
        kind: data.kind === 'service' ? 'service' : 'product',
        pricingUnit: typeof data.pricing_unit === 'string' && data.pricing_unit.trim()
          ? data.pricing_unit.trim()
          : 'pcs',
        lineCost: Number.isFinite(standaloneLineCost) && standaloneLineCost >= 0
          ? standaloneLineCost
          : (Number.isFinite(standaloneHpp) ? standaloneHpp * Number(data.quantity) : 0),
      }

      if (itemIdx !== -1) {
        existingTrx.items[itemIdx] = newItem
      } else {
        existingTrx.items.push(newItem)
      }

      existingTrx.itemCount = existingTrx.items.reduce(
        (acc, it) => acc + (Number(it.qty) || 0),
        0,
      )

      appliedCount++
      serverVersionsToSave[`sale_items:${siSyncId}`] = {
        syncVersion: data.sync_version,
        syncSequence: sync_sequence,
      }
    }

    // ── 9.5. Final pre-commit conflict re-check right before domain $patch ────
    const preCommitConflict = await checkForPendingConflicts(allRecords)
    if (preCommitConflict) {
      return preCommitConflict
    }

    // ── 10. Apply mutations safely to Pinia stores via $patch ─────────────────
    // Remote apply always patches plain staged state: no user mutation action
    // is invoked, so pulled rows never create new outbox entries.
    if (productStore) {
      productStore.$patch({
        categories: nextCategories,
        products: nextProducts,
        stockMovements: nextStockMovements,
      })
    }
    if (customerStore) {
      customerStore.$patch({
        customers: nextCustomers,
      })
    }
    if (expenseStore) {
      expenseStore.$patch({
        expenses: nextExpenses,
      })
    }
    if (cashStore) {
      cashStore.$patch({
        entries: nextCashEntries,
      })
    }
    if (shiftStore && nextShift && nextShift.id) {
      shiftStore.setShiftSnapshot(nextShift)
    }
    if (transactionStore) {
      transactionStore.$patch({
        items: nextTransactions,
      })
    }

    // ── 11. Flush persistence scheduler (persists Pinia state to SQLite) ───────
    if (scheduler && typeof scheduler.flush === 'function') {
      await scheduler.flush()
    } else if (adapter && typeof adapter.saveProducts === 'function') {
      // Direct adapter fallback for tests without reactive watchers
      await adapter.saveProducts(nextProducts, nextCategories)
      if (typeof adapter.saveCustomers === 'function') {
        await adapter.saveCustomers(nextCustomers)
      }
      if (typeof adapter.saveExpenses === 'function') {
        await adapter.saveExpenses(nextExpenses)
      }
      if (typeof adapter.saveTransactions === 'function') {
        await adapter.saveTransactions(nextTransactions)
      }
    }

    // ── 12. Execute planned identity registry operations ───────────────────────
    if (activeRegistry) {
      for (const plan of plannedRegistryBinds) {
        if (plan.type === 'bind') {
          await activeRegistry.bindSyncId(plan.entityType, plan.key, plan.syncId)
        } else if (plan.type === 'rebind') {
          await activeRegistry.rebindSyncId(
            plan.entityType,
            plan.oldKey,
            plan.newKey,
            plan.syncId,
          )
        }
      }
    }

    // ── 13. Persist server versions metadata ───────────────────────────────────
    if (adapter && typeof adapter.saveSyncServerVersions === 'function') {
      await adapter.saveSyncServerVersions(serverVersionsToSave)
    }

    // ── 14. Persist pull context binding if first pull ─────────────────────────
    if (!existingPullBinding && adapter && typeof adapter.saveSyncPullBinding === 'function') {
      await adapter.saveSyncPullBinding({
        businessId: selectedBusiness.id,
        outletId: selectedOutlet.id,
        deviceIdentifier,
        registeredDeviceId,
        boundAt: new Date().toISOString(),
      })
    }

    // ── 15. Advance cursor (LAST STEP!) ────────────────────────────────────────
    if (adapter && typeof adapter.saveSyncPullState === 'function') {
      try {
        await adapter.saveSyncPullState({
          version: 1,
          cursor: cursorAfter,
          serverSequence: finalServerSequence,
          updatedAt: new Date().toISOString(),
        })
      } catch (err) {
        return {
          ok: false,
          code: 'SYNC_PULL_CURSOR_PERSIST_FAILED',
          message: 'Server changes applied but failed to persist pull cursor.',
          error: {
            code: 'SYNC_PULL_CURSOR_PERSIST_FAILED',
            message: err instanceof Error ? err.message : String(err),
          },
        }
      }
    }

    return {
      ok: true,
      fetched: allRecords.length,
      applied: appliedCount,
      ignored: ignoredCount,
      warnings,
      cursorBefore,
      cursorAfter,
      serverSequence: finalServerSequence,
      pages: pagesCount,
      error: null,
    }
  }

  return {
    pullNow,
    queueService: activeQueueService,
    registry: activeRegistry,
  }
}
