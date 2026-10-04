import { EXPENSE_CATEGORIES } from '@/stores/expenseStore'
import { DEFAULT_TAX_ENABLED, DEFAULT_TAX_RATE, isValidTaxRate } from '@/stores/taxStore'
import { isUuid } from '@/services/sync/syncIdentityRegistry'

export const BACKUP_SCHEMA = 'pos-mobile-backup'
export const BACKUP_VERSION = 3
export const BACKUP_SYNC_METADATA_VERSION = 1
export const SUPPORTED_BACKUP_VERSIONS = [1, 2, BACKUP_VERSION]
export const RESTORE_CONFIRMATION_MESSAGE =
  'Restore backup akan mengganti data produk, kategori, pelanggan, pengeluaran, dan transaksi saat ini. Lanjutkan?'

export const CROSS_DEVICE_RESTORE_SAFETY = Object.freeze({
  SAFE: 'SAFE',
  SYNC_IDENTITY_MISSING: 'SYNC_IDENTITY_MISSING',
  SYNC_IDENTITY_MALFORMED: 'SYNC_IDENTITY_MALFORMED',
  SYNC_VERSION_MALFORMED: 'SYNC_VERSION_MALFORMED',
  SYNC_IDENTITY_DANGLING: 'SYNC_IDENTITY_DANGLING',
  SYNC_VERSION_DANGLING: 'SYNC_VERSION_DANGLING',
  UNSUPPORTED_BACKUP_VERSION: 'UNSUPPORTED_BACKUP_VERSION',
  INVALID_BACKUP_PAYLOAD: 'INVALID_BACKUP_PAYLOAD',
})

const PORTABLE_IDENTITY_TYPES = new Set([
  'category',
  'product',
  'customer',
  'expense',
  'transaction',
  'cash_entry',
  'stock_movement',
  'sale_item',
])

const IDENTITY_TO_SERVER_ENTITY = {
  category: 'categories',
  product: 'products',
  customer: 'customers',
  expense: 'expenses',
  transaction: 'sales',
  cash_entry: 'cash_ledger',
  stock_movement: 'stock_movements',
  sale_item: 'sale_items',
}

const PORTABLE_SERVER_ENTITIES = new Set(Object.values(IDENTITY_TO_SERVER_ENTITY))

function computeItemGrossProfit(item) {
  const quantity = Number(item.qty) || 0
  const price = Number(item.price ?? item.unitPrice) || 0
  const hppSnapshot = Number(item.hppSnapshot ?? item.costSnapshot ?? item.cost) || 0

  return (price - hppSnapshot) * quantity
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value))
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== ''
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isFiniteNumber(value, { min = Number.NEGATIVE_INFINITY, greaterThan = null } = {}) {
  return Number.isFinite(value) && value >= min && (greaterThan === null || value > greaterThan)
}

function isValidDateString(value) {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime())
}

function normalizeCustomerSnapshot(snapshot) {
  if (snapshot === null || snapshot === undefined) {
    return null
  }

  if (!isObject(snapshot)) {
    return null
  }

  return {
    id: snapshot.id ?? null,
    name: typeof snapshot.name === 'string' ? snapshot.name : '',
    phone:
      typeof snapshot.phone === 'string'
        ? snapshot.phone
        : snapshot.phone != null
          ? String(snapshot.phone)
          : '',
    email:
      typeof snapshot.email === 'string'
        ? snapshot.email
        : snapshot.email != null
          ? String(snapshot.email)
          : '',
  }
}

function normalizeTransactionItemForBackup(item) {
  return { ...item }
}

