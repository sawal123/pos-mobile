import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReceiptSettingsPanel from '@/components/settings/ReceiptSettingsPanel.vue'
import ReceiptContent from '@/components/receipt/ReceiptContent.vue'
import { createAppRouter } from '@/router'
import SettingsView from '@/views/settings/SettingsView.vue'
import { useReceiptStore } from '@/stores/receiptStore'
import { useBusinessStore } from '@/stores/businessStore'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { createPersistenceService } from '@/services/database/persistenceService'
import {
  createBackupPayloadFromPersistence,
  validateBackupPayload,
  buildRestoreSnapshotFromBackupPayload,
} from '@/services/backupService'
import {
  applyWorkspaceSnapshot,
  buildEmptyWorkspaceSnapshot,
  captureActiveWorkspaceSnapshot,
} from '@/services/cloud/businessWorkspaceService'
import { buildReceiptBytes, buildReceiptText } from '@/services/printer/escposReceiptBuilder'
import { printReceipt } from '@/services/printer/bluetoothPrinterService'
import {
  decodeReceiptLogo,
  DEFAULT_RECEIPT_FOOTER,
  MAX_LOGO_FILE_BYTES,
  monochromeRaster,
  normalizeReceiptSettings,
  prepareReceiptLogo,
  receiptLogoDataUrl,
} from '@/services/printer/receiptSettings'

const logo = { width: 8, height: 1, data: 'gQ==' } // black pixels at each edge
const settings = {
  address: 'Jl. Merdeka 10\nBandung',
  footer: 'Terima kasih!\nSampai jumpa.',
  logo,
}
const transaction = {
  id: 'T-1',
  items: [{ name: 'Kopi', qty: 1, price: 10000 }],
  subtotal: 10000,
  total: 10000,
  status: 'paid',
}
const business = { name: 'Toko Uji', outlet: 'Utama', phone: '08123' }

beforeEach(() => {
  setActivePinia(createPinia())
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('small monochrome receipt logo', () => {
  it('converts colors and transparency into packed black ink with white padding', () => {
    const result = monochromeRaster(
      new Uint8ClampedArray([0, 0, 0, 255, 255, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0]),
      4,
      1,
    )
    expect(result.width).toBe(8)
    expect(Array.from(decodeReceiptLogo(result))).toEqual([0b11000000])
    const svg = decodeURIComponent(receiptLogoDataUrl(result))
    expect(svg).toContain('fill="black"')
    expect(svg).toContain('fill="white"')
    expect(svg).not.toContain('red')
  })

  it('rejects empty, oversized, malformed, and unsafe logo data', () => {
    expect(() => monochromeRaster(new Uint8ClampedArray([255, 255, 255, 255]), 1, 1)).toThrow(
      'Logo kosong',
    )
    expect(decodeReceiptLogo({ ...logo, width: 200 })).toBeNull()
    expect(decodeReceiptLogo({ ...logo, height: 97 })).toBeNull()
    expect(decodeReceiptLogo({ ...logo, data: 'not-base64' })).toBeNull()
    expect(receiptLogoDataUrl({ width: '<script>', height: 1, data: 'gQ==' })).toBe('')
  })

  it('rejects unsupported files and oversized uploads before decoding', async () => {
    await expect(
      prepareReceiptLogo(new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' })),
    ).rejects.toThrow('PNG, JPG, atau WebP')
    await expect(
      prepareReceiptLogo({ type: 'image/png', size: MAX_LOGO_FILE_BYTES + 1 }),
    ).rejects.toThrow('2 MB')
  })

  it('automatically scales an uploaded logo and releases the temporary URL', async () => {
    const revoke = vi.fn()
    const OriginalURL = URL
    vi.stubGlobal(
      'URL',
      class extends OriginalURL {
        static createObjectURL() {
          return 'blob:logo'
        }
        static revokeObjectURL = revoke
      },
    )
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 800
        naturalHeight = 400
        set src(value) {
          if (value) queueMicrotask(() => this.onload())
        }
      },
    )
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: vi.fn(),
        getImageData: () => {
          const data = new Uint8ClampedArray(canvas.width * canvas.height * 4).fill(255)
          data.set([0, 0, 0, 255])
          return { data }
        },
      }),
    }
    const create = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag, options) =>
      tag === 'canvas' ? canvas : create(tag, options),
    )
    const result = await prepareReceiptLogo(new File(['image'], 'logo.png', { type: 'image/png' }))
    expect(result.width).toBe(192)
    expect(result.height).toBe(96)
    expect(decodeReceiptLogo(result)).toHaveLength(2304)
    expect(revoke).toHaveBeenCalledWith('blob:logo')
  })
})

