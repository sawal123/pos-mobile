import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { createSyncContextGuardService } from '@/services/sync/syncContextGuardService'
import { useSyncContextGuardStore } from '@/stores/syncContextGuardStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { createSyncPushService } from '@/services/sync/syncPushService'
import { createSyncPullService } from '@/services/sync/syncPullService'
import { createSyncBootstrapService } from '@/services/sync/syncBootstrapService'
import { createSyncOrchestratorService } from '@/services/sync/syncOrchestratorService'
import { createSyncAutoSyncService } from '@/services/sync/syncAutoSyncService'
import { useSyncConflictStore } from '@/stores/syncConflictStore'
import CloudLoginView from '@/views/settings/CloudLoginView.vue'

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

function createValidInflightEnvelope(overrides = {}) {
  return {
    version: 1,
    requestId: 'req-inflight-123',
    businessId: 100,
    outletId: 200,
    deviceIdentifier: 'device-alpha-123',
    registeredDeviceId: 300,
    createdAt: '2026-08-28T12:00:00.000Z',
    queueSnapshots: [
      {
        id: 'q-1',
        entityType: 'product',
        entityId: 'p-1',
        operation: 'UPSERT',
        updatedAt: '2026-08-28T12:00:00.000Z',
      },
    ],
    changes: {
      categories: [],
      products: [],
      customers: [],
      shifts: [],
      sales: [],
      sale_items: [],
      expenses: [],
    },
    ...overrides,
  }
}

