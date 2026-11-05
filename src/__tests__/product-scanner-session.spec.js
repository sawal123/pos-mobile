import { describe, expect, it, vi } from 'vitest'
import { createProductScannerSession } from '@/services/scanner/productScannerService'
import { flushPromises } from '@vue/test-utils'

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function nativeScanner() {
  const callbacks = {}
  const remove = vi.fn()
  return {
    callbacks,
    remove,
    module: {
      BarcodeFormat: {},
      LensFacing: {},
      BarcodeScanner: {
        checkPermissions: vi.fn(async () => ({ camera: 'granted' })),
        requestPermissions: vi.fn(async () => ({ camera: 'granted' })),
        addListener: vi.fn(async (name, callback) => {
          callbacks[name] = callback
          return { remove }
        }),
        startScan: vi.fn(async () => {}),
        stopScan: vi.fn(async () => {}),
      },
    },
  }
}

describe('single-shot product camera sessions', () => {
  it('consumes one native result, stops the camera and removes listeners before reporting it', async () => {
    const native = nativeScanner()
    const onResult = vi.fn(() =>
      expect(native.module.BarcodeScanner.stopScan).toHaveBeenCalledTimes(1),
    )
    const overlay = vi.fn()
    const session = createProductScannerSession({
      native: true,
      loadNative: async () => native.module,
      onResult,
      onNativeChange: overlay,
    })
    await session.start()
    native.callbacks.barcodesScanned({ barcodes: [{ rawValue: '001234' }] })
    native.callbacks.barcodesScanned({ barcodes: [{ rawValue: '001234' }] })
    await flushPromises()
    expect(onResult).toHaveBeenCalledExactlyOnceWith('001234')
    expect(native.remove).toHaveBeenCalledTimes(2)
    expect(overlay).toHaveBeenLastCalledWith(false)
    await session.stop()
  })

  it('never starts native scanning after cancellation while permission is pending', async () => {
    const native = nativeScanner()
    const pending = deferred()
    native.module.BarcodeScanner.checkPermissions.mockImplementation(() => pending.promise)
    const onResult = vi.fn()
    const session = createProductScannerSession({
      native: true,
      loadNative: async () => native.module,
      onResult,
    })
    void session.start()
    await flushPromises()
    const stopped = session.stop()
    pending.resolve({ camera: 'granted' })
    await stopped
    expect(native.module.BarcodeScanner.startScan).not.toHaveBeenCalled()
    expect(onResult).not.toHaveBeenCalled()
  })

  it('suppresses callbacks from a stopped session and explains a denied permission', async () => {
    const native = nativeScanner()
    const onResult = vi.fn()
    const session = createProductScannerSession({
      native: true,
      loadNative: async () => native.module,
      onResult,
    })
    await session.start()
    await session.stop()
    native.callbacks.barcodesScanned({ barcodes: [{ rawValue: 'late' }] })
    await flushPromises()
    expect(onResult).not.toHaveBeenCalled()
    native.module.BarcodeScanner.checkPermissions.mockResolvedValue({ camera: 'denied' })
    native.module.BarcodeScanner.requestPermissions.mockResolvedValue({ camera: 'denied' })
    const onError = vi.fn()
    const denied = createProductScannerSession({
      native: true,
      loadNative: async () => native.module,
      onError,
    })
    await denied.start()
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Izin kamera'))
    await denied.stop()
  })

  it('stops a web stream even when permission resolves after closing', async () => {
    const pending = deferred()
    const stop = vi.fn()
    const decodeFromStream = vi.fn()
    const session = createProductScannerSession({
      native: false,
      loadWeb: async () => ({
        BrowserMultiFormatReader: class {
          decodeFromStream = decodeFromStream
        },
        BarcodeFormat: {},
        DecodeHintType: {},
      }),
      getMedia: () => pending.promise,
    })
    void session.start()
    await flushPromises()
    const stopped = session.stop()
    pending.resolve({ getTracks: () => [{ stop }] })
    await stopped
    expect(stop).toHaveBeenCalled()
    expect(decodeFromStream).not.toHaveBeenCalled()
  })

  it('starts a new native camera only after the previous session has fully stopped', async () => {
    const first = nativeScanner()
    const pending = deferred()
    first.module.BarcodeScanner.stopScan.mockImplementation(() => pending.promise)
    const previous = createProductScannerSession({
      native: true,
      loadNative: async () => first.module,
    })
    await previous.start()
    const second = nativeScanner()
    const next = createProductScannerSession({
      native: true,
      loadNative: async () => second.module,
    })
    const started = next.start()
    await flushPromises()
    expect(second.module.BarcodeScanner.startScan).not.toHaveBeenCalled()
    pending.resolve()
    await started
    expect(second.module.BarcodeScanner.startScan).toHaveBeenCalledTimes(1)
    await next.stop()
  })
})
