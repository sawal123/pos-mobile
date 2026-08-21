import { DB_VERSION, RESERVED_CATEGORY } from './schema'

function cloneValue(value) {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value)
  }

  return JSON.parse(JSON.stringify(value))
}

export function createMemoryAdapter() {
  const state = {
    initialized: false,
    schemaVersion: DB_VERSION,
    business: null,
    products: [],
    categories: [],
    customers: [],
    expenses: [],
    transactions: [],
    cashierState: null,
    shiftState: null,
  }

  return {
    name: 'memory',
    async initialize() {},
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
    async close() {},
  }
}
