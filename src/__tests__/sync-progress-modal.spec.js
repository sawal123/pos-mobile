import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import SyncProgressModal from '@/components/sync/SyncProgressModal.vue'
import { useSyncProgressStore } from '@/stores/syncProgressStore'

describe('SyncProgressModal Component', () => {
  beforeEach(() => {
    const pinia = createPinia()
    setActivePinia(pinia)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing when syncProgressStore.isOpen is false', () => {
    const wrapper = mount(SyncProgressModal, {
      attachTo: document.body,
    })

    expect(wrapper.find('[data-testid="sync-progress-modal-backdrop"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('renders modal with progress bar, percentage indicator, and warning alert when running', async () => {
    const store = useSyncProgressStore()
    store.start({
      type: 'sync',
      title: 'Sinkronisasi Data',
      description: 'Sedang mengirim data...',
    })

    const wrapper = mount(SyncProgressModal, {
      attachTo: document.body,
    })

    expect(document.querySelector('[data-testid="sync-progress-modal-backdrop"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="sync-progress-title"]').textContent).toContain(
      'Sinkronisasi Data',
    )
    expect(document.querySelector('[data-testid="sync-progress-percent"]').textContent).toMatch(
      /\d+%/,
    )
    expect(document.querySelector('[data-testid="sync-progress-circle"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="sync-progress-bar"]')).toBeNull()

    // Verifies warning: jangan keluar atau pindah halaman
    const warning = document.querySelector('[data-testid="sync-progress-warning"]')
    expect(warning).not.toBeNull()
    expect(warning.textContent).toContain('Jangan keluar aplikasi')
    expect(warning.textContent).toContain('jangan berpindah halaman atau menutup aplikasi')

    wrapper.unmount()
  })

  it('blocks backdrop click and Escape key dismissal while running', async () => {
    const store = useSyncProgressStore()
    store.start({ type: 'pull' })

    const wrapper = mount(SyncProgressModal, {
      attachTo: document.body,
    })

    const backdrop = document.querySelector('[data-testid="sync-progress-modal-backdrop"]')
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(store.isOpen).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(store.isOpen).toBe(true)

    wrapper.unmount()
  })

  it('shows success feedback with 100% and auto-closes on finishSuccess', async () => {
    vi.useFakeTimers()
    const store = useSyncProgressStore()
    store.start({ type: 'sync' })

    const wrapper = mount(SyncProgressModal, {
      attachTo: document.body,
    })

    const finishPromise = store.finishSuccess('Selesai!')
    expect(store.status).toBe('success')
    expect(store.progress).toBe(100)

    await vi.advanceTimersByTimeAsync(900)
    await finishPromise

    expect(store.isOpen).toBe(false)
    wrapper.unmount()
  })

  it('shows error state with close button on finishError and allows dismissal', async () => {
    const store = useSyncProgressStore()
    store.start({ type: 'reload' })
    store.finishError('Koneksi internet terputus')

    const wrapper = mount(SyncProgressModal, {
      attachTo: document.body,
    })

    expect(store.status).toBe('error')
    expect(
      document.querySelector('[data-testid="sync-progress-description"]').textContent,
    ).toContain('Koneksi internet terputus')

    const closeBtn = document.querySelector('[data-testid="sync-progress-close-btn"]')
    expect(closeBtn).not.toBeNull()
    closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(store.isOpen).toBe(false)
    wrapper.unmount()
  })

  it('runWithProgress helper manages lifecycle from start to finish', async () => {
    const store = useSyncProgressStore()
    const mockTask = vi.fn(async (setProgress) => {
      setProgress(50, 'Separuh jalan...')
      return { ok: true }
    })

    const result = await store.runWithProgress({ type: 'sync' }, mockTask)
    expect(mockTask).toHaveBeenCalled()
    expect(result.ok).toBe(true)
    expect(store.progress).toBe(100)
  })
})
