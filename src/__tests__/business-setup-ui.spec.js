import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import BaseButton from '@/components/base/BaseButton.vue'
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

function getSubmitBaseButton(wrapper) {
  return wrapper.findAllComponents(BaseButton).find((btn) => btn.text().includes('Lanjut Setup PIN'))
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

  // A. Tombol utama mempunyai type="submit"
  it('A. tombol utama mempunyai type="submit"', () => {
    const { wrapper } = setupView()
    const nextButton = getNextButton(wrapper)

    expect(nextButton.exists()).toBe(true)
    expect(nextButton.attributes('type')).toBe('submit')
  })

  // B. Submit form yang valid menyimpan nama toko, jenis bisnis, dan pengaturan lainnya
  it('B. submit form yang valid menyimpan nama toko, jenis bisnis, dan pengaturan lainnya', async () => {
    const { wrapper, businessStore } = setupView()

    await getInput(wrapper, 'Nama Toko').find('input').setValue('Laundry Bersih')
    await getInput(wrapper, 'Nama Owner').find('input').setValue('Ibu Ani')
    await getInput(wrapper, 'Nomor Telepon').find('input').setValue('08123456789')
    await wrapper.findAll('[role="radio"]').find((item) => item.text().includes('Laundry')).trigger('click')

    expect(getNextButton(wrapper).element.disabled).toBe(false)
    await wrapper.find('form').trigger('submit')

    expect(businessStore.name).toBe('Laundry Bersih')
    expect(businessStore.type).toBe('Laundry')
    expect(businessStore.owner).toBe('Ibu Ani')
    expect(businessStore.phone).toBe('08123456789')
    expect(businessStore.outlet).toBe('Outlet Utama')
    expect(routerMock.push).toHaveBeenCalledWith('/setup/pin')
  })

  // C. Simulasikan submit berulang dan pastikan router.push('/setup/pin') dipanggil tepat satu kali
  it('C. simulasikan submit berulang dan pastikan router.push dipanggil tepat satu kali', async () => {
    const { wrapper } = setupView()

    await getInput(wrapper, 'Nama Toko').find('input').setValue('Toko Aman')
    await wrapper.findAll('[role="radio"]').find((item) => item.text().includes('Grosir / Toko Kelontong')).trigger('click')

    const form = wrapper.find('form')
    await form.trigger('submit')
    await form.trigger('submit')
    await form.trigger('submit')

    expect(routerMock.push).toHaveBeenCalledTimes(1)
    expect(routerMock.push).toHaveBeenCalledWith('/setup/pin')
  })

  // D. Template produk hanya diterapkan sekali ketika onboarding pertama dilakukan
  it('D. template produk hanya diterapkan sekali ketika onboarding pertama dilakukan', async () => {
    const { wrapper, productStore } = setupView()
    const applySpy = vi.spyOn(productStore, 'applyBusinessTemplate')

    await getInput(wrapper, 'Nama Toko').find('input').setValue('Cafe Senja')
    await wrapper.findAll('[role="radio"]').find((item) => item.text().includes('Cafe / UMKM')).trigger('click')

    const form = wrapper.find('form')
    await form.trigger('submit')
    await form.trigger('submit')

    expect(applySpy).toHaveBeenCalledTimes(1)
    expect(applySpy).toHaveBeenCalledWith('Cafe / UMKM')
  })

  // E. Form dengan nama bisnis kosong atau hanya berisi whitespace tidak boleh melanjutkan onboarding
  it('E. form dengan nama bisnis kosong atau whitespace tidak boleh melanjutkan onboarding', async () => {
    const { wrapper, businessStore } = setupView()

    await wrapper.findAll('[role="radio"]').find((item) => item.text().includes('Laundry')).trigger('click')
    await getInput(wrapper, 'Nama Toko').find('input').setValue('    ')

    expect(getNextButton(wrapper).element.disabled).toBe(true)

    await wrapper.find('form').trigger('submit')

    expect(businessStore.name).toBe('')
    expect(businessStore.type).toBe('')
    expect(routerMock.push).not.toHaveBeenCalled()
  })

  // F. Form tanpa jenis bisnis tidak boleh melanjutkan onboarding
  it('F. form tanpa jenis bisnis tidak boleh melanjutkan onboarding', async () => {
    const { wrapper, businessStore } = setupView()

    await getInput(wrapper, 'Nama Toko').find('input').setValue('Toko Tanpa Tipe')

    expect(getNextButton(wrapper).element.disabled).toBe(true)

    await wrapper.find('form').trigger('submit')

    expect(businessStore.name).toBe('')
    expect(businessStore.type).toBe('')
    expect(routerMock.push).not.toHaveBeenCalled()
  })

  // G. Pastikan tidak ada handler @click tambahan yang menyebabkan double submit
  it('G. pastikan BaseButton submit tidak memiliki handler @click tambahan yang menduplikasi submit', () => {
    const { wrapper } = setupView()
    const submitBtn = getSubmitBaseButton(wrapper)

    expect(submitBtn.exists()).toBe(true)
    expect(submitBtn.props('type')).toBe('submit')
    // Memastikan tidak ada listener v-on:click pada BaseButton
    expect(submitBtn.element.getAttribute('onclick')).toBeNull()
    expect(submitBtn.vm.$attrs.onClick).toBeUndefined()
  })

  it('keeps owner and phone optional and updates preview as user types', async () => {
    const { wrapper, businessStore } = setupView()

    await getInput(wrapper, 'Nama Toko').find('input').setValue('Toko Maju')
    expect(wrapper.text()).toContain('Toko Maju')
    await wrapper.findAll('[role="radio"]').find((item) => item.text().includes('Grosir / Toko Kelontong')).trigger('click')
    await wrapper.find('form').trigger('submit')

    expect(businessStore.owner).toBe('')
    expect(businessStore.phone).toBe('')
    expect(businessStore.type).toBe('Grosir / Toko Kelontong')
    expect(routerMock.push).toHaveBeenCalledWith('/setup/pin')
  })
})