function normalizeTransactionForBackup(transaction) {
  const items = Array.isArray(transaction.items)
    ? transaction.items.map(normalizeTransactionItemForBackup)
    : []

  const itemCount = Number.isFinite(transaction.itemCount)
    ? transaction.itemCount
    : items.length
      ? items.reduce((count, item) => count + (Number(item.qty) || 0), 0)
      : Number.isFinite(transaction.items)
        ? transaction.items
        : 0

  const grossProfit = Number.isFinite(transaction.grossProfit)
    ? transaction.grossProfit
    : items.reduce((sum, item) => sum + computeItemGrossProfit(item), 0)

  const isPaid =
    transaction.paymentStatus === 'paid' ||
    (!transaction.paymentStatus && transaction.status === 'paid')

  let paidAt = null
  if (isPaid) {
    if (isValidDateString(transaction.paidAt)) {
      paidAt = transaction.paidAt
    } else if (isValidDateString(transaction.createdAt)) {
      paidAt = transaction.createdAt
    } else {
      paidAt = new Date().toISOString()
    }
  }

  const normalized = {
    id: transaction.id,
    invoiceNumber:
      typeof transaction.invoiceNumber === 'string'
        ? transaction.invoiceNumber
        : String(transaction.id ?? ''),
    customer: typeof transaction.customer === 'string' ? transaction.customer : 'Walk-in Customer',
    customerId: transaction.customerId ?? null,
    customerSnapshot: normalizeCustomerSnapshot(transaction.customerSnapshot),
    businessSnapshot: transaction.businessSnapshot ? { ...transaction.businessSnapshot } : null,
    status: typeof transaction.status === 'string' ? transaction.status : 'paid',
    orderStatus: typeof transaction.orderStatus === 'string' ? transaction.orderStatus : null,
    paymentStatus:
      typeof transaction.paymentStatus === 'string'
        ? transaction.paymentStatus
        : transaction.status === 'paid'
          ? 'paid'
          : 'unpaid',
    items,
    itemCount,
    subtotal: Number.isFinite(transaction.subtotal) ? transaction.subtotal : 0,
    tax: Number.isFinite(transaction.tax) ? transaction.tax : 0,
    ...(typeof transaction.taxEnabled === 'boolean' ? { taxEnabled: transaction.taxEnabled } : {}),
    ...(transaction.taxRate !== undefined
      ? { taxRate: isValidTaxRate(transaction.taxRate) ? Number(transaction.taxRate) : null }
      : {}),
    total: Number.isFinite(transaction.total) ? transaction.total : 0,
    grossProfit,
    paymentMethod: typeof transaction.paymentMethod === 'string' ? transaction.paymentMethod : '',
    cashReceived: Number.isFinite(transaction.cashReceived) ? transaction.cashReceived : null,
    changeAmount: Number.isFinite(transaction.changeAmount) ? transaction.changeAmount : null,
    paidAt,
    createdAt: isValidDateString(transaction.createdAt)
      ? transaction.createdAt
      : new Date().toISOString(),
    updatedAt: isValidDateString(transaction.updatedAt)
      ? transaction.updatedAt
      : isValidDateString(transaction.createdAt)
        ? transaction.createdAt
        : new Date().toISOString(),
  }

  if (transaction.orderNumber !== undefined) {
    normalized.orderNumber = transaction.orderNumber
  }
  if (transaction.estimatedCompletedAt !== undefined) {
    normalized.estimatedCompletedAt = transaction.estimatedCompletedAt
  }
  if (transaction.note !== undefined) {
    normalized.note = transaction.note
  }

  return normalized
}

function normalizeTransactionForRestore(transaction) {
  const items = Array.isArray(transaction.items)
    ? transaction.items.map((item) => ({ ...item }))
    : []

  const grossProfit = Number.isFinite(transaction.grossProfit)
    ? transaction.grossProfit
    : items.reduce((sum, item) => sum + computeItemGrossProfit(item), 0)

  const isPaid =
    transaction.paymentStatus === 'paid' ||
    (!transaction.paymentStatus && transaction.status === 'paid')

  let paidAt = null
  if (isPaid) {
    if (isValidDateString(transaction.paidAt)) {
      paidAt = transaction.paidAt
    } else if (isValidDateString(transaction.createdAt)) {
      paidAt = transaction.createdAt
    } else {
      paidAt = new Date().toISOString()
    }
  }

  return {
    ...transaction,
    customerSnapshot: normalizeCustomerSnapshot(transaction.customerSnapshot),
    orderStatus: typeof transaction.orderStatus === 'string' ? transaction.orderStatus : null,
    grossProfit,
    paidAt,
  }
}

