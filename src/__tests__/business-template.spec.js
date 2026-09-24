import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import BaseInput from '@/components/base/BaseInput.vue'
import { getBusinessTemplate } from '@/data/businessTemplates'
import { useBusinessStore } from '@/stores/businessStore'
import { useProductStore } from '@/stores/productStore'
import BusinessSetupView from '@/views/onboarding/BusinessSetupView.vue'

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRouter: () => routerMock,
}))

const expectedCategories = {
  'Cafe / UMKM': ['Minuman', 'Makanan', 'Snack', 'Dessert', 'Lainnya'],
  Laundry: ['Kiloan', 'Satuan', 'Express', 'Sprei & Bed Cover', 'Lainnya'],
  'Grosir / Toko Kelontong': ['Produk', 'Kebutuhan Harian', 'Minuman', 'Snack', 'Lainnya'],
}

function createContext() {
  const pinia = createPinia()
  setActivePinia(pinia)

  return {
    pinia,
    businessStore: useBusinessStore(),
    productStore: useProductStore(),
  }
}

function mountBusinessSetup(pinia) {
  return mount(BusinessSetupView, {
    global: {
      plugins: [pinia],
      // Name-keyed stubs are inert for these <script setup> base components, so the
      // view always renders the production BaseCard/BaseButton/BaseInput components.
    },
  })
}

async function setBaseInputByLabel(wrapper, label, value) {
  const component = wrapper
    .findAllComponents(BaseInput)
    .find((item) => item.props('label') === label)

  expect(component).toBeTruthy()

  const input = component.find('input')

  expect(input.exists()).toBe(true)

  await input.setValue(value)
}

async function chooseBusinessType(wrapper, type) {
  const button = wrapper.findAll('button').find((item) => item.text().includes(type))

  expect(button).toBeTruthy()
  await button.trigger('click')
}

async function saveBusinessSetup(wrapper) {
  const form = wrapper.find('form')
  if (form.exists()) {
    await form.trigger('submit')
    return
  }

  const button = wrapper.findAll('button').find((item) => item.text().includes('Lanjut Setup PIN'))

  expect(button).toBeTruthy()
  await button.trigger('click')
}

function expectNoCafeProducts(products) {
  expect(products.map((product) => product.name)).not.toEqual(expect.arrayContaining([
    'Es Kopi Susu',
    'Americano',
    'Croissant Butter',
    'Chicken Sandwich',
  ]))
}

describe('business template onboarding', () => {
  beforeEach(() => {
    routerMock.push.mockClear()
  })

  it('Cafe / UMKM mapping benar', () => {
    const template = getBusinessTemplate('Cafe / UMKM')

    expect(template.categories).toEqual(expectedCategories['Cafe / UMKM'])
    expect(template.products.map((product) => product.name)).toEqual([
      'Es Kopi Susu',
      'Americano',
      'Croissant Butter',
      'Chicken Sandwich',
    ])
  })

  it('legacy Restoran aman dibaca sebagai Cafe / UMKM', () => {
    expect(getBusinessTemplate('Restoran').categories).toEqual(expectedCategories['Cafe / UMKM'])
    expect(getBusinessTemplate('restaurant').categories).toEqual(expectedCategories['Cafe / UMKM'])
  })

  it('Grosir / Toko Kelontong mapping benar', () => {
    expect(getBusinessTemplate('Grosir / Toko Kelontong').categories).toEqual(expectedCategories['Grosir / Toko Kelontong'])
  })

  it('Laundry bukan katalog Cafe', () => {
    const template = getBusinessTemplate('Laundry')

    expect(template.categories).toEqual(expectedCategories.Laundry)
    expectNoCafeProducts(template.products)
  })

  it('fresh Laundry setup menerapkan template tanpa katalog Cafe', async () => {
    const { pinia, businessStore, productStore } = createContext()
    const wrapper = mountBusinessSetup(pinia)

    await setBaseInputByLabel(wrapper, 'Nama Toko', 'Laundry Rapi')
    await chooseBusinessType(wrapper, 'Laundry')
    await saveBusinessSetup(wrapper)

    expect(businessStore.type).toBe('Laundry')
    expect(productStore.categories).toEqual(expectedCategories.Laundry)
    expect(productStore.products).toEqual([])
    expect(routerMock.push).toHaveBeenCalledWith('/setup/pin')
  })

  it('selector onboarding hanya menampilkan tiga tipe bisnis core', () => {
    const { pinia } = createContext()
    const wrapper = mountBusinessSetup(pinia)
    const text = wrapper.text()

    expect(text).toContain('Cafe / UMKM')
    expect(text).toContain('Laundry')
    expect(text).toContain('Grosir / Toko Kelontong')
    expect(text).not.toContain('Restoran')
    expect(text).not.toContain('Barbershop')
    expect(text).not.toContain('Retail')
  })


  it('existing catalog tidak tertimpa saat profile type diubah', async () => {
    const { pinia, businessStore, productStore } = createContext()
    const customCatalog = {
      categories: ['Custom Service'],
      products: [
        {
          id: 'custom-product',
          name: 'Custom Hair Wash',
          category: 'Custom Service',
          price: 45000,
          stock: 1,
          isActive: true,
        },
      ],
      selectedCategory: 'Custom Service',
    }

    businessStore.setBusiness({
      name: 'Existing Store',
      type: 'Cafe',
      owner: 'Owner',
      phone: '08123456789',
      outlet: 'Outlet Utama',
      mode: 'free',
    })
    productStore.$patch(customCatalog)

    const wrapper = mountBusinessSetup(pinia)
    await chooseBusinessType(wrapper, 'Grosir / Toko Kelontong')
    await saveBusinessSetup(wrapper)

    expect(businessStore.type).toBe('Grosir / Toko Kelontong')
    expect(productStore.categories).toEqual(customCatalog.categories)
    expect(productStore.products).toEqual(customCatalog.products)
    expect(productStore.selectedCategory).toBe(customCatalog.selectedCategory)
  })

  it('selectedCategory kembali aman ke Semua', () => {
    const { productStore } = createContext()

    productStore.selectCategory('Minuman')
    productStore.applyBusinessTemplate('Laundry')

    expect(productStore.selectedCategory).toBe('Semua')
  })

  it('template source tidak ikut termutasi', () => {
    const template = getBusinessTemplate('Cafe')

    template.categories[0] = 'Rusak'
    template.products[0].name = 'Rusak'

    expect(getBusinessTemplate('Cafe / UMKM').categories).toEqual(expectedCategories['Cafe / UMKM'])
    expect(getBusinessTemplate('Cafe / UMKM').products[0].name).toBe('Es Kopi Susu')
  })
})
