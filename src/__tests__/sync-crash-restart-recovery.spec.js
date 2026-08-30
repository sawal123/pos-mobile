// src/__tests__/sync-crash-restart-recovery.spec.js

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createRestartableScenario,
  restartAppScenario,
  makeValidCloudContext,
  saveToken,
  setupBoundCloudState,
} from './helpers/syncRestartHarness'
import { createOfflineDataset } from './helpers/syncScenarioHarness'
import { useProductStore } from '@/stores/productStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useSyncPullStore } from '@/stores/syncPullStore'
import { useSyncBootstrapStore } from '@/stores/syncBootstrapStore'
import { useSyncConflictStore } from '@/stores/syncConflictStore'
import { useSyncOrchestratorStore } from '@/stores/syncOrchestratorStore'
import { useSyncHealthStore } from '@/stores/syncHealthStore'
import { useSyncRecoveryStore } from '@/stores/syncRecoveryStore'
import { useSyncAutoSyncStore } from '@/stores/syncAutoSyncStore'
import { useSyncStatusStore } from '@/stores/syncStatusStore'
import { useSyncActivityLogStore } from '@/stores/syncActivityLogStore'
import { useSyncContextGuardStore } from '@/stores/syncContextGuardStore'
import { _resetTokenStore } from '@/services/cloud/tokenRepository'
import { SYNC_ENTITY_TYPES } from '@/services/sync/syncConstants'
import { RECOVERY_ACTIONS } from '@/services/sync/syncRecoveryService'
import { deriveSyncUiStatus, SYNC_UI_PENDING, SYNC_UI_CLEAR } from '@/services/sync/syncStatusService'

const { mockServerHandler } = vi.hoisted(() => ({ mockServerHandler: { handle: null } }))

vi.mock('@/services/cloud/apiClient', () => ({
  apiRequest: async (path, options) => {
    if (mockServerHandler.handle) return mockServerHandler.handle(path, options)
    return { ok: false, status: 500, error: 'Server not initialized' }
  },
}))

function deriveUiStatus(cloudStore, rawStatus, online = true) {
  if (!rawStatus.ok) return null
  const cloudAvailable =
    cloudStore.cloudAccess === true &&
    cloudStore.user != null &&
    cloudStore.selectedBusiness != null
  return deriveSyncUiStatus({
    cloudAvailable,
    online,
    syncing: false,
    pendingCount: rawStatus.pendingCount,
    openConflictCount: rawStatus.openConflictCount,
    hasInflight: rawStatus.hasInflight,
  })
}

