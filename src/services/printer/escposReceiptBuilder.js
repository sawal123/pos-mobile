// Minimal ESC/POS receipt builder for cheap 58mm/80mm Bluetooth thermal printers.
// Only printable ASCII is emitted, so unsupported Unicode degrades to '?' instead
// of producing malformed output that could stall the printer.

const ESC = 0x1B
const LF = 0x0A

const SEPARATOR_CHAR = '-'
const FOOTER_FEED_LINES = 3

export const PAPER_WIDTH_CHARS = {
  '58': 32,
  '80': 48,
}

export const SUPPORTED_PAPER_WIDTHS = ['58', '80']
export const DEFAULT_PAPER_WIDTH = '58'

export function normalizePaperWidth(paperWidth) {
  const value = `${paperWidth ?? ''}`.trim()

  return SUPPORTED_PAPER_WIDTHS.includes(value) ? value : DEFAULT_PAPER_WIDTH
}

export function resolveCharsPerLine(paperWidth) {
  return PAPER_WIDTH_CHARS[normalizePaperWidth(paperWidth)]
}

export function sanitizePrinterText(value) {
  const text = `${value ?? ''}`
  let sanitized = ''

  for (const char of text) {
    const code = char.codePointAt(0)

    if (code === 9 || code === 10 || code === 13) {
      sanitized += ' '
      continue
    }

    if (code >= 32 && code <= 126) {
      sanitized += char
      continue
    }

    sanitized += '?'
  }

  return sanitized.replace(/\s+/g, ' ').trim()
}

