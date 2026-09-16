export const PRINTER_ERROR_MESSAGES = {
  BLUETOOTH_UNSUPPORTED: 'Perangkat tidak mendukung Bluetooth.',
  BLUETOOTH_DISABLED: 'Bluetooth belum aktif.',
  BLUETOOTH_PERMISSION_DENIED: 'Izin Bluetooth belum diberikan.',
  PRINTER_NOT_PAIRED: 'Printer tidak lagi terhubung sebagai perangkat paired.',
  INVALID_PRINTER_ADDRESS: 'Alamat printer tidak valid.',
  PRINTER_CONNECT_TIMEOUT: 'Koneksi ke printer terlalu lama.',
  PRINTER_CONNECT_FAILED: 'Tidak dapat terhubung ke printer.',
  PRINTER_WRITE_FAILED: 'Gagal mengirim struk ke printer.',
  PRINTER_NOT_SELECTED: 'Printer Bluetooth belum dipilih.',
  PRINTER_BUSY: 'Pencetakan sedang berjalan.',
  PRINTER_UNKNOWN_ERROR: 'Terjadi kesalahan saat mencetak struk.',
}

export function isKnownPrinterErrorCode(code) {
  return typeof code === 'string' && Object.hasOwn(PRINTER_ERROR_MESSAGES, code)
}

export function createPrinterError(code, message) {
  const resolvedCode = isKnownPrinterErrorCode(code) ? code : 'PRINTER_UNKNOWN_ERROR'

  return {
    success: false,
    code: resolvedCode,
    message: message ?? PRINTER_ERROR_MESSAGES[resolvedCode],
  }
}

// Native plugin rejects with the error code as both message and code, so the JS
// layer never surfaces a raw Java exception to the UI.
export function normalizePrinterError(error) {
  const candidates = [error?.code, error?.message, error?.errorCode]

  for (const candidate of candidates) {
    const value = typeof candidate === 'string' ? candidate.trim() : ''

    if (isKnownPrinterErrorCode(value)) {
      return createPrinterError(value)
    }
  }

  return createPrinterError('PRINTER_UNKNOWN_ERROR')
}
