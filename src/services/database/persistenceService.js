import { nextTick, watch } from 'vue'

import { useBusinessStore } from '@/stores/businessStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { useProductStore } from '@/stores/productStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useTransactionStore } from '@/stores/transactionStore'

import { DB_VERSION } from './schema'

function cloneValue(value) {
  if (value === undefined) {
    return undefined
  }

  return JSON.parse(JSON.stringify(value))
}

function createPersistenceContexts(pinia) {
  const businessStore = useBusinessStore(pinia)
  const productStore = useProductStore(pinia)
  const customerStore = useCustomerStore(pinia)
  const expenseStore = useExpenseStore(pinia)
  const transactionStore = useTransactionStore(pinia)
  const cashierStore = useCashierStore(pinia)
  const shiftStore = useShiftStore(pinia)

  return [
    {
      key: 'business',
      store: businessStore,
      initialState: cloneValue(businessStore.$state),
      read() {
        return {
          name: businessStore.name,
          type: businessStore.type,
          owner: businessStore.owner,
          phone: businessStore.phone,
          outlet: businessStore.outlet,
          mode: businessStore.mode,
        }
      },
      async load(adapter) {
        return adapter.loadBusiness()
      },
      async save(adapter, snapshot) {
        await adapter.saveBusiness(snapshot)
      },
    },
    {
      key: 'products',
      store: productStore,
      initialState: cloneValue(productStore.$state),
      read() {
        return {
          products: cloneValue(productStore.products),
          categories: cloneValue(productStore.categories),
        }
      },
      async load(adapter) {
        return adapter.loadProducts()
      },
      async save(adapter, snapshot) {
        await adapter.saveProducts(snapshot.products, snapshot.categories)
      },
    },
    {
      key: 'customers',
      store: customerStore,
      initialState: cloneValue(customerStore.$state),
      read() {
        return {
          customers: cloneValue(customerStore.customers),
        }
      },
      async load(adapter) {
        const customers = await adapter.loadCustomers()
        return { customers }
      },
      async save(adapter, snapshot) {
        await adapter.saveCustomers(snapshot.customers)
      },
    },
    {
      key: 'expenses',
      store: expenseStore,
      initialState: cloneValue(expenseStore.$state),
      read() {
        return {
          expenses: cloneValue(expenseStore.expenses),
        }
      },
      async load(adapter) {
        const expenses = await adapter.loadExpenses()
        return { expenses }
      },
      async save(adapter, snapshot) {
        await adapter.saveExpenses(snapshot.expenses)
      },
    },
    {
      key: 'transactions',
      store: transactionStore,
      initialState: cloneValue(transactionStore.$state),
      read() {
        return {
          items: cloneValue(transactionStore.items),
        }
      },
      async load(adapter) {
        const items = await adapter.loadTransactions()
        return { items }
      },
      async save(adapter, snapshot) {
        await adapter.saveTransactions(snapshot.items)
      },
    },
    {
      key: 'cashier',
      store: cashierStore,
      initialState: cloneValue(cashierStore.$state),
      read() {
        return {
          activeCashier: cloneValue(cashierStore.activeCashier),
        }
      },
      async load(adapter) {
        const activeCashier = await adapter.loadCashierState()
        return activeCashier ? { activeCashier } : null
      },
      async save(adapter, snapshot) {
        await adapter.saveCashierState(snapshot.activeCashier)
      },
    },
    {
      key: 'shift',
      store: shiftStore,
      initialState: cloneValue(shiftStore.$state),
      read() {
        return {
          isOpen: shiftStore.isOpen,
          openingBalance: shiftStore.openingBalance,
          openedAt: shiftStore.openedAt,
        }
      },
      async load(adapter) {
        return adapter.loadShiftState()
      },
      async save(adapter, snapshot) {
        await adapter.saveShiftState(snapshot)
      },
    },
  ]
}

export function createPersistenceService({ adapter, pinia }) {
  const contexts = createPersistenceContexts(pinia)
  const stopWatchers = []
  let suppressPersistence = false
  let writeQueue = Promise.resolve()

  function runSerialized(task, label) {
    const run = writeQueue.catch(() => {}).then(task)

    writeQueue = run.catch((error) => {
      console.error(`Persistence write failed for ${label}.`, error)
    })

    return run
  }

  async function seedCurrentState() {
    for (const context of contexts) {
      await context.save(adapter, context.read())
    }

    await adapter.markInitialized()
  }

  async function hydrateState() {
    suppressPersistence = true

    try {
      for (const context of contexts) {
        const loadedState = await context.load(adapter)

        if (!loadedState) {
          continue
        }

        context.store.$patch({
          ...cloneValue(context.initialState),
          ...cloneValue(loadedState),
        })
      }
    } finally {
      suppressPersistence = false
    }
  }

  function registerWatchers() {
    for (const context of contexts) {
      const stop = watch(
        () => context.read(),
        (snapshot) => {
          if (suppressPersistence) {
            return
          }

          const nextSnapshot = cloneValue(snapshot)
          void runSerialized(() => context.save(adapter, nextSnapshot), context.key)
        },
        { deep: true },
      )

      stopWatchers.push(stop)
    }
  }

  return {
    adapter,
    async initialize() {
      await adapter.initialize()

      const schemaVersion = await adapter.getSchemaVersion()

      if (schemaVersion !== DB_VERSION) {
        throw new Error(
          `Unsupported database schema version ${schemaVersion}. Expected ${DB_VERSION}.`,
        )
      }

      const firstRun = !(await adapter.isInitialized())

      if (firstRun) {
        await seedCurrentState()
      } else {
        await hydrateState()
      }

      registerWatchers()

      return {
        firstRun,
        schemaVersion,
      }
    },
    async flush() {
      await nextTick()
      await writeQueue
    },
    async close() {
      for (const stop of stopWatchers) {
        stop()
      }

      await nextTick()
      await writeQueue
      await adapter.close()
    },
    runSerialized,
  }
}
