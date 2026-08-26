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
    deviceIdentifier: null,
    cloudContext: null,
    syncIdentityMap: null,
    syncPushBinding: null,
    syncPushInflight: null,
    syncPullBinding: null,
    syncPullState: null,
    syncServerVersions: null,
    syncConflicts: null,
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
    async deleteSyncQueueItemIfUnchanged(snapshot) {
      if (!snapshot || !snapshot.id) return { changes: 0 }
      const index = state.syncQueue.findIndex((item) => {
        if (item.id !== snapshot.id) return false
        if (item.updatedAt !== snapshot.updatedAt) return false
        if (item.operation !== snapshot.operation) return false
        const itemPayload = item.payload === null || item.payload === undefined ? null : JSON.stringify(item.payload)
        const snapPayload = snapshot.payload === null || snapshot.payload === undefined ? null : JSON.stringify(snapshot.payload)
        return itemPayload === snapPayload
      })

      if (index === -1) {
        return { changes: 0 }
      }

      state.syncQueue.splice(index, 1)
      return { changes: 1 }
    },
    async markSyncQueueItemFailedIfUnchanged(snapshot, error) {
      if (!snapshot || !snapshot.id) return { changes: 0 }
      const item = state.syncQueue.find((entry) => {
        if (entry.id !== snapshot.id) return false
        if (entry.updatedAt !== snapshot.updatedAt) return false
        if (entry.operation !== snapshot.operation) return false
        const itemPayload = entry.payload === null || entry.payload === undefined ? null : JSON.stringify(entry.payload)
        const snapPayload = snapshot.payload === null || snapshot.payload === undefined ? null : JSON.stringify(snapshot.payload)
        return itemPayload === snapPayload
      })

      if (!item) {
        return { changes: 0 }
      }

      item.attemptCount += 1
      item.lastError = error instanceof Error ? error.message : String(error ?? '')
      return { changes: 1 }
    },
    // P10: device identifier (stable, non-sensitive, survives logout)
    async loadDeviceIdentifier() {
      return state.deviceIdentifier ? String(state.deviceIdentifier) : null
    },
    async saveDeviceIdentifier(id) {
      state.deviceIdentifier = String(id)
    },
    // P10: non-sensitive cloud session context
    async loadCloudContext() {
      return state.cloudContext ? cloneValue(state.cloudContext) : null
    },
    async saveCloudContext(ctx) {
      state.cloudContext = cloneValue(ctx)
    },
    async clearCloudContext() {
      state.cloudContext = null
    },
    // P11: sync identity map (stable, durable, non-sensitive, survives logout)
    async loadSyncIdentityMap() {
      return state.syncIdentityMap ? cloneValue(state.syncIdentityMap) : null
    },
    async saveSyncIdentityMap(map) {
      state.syncIdentityMap = cloneValue(map)
    },
    // P12: sync push business binding (stable, durable, survives logout)
    async loadSyncPushBinding() {
      return state.syncPushBinding ? cloneValue(state.syncPushBinding) : null
    },
    async saveSyncPushBinding(binding) {
      state.syncPushBinding = cloneValue(binding)
    },
    // P12: sync push in-flight request envelope (durable, survives restart)
    async loadSyncPushInflight() {
      return state.syncPushInflight ? cloneValue(state.syncPushInflight) : null
    },
    async saveSyncPushInflight(envelope) {
      state.syncPushInflight = cloneValue(envelope)
    },
    async clearSyncPushInflight() {
      state.syncPushInflight = null
    },
    // P13: sync pull context binding (durable, survives restart & logout)
    async loadSyncPullBinding() {
      return state.syncPullBinding ? cloneValue(state.syncPullBinding) : null
    },
    async saveSyncPullBinding(binding) {
      state.syncPullBinding = cloneValue(binding)
    },
    // P13: sync pull state/cursor (durable, survives restart & logout)
    async loadSyncPullState() {
      return state.syncPullState ? cloneValue(state.syncPullState) : null
    },
    async saveSyncPullState(pullState) {
      state.syncPullState = cloneValue(pullState)
    },
    // P13: sync server versions metadata (durable, survives restart & logout)
    async loadSyncServerVersions() {
      return state.syncServerVersions ? cloneValue(state.syncServerVersions) : null
    },
    async saveSyncServerVersions(versions) {
      state.syncServerVersions = cloneValue(versions)
    },
    async upsertSyncQueueItems(entries) {
      if (!Array.isArray(entries) || entries.length === 0) {
        return
      }
      const nextQueue = cloneValue(state.syncQueue)
      for (const entry of entries) {
        const index = nextQueue.findIndex(
          (item) => item.entityType === entry.entityType && item.entityId === entry.entityId,
        )

        if (index === -1) {
          nextQueue.push(cloneValue(entry))
        } else {
          const existing = nextQueue[index]
          nextQueue[index] = {
            ...existing,
            operation: entry.operation,
            payload:
              entry.payload === null || entry.payload === undefined
                ? null
                : cloneValue(entry.payload),
            updatedAt: entry.updatedAt,
            attemptCount: 0,
            lastError: null,
          }
        }
      }
      state.syncQueue = nextQueue
    },
    // P14: sync bootstrap state (durable, survives restart & logout)
    async loadSyncBootstrapState() {
      return state.syncBootstrapState ? cloneValue(state.syncBootstrapState) : null
    },
    async saveSyncBootstrapState(bootstrapState) {
      state.syncBootstrapState = cloneValue(bootstrapState)
    },
    // P15: sync conflicts (durable, survives restart & logout)
    async loadSyncConflicts() {
      return state.syncConflicts ? cloneValue(state.syncConflicts) : null
    },
    async saveSyncConflicts(conflictsState) {
      state.syncConflicts = cloneValue(conflictsState)
    },
    async clearSyncConflicts() {
      state.syncConflicts = null
    },
    async close() {},
  }
}
