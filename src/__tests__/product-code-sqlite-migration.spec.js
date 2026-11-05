// @vitest-environment node
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { CREATE_TABLE_STATEMENTS, DB_VERSION, MIGRATIONS } from '@/services/database/schema'

describe('barcode SQLite migration', () => {
  it('upgrades existing products without changing their SKU and stores codes as text', () => {
    const database = new DatabaseSync(':memory:')
    try {
      database.exec(CREATE_TABLE_STATEMENTS)
      for (let version = 2; version < DB_VERSION; version++) database.exec(MIGRATIONS[version])
      database.exec(
        "INSERT INTO products (id, name, category, price, stock, is_active, sku) VALUES ('p1', 'Beras', 'Produk', 65000, 12, 1, 'BRS-01')",
      )
      database.exec(MIGRATIONS[DB_VERSION])
      expect(database.prepare('SELECT sku, barcode FROM products').get()).toMatchObject({
        sku: 'BRS-01',
        barcode: '',
      })
      database.prepare('UPDATE products SET barcode = ? WHERE id = ?').run('0012345678905', 'p1')
      expect(
        database.prepare('SELECT barcode, typeof(barcode) AS storage_type FROM products').get(),
      ).toMatchObject({ barcode: '0012345678905', storage_type: 'text' })
    } finally {
      database.close()
    }
  })
})