export function formatIdr(value) {
  const amount = Number(value)
  const safeAmount = Number.isFinite(amount) ? Math.round(amount) : 0
  const sign = safeAmount < 0 ? '-' : ''
  const grouped = String(Math.abs(safeAmount)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

  return `${sign}Rp ${grouped}`
}

export function formatQty(value) {
  const qty = Number(value)

  if (!Number.isFinite(qty)) {
    return '0'
  }

  return Number.isInteger(qty) ? String(qty) : String(Number(qty.toFixed(3)))
}

export function formatReceiptDateTime(value) {
  if (!value) {
    return '-'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return '-'
  }

  const pad = (number) => String(number).padStart(2, '0')

  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function wrapText(text, width) {
  const limit = Math.max(1, Number(width) || 1)
  const clean = sanitizePrinterText(text)

  if (!clean) {
    return ['']
  }

  const lines = []
  let current = ''

  for (const word of clean.split(' ')) {
    const candidate = current ? `${current} ${word}` : word

    if (candidate.length <= limit) {
      current = candidate
      continue
    }

    if (current) {
      lines.push(current)
    }

    if (word.length <= limit) {
      current = word
      continue
    }

    let rest = word

    while (rest.length > limit) {
      lines.push(rest.slice(0, limit))
      rest = rest.slice(limit)
    }

    current = rest
  }

  if (current) {
    lines.push(current)
  }

  return lines.length ? lines : ['']
}

export function alignRow(left, right, width) {
  const limit = Math.max(1, Number(width) || 1)
  const leftText = sanitizePrinterText(left)
  const rightText = sanitizePrinterText(right)

  if (!rightText) {
    return wrapText(leftText, limit)
  }

  if (!leftText) {
    return [rightText.length >= limit ? rightText : rightText.padStart(limit)]
  }

  if (leftText.length + rightText.length + 1 <= limit) {
    return [`${leftText}${' '.repeat(limit - leftText.length - rightText.length)}${rightText}`]
  }

  const rows = wrapText(leftText, Math.max(1, limit - rightText.length - 1))
  const lastIndex = rows.length - 1
  const lastRow = rows[lastIndex] ?? ''

  if (lastRow.length + 1 + rightText.length <= limit) {
    rows[lastIndex] = `${lastRow}${' '.repeat(limit - lastRow.length - rightText.length)}${rightText}`
    return rows
  }

  rows.push(rightText.length >= limit ? rightText : rightText.padStart(limit))
  return rows
}

export function createSeparator(width) {
  return SEPARATOR_CHAR.repeat(Math.max(1, Number(width) || 1))
}

function paymentMethodLabel(paymentMethod) {
  const method = `${paymentMethod ?? ''}`.trim().toLowerCase()

  if (!method) return ''
  if (method === 'qris') return 'QRIS'
  if (method === 'card') return 'Card'
  if (method === 'cash') return 'Cash'

  return sanitizePrinterText(paymentMethod)
}

function isPaidTransaction(transaction) {
  if (!transaction) return false
  if (transaction.paymentStatus) return transaction.paymentStatus === 'paid'

  return transaction.status === 'paid'
}

function isCashPayment(transaction) {
  return `${transaction?.paymentMethod ?? ''}`.trim().toLowerCase() === 'cash'
}

function normalizeItem(item) {
  const qty = Number(item?.qty ?? item?.quantity ?? 0)
  const safeQty = Number.isFinite(qty) ? qty : 0
  const price = Number(item?.price ?? item?.unitPrice ?? 0)
  const safePrice = Number.isFinite(price) ? price : 0
  const subtotal = Number(item?.subtotal ?? item?.lineSubtotal)
  const lineTotal = Number.isFinite(subtotal) ? subtotal : safeQty * safePrice

  return {
    name: item?.name ?? item?.serviceName ?? '-',
    unit: item?.pricingUnit ?? item?.unit ?? '',
    qty: safeQty,
    price: safePrice,
    lineTotal,
  }
}

function buildHeaderLines(business, width) {
  const lines = [sanitizePrinterText(business?.name || '-'), sanitizePrinterText(business?.outlet || '-')]

  if (business?.phone) {
    lines.push(sanitizePrinterText(business.phone))
  }

  return lines.map((line) => wrapText(line, width)).flat()
}

function buildMetadataLines(transaction, width) {
  const lines = []
  const isLaundry = Boolean(transaction?.orderNumber)

  if (isLaundry) {
    lines.push(...wrapText(`No. Order: ${transaction.orderNumber}`, width))
    lines.push(...wrapText(`Tanggal Masuk: ${formatReceiptDateTime(transaction.createdAt)}`, width))
    lines.push(...wrapText(`Customer: ${transaction.customer || 'Walk-in Customer'}`, width))

    const phone = transaction.customerSnapshot?.phone

    if (phone) {
      lines.push(...wrapText(`Nomor HP: ${phone}`, width))
    }

    if (transaction.orderStatus) {
      lines.push(...wrapText(`Status Order: ${transaction.orderStatus}`, width))
    }

    const paid = isPaidTransaction(transaction)

    lines.push(...wrapText(`Status Pembayaran: ${paid ? 'LUNAS' : 'BELUM DIBAYAR'}`, width))

    if (paid && transaction.paymentMethod) {
      lines.push(...wrapText(`Metode Pembayaran: ${paymentMethodLabel(transaction.paymentMethod)}`, width))
    }

    if (transaction.estimatedCompletedAt) {
      lines.push(...wrapText(`Estimasi Selesai: ${formatReceiptDateTime(transaction.estimatedCompletedAt)}`, width))
    }

    return lines
  }

  lines.push(...wrapText(`Invoice: ${transaction?.invoiceNumber || transaction?.id || '-'}`, width))
  lines.push(...wrapText(`Tanggal: ${formatReceiptDateTime(transaction?.createdAt)}`, width))
  lines.push(...wrapText(`Customer: ${transaction?.customer || 'Walk-in Customer'}`, width))

  if (isPaidTransaction(transaction) && transaction?.paymentMethod) {
    lines.push(...wrapText(`Metode Pembayaran: ${paymentMethodLabel(transaction.paymentMethod)}`, width))
  }

  return lines
}

function buildItemLines(items, width) {
  const lines = []

  for (const item of items) {
    const normalized = normalizeItem(item)
    const unitSuffix = normalized.unit ? ` ${normalized.unit}` : ''

    lines.push(...wrapText(normalized.name, width))
    lines.push(...wrapText(`${formatQty(normalized.qty)}${unitSuffix} x ${formatIdr(normalized.price)}`, width))
    lines.push(...alignRow('', formatIdr(normalized.lineTotal), width))
  }

  return lines
}

export function createReceiptCommands({ transaction, business, paperWidth } = {}) {
  const width = resolveCharsPerLine(paperWidth)
  const separator = createSeparator(width)
  const items = Array.isArray(transaction?.items) ? transaction.items : []
  const commands = [{ type: 'init' }]

  commands.push({ type: 'align', value: 'center' })
  commands.push({ type: 'bold', value: true })

  for (const line of buildHeaderLines(business, width)) {
    commands.push({ type: 'text', value: line })
  }

  commands.push({ type: 'bold', value: false })
  commands.push({ type: 'align', value: 'left' })
  commands.push({ type: 'text', value: separator })

  for (const line of buildMetadataLines(transaction, width)) {
    commands.push({ type: 'text', value: line })
  }

  commands.push({ type: 'text', value: separator })

  for (const line of buildItemLines(items, width)) {
    commands.push({ type: 'text', value: line })
  }

  commands.push({ type: 'text', value: separator })

  for (const line of alignRow('Subtotal', formatIdr(transaction?.subtotal), width)) {
    commands.push({ type: 'text', value: line })
  }

  for (const line of alignRow('Pajak', formatIdr(transaction?.tax), width)) {
    commands.push({ type: 'text', value: line })
  }

  commands.push({ type: 'bold', value: true })

  for (const line of alignRow('TOTAL', formatIdr(transaction?.total), width)) {
    commands.push({ type: 'text', value: line })
  }

  commands.push({ type: 'bold', value: false })

  const showCashLines =
    isPaidTransaction(transaction)
    && isCashPayment(transaction)
    && transaction?.cashReceived != null
    && transaction?.changeAmount != null

  if (showCashLines) {
    for (const line of alignRow('Uang Diterima', formatIdr(transaction.cashReceived), width)) {
      commands.push({ type: 'text', value: line })
    }

    for (const line of alignRow('Kembalian', formatIdr(transaction.changeAmount), width)) {
      commands.push({ type: 'text', value: line })
    }
  }

  commands.push({ type: 'feed', lines: FOOTER_FEED_LINES })

  return commands
}

export function createTestReceiptCommands({ business, paperWidth, now = new Date() } = {}) {
  const width = resolveCharsPerLine(paperWidth)
  const normalizedWidth = normalizePaperWidth(paperWidth)
  const separator = createSeparator(width)
  const commands = [{ type: 'init' }, { type: 'align', value: 'center' }, { type: 'bold', value: true }]

  commands.push({ type: 'text', value: sanitizePrinterText(business?.name || 'POS OFFLINE') })
  commands.push({ type: 'text', value: 'TEST PRINTER' })
  commands.push({ type: 'bold', value: false })

  for (const line of wrapText('Printer Bluetooth berhasil terhubung.', width)) {
    commands.push({ type: 'text', value: line })
  }

  commands.push({ type: 'text', value: `${normalizedWidth}mm` })
  commands.push({ type: 'text', value: formatReceiptDateTime(now) })
  commands.push({ type: 'text', value: separator })
  commands.push({ type: 'text', value: 'POS OFFLINE' })
  commands.push({ type: 'text', value: separator })
  commands.push({ type: 'align', value: 'left' })
  commands.push({ type: 'feed', lines: FOOTER_FEED_LINES })

  return commands
}

export function commandsToBytes(commands) {
  const bytes = []

  for (const command of commands) {
    if (command.type === 'init') {
      bytes.push(ESC, 0x40)
      continue
    }

    if (command.type === 'align') {
      bytes.push(ESC, 0x61, command.value === 'center' ? 1 : 0)
      continue
    }

    if (command.type === 'bold') {
      bytes.push(ESC, 0x45, command.value ? 1 : 0)
      continue
    }

    if (command.type === 'text') {
      for (const char of `${command.value ?? ''}`) {
        bytes.push(char.charCodeAt(0) & 0xFF)
      }

      bytes.push(LF)
      continue
    }

    if (command.type === 'feed') {
      const count = Number.isFinite(Number(command.lines)) ? Math.max(0, Number(command.lines)) : 0

      for (let index = 0; index < count; index += 1) {
        bytes.push(LF)
      }
    }
  }

  return new Uint8Array(bytes)
}

export function commandsToText(commands) {
  return commands
    .filter((command) => command.type === 'text')
    .map((command) => command.value)
    .join('\n')
}

export function buildReceiptBytes(input) {
  return commandsToBytes(createReceiptCommands(input))
}

export function buildReceiptText(input) {
  return commandsToText(createReceiptCommands(input))
}

export function buildTestReceiptBytes(input) {
  return commandsToBytes(createTestReceiptCommands(input))
}

export function buildTestReceiptText(input) {
  return commandsToText(createTestReceiptCommands(input))
}

export function bytesToBase64(bytes) {
  const chunkSize = 0x8000
  let binary = ''

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }

  return globalThis.btoa(binary)
}