function buildProductData(productStore) {
  return {
    products: productStore.products.map(normalizeProductForRestore),
    categories: [...productStore.categories],
  }
}

function buildBusinessData(businessStore) {
  return {
    name: businessStore.name,
    type: businessStore.type,
    owner: businessStore.owner,
    phone: businessStore.phone,
    outlet: businessStore.outlet,
  }
}

function validateBusinessData(business) {
  if (!isObject(business)) {
    return 'File backup tidak valid.'
  }

  const fields = ['name', 'type', 'owner', 'phone', 'outlet']

  if (!fields.every((field) => typeof business[field] === 'string')) {
    return 'File backup tidak valid.'
  }

  return ''
}

function validateTaxSettings(taxSettings) {
  return (
    isObject(taxSettings) &&
    typeof taxSettings.enabled === 'boolean' &&
    isValidTaxRate(taxSettings.rate)
  )
}

function validateProductsData(productsSection) {
  if (
    !isObject(productsSection) ||
    !Array.isArray(productsSection.products) ||
    !Array.isArray(productsSection.categories)
  ) {
    return 'File backup tidak valid.'
  }

  const categoriesValid = productsSection.categories.every(
    (category) => isNonEmptyString(category) && category.trim().toLowerCase() !== 'semua',
  )

  if (!categoriesValid) {
    return 'File backup tidak valid.'
  }

  const categorySet = new Set(productsSection.categories)

  for (const product of productsSection.products) {
    if (
      !isObject(product) ||
      !hasValue(product.id) ||
      !isNonEmptyString(product.name) ||
      !isNonEmptyString(product.category) ||
      !isFiniteNumber(product.price, { min: 0 }) ||
      !isFiniteNumber(product.stock) ||
      typeof product.isActive !== 'boolean'
    ) {
      return 'File backup tidak valid.'
    }

    if (!categorySet.has(product.category)) {
      return 'File backup tidak valid.'
    }

    if (product.imageData !== undefined && typeof product.imageData !== 'string') {
      return 'File backup tidak valid.'
    }
  }

  return ''
}

function normalizeProductForRestore(product) {
  return {
    ...product,
    imageData: typeof product.imageData === 'string' ? product.imageData : '',
  }
}

function validateCustomersData(customers) {
  if (!Array.isArray(customers)) {
    return 'File backup tidak valid.'
  }

  for (const customer of customers) {
    if (
      !isObject(customer) ||
      !hasValue(customer.id) ||
      !isNonEmptyString(customer.name) ||
      typeof customer.phone !== 'string' ||
      typeof customer.email !== 'string'
    ) {
      return 'File backup tidak valid.'
    }
  }

  return ''
}

function validateExpensesData(expenses) {
  if (!Array.isArray(expenses)) {
    return 'File backup tidak valid.'
  }

  for (const expense of expenses) {
    if (
      !isObject(expense) ||
      !hasValue(expense.id) ||
      !isNonEmptyString(expense.title) ||
      typeof expense.category !== 'string' ||
      !EXPENSE_CATEGORIES.includes(expense.category) ||
      !isFiniteNumber(expense.amount, { greaterThan: 0 }) ||
      typeof expense.note !== 'string' ||
      !isValidDateString(expense.createdAt)
    ) {
      return 'File backup tidak valid.'
    }
  }

  return ''
}

function validateCustomerSnapshot(snapshot) {
  if (snapshot === null) {
    return true
  }

  if (
    !isObject(snapshot) ||
    !hasValue(snapshot.id) ||
    !isNonEmptyString(snapshot.name) ||
    typeof snapshot.phone !== 'string'
  ) {
    return false
  }

  return snapshot.email === undefined || typeof snapshot.email === 'string'
}

function validateBusinessSnapshot(snapshot) {
  if (snapshot === null) {
    return true
  }

  return (
    isObject(snapshot) &&
    typeof snapshot.name === 'string' &&
    typeof snapshot.outlet === 'string' &&
    typeof snapshot.phone === 'string'
  )
}

