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

function isPositiveInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
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

    // ── 1. Block all DELETE operations (not supported by Laravel v1 push contract)
    if (operation === SYNC_OPERATIONS.DELETE) {
      blocked.push({
        queueId,
        entityType,
        entityId,
        operation,
        code: 'DELETE_NOT_SUPPORTED_BY_SERVER_V1',
        message: 'Delete operations are not supported by server v1 contract',
      })
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
      if (serverVersions.categories?.[syncId] !== undefined) {
        categoryChange.base_sync_version = Number(serverVersions.categories[syncId])
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

      if (payload.stock !== undefined && payload.stock !== null) {
        warnings.push({
          queueId,
          entityType,
          entityId,
          code: 'UNSUPPORTED_PRODUCT_STOCK_FIELD',
          message: 'Product stock is omitted from server v1 sync contract payload',
        })
      }

      const productChange = {
        sync_id: syncId,
        category_sync_id: categorySyncId,
        name: payload.name.trim(),
        sku,
        barcode: null,
        price: payload.price,
        status,
      }
      if (serverVersions.products?.[syncId] !== undefined) {
        productChange.base_sync_version = Number(serverVersions.products[syncId])
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
      if (serverVersions.customers?.[syncId] !== undefined) {
        customerChange.base_sync_version = Number(serverVersions.customers[syncId])
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

      if (payload.category) {
        warnings.push({
          queueId,
          entityType,
          entityId,
          code: 'UNSUPPORTED_EXPENSE_CATEGORY_FIELD',
          message: 'Expense category is omitted from server v1 sync contract payload',
        })
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
      if (serverVersions.expenses?.[syncId] !== undefined) {
        expenseChange.base_sync_version = Number(serverVersions.expenses[syncId])
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
        if (!isPositiveInteger(qty)) {
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
        if (serverVersions.sale_items?.[itemSyncId] !== undefined) {
          saleItemChange.base_sync_version = Number(serverVersions.sale_items[itemSyncId])
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
        payload.paymentMethod ||
        payload.cashReceived !== undefined ||
        payload.changeAmount !== undefined ||
        payload.businessSnapshot ||
        payload.customerSnapshot ||
        payload.itemCount !== undefined
      ) {
        warnings.push({
          queueId,
          entityType,
          entityId,
          code: 'UNSUPPORTED_TRANSACTION_SNAPSHOT_FIELDS',
          message: 'Local transaction snapshot fields are omitted from server v1 sync contract payload',
        })
      }

      const transactionNumber = isNonEmptyString(payload.invoiceNumber)
        ? payload.invoiceNumber.trim()
        : `LOCAL-${saleSyncId}`

      const status = isNonEmptyString(payload.status) ? payload.status.trim() : 'completed'

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
      if (serverVersions.sales?.[saleSyncId] !== undefined) {
        saleChange.base_sync_version = Number(serverVersions.sales[saleSyncId])
      }
      changes.sales.push(saleChange)

      changes.sale_items.push(...mappedSaleItems)
      mappedQueueIds.push(queueId)
      continue
    }

    // ── 8. Unknown entity type fallback
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
