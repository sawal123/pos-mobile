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

/** Supports single-shot (default) or continuous POS scanning (`continuous: true`). */
export function createProductScannerSession({
  video,
  onResult,
  onError,
  onNativeChange = () => {},
  continuous = false,
  cooldownMs = 1300,
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
  let lastCode = ''
  let lastEmitAt = 0
  const listeners = []

  function emitDetection(value) {
    if (cancelled || consumed) return
    const normalized = typeof value === 'string' ? value.trim() : ''
    if (!normalized) return
    if (continuous) {
      const now = Date.now()
      if (normalized === lastCode && now - lastEmitAt < cooldownMs) return
      lastCode = normalized
      lastEmitAt = now
      onResult?.(normalized)
      return
    }
    void finish(normalized)
  }

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
          if (code) emitDetection(code)
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
      try {
        stream = await getMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } })
      } catch (firstErr) {
        if (['OverconstrainedError', 'ConstraintNotSatisfiedError'].includes(firstErr?.name)) {
          stream = await getMedia({ audio: false, video: true })
        } else {
          throw firstErr
        }
      }
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      const hints = new Map([
        [
          DecodeHintType.POSSIBLE_FORMATS,
          [F.QR_CODE, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39],
        ],
      ])
      const reader = new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 150,
        delayBetweenScanSuccess: 500,
      })
      controls = await reader.decodeFromStream(stream, video, (result) => {
        if (result) emitDetection(result.getText())
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

export async function decodeProductBarcodeFromFile(file) {
  if (!file) throw new Error('Pilih file gambar terlebih dahulu.')
  if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
    try {
      const detector = new window.BarcodeDetector({
        formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e'],
      })
      const bitmap = await createImageBitmap(file)
      const codes = await detector.detect(bitmap)
      if (codes && codes.length > 0 && codes[0].rawValue) {
        return String(codes[0].rawValue).trim()
      }
    } catch {
      /* Fall back to ZXing below */
    }
  }

  const [{ BrowserMultiFormatReader, BarcodeFormat: F, DecodeHintType }] = await Promise.all([
    Promise.all([import('@zxing/browser'), import('@zxing/library')]).then(([b, l]) => ({
      ...b,
      ...l,
    })),
  ])

  const objectUrl = URL.createObjectURL(file)
  try {
    const hints = new Map([
      [
        DecodeHintType.POSSIBLE_FORMATS,
        [F.QR_CODE, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39],
      ],
    ])
    const reader = new BrowserMultiFormatReader(hints)
    const result = await reader.decodeFromImageUrl(objectUrl)
    const text = result?.getText?.() ? String(result.getText()).trim() : ''
    if (!text) throw new Error('Barcode atau QR tidak ditemukan pada gambar.')
    return text
  } catch {
    throw new Error('Tidak ditemukan barcode atau QR Code yang jelas pada gambar tersebut.')
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