function validateTransactionsData(transactions) {
  if (!Array.isArray(transactions)) {
    return 'File backup tidak valid.'
  }

  for (const transaction of transactions) {
    if (
      !isObject(transaction) ||
      !hasValue(transaction.id) ||
      !Array.isArray(transaction.items) ||
      !isFiniteNumber(transaction.subtotal, { min: 0 }) ||
      !isFiniteNumber(transaction.tax, { min: 0 }) ||
      (transaction.taxRate != null && !isValidTaxRate(transaction.taxRate)) ||
      (transaction.taxEnabled !== undefined && typeof transaction.taxEnabled !== 'boolean') ||
      !isFiniteNumber(transaction.total, { min: 0 }) ||
      typeof transaction.paymentMethod !== 'string' ||
      !isValidDateString(transaction.createdAt)
    ) {
      return 'File backup tidak valid.'
    }

    for (const item of transaction.items) {
      if (
        !isObject(item) ||
        !isNonEmptyString(item.name) ||
        !isFiniteNumber(item.price, { min: 0 }) ||
        !isFiniteNumber(item.qty, { greaterThan: 0 })
      ) {
        return 'File backup tidak valid.'
      }
    }

    if (
      transaction.cashReceived !== null &&
      transaction.cashReceived !== undefined &&
      !isFiniteNumber(transaction.cashReceived, { min: 0 })
    ) {
      return 'File backup tidak valid.'
    }

    if (
      transaction.changeAmount !== null &&
      transaction.changeAmount !== undefined &&
      !isFiniteNumber(transaction.changeAmount, { min: 0 })
    ) {
      return 'File backup tidak valid.'
    }

    if (
      transaction.paidAt !== null &&
      transaction.paidAt !== undefined &&
      !isValidDateString(transaction.paidAt)
    ) {
      return 'File backup tidak valid.'
    }

    if (
      !validateCustomerSnapshot(transaction.customerSnapshot ?? null) ||
      !validateBusinessSnapshot(transaction.businessSnapshot ?? null)
    ) {
      return 'File backup tidak valid.'
    }
  }

  return ''
}

function ensureDataSections(data) {
  if (!isObject(data)) {
    return 'File backup tidak valid.'
  }

  const requiredSections = ['business', 'products', 'customers', 'expenses', 'transactions']

  if (!requiredSections.every((section) => Object.prototype.hasOwnProperty.call(data, section))) {
    return 'File backup tidak valid.'
  }

  return ''
}

function validateStockMovementsData(stockMovements) {
  if (!Array.isArray(stockMovements)) {
    return 'File backup tidak valid.'
  }

  for (const movement of stockMovements) {
    if (
      !isObject(movement) ||
      !hasValue(movement.id) ||
      !hasValue(movement.productId) ||
      !isFiniteNumber(movement.quantityChange) ||
      !isFiniteNumber(movement.stockBefore) ||
      !isFiniteNumber(movement.stockAfter) ||
      !isValidDateString(movement.createdAt)
    ) {
      return 'File backup tidak valid.'
    }
  }

  return ''
}

function validateCashEntriesData(cashEntries) {
  if (!Array.isArray(cashEntries)) {
    return 'File backup tidak valid.'
  }

  for (const entry of cashEntries) {
    if (
      !isObject(entry) ||
      !hasValue(entry.id) ||
      !['in', 'out'].includes(entry.type) ||
      !isFiniteNumber(entry.amount, { greaterThan: 0 }) ||
      !isValidDateString(entry.createdAt)
    ) {
      return 'File backup tidak valid.'
    }
  }

  return ''
}

