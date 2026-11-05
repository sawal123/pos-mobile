export const DEFAULT_RECEIPT_FOOTER =
  'Terima kasih atas kunjungan Anda!\nSimpan struk ini sebagai bukti pembayaran yang sah.'
export const MAX_LOGO_WIDTH = 192
export const MAX_LOGO_HEIGHT = 96
export const MAX_LOGO_FILE_BYTES = 2 * 1024 * 1024
export const MAX_ADDRESS_LENGTH = 300
export const MAX_FOOTER_LENGTH = 300

export function receiptText(value, maxLength) {
  return typeof value === 'string'
    ? value
        .replace(/\r\n?/g, '\n')
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
        .trim()
        .slice(0, maxLength)
    : ''
}

export function decodeReceiptLogo(logo) {
  if (
    !logo ||
    !Number.isInteger(logo.width) ||
    !Number.isInteger(logo.height) ||
    logo.width < 8 ||
    logo.width > MAX_LOGO_WIDTH ||
    logo.width % 8 !== 0 ||
    logo.height < 1 ||
    logo.height > MAX_LOGO_HEIGHT ||
    typeof logo.data !== 'string' ||
    logo.data.length > 3072
  )
    return null
  try {
    const raw = globalThis.atob(logo.data)
    if (raw.length !== (logo.width / 8) * logo.height) return null
    return Uint8Array.from(raw, (char) => char.charCodeAt(0))
  } catch {
    return null
  }
}

export function normalizeReceiptSettings(settings) {
  return {
    address: receiptText(settings?.address, MAX_ADDRESS_LENGTH),
    footer:
      settings?.footer === undefined
        ? DEFAULT_RECEIPT_FOOTER
        : receiptText(settings.footer, MAX_FOOTER_LENGTH),
    logo: decodeReceiptLogo(settings?.logo)
      ? { width: settings.logo.width, height: settings.logo.height, data: settings.logo.data }
      : null,
  }
}

// A single canonical black/white raster drives both the screen image and ESC/POS.
export function receiptLogoDataUrl(logo) {
  const data = decodeReceiptLogo(logo)
  if (!data) return ''
  let path = ''
  for (let y = 0; y < logo.height; y += 1) {
    for (let x = 0; x < logo.width; x += 1) {
      if (data[(y * logo.width) / 8 + (x >> 3)] & (0x80 >> (x % 8))) path += `M${x} ${y}h1v1h-1z`
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${logo.width}" height="${logo.height}" viewBox="0 0 ${logo.width} ${logo.height}"><path fill="white" d="M0 0h${logo.width}v${logo.height}H0z"/><path fill="black" d="${path}"/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

export function monochromeRaster(rgba, width, height) {
  if (
    width < 1 ||
    width > MAX_LOGO_WIDTH ||
    height < 1 ||
    height > MAX_LOGO_HEIGHT ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    rgba.length !== width * height * 4
  ) {
    throw new Error('Ukuran logo tidak valid.')
  }
  const paddedWidth = Math.ceil(width / 8) * 8
  const bytes = new Uint8Array((paddedWidth / 8) * height)
  let ink = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const alpha = rgba[index + 3] / 255
      const luminance =
        (0.299 * rgba[index] + 0.587 * rgba[index + 1] + 0.114 * rgba[index + 2]) * alpha +
        255 * (1 - alpha)
      if (luminance < 160) {
        bytes[(y * paddedWidth) / 8 + (x >> 3)] |= 0x80 >> (x % 8)
        ink += 1
      }
    }
  }
  if (!ink)
    throw new Error(
      'Logo kosong setelah diubah ke hitam-putih. Gunakan logo dengan warna lebih gelap.',
    )
  return { width: paddedWidth, height, data: globalThis.btoa(String.fromCharCode(...bytes)) }
}

export async function prepareReceiptLogo(file) {
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('Pilih logo PNG, JPG, atau WebP.')
  }
  if (file.size > MAX_LOGO_FILE_BYTES) throw new Error('Ukuran file logo maksimal 2 MB.')
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = () => reject(new Error('Logo tidak dapat dibaca. Pilih gambar lain.'))
      image.src = url
    })
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth * image.naturalHeight > 16000000
    ) {
      throw new Error('Dimensi logo terlalu besar. Gunakan gambar maksimal 16 megapiksel.')
    }
    const scale = Math.min(
      1,
      MAX_LOGO_WIDTH / image.naturalWidth,
      MAX_LOGO_HEIGHT / image.naturalHeight,
    )
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Pemrosesan logo tidak tersedia di perangkat ini.')
    context.drawImage(image, 0, 0, width, height)
    return monochromeRaster(context.getImageData(0, 0, width, height).data, width, height)
  } finally {
    URL.revokeObjectURL(url)
  }
}
