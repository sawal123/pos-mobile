import {
  APP_META_KEYS,
  APP_STATE_KEYS,
  CREATE_TABLE_STATEMENTS,
  DB_NAME,
  DB_VERSION,
  RESERVED_CATEGORY,
} from './schema'
import { applyMigrations } from './migrations'

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
  let dbConnection = null

  async function ensureConnection() {
    if (dbConnection) {
      return dbConnection
    }

    const { CapacitorSQLite, SQLiteConnection } = await import('@capacitor-community/sqlite')

    if (!sqliteConnection) {
      sqliteConnection = new SQLiteConnection(CapacitorSQLite)
    }

    const consistency = await sqliteConnection.checkConnectionsConsistency()
    const existingConnection = await sqliteConnection.isConnection(database, false)

    if (consistency.result && existingConnection.result) {
      dbConnection = await sqliteConnection.retrieveConnection(database, false)
    } else {
      dbConnection = await sqliteConnection.createConnection(
        database,
        false,
        'no-encryption',
        version,
        false,
      )
    }

    const isOpen = await dbConnection.isDBOpen()

    if (!isOpen.result) {
      await dbConnection.open()
    }

    return dbConnection
  }

  async function withTransaction(work) {
    const db = await ensureConnection()
    await db.beginTransaction()

    try {
      const result = await work(db)
      await db.commitTransaction()
      return result
    } catch (error) {
      try {
        await db.rollbackTransaction()
      } catch (rollbackError) {
        console.error('Failed to rollback SQLite transaction.', rollbackError)
      }

      throw error
    }
  }

  async function readMetaValue(key, fallback = null) {
    const db = await ensureConnection()
    const { values = [] } = await db.query('SELECT value FROM app_meta WHERE key = ? LIMIT 1', [key])

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
    const { values = [] } = await db.query('SELECT value FROM app_state WHERE key = ? LIMIT 1', [key])

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
    async loadProducts() {
      const db = await ensureConnection()
      const [{ values: categoryRows = [] }, { values: productRows = [] }] = await Promise.all([
        db.query('SELECT name FROM categories ORDER BY name ASC'),
        db.query(
          'SELECT id, name, category, price, stock, is_active FROM products ORDER BY rowid ASC',
        ),
      ])

      return {
        categories: categoryRows.map((row) => row.name),
        products: productRows.map((row) => ({
          id: row.id,
          name: row.name,
          category: row.category,
          price: Number(row.price),
          stock: Number(row.stock),
          isActive: Boolean(row.is_active),
        })),
      }
    },
    async saveProducts(products, categories) {
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
            'INSERT INTO products (id, name, category, price, stock, is_active) VALUES (?, ?, ?, ?, ?, ?)',
            [
              String(product.id),
              product.name,
              product.category,
              Number(product.price),
              Number(product.stock),
              product.isActive ? 1 : 0,
            ],
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
    async loadShiftState() {
      return readAppState(APP_STATE_KEYS.shift, null)
    },
    async saveShiftState(state) {
      await writeAppState(APP_STATE_KEYS.shift, state)
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
    async listSyncQueueItems({ limit = 100 } = {}) {
      const db = await ensureConnection()
      const { values = [] } = await db.query(
        `SELECT id, entity_type, entity_id, operation, payload, created_at, updated_at, attempt_count, last_error
         FROM sync_queue
         ORDER BY created_at ASC, rowid ASC
         LIMIT ?`,
        [Number(limit)],
      )

      return values.map((row) => ({
        id: row.id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        operation: row.operation,
        payload:
          row.payload === null || row.payload === undefined ? null : JSON.parse(row.payload),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        attemptCount: Number(row.attempt_count),
        lastError: row.last_error,
      }))
    },
    async countSyncQueueItems() {
      const db = await ensureConnection()
      const { values = [] } = await db.query('SELECT COUNT(*) AS total FROM sync_queue')
      return Number(values[0]?.total ?? 0)
    },
    async markSyncQueueItemFailed(id, error) {
      const db = await ensureConnection()
      await db.run(
        'UPDATE sync_queue SET attempt_count = attempt_count + 1, last_error = ? WHERE id = ?',
        [error, id],
      )
    },
    async deleteSyncQueueItem(id) {
      const db = await ensureConnection()
      await db.run('DELETE FROM sync_queue WHERE id = ?', [id])
    },
    async close() {
      if (!dbConnection) {
        return
      }

      await dbConnection.close()

      if (sqliteConnection) {
        await sqliteConnection.closeConnection(database, false)
      }

      dbConnection = null
    },
  }
}
