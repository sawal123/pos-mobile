import { useBusinessStore } from '@/stores/businessStore'
import { useCashStore } from '@/stores/cashStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { useProductStore } from '@/stores/productStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useTransactionStore } from '@/stores/transactionStore'

import { SYNC_BUSINESS_ENTITY_ID, SYNC_ENTITY_TYPES, SYNC_RESERVED_CATEGORY } from './syncConstants'

const CLOUD_SYNCABLE_BUSINESS_FIELDS = ['name', 'type', 'owner', 'phone', 'outlet']

function captureCloudSyncableBusiness(businessStore) {
  return {
    name: businessStore.name,
    type: businessStore.type,
    owner: businessStore.owner,
    phone: businessStore.phone,
    outlet: businessStore.outlet,
  }
}

function cloudSyncableBusinessChanged(before, after) {
  return CLOUD_SYNCABLE_BUSINESS_FIELDS.some((field) => before[field] !== after[field])
}

/**
 * Tracks successful user mutations and mirrors them into the durable sync
 * outbox. Uses Pinia $onAction so hydration/restore via $patch never produces
 * cloud operations, and only enqueues when the business is in cloud mode.
 *
 * This is a local-only foundation: nothing is sent to any server on P9.
 */
export function createSyncChangeTracker({ pinia, queueService, stores = {} }) {
  const businessStore = stores.businessStore ?? useBusinessStore(pinia)
  const productStore = stores.productStore ?? useProductStore(pinia)
  const cashStore = stores.cashStore ?? useCashStore(pinia)
  const customerStore = stores.customerStore ?? useCustomerStore(pinia)
  const expenseStore = stores.expenseStore ?? useExpenseStore(pinia)
  const transactionStore = stores.transactionStore ?? useTransactionStore(pinia)
  const shiftStore = stores.shiftStore ?? useShiftStore(pinia)

  const stopHandlers = []

  function isCloudMode() {
    return businessStore.mode === 'cloud'
  }

  function enqueueUpsert(entityType, entityId, payload) {
    if (!isCloudMode()) {
      return
    }

    // Snapshot reactive Pinia state synchronously: queueService.enqueue is
    // async (serialized persistence), so a later in-place mutation such as
    // updateOrderStatus/settle would otherwise rewrite the payload that the
    // already-queued snapshot points at, and the server-accepted cleanup
    // would CAS-mismatch against the mutated row.
    const snapshot = payload === undefined || payload === null
      ? payload
      : JSON.parse(JSON.stringify(payload))

    void queueService.enqueueUpsert(entityType, entityId, snapshot)
  }

  function enqueueDelete(entityType, entityId) {
    if (!isCloudMode()) {
      return
    }

    void queueService.enqueueDelete(entityType, entityId)
  }

  function track(store, name, handler) {
    const stop = store.$onAction((action) => {
      if (action.name === name) {
        handler(action)
      }
    })

    stopHandlers.push(stop)
  }

  // ---- BUSINESS ----
  // Capture cloud-syncable profile fields before the action; after success,
  // only queue when those fields actually changed AND the resulting mode is
  // cloud. A mode-only change is never a business cloud mutation.
  track(businessStore, 'setBusiness', ({ after }) => {
    const before = captureCloudSyncableBusiness(businessStore)

    after(() => {
      if (!isCloudMode()) {
        return
      }

      const current = captureCloudSyncableBusiness(businessStore)

      if (cloudSyncableBusinessChanged(before, current)) {
        void queueService.enqueueUpsert(
          SYNC_ENTITY_TYPES.BUSINESS,
          SYNC_BUSINESS_ENTITY_ID,
          current,
        )
      }
    })
  })

  // ---- PRODUCT ----
  track(productStore, 'createProduct', ({ after }) => {
    after((result) => {
      if (result?.success) {
        enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, result.product.id, result.product)
      }
    })
  })

  track(productStore, 'updateProduct', ({ after }) => {
    after((result) => {
      if (result?.success) {
        enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, result.product.id, result.product)
      }
    })
  })

  track(productStore, 'toggleProductActive', ({ args, after }) => {
    const [id] = args

    after((result) => {
      if (result !== true) {
        return
      }

      const product = productStore.getProductById(id)

      if (product) {
        enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, product.id, product)
      }
    })
  })

  track(productStore, 'deleteProduct', ({ args, after }) => {
    const [id] = args

    after((result) => {
      if (result === true) {
        enqueueDelete(SYNC_ENTITY_TYPES.PRODUCT, id)
      }
    })
  })

  // ---- CATEGORY ----
  track(productStore, 'createCategory', ({ after }) => {
    after((result) => {
      if (!result?.success || result.category === SYNC_RESERVED_CATEGORY) {
        return
      }

      enqueueUpsert(SYNC_ENTITY_TYPES.CATEGORY, result.category, { name: result.category })
    })
  })

  // Rename: delete old category id, upsert new category id, and re-queue every
  // product whose category changed because of the rename.
  track(productStore, 'updateCategory', ({ args, after }) => {
    const [currentName] = args
    const affectedProductIds = productStore.products
      .filter((product) => product.category === currentName)
      .map((product) => product.id)

    after((result) => {
      if (!result?.success) {
        return
      }

      enqueueDelete(SYNC_ENTITY_TYPES.CATEGORY, currentName)
      enqueueUpsert(SYNC_ENTITY_TYPES.CATEGORY, result.category, { name: result.category })

      for (const productId of affectedProductIds) {
        const product = productStore.getProductById(productId)

        if (product) {
          enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, product.id, product)
        }
      }
    })
  })

  track(productStore, 'deleteCategory', ({ args, after }) => {
    const [name] = args

    after((result) => {
      if (result?.success) {
        enqueueDelete(SYNC_ENTITY_TYPES.CATEGORY, name)
      }
    })
  })

  // ---- CUSTOMER ----
  track(customerStore, 'createCustomer', ({ after }) => {
    after((result) => {
      if (result?.success) {
        enqueueUpsert(SYNC_ENTITY_TYPES.CUSTOMER, result.customer.id, result.customer)
      }
    })
  })

  track(customerStore, 'updateCustomer', ({ after }) => {
    after((result) => {
      if (result?.success) {
        enqueueUpsert(SYNC_ENTITY_TYPES.CUSTOMER, result.customer.id, result.customer)
      }
    })
  })

  track(customerStore, 'deleteCustomer', ({ args, after }) => {
    const [id] = args

    after((result) => {
      if (result === true) {
        enqueueDelete(SYNC_ENTITY_TYPES.CUSTOMER, id)
      }
    })
  })

  // ---- EXPENSE ----
  track(expenseStore, 'createExpense', ({ after }) => {
    after((result) => {
      if (result?.success) {
        enqueueUpsert(SYNC_ENTITY_TYPES.EXPENSE, result.expense.id, result.expense)
      }
    })
  })

  track(expenseStore, 'updateExpense', ({ after }) => {
    after((result) => {
      if (result?.success) {
        enqueueUpsert(SYNC_ENTITY_TYPES.EXPENSE, result.expense.id, result.expense)
      }
    })
  })

  track(expenseStore, 'deleteExpense', ({ args, after }) => {
    const [id] = args

    after((result) => {
      if (result === true) {
        enqueueDelete(SYNC_ENTITY_TYPES.EXPENSE, id)
      }
    })
  })

  // ---- TRANSACTION ----
  // addTransaction is the canonical sync point. createTransaction calls
  // addTransaction internally, so tracking only addTransaction guarantees
  // exactly one outbox row per local transaction. updateOrderStatus and
  // settleLaundryOrderPayment mutate transactions in place (they never call
  // addTransaction), so they need explicit tracking: re-enqueue the full
  // mutated transaction snapshot as one upsert. advanceOrderStatus and
  // payLaundryOrder both delegate to those two canonical actions, so they
  // are intentionally NOT tracked — tracking the wrappers too would double.
  track(transactionStore, 'addTransaction', ({ after }) => {
    after((transaction) => {
      if (!transaction) {
        return
      }

      enqueueUpsert(SYNC_ENTITY_TYPES.TRANSACTION, transaction.id, transaction)
    })
  })

  function enqueueTransactionSnapshot(id) {
    const transaction = transactionStore.items.find((item) => item.id === id)

    if (transaction) {
      enqueueUpsert(SYNC_ENTITY_TYPES.TRANSACTION, transaction.id, transaction)
    }
  }

  track(transactionStore, 'updateOrderStatus', ({ args, after }) => {
    const [id] = args

    after((result) => {
      if (result === true) {
        enqueueTransactionSnapshot(id)
      }
    })
  })

  track(transactionStore, 'settleLaundryOrderPayment', ({ after }) => {
    after((result) => {
      if (result?.success && !result?.duplicated && result?.transaction?.id) {
        enqueueTransactionSnapshot(result.transaction.id)
      }
    })
  })

  // ---- CASH ----
  // recordEntry is the canonical cash sync point: recordSalePayment and
  // recordOpeningBalance both funnel into it, so tracking it alone gives
  // exactly one outbox row per physical cash movement. The stable local entry
  // id is the retry identity; retries of the same entry overwrite, never
  // create a second outbox row.
  track(cashStore, 'recordEntry', ({ after }) => {
    after((result) => {
      if (!result?.success || result?.duplicated || !result?.entry?.id) {
        return
      }

      enqueueUpsert(SYNC_ENTITY_TYPES.CASH_ENTRY, result.entry.id, result.entry)
    })
  })

  // ---- STOCK MOVEMENTS ----
  // Both adjustStock and updateProduct return the recorded movement directly,
  // so the tracker enqueues exactly the movement that was created — never a
  // stale head-of-list row and never two rows for one stock change.
  function enqueueMovement(result) {
    if (!result?.success || !result?.movement?.id) {
      return
    }

    enqueueUpsert(SYNC_ENTITY_TYPES.STOCK_MOVEMENT, result.movement.id, result.movement)
  }

  track(productStore, 'adjustStock', ({ after }) => {
    after((result) => {
      enqueueMovement(result)
    })
  })

  track(productStore, 'updateProduct', ({ after }) => {
    after((result) => {
      enqueueMovement(result)
    })
  })

  // ---- SHIFT ----
  // openShift/closeShift mutate the same stable shift identity; each call
  // enqueues one upsert of that identity. Free mode never queues.
  function enqueueShift(shiftStore) {
    if (!shiftStore?.id) {
      return
    }

    enqueueUpsert(SYNC_ENTITY_TYPES.SHIFT, shiftStore.id, {
      id: shiftStore.id,
      shiftNumber: shiftStore.shiftNumber ?? shiftStore.id,
      status: shiftStore.status ?? (shiftStore.isOpen ? 'open' : 'closed'),
      openingCash: shiftStore.openingBalance ?? 0,
      closingCash: shiftStore.closingBalance ?? null,
      openedAt: shiftStore.openedAt,
      closedAt: shiftStore.closedAt ?? null,
      notes: shiftStore.notes ?? '',
    })
  }

  track(shiftStore, 'openShift', ({ after }) => {
    after(() => {
      enqueueShift(shiftStore)
    })
  })

  track(shiftStore, 'closeShift', ({ after }) => {
    after(() => {
      enqueueShift(shiftStore)
    })
  })

  return {
    dispose() {
      for (const stop of stopHandlers) {
        stop()
      }

      stopHandlers.length = 0
    },
  }
}
