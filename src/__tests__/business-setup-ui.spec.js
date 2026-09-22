import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import BaseInput from '@/components/base/BaseInput.vue'
import { useBusinessStore } from '@/stores/businessStore'
import { useProductStore } from '@/stores/productStore'
import BusinessSetupView from '@/views/onboarding/BusinessSetupView.vue'

const routerMock = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock('vue-router', () => ({
  useRouter: () => routerMock,
}))

function setupView() {
  const pinia = createPinia()
  setActivePinia(pinia)

  return {
    wrapper: mount(BusinessSetupView, { global: { plugins: [pinia] } }),
    businessStore: useBusinessStore(),
    productStore: useProductStore(),
  }
}

function getInput(wrapper, label) {
  return wrapper.findAllComponents(BaseInput).find((input) => input.props('label') === label)
}

function getNextButton(wrapper) {
  return wrapper.findAll('button').find((button) => button.text().includes('Lanjut Setup PIN'))
}

describe('business setup mobile-first UI', () => {
  beforeEach(() => {
    routerMock.push.mockClear()
  })

  it('places form identity before business selection and provides compact onboarding header', () => {
    const { wrapper } = setupView()

    expect(wrapper.find('h1').text()).toBe('Siapkan profil toko')
    expect(wrapper.text()).toContain('Langkah 1 dari 2')
    expect(wrapper.find('#identity-title').exists()).toBe(true)
    expect(wrapper.find('#business-type-title').exists()).toBe(true)
    expect(wrapper.find('#identity-title').element.compareDocumentPosition(
      wrapper.find('#business-type-title').element,
    ) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('requires a non-blank store name and a business type before continuing', async () => {
    const { wrapper, businessStore } = setupView()
    const next = getNextButton(wrapper)

    expect(next.element.disabled).toBe(true)

    await getInput(wrapper, 'Nama Toko').find('input').setValue('   ')
    await wrapper.findAll('[role="radio"]').find((item) => item.text().includes('Laundry')).trigger('click')
    expect(next.element.disabled).toBe(true)

    await getInput(wrapper, 'Nama Toko').find('input').setValue('Laundry Bersih')
    expect(next.element.disabled).toBe(false)
    await next.trigger('click')

    expect(businessStore.name).toBe('Laundry Bersih')
    expect(businessStore.type).toBe('Laundry')
    expect(routerMock.push).toHaveBeenCalledWith('/setup/pin')
  })

  it('keeps owner and phone optional and updates preview as user types', async () => {
    const { wrapper, businessStore } = setupView()

    await getInput(wrapper, 'Nama Toko').find('input').setValue('Toko Maju')
    expect(wrapper.text()).toContain('Toko Maju')
    await wrapper.findAll('[role="radio"]').find((item) => item.text().includes('Grosir / Toko Kelontong')).trigger('click')
    await getNextButton(wrapper).trigger('click')

    expect(businessStore.owner).toBe('')
    expect(businessStore.phone).toBe('')
    expect(businessStore.type).toBe('Grosir / Toko Kelontong')
    expect(routerMock.push).toHaveBeenCalledWith('/setup/pin')
  })
})