function normalizeBackupData(data) {
  if (!isObject(data)) {
    return data
  }

  const normalized = { ...data }

  // Backward compatibility: older backup versions did not persist cash ledger
  // or stock movement history yet default them to empty collections.
  if (normalized.taxSettings === undefined) {
    normalized.taxSettings = { enabled: DEFAULT_TAX_ENABLED, rate: DEFAULT_TAX_RATE }
  }

  if (normalized.cash === undefined || normalized.cash === null) {
    normalized.cash = []
  }

  if (normalized.stockMovements === undefined || normalized.stockMovements === null) {
    normalized.stockMovements = []
  }

  if (isObject(normalized.products) && Array.isArray(normalized.products.products)) {
    normalized.products = {
      ...normalized.products,
      products: normalized.products.products.map(normalizeProductForRestore),
    }
  }

  if (Array.isArray(normalized.transactions)) {
    normalized.transactions = normalized.transactions.map((trx) => {
      if (!isObject(trx)) return trx
      const isPaid = trx.paymentStatus === 'paid' || (!trx.paymentStatus && trx.status === 'paid')
      const paidAt = isPaid
        ? isValidDateString(trx.paidAt)
          ? trx.paidAt
          : isValidDateString(trx.createdAt)
            ? trx.createdAt
            : null
        : null
      const updated = {
        ...trx,
        paidAt,
      }
      if (trx.customerSnapshot !== undefined && trx.customerSnapshot !== null) {
        updated.customerSnapshot = normalizeCustomerSnapshot(trx.customerSnapshot)
      }
      return updated
    })
  }

  return normalized
}

function formatTimestamp(date = new Date()) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hours = `${date.getHours()}`.padStart(2, '0')
  const minutes = `${date.getMinutes()}`.padStart(2, '0')
  const seconds = `${date.getSeconds()}`.padStart(2, '0')

  return `${year}${month}${day}-${hours}${minutes}${seconds}`
}

function parseIdentityKey(key) {
  if (typeof key !== 'string') {
    return null
  }

  const index = key.indexOf(':')
  if (index <= 0 || index === key.length - 1) {
    return null
  }

  return {
    entityType: key.slice(0, index),
    localId: key.slice(index + 1),
  }
}

function buildDomainReferenceSets(data) {
  const products = Array.isArray(data?.products?.products) ? data.products.products : []
  const categories = Array.isArray(data?.products?.categories) ? data.products.categories : []
  const customers = Array.isArray(data?.customers) ? data.customers : []
  const expenses = Array.isArray(data?.expenses) ? data.expenses : []
  const transactions = Array.isArray(data?.transactions) ? data.transactions : []
  const cash = Array.isArray(data?.cash) ? data.cash : []
  const stockMovements = Array.isArray(data?.stockMovements) ? data.stockMovements : []

  return {
    category: new Set(categories.map((item) => String(item))),
    product: new Set(products.map((item) => String(item.id))),
    customer: new Set(customers.map((item) => String(item.id))),
    expense: new Set(expenses.map((item) => String(item.id))),
    transaction: new Set(transactions.map((item) => String(item.id))),
    cash_entry: new Set(cash.map((item) => String(item.id))),
    stock_movement: new Set(stockMovements.map((item) => String(item.id))),
    sale_item: new Set(
      transactions.flatMap((transaction) => {
        const transactionId = String(transaction.id)
        const items = Array.isArray(transaction.items) ? transaction.items : []
        return items.map((item, index) => {
          const productKey = item?.id ?? item?.productId ?? item?.product_id ?? item?.name
          return `${transactionId}:${index}:${productKey}`
        })
      }),
    ),
  }
}

function normalizeServerVersionEntry(value) {
  if (Number.isInteger(Number(value)) && Number(value) >= 0) {
    return { syncVersion: Number(value), syncSequence: 0 }
  }

  if (!isObject(value)) {
    return null
  }

  const syncVersion = Number(value.syncVersion)
  const syncSequence = value.syncSequence === undefined ? 0 : Number(value.syncSequence)

  if (
    !Number.isInteger(syncVersion) ||
    syncVersion < 0 ||
    !Number.isInteger(syncSequence) ||
    syncSequence < 0
  ) {
    return null
  }

  return { syncVersion, syncSequence }
}

function normalizeSyncMetadataInput(syncMetadata) {
  if (!isObject(syncMetadata)) {
    return {
      identityMap: {},
      serverVersions: {},
    }
  }

  return {
    identityMap: isObject(syncMetadata.identityMap) ? syncMetadata.identityMap : {},
    serverVersions: isObject(syncMetadata.serverVersions) ? syncMetadata.serverVersions : {},
  }
}

