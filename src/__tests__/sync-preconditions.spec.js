/**
 * Cloud sync precondition diagnostics.
 *
 * Regression cover for the "Tarik data dari server tidak bisa" report: push and
 * pull rejected the operation with one opaque sentence while the sync screen
 * kept showing "Semua Tersinkron". The diagnostics must name the exact missing
 * requirement (outlet, device registration, …) so the UI can explain it.
 */

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMemoryAdapter } from '../services/database/memoryAdapter'
import {
  SYNC_REQUIREMENT,
  SYNC_REQUIREMENT_ORDER,
  buildSyncReadiness,
  collectMissingSyncRequirements,
  describeSyncPreconditions,
} from '../services/sync/syncPreconditions'
import { createSyncIdentityRegistry } from '../services/sync/syncIdentityRegistry'
import { createSyncPullService } from '../services/sync/syncPullService'
import { createSyncPushService } from '../services/sync/syncPushService'
import { createSyncQueueService } from '../services/sync/syncQueueService'

const DEVICE_IDENTIFIER = '123e4567-e89b-12d3-a456-426614174000'

function makeContext(overrides = {}) {
  return {
    token: 'secret-token',
    user: { id: 1, name: 'Owner', email: 'owner@example.com' },
    selectedBusiness: { id: 10, name: 'Kedai Kopi' },
    selectedOutlet: { id: 101, name: 'Outlet Pusat' },
    cloudAccess: true,
    deviceIdentifier: DEVICE_IDENTIFIER,
    registeredDeviceId: 55,
    ...overrides,
  }
}

describe('sync precondition diagnostics', () => {
  it('reports ready for a complete Cloud context', () => {
    const result = describeSyncPreconditions(makeContext())
    expect(result.ok).toBe(true)
    expect(result.missing).toEqual([])
    expect(result.message).toBeNull()
  })

  it('names the missing outlet instead of a generic failure', () => {
    const result = describeSyncPreconditions(makeContext({ selectedOutlet: null }))
    expect(result.ok).toBe(false)
    expect(result.missing).toEqual([SYNC_REQUIREMENT.OUTLET])
    expect(result.message).toContain('Outlet Cloud dipilih')
    expect(result.hints[0]).toContain('outlet')
  })

  it('names an unregistered device and an unreadable device identifier separately', () => {
    const result = describeSyncPreconditions(
      makeContext({ registeredDeviceId: null, deviceIdentifier: null }),
    )
    expect(result.missing).toEqual([
      SYNC_REQUIREMENT.DEVICE_IDENTIFIER,
      SYNC_REQUIREMENT.DEVICE_REGISTRATION,
    ])
    expect(result.message).toContain('Identitas perangkat terbaca')
    expect(result.message).toContain('Perangkat terdaftar di Dashboard')
  })

  it('keeps the canonical order for multiple missing requirements', () => {
    const missing = collectMissingSyncRequirements({
      token: '',
      user: null,
      selectedBusiness: null,
      selectedOutlet: null,
      cloudAccess: false,
      deviceIdentifier: '',
      registeredDeviceId: null,
    })

    expect(missing).toEqual([...SYNC_REQUIREMENT_ORDER])
  })

  it('treats a missing cloud entitlement as a requirement of its own', () => {
    const result = describeSyncPreconditions(makeContext({ cloudAccess: false }))
    expect(result.missing).toEqual([SYNC_REQUIREMENT.CLOUD_ACCESS])
    expect(result.message).toContain('Akses Cloud aktif')
  })

  it('does not require device registration for roles that never pair (owner/member)', () => {
    const context = makeContext({ registeredDeviceId: null })

    const forCashier = describeSyncPreconditions({ ...context, requireDeviceRegistration: true })
    expect(forCashier.missing).toEqual([SYNC_REQUIREMENT.DEVICE_REGISTRATION])

    const forOwner = describeSyncPreconditions({ ...context, requireDeviceRegistration: false })
    expect(forOwner.ok).toBe(true)
    expect(forOwner.missing).toEqual([])
  })

  it('still requires a readable device identifier even when pairing is not required', () => {
    const result = describeSyncPreconditions(
      makeContext({ registeredDeviceId: null, deviceIdentifier: null, requireDeviceRegistration: false }),
    )

    expect(result.missing).toEqual([SYNC_REQUIREMENT.DEVICE_IDENTIFIER])
  })
})

describe('sync readiness snapshot', () => {
  it('is not ready when the session is not authenticated', () => {
    const readiness = buildSyncReadiness({
      authenticated: false,
      user: null,
      selectedBusiness: { id: 10 },
      selectedOutlet: { id: 101 },
      cloudAccess: true,
      deviceIdentifier: DEVICE_IDENTIFIER,
      registeredDeviceId: 55,
    })

    expect(readiness.ready).toBe(false)
    expect(readiness.missing).toEqual([SYNC_REQUIREMENT.AUTHENTICATION])
  })

  it('is ready for a fully linked outlet with a registered device', () => {
    const readiness = buildSyncReadiness({
      authenticated: true,
      user: { id: 1 },
      selectedBusiness: { id: 10 },
      selectedOutlet: { id: 101 },
      cloudAccess: true,
      deviceIdentifier: DEVICE_IDENTIFIER,
      registeredDeviceId: 55,
    })

    expect(readiness.ready).toBe(true)
    expect(readiness.missing).toEqual([])
  })
})

describe('pull & push report the missing requirement', () => {
  let pinia
  let adapter
  let queueService
  let registry

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)

    adapter = createMemoryAdapter()
    await adapter.initialize()

    queueService = createSyncQueueService({ adapter })
    registry = createSyncIdentityRegistry({ adapter })
  })

  it('pull fails closed with the missing outlet listed', async () => {
    const transport = vi.fn()
    const pullService = createSyncPullService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'secret-token',
      transport,
    })

    const result = await pullService.pullNow({
      context: makeContext({ selectedOutlet: null }),
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('PRECONDITION_FAILED')
    expect(result.missing).toEqual([SYNC_REQUIREMENT.OUTLET])
    expect(result.message).toContain('Outlet Cloud dipilih')
    expect(result.error.missing).toEqual([SYNC_REQUIREMENT.OUTLET])
    expect(transport).not.toHaveBeenCalled()
  })

  it('push fails closed with the unregistered device listed', async () => {
    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      cloudStore: null,
      tokenFetcher: async () => 'secret-token',
      transport: vi.fn(),
    })

    const result = await pushService.pushNow({
      context: makeContext({ registeredDeviceId: null }),
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('PRECONDITION_FAILED')
    expect(result.missing).toEqual([SYNC_REQUIREMENT.DEVICE_REGISTRATION])
    expect(result.message).toContain('Perangkat terdaftar di Dashboard')
  })
})
