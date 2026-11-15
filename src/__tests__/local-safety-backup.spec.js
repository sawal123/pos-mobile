/**
 * Pengaman data lokal: snapshot sebelum operasi destruktif ("Muat ulang dari
 * Cloud" / "Hapus Cache") dan pemulihannya bila pemuatan Cloud gagal.
 *
 * Regresi yang dijaga: dulu tombol tersebut menghapus data lebih dulu lalu
 * menarik dari Cloud; satu kegagalan membuat seluruh riwayat pengguna hilang.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import {
  SAFETY_BACKUP_STORAGE_KEY,
  captureLocalSafetyBackup,
  clearLocalSafetyBackup,
  hasRestorableData,
  peekLocalSafetyBackup,
  restoreLocalSafetyBackup,
} from '@/services/localSafetyBackup'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { useCashStore } from '@/stores/cashStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useProductStore } from '@/stores/productStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useTransactionStore } from '@/stores/transactionStore'

let pinia
let adapter

async function seedData() {
  await adapter.saveProducts(
    [{ id: 'p1', name: 'Kopi Susu', price: 15000 }],
    ['Minuman'],
    [{ id: 'sm1', productId: 'p1', quantity: 2 }],
  )
  await adapter.saveCustomers([{ id: 'c1', name: 'Budi' }])
  await adapter.saveExpenses([{ id: 'e1', amount: 5000 }])
  await adapter.saveTransactions([{ id: 't1', total: 15000 }])
  await adapter.saveCashState({ entries: [{ id: 'cash1', amount: 15000 }] })
  await adapter.saveShiftState({ id: 's1', isOpen: true, openingBalance: 100000, status: 'open' })
  await adapter.saveSyncPushBinding({ businessId: 10, boundAt: new Date().toISOString() })
  await adapter.saveSyncPullBinding({
    businessId: 10,
    outletId: 101,
    deviceIdentifier: 'dev-1',
    registeredDeviceId: 55,
    boundAt: new Date().toISOString(),
    mode: 'cloud_first_read',
    status: 'completed',
  })
}

beforeEach(async () => {
  pinia = createPinia()
  setActivePinia(pinia)

  adapter = createMemoryAdapter()
  await adapter.initialize()

  clearLocalSafetyBackup()
})

describe('hasRestorableData', () => {
  it('rejects empty snapshots', () => {
    expect(hasRestorableData(null)).toBe(false)
    expect(hasRestorableData({})).toBe(false)
    expect(hasRestorableData({ products: [], transactions: [], customers: [] })).toBe(false)
  })

  it('accepts a snapshot with any tenant data', () => {
    expect(hasRestorableData({ products: [{ id: 'p1' }] })).toBe(true)
    expect(hasRestorableData({ cashState: { entries: [{ id: 'c1' }] } })).toBe(true)
    expect(hasRestorableData({ shiftState: { id: 's1', isOpen: true } })).toBe(true)
  })
})

describe('capture → restore round trip', () => {
  it('captures every table that clearLocalCache deletes', async () => {
    await seedData()

    const snapshot = await captureLocalSafetyBackup({ adapter })

    expect(snapshot.products).toHaveLength(1)
    expect(snapshot.categories).toEqual(['Minuman'])
    expect(snapshot.stockMovements).toHaveLength(1)
    expect(snapshot.customers).toHaveLength(1)
    expect(snapshot.expenses).toHaveLength(1)
    expect(snapshot.transactions).toHaveLength(1)
    expect(snapshot.cashState.entries).toHaveLength(1)
    expect(snapshot.shiftState.id).toBe('s1')
    expect(snapshot.syncPushBinding.businessId).toBe(10)
    expect(snapshot.syncPullBinding.status).toBe('completed')
    expect(peekLocalSafetyBackup()).toBe(snapshot)
  })

  it('restores data and Pinia stores after a failed Cloud reload', async () => {
    await seedData()
    const snapshot = await captureLocalSafetyBackup({ adapter })

    // Emulate clearLocalCache(): everything is wiped.
    await adapter.saveProducts([], [], [])
    await adapter.saveCustomers([])
    await adapter.saveExpenses([])
    await adapter.saveTransactions([])
    await adapter.saveCashState({ entries: [] })
    await adapter.saveShiftState(null)
    await adapter.saveSyncPushBinding(null)
    await adapter.saveSyncPullBinding(null)

    const result = await restoreLocalSafetyBackup(snapshot, { adapter, pinia })
    expect(result).toEqual({ ok: true, restored: true })

    expect((await adapter.loadProducts()).products).toHaveLength(1)
    expect(await adapter.loadCustomers()).toHaveLength(1)
    expect(await adapter.loadTransactions()).toHaveLength(1)
    expect((await adapter.loadCashState()).entries).toHaveLength(1)
    expect((await adapter.loadShiftState()).id).toBe('s1')
    expect((await adapter.loadSyncPushBinding()).businessId).toBe(10)
    expect((await adapter.loadSyncPullBinding()).status).toBe('completed')

    expect(useProductStore(pinia).products).toHaveLength(1)
    expect(useCustomerStore(pinia).customers).toHaveLength(1)
    expect(useTransactionStore(pinia).items).toHaveLength(1)
    expect(useCashStore(pinia).entries).toHaveLength(1)
    expect(useShiftStore(pinia).isOpen).toBe(true)
  })

  it('reports an empty snapshot instead of pretending to restore', async () => {
    const snapshot = await captureLocalSafetyBackup({ adapter })
    expect(snapshot).not.toBeNull()

    const result = await restoreLocalSafetyBackup(snapshot, { adapter })
    expect(result.restored).toBe(false)
    expect(result.reason).toBe('EMPTY_SNAPSHOT')
  })

  it('writes a localStorage mirror and clears it after success', async () => {
    await seedData()
    await captureLocalSafetyBackup({ adapter })

    expect(localStorage.getItem(SAFETY_BACKUP_STORAGE_KEY)).toBeTruthy()

    clearLocalSafetyBackup()

    expect(localStorage.getItem(SAFETY_BACKUP_STORAGE_KEY)).toBeNull()
  })
})
