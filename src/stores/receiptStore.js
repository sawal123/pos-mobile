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
  },
})
