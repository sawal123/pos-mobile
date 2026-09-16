export const SYNC_OPERATIONS = {
  UPSERT: 'upsert',
  DELETE: 'delete',
}

export const SYNC_ENTITY_TYPES = {
  BUSINESS: 'business',
  CATEGORY: 'category',
  PRODUCT: 'product',
  CUSTOMER: 'customer',
  EXPENSE: 'expense',
  TRANSACTION: 'transaction',
  CASH_ENTRY: 'cash_entry',
  STOCK_MOVEMENT: 'stock_movement',
}

export const SYNC_QUEUE_DEFAULT_LIMIT = 100

// Business row id used as the entity id for the business outbox entry.
export const SYNC_BUSINESS_ENTITY_ID = '1'

// The reserved filter category that must never be pushed to the outbox.
export const SYNC_RESERVED_CATEGORY = 'Semua'