function isIdentityReferenced(parsedKey, references) {
  return (
    PORTABLE_IDENTITY_TYPES.has(parsedKey.entityType) &&
    references[parsedKey.entityType]?.has(String(parsedKey.localId))
  )
}

function buildPortableSyncMetadata(syncMetadata, data) {
  const input = normalizeSyncMetadataInput(syncMetadata)
  const references = buildDomainReferenceSets(data)
  const identityMap = {}
  const portableSyncIds = new Set()

  for (const [key, value] of Object.entries(input.identityMap)) {
    const parsed = parseIdentityKey(key)
    if (!parsed || !isIdentityReferenced(parsed, references) || !isUuid(value)) {
      continue
    }

    const normalizedSyncId = String(value).trim().toLowerCase()
    identityMap[`${parsed.entityType}:${parsed.localId}`] = normalizedSyncId
    portableSyncIds.add(`${IDENTITY_TO_SERVER_ENTITY[parsed.entityType]}:${normalizedSyncId}`)
  }

  const serverVersions = {}
  for (const [key, value] of Object.entries(input.serverVersions)) {
    const index = key.indexOf(':')
    if (index <= 0 || index === key.length - 1) {
      continue
    }

    const entity = key.slice(0, index)
    const syncId = key.slice(index + 1).toLowerCase()
    if (!PORTABLE_SERVER_ENTITIES.has(entity) || !isUuid(syncId)) {
      continue
    }

    const normalized = normalizeServerVersionEntry(value)
    if (!normalized || !portableSyncIds.has(`${entity}:${syncId}`)) {
      continue
    }

    serverVersions[`${entity}:${syncId}`] = normalized
  }

  return {
    version: BACKUP_SYNC_METADATA_VERSION,
    identityMap,
    serverVersions,
  }
}

export function createBackupPayload(stores) {
  const data = {
    business: buildBusinessData(stores.businessStore),
    taxSettings: stores.taxStore
      ? { enabled: stores.taxStore.enabled, rate: stores.taxStore.rate }
      : { enabled: DEFAULT_TAX_ENABLED, rate: DEFAULT_TAX_RATE },
    products: buildProductData(stores.productStore),
    stockMovements: (stores.productStore?.stockMovements ?? []).map((movement) => ({
      ...movement,
    })),
    cash: (stores.cashStore?.entries ?? []).map((entry) => ({ ...entry })),
    customers: stores.customerStore.customers.map((customer) => ({ ...customer })),
    expenses: stores.expenseStore.expenses.map((expense) => ({ ...expense })),
    transactions: stores.transactionStore.items.map((transaction) =>
      normalizeTransactionForBackup(transaction),
    ),
  }

  const payload = {
    schema: BACKUP_SCHEMA,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data,
    syncMetadata: buildPortableSyncMetadata(stores.syncMetadata, data),
  }

  return jsonClone(payload)
}

export async function createBackupPayloadFromPersistence({ adapter, scheduler = null } = {}) {
  if (!adapter) {
    throw new Error('Persistence adapter is required to create a durable backup snapshot.')
  }

  const readSnapshot = async () => {
    const [
      business,
      taxState,
      productState,
      customers,
      expenses,
      transactions,
      cashState,
      identityMap,
      serverVersions,
    ] = await Promise.all([
      adapter.loadBusiness(),
      typeof adapter.loadTaxState === 'function' ? adapter.loadTaxState() : null,
      adapter.loadProducts(),
      adapter.loadCustomers(),
      adapter.loadExpenses(),
      adapter.loadTransactions(),
      typeof adapter.loadCashState === 'function' ? adapter.loadCashState() : null,
      typeof adapter.loadSyncIdentityMap === 'function' ? adapter.loadSyncIdentityMap() : null,
      typeof adapter.loadSyncServerVersions === 'function'
        ? adapter.loadSyncServerVersions()
        : null,
    ])

    return createBackupPayload({
      businessStore: business,
      taxStore: taxState,
      productStore: productState,
      customerStore: { customers },
      expenseStore: { expenses },
      transactionStore: { items: transactions },
      cashStore: cashState ?? { entries: [] },
      syncMetadata: { identityMap, serverVersions },
    })
  }

  if (scheduler && typeof scheduler.flush === 'function') {
    await scheduler.flush()
  }

  if (scheduler && typeof scheduler.runSerialized === 'function') {
    return scheduler.runSerialized(readSnapshot, 'backup:snapshot')
  }

  return readSnapshot()
}

