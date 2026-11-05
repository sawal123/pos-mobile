import { Capacitor } from '@capacitor/core'

let activeSession = null

export function scannerErrorMessage(error) {
  if (
    ['NotAllowedError', 'PermissionDenied'].includes(error?.name) ||
    error?.code === 'CAMERA_DENIED'
  ) {
    return 'Izin kamera belum diberikan. Izinkan kamera pada pengaturan aplikasi/browser, lalu coba lagi.'
  }
  if (error?.name === 'NotFoundError')
    return 'Kamera tidak ditemukan. Gunakan pencarian atau isi kode secara manual.'
  if (error?.name === 'NotReadableError')
    return 'Kamera sedang digunakan aplikasi lain. Tutup kamera lain lalu coba lagi.'
  return 'Kamera belum dapat dibuka. Periksa izin kamera dan gunakan koneksi HTTPS di browser, lalu coba lagi.'
}

/** One result per session. Cancellation also covers pending permission/camera startup. */
export function createProductScannerSession({
  video,
  onResult,
  onError,
  onNativeChange = () => {},
  native = Capacitor.isNativePlatform(),
  loadNative = () => import('@capacitor-mlkit/barcode-scanning'),
  loadWeb = async () => {
    const [browser, library] = await Promise.all([
      import('@zxing/browser'),
      import('@zxing/library'),
    ])
    return { ...browser, ...library }
  },
  getMedia = (constraints) => navigator.mediaDevices.getUserMedia(constraints),
} = {}) {
  let cancelled = false
  let consumed = false
  let startup = null
  let plugin = null
  let nativeStarted = false
  let controls = null
  let stream = null
  const listeners = []

  async function cleanup() {
    controls?.stop()
    controls = null
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    if (video) video.srcObject = null
    await Promise.allSettled(listeners.splice(0).map((listener) => listener.remove()))
    if (nativeStarted) {
      nativeStarted = false
      try {
        await plugin.stopScan()
      } finally {
        onNativeChange(false)
      }
    }
    if (activeSession === session) activeSession = null
  }

  async function finish(value, error = null) {
    if (cancelled || consumed) return
    consumed = true
    await startup?.catch(() => {})
    try {
      await cleanup()
    } catch {
      /* UI still restores if native stop fails. */
    }
    if (cancelled) return
    if (error) onError?.(scannerErrorMessage(error))
    else onResult?.(value)
  }

  async function begin() {
    const previous = activeSession
    activeSession = session
    if (previous && previous !== session) await previous.stop()
    if (cancelled) return
    if (native) {
      const module = await loadNative()
      if (cancelled) return
      plugin = module.BarcodeScanner
      let permission = await plugin.checkPermissions()
      if (cancelled) return
      if (permission.camera !== 'granted') permission = await plugin.requestPermissions()
      if (cancelled) return
      if (permission.camera !== 'granted')
        throw Object.assign(new Error('Camera denied'), { code: 'CAMERA_DENIED' })
      listeners.push(
        await plugin.addListener('barcodesScanned', ({ barcodes }) => {
          const code = barcodes?.find(
            (barcode) => typeof barcode.rawValue === 'string' && barcode.rawValue,
          )?.rawValue
          if (code) void finish(code)
        }),
      )
      if (cancelled) return
      listeners.push(
        await plugin.addListener('scanError', (error) => {
          void finish(null, error)
        }),
      )
      if (cancelled) return
      onNativeChange(true)
      nativeStarted = true
      const { BarcodeFormat: F, LensFacing } = module
      // startScan uses the bundled ML Kit model. Do not use scan()/download a Play Services module.
      await plugin.startScan({
        formats: [F.QrCode, F.Ean13, F.Ean8, F.UpcA, F.UpcE, F.Code128],
        lensFacing: LensFacing.Back,
      })
    } else {
      const { BrowserMultiFormatReader, BarcodeFormat: F, DecodeHintType } = await loadWeb()
      if (cancelled) return
      stream = await getMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } })
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      const hints = new Map([
        [
          DecodeHintType.POSSIBLE_FORMATS,
          [F.QR_CODE, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128],
        ],
      ])
      const reader = new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 150,
        delayBetweenScanSuccess: 500,
      })
      controls = await reader.decodeFromStream(stream, video, (result) => {
        if (result) void finish(result.getText())
      })
    }
  }

  const session = {
    start() {
      if (startup || cancelled) return startup ?? Promise.resolve()
      startup = begin().catch(async (error) => {
        try {
          await cleanup()
        } catch {
          /* Keep the camera error actionable. */
        }
        if (!cancelled && !consumed) {
          consumed = true
          onError?.(scannerErrorMessage(error))
        }
      })
      return startup
    },
    async stop() {
      cancelled = true
      stream?.getTracks().forEach((track) => track.stop())
      await startup?.catch(() => {})
      try {
        await cleanup()
      } catch {
        /* Native overlay has already been restored. */
      }
    },
  }
  return session
}