function createValidBootstrapState(overrides = {}) {
  return {
    version: 1,
    businessId: 100,
    outletId: 200,
    deviceIdentifier: 'device-alpha-123',
    registeredDeviceId: 300,
    status: 'staged',
    stagedAt: '2026-08-28T12:00:00.000Z',
    counts: { products: 5, categories: 2 },
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
}

describe('P23: Canonical Sync Context Guard & Tenant Isolation', () => {
  let pinia

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.restoreAllMocks()
    if (typeof globalThis !== 'undefined') {
      globalThis.__SYNC_CONTEXT_GUARD_TEST_SUITE__ = true
    }
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

  // ── 2. Actual P12 Push Binding Contract ───────────────────────────────────
  it('recognizes actual P12 push binding ({ businessId, boundAt }, NO version) as UNBOUND when matching business', async () => {
    const adapter = createMockAdapter({
      pushBinding: {
        businessId: 100,
        boundAt: '2026-08-28T10:00:00.000Z',
      },
    })
    const guard = createSyncContextGuardService({ adapter })

    const result = await guard.inspect({ context: validContext })

    expect(result.ok).toBe(true)
    expect(result.status).toBe('unbound')
    expect(result.code).toBe('SYNC_CONTEXT_UNBOUND')
    expect(result.canonicalContext).toBeNull()
    expect(result.sources).toEqual(['push_binding'])
  })

  it('blocks with SYNC_CONTEXT_BUSINESS_MISMATCH when push_binding business differs from current', async () => {
    const adapter = createMockAdapter({
      pushBinding: {
        businessId: 200,
        boundAt: '2026-08-28T10:00:00.000Z',
      },
    })
    const guard = createSyncContextGuardService({ adapter })

    const result = await guard.inspect({ context: validContext })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('blocked')
    expect(result.code).toBe('SYNC_CONTEXT_BUSINESS_MISMATCH')
    expect(result.canonicalContext).toBeNull()
    expect(result.issues).toEqual([
      { code: 'BUSINESS_ID_MISMATCH', source: 'push_binding' },
    ])
  })

  // ── 3. Actual P13 Pull Binding Contract ───────────────────────────────────
  it('recognizes actual P13 pull binding without version as SAFE when matching current context', async () => {
    const adapter = createMockAdapter({
      pullBinding: {
        businessId: 100,
        outletId: 200,
        deviceIdentifier: 'device-alpha-123',
        registeredDeviceId: 300,
        boundAt: '2026-08-28T10:00:00.000Z',
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

  // ── 4. Full Metadata Combination ──────────────────────────────────────────
  it('returns SAFE when all actual production metadata anchors match current context', async () => {
    const adapter = createMockAdapter({
      pushBinding: {
        businessId: 100,
        boundAt: '2026-08-28T10:00:00.000Z',
      },
      pullBinding: {
        businessId: 100,
        outletId: 200,
        deviceIdentifier: 'device-alpha-123',
        registeredDeviceId: 300,
        boundAt: '2026-08-28T10:00:00.000Z',
      },
      pushInflight: createValidInflightEnvelope(),
      bootstrapState: createValidBootstrapState(),
      autoSettings: {
        version: 1,
        enabled: true,
        context: {
          businessId: 100,
          outletId: 200,
          deviceIdentifier: 'device-alpha-123',
          registeredDeviceId: 300,
        },
        updatedAt: '2026-08-28T10:00:00.000Z',
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

  // ── 5. Inflight Structural Contract ───────────────────────────────────────
  it('blocks with SYNC_CONTEXT_METADATA_INVALID when inflight is context-only without P12 envelope structure', async () => {
    const adapter = createMockAdapter({
      pushInflight: {
        businessId: 100,
        outletId: 200,
        deviceIdentifier: 'device-alpha-123',
        registeredDeviceId: 300,
      },
    })
    const guard = createSyncContextGuardService({ adapter })

    const result = await guard.inspect({ context: validContext })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('blocked')
    expect(result.code).toBe('SYNC_CONTEXT_METADATA_INVALID')
    expect(result.issues).toEqual([
      { code: 'INVALID_METADATA_SCHEMA', source: 'inflight' },
    ])
  })

  // ── 6. Bootstrap Structural Contract ──────────────────────────────────────
  it('blocks with SYNC_CONTEXT_METADATA_INVALID when bootstrap state is arbitrary context-only object', async () => {
    const adapter = createMockAdapter({
      bootstrapState: {
        businessId: 100,
        outletId: 200,
      },
    })
    const guard = createSyncContextGuardService({ adapter })

    const result = await guard.inspect({ context: validContext })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('blocked')
    expect(result.code).toBe('SYNC_CONTEXT_METADATA_INVALID')
    expect(result.issues).toEqual([
      { code: 'INVALID_METADATA_SCHEMA', source: 'bootstrap' },
    ])
  })

  // ── 7. Auto Settings Exact P20 Contract ───────────────────────────────────
  it('blocks with SYNC_CONTEXT_METADATA_INVALID when auto settings uses top-level context properties', async () => {
    const adapter = createMockAdapter({
      autoSettings: {
        version: 1,
        enabled: true,
        businessId: 100,
        outletId: 200,
        deviceIdentifier: 'device-alpha-123',
        registeredDeviceId: 300,
        updatedAt: '2026-08-28T10:00:00.000Z',
      },
    })
    const guard = createSyncContextGuardService({ adapter })

    const result = await guard.inspect({ context: validContext })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('blocked')
    expect(result.code).toBe('SYNC_CONTEXT_METADATA_INVALID')
  })

  it('accepts enabled: false with context: null as valid metadata and stays UNBOUND when no other anchors', async () => {
    const adapter = createMockAdapter({
      autoSettings: {
        version: 1,
        enabled: false,
        context: null,
        updatedAt: '2026-08-28T10:00:00.000Z',
      },
    })
    const guard = createSyncContextGuardService({ adapter })

    const result = await guard.inspect({ context: validContext })

    expect(result.ok).toBe(true)
    expect(result.status).toBe('unbound')
    expect(result.code).toBe('SYNC_CONTEXT_UNBOUND')
    expect(result.canonicalContext).toBeNull()
  })

  it('ignores old context in disabled auto settings (enabled: false) and returns SAFE when pull binding matches current', async () => {
    const adapter = createMockAdapter({
      pullBinding: {
        businessId: 100,
        outletId: 200,
        deviceIdentifier: 'device-alpha-123',
        registeredDeviceId: 300,
        boundAt: '2026-08-28T10:00:00.000Z',
      },
      autoSettings: {
        version: 1,
        enabled: false,
        context: {
          businessId: 999, // Old context from Business B
          outletId: 888,
          deviceIdentifier: 'device-old',
          registeredDeviceId: 777,
        },
        updatedAt: '2026-08-28T10:00:00.000Z',
      },
    })
    const guard = createSyncContextGuardService({ adapter })

    const result = await guard.inspect({ context: validContext })

    expect(result.ok).toBe(true)
    expect(result.status).toBe('safe')
    expect(result.code).toBe('SYNC_CONTEXT_SAFE')
    expect(result.canonicalContext.businessId).toBe(100)
    expect(result.sources).not.toContain('auto_sync')
  })

  // ── 8. Runtime Context Strict Number Validation ───────────────────────────
  it('blocks with SYNC_CONTEXT_INVALID when string IDs are passed to runtime context without JS number coercion', async () => {
    const adapter = createMockAdapter()
    const guard = createSyncContextGuardService({ adapter })

    const stringContext = {
      ...validContext,
      selectedBusiness: { id: '100' }, // String instead of integer
    }
    const result = await guard.inspect({ context: stringContext })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('blocked')
    expect(result.code).toBe('SYNC_CONTEXT_INVALID')
  })

  // ── 9. Required Reader Capabilities & Throw Protection ─────────────────────
  it('blocks with SYNC_CONTEXT_READ_FAILED when a required reader function is missing from adapter', async () => {
    const adapter = createMockAdapter()
    delete adapter.loadSyncPullBinding

    const guard = createSyncContextGuardService({ adapter })
    const result = await guard.inspect({ context: validContext })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('blocked')
    expect(result.code).toBe('SYNC_CONTEXT_READ_FAILED')
    expect(result.issues).toEqual([
      { code: 'REQUIRED_READER_MISSING', source: 'adapter' },
    ])
  })

  it('blocks with SYNC_CONTEXT_READ_FAILED when a reader throws an unexpected error', async () => {
    const adapter = createMockAdapter({
      pullBinding: null,
    })
    adapter.loadSyncPullBinding.mockRejectedValue(new Error('SQLite disk I/O error'))

    const guard = createSyncContextGuardService({ adapter })
    const result = await guard.inspect({ context: validContext })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('blocked')
    expect(result.code).toBe('SYNC_CONTEXT_READ_FAILED')
    expect(result.issues).toEqual([
      { code: 'READ_FAILED', source: 'adapter' },
    ])
  })

  // ── 10. Read-Only Guard Guarantee (Zero Writes) ───────────────────────────
  it('guarantees zero writes on database adapter during inspect', async () => {
    const adapter = createMockAdapter({
      pullBinding: {
        businessId: 100,
        outletId: 200,
        deviceIdentifier: 'device-alpha-123',
        registeredDeviceId: 300,
        boundAt: '2026-08-28T10:00:00.000Z',
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

  // ── 11. Pinia Store: Missing Service Fail-Closed ───────────────────────────
  it('fails closed with SYNC_CONTEXT_READ_FAILED when syncContextGuardStore is checked without service', async () => {
    const store = useSyncContextGuardStore()
    store.resetPresentation()

    const result = await store.check()

    expect(result.ok).toBe(false)
    expect(result.status).toBe('blocked')
    expect(result.code).toBe('SYNC_CONTEXT_READ_FAILED')
    expect(store.status).toBe('blocked')
    expect(store.code).toBe('SYNC_CONTEXT_READ_FAILED')
  })

  // ── 12. Pinia Store: Stale Async Check Protection (Sequence Counter) ───────
  it('protects against stale async check results when switching business', async () => {
    let resolveFirstCheck
    const deferredFirst = new Promise((resolve) => {
      resolveFirstCheck = resolve
    })

    const adapterA = createMockAdapter({
      pullBinding: {
        businessId: 100,
        outletId: 200,
        deviceIdentifier: 'device-alpha-123',
        registeredDeviceId: 300,
        boundAt: '2026-08-28T10:00:00.000Z',
      },
    })
    const slowGuardA = {
      inspect: vi.fn(async () => deferredFirst),
    }

    const adapterB = createMockAdapter({
      pullBinding: {
        businessId: 100, // Stored is business 100
        outletId: 200,
        deviceIdentifier: 'device-alpha-123',
        registeredDeviceId: 300,
        boundAt: '2026-08-28T10:00:00.000Z',
      },
    })
    const fastGuardB = createSyncContextGuardService({ adapter: adapterB })

    const store = useSyncContextGuardStore()
    store.init({ contextGuardService: slowGuardA })

    // Check A starts for Business 100
    const promiseA = store.check({ context: validContext })

    // User switches to Business 999
    const contextB = {
      ...validContext,
      selectedBusiness: { id: 999, name: 'Business Beta' },
    }
    store.init({ contextGuardService: fastGuardB })
    const promiseB = store.check({ context: contextB })

    await promiseB
    expect(store.status).toBe('blocked')
    expect(store.code).toBe('SYNC_CONTEXT_BUSINESS_MISMATCH')

    // Now slow check A resolves with safe
    resolveFirstCheck({
      ok: true,
      status: 'safe',
      code: 'SYNC_CONTEXT_SAFE',
      currentContext: validContext,
      canonicalContext: validContext,
      sources: ['pull_binding'],
      issues: [],
    })
    await promiseA

    // Store MUST remain blocked for Business B! Result A must NOT overwrite B!
    expect(store.status).toBe('blocked')
    expect(store.code).toBe('SYNC_CONTEXT_BUSINESS_MISMATCH')
  })

  // ── 13. Safe Context Boundary: Token Stripping ────────────────────────────
  it('does not pass token, password, or credentials through guard context in pushNow', async () => {
    const adapter = createMockAdapter({
      pullBinding: {
        businessId: 100,
        outletId: 200,
        deviceIdentifier: 'device-alpha-123',
        registeredDeviceId: 300,
        boundAt: '2026-08-28T10:00:00.000Z',
      },
    })
    const inspectSpy = vi.fn(async () => ({
      ok: true,
      status: 'safe',
      code: 'SYNC_CONTEXT_SAFE',
      canonicalContext: null,
      sources: ['pull_binding'],
      issues: [],
    }))
    const contextGuardService = { inspect: inspectSpy }

    const pushService = createSyncPushService({
      adapter,
      tokenFetcher: vi.fn().mockResolvedValue('injected-bearer-token'),
      transport: vi.fn().mockResolvedValue({ ok: true, data: { status: 'success' } }),
      contextGuardService,
    })

    const contextWithSensitiveData = {
      ...validContext,
      token: 'secret-token-xyz',
      password: 'super-secret-password',
      credentials: { auth: 'bearer' },
    }

    await pushService.pushNow({ context: contextWithSensitiveData })

    expect(inspectSpy).toHaveBeenCalledTimes(1)
    const passedContext = inspectSpy.mock.calls[0][0].context
    expect(passedContext.token).toBeUndefined()
    expect(passedContext.password).toBeUndefined()
    expect(passedContext.credentials).toBeUndefined()
    expect(passedContext.user).toEqual({ id: 10 })
    expect(passedContext.selectedBusiness).toEqual({ id: 100 })
    expect(passedContext.selectedOutlet).toEqual({ id: 200 })
    expect(passedContext.cloudAccess).toBe(true)
    expect(passedContext.deviceIdentifier).toBe('device-alpha-123')
    expect(passedContext.registeredDeviceId).toBe(300)
  })

  // ── 14. Push Service Blocks when Guard Fails ──────────────────────────────
  it('blocks syncPushService pushNow() and returns SYNC_CONTEXT_GUARD_BLOCKED without sending HTTP or mutating queue', async () => {
    const adapter = createMockAdapter({
      pullBinding: {
        businessId: 999, // Mismatched tenant
        outletId: 200,
        deviceIdentifier: 'device-alpha-123',
        registeredDeviceId: 300,
        boundAt: '2026-08-28T10:00:00.000Z',
      },
    })
    const contextGuardService = createSyncContextGuardService({ adapter })
    const mockTransport = vi.fn(async () => ({ ok: true, data: { status: 'success' } }))

    const pushService = createSyncPushService({
      adapter,
      tokenFetcher: vi.fn().mockResolvedValue('test-token'),
      transport: mockTransport,
      contextGuardService,
    })

    const result = await pushService.pushNow({ context: validContext })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_CONTEXT_GUARD_BLOCKED')
    expect(result.contextGuardCode).toBe('SYNC_CONTEXT_BUSINESS_MISMATCH')
    expect(mockTransport).not.toHaveBeenCalled()
  })

  // ── 15. Pull Service Blocks when Guard Fails ──────────────────────────────
  it('blocks syncPullService pullNow() and returns SYNC_CONTEXT_GUARD_BLOCKED without making HTTP calls', async () => {
    const adapter = createMockAdapter({
      pullBinding: {
        businessId: 100,
        outletId: 999, // Mismatched outlet
        deviceIdentifier: 'device-alpha-123',
        registeredDeviceId: 300,
        boundAt: '2026-08-28T10:00:00.000Z',
      },
    })
    const contextGuardService = createSyncContextGuardService({ adapter })
    const mockTransport = vi.fn(async () => ({ ok: true, data: { records: [] } }))

    const pullService = createSyncPullService({
      adapter,
      tokenFetcher: vi.fn().mockResolvedValue('test-token'),
      transport: mockTransport,
      contextGuardService,
    })

    const result = await pullService.pullNow({ context: validContext })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_CONTEXT_GUARD_BLOCKED')
    expect(result.contextGuardCode).toBe('SYNC_CONTEXT_MISMATCH')
    expect(mockTransport).not.toHaveBeenCalled()
  })

  // ── 16. Bootstrap Service Blocks when Guard Fails ─────────────────────────
  it('blocks syncBootstrapService bootstrapNow() and returns SYNC_CONTEXT_GUARD_BLOCKED without staging bootstrap', async () => {
    const adapter = createMockAdapter({
      autoSettings: {
        version: 1,
        enabled: true,
        context: {
          businessId: 999, // Mismatched
          outletId: 200,
          deviceIdentifier: 'device-alpha-123',
          registeredDeviceId: 300,
        },
        updatedAt: '2026-08-28T10:00:00.000Z',
      },
    })
    const contextGuardService = createSyncContextGuardService({ adapter })
    const mockTransport = vi.fn(async () => ({ ok: true, data: { records: [] } }))

    const bootstrapService = createSyncBootstrapService({
      adapter,
      tokenFetcher: vi.fn().mockResolvedValue('test-token'),
      transport: mockTransport,
      contextGuardService,
    })

    const result = await bootstrapService.bootstrapNow({ context: validContext })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_CONTEXT_GUARD_BLOCKED')
    expect(result.contextGuardCode).toBe('SYNC_CONTEXT_BUSINESS_MISMATCH')
    expect(mockTransport).not.toHaveBeenCalled()
  })

  // ── 17. Auto Sync Activity Log Classification ─────────────────────────────
  it('records auto sync activity with status blocked when orchestrator returns SYNC_CONTEXT_GUARD_BLOCKED', async () => {
    const mockActivityLogService = {
      record: vi.fn(async () => {}),
    }
    const mockHealthService = {
      checkHealth: vi.fn(async () => ({
        ok: true,
        status: 'ready',
        code: 'SYNC_HEALTH_READY',
        issues: [],
      })),
    }
    const mockOrchestratorService = {
      syncAll: vi.fn(async () => ({
        ok: false,
        code: 'SYNC_CONTEXT_GUARD_BLOCKED',
        message: 'Sync push operation blocked by context guard.',
      })),
    }

    const adapter = createMockAdapter({
      autoSettings: {
        version: 1,
        enabled: true,
        context: {
          businessId: 100,
          outletId: 200,
          deviceIdentifier: 'device-alpha-123',
          registeredDeviceId: 300,
        },
        updatedAt: '2026-08-28T10:00:00.000Z',
      },
    })

    const autoSyncService = createSyncAutoSyncService({
      adapter,
      healthService: mockHealthService,
      orchestratorService: mockOrchestratorService,
      activityLogService: mockActivityLogService,
    })

    const result = await autoSyncService.runOnce({
      trigger: 'online',
      online: true,
      isForeground: true,
      context: validContext,
    })

    expect(result.ok).toBe(false)
    expect(mockActivityLogService.record).toHaveBeenCalledTimes(1)
    const recorded = mockActivityLogService.record.mock.calls[0][0]
    expect(recorded.type).toBe('full_sync')
    expect(recorded.action).toBe('AUTO_SYNC')
    expect(recorded.status).toBe('blocked')
    expect(recorded.code).toBe('SYNC_CONTEXT_GUARD_BLOCKED')
  })

  // ── 18. Return to Canonical Context Unblocks Store ─────────────────────────
  it('unblocks to SAFE when switching back from mismatched context B to canonical context A', async () => {
    const adapter = createMockAdapter({
      pullBinding: {
        businessId: 100,
        outletId: 200,
        deviceIdentifier: 'device-alpha-123',
        registeredDeviceId: 300,
        boundAt: '2026-08-28T10:00:00.000Z',
      },
    })
    const guard = createSyncContextGuardService({ adapter })
    const store = useSyncContextGuardStore()
    store.init({ contextGuardService: guard })

    // Step 1: Context B (Mismatched business 999) -> blocked
    const contextB = { ...validContext, selectedBusiness: { id: 999, name: 'Business B' } }
    const resB = await store.check({ context: contextB })
    expect(resB.ok).toBe(false)
    expect(store.status).toBe('blocked')
    expect(store.code).toBe('SYNC_CONTEXT_BUSINESS_MISMATCH')

    // Step 2: Switch back to Canonical Context A -> safe
    const resA = await store.check({ context: validContext })
    expect(resA.ok).toBe(true)
    expect(store.status).toBe('safe')
    expect(store.code).toBe('SYNC_CONTEXT_SAFE')
    expect(store.canonicalContext.businessId).toBe(100)
  })

  // ── 19. Bootstrap Status Invalid ───────────────────────────────────────────
  it('rejects invalid, foo, failed, or empty bootstrap status and returns SYNC_CONTEXT_METADATA_INVALID', async () => {
    const statuses = ['invalid', 'failed', 'foo', '']
    for (const status of statuses) {
      const adapter = createMockAdapter({
        bootstrapState: createValidBootstrapState({ status }),
      })
      const guard = createSyncContextGuardService({ adapter })
      const result = await guard.inspect({ context: validContext })
      expect(result.ok).toBe(false)
      expect(result.code).toBe('SYNC_CONTEXT_METADATA_INVALID')
    }
  })

  // ── 20. Auto Settings Key Constraint ───────────────────────────────────────
  it('rejects extra keys in auto settings and returns SYNC_CONTEXT_METADATA_INVALID', async () => {
    const adapter = createMockAdapter({
      autoSettings: {
        version: 1,
        enabled: true,
        context: {
          businessId: 100,
          outletId: 200,
          deviceIdentifier: 'device-alpha-123',
          registeredDeviceId: 300,
        },
        updatedAt: '2026-08-28T10:00:00.000Z',
        extraKey: 'should-not-exist',
      },
    })
    const guard = createSyncContextGuardService({ adapter })
    const result = await guard.inspect({ context: validContext })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_CONTEXT_METADATA_INVALID')
  })

  // ── 21. Auto Settings updatedAt Parsing Constraint ─────────────────────────
  it('rejects non-date parseable updatedAt in auto settings', async () => {
    const invalidDates = ['', 'not-a-date', 'abc']
    for (const badDate of invalidDates) {
      const adapter = createMockAdapter({
        autoSettings: {
          version: 1,
          enabled: true,
          context: {
            businessId: 100,
            outletId: 200,
            deviceIdentifier: 'device-alpha-123',
            registeredDeviceId: 300,
          },
          updatedAt: badDate,
        },
      })
      const guard = createSyncContextGuardService({ adapter })
      const result = await guard.inspect({ context: validContext })
      expect(result.ok).toBe(false)
      expect(result.code).toBe('SYNC_CONTEXT_METADATA_INVALID')
    }
  })

  // ── 22. Auto Settings Context Key Constraint ───────────────────────────────
  it('rejects extra keys in auto settings context', async () => {
    const adapter = createMockAdapter({
      autoSettings: {
        version: 1,
        enabled: true,
        context: {
          businessId: 100,
          outletId: 200,
          deviceIdentifier: 'device-alpha-123',
          registeredDeviceId: 300,
          token: 'sensitive-token',
        },
        updatedAt: '2026-08-28T10:00:00.000Z',
      },
    })
    const guard = createSyncContextGuardService({ adapter })
    const result = await guard.inspect({ context: validContext })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_CONTEXT_METADATA_INVALID')
  })

  // ── 23. UI Mutation Controls Disabled During Loading ───────────────────────
  it('disables mutation controls in CloudLoginView when guard store is loading', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const sessionStore = useCloudSessionStore()
    sessionStore.user = { id: 10, email: 'cashier@pos.local' }
    sessionStore.selectedBusiness = { id: 100, name: 'Business Alpha' }
    sessionStore.selectedOutlet = { id: 200, name: 'Outlet Central' }
    sessionStore.deviceIdentifier = 'device-alpha-123'
    sessionStore.registeredDeviceId = 300
    sessionStore.cloudAccess = true

    const guardStore = useSyncContextGuardStore()
    guardStore.init({ contextGuardService: null }) // Mark explicitly initialized for P23 test behavior
    vi.spyOn(guardStore, 'check').mockImplementation(() => {
      guardStore.loading = true
      guardStore.status = 'safe'
      return new Promise(() => {}) // Stay loading indefinitely
    })
    guardStore.loading = true
    guardStore.status = 'safe'

    const wrapper = mount(CloudLoginView, {
      global: {
        plugins: [pinia],
      },
    })

    await flushPromises()

    const bootstrapBtn = wrapper.find('#bootstrap-btn')
    expect(bootstrapBtn.exists()).toBe(true)
    expect(bootstrapBtn.attributes('disabled')).toBeDefined()
  })

  // ── 24. Conflict Resolution Mutation Fresh Guard Check Mismatch ────────────
  it('handleUseServer and handleKeepLocal return early without mutation if fresh check detects mismatch', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const sessionStore = useCloudSessionStore()
    sessionStore.user = { id: 10, email: 'cashier@pos.local' }
    sessionStore.selectedBusiness = { id: 100, name: 'Business Alpha' }
    sessionStore.selectedOutlet = { id: 200, name: 'Outlet Central' }
    sessionStore.deviceIdentifier = 'device-alpha-123'
    sessionStore.registeredDeviceId = 300
    sessionStore.cloudAccess = true

    // Mock guard store
    const guardStore = useSyncContextGuardStore()
    guardStore.init({ contextGuardService: null }) // Mark explicitly initialized for P23 test behavior
    guardStore.status = 'safe'
    const mockCheck = vi.spyOn(guardStore, 'check').mockImplementation(async () => {
      guardStore.status = 'blocked'
      return { ok: false, status: 'blocked', code: 'SYNC_CONTEXT_BUSINESS_MISMATCH' }
    })

    // Mock conflict store
    const conflictStore = useSyncConflictStore()
    vi.spyOn(conflictStore, 'loadConflicts').mockImplementation(async () => {})
    conflictStore.conflicts = [{ id: 'c-1', serverEntity: 'product', entityId: 'p-1', serverSyncVersion: 1, status: 'open' }]
    const mockUseServer = vi.spyOn(conflictStore, 'useServer').mockResolvedValue({ ok: true })
    const mockKeepLocal = vi.spyOn(conflictStore, 'keepLocal').mockResolvedValue({ ok: true })

    const wrapper = mount(CloudLoginView, {
      global: {
        plugins: [pinia],
      },
    })
    await flushPromises()

    // 1. Test useServer btn click
    const useServerBtn = wrapper.find('#use-server-btn-c-1')
    expect(useServerBtn.exists()).toBe(true)
    await useServerBtn.trigger('click')
    await flushPromises()

    expect(mockCheck).toHaveBeenCalled()
    expect(mockUseServer).not.toHaveBeenCalled()

    // Reset store status back to safe and clear spy calls
    guardStore.status = 'safe'
    mockCheck.mockClear()
    await flushPromises()

    // 2. Test keepLocal btn click
    const keepLocalBtn = wrapper.find('#keep-local-btn-c-1')
    expect(keepLocalBtn.exists()).toBe(true)
    await keepLocalBtn.trigger('click')
    await flushPromises()

    expect(mockCheck).toHaveBeenCalled()
    expect(mockKeepLocal).not.toHaveBeenCalled()
  })
})
