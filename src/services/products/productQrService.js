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

function formatLabelRupiah(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return ''
  return `Rp ${Math.round(num).toLocaleString('id-ID')}`
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function createProductLabelDataUrl(product) {
  const qr = await qrCanvas(product.barcode, 640)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Label PNG belum dapat dibuat pada perangkat ini.')
  context.font = 'bold 30px sans-serif'
  const names = wrapText(context, product.name, 640)
  const priceText = formatLabelRupiah(product.price)
  const skuText = product.sku ? `SKU: ${product.sku}` : ''
  context.font = '22px monospace'
  const codes = wrapText(context, product.barcode, 640)
  const extraHeaderHeight = (priceText ? 38 : 0) + (skuText ? 28 : 0)
  canvas.width = 720
  canvas.height = 770 + names.length * 38 + extraHeaderHeight + codes.length * 30
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.strokeStyle = '#e4e4e7'
  context.lineWidth = 4
  context.strokeRect(12, 12, canvas.width - 24, canvas.height - 24)
  context.fillStyle = '#111111'
  context.textAlign = 'center'
  context.font = 'bold 30px sans-serif'
  let cursorY = 54
  names.forEach((name) => {
    context.fillText(name, 360, cursorY)
    cursorY += 38
  })
  if (priceText) {
    context.fillStyle = '#4f46e5'
    context.font = 'bold 26px sans-serif'
    context.fillText(priceText, 360, cursorY)
    cursorY += 34
  }
  if (skuText) {
    context.fillStyle = '#52525b'
    context.font = '18px monospace'
    context.fillText(skuText, 360, cursorY)
    cursorY += 26
  }
  const qrTop = cursorY + 8
  context.drawImage(qr, 40, qrTop)
  context.fillStyle = '#111111'
  context.font = 'bold 22px monospace'
  codes.forEach((code, index) => context.fillText(code, 360, qrTop + 675 + index * 30))
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

export async function printProductLabel(product, { copies = 1 } = {}) {
  const count = Math.min(Math.max(Number(copies) || 1, 1), 60)
  const qrDataUrl = await createProductQrDataUrl(product.barcode)
  const safeName = escapeHtml(product.name || 'Produk')
  const safeBarcode = escapeHtml(product.barcode || '')
  const safeSku = product.sku ? escapeHtml(`SKU: ${product.sku}`) : ''
  const safePrice = escapeHtml(formatLabelRupiah(product.price))

  const singleSticker = `
    <div class="sticker">
      <div class="sticker-name">${safeName}</div>
      ${safePrice ? `<div class="sticker-price">${safePrice}</div>` : ''}
      ${safeSku ? `<div class="sticker-sku">${safeSku}</div>` : ''}
      <div class="sticker-qr"><img src="${qrDataUrl}" alt="QR ${safeName}" /></div>
      <div class="sticker-code">${safeBarcode}</div>
    </div>
  `
  const stickersHtml = Array.from({ length: count }, () => singleSticker).join('')
  const cols = count === 1 ? '1fr' : 'repeat(auto-fill, minmax(175px, 1fr))'

  const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <title>Cetak Label QR - ${safeName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #ffffff;
      color: #0f172a;
      padding: 12px;
    }
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 14px;
      margin-bottom: 14px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
    }
    .toolbar-title { font-size: 13px; font-weight: 700; color: #1e293b; }
    .toolbar-actions { display: flex; gap: 8px; }
    .btn {
      padding: 7px 14px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      border: 1px solid #cbd5e1;
      background: #ffffff;
      color: #334155;
    }
    .btn-primary {
      background: #4f46e5;
      border-color: #4f46e5;
      color: #ffffff;
    }
    .sheet {
      display: grid;
      grid-template-columns: ${cols};
      gap: 10px;
      justify-items: center;
    }
    .sticker {
      width: 100%;
      max-width: ${count === 1 ? '250px' : '195px'};
      border: 1.5px dashed #94a3b8;
      border-radius: 12px;
      padding: 10px 8px;
      text-align: center;
      page-break-inside: avoid;
      break-inside: avoid;
      background: #ffffff;
    }
    .sticker-name {
      font-size: 12px;
      font-weight: 800;
      line-height: 1.25;
      margin-bottom: 3px;
      color: #0f172a;
      word-break: break-word;
    }
    .sticker-price {
      font-size: 12px;
      font-weight: 800;
      color: #4f46e5;
      margin-bottom: 2px;
    }
    .sticker-sku {
      font-size: 10px;
      color: #64748b;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      margin-bottom: 4px;
    }
    .sticker-qr {
      display: flex;
      justify-content: center;
      align-items: center;
      margin: 4px auto;
    }
    .sticker-qr img {
      width: 128px;
      height: 128px;
      object-fit: contain;
      display: block;
    }
    .sticker-code {
      margin-top: 4px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 10px;
      font-weight: 700;
      color: #0f172a;
      word-break: break-all;
      background: #f1f5f9;
      padding: 3px 6px;
      border-radius: 4px;
    }
    @media print {
      body { padding: 0; }
      .toolbar { display: none !important; }
      .sticker { border: 1px dashed #64748b; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="toolbar-title">Cetak Label QR Produk (${count} Stiker)</div>
    <div class="toolbar-actions">
      <button class="btn" onclick="window.close()">Tutup</button>
      <button class="btn btn-primary" onclick="window.print()">Cetak Sekarang</button>
    </div>
  </div>
  <div class="sheet">${stickersHtml}</div>
  <script>
    window.addEventListener('load', function () {
      setTimeout(function () {
        window.focus();
        window.print();
      }, 250);
    });
  </script>
</body>
</html>`

  const printWin = typeof window !== 'undefined' ? window.open('', '_blank', 'width=820,height=700') : null
  if (printWin && printWin.document) {
    printWin.document.open()
    printWin.document.write(html)
    printWin.document.close()
    return `Siap mencetak ${count} label stiker QR.`
  }

  if (typeof document !== 'undefined') {
    let iframe = document.getElementById('pos-qr-print-frame')
    if (iframe) iframe.remove()
    iframe = document.createElement('iframe')
    iframe.id = 'pos-qr-print-frame'
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    document.body.appendChild(iframe)
    const doc = iframe.contentWindow?.document || iframe.contentDocument
    if (doc) {
      doc.open()
      doc.write(html)
      doc.close()
      setTimeout(() => {
        iframe.contentWindow?.focus()
        iframe.contentWindow?.print()
      }, 300)
      return `Siap mencetak ${count} label stiker QR.`
    }
  }

  return await downloadProductLabel(product)
}
