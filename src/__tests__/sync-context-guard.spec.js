import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createSyncContextGuardService } from '@/services/sync/syncContextGuardService'
import { useSyncContextGuardStore } from '@/stores/syncContextGuardStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { createSyncPushService } from '@/services/sync/syncPushService'
import { createSyncPullService } from '@/services/sync/syncPullService'
import { createSyncBootstrapService } from '@/services/sync/syncBootstrapService'
import { createSyncOrchestratorService } from '@/services/sync/syncOrchestratorService'

function createMockAdapter(overrides = {}) {
  return {
    loadSyncPushBinding: vi.fn(async () => overrides.pushBinding ?? null),
    loadSyncPullBinding: vi.fn(async () => overrides.pullBinding ?? null),
    loadSyncPushInflight: vi.fn(async () => overrides.pushInflight ?? null),
    loadSyncBootstrapState: vi.fn(async () => overrides.bootstrapState ?? null),
    loadSyncAutoSettings: vi.fn(async () => overrides.autoSettings ?? null),
    saveSyncPushBinding: vi.fn(),
    saveSyncPullBinding: vi.fn(),
    saveSyncPushInflight: vi.fn(),
    saveSyncBootstrapState: vi.fn(),
    saveSyncAutoSettings: vi.fn(),
    clearSyncPushInflight: vi.fn(),
    countSyncQueueItems: vi.fn(async () => 0),
    listSyncQueuePending: vi.fn(async () => []),
    countPendingSyncQueue: vi.fn(async () => 0),
    listPendingSyncQueue: vi.fn(async () => []),
    ...overrides,
  }
}

const validContext = {
  user: { id: 10, email: 'cashier@pos.local' },
  cloudAccess: true,
  selectedBusiness: { id: 100, name: 'Business Alpha' },
  selectedOutlet: { id: 200, name: 'Outlet Central' },
  deviceIdentifier: 'device-alpha-123',
  registeredDeviceId: 300,
  token: 'mock-valid-jwt-token',
}

