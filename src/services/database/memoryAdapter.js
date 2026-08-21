import { DB_VERSION, RESERVED_CATEGORY } from './schema'
import { applyMigrations } from './migrations'

function cloneValue(value) {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value)
  }

  return JSON.parse(JSON.stringify(value))
}

export function createMemoryAdapter() {
  const state = {
    initialized: false,
    schemaVersion: 0,
    business: null,
    products: [],
    categories: [],
    customers: [],
    expenses: [],
    transactions: [],
    cashierState: null,
    shiftState: null,
    syncQueue: [],
  }

  return {
    name: 'memory',
    async initialize() {
      await applyMigrations(
        {
          getVersion: () => state.schemaVersion,
          setVersion: (version) => {
            state.schemaVersion = version
          },
          execute: async () => {},
        },
        DB_VERSION,
      )
    },
    async getSchemaVersion() {
      return state.schemaVersion
    },
    async setSchemaVersion(version) {
      state.schemaVersion = version
    },
    async isInitialized() {
      return state.initialized
    },
    async markInitialized() {
      state.initialized = true
    },
    async loadBusiness() {
      return cloneValue(state.business)
    },
    async saveBusiness(data) {
      state.business = cloneValue(data)
    },
    async loadProducts() {
      return {
        products: cloneValue(state.products),
        categories: cloneValue(state.categories),
      }
    },
    async saveProducts(products, categories) {
      state.products = cloneValue(products)
      state.categories = cloneValue(
        categories.filter((category) => String(category) !== RESERVED_CATEGORY),
      )
    },
    async loadCustomers() {
      return cloneValue(state.customers)
    },
    async saveCustomers(customers) {
      state.customers = cloneValue(customers)
    },
    async loadExpenses() {
      return cloneValue(state.expenses)
    },
    async saveExpenses(expenses) {
      state.expenses = cloneValue(expenses)
    },
    async loadTransactions() {
      return cloneValue(state.transactions)
    },
    async saveTransactions(transactions) {
      state.transactions = cloneValue(transactions)
    },
    async loadCashierState() {
      return cloneValue(state.cashierState)
    },
    async saveCashierState(value) {
      state.cashierState = cloneValue(value)
    },
    async loadShiftState() {
      return cloneValue(state.shiftState)
    },
    async saveShiftState(value) {
      state.shiftState = cloneValue(value)
    },
    async upsertSyncQueueItem(entry) {
      const index = state.syncQueue.findIndex(
        (item) => item.entityType === entry.entityType && item.entityId === entry.entityId,
      )

      if (index === -1) {
        state.syncQueue.push(cloneValue(entry))
        return
      }

      const existing = state.syncQueue[index]

      state.syncQueue[index] = {
        ...existing,
        operation: entry.operation,
        payload:
          entry.payload === null || entry.payload === undefined ? null : cloneValue(entry.payload),
        updatedAt: entry.updatedAt,
        attemptCount: 0,
        lastError: null,
      }
    },
    async listSyncQueueItems({ limit = 100 } = {}) {
      return cloneValue(
        state.syncQueue
          .slice()
          .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
          .slice(0, Number(limit)),
      )
    },
    async countSyncQueueItems() {
      return state.syncQueue.length
    },
    async markSyncQueueItemFailed(id, error) {
      const item = state.syncQueue.find((entry) => entry.id === id)

      if (!item) {
        return
      }

      item.attemptCount += 1
      item.lastError = error
    },
    async deleteSyncQueueItem(id) {
      state.syncQueue = state.syncQueue.filter((entry) => entry.id !== id)
    },
    async close() {},
  }
}