export function validateBackupPayload(payload) {
  if (!isObject(payload) || payload.schema !== BACKUP_SCHEMA) {
    return {
      valid: false,
      error: 'File backup tidak valid.',
    }
  }

  if (!SUPPORTED_BACKUP_VERSIONS.includes(payload.version)) {
    return {
      valid: false,
      error: 'Versi backup tidak didukung.',
    }
  }

  const data = normalizeBackupData(payload.data)

  const dataError =
    ensureDataSections(data) ||
    validateBusinessData(data.business) ||
    (!validateTaxSettings(data.taxSettings) ? 'File backup tidak valid: pengaturan pajak.' : '') ||
    validateProductsData(data.products) ||
    validateStockMovementsData(data.stockMovements) ||
    validateCashEntriesData(data.cash) ||
    validateCustomersData(data.customers) ||
    validateExpensesData(data.expenses) ||
    validateTransactionsData(data.transactions)

  if (dataError) {
    return {
      valid: false,
      error: dataError,
    }
  }

  return {
    valid: true,
    error: '',
    data: jsonClone(data),
  }
}

function validateSyncIdentityMap(identityMap, data) {
  if (!isObject(identityMap)) {
    return { ok: false, code: CROSS_DEVICE_RESTORE_SAFETY.SYNC_IDENTITY_MALFORMED }
  }

  const references = buildDomainReferenceSets(data)
  const reverseByType = new Map()
  const portableSyncIds = new Set()

  for (const [key, value] of Object.entries(identityMap)) {
    const parsed = parseIdentityKey(key)
    if (!parsed || !PORTABLE_IDENTITY_TYPES.has(parsed.entityType) || !isUuid(value)) {
      return { ok: false, code: CROSS_DEVICE_RESTORE_SAFETY.SYNC_IDENTITY_MALFORMED }
    }

    if (!references[parsed.entityType]?.has(String(parsed.localId))) {
      return { ok: false, code: CROSS_DEVICE_RESTORE_SAFETY.SYNC_IDENTITY_DANGLING }
    }

    const normalizedSyncId = String(value).trim().toLowerCase()
    const reverseKey = `${parsed.entityType}:${normalizedSyncId}`
    const previousLocalId = reverseByType.get(reverseKey)
    if (previousLocalId !== undefined && previousLocalId !== parsed.localId) {
      return { ok: false, code: CROSS_DEVICE_RESTORE_SAFETY.SYNC_IDENTITY_MALFORMED }
    }

    reverseByType.set(reverseKey, parsed.localId)
    portableSyncIds.add(`${IDENTITY_TO_SERVER_ENTITY[parsed.entityType]}:${normalizedSyncId}`)
  }

  return { ok: true, portableSyncIds }
}

function validateSyncServerVersions(serverVersions, portableSyncIds) {
  if (!isObject(serverVersions)) {
    return { ok: false, code: CROSS_DEVICE_RESTORE_SAFETY.SYNC_VERSION_MALFORMED }
  }

  for (const [key, value] of Object.entries(serverVersions)) {
    const index = key.indexOf(':')
    if (index <= 0 || index === key.length - 1) {
      return { ok: false, code: CROSS_DEVICE_RESTORE_SAFETY.SYNC_VERSION_MALFORMED }
    }

    const entity = key.slice(0, index)
    const syncId = key.slice(index + 1).toLowerCase()
    if (!PORTABLE_SERVER_ENTITIES.has(entity) || !isUuid(syncId)) {
      return { ok: false, code: CROSS_DEVICE_RESTORE_SAFETY.SYNC_VERSION_MALFORMED }
    }

    if (!portableSyncIds.has(`${entity}:${syncId}`)) {
      return { ok: false, code: CROSS_DEVICE_RESTORE_SAFETY.SYNC_VERSION_DANGLING }
    }

    if (normalizeServerVersionEntry(value) === null) {
      return { ok: false, code: CROSS_DEVICE_RESTORE_SAFETY.SYNC_VERSION_MALFORMED }
    }
  }

  return { ok: true }
}

