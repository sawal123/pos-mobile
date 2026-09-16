import { defineStore } from 'pinia'

import { DEFAULT_PAPER_WIDTH, SUPPORTED_PAPER_WIDTHS } from '@/services/printer/escposReceiptBuilder'

function emptyPrinter() {
  return { name: '', address: '' }
}

export const usePrinterStore = defineStore('printer', {
  state: () => ({
    selectedPrinter: emptyPrinter(),
    paperWidth: DEFAULT_PAPER_WIDTH,
  }),
  getters: {
    // Only plain serializable selection is kept in state: no socket, connection,
    // or permission objects.
    hasSelectedPrinter: (state) => Boolean(`${state.selectedPrinter?.address ?? ''}`.trim()),
  },
  actions: {
    selectPrinter(device) {
      const address = `${device?.address ?? ''}`.trim()

      if (!address) {
        return {
          success: false,
          error: 'Printer tidak valid.',
        }
      }

      this.selectedPrinter = {
        name: `${device?.name ?? ''}`.trim(),
        address,
      }

      return {
        success: true,
        printer: { ...this.selectedPrinter },
      }
    },
    clearPrinter() {
      this.selectedPrinter = emptyPrinter()
    },
    setPaperWidth(width) {
      const next = `${width ?? ''}`.trim()

      if (!SUPPORTED_PAPER_WIDTHS.includes(next)) {
        return {
          success: false,
          error: 'Ukuran kertas tidak didukung.',
        }
      }

      this.paperWidth = next

      return {
        success: true,
        paperWidth: next,
      }
    },
  },
})
