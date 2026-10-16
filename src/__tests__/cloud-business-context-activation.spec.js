import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { _resetTokenStore, saveToken } from '@/services/cloud/tokenRepository'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { useBusinessStore } from '@/stores/businessStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'

const CLOUD_BUSINESS = {
  id: 72,
  name: 'Kopi Nusantara',
  business_type: 'Cafe / UMKM',
  business_type_raw: 'cafe',
  business_type_status: 'valid',
  cloud_access: true,
  subscription: { plan: 'premium' },
  outlets: [{ id: 8, name: 'Outlet Pusat', status: 'active' }],
}

async function makeContext() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const adapter = createMemoryAdapter()
  await adapter.initialize()
  const cloudStore = useCloudSessionStore(pinia)
  cloudStore.setPersistenceAdapter(adapter)
  cloudStore.user = { id: 1, name: 'Owner', email: 'owner@example.com' }
  cloudStore.businesses = [CLOUD_BUSINESS]
  return { pinia, adapter, cloudStore, businessStore: useBusinessStore(pinia) }
}

beforeEach(() => {
  _resetTokenStore()
})

describe('Cloud business operational activation', () => {
  it.each([
    ['Cafe / UMKM', 'Kopi Nusantara'],
    ['Laundry', 'Laundry Bersih'],
    ['Grosir / Toko Kelontong', 'Toko Grosir'],
  ])('activates a new workspace using Cloud type %s', async (type, name) => {
    const { cloudStore, businessStore } = await makeContext()
    cloudStore.businesses = [{ ...CLOUD_BUSINESS, name, business_type: type }]

    expect((await cloudStore.selectBusiness(CLOUD_BUSINESS.id)).ok).toBe(true)
    expect((await cloudStore.selectOutlet(8)).ok).toBe(true)
    expect((await cloudStore.activateOperationalContext()).ok).toBe(true)

    expect(businessStore.name).toBe(name)
    expect(businessStore.normalizedType).toBe(type)
    expect(businessStore.outlet).toBe('Outlet Pusat')
    expect(cloudStore.operationalContext.status).toBe('active')
  })

  it('rejects missing Cloud business_type without falling back to Cafe', async () => {
    const { cloudStore, businessStore } = await makeContext()
    cloudStore.businesses = [{ ...CLOUD_BUSINESS, business_type: null, business_type_status: 'unknown' }]

    const result = await cloudStore.selectBusiness(CLOUD_BUSINESS.id)

    expect(result.ok).toBe(true)
    expect(cloudStore.selectedBusiness.business_type).toBeNull()
    expect(businessStore.name).toBe('')
    expect(businessStore.type).toBe('')
    await cloudStore.selectOutlet(8)
    expect((await cloudStore.activateOperationalContext()).code).toBe('CLOUD_BUSINESS_TYPE_UNKNOWN')
    expect(cloudStore.isOperationalCloudAccess).toBe(false)
  })

  it('blocks Cafe Cloud against protected Laundry data without changing local identity', async () => {
    const { adapter, cloudStore, businessStore } = await makeContext()
    const local = {
      name: 'Temuan', type: 'Laundry', owner: '', phone: '', outlet: 'Outlet Utama', mode: 'free',
    }
    await adapter.saveBusiness(local)
    businessStore.setBusiness(local)

    const result = await cloudStore.selectBusiness(CLOUD_BUSINESS.id)

    expect(result.ok).toBe(false)
    expect(result.code).toBe('LOCAL_BUSINESS_CONTEXT_MISMATCH')
    expect(businessStore.name).toBe('Temuan')
    expect(businessStore.normalizedType).toBe('Laundry')
    expect(cloudStore.cloudAccess).toBe(false)
    expect(cloudStore.error).toBe(
      'Bisnis lokal saat ini adalah Temuan (Laundry), sedangkan bisnis Cloud yang dipilih adalah Kopi Nusantara (Cafe). Data kedua bisnis tidak boleh digabungkan. Gunakan ruang kerja bisnis terpisah sebelum mengaktifkan bisnis Cloud ini.',
    )
  })

  it('rejects activation when durable sync binding exists', async () => {
    const { adapter, cloudStore, businessStore } = await makeContext()
    await adapter.saveSyncPushBinding({ businessId: 7, boundAt: new Date().toISOString() })

    const result = await cloudStore.selectBusiness(CLOUD_BUSINESS.id)

    expect(result.ok).toBe(false)
    expect(result.code).toBe('LOCAL_BUSINESS_CONTEXT_MISMATCH')
    expect(businessStore.name).toBe('')
    expect(cloudStore.cloudAccess).toBe(false)
  })

  it('keeps an activated workspace valid after restart without changing its local identity', async () => {
    const { pinia, adapter, cloudStore, businessStore } = await makeContext()
    await cloudStore.selectBusiness(CLOUD_BUSINESS.id)
    await cloudStore.selectOutlet(8)
    await cloudStore.activateOperationalContext()
    await saveToken('token')

    const restartedPinia = createPinia()
    setActivePinia(restartedPinia)
    const restarted = useCloudSessionStore(restartedPinia)
    const result = await restarted.hydrateFromStorage(adapter)

    expect(result.ok).toBe(true)
    expect(restarted.operationalContext.status).toBe('active')
    expect(restarted.cloudAccess).toBe(true)
    expect(businessStore.name).toBe('Kopi Nusantara')
  })

  it('detects a legacy persisted Cloud link against another local business at restart', async () => {
    const { adapter, cloudStore, businessStore } = await makeContext()
    const local = {
      name: 'Temuan', type: 'Laundry', owner: '', phone: '', outlet: 'Outlet Utama', mode: 'free',
    }
    await adapter.saveBusiness(local)
    businessStore.setBusiness(local)
    await adapter.saveCloudContext({
      user: { id: 1, name: 'Owner', email: 'owner@example.com' },
      selectedBusiness: CLOUD_BUSINESS,
      selectedOutlet: { id: 8, name: 'Outlet Pusat' },
      cloudAccess: true,
      registeredDeviceId: 44,
    })
    await saveToken('token')

    const restartPinia = createPinia()
    setActivePinia(restartPinia)
    const restarted = useCloudSessionStore(restartPinia)
    await restarted.hydrateFromStorage(adapter)

    expect(restarted.operationalContext.status).toBe('mismatch')
    expect(restarted.cloudAccess).toBe(false)
    expect(restarted.isOperationalCloudAccess).toBe(false)
    expect((await adapter.loadBusiness()).name).toBe('Temuan')
  })
})
