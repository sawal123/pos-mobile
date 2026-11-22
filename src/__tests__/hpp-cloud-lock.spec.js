import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import ProductsView from '@/views/products/ProductsView.vue'
import ProductFormView from '@/views/products/ProductFormView.vue'
import HppCloudLockModal from '@/components/products/HppCloudLockModal.vue'
import { createAppRouter } from '@/router'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useSubscriptionStore } from '@/stores/subscriptionStore'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { createPersistenceService } from '@/services/database/persistenceService'

describe('HPP & Persediaan Bahan Cloud Lock Feature - Mobile POS', () => {
  let pinia
  let memoryAdapter

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)

    memoryAdapter = createMemoryAdapter()
    await memoryAdapter.initialize()

    createPersistenceService({ adapter: memoryAdapter, pinia })
  })

  it('1. HppCloudLockModal renders locked state for free/offline mode and active state when Cloud is enabled', async () => {
    const router = createAppRouter()
    await router.push('/')
    await router.isReady()

    // Test locked state
    const lockedWrapper = mount(HppCloudLockModal, {
      props: { open: true },
      global: { plugins: [pinia, router] },
    })
    expect(lockedWrapper.find('[data-testid="hpp-cloud-lock-modal"]').exists()).toBe(true)
    expect(lockedWrapper.find('[data-testid="hpp-lock-message"]').text()).toContain('upgrade ke Paket Cloud')
    expect(lockedWrapper.find('[data-testid="hpp-lock-upgrade-btn"]').exists()).toBe(true)

    // Test active state
    const { useCloudSessionStore } = await import('@/stores/cloudSessionStore')
    const cloudStore = useCloudSessionStore()
    cloudStore.user = { id: 1, email: 'test@pos.test' }
    cloudStore.cloudAccess = true

    const activeWrapper = mount(HppCloudLockModal, {
      props: { open: true },
      global: { plugins: [pinia, router] },
    })
    expect(activeWrapper.find('[data-testid="hpp-cloud-active-modal"]').exists()).toBe(true)
    expect(activeWrapper.text()).toContain('Dikelola melalui Dashboard Cloud')
  })

  it('2. ProductsView displays locked HPP & Bahan button and opens HppCloudLockModal when clicked', async () => {
    const businessStore = useBusinessStore()
    const cashierStore = useCashierStore()
    businessStore.setBusiness({
      name: 'Kedai Kopi Lokal',
      type: 'Cafe',
      owner: 'Owner',
      phone: '08123456789',
      outlet: 'Utama',
      mode: 'free',
    })
    cashierStore.setPinConfigured(true)

    const router = createAppRouter()
    await router.push('/products')
    await router.isReady()

    const wrapper = mount(ProductsView, {
      global: {
        plugins: [pinia, router],
        stubs: {
          teleport: true,
        },
      },
    })

    const hppBtn = wrapper.find('[data-testid="products-hpp-btn"]')
    expect(hppBtn.exists()).toBe(true)
    expect(hppBtn.text()).toContain('HPP & Bahan')
    expect(hppBtn.text()).toContain('Cloud')

    await hppBtn.trigger('click')

    const lockModal = wrapper.find('[data-testid="hpp-cloud-lock-modal"]')
    expect(lockModal.exists()).toBe(true)
    expect(lockModal.text()).toContain('Hitung HPP & Persediaan Bahan Terkunci')
    expect(lockModal.text()).toContain('upgrade ke Paket Cloud')

    const upgradeBtn = wrapper.find('[data-testid="hpp-lock-upgrade-btn"]')
    expect(upgradeBtn.exists()).toBe(true)
    await upgradeBtn.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('subscription')
  })

  it('3. ProductFormView displays locked Hitung HPP & Persediaan Bahan card and helper button', async () => {
    const businessStore = useBusinessStore()
    const cashierStore = useCashierStore()
    businessStore.setBusiness({
      name: 'Kedai Kopi Lokal',
      type: 'Cafe',
      owner: 'Owner',
      phone: '08123456789',
      outlet: 'Utama',
      mode: 'free',
    })
    cashierStore.setPinConfigured(true)

    const router = createAppRouter()
    await router.push('/products/create')
    await router.isReady()

    const wrapper = mount(ProductFormView, {
      global: {
        plugins: [pinia, router],
        stubs: {
          teleport: true,
        },
      },
    })

    // Check helper trigger next to HPP input
    const helperBtn = wrapper.find('[data-testid="btn-hpp-recipe-helper"]')
    expect(helperBtn.exists()).toBe(true)
    expect(helperBtn.text()).toContain('Hitung dari Bahan (Cloud)')

    await helperBtn.trigger('click')
    expect(wrapper.find('[data-testid="hpp-cloud-lock-modal"]').exists()).toBe(true)

    // Check locked section 3c
    const lockedSection = wrapper.find('[data-testid="product-form-hpp-locked"]')
    expect(lockedSection.exists()).toBe(true)
    expect(lockedSection.text()).toContain('Hitung HPP & Persediaan Bahan Terkunci')
    expect(lockedSection.text()).toContain('upgrade ke Paket Cloud')

    const lockedAddBtn = wrapper.find('[data-testid="btn-locked-add-hpp"]')
    expect(lockedAddBtn.exists()).toBe(true)
    await lockedAddBtn.trigger('click')
    expect(wrapper.find('[data-testid="hpp-cloud-lock-modal"]').exists()).toBe(true)

    const upgradeBtn = wrapper.find('[data-testid="btn-upgrade-cloud-hpp"]')
    expect(upgradeBtn.exists()).toBe(true)
    await upgradeBtn.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('subscription')
  })
})
