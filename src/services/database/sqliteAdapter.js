import {
  APP_META_KEYS,
  APP_STATE_KEYS,
  CREATE_TABLE_STATEMENTS,
  DB_NAME,
  DB_VERSION,
  MIGRATIONS,
  RESERVED_CATEGORY,
} from './schema'
import { applyMigrations } from './migrations'

// Normalize any error shape into a plain string before it is persisted. SQLite
// bind parameters must never receive an Error object.
export function normalizeErrorMessage(error) {
  if (error === null || error === undefined) {
    return ''
  }

  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

// Split a multi-statement SQL string (statements separated by ";\n") into
// individual statements. The native upgrade runner executes each element with
// a single execSQL call, so each element must be exactly one SQL statement.
function splitSqlStatements(sql) {
  return sql
    .split(';\n')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
}

// Build the official @capacitor-community/sqlite upgrade statement list from
// the single source of truth in schema.js. Version 1 is the P8 base schema;
// every MIGRATIONS entry upgrades the native database to its version during
// open(). This gives the complete sequence v0 -> v1 -> v2 for fresh installs
// while existing v1 databases only run the v2 step (data untouched).
function buildUpgradeStatements(targetVersion) {
  const upgrades = []

  if (targetVersion >= 1) {
    upgrades.push({
      toVersion: 1,
      statements: splitSqlStatements(CREATE_TABLE_STATEMENTS),
    })
  }

  for (const [versionKey, sql] of Object.entries(MIGRATIONS)) {
    const toVersion = Number(versionKey)

    if (toVersion > 1 && toVersion <= targetVersion) {
      upgrades.push({
        toVersion,
        statements: splitSqlStatements(sql),
      })
    }
  }

  return upgrades
}

function parseJsonValue(value, fallback) {
  if (value === null || value === undefined) {
    return fallback
  }

  return JSON.parse(value)
}

export function deserializeTransactionRows(rows) {
  const transactions = []

  for (const row of rows) {
    try {
      transactions.push(JSON.parse(row.payload))
    } catch (error) {
      console.error(`Failed to parse transaction payload for ${row.id}.`, error)
    }
  }

  return transactions
}

export function createSQLiteAdapter({ database = DB_NAME, version = DB_VERSION } = {}) {
  let sqliteConnection = null
  let rawConnection = null
  let dbConnection = null

  // ── Single-writer coordination ─────────────────────────────────────────────
  // @capacitor-community/sqlite allows only ONE transaction per connection, and
  // its `run`/`query`/`execute` helpers default to `transaction = true` (the
  // plugin opens its own BEGIN/COMMIT). Several independent producers drive this
  // adapter — the PersistenceService write queue, the P38 local operation
  // journal, the sync queue, restore and workspace switching — so without a
  // single writer an implicit BEGIN could collide with an explicit transaction
  // and leave the connection with a stale/rolled-back transaction state
  // (`Run: Failed in beginTransactionAlready in transaction`, followed by
  // `CommitTransaction: ... no current transaction`).
  //
  // The mutex below serializes every write and every explicit transaction.
  // Reads never take the lock (so they cannot deadlock a transaction) and never
  // let the plugin manage a transaction.
  let writerTail = Promise.resolve()

  function runExclusive(task) {
    const run = writerTail.then(() => task())
    writerTail = run.then(
      () => {},
      () => {},
    )
    return run
  }

  /**
   * Connection wrapper used OUTSIDE an explicit transaction: reads are direct,
   * writes are serialized with every explicit transaction, and no call ever lets
   * the plugin open an implicit transaction.
   */
  function createGuardedConnection(raw) {
    return {
      query: (statement, values = []) => raw.query(statement, values, false),
      run: (statement, values = []) => runExclusive(() => raw.run(statement, values, false)),
      execute: (statements) => runExclusive(() => raw.execute(statements, false)),
      beginTransaction: () => raw.beginTransaction(),
      commitTransaction: () => raw.commitTransaction(),
      rollbackTransaction: () => raw.rollbackTransaction(),
      isDBOpen: () => raw.isDBOpen(),
      open: () => raw.open(),
      close: () => raw.close(),
    }
  }

  /**
   * Connection wrapper handed to a `withTransaction` callback. The writer lock
   * is already held by the transaction, so these calls go straight to the plugin
   * (acquiring the lock again would deadlock) and never manage a transaction
   * themselves — they are part of the explicit one.
   */
  function createTransactionConnection(raw) {
    return {
      query: (statement, values = []) => raw.query(statement, values, false),
      run: (statement, values = []) => raw.run(statement, values, false),
      execute: (statements) => raw.execute(statements, false),
    }
  }

  async function ensureRawConnection() {
    if (rawConnection) {
      return rawConnection
    }

    const { CapacitorSQLite, SQLiteConnection } = await import('@capacitor-community/sqlite')

    if (!sqliteConnection) {
      sqliteConnection = new SQLiteConnection(CapacitorSQLite)
    }

    // Register the official upgrade statements BEFORE createConnection/open so
    // that opening an existing P8 (v1) database upgrades it to v2 natively.
    // Never rely on a custom migration running after the native connection is
    // already open.
    await sqliteConnection.addUpgradeStatement(database, buildUpgradeStatements(version))

    const consistency = await sqliteConnection.checkConnectionsConsistency()
    const existingConnection = await sqliteConnection.isConnection(database, false)

    if (consistency.result && existingConnection.result) {
      rawConnection = await sqliteConnection.retrieveConnection(database, false)
    } else {
      rawConnection = await sqliteConnection.createConnection(
        database,
        false,
        'no-encryption',
        version,
        false,
      )
    }

    const isOpen = await rawConnection.isDBOpen()

    if (!isOpen.result) {
      await rawConnection.open()
    }

    return rawConnection
  }

  async function ensureConnection() {
    const raw = await ensureRawConnection()

    if (!dbConnection) {
      dbConnection = createGuardedConnection(raw)
    }

    return dbConnection
  }

  async function withTransaction(work) {
    return runExclusive(async () => {
      const raw = await ensureRawConnection()
      await raw.beginTransaction()

      try {
        const result = await work(createTransactionConnection(raw))
        await raw.commitTransaction()
        return result
      } catch (error) {
        try {
          await raw.rollbackTransaction()
        } catch (rollbackError) {
          console.error('Failed to rollback SQLite transaction.', rollbackError)
        }

        throw error
      }
    })
  }

  async function readMetaValue(key, fallback = null) {
    const db = await ensureConnection()
    const { values = [] } = await db.query('SELECT value FROM app_meta WHERE key = ? LIMIT 1', [
      key,
    ])

    if (!values.length) {
      return fallback
    }

    return parseJsonValue(values[0].value, fallback)
  }

  async function writeMetaValue(key, value) {
    const db = await ensureConnection()
    await db.run('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [
      key,
      JSON.stringify(value),
    ])
  }

  async function readAppState(key, fallback = null) {
    const db = await ensureConnection()
    const { values = [] } = await db.query('SELECT value FROM app_state WHERE key = ? LIMIT 1', [
      key,
    ])

    if (!values.length) {
      return fallback
    }

    return parseJsonValue(values[0].value, fallback)
  }

  async function writeAppState(key, value) {
    const db = await ensureConnection()
    await db.run('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)', [
      key,
      JSON.stringify(value),
    ])
  }

  return {
    name: 'sqlite',
    async initialize() {
      const db = await ensureConnection()
      await db.execute('PRAGMA foreign_keys = ON;')
      await db.execute(CREATE_TABLE_STATEMENTS)

      await applyMigrations(
        {
          getVersion: () => this.getSchemaVersion(),
          setVersion: (nextVersion) => this.setSchemaVersion(nextVersion),
          execute: (sql) => db.execute(sql),
        },
        version,
      )

      try {
        await db.run("DELETE FROM sync_queue WHERE entity_type = 'business';")
      } catch {
        // non-blocking
      }
    },
    async getSchemaVersion() {
      const db = await ensureConnection()
      const { values = [] } = await db.query('PRAGMA user_version;')
      return Number(values[0]?.user_version ?? 0)
    },
    async setSchemaVersion(nextVersion) {
      const db = await ensureConnection()
      await db.execute(`PRAGMA user_version = ${Number(nextVersion)};`)
    },
    async isInitialized() {
      return (await readMetaValue(APP_META_KEYS.initialized, false)) === true
    },
    async markInitialized() {
      await writeMetaValue(APP_META_KEYS.initialized, true)
    },
    async loadBusiness() {
      const db = await ensureConnection()
      const { values = [] } = await db.query(
        'SELECT name, type, owner, phone, outlet, mode FROM business WHERE id = 1 LIMIT 1',
      )

      if (!values.length) {
        return null
      }

      return {
        name: values[0].name,
        type: values[0].type,
        owner: values[0].owner,
        phone: values[0].phone,
        outlet: values[0].outlet,
        mode: values[0].mode,
      }
    },
    async saveBusiness(data) {
      await withTransaction(async (db) => {
        await db.run('DELETE FROM business', [], false)
        await db.run(
          'INSERT INTO business (id, name, type, owner, phone, outlet, mode) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [1, data.name, data.type, data.owner, data.phone, data.outlet, data.mode],
          false,
        )
      })
    },
    async loadTaxState() {
      return readAppState(APP_STATE_KEYS.tax, null)
    },
    async saveTaxState(state) {
      await writeAppState(APP_STATE_KEYS.tax, state)
    },
    async loadProducts() {
      const db = await ensureConnection()
      const [{ values: categoryRows = [] }, { values: productRows = [] }] = await Promise.all([
        db.query('SELECT name FROM categories ORDER BY name ASC'),
        db.query(
          `SELECT id, name, category, sku, cost, price, stock, unit, min_stock,
             kind, pricing_unit, min_quantity, estimated_duration, image_data, is_active
           FROM products ORDER BY rowid ASC`,
        ),
      ])

      return {
        categories: categoryRows.map((row) => row.name),
        products: productRows.map((row) => ({
          id: row.id,
          name: row.name,
          category: row.category,
          sku: row.sku ?? '',
          cost: Number(row.cost ?? 0),
          price: Number(row.price),
          unitPrice: Number(row.price),
          stock: Number(row.stock),
          unit: row.unit ?? 'pcs',
          minStock: Number(row.min_stock ?? 0),
          kind: row.kind ?? 'product',
          pricingUnit: row.pricing_unit ?? 'pcs',
          minQuantity: Number(row.min_quantity ?? 0),
          estimatedDuration: row.estimated_duration ?? '',
          imageData: row.image_data ?? '',
          isActive: Boolean(row.is_active),
        })),
        stockMovements: await readAppState(APP_STATE_KEYS.stockMovements, []),
      }
    },
    async saveProducts(products, categories, stockMovements) {
      await withTransaction(async (db) => {
        await db.run('DELETE FROM products', [], false)
        await db.run('DELETE FROM categories', [], false)

        for (const category of categories) {
          if (String(category) === RESERVED_CATEGORY) {
            continue
          }

          await db.run('INSERT INTO categories (name) VALUES (?)', [category], false)
        }

        for (const product of products) {
          await db.run(
            `INSERT INTO products
              (id, name, category, sku, cost, price, stock, unit, min_stock,
               kind, pricing_unit, min_quantity, estimated_duration, image_data, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              String(product.id),
              product.name,
              product.category,
              product.sku ?? '',
              Number(product.cost ?? 0),
              Number(product.price),
              Number(product.stock),
              product.unit ?? 'pcs',
              Number(product.minStock ?? 0),
              product.kind ?? 'product',
              product.pricingUnit ?? 'pcs',
              Number(product.minQuantity ?? 0),
              product.estimatedDuration ?? '',
              product.imageData ?? '',
              product.isActive ? 1 : 0,
            ],
            false,
          )
        }

        if (stockMovements !== undefined) {
          await db.run(
            'INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)',
            [APP_STATE_KEYS.stockMovements, JSON.stringify(stockMovements)],
            false,
          )
        }
      })
    },
    async loadCustomers() {
      const db = await ensureConnection()
      const { values = [] } = await db.query(
        'SELECT id, name, phone, email FROM customers ORDER BY rowid ASC',
      )

      return values.map((row) => ({
        id: row.id,
        name: row.name,
        phone: row.phone,
        email: row.email,
      }))
    },
    async saveCustomers(customers) {
      await withTransaction(async (db) => {
        await db.run('DELETE FROM customers', [], false)

        for (const customer of customers) {
          await db.run(
            'INSERT INTO customers (id, name, phone, email) VALUES (?, ?, ?, ?)',
            [String(customer.id), customer.name, customer.phone, customer.email],
            false,
          )
        }
      })
    },
    async loadExpenses() {
      const db = await ensureConnection()
      const { values = [] } = await db.query(
        'SELECT id, title, category, amount, note, created_at FROM expenses ORDER BY rowid ASC',
      )

      return values.map((row) => ({
        id: row.id,
        title: row.title,
        category: row.category,
        amount: Number(row.amount),
        note: row.note,
        createdAt: row.created_at,
      }))
    },
    async saveExpenses(expenses) {
      await withTransaction(async (db) => {
        await db.run('DELETE FROM expenses', [], false)

        for (const expense of expenses) {
          await db.run(
            'INSERT INTO expenses (id, title, category, amount, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [
              String(expense.id),
              expense.title,
              expense.category,
              Number(expense.amount),
              expense.note,
              expense.createdAt,
            ],
            false,
          )
        }
      })
    },
    async loadTransactions() {
      const db = await ensureConnection()
      const { values = [] } = await db.query(
        'SELECT id, payload, created_at FROM transactions ORDER BY rowid ASC',
      )

      return deserializeTransactionRows(values)
    },
    async saveTransactions(transactions) {
      await withTransaction(async (db) => {
        await db.run('DELETE FROM transactions', [], false)

        for (const transaction of transactions) {
          await db.run(
            'INSERT INTO transactions (id, payload, created_at) VALUES (?, ?, ?)',
            [
              String(transaction.id),
              JSON.stringify(transaction),
              String(transaction.createdAt ?? '') || new Date().toISOString(),
            ],
            false,
          )
        }
      })
    },
    async loadCashierState() {
      return readAppState(APP_STATE_KEYS.cashier, null)
    },
    async saveCashierState(state) {
      await writeAppState(APP_STATE_KEYS.cashier, state)
    },
    async loadCashState() {
      return readAppState(APP_STATE_KEYS.cash, null)
    },
    async saveCashState(state) {
      await writeAppState(APP_STATE_KEYS.cash, state)
    },
    async loadShiftState() {
      return readAppState(APP_STATE_KEYS.shift, null)
    },
    async saveShiftState(state) {
      await writeAppState(APP_STATE_KEYS.shift, state)
    },
    // P33: device-local Bluetooth printer selection (not business data)
    async loadPrinterState() {
      return readAppState(APP_STATE_KEYS.printer, null)
    },
    async savePrinterState(state) {
      await writeAppState(APP_STATE_KEYS.printer, state)
    },
    async upsertSyncQueueItem(entry) {
      const db = await ensureConnection()

      // Single-statement upsert. On conflict the latest mutation wins while
      // created_at and id (first-queued identity) are preserved and retry
      // metadata is reset for the new payload.
      await db.run(
        `INSERT INTO sync_queue
           (id, entity_type, entity_id, operation, payload, created_at, updated_at, attempt_count, last_error)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)
         ON CONFLICT(entity_type, entity_id) DO UPDATE SET
           operation = excluded.operation,
           payload = excluded.payload,
           updated_at = excluded.updated_at,
           attempt_count = 0,
           last_error = NULL`,
        [
          entry.id,
          entry.entityType,
          entry.entityId,
          entry.operation,
          entry.payload === null || entry.payload === undefined
            ? null
            : JSON.stringify(entry.payload),
          entry.createdAt,
          entry.updatedAt,
        ],
      )
    },
    async upsertSyncQueueItems(entries) {
      if (!Array.isArray(entries) || entries.length === 0) {
        return
      }

      await withTransaction(async (db) => {
        for (const entry of entries) {
          await db.run(
            `INSERT INTO sync_queue
               (id, entity_type, entity_id, operation, payload, created_at, updated_at, attempt_count, last_error)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)
             ON CONFLICT(entity_type, entity_id) DO UPDATE SET
               operation = excluded.operation,
               payload = excluded.payload,
               updated_at = excluded.updated_at,
               attempt_count = 0,
               last_error = NULL`,
            [
              entry.id,
              entry.entityType,
              entry.entityId,
              entry.operation,
              entry.payload === null || entry.payload === undefined
                ? null
                : JSON.stringify(entry.payload),
              entry.createdAt,
              entry.updatedAt,
            ],
            false,
          )
        }
      })
    },
    async listSyncQueueItems({ limit = 100 } = {}) {
      const db = await ensureConnection()
      const { values = [] } = await db.query(
        `SELECT id, entity_type, entity_id, operation, payload, created_at, updated_at, attempt_count, last_error
         FROM sync_queue
         WHERE entity_type != 'business'
         ORDER BY created_at ASC, rowid ASC
         LIMIT ?`,
        [Number(limit)],
      )

      return values.map((row) => ({
        id: row.id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        operation: row.operation,
        payload: row.payload === null || row.payload === undefined ? null : JSON.parse(row.payload),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        attemptCount: Number(row.attempt_count),
        lastError: row.last_error,
      }))
    },
    async countSyncQueueItems() {
      const db = await ensureConnection()
      const { values = [] } = await db.query("SELECT COUNT(*) AS total FROM sync_queue WHERE entity_type != 'business'")
      return Number(values[0]?.total ?? 0)
    },
    async markSyncQueueItemFailed(id, error) {
      const db = await ensureConnection()
      await db.run(
        'UPDATE sync_queue SET attempt_count = attempt_count + 1, last_error = ? WHERE id = ?',
        [normalizeErrorMessage(error), id],
      )
    },
    async deleteSyncQueueItem(id) {
      const db = await ensureConnection()
      await db.run('DELETE FROM sync_queue WHERE id = ?', [id])
    },
    async deleteSyncQueueItemIfUnchanged(snapshot) {
      if (!snapshot || !snapshot.id) return { changes: 0 }
      const db = await ensureConnection()
      const payloadStr =
        snapshot.payload === null || snapshot.payload === undefined
          ? null
          : JSON.stringify(snapshot.payload)

      const result = await db.run(
        `DELETE FROM sync_queue
         WHERE id = ?
           AND updated_at = ?
           AND operation = ?
           AND ((payload IS NULL AND ? IS NULL) OR payload = ?)`,
        [snapshot.id, snapshot.updatedAt, snapshot.operation, payloadStr, payloadStr],
      )

      const count = result?.changes?.changes ?? 0
      return { changes: Number(count) }
    },
    async markSyncQueueItemFailedIfUnchanged(snapshot, error) {
      if (!snapshot || !snapshot.id) return { changes: 0 }
      const db = await ensureConnection()
      const payloadStr =
        snapshot.payload === null || snapshot.payload === undefined
          ? null
          : JSON.stringify(snapshot.payload)

      const result = await db.run(
        `UPDATE sync_queue
         SET attempt_count = attempt_count + 1,
             last_error = ?
         WHERE id = ?
           AND updated_at = ?
           AND operation = ?
           AND ((payload IS NULL AND ? IS NULL) OR payload = ?)`,
        [
          normalizeErrorMessage(error),
          snapshot.id,
          snapshot.updatedAt,
          snapshot.operation,
          payloadStr,
          payloadStr,
        ],
      )

      const count = result?.changes?.changes ?? 0
      return { changes: Number(count) }
    },
    // P10: device identifier (stable, non-sensitive, survives logout)
    async loadDeviceIdentifier() {
      return readMetaValue('device_identifier', null)
    },
    async saveDeviceIdentifier(id) {
      await writeMetaValue('device_identifier', id)
    },
    // P10: non-sensitive cloud session context (user, business, outlet, etc.)
    async loadCloudContext() {
      return readMetaValue('cloud_context', null)
    },
    async saveCloudContext(ctx) {
      await writeMetaValue('cloud_context', ctx)
    },
    async clearCloudContext() {
      const db = await ensureConnection()
      await db.run("DELETE FROM app_meta WHERE key = 'cloud_context'", [])
    },
    // Workspace isolation: registry of local/Cloud workspaces + their durable
    // snapshots. Stored in the generic app_meta key/value table so no schema
    // migration is required and existing databases keep working untouched.
    async loadWorkspaceRegistry() {
      return readMetaValue('workspace_registry_v1', null)
    },
    async saveWorkspaceRegistry(registry) {
      await writeMetaValue('workspace_registry_v1', registry)
    },
    async loadWorkspaceSnapshot(workspaceId) {
      return readMetaValue(`workspace_snapshot_v1:${String(workspaceId)}`, null)
    },
    async saveWorkspaceSnapshot(workspaceId, snapshot) {
      await writeMetaValue(`workspace_snapshot_v1:${String(workspaceId)}`, snapshot)
    },
    async deleteWorkspaceSnapshot(workspaceId) {
      const db = await ensureConnection()
      await db.run('DELETE FROM app_meta WHERE key = ?', [
        `workspace_snapshot_v1:${String(workspaceId)}`,
      ])
    },
    // Durable workspace-switch journal. Written before the singleton tables are
    // touched and cleared only after the registry commit, so an interrupted
    // switch is always detectable and recoverable on the next start.
    async loadWorkspaceSwitchJournal() {
      return readMetaValue('workspace_switch_journal_v1', null)
    },
    async saveWorkspaceSwitchJournal(journal) {
      await writeMetaValue('workspace_switch_journal_v1', journal)
    },
    async clearWorkspaceSwitchJournal() {
      const db = await ensureConnection()
      await db.run("DELETE FROM app_meta WHERE key = 'workspace_switch_journal_v1'", [])
    },
    // Cloud-first initialization journal (crash-safe recovery)
    async loadCloudInitializationJournal() {
      return readMetaValue('cloud_initialization_journal_v1', null)
    },
    async saveCloudInitializationJournal(journal) {
      await writeMetaValue('cloud_initialization_journal_v1', journal)
    },
    async clearCloudInitializationJournal() {
      const db = await ensureConnection()
      await db.run("DELETE FROM app_meta WHERE key = 'cloud_initialization_journal_v1'", [])
    },
    async replaceSyncQueueItems(entries) {
      await withTransaction(async (db) => {
        await db.run('DELETE FROM sync_queue', [], false)

        for (const entry of Array.isArray(entries) ? entries : []) {
          await db.run(
            `INSERT INTO sync_queue
               (id, entity_type, entity_id, operation, payload, created_at, updated_at, attempt_count, last_error)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              entry.id,
              entry.entityType,
              entry.entityId,
              entry.operation,
              entry.payload === null || entry.payload === undefined
                ? null
                : JSON.stringify(entry.payload),
              entry.createdAt,
              entry.updatedAt,
              Number(entry.attemptCount ?? 0),
              entry.lastError ?? null,
            ],
            false,
          )
        }
      })
    },
    // PREM-M04: non-sensitive pending subscription payment (recovery only).
    async loadPendingSubscriptionPayment() {
      return readMetaValue('premium_pending_payment', null)
    },
    async savePendingSubscriptionPayment(payment) {
      await writeMetaValue('premium_pending_payment', payment)
    },
    async clearPendingSubscriptionPayment() {
      const db = await ensureConnection()
      await db.run("DELETE FROM app_meta WHERE key = 'premium_pending_payment'", [])
    },
    // P11: sync identity map (stable, durable, non-sensitive, survives logout)
    async loadSyncIdentityMap() {
      return readMetaValue('sync_identity_map', null)
    },
    async saveSyncIdentityMap(map) {
      await writeMetaValue('sync_identity_map', map)
    },
    // P12: sync push business binding (stable, durable, survives logout)
    async loadSyncPushBinding() {
      return readMetaValue('sync_push_binding_v1', null)
    },
    async saveSyncPushBinding(binding) {
      await writeMetaValue('sync_push_binding_v1', binding)
    },
    // P12: sync push in-flight request envelope (durable, survives restart)
    async loadSyncPushInflight() {
      return readMetaValue('sync_push_inflight_v1', null)
    },
    async saveSyncPushInflight(envelope) {
      await writeMetaValue('sync_push_inflight_v1', envelope)
    },
    async clearSyncPushInflight() {
      const db = await ensureConnection()
      await db.run("DELETE FROM app_meta WHERE key = 'sync_push_inflight_v1'", [])
    },
    // P13: sync pull context binding (durable, survives restart & logout)
    async loadSyncPullBinding() {
      return readMetaValue('sync_pull_binding_v1', null)
    },
    async saveSyncPullBinding(binding) {
      await writeMetaValue('sync_pull_binding_v1', binding)
    },
    // P13: sync pull state/cursor (durable, survives restart & logout)
    async loadSyncPullState() {
      return readMetaValue('sync_pull_state_v1', null)
    },
    async saveSyncPullState(pullState) {
      await writeMetaValue('sync_pull_state_v1', pullState)
    },
    // P13: sync server versions metadata (durable, survives restart & logout)
    async loadSyncServerVersions() {
      return readMetaValue('sync_server_versions_v1', null)
    },
    async saveSyncServerVersions(versions) {
      await writeMetaValue('sync_server_versions_v1', versions)
    },
    // P14: sync bootstrap state (durable, survives restart & logout)
    async loadSyncBootstrapState() {
      return readMetaValue('sync_bootstrap_state_v1', null)
    },
    async saveSyncBootstrapState(state) {
      await writeMetaValue('sync_bootstrap_state_v1', state)
    },
    // P15: sync conflicts (durable, survives restart & logout)
    async loadSyncConflicts() {
      return readMetaValue('sync_conflicts_v1', null)
    },
    async saveSyncConflicts(conflictsState) {
      await writeMetaValue('sync_conflicts_v1', conflictsState)
    },
    async clearSyncConflicts() {
      const db = await ensureConnection()
      await db.run("DELETE FROM app_meta WHERE key = 'sync_conflicts_v1'", [])
    },
    // P19: sync activity log (durable local audit trail, max 100 entries, survives logout)
    async loadSyncActivityLog() {
      return readMetaValue('sync_activity_log_v1', null)
    },
    async saveSyncActivityLog(logState) {
      await writeMetaValue('sync_activity_log_v1', logState)
    },
    async clearSyncActivityLog() {
      const db = await ensureConnection()
      await db.run("DELETE FROM app_meta WHERE key = 'sync_activity_log_v1'", [])
    },
    // P20: sync auto settings (local device, context bound, default off)
    async loadSyncAutoSettings() {
      return readMetaValue('sync_auto_settings_v1', null)
    },
    async saveSyncAutoSettings(settings) {
      await writeMetaValue('sync_auto_settings_v1', settings)
    },
    async clearSyncAutoSettings() {
      const db = await ensureConnection()
      await db.run("DELETE FROM app_meta WHERE key = 'sync_auto_settings_v1'", [])
    },
    // P38: durable local operation journal. Written before the first
    // irreversible local mutation and cleared only after every domain store
    // and the outbox are durable, so a crash mid-operation is always
    // detectable and idempotently recoverable on the next start.
    async loadLocalOperationJournal() {
      return readMetaValue('local_operation_journal_v1', null)
    },
    async saveLocalOperationJournal(journal) {
      await writeMetaValue('local_operation_journal_v1', journal)
    },
    // PREM-M06B2: restore safety journal. It is separate from the P38 local
    // operation journal because destructive restore has a different lifecycle.
    async loadRestoreJournal() {
      return readMetaValue('restore_journal_v1', null)
    },
    async saveRestoreJournal(journal) {
      await writeMetaValue('restore_journal_v1', journal)
    },
    async clearRestoreJournal() {
      const db = await ensureConnection()
      await db.run("DELETE FROM app_meta WHERE key = 'restore_journal_v1'", [])
    },
    async applyRestoreSnapshotAtomic({ snapshot, hooks = null }) {
      return await withTransaction(async (db) => {
        await db.run('DELETE FROM business', [], false)
        await db.run(
          'INSERT INTO business (id, name, type, owner, phone, outlet, mode) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [
            1,
            snapshot.business.name,
            snapshot.business.type,
            snapshot.business.owner,
            snapshot.business.phone,
            snapshot.business.outlet,
            snapshot.business.mode,
          ],
          false,
        )

        await db.run('DELETE FROM products', [], false)
        await db.run('DELETE FROM categories', [], false)

        for (const category of snapshot.categories) {
          if (String(category) === RESERVED_CATEGORY) {
            continue
          }

          await db.run('INSERT INTO categories (name) VALUES (?)', [category], false)
        }

        for (const product of snapshot.products) {
          await db.run(
            `INSERT INTO products
              (id, name, category, sku, cost, price, stock, unit, min_stock,
               kind, pricing_unit, min_quantity, estimated_duration, image_data, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              String(product.id),
              product.name,
              product.category,
              product.sku ?? '',
              Number(product.cost ?? 0),
              Number(product.price),
              Number(product.stock),
              product.unit ?? 'pcs',
              Number(product.minStock ?? 0),
              product.kind ?? 'product',
              product.pricingUnit ?? 'pcs',
              Number(product.minQuantity ?? 0),
              product.estimatedDuration ?? '',
              product.imageData ?? '',
              product.isActive ? 1 : 0,
            ],
            false,
          )
        }

        await db.run('DELETE FROM customers', [], false)
        for (const customer of snapshot.customers) {
          await db.run(
            'INSERT INTO customers (id, name, phone, email) VALUES (?, ?, ?, ?)',
            [String(customer.id), customer.name, customer.phone, customer.email],
            false,
          )
        }

        await db.run('DELETE FROM expenses', [], false)
        for (const expense of snapshot.expenses) {
          await db.run(
            'INSERT INTO expenses (id, title, category, amount, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [
              String(expense.id),
              expense.title,
              expense.category,
              Number(expense.amount),
              expense.note,
              expense.createdAt,
            ],
            false,
          )
        }

        await db.run('DELETE FROM transactions', [], false)
        for (const transaction of snapshot.transactions) {
          await db.run(
            'INSERT INTO transactions (id, payload, created_at) VALUES (?, ?, ?)',
            [
              String(transaction.id),
              JSON.stringify(transaction),
              String(transaction.createdAt ?? '') || new Date().toISOString(),
            ],
            false,
          )
        }

        await db.run(
          'INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)',
          [APP_STATE_KEYS.tax, JSON.stringify(snapshot.taxSettings)],
          false,
        )
        await db.run(
          'INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)',
          [APP_STATE_KEYS.stockMovements, JSON.stringify(snapshot.stockMovements)],
          false,
        )
        await db.run(
          'INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)',
          [APP_STATE_KEYS.cash, JSON.stringify(snapshot.cash)],
          false,
        )
        await hooks?.afterDomainApply?.()

        if (snapshot.syncMetadata) {
          await db.run(
            'INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)',
            ['sync_identity_map', JSON.stringify(snapshot.syncMetadata.identityMap)],
            false,
          )
          await hooks?.afterIdentityMapApply?.()
          await db.run(
            'INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)',
            ['sync_server_versions_v1', JSON.stringify(snapshot.syncMetadata.serverVersions)],
            false,
          )
          await hooks?.afterServerVersionsApply?.()
        }

        return { ok: true }
      })
    },
    async persistSyncConflictsAndClearInflightAtomic({ expectedRequestId, conflictsState }) {
      return await withTransaction(async (db) => {
        const { values = [] } = await db.query('SELECT value FROM app_meta WHERE key = ? LIMIT 1', [
          'sync_push_inflight_v1',
        ])

        if (!values.length || !values[0].value) {
          return {
            ok: false,
            code: 'SYNC_CONFLICT_INFLIGHT_MISSING',
            message: 'In-flight sync push envelope is missing.',
          }
        }

        let inflight
        try {
          inflight = JSON.parse(values[0].value)
        } catch {
          return {
            ok: false,
            code: 'SYNC_CONFLICT_INFLIGHT_MISSING',
            message: 'In-flight sync push envelope is corrupted.',
          }
        }

        if (String(inflight.requestId) !== String(expectedRequestId)) {
          return {
            ok: false,
            code: 'SYNC_CONFLICT_INFLIGHT_MISMATCH',
            message: `In-flight requestId mismatch: expected ${expectedRequestId}, found ${inflight.requestId}`,
          }
        }

        await db.run(
          'INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)',
          ['sync_conflicts_v1', JSON.stringify(conflictsState)],
          false,
        )

        const deleteResult = await db.run(
          'DELETE FROM app_meta WHERE key = ?',
          ['sync_push_inflight_v1'],
          false,
        )

        const changes = deleteResult?.changes?.changes ?? 0
        if (Number(changes) !== 1) {
          throw new Error('Failed to delete in-flight envelope atomically.')
        }

        return {
          ok: true,
          code: 'SYNC_CONFLICT_PERSISTED',
        }
      })
    },
    async resolveSyncConflictUseServerAtomic({ queueSnapshot, conflictsState }) {
      if (!queueSnapshot || !queueSnapshot.id) {
        return {
          ok: false,
          code: 'SYNC_CONFLICT_QUEUE_MISSING',
          message: 'Queue snapshot is required for atomic useServer resolution.',
        }
      }

      return await withTransaction(async (db) => {
        const { values = [] } = await db.query(
          'SELECT id, updated_at, operation, payload FROM sync_queue WHERE id = ? LIMIT 1',
          [queueSnapshot.id],
        )

        if (!values.length) {
          return {
            ok: false,
            code: 'SYNC_CONFLICT_QUEUE_MISSING',
            message: 'Queue item is missing from sync_queue.',
          }
        }

        const existingRow = values[0]
        const snapPayloadStr =
          queueSnapshot.payload === null || queueSnapshot.payload === undefined
            ? null
            : JSON.stringify(queueSnapshot.payload)

        const isUnchanged =
          String(existingRow.updated_at) === String(queueSnapshot.updatedAt) &&
          String(existingRow.operation) === String(queueSnapshot.operation) &&
          (existingRow.payload === snapPayloadStr ||
            (existingRow.payload === null && snapPayloadStr === null))

        if (!isUnchanged) {
          return {
            ok: false,
            code: 'SYNC_CONFLICT_LOCAL_CHANGED',
            message: 'Local queue item has changed since conflict was recorded.',
          }
        }

        await db.run(
          `DELETE FROM sync_queue
           WHERE id = ?
             AND updated_at = ?
             AND operation = ?
             AND ((payload IS NULL AND ? IS NULL) OR payload = ?)`,
          [
            queueSnapshot.id,
            queueSnapshot.updatedAt,
            queueSnapshot.operation,
            snapPayloadStr,
            snapPayloadStr,
          ],
          false,
        )

        await db.run(
          'INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)',
          ['sync_conflicts_v1', JSON.stringify(conflictsState)],
          false,
        )

        return {
          ok: true,
          code: 'SYNC_CONFLICT_RESOLVED',
        }
      })
    },
    async close() {
      if (!rawConnection) {
        return
      }

      // Let any queued writer finish before the connection is closed so a
      // transaction is never torn down mid-flight.
      await writerTail.catch(() => {})

      await rawConnection.close()

      if (sqliteConnection) {
        await sqliteConnection.closeConnection(database, false)
      }

      rawConnection = null
      dbConnection = null
    },
  }
}
