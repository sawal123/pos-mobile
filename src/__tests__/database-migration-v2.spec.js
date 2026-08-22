import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { applyMigrations } from '@/services/database/migrations'
import { DB_NAME, DB_VERSION, MIGRATIONS } from '@/services/database/schema'
import { createSQLiteAdapter } from '@/services/database/sqliteAdapter'

const { fakeDb, fakeUserVersion, addUpgradeStatementMock } = vi.hoisted(() => {
  const state = {
    userVersion: 0,
    targetVersion: 2,
    upgrades: [],
    executedUpgradeSql: [],
  }

  const fakeDb = {
    beginTransaction: vi.fn(async () => {}),
    commitTransaction: vi.fn(async () => {}),
    rollbackTransaction: vi.fn(async () => {}),
    run: vi.fn(async () => {}),
    query: vi.fn(async (sql) => {
      if (sql.includes('user_version')) {
        return { values: [{ user_version: state.userVersion }] }
      }

      return { values: [] }
    }),
    execute: vi.fn(async (sql) => {
      const match = /PRAGMA user_version = (\d+)/.exec(sql)

      if (match) {
        state.userVersion = Number(match[1])
      }
    }),
    isDBOpen: async () => ({ result: false }),
    open: vi.fn(async () => {
      // Simulate the native plugin upgrade flow: for every registered step
      // whose toVersion is within (currentVersion, targetVersion], run its
      // statements and set the schema version to that step.
      const sorted = [...state.upgrades].sort((a, b) => a.toVersion - b.toVersion)

      for (const step of sorted) {
        if (step.toVersion > state.userVersion && step.toVersion <= state.targetVersion) {
          for (const statement of step.statements) {
            state.executedUpgradeSql.push(statement)
          }

          state.userVersion = step.toVersion
        }
      }
    }),
    close: async () => {},
  }

  const addUpgradeStatementMock = vi.fn(async (database, upgrade) => {
    state.upgrades = upgrade
  })

  return { fakeDb, fakeUserVersion: state, addUpgradeStatementMock }
})

vi.mock('@capacitor-community/sqlite', () => {
  class SQLiteConnection {
    async addUpgradeStatement(database, upgrade) {
      return addUpgradeStatementMock(database, upgrade)
    }

    async checkConnectionsConsistency() {
      return { result: true }
    }

    async isConnection() {
      return { result: false }
    }

    async createConnection(database, encrypted, mode, version, readonly) {
      fakeUserVersion.targetVersion = version
      return fakeDb
    }

    async retrieveConnection() {
      return fakeDb
    }

    async closeConnection() {}
  }

  return {
    CapacitorSQLite: {},
    SQLiteConnection,
  }
})

function createFakeDbLike({ initialVersion = 1 } = {}) {
  let version = initialVersion
  const executed = []

  return {
    executed,
    async getVersion() {
      return version
    },
    async setVersion(nextVersion) {
      version = nextVersion
    },
    async execute(sql) {
      executed.push(sql)
    },
  }
}

function assertNoDrop(executed) {
  for (const sql of executed) {
    for (const table of ['business', 'products', 'customers', 'expenses', 'transactions']) {
      expect(sql).not.toMatch(new RegExp(`DROP TABLE\\s+${table}`, 'i'))
    }
  }
}

beforeEach(() => {
  fakeUserVersion.userVersion = 0
  fakeUserVersion.targetVersion = 2
  fakeUserVersion.upgrades = []
  fakeUserVersion.executedUpgradeSql = []
  fakeDb.query.mockClear()
  fakeDb.execute.mockClear()
  fakeDb.run.mockClear()
  fakeDb.open.mockClear()
  addUpgradeStatementMock.mockClear()
})