describe('P23: Canonical Sync Context Guard & Tenant Isolation', () => {
  let pinia

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.restoreAllMocks()
  })

  // ── 1. Fresh Unbound Context ───────────────────────────────────────────────
  it('returns ok: true with status unbound on a fresh device with no metadata', async () => {
    const adapter = createMockAdapter()
    const guard = createSyncContextGuardService({ adapter })

    const result = await guard.inspect({ context: validContext })

    expect(result.ok).toBe(true)
    expect(result.status).toBe('unbound')
    expect(result.code).toBe('SYNC_CONTEXT_UNBOUND')
    expect(result.canonicalContext).toBeNull()
    expect(result.currentContext).toEqual({
      businessId: 100,
      outletId: 200,
      deviceIdentifier: 'device-alpha-123',
      registeredDeviceId: 300,
    })
    expect(result.sources).toEqual([])
    expect(result.issues).toEqual([])
  })

  // ── 2. Safe Matching Context (Single and Multiple Anchors) ─────────────────
  it('returns safe when current context exactly matches pull binding anchor', async () => {
    const adapter = createMockAdapter({
      pullBinding: {
        version: 1,
        businessId: 100,
        outletId: 200,
        deviceIdentifier: 'device-alpha-123',
        registeredDeviceId: 300,
      },
    })
    const guard = createSyncContextGuardService({ adapter })

    const result = await guard.inspect({ context: validContext })

    expect(result.ok).toBe(true)
    expect(result.status).toBe('safe')
    expect(result.code).toBe('SYNC_CONTEXT_SAFE')
    expect(result.canonicalContext).toEqual({
      businessId: 100,
      outletId: 200,
      deviceIdentifier: 'device-alpha-123',
      registeredDeviceId: 300,
    })
    expect(result.sources).toContain('pull_binding')
  })

  it('returns safe when all available metadata anchors are mutually consistent and match current context', async () => {
    const adapter = createMockAdapter({
      pushBinding: {
        version: 1,
        businessId: 100,
      },
      pullBinding: {
        version: 1,
        businessId: 100,
        outletId: 200,
        deviceIdentifier: 'device-alpha-123',
        registeredDeviceId: 300,
      },
      pushInflight: {
        version: 1,
        businessId: 100,
        outletId: 200,
        deviceIdentifier: 'device-alpha-123',
        registeredDeviceId: 300,
      },
      bootstrapState: {
        version: 1,
        businessId: 100,
        outletId: 200,
        deviceIdentifier: 'device-alpha-123',
        registeredDeviceId: 300,
      },
      autoSettings: {
        version: 1,
        enabled: true,
        businessId: 100,
        outletId: 200,
        deviceIdentifier: 'device-alpha-123',
        registeredDeviceId: 300,
      },
    })
    const guard = createSyncContextGuardService({ adapter })

    const result = await guard.inspect({ context: validContext })

    expect(result.ok).toBe(true)
    expect(result.status).toBe('safe')
    expect(result.code).toBe('SYNC_CONTEXT_SAFE')
    expect(result.sources).toEqual([
      'push_binding',
      'pull_binding',
      'inflight',
      'bootstrap',
      'auto_sync',
    ])
  })

  // ── 3. Tenant Mismatch: Business Mismatch ──────────────────────────────────
  it('blocks with SYNC_CONTEXT_BUSINESS_MISMATCH when current business does not match bound business', async () => {
    const adapter = createMockAdapter({
      pullBinding: {
        version: 1,
        businessId: 999, // Bound to business 999
        outletId: 200,
        deviceIdentifier: 'device-alpha-123',
        registeredDeviceId: 300,
      },
    })
    const guard = createSyncContextGuardService({ adapter })

    const result = await guard.inspect({ context: validContext })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('blocked')
    expect(result.code).toBe('SYNC_CONTEXT_BUSINESS_MISMATCH')
    expect(result.canonicalContext.businessId).toBe(999)
    expect(result.currentContext.businessId).toBe(100)
    expect(result.issues).toEqual([
      { code: 'BUSINESS_ID_MISMATCH', source: 'canonical_context' },
    ])
  })

  it('blocks with SYNC_CONTEXT_BUSINESS_MISMATCH when push_binding business differs from current', async () => {
    const adapter = createMockAdapter({
      pushBinding: {
        version: 1,
        businessId: 888,
      },
    })
    const guard = createSyncContextGuardService({ adapter })

    const result = await guard.inspect({ context: validContext })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('blocked')
    expect(result.code).toBe('SYNC_CONTEXT_BUSINESS_MISMATCH')
    expect(result.canonicalContext.businessId).toBe(888)
    expect(result.issues).toEqual([
      { code: 'BUSINESS_ID_MISMATCH', source: 'push_binding' },
    ])
  })

  // ── 4. Tenant Mismatch: Outlet Mismatch ────────────────────────────────────
  it('blocks with SYNC_CONTEXT_MISMATCH when current outlet differs from canonical outlet', async () => {
    const adapter = createMockAdapter({
      pullBinding: {
        version: 1,
        businessId: 100,
        outletId: 777, // Bound to outlet 777
        deviceIdentifier: 'device-alpha-123',
        registeredDeviceId: 300,
      },
    })
    const guard = createSyncContextGuardService({ adapter })

    const result = await guard.inspect({ context: validContext })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('blocked')
    expect(result.code).toBe('SYNC_CONTEXT_MISMATCH')
    expect(result.canonicalContext.outletId).toBe(777)
    expect(result.issues).toEqual([
      { code: 'OUTLET_ID_MISMATCH', source: 'canonical_context' },
    ])
  })

  // ── 5. Tenant Mismatch: Device Mismatches ──────────────────────────────────
  it('blocks with SYNC_CONTEXT_MISMATCH when deviceIdentifier differs', async () => {
    const adapter = createMockAdapter({
      pullBinding: {
        version: 1,
        businessId: 100,
        outletId: 200,
        deviceIdentifier: 'device-OTHER-999',
        registeredDeviceId: 300,
      },
    })
    const guard = createSyncContextGuardService({ adapter })

    const result = await guard.inspect({ context: validContext })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('blocked')
    expect(result.code).toBe('SYNC_CONTEXT_MISMATCH')
    expect(result.canonicalContext.deviceIdentifier).toBe('device-OTHER-999')
    expect(result.issues).toEqual([
      { code: 'DEVICE_IDENTIFIER_MISMATCH', source: 'canonical_context' },
    ])
  })

  it('blocks with SYNC_CONTEXT_MISMATCH when registeredDeviceId differs', async () => {
    const adapter = createMockAdapter({
      pullBinding: {
        version: 1,
        businessId: 100,
        outletId: 200,
        deviceIdentifier: 'device-alpha-123',
        registeredDeviceId: 404,
      },
    })
    const guard = createSyncContextGuardService({ adapter })

    const result = await guard.inspect({ context: validContext })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('blocked')
    expect(result.code).toBe('SYNC_CONTEXT_MISMATCH')
    expect(result.canonicalContext.registeredDeviceId).toBe(404)
    expect(result.issues).toEqual([
      { code: 'REGISTERED_DEVICE_ID_MISMATCH', source: 'canonical_context' },
    ])
  })

  // ── 6. Cross-Metadata Conflict ────────────────────────────────────────────
  it('blocks with SYNC_CONTEXT_METADATA_CONFLICT when two local metadata sources have conflicting contexts', async () => {
    const adapter = createMockAdapter({
      pullBinding: {
        version: 1,
        businessId: 100,
        outletId: 200,
        deviceIdentifier: 'device-alpha-123',
        registeredDeviceId: 300,
      },
      bootstrapState: {
        version: 1,
        businessId: 100,
        outletId: 201, // Conflict: outlet 201 vs 200
        deviceIdentifier: 'device-alpha-123',
        registeredDeviceId: 300,
      },
    })
    const guard = createSyncContextGuardService({ adapter })

    const result = await guard.inspect({ context: validContext })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('blocked')
    expect(result.code).toBe('SYNC_CONTEXT_METADATA_CONFLICT')
    expect(result.issues).toContainEqual({
      code: 'METADATA_ANCHOR_CONFLICT',
      source: 'pull_binding_vs_bootstrap',
    })
  })

  // ── 7. Auto Sync Settings Preference Rules ────────────────────────────────
  it('ignores auto_sync context as anchor when auto sync is disabled (enabled: false)', async () => {
    const adapter = createMockAdapter({
      autoSettings: {
        version: 1,
        enabled: false,
        businessId: 999, // Stale disabled settings for business 999
        outletId: 888,
        deviceIdentifier: 'old-device',
        registeredDeviceId: 777,
      },
    })
    const guard = createSyncContextGuardService({ adapter })

    // Since enabled is false and there is no other metadata, result must be UNBOUND (safe)
    const result = await guard.inspect({ context: validContext })

    expect(result.ok).toBe(true)
    expect(result.status).toBe('unbound')
    expect(result.code).toBe('SYNC_CONTEXT_UNBOUND')
    expect(result.canonicalContext).toBeNull()
  })

  it('enforces auto_sync context as anchor when auto sync is enabled (enabled: true)', async () => {
    const adapter = createMockAdapter({
      autoSettings: {
        version: 1,
        enabled: true,
        businessId: 999, // Active settings for business 999
        outletId: 200,
        deviceIdentifier: 'device-alpha-123',
        registeredDeviceId: 300,
      },
    })
    const guard = createSyncContextGuardService({ adapter })

    const result = await guard.inspect({ context: validContext })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('blocked')
    expect(result.code).toBe('SYNC_CONTEXT_BUSINESS_MISMATCH')
  })

  // ── 8. Corrupt Metadata (Fail Closed) ──────────────────────────────────────
  it('blocks with SYNC_CONTEXT_METADATA_INVALID when metadata schema is corrupt/malformed', async () => {
    const adapter = createMockAdapter({
      pullBinding: {
        version: 1,
        businessId: 'invalid-string-not-numeric', // Invalid
        outletId: 200,
        deviceIdentifier: 'device-123',
        registeredDeviceId: 300,
      },
    })
    const guard = createSyncContextGuardService({ adapter })

    const result = await guard.inspect({ context: validContext })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('blocked')
    expect(result.code).toBe('SYNC_CONTEXT_METADATA_INVALID')
    expect(result.issues).toEqual([
      { code: 'INVALID_METADATA_SCHEMA', source: 'pull_binding' },
    ])
  })

  // ── 9. Read-Only Guard Guarantee (Zero Writes, Zero Network) ──────────────
  it('guarantees zero writes and zero mutation method calls on database adapter during inspect', async () => {
    const adapter = createMockAdapter({
      pullBinding: {
        version: 1,
        businessId: 100,
        outletId: 200,
        deviceIdentifier: 'device-alpha-123',
        registeredDeviceId: 300,
      },
    })
    const guard = createSyncContextGuardService({ adapter })

    await guard.inspect({ context: validContext })

    expect(adapter.saveSyncPushBinding).not.toHaveBeenCalled()
    expect(adapter.saveSyncPullBinding).not.toHaveBeenCalled()
    expect(adapter.saveSyncPushInflight).not.toHaveBeenCalled()
    expect(adapter.saveSyncBootstrapState).not.toHaveBeenCalled()
    expect(adapter.saveSyncAutoSettings).not.toHaveBeenCalled()
    expect(adapter.clearSyncPushInflight).not.toHaveBeenCalled()
  })

  // ── 10. Missing Precondition Validation ───────────────────────────────────
  it('returns SYNC_CONTEXT_INVALID when cloud context is missing or incomplete', async () => {
    const adapter = createMockAdapter()
    const guard = createSyncContextGuardService({ adapter })

    const incompleteContext = { ...validContext, selectedOutlet: null }
    const result = await guard.inspect({ context: incompleteContext })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('blocked')
    expect(result.code).toBe('SYNC_CONTEXT_INVALID')
  })

  // ── 11. Push Service Guard Integration ────────────────────────────────────
  it('blocks syncPushService pushNow() and returns SYNC_CONTEXT_GUARD_BLOCKED without sending HTTP or mutating queue', async () => {
    const adapter = createMockAdapter({
      pullBinding: {
        version: 1,
        businessId: 999, // Mismatched tenant
        outletId: 200,
        deviceIdentifier: 'device-alpha-123',
        registeredDeviceId: 300,
      },
    })
    const contextGuardService = createSyncContextGuardService({ adapter })
    const mockTransport = vi.fn(async () => ({ ok: true, data: { status: 'success' } }))

    const pushService = createSyncPushService({
      adapter,
      transport: mockTransport,
      contextGuardService,
    })

    const result = await pushService.pushNow({ context: validContext })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_CONTEXT_GUARD_BLOCKED')
    expect(result.contextGuardCode).toBe('SYNC_CONTEXT_BUSINESS_MISMATCH')
    expect(mockTransport).not.toHaveBeenCalled()
  })

  // ── 12. Pull Service Guard Integration ────────────────────────────────────
  it('blocks syncPullService pullNow() and returns SYNC_CONTEXT_GUARD_BLOCKED without making HTTP calls', async () => {
    const adapter = createMockAdapter({
      pullBinding: {
        version: 1,
        businessId: 100,
        outletId: 999, // Mismatched outlet
        deviceIdentifier: 'device-alpha-123',
        registeredDeviceId: 300,
      },
    })
    const contextGuardService = createSyncContextGuardService({ adapter })
    const mockTransport = vi.fn(async () => ({ ok: true, data: { records: [] } }))

    const pullService = createSyncPullService({
      adapter,
      transport: mockTransport,
      contextGuardService,
    })

    const result = await pullService.pullNow({ context: validContext })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_CONTEXT_GUARD_BLOCKED')
    expect(result.contextGuardCode).toBe('SYNC_CONTEXT_MISMATCH')
    expect(mockTransport).not.toHaveBeenCalled()
  })

  // ── 13. Bootstrap Service Guard Integration ───────────────────────────────
  it('blocks syncBootstrapService bootstrapNow() and returns SYNC_CONTEXT_GUARD_BLOCKED without staging bootstrap', async () => {
    const adapter = createMockAdapter({
      autoSettings: {
        version: 1,
        enabled: true,
        businessId: 999, // Mismatched
        outletId: 200,
        deviceIdentifier: 'device-alpha-123',
        registeredDeviceId: 300,
      },
    })
    const contextGuardService = createSyncContextGuardService({ adapter })
    const mockTransport = vi.fn(async () => ({ ok: true, data: { records: [] } }))

    const bootstrapService = createSyncBootstrapService({
      adapter,
      transport: mockTransport,
      contextGuardService,
    })

    const result = await bootstrapService.bootstrapNow({ context: validContext })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_CONTEXT_GUARD_BLOCKED')
    expect(result.contextGuardCode).toBe('SYNC_CONTEXT_BUSINESS_MISMATCH')
    expect(mockTransport).not.toHaveBeenCalled()
  })

  // ── 14. Full Sync Orchestrator Propagation ────────────────────────────────
  it('propagates failure through syncOrchestratorService when push is blocked by context guard', async () => {
    const adapter = createMockAdapter({
      pullBinding: {
        version: 1,
        businessId: 999,
        outletId: 200,
        deviceIdentifier: 'device-alpha-123',
        registeredDeviceId: 300,
      },
    })
    const contextGuardService = createSyncContextGuardService({ adapter })
    const pushService = createSyncPushService({ adapter, contextGuardService })
    const pullService = createSyncPullService({ adapter, contextGuardService })
    const orchestratorService = createSyncOrchestratorService({ pushService, pullService })

    const result = await orchestratorService.syncAll({ context: validContext })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_CONTEXT_GUARD_BLOCKED')
    expect(result.push?.code).toBe('SYNC_CONTEXT_GUARD_BLOCKED')
  })

  // ── 15. Pinia Store syncContextGuardStore ─────────────────────────────────
  it('properly checks context and stores status in Pinia syncContextGuardStore', async () => {
    const cloudStore = useCloudSessionStore()
    cloudStore.user = validContext.user
    cloudStore.cloudAccess = validContext.cloudAccess
    cloudStore.selectedBusiness = validContext.selectedBusiness
    cloudStore.selectedOutlet = validContext.selectedOutlet
    cloudStore.deviceIdentifier = validContext.deviceIdentifier
    cloudStore.registeredDeviceId = validContext.registeredDeviceId

    const adapter = createMockAdapter({
      pullBinding: {
        version: 1,
        businessId: 100,
        outletId: 200,
        deviceIdentifier: 'device-alpha-123',
        registeredDeviceId: 300,
      },
    })
    const contextGuardService = createSyncContextGuardService({ adapter })
    const store = useSyncContextGuardStore()
    store.init({ contextGuardService })

    expect(store.status).toBe('idle')

    const res = await store.check()

    expect(res.ok).toBe(true)
    expect(store.status).toBe('safe')
    expect(store.code).toBe('SYNC_CONTEXT_SAFE')
    expect(store.canonicalContext.businessId).toBe(100)
    expect(store.lastCheckedAt).toBeTruthy()

    store.resetPresentation()
    expect(store.status).toBe('idle')
    expect(store.code).toBeNull()
    expect(store.canonicalContext).toBeNull()
  })
})
