import { Capacitor, registerPlugin } from '@capacitor/core'

import {
  buildOpenDrawerBytes,
  buildReceiptBytes,
  buildShiftReceiptBytes,
  buildTestReceiptBytes,
  bytesToBase64,
} from './escposReceiptBuilder'
import { createPrinterError, normalizePrinterError } from './printerErrors'
import { decodeReceiptLogo, rasterizeLogoUrl } from './receiptSettings'

export const DEFAULT_PRINT_TIMEOUT_MS = 10000

// Registered lazily so the web build never touches native code paths.
let bluetoothPrinterPlugin = null

function getPlugin(plugin) {
  if (plugin) {
    return plugin
  }

  if (!bluetoothPrinterPlugin) {
    bluetoothPrinterPlugin = registerPlugin('BluetoothPrinter')
  }

  return bluetoothPrinterPlugin
}

function isNativePlatform(capacitor) {
  return Boolean(capacitor && typeof capacitor.isNativePlatform === 'function' && capacitor.isNativePlatform())
}

function normalizeDevices(devices) {
  if (!Array.isArray(devices)) {
    return []
  }

  return devices
    .map((device) => ({
      name: `${device?.name ?? ''}`.trim(),
      address: `${device?.address ?? ''}`.trim().toUpperCase(),
    }))
    .filter((device) => device.address)
    .sort((a, b) => {
      const byName = a.name.localeCompare(b.name)

      return byName !== 0 ? byName : a.address.localeCompare(b.address)
    })
}

function resolveTimeoutMs(timeoutMs) {
  const value = Number(timeoutMs)

  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_PRINT_TIMEOUT_MS
}

function resolvePrinterAddress(printer) {
  return `${printer?.address ?? ''}`.trim()
}

async function sendRaw({ plugin, printer, bytes, timeoutMs }) {
  const address = resolvePrinterAddress(printer)

  if (!address) {
    return createPrinterError('PRINTER_NOT_SELECTED')
  }

  try {
    await getPlugin(plugin).printRaw({
      address,
      dataBase64: bytesToBase64(bytes),
      timeoutMs: resolveTimeoutMs(timeoutMs),
    })

    return { success: true }
  } catch (error) {
    return normalizePrinterError(error)
  }
}

export function isNativePrinterPlatform({ capacitor = Capacitor } = {}) {
  return isNativePlatform(capacitor)
}

export async function listPairedPrinters({ capacitor = Capacitor, plugin } = {}) {
  if (!isNativePlatform(capacitor)) {
    return {
      success: true,
      native: false,
      devices: [],
    }
  }

  try {
    const result = await getPlugin(plugin).listPairedDevices()

    return {
      success: true,
      native: true,
      devices: normalizeDevices(result?.devices),
    }
  } catch (error) {
    return {
      ...normalizePrinterError(error),
      native: true,
      devices: [],
    }
  }
}

// Serializes native printing so a double tap cannot start two overlapping
// connect/write/close cycles on the same printer.
let activePrint = false

export async function printReceipt({
  transaction,
  business,
  printer,
  paperWidth,
  receiptSettings,
  isFree = false,
  timeoutMs,
  outlet = null,
  capacitor = Capacitor,
  plugin,
  windowRef = typeof window !== 'undefined' ? window : null,
} = {}) {
  if (!isNativePlatform(capacitor)) {
    // Web keeps the existing browser print behavior.
    windowRef?.print?.()

    return { success: true, mode: 'browser' }
  }

  if (activePrint) {
    return createPrinterError('PRINTER_BUSY')
  }

  activePrint = true

  try {
    let effectiveReceiptSettings = receiptSettings
    if (receiptSettings?.logo && !decodeReceiptLogo(receiptSettings.logo)) {
      const url =
        receiptSettings.logo?.url ||
        (typeof receiptSettings.logo === 'string' ? receiptSettings.logo : null)
      if (url) {
        try {
          const raster = await rasterizeLogoUrl(url)
          if (raster) {
            effectiveReceiptSettings = {
              ...receiptSettings,
              logo: {
                ...(typeof receiptSettings.logo === 'object' ? receiptSettings.logo : {}),
                width: raster.width,
                height: raster.height,
                data: raster.data,
              },
            }
          }
        } catch {
          // If rasterization fails, proceed with printing without logo
        }
      }
    }

    return {
      ...(await sendRaw({
        plugin,
        printer,
        bytes: buildReceiptBytes({
          transaction,
          business,
          paperWidth,
          receiptSettings: effectiveReceiptSettings,
          isFree,
          outlet,
        }),
        timeoutMs,
      })),
      mode: 'native',
    }
  } finally {
    activePrint = false
  }
}

export async function printTestReceipt({
  printer,
  paperWidth,
  business,
  receiptSettings,
  timeoutMs,
  outlet = null,
  capacitor = Capacitor,
  plugin,
  now = new Date(),
} = {}) {
  if (!isNativePlatform(capacitor)) {
    return createPrinterError('PRINTER_NOT_SELECTED', 'Tes print hanya tersedia di perangkat Android.')
  }

  if (activePrint) {
    return createPrinterError('PRINTER_BUSY')
  }

  activePrint = true

  try {
    return {
      ...(await sendRaw({
        plugin,
        printer,
        bytes: buildTestReceiptBytes({ business, paperWidth, now, receiptSettings, outlet }),
        timeoutMs,
      })),
      mode: 'native',
    }
  } finally {
    activePrint = false
  }
}

export async function printShiftReceipt({
  shiftSummary,
  business,
  printer,
  paperWidth,
  receiptSettings,
  timeoutMs,
  outlet = null,
  capacitor = Capacitor,
  plugin,
  windowRef = typeof window !== 'undefined' ? window : null,
} = {}) {
  if (!isNativePlatform(capacitor)) {
    windowRef?.print?.()
    return { success: true, mode: 'browser' }
  }

  if (activePrint) {
    return createPrinterError('PRINTER_BUSY')
  }

  activePrint = true

  try {
    return {
      ...(await sendRaw({
        plugin,
        printer,
        bytes: buildShiftReceiptBytes({
          shiftSummary,
          business,
          paperWidth,
          receiptSettings,
          outlet,
        }),
        timeoutMs,
      })),
      mode: 'native',
    }
  } finally {
    activePrint = false
  }
}

export async function openCashDrawer({
  printer,
  timeoutMs,
  capacitor = Capacitor,
  plugin,
} = {}) {
  if (!isNativePlatform(capacitor)) {
    return createPrinterError(
      'PRINTER_NOT_SELECTED',
      'Buka laci kasir hanya tersedia di perangkat Android dengan printer Bluetooth.',
    )
  }

  if (activePrint) {
    return createPrinterError('PRINTER_BUSY')
  }

  activePrint = true

  try {
    return {
      ...(await sendRaw({
        plugin,
        printer,
        bytes: buildOpenDrawerBytes(),
        timeoutMs,
      })),
      mode: 'native',
    }
  } finally {
    activePrint = false
  }
}