export function validatePortableSyncMetadata(payload) {
  const validation = validateBackupPayload(payload)
  if (!validation.valid) {
    return {
      valid: false,
      code: CROSS_DEVICE_RESTORE_SAFETY.INVALID_BACKUP_PAYLOAD,
      error: validation.error,
    }
  }

  if (payload.version !== BACKUP_VERSION) {
    return {
      valid: false,
      code: CROSS_DEVICE_RESTORE_SAFETY.UNSUPPORTED_BACKUP_VERSION,
      error: 'Backup belum memiliki metadata sync portable.',
    }
  }

  if (!isObject(payload.syncMetadata)) {
    return {
      valid: false,
      code: CROSS_DEVICE_RESTORE_SAFETY.SYNC_IDENTITY_MISSING,
      error: 'Metadata sync portable tidak tersedia.',
    }
  }

  if (payload.syncMetadata.version !== BACKUP_SYNC_METADATA_VERSION) {
    return {
      valid: false,
      code: CROSS_DEVICE_RESTORE_SAFETY.SYNC_IDENTITY_MALFORMED,
      error: 'Versi metadata sync portable tidak valid.',
    }
  }

  const identityResult = validateSyncIdentityMap(payload.syncMetadata.identityMap, validation.data)
  if (!identityResult.ok) {
    return {
      valid: false,
      code: identityResult.code,
      error: 'Metadata identitas sync tidak valid.',
    }
  }

  const versionResult = validateSyncServerVersions(
    payload.syncMetadata.serverVersions,
    identityResult.portableSyncIds,
  )
  if (!versionResult.ok) {
    return {
      valid: false,
      code: versionResult.code,
      error: 'Metadata versi server sync tidak valid.',
    }
  }

  return {
    valid: true,
    code: CROSS_DEVICE_RESTORE_SAFETY.SAFE,
    error: '',
    metadata: jsonClone(payload.syncMetadata),
  }
}

export function classifyCrossDeviceRestoreSafety(payload) {
  const validation = validatePortableSyncMetadata(payload)

  return {
    safeForCrossDeviceRestore: validation.valid === true,
    reason: validation.code,
    error: validation.error,
  }
}

export function restoreBackupPayload(payload, stores) {
  if (stores.shiftStore.isOpen) {
    return {
      success: false,
      error: 'Restore backup tidak dapat dilakukan saat shift aktif. Tutup shift terlebih dahulu.',
    }
  }

  const validation = validateBackupPayload(payload)

  if (!validation.valid) {
    return {
      success: false,
      error: validation.error,
    }
  }

  const { data } = validation

  stores.taxStore?.$patch({
    enabled: data.taxSettings.enabled,
    rate: Number(data.taxSettings.rate),
  })

  stores.businessStore.$patch({
    name: data.business.name,
    type: data.business.type,
    owner: data.business.owner,
    phone: data.business.phone,
    outlet: data.business.outlet,
  })

  stores.productStore.$patch({
    products: data.products.products,
    categories: data.products.categories,
    stockMovements: data.stockMovements,
    selectedCategory: 'Semua',
    searchQuery: '',
  })

  if (stores.cashStore) {
    stores.cashStore.$patch({
      entries: data.cash,
    })
  }

  stores.customerStore.$patch({
    customers: data.customers,
  })

  stores.expenseStore.$patch({
    expenses: data.expenses,
  })

  stores.transactionStore.$patch({
    items: data.transactions.map((transaction) => normalizeTransactionForRestore(transaction)),
    lastTransaction: null,
  })

  stores.cartStore?.clearCart?.()

  return {
    success: true,
    error: '',
  }
}

export function downloadBackupFile(payload) {
  const filename = `pos-mobile-backup-${formatTimestamp()}.json`
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = objectUrl
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(objectUrl)

  return filename
}
