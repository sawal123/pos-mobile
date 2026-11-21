import { defineStore } from 'pinia'
import { normalizeReceiptSettings, receiptLogoDataUrl } from '@/services/printer/receiptSettings'

export const useReceiptStore = defineStore('receipt', {
  state: () => normalizeReceiptSettings(),
  getters: {
    logoUrl: (state) => receiptLogoDataUrl(state.logo),
  },
  actions: {
    saveSettings(settings) {
      this.$patch(normalizeReceiptSettings(settings))
    },
    setLogoRaster(raster) {
      if (!raster || !raster.data) return
      this.logo = {
        ...(typeof this.logo === 'object' && this.logo !== null ? this.logo : {}),
        width: raster.width,
        height: raster.height,
        data: raster.data,
      }
    },
  },
})
