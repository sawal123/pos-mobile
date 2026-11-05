export const DB_NAME = 'pos_mobile'
export const DB_VERSION = 7

export const APP_META_KEYS = {
  initialized: 'data_initialized',
}

export const APP_STATE_KEYS = {
  cashier: 'cashier_state',
  shift: 'shift_state',
  cash: 'cash_state',
  stockMovements: 'stock_movements_state',
  printer: 'printer_state',
  receipt: 'receipt_settings',
  tax: 'tax_settings',
  promos: 'promos_state',
  variantGroups: 'variant_groups_state',
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
//
// Native @capacitor-community/sqlite upgrade sequence (registered before the
// database is opened, built in sqliteAdapter.buildUpgradeStatements):
//   toVersion 1 = CREATE_TABLE_STATEMENTS (P8 base schema)
//   toVersion 2 = MIGRATIONS[2] (sync_queue + unique index)
// Fresh installs run v0 -> v1 -> v2; existing P8 (v1) databases run only v2.
export const MIGRATIONS = {
  2: SYNC_QUEUE_TABLE_STATEMENT,
  3: `
  ALTER TABLE products ADD COLUMN sku TEXT NOT NULL DEFAULT '';
  ALTER TABLE products ADD COLUMN cost REAL NOT NULL DEFAULT 0;
  ALTER TABLE products ADD COLUMN unit TEXT NOT NULL DEFAULT 'pcs';
  ALTER TABLE products ADD COLUMN min_stock REAL NOT NULL DEFAULT 0;
  ALTER TABLE products ADD COLUMN kind TEXT NOT NULL DEFAULT 'product';
  ALTER TABLE products ADD COLUMN pricing_unit TEXT NOT NULL DEFAULT 'pcs';
  ALTER TABLE products ADD COLUMN min_quantity REAL NOT NULL DEFAULT 0;
  ALTER TABLE products ADD COLUMN estimated_duration TEXT NOT NULL DEFAULT '';
  `,
  4: `
  ALTER TABLE products ADD COLUMN image_data TEXT NOT NULL DEFAULT '';
  `,
  5: `
  ALTER TABLE products ADD COLUMN is_sellable INTEGER NOT NULL DEFAULT 1;
  CREATE TABLE IF NOT EXISTS promos (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    code TEXT NULL,
    discount_type TEXT NOT NULL,
    discount_value INTEGER NOT NULL,
    scope TEXT NOT NULL DEFAULT 'all',
    min_purchase REAL NOT NULL DEFAULT 0,
    max_discount REAL NULL,
    weekdays TEXT NULL,
    starts_at TEXT NULL,
    ends_at TEXT NULL,
    start_time TEXT NULL,
    end_time TEXT NULL,
    usage_limit_total INTEGER NULL,
    usage_limit_per_customer INTEGER NULL,
    is_stackable INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    sync_id TEXT NOT NULL,
    sync_version INTEGER NOT NULL DEFAULT 1,
    targets TEXT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_promos_status ON promos(status);
  `,
  6: `
  ALTER TABLE products ADD COLUMN variant_group_ids TEXT NOT NULL DEFAULT '[]';
  CREATE TABLE IF NOT EXISTS variant_groups (
    id TEXT PRIMARY KEY NOT NULL,
    sync_id TEXT NOT NULL,
    name TEXT NOT NULL,
    selection_type TEXT NOT NULL DEFAULT 'single',
    is_required INTEGER NOT NULL DEFAULT 1,
    min_selection INTEGER NOT NULL DEFAULT 1,
    max_selection INTEGER NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    sync_version INTEGER NOT NULL DEFAULT 1,
    options TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_variant_groups_status ON variant_groups(status);
  `,
  7: `ALTER TABLE products ADD COLUMN barcode TEXT NOT NULL DEFAULT '';`,
}