describe('P9 database migration v2', () => {
  it('DB_VERSION sekarang 2', () => {
    expect(DB_VERSION).toBe(2)
  })

  it('migrasi v2 mendefinisikan sync_queue', () => {
    const migration = MIGRATIONS[2]

    expect(migration).toBeTruthy()
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS sync_queue/)
    expect(migration).toMatch(/entity_type TEXT NOT NULL/)
    expect(migration).toMatch(/entity_id TEXT NOT NULL/)
    expect(migration).toMatch(/operation TEXT NOT NULL/)
    expect(migration).toMatch(/payload TEXT NULL/)
    expect(migration).toMatch(/attempt_count INTEGER NOT NULL DEFAULT 0/)
    expect(migration).toMatch(/last_error TEXT NULL/)
  })

  it('fresh memory DB menghasilkan schema v2', async () => {
    const adapter = createMemoryAdapter()

    expect(await adapter.getSchemaVersion()).toBe(0)

    await adapter.initialize()

    expect(await adapter.getSchemaVersion()).toBe(2)
  })

  it('existing v1 memory DB dapat upgrade ke v2', async () => {
    const adapter = createMemoryAdapter()

    await adapter.setSchemaVersion(1)
    await adapter.initialize()

    expect(await adapter.getSchemaVersion()).toBe(2)
  })

  it('fresh SQLite DB menghasilkan schema v2', async () => {
    const adapter = createSQLiteAdapter()

    await adapter.initialize()

    expect(await adapter.getSchemaVersion()).toBe(2)
  })

  it('existing v1 SQLite DB dapat upgrade ke v2', async () => {
    fakeUserVersion.userVersion = 1
    const adapter = createSQLiteAdapter()

    await adapter.initialize()

    expect(await adapter.getSchemaVersion()).toBe(2)
  })

  it('migration v2 membuat sync_queue di SQLite', async () => {
    const adapter = createSQLiteAdapter()

    await adapter.initialize()

    const executed = fakeUserVersion.executedUpgradeSql.join('\n')
    expect(executed).toMatch(/CREATE TABLE IF NOT EXISTS sync_queue/)
  })

  it('upgrade statement didaftarkan sebelum native database open', async () => {
    fakeUserVersion.userVersion = 1
    const adapter = createSQLiteAdapter()

    await adapter.initialize()

    const addUpgradeOrder = addUpgradeStatementMock.mock.invocationCallOrder[0]
    const openOrder = fakeDb.open.mock.invocationCallOrder[0]

    expect(addUpgradeOrder).toBeDefined()
    expect(openOrder).toBeDefined()
    expect(addUpgradeOrder).toBeLessThan(openOrder)
  })

  it('upgrade statement resmi terdaftar dengan toVersion 2 dan sync_queue', async () => {
    const adapter = createSQLiteAdapter()

    await adapter.initialize()

    expect(addUpgradeStatementMock).toHaveBeenCalled()
    const [registeredDatabase, upgrade] = addUpgradeStatementMock.mock.calls[0]
    expect(registeredDatabase).toBe(DB_NAME)

    const step = upgrade.find(({ toVersion }) => toVersion === 2)
    expect(step).toBeTruthy()
    expect(step.statements.join('\n')).toMatch(/CREATE TABLE IF NOT EXISTS sync_queue/)
    expect(step.statements.join('\n')).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_queue_entity/,
    )
  })

  it('upgrade list memiliki toVersion 1 (base schema) dan toVersion 2 (sync_queue)', async () => {
    const adapter = createSQLiteAdapter()

    await adapter.initialize()

    const [, upgrade] = addUpgradeStatementMock.mock.calls[0]
    expect(upgrade.map(({ toVersion }) => toVersion)).toEqual([1, 2])

    const v1 = upgrade.find(({ toVersion }) => toVersion === 1)
    expect(v1.statements.join('\n')).toMatch(/CREATE TABLE IF NOT EXISTS business/)
    expect(v1.statements.join('\n')).toMatch(/CREATE TABLE IF NOT EXISTS transactions/)

    const v2 = upgrade.find(({ toVersion }) => toVersion === 2)
    expect(v2.statements.join('\n')).toMatch(/CREATE TABLE IF NOT EXISTS sync_queue/)
  })

  it('fresh native v0 menjalankan upgrade v1 lalu v2 hingga version 2', async () => {
    fakeUserVersion.userVersion = 0
    const adapter = createSQLiteAdapter()

    await adapter.initialize()

    expect(await adapter.getSchemaVersion()).toBe(2)

    const executed = fakeUserVersion.executedUpgradeSql
    const v1Index = executed.findIndex((sql) => sql.includes('CREATE TABLE IF NOT EXISTS business'))
    const v2Index = executed.findIndex((sql) =>
      sql.includes('CREATE TABLE IF NOT EXISTS sync_queue'),
    )

    expect(v1Index).toBeGreaterThanOrEqual(0)
    expect(v2Index).toBeGreaterThanOrEqual(0)
    expect(v1Index).toBeLessThan(v2Index)
  })

  it('existing native v1 hanya menjalankan upgrade v2 (data P8 aman)', async () => {
    fakeUserVersion.userVersion = 1
    const adapter = createSQLiteAdapter()

    await adapter.initialize()

    expect(await adapter.getSchemaVersion()).toBe(2)

    const executed = fakeUserVersion.executedUpgradeSql
    expect(executed.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS sync_queue'))).toBe(true)
    expect(executed.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS business'))).toBe(false)
    expect(executed.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS products'))).toBe(false)
  })

  it('base schema P8 tersedia pada fresh install', async () => {
    const adapter = createSQLiteAdapter()

    await adapter.initialize()

    const executed = fakeUserVersion.executedUpgradeSql.join('\n')
    for (const table of [
      'app_meta',
      'business',
      'categories',
      'products',
      'customers',
      'expenses',
      'transactions',
      'app_state',
    ]) {
      expect(executed).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, 'i'))
    }
  })

  it('existing v2 reinitialize aman (native open tidak upgrade ulang)', async () => {
    fakeUserVersion.userVersion = 2
    const adapter = createSQLiteAdapter()

    await adapter.initialize()

    expect(await adapter.getSchemaVersion()).toBe(2)
    expect(fakeUserVersion.executedUpgradeSql).toEqual([])
  })

  it('upgrade statement v1->v2 tidak drop/delete data existing', async () => {
    const adapter = createSQLiteAdapter()

    await adapter.initialize()

    const [, upgrade] = addUpgradeStatementMock.mock.calls[0]
    const joined = upgrade.map(({ statements }) => statements.join('\n')).join('\n')

    for (const table of [
      'business',
      'categories',
      'products',
      'customers',
      'expenses',
      'transactions',
    ]) {
      expect(joined).not.toMatch(new RegExp(`DROP TABLE\\s+${table}`, 'i'))
      expect(joined).not.toMatch(new RegExp(`DELETE FROM\\s+${table}`, 'i'))
    }

    expect(joined).toMatch(/CREATE TABLE IF NOT EXISTS sync_queue/)
  })

  it('reinitialize SQLite v2 aman (tidak rusak)', async () => {
    const adapter = createSQLiteAdapter()

    await adapter.initialize()
    await adapter.initialize()

    expect(await adapter.getSchemaVersion()).toBe(2)
  })

  it('memory sync_queue siap dipakai setelah migrasi v2', async () => {
    const adapter = createMemoryAdapter()

    await adapter.initialize()
    await adapter.upsertSyncQueueItem({
      id: 'q-1',
      entityType: 'product',
      entityId: 'p-1',
      operation: 'upsert',
      payload: { name: 'Kopi' },
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:00.000Z',
      attemptCount: 0,
      lastError: null,
    })

    expect(await adapter.countSyncQueueItems()).toBe(1)
  })

  it('migration v1->v2 tidak drop business', async () => {
    const dbLike = createFakeDbLike({ initialVersion: 1 })

    await applyMigrations(dbLike, 2)

    assertNoDrop(dbLike.executed)
    expect(dbLike.executed.some((sql) => /DROP TABLE\s+business/i.test(sql))).toBe(false)
  })

  it('migration v1->v2 tidak drop products', async () => {
    const dbLike = createFakeDbLike({ initialVersion: 1 })

    await applyMigrations(dbLike, 2)

    expect(dbLike.executed.some((sql) => /DROP TABLE\s+products/i.test(sql))).toBe(false)
  })

  it('migration v1->v2 tidak drop customers', async () => {
    const dbLike = createFakeDbLike({ initialVersion: 1 })

    await applyMigrations(dbLike, 2)

    expect(dbLike.executed.some((sql) => /DROP TABLE\s+customers/i.test(sql))).toBe(false)
  })

  it('migration v1->v2 tidak drop expenses', async () => {
    const dbLike = createFakeDbLike({ initialVersion: 1 })

    await applyMigrations(dbLike, 2)

    expect(dbLike.executed.some((sql) => /DROP TABLE\s+expenses/i.test(sql))).toBe(false)
  })

  it('migration v1->v2 tidak drop transactions', async () => {
    const dbLike = createFakeDbLike({ initialVersion: 1 })

    await applyMigrations(dbLike, 2)

    expect(dbLike.executed.some((sql) => /DROP TABLE\s+transactions/i.test(sql))).toBe(false)
  })

  it('version > 2 ditolak (tidak downgrade) pada memory', async () => {
    const adapter = createMemoryAdapter()

    await adapter.setSchemaVersion(3)

    await expect(adapter.initialize()).rejects.toThrow(/future/i)
    expect(await adapter.getSchemaVersion()).toBe(3)
  })

  it('version > 2 ditolak (tidak downgrade) pada SQLite', async () => {
    fakeUserVersion.userVersion = 3
    const adapter = createSQLiteAdapter()

    await expect(adapter.initialize()).rejects.toThrow(/future/i)
  })

  it('applyMigrations fresh install menerapkan migration hingga v2', async () => {
    const dbLike = createFakeDbLike({ initialVersion: 0 })

    const result = await applyMigrations(dbLike, 2)

    expect(result.from).toBe(1)
    expect(result.to).toBe(2)
    expect(result.applied).toEqual([2])
    expect(dbLike.executed.some((sql) => sql.includes('sync_queue'))).toBe(true)
  })

  it('migration tidak dijalankan destruktif dua kali', async () => {
    const adapter = createMemoryAdapter()

    await adapter.initialize()
    await adapter.upsertSyncQueueItem({
      id: 'q-1',
      entityType: 'product',
      entityId: 'p-1',
      operation: 'upsert',
      payload: { name: 'Kopi' },
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:00.000Z',
      attemptCount: 0,
      lastError: null,
    })

    await adapter.initialize()

    expect(await adapter.getSchemaVersion()).toBe(2)
    expect(await adapter.countSyncQueueItems()).toBe(1)
  })
})
