export const DB_NAME = 'pos_mobile'
export const DB_VERSION = 2

export const APP_META_KEYS = {
  initialized: 'data_initialized',
}

export const APP_STATE_KEYS = {
  cashier: 'cashier_state',
  shift: 'shift_state',
}

export const RESERVED_CATEGORY = 'Semua'

// Base schema is the v1 schema. Every table below is part of version 1.
export const CREATE_TABLE_STATEMENTS = `
  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS business (
    id INTEGER PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    owner TEXT NOT NULL,
    phone TEXT NOT NULL,
    outlet TEXT NOT NULL,
    mode TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    name TEXT PRIMARY KEY NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price REAL NOT NULL,
    stock REAL NOT NULL,
    is_active INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    note TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
`

export const SYNC_QUEUE_TABLE_STATEMENT = `
  CREATE TABLE IF NOT EXISTS sync_queue (
    id TEXT PRIMARY KEY NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    payload TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_queue_entity
    ON sync_queue (entity_type, entity_id);
`

// MIGRATIONS maps each schema version to the SQL needed to upgrade from the
// previous version to that version. Version 1 is the base schema, so the first
// migration entry is version 2.
export const MIGRATIONS = {
  2: SYNC_QUEUE_TABLE_STATEMENT,
}
