import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import NexaPosLogo from '@/components/base/NexaPosLogo.vue'
import AppHeader from '@/components/layout/AppHeader.vue'
import { createAppRouter } from '@/router'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { THEME_STORAGE_KEY, useThemeStore } from '@/stores/themeStore'
import ExpenseFormView from '@/views/expenses/ExpenseFormView.vue'
import WelcomeView from '@/views/onboarding/WelcomeView.vue'
import SettingsView from '@/views/settings/SettingsView.vue'

describe('Dark & Light Theme + Contrast-Adaptive NexaPos Logo', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.classList.remove('dark')
    delete document.documentElement.dataset.theme

    let meta = document.querySelector('meta[name="theme-color"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.setAttribute('name', 'theme-color')
      document.head.appendChild(meta)
    }
    meta.setAttribute('content', '#4945D6')
  })

  it('mengelola state tema light/dark, class html.dark, dan penyimpanan localStorage', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const themeStore = useThemeStore()

    expect(themeStore.theme).toBe('light')
    expect(themeStore.isDark).toBe(false)

    themeStore.setTheme('dark')
    expect(themeStore.theme).toBe('dark')
    expect(themeStore.isDark).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe(
      '#0F131F',
    )

    themeStore.toggleTheme()
    expect(themeStore.theme).toBe('light')
    expect(themeStore.isDark).toBe(false)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
  })

  it('initTheme memulihkan preferensi dark dari localStorage saat startup', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')

    const pinia = createPinia()
    setActivePinia(pinia)
    const themeStore = useThemeStore()
    themeStore.initTheme()

    expect(themeStore.isDark).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('NexaPosLogo menampilkan logo biru pada tema light dan logo putih pada tema dark', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const themeStore = useThemeStore()

    const wrapper = mount(NexaPosLogo, {
      props: {
        withWordmark: true,
        showVersion: true,
      },
      global: {
        plugins: [pinia],
      },
    })

    // Light theme -> Blue logo
    expect(wrapper.attributes('data-logo-tone')).toBe('blue')
    const lightLines = wrapper.findAll('svg line')
    expect(lightLines[0].attributes('stroke')).toBe('#4945D6')
    expect(wrapper.html()).toContain('text-[#4945D6]')

    // Switch to Dark theme -> White logo
    themeStore.setTheme('dark')
    await flushPromises()

    expect(wrapper.attributes('data-logo-tone')).toBe('white')
    const darkLines = wrapper.findAll('svg line')
    expect(darkLines[0].attributes('stroke')).toBe('#FFFFFF')
    expect(wrapper.html()).toContain('text-white')
  })

  it('tombol toggle tema pada AppHeader mengubah tema sekaligus kontras logo secara langsung', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createAppRouter()

    const wrapper = mount(AppHeader, {
      global: {
        plugins: [pinia, router],
      },
    })

    const logo = wrapper.find('[data-testid="nexapos-logo"]')
    const toggleBtn = wrapper.find('[data-testid="header-theme-toggle"]')

    expect(logo.attributes('data-logo-tone')).toBe('blue')

    await toggleBtn.trigger('click')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(logo.attributes('data-logo-tone')).toBe('white')

    await toggleBtn.trigger('click')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(logo.attributes('data-logo-tone')).toBe('blue')
  })

  it('pilihan Tema Aplikasi pada SettingsView dan WelcomeView mengubah tema serta warna logo', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createAppRouter()

    const settingsWrapper = mount(SettingsView, {
      global: {
        plugins: [pinia, router],
      },
    })
    await flushPromises()

    const darkOption = settingsWrapper.find('[data-testid="theme-option-dark"]')
    const lightOption = settingsWrapper.find('[data-testid="theme-option-light"]')
    const logos = settingsWrapper.findAll('[data-testid="nexapos-logo"]')

    expect(logos.length).toBeGreaterThan(0)
    expect(logos.every((node) => node.attributes('data-logo-tone') === 'blue')).toBe(true)

    await darkOption.trigger('click')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(logos.every((node) => node.attributes('data-logo-tone') === 'white')).toBe(true)

    const welcomeWrapper = mount(WelcomeView, {
      global: {
        plugins: [pinia, router],
      },
    })
    expect(welcomeWrapper.find('[data-testid="nexapos-logo"]').attributes('data-logo-tone')).toBe(
      'white',
    )

    await lightOption.trigger('click')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(logos.every((node) => node.attributes('data-logo-tone') === 'blue')).toBe(true)
    expect(welcomeWrapper.find('[data-testid="nexapos-logo"]').attributes('data-logo-tone')).toBe(
      'blue',
    )
  })

  it('kartu Langganan di SettingsView dan ringkasan Catat Pengeluaran memakai kelas adaptif Dark Mode', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createAppRouter()
    const themeStore = useThemeStore()
    themeStore.setTheme('dark')

    const cloudStore = useCloudSessionStore()
    cloudStore.user = { id: 1, name: 'Sawal', email: 'sawalinto@gmail.com' }
    cloudStore.selectedBusiness = {
      id: 10,
      name: 'Temuan space',
      subscription: {
        plan: 'cloud',
        status: 'active',
        expires_at: '2030-11-30T00:00:00.000Z',
      },
    }
    cloudStore.cloudAccess = true
    cloudStore.capabilityState = 'verified'

    const settingsWrapper = mount(SettingsView, {
      global: {
        plugins: [pinia, router],
      },
    })
    await flushPromises()

    const subCard = settingsWrapper.find('[data-testid="subscription-card"]')
    expect(subCard.exists()).toBe(true)
    expect(subCard.classes()).toContain('dark:to-[#171C2B]')
    expect(subCard.find('[data-testid="subscription-badge"]').classes()).toContain(
      'dark:text-emerald-300',
    )

    await router.push({ name: 'expense-create' })
    await router.isReady()

    const expenseWrapper = mount(ExpenseFormView, {
      global: {
        plugins: [pinia, router],
      },
    })
    await flushPromises()

    const liveSummary = expenseWrapper.find('[data-testid="expense-live-summary"]')
    expect(liveSummary.exists()).toBe(true)
    expect(liveSummary.classes()).toContain('dark:bg-[#121726]')
    expect(liveSummary.classes()).not.toContain('bg-zinc-50/90')

    const amountInput = expenseWrapper.find('[data-testid="expense-amount-input"]')
    expect(amountInput.classes()).not.toContain('focus:bg-white')
    expect(amountInput.classes()).toContain('dark:bg-[#121726]')
  })
})

