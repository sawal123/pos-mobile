import { defineStore } from 'pinia'

export const DEFAULT_TAX_ENABLED = true
export const DEFAULT_TAX_RATE = 11

export function isValidTaxRate(value) {
  if (value === null || value === undefined || typeof value === 'boolean'
    || (typeof value === 'string' && !/^\d+(?:\.\d{1,2})?$/.test(value.trim()))) {
    return false
  }

  const number = Number(value)

  return Number.isFinite(number)
    && number >= 0
    && number <= 100
    && Math.abs(number * 100 - Math.round(number * 100)) < 1e-8
}

export const useTaxStore = defineStore('tax', {
  state: () => ({
    enabled: DEFAULT_TAX_ENABLED,
    rate: DEFAULT_TAX_RATE,
  }),
  getters: {
    effectiveRate: (state) => state.enabled ? state.rate : 0,
  },
  actions: {
    setSettings({ enabled, rate }) {
      if (typeof enabled !== 'boolean' || !isValidTaxRate(rate)) {
        return { success: false, error: 'Tarif pajak harus antara 0 sampai 100% (maksimal 2 desimal).' }
      }

      this.enabled = enabled
      this.rate = Number(rate)

      return { success: true }
    },
  },
})
