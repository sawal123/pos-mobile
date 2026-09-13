import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  Cafe: ['Minuman', 'Makanan', 'Snack', 'Dessert', 'Lainnya'],
  Restoran: ['Makanan Utama', 'Minuman', 'Paket', 'Tambahan', 'Dessert', 'Lainnya'],
  Retail: ['Produk', 'Kebutuhan Harian', 'Minuman', 'Snack', 'Lainnya'],
  Laundry: ['Kiloan', 'Satuan', 'Express', 'Tambahan', 'Lainnya'],
  Barbershop: ['Potong Rambut', 'Grooming', 'Treatment', 'Tambahan', 'Lainnya'],
  Lainnya: ['Produk', 'Layanan', 'Lainnya'],
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
      stubs: {
        BaseCard: {
          template: '<section><slot /></section>',
        },
        BaseInput: {
          props: ['modelValue', 'label', 'placeholder'],
          emits: ['update:modelValue'],
          template: `
            <input
              :aria-label="label"
              :placeholder="placeholder"
              :value="modelValue"
              @input="$emit('update:modelValue', $event.target.value)"
            >
          `,
        },
        BaseButton: {
          props: ['disabled', 'size'],
          emits: ['click'],
          template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
        },
      },
    },
  })
}

async function chooseBusinessType(wrapper, type) {
  const button = wrapper.findAll('button').find((item) => item.text().includes(type))

  expect(button).toBeTruthy()
  await button.trigger('click')
}

async function saveBusinessSetup(wrapper) {
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

  it('Cafe mapping benar', () => {
    const template = getBusinessTemplate('Cafe')

    expect(template.categories).toEqual(expectedCategories.Cafe)
    expect(template.products.map((product) => product.name)).toEqual([
      'Es Kopi Susu',
      'Americano',
      'Croissant Butter',
      'Chicken Sandwich',
    ])
  })

  it('Restoran mapping benar', () => {
    expect(getBusinessTemplate('Restoran').categories).toEqual(expectedCategories.Restoran)
  })

  it('Retail mapping benar', () => {
    expect(getBusinessTemplate('Retail').categories).toEqual(expectedCategories.Retail)
  })

  it('Laundry bukan katalog Cafe', () => {
    const template = getBusinessTemplate('Laundry')

    expect(template.categories).toEqual(expectedCategories.Laundry)
    expectNoCafeProducts(template.products)
  })

  it('Barbershop bukan katalog Cafe', () => {
    const template = getBusinessTemplate('Barbershop')

    expect(template.categories).toEqual(expectedCategories.Barbershop)
    expectNoCafeProducts(template.products)
  })

  it('Lainnya generic', () => {
    const template = getBusinessTemplate('Lainnya')

    expect(template.categories).toEqual(expectedCategories.Lainnya)
    expect(template.products).toEqual([])
  })

  it('fresh Barbershop setup menerapkan template', async () => {
    const { pinia, businessStore, productStore } = createContext()
    const wrapper = mountBusinessSetup(pinia)

    await wrapper.find('input[aria-label="Nama Toko"]').setValue('Pangkas Rapi')
    await chooseBusinessType(wrapper, 'Barbershop')
    await saveBusinessSetup(wrapper)

    expect(businessStore.type).toBe('Barbershop')
    expect(productStore.categories).toEqual(expectedCategories.Barbershop)
    expect(productStore.products).toEqual([])
    expect(routerMock.push).toHaveBeenCalledWith('/setup/pin')
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
    await chooseBusinessType(wrapper, 'Retail')
    await saveBusinessSetup(wrapper)

    expect(businessStore.type).toBe('Retail')
    expect(productStore.categories).toEqual(customCatalog.categories)
    expect(productStore.products).toEqual(customCatalog.products)
    expect(productStore.selectedCategory).toBe(customCatalog.selectedCategory)
  })

  it('selectedCategory kembali aman ke Semua', () => {
    const { productStore } = createContext()

    productStore.selectCategory('Minuman')
    productStore.applyBusinessTemplate('Barbershop')

    expect(productStore.selectedCategory).toBe('Semua')
  })

  it('template source tidak ikut termutasi', () => {
    const template = getBusinessTemplate('Cafe')

    template.categories[0] = 'Rusak'
    template.products[0].name = 'Rusak'

    expect(getBusinessTemplate('Cafe').categories).toEqual(expectedCategories.Cafe)
    expect(getBusinessTemplate('Cafe').products[0].name).toBe('Es Kopi Susu')
  })
})
