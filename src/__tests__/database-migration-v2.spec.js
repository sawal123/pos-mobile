import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { applyMigrations } from '@/services/database/migrations'
import { DB_VERSION, MIGRATIONS } from '@/services/database/schema'
import { createSQLiteAdapter } from '@/services/database/sqliteAdapter'

const { fakeDb, fakeUserVersion } = vi.hoisted(() => {
  const state = { userVersion: 0 }

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
    isDBOpen: async () => ({ result: true }),
    open: async () => {},
    close: async () => {},
  }

  return { fakeDb, fakeUserVersion: state }
})

vi.mock('@capacitor-community/sqlite', () => {
  class SQLiteConnection {
    async checkConnectionsConsistency() {
      return { result: true }
    }

    async isConnection() {
      return { result: false }
    }

    async createConnection() {
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
  fakeDb.query.mockClear()
  fakeDb.execute.mockClear()
  fakeDb.run.mockClear()
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

    const executed = fakeDb.execute.mock.calls.map(([sql]) => sql).join('\n')
    expect(executed).toMatch(/CREATE TABLE IF NOT EXISTS sync_queue/)
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
