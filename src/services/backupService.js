import { EXPENSE_CATEGORIES } from '@/stores/expenseStore'

export const BACKUP_SCHEMA = 'pos-mobile-backup'
export const BACKUP_VERSION = 1
export const RESTORE_CONFIRMATION_MESSAGE = 'Restore backup akan mengganti data produk, kategori, pelanggan, pengeluaran, dan transaksi saat ini. Lanjutkan?'

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value))
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== ''
}

function hasOwn(object, key) {
  return isObject(object) && Object.prototype.hasOwnProperty.call(object, key)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isFiniteNumber(value, { min = Number.NEGATIVE_INFINITY, greaterThan = null } = {}) {
  return Number.isFinite(value)
    && value >= min
    && (greaterThan === null || value > greaterThan)
}

function isValidDateString(value) {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime())
}

function normalizeTransactionForBackup(transaction) {
  if (!isObject(transaction)) {
    return transaction
  }

  return jsonClone(transaction)
}

function buildProductData(productStore) {
  return {
    products: productStore.products.map((product) => ({ ...product })),
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

function validateProductsData(productsSection) {
  if (!isObject(productsSection)
    || !Array.isArray(productsSection.products)
    || !Array.isArray(productsSection.categories)) {
    return 'File backup tidak valid.'
  }

  const categoriesValid = productsSection.categories.every((category) => (
    isNonEmptyString(category) && category.trim().toLowerCase() !== 'semua'
  ))

  if (!categoriesValid) {
    return 'File backup tidak valid.'
  }

  const categorySet = new Set(productsSection.categories)

  for (const product of productsSection.products) {
    if (!isObject(product)
      || !hasValue(product.id)
      || !isNonEmptyString(product.name)
      || !isNonEmptyString(product.category)
      || !isFiniteNumber(product.price, { min: 0 })
      || !isFiniteNumber(product.stock, { min: 0 })
      || typeof product.isActive !== 'boolean') {
      return 'File backup tidak valid.'
    }

    if (!categorySet.has(product.category)) {
      return 'File backup tidak valid.'
    }
  }

  return ''
}

function validateCustomersData(customers) {
  if (!Array.isArray(customers)) {
    return 'File backup tidak valid.'
  }

  for (const customer of customers) {
    if (!isObject(customer)
      || !hasValue(customer.id)
      || !isNonEmptyString(customer.name)
      || typeof customer.phone !== 'string'
      || typeof customer.email !== 'string') {
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
    if (!isObject(expense)
      || !hasValue(expense.id)
      || !isNonEmptyString(expense.title)
      || typeof expense.category !== 'string'
      || !EXPENSE_CATEGORIES.includes(expense.category)
      || !isFiniteNumber(expense.amount, { greaterThan: 0 })
      || typeof expense.note !== 'string'
      || !isValidDateString(expense.createdAt)) {
      return 'File backup tidak valid.'
    }
  }

  return ''
}

function validateCustomerSnapshot(snapshot) {
  if (snapshot === null) {
    return true
  }

  return isObject(snapshot)
    && hasValue(snapshot.id)
    && isNonEmptyString(snapshot.name)
    && typeof snapshot.phone === 'string'
    && typeof snapshot.email === 'string'
}

function validateBusinessSnapshot(snapshot) {
  if (snapshot === null) {
    return true
  }

  return isObject(snapshot)
    && typeof snapshot.name === 'string'
    && typeof snapshot.outlet === 'string'
    && typeof snapshot.phone === 'string'
}

function validateTransactionItems(items) {
  if (Array.isArray(items)) {
    for (const item of items) {
      if (!isObject(item)
        || !isNonEmptyString(item.name)
        || !isFiniteNumber(item.price, { min: 0 })
        || !isFiniteNumber(item.qty, { greaterThan: 0 })) {
        return false
      }
    }

    return true
  }

  return isFiniteNumber(items, { greaterThan: 0 })
}

function validateTransactionsData(transactions) {
  if (!Array.isArray(transactions)) {
    return 'File backup tidak valid.'
  }

  for (const transaction of transactions) {
    if (!isObject(transaction)
      || !hasValue(transaction.id)
      || !validateTransactionItems(transaction.items)
      || !isFiniteNumber(transaction.total, { min: 0 })
      || typeof transaction.paymentMethod !== 'string'
      || !isValidDateString(transaction.createdAt)) {
      return 'File backup tidak valid.'
    }

    if (hasOwn(transaction, 'invoiceNumber') && typeof transaction.invoiceNumber !== 'string') {
      return 'File backup tidak valid.'
    }

    if (hasOwn(transaction, 'customer') && typeof transaction.customer !== 'string') {
      return 'File backup tidak valid.'
    }

    if (hasOwn(transaction, 'customerId')
      && transaction.customerId !== null
      && typeof transaction.customerId !== 'string') {
      return 'File backup tidak valid.'
    }

    if (hasOwn(transaction, 'status') && typeof transaction.status !== 'string') {
      return 'File backup tidak valid.'
    }

    if (hasOwn(transaction, 'itemCount') && !isFiniteNumber(transaction.itemCount, { greaterThan: 0 })) {
      return 'File backup tidak valid.'
    }

    if (hasOwn(transaction, 'subtotal') && !isFiniteNumber(transaction.subtotal, { min: 0 })) {
      return 'File backup tidak valid.'
    }

    if (hasOwn(transaction, 'tax') && !isFiniteNumber(transaction.tax, { min: 0 })) {
      return 'File backup tidak valid.'
    }

    if (hasOwn(transaction, 'cashReceived')
      && transaction.cashReceived !== null
      && !isFiniteNumber(transaction.cashReceived, { min: 0 })) {
      return 'File backup tidak valid.'
    }

    if (hasOwn(transaction, 'changeAmount')
      && transaction.changeAmount !== null
      && !isFiniteNumber(transaction.changeAmount, { min: 0 })) {
      return 'File backup tidak valid.'
    }

    if (!validateCustomerSnapshot(transaction.customerSnapshot ?? null)
      || !validateBusinessSnapshot(transaction.businessSnapshot ?? null)) {
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

function formatTimestamp(date = new Date()) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hours = `${date.getHours()}`.padStart(2, '0')
  const minutes = `${date.getMinutes()}`.padStart(2, '0')
  const seconds = `${date.getSeconds()}`.padStart(2, '0')

  return `${year}${month}${day}-${hours}${minutes}${seconds}`
}

export function createBackupPayload(stores) {
  const payload = {
    schema: BACKUP_SCHEMA,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      business: buildBusinessData(stores.businessStore),
      products: buildProductData(stores.productStore),
      customers: stores.customerStore.customers.map((customer) => ({ ...customer })),
      expenses: stores.expenseStore.expenses.map((expense) => ({ ...expense })),
      transactions: stores.transactionStore.items.map((transaction) => normalizeTransactionForBackup(transaction)),
    },
  }

  return jsonClone(payload)
}

export function validateBackupPayload(payload) {
  if (!isObject(payload) || payload.schema !== BACKUP_SCHEMA) {
    return {
      valid: false,
      error: 'File backup tidak valid.',
    }
  }

  if (payload.version !== BACKUP_VERSION) {
    return {
      valid: false,
      error: 'Versi backup tidak didukung.',
    }
  }

  const dataError = ensureDataSections(payload.data)
    || validateBusinessData(payload.data.business)
    || validateProductsData(payload.data.products)
    || validateCustomersData(payload.data.customers)
    || validateExpensesData(payload.data.expenses)
    || validateTransactionsData(payload.data.transactions)

  if (dataError) {
    return {
      valid: false,
      error: dataError,
    }
  }

  return {
    valid: true,
    error: '',
    data: jsonClone(payload.data),
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
    selectedCategory: 'Semua',
    searchQuery: '',
  })

  stores.customerStore.$patch({
    customers: data.customers,
  })

  stores.expenseStore.$patch({
    expenses: data.expenses,
  })

  stores.transactionStore.$patch({
    items: data.transactions,
    lastTransaction: null,
  })

  stores.cartStore.clearCart()

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
