import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import UnitsView from '@/views/units/UnitsView.vue'
import { useUnitStore } from '@/stores/unitStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: vi.fn(),
    back: vi.fn(),
  }),
}))

describe('UnitsView Component & CRUD Flow', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('renders default units including ml, gr, pcs', () => {
    const wrapper = mount(UnitsView, {
      global: {
        stubs: ['router-link'],
      },
    })

    const text = wrapper.text()
    expect(text).toContain('ml')
    expect(text).toContain('gr')
    expect(text).toContain('pcs')
    expect(text).toContain('Master Satuan')
  })

  it('filters units when typing in search input', async () => {
    const wrapper = mount(UnitsView)

    const searchInput = wrapper.find('input[placeholder*="Cari satuan"]')
    await searchInput.setValue('gram')

    const cards = wrapper.findAll('[data-testid="unit-item-card"]')
    const cardTexts = cards.map((c) => c.text())
    expect(cardTexts.some((t) => t.includes('gram'))).toBe(true)
    expect(cardTexts.every((t) => t.includes('gram'))).toBe(true)
  })

  it('shows add unit button for admin/owner and opens modal', async () => {
    const cloudStore = useCloudSessionStore()
    cloudStore.role = 'owner'

    const wrapper = mount(UnitsView)
    const addBtn = wrapper.find('[data-testid="add-unit-button"]')
    expect(addBtn.exists()).toBe(true)

    await addBtn.trigger('click')
    expect(wrapper.text()).toContain('Tambah Satuan Baru')
  })

  it('disables add unit button for cashier role', () => {
    const cloudStore = useCloudSessionStore()
    cloudStore.role = 'cashier'

    const wrapper = mount(UnitsView)
    const addBtn = wrapper.find('[data-testid="add-unit-button"]')
    expect(addBtn.exists()).toBe(false)
    expect(wrapper.text()).toContain('Mode Kasir')
  })
})
