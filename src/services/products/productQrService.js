import { Capacitor } from '@capacitor/core'
import { isValidProductCode } from './productCodeService'

async function qrCanvas(code, width) {
  if (!isValidProductCode(code)) throw new Error('Kode produk belum valid.')
  const { default: QRCode } = await import('qrcode')
  const canvas = document.createElement('canvas')
  await QRCode.toCanvas(canvas, code, {
    width,
    margin: 4,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#ffffff' },
  })
  return canvas
}

export async function createProductQrDataUrl(code) {
  return (await qrCanvas(code, 360)).toDataURL('image/png')
}

function wrapText(context, text, maxWidth) {
  const lines = []
  let line = ''
  for (const character of String(text)) {
    if (line && context.measureText(line + character).width > maxWidth) {
      lines.push(line)
      line = ''
    }
    line += character
  }
  if (line) lines.push(line)
  return lines
}

export async function createProductLabelDataUrl(product) {
  const qr = await qrCanvas(product.barcode, 640)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Label PNG belum dapat dibuat pada perangkat ini.')
  context.font = 'bold 30px sans-serif'
  const names = wrapText(context, product.name, 640)
  context.font = '22px monospace'
  const codes = wrapText(context, product.barcode, 640)
  canvas.width = 720
  canvas.height = 760 + names.length * 38 + codes.length * 30
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#111111'
  context.textAlign = 'center'
  context.font = 'bold 30px sans-serif'
  names.forEach((name, index) => context.fillText(name, 360, 50 + index * 38))
  const qrTop = 55 + names.length * 38
  context.drawImage(qr, 40, qrTop)
  context.font = '22px monospace'
  codes.forEach((code, index) => context.fillText(code, 360, qrTop + 680 + index * 30))
  return canvas.toDataURL('image/png')
}

export async function downloadProductLabel(product) {
  const dataUrl = await createProductLabelDataUrl(product)
  const filename = `qr-produk-${String(product.id)
    .replace(/[^a-z0-9-]/gi, '')
    .slice(0, 60)}.png`
  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ])
    const { uri } = await Filesystem.writeFile({
      path: filename,
      data: dataUrl.split(',')[1],
      directory: Directory.Cache,
    })
    await Share.share({
      title: `QR ${product.name}`,
      files: [uri],
      dialogTitle: 'Simpan atau bagikan label QR produk',
    })
    return 'Menu simpan / bagikan label dibuka.'
  }
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename
  link.click()
  return 'Label PNG berhasil disiapkan untuk diunduh.'
}