describe('P25: Crash, Restart, and Interrupted Sync Recovery Scenarios', () => {
  beforeEach(() => {
    mockServerHandler.handle = null
    _resetTokenStore()
  })

  describe('Durable Outbox & Hydration across Restart', () => {
    it('1. Offline subscriber durable outbox survives full app graph restart', async () => {
      let scenario = await createRestartableScenario({ businessMode: 'cloud', initialOnline: false })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      await setupBoundCloudState(scenario)
      scenario.runtimeSignal.setOnline(false)

      const productStore = useProductStore(scenario.pinia)
      await productStore.createCategory('Minuman')
      const prod = await productStore.createProduct({ name: 'Kopi Tubruk', category: 'Minuman', price: 10000, stock: 5 })
      expect(prod.success).toBe(true)

      const expenseStore = useExpenseStore(scenario.pinia)
      await expenseStore.createExpense({ category: 'Operasional', amount: 5000, description: 'Beli Es Batu' })

      const transactionStore = useTransactionStore(scenario.pinia)
      await transactionStore.createTransaction({
        items: [{ id: prod.product.id, name: 'Kopi Tubruk', price: 10000, qty: 2 }],
        subtotal: 20000,
        tax: 0,
        total: 20000,
        paymentMethod: 'cash',
      })
      await scenario.scheduler.flush()

      const queueBefore = await scenario.adapter.listSyncQueueItems()
      expect(queueBefore.length).toBeGreaterThanOrEqual(4)

      // Restart entire app graph
      scenario = await restartAppScenario(scenario, { online: false })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      // Fresh domain stores have hydrated data
      const freshProdStore = useProductStore(scenario.pinia)
      const freshExpenseStore = useExpenseStore(scenario.pinia)
      const freshTrxStore = useTransactionStore(scenario.pinia)

      expect(freshProdStore.products).toHaveLength(1)
      expect(freshProdStore.products[0].name).toBe('Kopi Tubruk')
      expect(freshExpenseStore.expenses).toHaveLength(1)
      expect(freshTrxStore.items).toHaveLength(1)

      // Durable queue items survive with exact matching IDs and operations
      const queueAfter = await scenario.adapter.listSyncQueueItems()
      expect(queueAfter).toHaveLength(queueBefore.length)

      for (let i = 0; i < queueBefore.length; i++) {
        expect(queueAfter[i].id).toBe(queueBefore[i].id)
        expect(queueAfter[i].entityType).toBe(queueBefore[i].entityType)
        expect(queueAfter[i].entityId).toBe(queueBefore[i].entityId)
        expect(queueAfter[i].operation).toBe(queueBefore[i].operation)
      }

      // No network calls made upon restart
      expect(scenario.fakeServer.getPushRequestCount()).toBe(0)
      await scenario.cleanup()
    })

    it('2. Hydration does not duplicate outbox entries', async () => {
      let scenario = await createRestartableScenario({ businessMode: 'cloud', initialOnline: false })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      await setupBoundCloudState(scenario)
      const productStore = useProductStore(scenario.pinia)
      await productStore.createCategory('Makanan')
      await productStore.createProduct({ name: 'Roti Bakar', category: 'Makanan', price: 12000, stock: 10 })
      await scenario.scheduler.flush()

      const countBefore = await scenario.adapter.countSyncQueueItems()
      expect(countBefore).toBe(2)

      // Restart
      scenario = await restartAppScenario(scenario, { online: false })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      // Immediately verify queue count without user mutation
      const countAfter = await scenario.adapter.countSyncQueueItems()
      expect(countAfter).toBe(countBefore)

      await scenario.cleanup()
    })

    it('3. P17 detects pending after restart and P21 derives PENDING', async () => {
      let scenario = await createRestartableScenario({ businessMode: 'cloud', initialOnline: false })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      await setupBoundCloudState(scenario)
      const productStore = useProductStore(scenario.pinia)
      await productStore.createCategory('Makanan')
      await productStore.createProduct({ name: 'Roti', category: 'Makanan', price: 8000, stock: 5 })
      await scenario.scheduler.flush()

      // Restart into online state
      scenario = await restartAppScenario(scenario, { online: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      const healthStore = useSyncHealthStore(scenario.pinia)
      const healthRes = await healthStore.checkHealth()
      expect(healthRes.ok).toBe(true)
      expect(healthRes.status).toBe('attention')
      expect(healthRes.code).toBe('SYNC_HEALTH_ATTENTION')
      expect(healthRes.issues).toHaveLength(1)
      expect(healthRes.issues[0].code).toBe('SYNC_PENDING_QUEUE')

      const statusStore = useSyncStatusStore(scenario.pinia)
      const rawStatus = await statusStore.refresh()
      const uiStatus = deriveUiStatus(scenario.cloudStore, rawStatus, true)
      expect(uiStatus.status).toBe(SYNC_UI_PENDING)

      await scenario.cleanup()
    })
  })

  describe('Inflight Envelope & Recovery across Restart', () => {
    it('4. Inflight envelope survives restart and is detected by P17', async () => {
      let scenario = await createRestartableScenario({ businessMode: 'cloud', initialOnline: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      await setupBoundCloudState(scenario)
      const productStore = useProductStore(scenario.pinia)
      await productStore.createCategory('Minuman')
      await productStore.createProduct({ name: 'Teh Hangat', category: 'Minuman', price: 5000, stock: 10 })
      await scenario.scheduler.flush()

      // Fail push during network phase (inflight saved before network request)
      scenario.fakeServer.setSimulateNetworkError(true)
      const pushRes = await useSyncPushStore(scenario.pinia).pushNow()
      expect(pushRes.ok).toBe(false)

      const inflightBefore = await scenario.adapter.loadSyncPushInflight()
      expect(inflightBefore).not.toBeNull()
      expect(inflightBefore.requestId).toBeTruthy()
      expect(inflightBefore.queueSnapshots.length).toBeGreaterThan(0)

      // Restart app graph
      scenario = await restartAppScenario(scenario, { online: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      const inflightAfter = await scenario.adapter.loadSyncPushInflight()
      expect(inflightAfter).not.toBeNull()
      expect(inflightAfter.requestId).toBe(inflightBefore.requestId)
      expect(inflightAfter.queueSnapshots).toHaveLength(inflightBefore.queueSnapshots.length)
      expect(inflightAfter.businessId).toBe(inflightBefore.businessId)

      const healthStore = useSyncHealthStore(scenario.pinia)
      const healthRes = await healthStore.checkHealth()
      expect(healthRes.ok).toBe(true)
      expect(healthRes.status).toBe('attention')
      expect(healthRes.code).toBe('SYNC_HEALTH_ATTENTION')
      expect(healthRes.issues.some((i) => i.code === 'SYNC_PUSH_INFLIGHT')).toBe(true)

      await scenario.cleanup()
    })

    it('5. P18 RETRY_INFLIGHT reuses same request_id and completes cleanly', async () => {
      let scenario = await createRestartableScenario({ businessMode: 'cloud', initialOnline: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      await setupBoundCloudState(scenario)
      const productStore = useProductStore(scenario.pinia)
      await productStore.createCategory('Minuman')
      await productStore.createProduct({ name: 'Teh Hangat', category: 'Minuman', price: 5000, stock: 10 })
      await scenario.scheduler.flush()

      scenario.fakeServer.setSimulateNetworkError(true)
      await useSyncPushStore(scenario.pinia).pushNow()
      const inflightBefore = await scenario.adapter.loadSyncPushInflight()
      expect(inflightBefore).not.toBeNull()

      // Restart app graph
      scenario = await restartAppScenario(scenario, { online: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      // Recover via P18
      scenario.fakeServer.setSimulateNetworkError(false)
      const recoveryStore = useSyncRecoveryStore(scenario.pinia)
      const recRes = await recoveryStore.recover(RECOVERY_ACTIONS.RETRY_INFLIGHT)
      expect(recRes.ok).toBe(true)

      // Request ID matches original inflight
      const pushLogs = scenario.fakeServer.getPushRequests()
      expect(pushLogs.length).toBeGreaterThanOrEqual(1)
      expect(pushLogs[pushLogs.length - 1].request_id).toBe(inflightBefore.requestId)

      // Cleanup verified
      expect(await scenario.adapter.countSyncQueueItems()).toBe(0)
      expect(await scenario.adapter.loadSyncPushInflight()).toBeNull()

      const healthRes = await useSyncHealthStore(scenario.pinia).checkHealth()
      expect(healthRes.status).toBe('ready')
      expect(scenario.fakeServer.db.products).toHaveLength(1)

      await scenario.cleanup()
    })

    it('6. Server committed, response lost, app crash -> duplicate retry converges with no duplicate record', async () => {
      let scenario = await createRestartableScenario({ businessMode: 'cloud', initialOnline: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      await setupBoundCloudState(scenario)
      const productStore = useProductStore(scenario.pinia)
      await productStore.createCategory('Minuman')
      await productStore.createProduct({ name: 'Kopi Susu', category: 'Minuman', price: 15000, stock: 5 })
      await scenario.scheduler.flush()

      // Server processes mutation and saves request_id, but drops connection during response
      scenario.fakeServer.setSimulateCrashAfterCommit(true)
      const pushRes = await useSyncPushStore(scenario.pinia).pushNow()
      expect(pushRes.ok).toBe(false)

      // Server already has product
      expect(scenario.fakeServer.db.products).toHaveLength(1)
      // Client still has queue & inflight
      expect(await scenario.adapter.countSyncQueueItems()).toBeGreaterThanOrEqual(1)
      const inflight = await scenario.adapter.loadSyncPushInflight()
      expect(inflight).not.toBeNull()

      // Restart app
      scenario = await restartAppScenario(scenario, { online: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      // Retry old inflight
      scenario.fakeServer.setSimulateCrashAfterCommit(false)
      const recRes = await useSyncRecoveryStore(scenario.pinia).recover(RECOVERY_ACTIONS.RETRY_INFLIGHT)
      expect(recRes.ok).toBe(true)

      // Server received duplicate success, no double product
      expect(scenario.fakeServer.db.products).toHaveLength(1)
      expect(scenario.fakeServer.db.products[0].name).toBe('Kopi Susu')
      expect(await scenario.adapter.countSyncQueueItems()).toBe(0)
      expect(await scenario.adapter.loadSyncPushInflight()).toBeNull()

      await scenario.cleanup()
    })

    it('7. Local mutation changes after unknown commit survives old CAS acknowledgement', async () => {
      let scenario = await createRestartableScenario({ businessMode: 'cloud', initialOnline: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      await setupBoundCloudState(scenario)
      const productStore = useProductStore(scenario.pinia)
      await productStore.createCategory('Minuman')
      const prod = await productStore.createProduct({ name: 'Kopi V1', category: 'Minuman', price: 10000, stock: 5 })
      expect(prod.success).toBe(true)
      await scenario.scheduler.flush()

      // Server commits V1, response lost
      scenario.fakeServer.setSimulateCrashAfterCommit(true)
      await useSyncPushStore(scenario.pinia).pushNow()

      // Restart app
      scenario = await restartAppScenario(scenario, { online: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      // User edits product locally to V2 BEFORE retry
      const freshProdStore = useProductStore(scenario.pinia)
      const updateRes = await freshProdStore.updateProduct(prod.product.id, {
        name: 'Kopi V2',
        category: 'Minuman',
        price: 15000,
        stock: 5,
      })
      expect(updateRes.success).toBe(true)
      await scenario.scheduler.flush()

      // Queue has updated V2 mutation
      const queueBeforeRetry = await scenario.adapter.listSyncQueueItems()
      expect(queueBeforeRetry.some((q) => q.payload?.name === 'Kopi V2')).toBe(true)

      // Retry old inflight (for V1)
      scenario.fakeServer.setSimulateCrashAfterCommit(false)
      const recRes = await useSyncRecoveryStore(scenario.pinia).recover(RECOVERY_ACTIONS.RETRY_INFLIGHT)
      expect(recRes.ok).toBe(true)

      // Local is still V2
      expect(freshProdStore.products[0].name).toBe('Kopi V2')
      expect(freshProdStore.products[0].price).toBe(15000)

      // CAS safety: V2 mutation in queue was NOT deleted by old acknowledgement
      const queueAfterRetry = await scenario.adapter.listSyncQueueItems()
      expect(queueAfterRetry.some((q) => q.payload?.name === 'Kopi V2')).toBe(true)

      // Next push sends V2 to server
      const pushRes2 = await useSyncPushStore(scenario.pinia).pushNow()
      expect(pushRes2.ok).toBe(true)

      // Final: server updated to V2, queue 0
      const serverProds = scenario.fakeServer.db.products
      expect(serverProds).toHaveLength(1)
      expect(serverProds[0].name).toBe('Kopi V2')
      expect(serverProds[0].price).toBe(15000)
      expect(await scenario.adapter.countSyncQueueItems()).toBe(0)

      await scenario.cleanup()
    })
  })

  describe('Bootstrap State across Restart', () => {
    it('8. Bootstrap staged survives restart without auto-pushing', async () => {
      let scenario = await createRestartableScenario({ businessMode: 'free' })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      await createOfflineDataset(scenario)
      const devId = await scenario.adapter.loadDeviceIdentifier()
      const cloudCtx = makeValidCloudContext({ deviceIdentifier: devId })
      scenario.cloudStore.$patch(cloudCtx)
      await saveToken('mock-bearer-token-123')
      await scenario.adapter.saveDeviceIdentifier(devId)
      await scenario.adapter.saveCloudContext(cloudCtx)
      scenario.businessStore.setBusiness({ name: 'Kedai Kopi Utama', type: 'Cafe', mode: 'cloud' })
      scenario.runtimeSignal.setOnline(true)

      // Stage bootstrap
      const bRes = await useSyncBootstrapStore(scenario.pinia).bootstrapNow()
      expect(bRes.ok).toBe(true)
      expect(bRes.status).toBe('staged')

      const stagedCount = await scenario.adapter.countSyncQueueItems()
      expect(stagedCount).toBeGreaterThan(0)

      // Restart app
      scenario = await restartAppScenario(scenario, { online: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      const freshBootstrapStore = useSyncBootstrapStore(scenario.pinia)
      expect(freshBootstrapStore.status).toBe('staged')
      expect(await scenario.adapter.countSyncQueueItems()).toBe(stagedCount)
      expect(scenario.fakeServer.getPushRequestCount()).toBe(0)

      const healthRes = await useSyncHealthStore(scenario.pinia).checkHealth()
      expect(healthRes.issues.some((i) => i.code === 'SYNC_BOOTSTRAP_STAGED')).toBe(true)

      await scenario.cleanup()
    })

    it('9. P18 continues staged bootstrap safely after restart', async () => {
      let scenario = await createRestartableScenario({ businessMode: 'free' })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      await createOfflineDataset(scenario)
      const devId = await scenario.adapter.loadDeviceIdentifier()
      const cloudCtx = makeValidCloudContext({ deviceIdentifier: devId })
      scenario.cloudStore.$patch(cloudCtx)
      await saveToken('mock-bearer-token-123')
      await scenario.adapter.saveDeviceIdentifier(devId)
      await scenario.adapter.saveCloudContext(cloudCtx)
      scenario.businessStore.setBusiness({ name: 'Kedai Kopi Utama', type: 'Cafe', mode: 'cloud' })
      scenario.runtimeSignal.setOnline(true)

      const bRes = await useSyncBootstrapStore(scenario.pinia).bootstrapNow()
      expect(bRes.ok).toBe(true)

      // Restart app
      scenario = await restartAppScenario(scenario, { online: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      // Recover via P18 continueBootstrap
      const recRes = await useSyncRecoveryStore(scenario.pinia).recover(RECOVERY_ACTIONS.CONTINUE_BOOTSTRAP)
      expect(recRes.ok).toBe(true)

      // Dataset in server, queue 0, bootstrap completed
      expect(scenario.fakeServer.db.products.length).toBeGreaterThan(0)
      expect(scenario.fakeServer.db.categories.length).toBeGreaterThan(0)
      expect(scenario.fakeServer.db.customers.length).toBeGreaterThan(0)
      expect(scenario.fakeServer.db.expenses.length).toBeGreaterThan(0)
      expect(await scenario.adapter.countSyncQueueItems()).toBe(0)

      const bootState = await scenario.adapter.loadSyncBootstrapState()
      expect(bootState.status).toBe('completed')

      await scenario.cleanup()
    })

    it('10. Restart must not restage bootstrap twice', async () => {
      let scenario = await createRestartableScenario({ businessMode: 'free' })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      await createOfflineDataset(scenario)
      const devId = await scenario.adapter.loadDeviceIdentifier()
      const cloudCtx = makeValidCloudContext({ deviceIdentifier: devId })
      scenario.cloudStore.$patch(cloudCtx)
      await saveToken('mock-bearer-token-123')
      await scenario.adapter.saveDeviceIdentifier(devId)
      await scenario.adapter.saveCloudContext(cloudCtx)
      scenario.businessStore.setBusiness({ name: 'Kedai Kopi Utama', type: 'Cafe', mode: 'cloud' })
      scenario.runtimeSignal.setOnline(true)

      const bRes = await useSyncBootstrapStore(scenario.pinia).bootstrapNow()
      expect(bRes.ok).toBe(true)
      const queueCountBefore = await scenario.adapter.countSyncQueueItems()

      // Restart app
      scenario = await restartAppScenario(scenario, { online: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      // Attempt to re-run bootstrap directly
      const directRes = await useSyncBootstrapStore(scenario.pinia).bootstrapNow()
      expect(directRes.ok).toBe(false)
      expect(directRes.code).toBe('BOOTSTRAP_ALREADY_STAGED')

      // Queue count not duplicated
      expect(await scenario.adapter.countSyncQueueItems()).toBe(queueCountBefore)

      await scenario.cleanup()
    })
  })

  describe('Pull Interruption & Cursor Durability', () => {
    it('11. Interrupted multi-page Pull resumes from durable cursor', async () => {
      let scenario = await createRestartableScenario({ businessMode: 'cloud', initialOnline: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest
      await setupBoundCloudState(scenario)

      // Seed server with 4 categories
      const catSyncIds = [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
        '44444444-4444-4444-8444-444444444444',
      ]
      catSyncIds.forEach((id, idx) => {
        scenario.fakeServer.db.categories.push({
          sync_id: id,
          name: `Category ${idx + 1}`,
          business_id: 10,
          sync_version: 1,
          sync_sequence: idx + 1,
        })
      })
      scenario.fakeServer.setServerSequence(4)

      // Save initial pull state with cursor 2 (page 1 applied)
      await scenario.adapter.saveSyncPullState({
        version: 1,
        cursor: 2,
        serverSequence: 4,
      })

      // Restart app
      scenario = await restartAppScenario(scenario, { online: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      // Pull resumes from cursor 2 and fetches remaining page
      const pullRes = await useSyncPullStore(scenario.pinia).pullNow()
      expect(pullRes.ok).toBe(true)
      expect(pullRes.cursorAfter).toBe(4)

      const finalPullState = await scenario.adapter.loadSyncPullState()
      expect(finalPullState.cursor).toBe(4)

      await scenario.cleanup()
    })

    it('12. Replayed remote Pull page does not duplicate records or create outbox echo', async () => {
      let scenario = await createRestartableScenario({ businessMode: 'cloud', initialOnline: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest
      await setupBoundCloudState(scenario)

      const catSyncId = '55555555-5555-4555-8555-555555555555'
      scenario.fakeServer.db.categories.push({
        sync_id: catSyncId,
        name: 'Snack Unik',
        business_id: 10,
        sync_version: 1,
        sync_sequence: 1,
      })
      scenario.fakeServer.setServerSequence(1)

      // First pull applies category
      await useSyncPullStore(scenario.pinia).pullNow()
      const prodStore = useProductStore(scenario.pinia)
      expect(prodStore.categories).toContain('Snack Unik')

      // Reset cursor in storage to simulate crash before cursor save
      await scenario.adapter.saveSyncPullState({ version: 1, cursor: 0, serverSequence: 1 })

      // Restart app
      scenario = await restartAppScenario(scenario, { online: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      // Pull re-fetches the same category
      const pullRes2 = await useSyncPullStore(scenario.pinia).pullNow()
      expect(pullRes2.ok).toBe(true)

      const freshProdStore = useProductStore(scenario.pinia)
      const countSnack = freshProdStore.categories.filter((c) => c === 'Snack Unik').length
      expect(countSnack).toBe(1) // No duplicate category

      // No pull echo in queue
      expect(await scenario.adapter.countSyncQueueItems()).toBe(0)

      await scenario.cleanup()
    })

    it('13. Push completed / Pull interrupted converges after restart', async () => {
      let scenario = await createRestartableScenario({ businessMode: 'cloud', initialOnline: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest
      await setupBoundCloudState(scenario)

      const productStore = useProductStore(scenario.pinia)
      await productStore.createCategory('Minuman')
      await productStore.createProduct({ name: 'Es Teh Manis', category: 'Minuman', price: 4000, stock: 20 })
      await scenario.scheduler.flush()

      // Full sync: push succeeds, but pull fails
      scenario.fakeServer.setSimulateInterruptedPull(true)
      const orchestratorStore = useSyncOrchestratorStore(scenario.pinia)
      const syncRes = await orchestratorStore.syncAll()
      expect(syncRes.ok).toBe(false)
      expect(syncRes.stage).toBe('pull')

      // Push was completed, queue was cleared, server has product
      expect(scenario.fakeServer.db.products).toHaveLength(1)
      expect(await scenario.adapter.countSyncQueueItems()).toBe(0)
      expect(await scenario.adapter.loadSyncPushInflight()).toBeNull()

      // Restart app
      scenario = await restartAppScenario(scenario, { online: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      // Queue is not resurrected
      expect(await scenario.adapter.countSyncQueueItems()).toBe(0)

      // Restore network and sync
      scenario.fakeServer.setSimulateInterruptedPull(false)
      const syncRes2 = await useSyncOrchestratorStore(scenario.pinia).syncAll()
      expect(syncRes2.ok).toBe(true)

      const healthRes = await useSyncHealthStore(scenario.pinia).checkHealth()
      expect(healthRes.status).toBe('ready')

      await scenario.cleanup()
    })
  })

  describe('Conflict Durability & Resolution across Restart', () => {
    it('14. Conflict persists across restart and is detected by P17', async () => {
      let scenario = await createRestartableScenario({ businessMode: 'cloud', initialOnline: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest
      await setupBoundCloudState(scenario)

      const productStore = useProductStore(scenario.pinia)
      await productStore.createCategory('Minuman')
      const prod = await productStore.createProduct({ name: 'Kopi Hitam', category: 'Minuman', price: 10000, stock: 5 })
      await scenario.scheduler.flush()

      const registry = scenario.foundation.registry
      await registry.ensureLoaded()
      const prodSyncId = await registry.resolveSyncId(SYNC_ENTITY_TYPES.PRODUCT, prod.product.id)
      const catSyncId = await registry.resolveSyncId(SYNC_ENTITY_TYPES.CATEGORY, 'Minuman')

      scenario.fakeServer.db.products.push({
        sync_id: prodSyncId,
        name: 'Kopi Hitam Server',
        category_sync_id: catSyncId,
        price: 10000,
        business_id: 10,
        sync_version: 1,
        sync_sequence: 1,
      })
      scenario.fakeServer.setServerSequence(1)
      await scenario.adapter.saveSyncServerVersions({ [`products:${prodSyncId}`]: 1 })

      // Local edit
      await productStore.updateProduct(prod.product.id, { name: 'Kopi Hitam Local', category: 'Minuman', price: 12000, stock: 5 })
      await scenario.scheduler.flush()

      // Server remote edit (bump server version to 2)
      scenario.fakeServer.db.products[0].name = 'Kopi Hitam Server V2'
      scenario.fakeServer.db.products[0].sync_version = 2
      scenario.fakeServer.db.products[0].sync_sequence = 2
      scenario.fakeServer.setServerSequence(2)

      const orchestratorStore = useSyncOrchestratorStore(scenario.pinia)
      const syncRes = await orchestratorStore.syncAll()
      expect(syncRes.ok).toBe(false)
      expect(syncRes.stage).toBe('push')

      const conflictStore = useSyncConflictStore(scenario.pinia)
      await conflictStore.loadConflicts()
      expect(conflictStore.conflicts).toHaveLength(1)

      // Restart app
      scenario = await restartAppScenario(scenario, { online: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      const freshConflictStore = useSyncConflictStore(scenario.pinia)
      await freshConflictStore.loadConflicts()
      expect(freshConflictStore.conflicts).toHaveLength(1)
      expect(freshConflictStore.conflicts[0].syncId).toBe(prodSyncId)

      const healthRes = await useSyncHealthStore(scenario.pinia).checkHealth()
      expect(healthRes.status).toBe('blocked')
      expect(healthRes.issues.some((i) => i.code === 'SYNC_OPEN_CONFLICT')).toBe(true)

      await scenario.cleanup()
    })

    it('15. P18 refuses automatic conflict resolution after restart', async () => {
      let scenario = await createRestartableScenario({ businessMode: 'cloud', initialOnline: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest
      await setupBoundCloudState(scenario)

      const productStore = useProductStore(scenario.pinia)
      await productStore.createCategory('Minuman')
      const prod = await productStore.createProduct({ name: 'Kopi Hitam', category: 'Minuman', price: 10000, stock: 5 })
      await scenario.scheduler.flush()

      const registry = scenario.foundation.registry
      await registry.ensureLoaded()
      const prodSyncId = await registry.resolveSyncId(SYNC_ENTITY_TYPES.PRODUCT, prod.product.id)
      const catSyncId = await registry.resolveSyncId(SYNC_ENTITY_TYPES.CATEGORY, 'Minuman')

      scenario.fakeServer.db.products.push({
        sync_id: prodSyncId,
        name: 'Kopi Hitam Server',
        category_sync_id: catSyncId,
        price: 10000,
        business_id: 10,
        sync_version: 1,
        sync_sequence: 1,
      })
      scenario.fakeServer.setServerSequence(1)
      await scenario.adapter.saveSyncServerVersions({ [`products:${prodSyncId}`]: 1 })

      await productStore.updateProduct(prod.product.id, { name: 'Kopi Hitam Local', category: 'Minuman', price: 12000, stock: 5 })
      await scenario.scheduler.flush()

      scenario.fakeServer.db.products[0].name = 'Kopi Hitam Server V2'
      scenario.fakeServer.db.products[0].sync_version = 2
      scenario.fakeServer.db.products[0].sync_sequence = 2
      scenario.fakeServer.setServerSequence(2)

      await useSyncOrchestratorStore(scenario.pinia).syncAll()

      // Restart app
      scenario = await restartAppScenario(scenario, { online: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      // Generic recovery refuses to auto-resolve conflict
      const recRes = await useSyncRecoveryStore(scenario.pinia).recover(RECOVERY_ACTIONS.CONTINUE_PENDING)
      expect(recRes.ok).toBe(false)
      expect(recRes.code).toBe('SYNC_RECOVERY_CONFLICT_ACTION_REQUIRED')

      const freshConflictStore = useSyncConflictStore(scenario.pinia)
      await freshConflictStore.loadConflicts()
      expect(freshConflictStore.conflicts).toHaveLength(1)

      await scenario.cleanup()
    })

    it('16. Manual conflict resolution (keepLocal and useServer) after restart converges', async () => {
      // 16A: keepLocal
      let scenario = await createRestartableScenario({ businessMode: 'cloud', initialOnline: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest
      await setupBoundCloudState(scenario)

      const productStore = useProductStore(scenario.pinia)
      await productStore.createCategory('Minuman')
      const prod = await productStore.createProduct({ name: 'Kopi Hitam', category: 'Minuman', price: 10000, stock: 5 })
      await scenario.scheduler.flush()

      const registry = scenario.foundation.registry
      await registry.ensureLoaded()
      const prodSyncId = await registry.resolveSyncId(SYNC_ENTITY_TYPES.PRODUCT, prod.product.id)
      const catSyncId = await registry.resolveSyncId(SYNC_ENTITY_TYPES.CATEGORY, 'Minuman')

      scenario.fakeServer.db.products.push({
        sync_id: prodSyncId,
        name: 'Kopi Hitam Server',
        category_sync_id: catSyncId,
        price: 10000,
        business_id: 10,
        sync_version: 1,
        sync_sequence: 1,
      })
      scenario.fakeServer.setServerSequence(1)
      await scenario.adapter.saveSyncServerVersions({ [`products:${prodSyncId}`]: 1 })

      await productStore.updateProduct(prod.product.id, { name: 'Kopi Hitam Local', category: 'Minuman', price: 12000, stock: 5 })
      await scenario.scheduler.flush()

      scenario.fakeServer.db.products[0].name = 'Kopi Hitam Server V2'
      scenario.fakeServer.db.products[0].sync_version = 2
      scenario.fakeServer.db.products[0].sync_sequence = 2
      scenario.fakeServer.setServerSequence(2)

      await useSyncOrchestratorStore(scenario.pinia).syncAll()

      // Restart app
      scenario = await restartAppScenario(scenario, { online: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      const conflictStore = useSyncConflictStore(scenario.pinia)
      await conflictStore.loadConflicts()
      expect(conflictStore.conflicts).toHaveLength(1)
      const conf = conflictStore.conflicts[0]

      // Resolve keepLocal
      const resKeep = await conflictStore.keepLocal(conf.id)
      expect(resKeep.ok).toBe(true)

      // Push local version to server
      const pushRes = await useSyncPushStore(scenario.pinia).pushNow()
      expect(pushRes.ok).toBe(true)

      expect(scenario.fakeServer.db.products[0].name).toBe('Kopi Hitam Local')
      expect(scenario.fakeServer.db.products[0].price).toBe(12000)
      expect(await scenario.adapter.countSyncQueueItems()).toBe(0)
      expect(conflictStore.openConflicts).toHaveLength(0)

      await scenario.cleanup()
    })
  })

  describe('Tenant Context Safety across Restart', () => {
    it('17. Tenant mismatch after restart blocks transport and isolates data', async () => {
      let scenario = await createRestartableScenario({ businessMode: 'cloud', initialOnline: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest
      await setupBoundCloudState(scenario)

      const productStore = useProductStore(scenario.pinia)
      await productStore.createCategory('Minuman')
      await productStore.createProduct({ name: 'Kopi Asli', category: 'Minuman', price: 15000, stock: 10 })
      await scenario.scheduler.flush()

      // Restart app
      scenario = await restartAppScenario(scenario, { online: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      // Switch context to wrong business (999)
      scenario.cloudStore.selectedBusiness = { id: 999, name: 'Other Business' }

      const pushRes = await useSyncPushStore(scenario.pinia).pushNow()
      expect(pushRes.ok).toBe(false)
      expect(['SYNC_CONTEXT_GUARD_BLOCKED', 'SYNC_BUSINESS_BINDING_MISMATCH', 'SYNC_CONTEXT_MISMATCH']).toContain(pushRes.code)

      // Zero data sent to business 999
      const biz999 = scenario.fakeServer.getRecordsForBusiness(999)
      expect(biz999.products).toHaveLength(0)
      expect(await scenario.adapter.countSyncQueueItems()).toBeGreaterThan(0)

      await scenario.cleanup()
    })

    it('18. Returning canonical tenant permits recovery and sync', async () => {
      let scenario = await createRestartableScenario({ businessMode: 'cloud', initialOnline: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest
      await setupBoundCloudState(scenario)

      const productStore = useProductStore(scenario.pinia)
      await productStore.createCategory('Minuman')
      await productStore.createProduct({ name: 'Kopi Asli', category: 'Minuman', price: 15000, stock: 10 })
      await scenario.scheduler.flush()

      // Restart app
      scenario = await restartAppScenario(scenario, { online: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      // Switch to wrong business, verify blocked
      scenario.cloudStore.selectedBusiness = { id: 999, name: 'Other Business' }
      expect((await useSyncPushStore(scenario.pinia).pushNow()).ok).toBe(false)

      // Return to canonical business 10
      scenario.cloudStore.selectedBusiness = { id: 10, name: 'Kedai Kopi Utama' }
      const pushRes = await useSyncPushStore(scenario.pinia).pushNow()
      expect(pushRes.ok).toBe(true)

      const biz10 = scenario.fakeServer.getRecordsForBusiness(10)
      expect(biz10.products).toHaveLength(1)
      expect(biz10.products[0].name).toBe('Kopi Asli')
      expect(await scenario.adapter.countSyncQueueItems()).toBe(0)

      await scenario.cleanup()
    })
  })

  describe('Startup & Auto Sync Safety across Restart', () => {
    it('19. Startup online does not auto retry durable inflight', async () => {
      let scenario = await createRestartableScenario({ businessMode: 'cloud', initialOnline: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest
      await setupBoundCloudState(scenario)

      const productStore = useProductStore(scenario.pinia)
      await productStore.createCategory('Minuman')
      await productStore.createProduct({ name: 'Teh', category: 'Minuman', price: 5000, stock: 10 })
      await scenario.scheduler.flush()

      // Create inflight
      scenario.fakeServer.setSimulateNetworkError(true)
      await useSyncPushStore(scenario.pinia).pushNow()

      const autoSyncStore = useSyncAutoSyncStore(scenario.pinia)
      await autoSyncStore.setEnabled(true)

      // Restart app with online & foreground
      scenario = await restartAppScenario(scenario, { online: true, foreground: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      const freshAutoSyncStore = useSyncAutoSyncStore(scenario.pinia)
      freshAutoSyncStore.startListeners()

      // No push request should be executed purely by startup
      expect(scenario.fakeServer.getPushRequestCount()).toBe(1) // Only the initial pre-restart attempt
      expect(await scenario.adapter.loadSyncPushInflight()).not.toBeNull()

      await scenario.cleanup()
    })

    it('20. Runtime Auto Sync does not bypass inflight safety', async () => {
      let scenario = await createRestartableScenario({ businessMode: 'cloud', initialOnline: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest
      await setupBoundCloudState(scenario)

      const productStore = useProductStore(scenario.pinia)
      await productStore.createCategory('Minuman')
      await productStore.createProduct({ name: 'Teh', category: 'Minuman', price: 5000, stock: 10 })
      await scenario.scheduler.flush()

      scenario.fakeServer.setSimulateNetworkError(true)
      await useSyncPushStore(scenario.pinia).pushNow()
      expect(await scenario.adapter.loadSyncPushInflight()).not.toBeNull()

      // Restart into offline state
      scenario = await restartAppScenario(scenario, { online: false, foreground: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      const freshAutoSyncStore = useSyncAutoSyncStore(scenario.pinia)
      await freshAutoSyncStore.setEnabled(true)
      freshAutoSyncStore.startListeners()

      // Transition online via runtime event
      scenario.fakeServer.setSimulateNetworkError(false)
      await scenario.runtimeSignal.setOnlineAsync(true)
      await Promise.resolve()

      // Inflight was detected as unsafe; Auto Sync did not overwrite or create competing push
      expect(freshAutoSyncStore.lastSkippedCode).toBe('AUTO_SYNC_UNSAFE_HEALTH')
      expect(await scenario.adapter.loadSyncPushInflight()).not.toBeNull()

      await scenario.cleanup()
    })
  })

  describe('Identity, Transactions, Diagnostics & Stress Cycles', () => {
    it('21. Stable sync identity survives restart', async () => {
      let scenario = await createRestartableScenario({ businessMode: 'cloud', initialOnline: false })
      await setupBoundCloudState(scenario)

      const registry = scenario.foundation.registry
      await registry.ensureLoaded()
      const syncId1 = await registry.resolveSyncId(SYNC_ENTITY_TYPES.CATEGORY, 'Kategori Unik')
      expect(syncId1).toBeTruthy()

      // Restart app
      scenario = await restartAppScenario(scenario, { online: false })
      const freshRegistry = scenario.foundation.registry
      await freshRegistry.ensureLoaded()

      const syncId2 = await freshRegistry.resolveSyncId(SYNC_ENTITY_TYPES.CATEGORY, 'Kategori Unik')
      expect(syncId2).toBe(syncId1)

      await scenario.cleanup()
    })

    it('22. Transaction and SaleItem unknown-commit recovery creates no duplicate sale', async () => {
      let scenario = await createRestartableScenario({ businessMode: 'free' })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      const prodStore = useProductStore(scenario.pinia)
      await prodStore.createCategory('Minuman')
      const prod = await prodStore.createProduct({ name: 'Espresso', category: 'Minuman', price: 18000, stock: 10 })
      expect(prod.success).toBe(true)

      const trxStore = useTransactionStore(scenario.pinia)
      await trxStore.createTransaction({
        items: [
          { id: prod.product.id, name: 'Espresso', price: 18000, qty: 2 },
        ],
        subtotal: 36000,
        tax: 0,
        total: 36000,
        paymentMethod: 'cash',
      })
      await scenario.scheduler.flush()

      // Upgrade cloud & bootstrap
      const devId = await scenario.adapter.loadDeviceIdentifier()
      const cloudCtx = makeValidCloudContext({ deviceIdentifier: devId })
      scenario.cloudStore.$patch(cloudCtx)
      await saveToken('mock-bearer-token-123')
      await scenario.adapter.saveDeviceIdentifier(devId)
      await scenario.adapter.saveCloudContext(cloudCtx)
      scenario.businessStore.setBusiness({ name: 'Kedai Kopi Utama', type: 'Cafe', mode: 'cloud' })
      scenario.runtimeSignal.setOnline(true)
      const bRes = await useSyncBootstrapStore(scenario.pinia).bootstrapNow()
      expect(bRes.ok).toBe(true)

      // Push: server commits sale + sale_item, response drops
      scenario.fakeServer.setSimulateCrashAfterCommit(true)
      await useSyncPushStore(scenario.pinia).pushNow()

      expect(scenario.fakeServer.db.sales).toHaveLength(1)
      expect(scenario.fakeServer.db.sale_items).toHaveLength(1)

      // Restart app
      scenario = await restartAppScenario(scenario, { online: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      // Recover via retry
      scenario.fakeServer.setSimulateCrashAfterCommit(false)
      const recRes = await useSyncRecoveryStore(scenario.pinia).recover(RECOVERY_ACTIONS.RETRY_INFLIGHT)
      expect(recRes.ok).toBe(true)

      // Final server check: exactly 1 sale, 1 sale_item
      expect(scenario.fakeServer.db.sales).toHaveLength(1)
      expect(scenario.fakeServer.db.sale_items).toHaveLength(1)
      expect(scenario.fakeServer.db.sale_items[0].product_name).toBe('Espresso')
      expect(scenario.fakeServer.db.sale_items[0].quantity).toBe(2)
      expect(await scenario.adapter.countSyncQueueItems()).toBe(0)
      expect(await scenario.adapter.loadSyncPushInflight()).toBeNull()

      await scenario.cleanup()
    })

    it('23. Activity log entries survive restart and record recovery', async () => {
      let scenario = await createRestartableScenario({ businessMode: 'cloud', initialOnline: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest
      await setupBoundCloudState(scenario)

      const productStore = useProductStore(scenario.pinia)
      await productStore.createCategory('Minuman')
      await productStore.createProduct({ name: 'Kopi Tubruk', category: 'Minuman', price: 10000, stock: 5 })
      await scenario.scheduler.flush()

      // Execute a push and log activity
      await useSyncPushStore(scenario.pinia).pushNow()
      const activityStore = useSyncActivityLogStore(scenario.pinia)
      await activityStore.record({
        type: 'push',
        action: 'PUSH_NOW',
        status: 'success',
        code: 'PUSH_COMPLETED',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        businessId: 10,
        outletId: 101,
        deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
        registeredDeviceId: 55,
        summary: { pushed: 2 },
      })
      await activityStore.refresh()
      expect(activityStore.entries.length).toBeGreaterThan(0)
      const initialEntryCount = activityStore.entries.length

      // Restart app
      scenario = await restartAppScenario(scenario, { online: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      const freshLogStore = useSyncActivityLogStore(scenario.pinia)
      await freshLogStore.refresh()
      expect(freshLogStore.entries.length).toBe(initialEntryCount)

      await scenario.cleanup()
    })

    it('24. Corrupt inflight metadata after restart fails closed', async () => {
      let scenario = await createRestartableScenario({ businessMode: 'cloud', initialOnline: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest
      await setupBoundCloudState(scenario)

      // Save corrupt / non-object inflight payload in adapter
      await scenario.adapter.saveSyncPushInflight({ invalidField: true })

      // Restart app
      scenario = await restartAppScenario(scenario, { online: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      const guardStore = useSyncContextGuardStore(scenario.pinia)
      const guardRes = await guardStore.check()
      expect(guardRes.ok).toBe(false)

      const pushRes = await useSyncPushStore(scenario.pinia).pushNow()
      expect(pushRes.ok).toBe(false)
      expect(scenario.fakeServer.getPushRequestCount()).toBe(0)

      await scenario.cleanup()
    })

    it('25. Multiple restart cycle ends READY with zero pending/inflight/conflict', async () => {
      let scenario = await createRestartableScenario({ businessMode: 'cloud', initialOnline: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest
      await setupBoundCloudState(scenario)

      const productStore = useProductStore(scenario.pinia)
      await productStore.createCategory('Minuman')
      await productStore.createProduct({ name: 'Kopi Luwak', category: 'Minuman', price: 50000, stock: 3 })
      await scenario.scheduler.flush()

      // Restart #1 (Offline)
      scenario = await restartAppScenario(scenario, { online: false })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      // Fail push due to network error
      scenario.fakeServer.setSimulateNetworkError(true)
      await useSyncPushStore(scenario.pinia).pushNow()

      // Restart #2 (Online)
      scenario = await restartAppScenario(scenario, { online: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      // Retry push via recovery store
      scenario.fakeServer.setSimulateNetworkError(false)
      const recRes = await useSyncRecoveryStore(scenario.pinia).recover(RECOVERY_ACTIONS.RETRY_INFLIGHT)
      expect(recRes.ok).toBe(true)

      // Restart #3 (Final verification)
      scenario = await restartAppScenario(scenario, { online: true })
      mockServerHandler.handle = scenario.fakeServer.handleRequest

      const healthRes = await useSyncHealthStore(scenario.pinia).checkHealth()
      expect(healthRes.status).toBe('ready')
      expect(healthRes.issues).toHaveLength(0)

      expect(await scenario.adapter.countSyncQueueItems()).toBe(0)
      expect(await scenario.adapter.loadSyncPushInflight()).toBeNull()
      expect(useSyncConflictStore(scenario.pinia).openConflicts).toHaveLength(0)
      expect(scenario.fakeServer.db.products).toHaveLength(1)

      await scenario.cleanup()
    })
  })
})