describe('receipt settings UI and output', () => {
  it('offers a separate collapsible settings section', async () => {
    const wrapper = mount(SettingsView, { global: { plugins: [createPinia(), createAppRouter()] } })
    const section = wrapper.get('[data-testid="settings-section-receipt"]')
    expect(section.attributes('aria-expanded')).toBe('false')
    await section.trigger('click')
    expect(section.attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('[data-testid="receipt-address-input"]').isVisible()).toBe(true)
    wrapper.unmount()
  })

  it('applies address/footer only after saving and supports removing the logo', async () => {
    const store = useReceiptStore()
    store.saveSettings(settings)
    const wrapper = mount(ReceiptSettingsPanel)
    await wrapper.get('[data-testid="receipt-address-input"]').setValue('Alamat baru')
    await wrapper.get('[data-testid="receipt-footer-input"]').setValue('Selamat datang kembali!')
    expect(store.address).toBe(settings.address)
    await wrapper.get('[data-testid="remove-receipt-logo"]').trigger('click')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(store.address).toBe('Alamat baru')
    expect(store.footer).toBe('Selamat datang kembali!')
    expect(store.logo).toBeNull()
    expect(wrapper.get('[data-testid="receipt-settings-feedback"]').text()).toContain(
      'berhasil disimpan',
    )
    wrapper.unmount()
  })

  it('renders the exact configured address, logo, and footer on the receipt', () => {
    const wrapper = mount(ReceiptContent, {
      props: { transaction, business, receiptSettings: settings },
    })
    expect(wrapper.get('[data-testid="receipt-address"]').text()).toBe(settings.address)
    expect(wrapper.get('[data-testid="receipt-footer"]').text()).toBe(settings.footer)
    expect(wrapper.get('[data-testid="receipt-logo"]').attributes('src')).toBe(
      receiptLogoDataUrl(logo),
    )
    expect(wrapper.get('[data-testid="receipt-logo"]').attributes('style')).toContain('width: 4px')
    expect(wrapper.text()).not.toContain('Simpan struk ini')
    wrapper.unmount()
  })

  it('hides optional settings when cleared and preserves the existing default footer', () => {
    expect(normalizeReceiptSettings().footer).toBe(DEFAULT_RECEIPT_FOOTER)
    const wrapper = mount(ReceiptContent, {
      props: { transaction, receiptSettings: { address: '', footer: '', logo: null } },
    })
    expect(wrapper.find('[data-testid="receipt-address"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="receipt-footer"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="receipt-logo"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it.each(['58', '80'])(
    'prints multiline settings and exact monochrome raster for %s mm',
    (paperWidth) => {
      const input = { transaction, business, paperWidth, receiptSettings: settings }
      const text = buildReceiptText(input)
      expect(text).toContain(settings.address)
      expect(text).toContain(settings.footer)
      const bytes = Array.from(buildReceiptBytes(input))
      const imageIndex = bytes.indexOf(0x1d)
      expect(bytes.slice(imageIndex, imageIndex + 9)).toEqual([
        0x1d, 0x76, 0x30, 0, 1, 0, 1, 0, 0x81,
      ])
      for (const line of text.split('\n'))
        expect(line.length).toBeLessThanOrEqual(paperWidth === '58' ? 32 : 48)
    },
  )

  it('passes configured settings to the Bluetooth printer transport', async () => {
    const plugin = { printRaw: vi.fn(async () => ({})) }
    const result = await printReceipt({
      transaction,
      business,
      receiptSettings: settings,
      paperWidth: '58',
      printer: { address: 'AA:BB' },
      capacitor: { isNativePlatform: () => true },
      plugin,
    })
    expect(result.success).toBe(true)
    const binary = atob(plugin.printRaw.mock.calls[0][0].dataBase64)
    expect(binary).toContain(settings.address)
    expect(binary).toContain(settings.footer)
    expect(binary).toContain(String.fromCharCode(0x1d, 0x76, 0x30, 0, 1, 0, 1, 0, 0x81))
  })
})

describe('receipt settings persistence and business isolation', () => {
  it('keeps settings after reopening persistence', async () => {
    const adapter = createMemoryAdapter()
    const pinia = createPinia()
    const service = createPersistenceService({ adapter, pinia })
    await service.initialize()
    useReceiptStore(pinia).saveSettings(settings)
    await service.flush()
    await service.close()
    const reopenedPinia = createPinia()
    const reopened = createPersistenceService({ adapter, pinia: reopenedPinia })
    await reopened.initialize()
    expect(useReceiptStore(reopenedPinia).$state).toEqual(settings)
    await reopened.close()
  })

  it('includes settings in durable backups and accepts older backups without them', async () => {
    const adapter = createMemoryAdapter()
    const pinia = createPinia()
    const service = createPersistenceService({ adapter, pinia })
    await service.initialize()
    useBusinessStore(pinia).setBusiness({ ...business, owner: 'Admin', type: 'Retail' })
    useReceiptStore(pinia).saveSettings(settings)
    await service.flush()
    const payload = await createBackupPayloadFromPersistence({ adapter })
    expect(payload.data.receiptSettings).toEqual(settings)
    expect(validateBackupPayload(payload).valid).toBe(true)
    const target = buildRestoreSnapshotFromBackupPayload(payload)
    expect(target.success).toBe(true)
    await adapter.saveReceiptSettings(null)
    await adapter.applyRestoreSnapshotAtomic({ snapshot: target.snapshot })
    await service.rehydrate()
    expect(useReceiptStore(pinia).$state).toEqual(settings)
    await expect(
      adapter.applyRestoreSnapshotAtomic({
        snapshot: { ...target.snapshot, receiptSettings: normalizeReceiptSettings() },
        hooks: {
          afterDomainApply: () => {
            throw new Error('restore failed')
          },
        },
      }),
    ).rejects.toThrow('restore failed')
    expect(await adapter.loadReceiptSettings()).toEqual(settings)
    delete payload.data.receiptSettings
    expect(validateBackupPayload(payload).data.receiptSettings).toEqual(normalizeReceiptSettings())
    await service.close()
  })

  it('restores each business logo/address and clears settings for a new workspace', async () => {
    const adapter = createMemoryAdapter()
    await adapter.initialize()
    await adapter.saveReceiptSettings(settings)
    const saved = await captureActiveWorkspaceSnapshot(adapter)
    await applyWorkspaceSnapshot(adapter, buildEmptyWorkspaceSnapshot())
    expect(await adapter.loadReceiptSettings()).toBeNull()
    await applyWorkspaceSnapshot(adapter, saved)
    expect(await adapter.loadReceiptSettings()).toEqual(settings)
  })
})
