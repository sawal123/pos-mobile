import { createSyncIdentityRegistry, buildProductSyncSku, isUuid } from './syncIdentityRegistry'
import { SYNC_RESERVED_CATEGORY, SYNC_ENTITY_TYPES, SYNC_OPERATIONS } from './syncConstants'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isValidEmail(email) {
  if (typeof email !== 'string') return false
  return EMAIL_REGEX.test(email.trim())
}

function isValidDateString(value) {
  if (typeof value !== 'string' || !value.trim()) return false
  const time = new Date(value).getTime()
  return !Number.isNaN(time)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isNonNegativeInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/**
 * Pure contract mapper between P9 local sync_queue outbox entries
 * and Laravel /api/sync/push v1 contract payload changes.
 *
 * Enforces fail-closed validation, atomic mapping per outbox entry,
 * deterministic ordering, and explicit blocking for unsupported operations/entities.
 *
 * @param {Array<object>} entries List of sync_queue outbox entries.
 * @param {object} [options]
 * @param {object} [options.registry] Sync identity registry instance.
 * @param {object} [options.adapter] Database adapter providing persistence.
 * @param {object} [options.scheduler] Optional serialized task scheduler.
 * @returns {Promise<object>}
 */
function extractServerSyncVersion(serverVersions, entityKey, syncId) {
  if (!serverVersions || typeof serverVersions !== 'object' || !syncId) return undefined
  // 1. Flat format P13: `${entityKey}:${syncId}`
  const flatKey = `${entityKey}:${syncId}`
  const flatVal = serverVersions[flatKey]
  if (flatVal !== undefined && flatVal !== null) {
    if (typeof flatVal === 'object' && flatVal.syncVersion !== undefined) {
      return Number(flatVal.syncVersion)
    }
    if (Number.isInteger(Number(flatVal))) {
      return Number(flatVal)
    }
  }
  // 2. Nested format: serverVersions[entityKey]?.[syncId]
  const nestedVal = serverVersions[entityKey]?.[syncId]
  if (nestedVal !== undefined && nestedVal !== null) {
    if (typeof nestedVal === 'object' && nestedVal.syncVersion !== undefined) {
      return Number(nestedVal.syncVersion)
    }
    if (Number.isInteger(Number(nestedVal))) {
      return Number(nestedVal)
    }
  }
  return undefined
}

export async function mapOutboxEntries(
  entries = [],
  { registry = null, adapter = null, scheduler = null, serverVersions: serverVersionsParam = null } = {},
) {
  let activeRegistry = registry
  if (!activeRegistry && adapter) {
    activeRegistry = createSyncIdentityRegistry({ adapter, scheduler })
  }

  if (!activeRegistry || !activeRegistry.isDurable) {
    throw new Error('mapOutboxEntries requires a durable registry or database adapter.')
  }

  await activeRegistry.ensureLoaded()

  const serverVersions =
    adapter && typeof adapter.loadSyncServerVersions === 'function'
      ? (await adapter.loadSyncServerVersions()) || {}
      : serverVersionsParam || {}

  const changes = {
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

  const mappedQueueIds = []
  const blocked = []
  const warnings = []

  for (const entry of entries) {
    const queueId = entry.id
    const entityType = entry.entityType
    const entityId = entry.entityId
    const operation = entry.operation
    const payload = entry.payload ?? {}

    // ── 1. DELETE becomes a non-destructive tombstone for mutable master
    // entities. Immutable history (transaction/cash/stock/shift) stays
    // rejected: history rows are never deleted through sync.
    if (operation === SYNC_OPERATIONS.DELETE) {
      const tombstoneEntities = {
        [SYNC_ENTITY_TYPES.CATEGORY]: 'categories',
        [SYNC_ENTITY_TYPES.PRODUCT]: 'products',
        [SYNC_ENTITY_TYPES.CUSTOMER]: 'customers',
        [SYNC_ENTITY_TYPES.EXPENSE]: 'expenses',
      }

      const tombstoneTarget = tombstoneEntities[entityType]

      if (!tombstoneTarget) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'DELETE_NOT_SUPPORTED_BY_SERVER_V1',
          message: `Delete operations for '${entityType}' are not supported by server contract`,
        })
        continue
      }

      const deleteSyncId = entityType === SYNC_ENTITY_TYPES.CATEGORY && !isUuid(entityId)
        ? await activeRegistry.resolveSyncId(SYNC_ENTITY_TYPES.CATEGORY, entityId)
        : isUuid(entityId)
          ? entityId.toLowerCase()
          : await activeRegistry.resolveSyncId(entityType, entityId)

      if (!isUuid(deleteSyncId)) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'INVALID_SYNC_ID',
          message: 'Failed to resolve valid UUID for tombstone delete',
        })
        continue
      }

      const deletion = {
        entity: tombstoneTarget,
        sync_id: deleteSyncId,
      }
      const deleteBaseVer = extractServerSyncVersion(serverVersions, tombstoneTarget, deleteSyncId)
      if (deleteBaseVer !== undefined) {
        deletion.base_sync_version = deleteBaseVer
      }
      changes.deletions.push(deletion)
      mappedQueueIds.push(queueId)
      continue
    }

    // ── 2. Fail closed for unsupported operations (only UPSERT allowed)
    if (operation !== SYNC_OPERATIONS.UPSERT) {
      blocked.push({
        queueId,
        entityType,
        entityId,
        operation,
        code: 'UNSUPPORTED_SYNC_OPERATION',
        message: `Operation '${operation}' is not supported by server v1 contract`,
      })
      continue
    }

    // ── 3. Block unsupported entity types
    if (entityType === SYNC_ENTITY_TYPES.BUSINESS) {
      blocked.push({
        queueId,
        entityType,
        entityId,
        operation,
        code: 'UNSUPPORTED_SERVER_ENTITY_BUSINESS',
        message: 'Business entity synchronization is not supported by server v1',
      })
      continue
    }

    // ── 3. Category mapping
    if (entityType === SYNC_ENTITY_TYPES.CATEGORY) {
      const name = payload.name ?? entityId

      if (!isNonEmptyString(name)) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'INVALID_CATEGORY_NAME',
          message: 'Category name must be a non-empty string',
        })
        continue
      }

      const trimmedName = name.trim()

      // Reserved filter category 'Semua' is strictly never pushed
      if (trimmedName.toLowerCase() === SYNC_RESERVED_CATEGORY.toLowerCase()) {
        continue
      }

      const syncId = await activeRegistry.resolveSyncId(SYNC_ENTITY_TYPES.CATEGORY, trimmedName)
      if (!isUuid(syncId)) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'INVALID_SYNC_ID',
          message: 'Failed to resolve valid UUID for category',
        })
        continue
      }

      const categoryChange = {
        sync_id: syncId,
        name: trimmedName,
      }
      const catBaseVer = extractServerSyncVersion(serverVersions, 'categories', syncId)
      if (catBaseVer !== undefined) {
        categoryChange.base_sync_version = catBaseVer
      }
      changes.categories.push(categoryChange)
      mappedQueueIds.push(queueId)
      continue
    }

    // ── 4. Product mapping
    if (entityType === SYNC_ENTITY_TYPES.PRODUCT) {
      const prodId = payload.id ?? entityId

      if (!isNonEmptyString(payload.name)) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'INVALID_PRODUCT_NAME',
          message: 'Product name must be a non-empty string',
        })
        continue
      }

      if (!isNonNegativeInteger(payload.price)) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'INVALID_PRODUCT_PRICE',
          message: 'Product price must be a non-negative integer',
        })
        continue
      }

      const syncId = await activeRegistry.resolveSyncId(SYNC_ENTITY_TYPES.PRODUCT, prodId)
      if (!isUuid(syncId)) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'INVALID_SYNC_ID',
          message: 'Failed to resolve valid UUID for product',
        })
        continue
      }

      let categorySyncId = null
      if (
        isNonEmptyString(payload.category) &&
        payload.category.trim().toLowerCase() !== SYNC_RESERVED_CATEGORY.toLowerCase()
      ) {
        categorySyncId = await activeRegistry.resolveSyncId(
          SYNC_ENTITY_TYPES.CATEGORY,
          payload.category.trim(),
        )
      }

      const sku = buildProductSyncSku(syncId)
      const status = payload.isActive === true ? 'active' : 'inactive'
      const kind = payload.kind === 'service' ? 'service' : 'product'

      const productChange = {
        sync_id: syncId,
        category_sync_id: categorySyncId,
        name: payload.name.trim(),
        sku,
        barcode: null,
        price: payload.price,
        kind,
        status,
      }

      if (typeof payload.cost === 'number' && Number.isFinite(payload.cost) && payload.cost >= 0) {
        productChange.cost = payload.cost
      }

      if (typeof payload.stock === 'number' && Number.isFinite(payload.stock) && payload.stock >= 0) {
        productChange.stock = payload.stock
      }

      if (isNonEmptyString(payload.unit)) {
        productChange.unit = payload.unit.trim()
      }

      if (typeof payload.minStock === 'number' && Number.isFinite(payload.minStock) && payload.minStock >= 0) {
        productChange.min_stock = payload.minStock
      }

      if (isNonEmptyString(payload.pricingUnit)) {
        productChange.pricing_unit = payload.pricingUnit.trim()
      }

      if (typeof payload.minQuantity === 'number' && Number.isFinite(payload.minQuantity) && payload.minQuantity >= 0) {
        productChange.min_quantity = payload.minQuantity
      }

      if (isNonEmptyString(payload.estimatedDuration)) {
        productChange.estimated_duration = payload.estimatedDuration.trim()
      }
      const prodBaseVer = extractServerSyncVersion(serverVersions, 'products', syncId)
      if (prodBaseVer !== undefined) {
        productChange.base_sync_version = prodBaseVer
      }
      changes.products.push(productChange)
      mappedQueueIds.push(queueId)
      continue
    }

    // ── 5. Customer mapping
    if (entityType === SYNC_ENTITY_TYPES.CUSTOMER) {
      const custId = payload.id ?? entityId

      if (!isNonEmptyString(payload.name)) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'INVALID_CUSTOMER_NAME',
          message: 'Customer name must be a non-empty string',
        })
        continue
      }

      let email = null
      if (payload.email !== null && payload.email !== undefined && payload.email !== '') {
        if (!isValidEmail(payload.email)) {
          blocked.push({
            queueId,
            entityType,
            entityId,
            operation,
            code: 'INVALID_CUSTOMER_EMAIL',
            message: 'Customer email format is invalid',
          })
          continue
        }
        email = payload.email.trim()
      }

      let phone = null
      if (isNonEmptyString(payload.phone)) {
        phone = payload.phone.trim()
      }

      const syncId = await activeRegistry.resolveSyncId(SYNC_ENTITY_TYPES.CUSTOMER, custId)
      if (!isUuid(syncId)) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'INVALID_SYNC_ID',
          message: 'Failed to resolve valid UUID for customer',
        })
        continue
      }

      const customerChange = {
        sync_id: syncId,
        name: payload.name.trim(),
        phone,
        email,
        address: null,
        notes: null,
      }
      const custBaseVer = extractServerSyncVersion(serverVersions, 'customers', syncId)
      if (custBaseVer !== undefined) {
        customerChange.base_sync_version = custBaseVer
      }
      changes.customers.push(customerChange)
      mappedQueueIds.push(queueId)
      continue
    }

    // ── 6. Expense mapping
    if (entityType === SYNC_ENTITY_TYPES.EXPENSE) {
      const expenseId = payload.id ?? entityId
      const description = payload.title ?? payload.description

      if (!isNonEmptyString(description)) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'INVALID_EXPENSE_DESCRIPTION',
          message: 'Expense description must be a non-empty string',
        })
        continue
      }

      if (!isNonNegativeInteger(payload.amount)) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'INVALID_EXPENSE_AMOUNT',
          message: 'Expense amount must be a non-negative integer',
        })
        continue
      }

      const occurredAt = payload.createdAt ?? payload.occurred_at
      if (!isValidDateString(occurredAt)) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'INVALID_EXPENSE_DATE',
          message: 'Expense occurred_at date is invalid',
        })
        continue
      }

      const syncId = await activeRegistry.resolveSyncId(SYNC_ENTITY_TYPES.EXPENSE, expenseId)
      if (!isUuid(syncId)) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'INVALID_SYNC_ID',
          message: 'Failed to resolve valid UUID for expense',
        })
        continue
      }

      const notes = isNonEmptyString(payload.note)
        ? payload.note.trim()
        : isNonEmptyString(payload.notes)
          ? payload.notes.trim()
          : null

      const expenseChange = {
        sync_id: syncId,
        shift_sync_id: null,
        description: description.trim(),
        amount: payload.amount,
        occurred_at: new Date(occurredAt).toISOString(),
        notes,
      }

      if (isNonEmptyString(payload.category)) {
        expenseChange.category = payload.category.trim()
      }
      const expBaseVer = extractServerSyncVersion(serverVersions, 'expenses', syncId)
      if (expBaseVer !== undefined) {
        expenseChange.base_sync_version = expBaseVer
      }
      changes.expenses.push(expenseChange)
      mappedQueueIds.push(queueId)
      continue
    }

    // ── 7. Transaction mapping (Sale + Sale Items)
    if (entityType === SYNC_ENTITY_TYPES.TRANSACTION) {
      const trxId = payload.id ?? entityId

      // Legacy transactions or incomplete snapshots where items is a count or not an array
      if (!Array.isArray(payload.items) || payload.items.length === 0) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'LEGACY_TRANSACTION_UNMAPPABLE',
          message: 'Transaction snapshot does not contain an array of items',
        })
        continue
      }

      if (!isNonNegativeInteger(payload.subtotal)) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'INVALID_TRANSACTION_SNAPSHOT',
          message: 'Transaction subtotal must be a non-negative integer',
        })
        continue
      }

      const taxAmount = payload.tax === undefined || payload.tax === null ? 0 : payload.tax
      if (!isNonNegativeInteger(taxAmount)) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'INVALID_TRANSACTION_SNAPSHOT',
          message: 'Transaction tax must be a non-negative integer',
        })
        continue
      }

      if (!isNonNegativeInteger(payload.total)) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'INVALID_TRANSACTION_SNAPSHOT',
          message: 'Transaction total must be a non-negative integer',
        })
        continue
      }

      const soldAt = payload.createdAt ?? payload.sold_at
      if (!isValidDateString(soldAt)) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'INVALID_TRANSACTION_DATE',
          message: 'Transaction sold_at date is invalid',
        })
        continue
      }

      const saleSyncId = await activeRegistry.resolveSyncId(SYNC_ENTITY_TYPES.TRANSACTION, trxId)
      if (!isUuid(saleSyncId)) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'INVALID_SYNC_ID',
          message: 'Failed to resolve valid UUID for transaction/sale',
        })
        continue
      }

      let customerSyncId = null
      if (isNonEmptyString(payload.customerId)) {
        customerSyncId = await activeRegistry.resolveSyncId(
          SYNC_ENTITY_TYPES.CUSTOMER,
          payload.customerId.trim(),
        )
      }

      // Validate each item atomically before pushing anything
      let itemValidationError = null
      const mappedSaleItems = []

      for (let i = 0; i < payload.items.length; i++) {
        const item = payload.items[i]

        if (!item || typeof item !== 'object') {
          itemValidationError = {
            code: 'INVALID_TRANSACTION_ITEM',
            message: `Item at index ${i} is not a valid object`,
          }
          break
        }

        if (!isNonEmptyString(item.name)) {
          itemValidationError = {
            code: 'INVALID_TRANSACTION_ITEM',
            message: `Item at index ${i} is missing a valid product name`,
          }
          break
        }

        if (!isNonNegativeInteger(item.price)) {
          itemValidationError = {
            code: 'INVALID_TRANSACTION_ITEM',
            message: `Item at index ${i} has an invalid price`,
          }
          break
        }

        const qty = item.qty !== undefined ? item.qty : item.quantity
        if (typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0) {
          itemValidationError = {
            code: 'INVALID_TRANSACTION_ITEM',
            message: `Item at index ${i} has an invalid quantity`,
          }
          break
        }

        const prodLocalId = item.id ?? item.productId ?? item.product_id ?? item.name
        const prodSyncId = await activeRegistry.resolveSyncId(SYNC_ENTITY_TYPES.PRODUCT, prodLocalId)
        const itemSyncId = await activeRegistry.resolveSyncId(
          'sale_item',
          `${trxId}:${i}:${prodLocalId}`,
        )

        const sku = buildProductSyncSku(prodSyncId)
        const lineTotal = item.price * qty

        const itemHpp = Number(item.hppSnapshot ?? item.costSnapshot ?? item.cost)
        const itemLineCost = item.lineCost !== undefined && item.lineCost !== null
          ? Number(item.lineCost)
          : (Number.isFinite(itemHpp) ? itemHpp * qty : 0)

        const saleItemChange = {
          sync_id: itemSyncId,
          sale_sync_id: saleSyncId,
          product_sync_id: prodSyncId,
          product_name: item.name.trim(),
          product_sku: sku,
          unit_price: item.price,
          quantity: qty,
          line_total: lineTotal,
        }

        if (Number.isFinite(itemHpp) && itemHpp >= 0) {
          saleItemChange.cost_snapshot = itemHpp
        }

        const itemUnit = item.unit ?? item.pricingUnit
        if (isNonEmptyString(itemUnit)) {
          saleItemChange.unit = itemUnit.trim()
        }

        const itemKind = item.kind === 'service' ? 'service' : 'product'
        saleItemChange.kind = itemKind

        if (isNonEmptyString(item.pricingUnit)) {
          saleItemChange.pricing_unit = item.pricingUnit.trim()
        }

        if (Number.isFinite(itemLineCost) && itemLineCost >= 0) {
          saleItemChange.line_cost = itemLineCost
        }
        const itemBaseVer = extractServerSyncVersion(serverVersions, 'sale_items', itemSyncId)
        if (itemBaseVer !== undefined) {
          saleItemChange.base_sync_version = itemBaseVer
        }
        mappedSaleItems.push(saleItemChange)
      }

      if (itemValidationError) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: itemValidationError.code,
          message: itemValidationError.message,
        })
        continue
      }

      // Check for unsupported local snapshot fields
      if (
        payload.businessSnapshot ||
        payload.customerSnapshot ||
        payload.itemCount !== undefined
      ) {
        warnings.push({
          queueId,
          entityType,
          entityId,
          code: 'UNSUPPORTED_TRANSACTION_SNAPSHOT_FIELDS',
          message: 'Local transaction snapshot fields are omitted from server sync contract payload',
        })
      }

      const transactionNumber = isNonEmptyString(payload.invoiceNumber)
        ? payload.invoiceNumber.trim()
        : `LOCAL-${saleSyncId}`

      const status = isNonEmptyString(payload.status) ? payload.status.trim() : 'completed'
      const salePaymentMethod = isNonEmptyString(payload.paymentMethod)
        ? payload.paymentMethod.trim().toLowerCase()
        : null
      const salePaymentStatus = payload.paymentStatus === 'paid' || payload.paymentStatus === 'unpaid'
        ? payload.paymentStatus
        : (payload.status === 'paid' || payload.status === 'unpaid' ? payload.status : null)

      const saleChange = {
        sync_id: saleSyncId,
        customer_sync_id: customerSyncId,
        shift_sync_id: null,
        transaction_number: transactionNumber,
        status,
        subtotal: payload.subtotal,
        discount_amount: 0,
        tax_amount: taxAmount,
        total_amount: payload.total,
        sold_at: new Date(soldAt).toISOString(),
      }

      if (salePaymentMethod) {
        saleChange.payment_method = salePaymentMethod
      }

      if (salePaymentStatus) {
        saleChange.payment_status = salePaymentStatus
      }

      const paidAtRaw = payload.paidAt ?? null
      if (isNonEmptyString(paidAtRaw) && isValidDateString(paidAtRaw)) {
        saleChange.paid_at = new Date(paidAtRaw).toISOString()
      }

      if (Number.isInteger(payload.cashReceived) && payload.cashReceived >= 0) {
        saleChange.cash_received = payload.cashReceived
      }

      if (Number.isInteger(payload.changeAmount) && payload.changeAmount >= 0) {
        saleChange.change_amount = payload.changeAmount
      }

      const grossProfitRaw = Number(payload.grossProfit)
      if (Number.isFinite(grossProfitRaw)) {
        saleChange.gross_profit = grossProfitRaw
      }

      if (isNonEmptyString(payload.orderStatus)) {
        saleChange.order_status = payload.orderStatus.trim()
      }

      if (isNonEmptyString(payload.estimatedCompletedAt) && isValidDateString(payload.estimatedCompletedAt)) {
        saleChange.estimated_completed_at = new Date(payload.estimatedCompletedAt).toISOString()
      }

      if (isNonEmptyString(payload.note)) {
        saleChange.note = payload.note.trim()
      }

      const customerSnapshot = payload.customerSnapshot
      if (customerSnapshot && typeof customerSnapshot === 'object') {
        const normalizedSnapshot = {
          id: customerSyncId ?? customerSnapshot.id ?? null,
        }
        if (isNonEmptyString(customerSnapshot.name)) {
          normalizedSnapshot.name = customerSnapshot.name.trim()
        }
        if (customerSnapshot.phone !== undefined && customerSnapshot.phone !== null) {
          normalizedSnapshot.phone = `${customerSnapshot.phone}`
        }
        if (customerSnapshot.email !== undefined && customerSnapshot.email !== null) {
          normalizedSnapshot.email = `${customerSnapshot.email}`
        }
        saleChange.customer_snapshot = normalizedSnapshot
      }

      const businessSnapshot = payload.businessSnapshot
      if (businessSnapshot && typeof businessSnapshot === 'object') {
        const normalizedBusiness = {}
        if (isNonEmptyString(businessSnapshot.name)) {
          normalizedBusiness.name = businessSnapshot.name.trim()
        }
        if (isNonEmptyString(businessSnapshot.outlet)) {
          normalizedBusiness.outlet = businessSnapshot.outlet.trim()
        }
        if (businessSnapshot.phone !== undefined && businessSnapshot.phone !== null) {
          normalizedBusiness.phone = `${businessSnapshot.phone}`
        }
        if (Object.keys(normalizedBusiness).length > 0) {
          saleChange.business_snapshot = normalizedBusiness
        }
      }
      const saleBaseVer = extractServerSyncVersion(serverVersions, 'sales', saleSyncId)
      if (saleBaseVer !== undefined) {
        saleChange.base_sync_version = saleBaseVer
      }
      changes.sales.push(saleChange)

      changes.sale_items.push(...mappedSaleItems)
      mappedQueueIds.push(queueId)
      continue
    }

    // ── 8. Shift mapping
    if (entityType === SYNC_ENTITY_TYPES.SHIFT) {
      const shiftId = payload.id ?? entityId

      if (!isNonEmptyString(payload.shiftNumber) && !isNonEmptyString(payload.openedAt)) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'INVALID_SHIFT_SNAPSHOT',
          message: 'Shift snapshot must contain a shift number or openedAt',
        })
        continue
      }

      const syncId = await activeRegistry.resolveSyncId(SYNC_ENTITY_TYPES.SHIFT, shiftId)
      if (!isUuid(syncId)) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'INVALID_SYNC_ID',
          message: 'Failed to resolve valid UUID for shift',
        })
        continue
      }

      const shiftOpenedAt = payload.openedAt ?? payload.opened_at
      if (!isValidDateString(shiftOpenedAt)) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'INVALID_SHIFT_DATE',
          message: 'Shift opened_at date is invalid',
        })
        continue
      }

      const shiftChange = {
        sync_id: syncId,
        shift_number: isNonEmptyString(payload.shiftNumber)
          ? payload.shiftNumber.trim()
          : `${shiftId}`,
        status: payload.status === 'closed' ? 'closed' : 'open',
        opened_at: new Date(shiftOpenedAt).toISOString(),
      }

      const openingCash = Number(payload.openingCash ?? payload.opening_cash)
      if (Number.isInteger(openingCash) && openingCash >= 0) {
        shiftChange.opening_cash = openingCash
      }

      const closingCash = payload.closingCash ?? payload.closing_cash
      if (closingCash !== undefined && closingCash !== null && Number.isInteger(Number(closingCash)) && Number(closingCash) >= 0) {
        shiftChange.closing_cash = Number(closingCash)
      }

      const closedAt = payload.closedAt ?? payload.closed_at
      if (closedAt !== undefined && closedAt !== null) {
        if (!isValidDateString(closedAt)) {
          blocked.push({
            queueId,
            entityType,
            entityId,
            operation,
            code: 'INVALID_SHIFT_DATE',
            message: 'Shift closed_at date is invalid',
          })
          continue
        }
        shiftChange.closed_at = new Date(closedAt).toISOString()
      }

      if (isNonEmptyString(payload.notes ?? payload.note)) {
        shiftChange.notes = `${payload.notes ?? payload.note}`.trim()
      }

      const shiftBaseVer = extractServerSyncVersion(serverVersions, 'shifts', syncId)
      if (shiftBaseVer !== undefined) {
        shiftChange.base_sync_version = shiftBaseVer
      }
      changes.shifts.push(shiftChange)
      mappedQueueIds.push(queueId)
      continue
    }

    // ── 9. Cash entry mapping (physical CASH IN/OUT only)
    if (entityType === SYNC_ENTITY_TYPES.CASH_ENTRY) {
      const cashId = payload.id ?? entityId
      const cashType = `${payload.type ?? ''}`.toLowerCase()

      if (cashType !== 'in' && cashType !== 'out') {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'INVALID_CASH_ENTRY_TYPE',
          message: 'Cash entry type must be in or out',
        })
        continue
      }

      if (!isNonNegativeInteger(payload.amount) || payload.amount <= 0) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'INVALID_CASH_ENTRY_AMOUNT',
          message: 'Cash entry amount must be a positive integer',
        })
        continue
      }

      const occurredAt = payload.createdAt ?? payload.occurred_at
      if (!isValidDateString(occurredAt)) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'INVALID_CASH_ENTRY_DATE',
          message: 'Cash entry occurred_at date is invalid',
        })
        continue
      }

      const syncId = await activeRegistry.resolveSyncId(SYNC_ENTITY_TYPES.CASH_ENTRY, cashId)
      if (!isUuid(syncId)) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'INVALID_SYNC_ID',
          message: 'Failed to resolve valid UUID for cash entry',
        })
        continue
      }

      const cashChange = {
        sync_id: syncId,
        shift_sync_id: null,
        type: cashType,
        amount: payload.amount,
        occurred_at: new Date(occurredAt).toISOString(),
      }

      if (isNonEmptyString(payload.category)) {
        cashChange.category = payload.category.trim()
      }

      if (isNonEmptyString(payload.note)) {
        cashChange.note = payload.note.trim()
      } else {
        cashChange.note = null
      }

      if (isNonEmptyString(payload.referenceId)) {
        cashChange.reference_id = payload.referenceId.trim()
      }

      // Canonical relation wins: an explicit transactionId links this cash
      // entry to its sale. Never parse the human reference string.
      const cashTransactionId = isNonEmptyString(payload.transactionId)
        ? payload.transactionId.trim()
        : null
      if (cashTransactionId) {
        const saleSyncId = await activeRegistry.resolveSyncId(
          SYNC_ENTITY_TYPES.TRANSACTION,
          cashTransactionId,
        )
        if (isUuid(saleSyncId)) {
          cashChange.sale_sync_id = saleSyncId
        }
      }

      const cashBaseVer = extractServerSyncVersion(serverVersions, 'cash_ledger', syncId)
      if (cashBaseVer !== undefined) {
        cashChange.base_sync_version = cashBaseVer
      }
      changes.cash_ledger.push(cashChange)
      mappedQueueIds.push(queueId)
      continue
    }

    // ── 10. Stock movement mapping
    if (entityType === SYNC_ENTITY_TYPES.STOCK_MOVEMENT) {
      const movementId = payload.id ?? entityId

      if (!isNonEmptyString(payload.productId)) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'INVALID_STOCK_MOVEMENT_PRODUCT',
          message: 'Stock movement productId must be a non-empty string',
        })
        continue
      }

      if (!isNonEmptyString(payload.movementType ?? payload.type)) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'INVALID_STOCK_MOVEMENT_TYPE',
          message: 'Stock movement type must be a non-empty string',
        })
        continue
      }

      const quantityChange = Number(payload.quantityChange)
      if (!Number.isFinite(quantityChange) || quantityChange === 0) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'INVALID_STOCK_MOVEMENT_QUANTITY',
          message: 'Stock movement quantityChange must be a non-zero number',
        })
        continue
      }

      const occurredAt = payload.createdAt ?? payload.occurred_at
      if (!isValidDateString(occurredAt)) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'INVALID_STOCK_MOVEMENT_DATE',
          message: 'Stock movement occurred_at date is invalid',
        })
        continue
      }

      const productSyncId = await activeRegistry.resolveSyncId(
        SYNC_ENTITY_TYPES.PRODUCT,
        `${payload.productId}`.trim(),
      )
      if (!isUuid(productSyncId)) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'INVALID_SYNC_ID',
          message: 'Failed to resolve valid UUID for movement product',
        })
        continue
      }

      const syncId = await activeRegistry.resolveSyncId(SYNC_ENTITY_TYPES.STOCK_MOVEMENT, movementId)
      if (!isUuid(syncId)) {
        blocked.push({
          queueId,
          entityType,
          entityId,
          operation,
          code: 'INVALID_SYNC_ID',
          message: 'Failed to resolve valid UUID for stock movement',
        })
        continue
      }

      const movementChange = {
        sync_id: syncId,
        product_sync_id: productSyncId,
        movement_type: `${payload.movementType ?? payload.type}`.trim(),
        quantity_change: quantityChange,
        occurred_at: new Date(occurredAt).toISOString(),
      }

      if (Number.isFinite(Number(payload.stockBefore))) {
        movementChange.stock_before = Number(payload.stockBefore)
      }

      if (Number.isFinite(Number(payload.stockAfter))) {
        movementChange.stock_after = Number(payload.stockAfter)
      }

      if (isNonEmptyString(payload.referenceId)) {
        movementChange.reference_id = payload.referenceId.trim()
      }

      if (isNonEmptyString(payload.category)) {
        movementChange.category = payload.category.trim()
      }

      if (isNonEmptyString(payload.note)) {
        movementChange.note = payload.note.trim()
      } else {
        movementChange.note = null
      }

      // Canonical relation wins: an explicit transactionId links this
      // movement to its sale. Never parse the human reference string.
      const movementTransactionId = isNonEmptyString(payload.transactionId)
        ? payload.transactionId.trim()
        : null
      if (movementTransactionId) {
        const saleSyncId = await activeRegistry.resolveSyncId(
          SYNC_ENTITY_TYPES.TRANSACTION,
          movementTransactionId,
        )
        if (isUuid(saleSyncId)) {
          movementChange.sale_sync_id = saleSyncId
        }
      }

      const movementBaseVer = extractServerSyncVersion(serverVersions, 'stock_movements', syncId)
      if (movementBaseVer !== undefined) {
        movementChange.base_sync_version = movementBaseVer
      }
      changes.stock_movements.push(movementChange)
      mappedQueueIds.push(queueId)
      continue
    }

    // ── 11. Unknown entity type fallback
    blocked.push({
      queueId,
      entityType,
      entityId,
      operation,
      code: 'UNSUPPORTED_ENTITY_TYPE',
      message: `Entity type '${entityType}' is not supported by server v1 contract`,
    })
  }

  return {
    changes,
    mappedQueueIds,
    blocked,
    warnings,
  }
}

/**
 * Creates a reusable ContractMapper service.
 *
 * @param {object} [options]
 * @param {object} [options.registry] Sync identity registry instance.
 * @param {object} [options.adapter] Database adapter providing persistence.
 * @param {object} [options.scheduler] Optional serialized task scheduler.
 * @returns {object}
 */
export function createContractMapper({ registry = null, adapter = null, scheduler = null } = {}) {
  let activeRegistry = registry
  if (!activeRegistry && adapter) {
    activeRegistry = createSyncIdentityRegistry({ adapter, scheduler })
  }

  if (!activeRegistry || !activeRegistry.isDurable) {
    throw new Error('createContractMapper requires a durable registry or database adapter.')
  }

  return {
    registry: activeRegistry,
    mapOutboxEntries: (entries) => mapOutboxEntries(entries, { registry: activeRegistry }),
  }
}
