export const MAX_PRODUCT_CODE_LENGTH = 255

export function normalizeProductCode(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function isValidProductCode(value, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') return false
  const code = normalizeProductCode(value)
  return (
    (allowEmpty || code.length > 0) &&
    code.length <= MAX_PRODUCT_CODE_LENGTH &&
    !/[\u0000-\u001f\u007f]/u.test(code)
  )
}

export function findProductCodeConflict(products, { sku = '', barcode = '' }, exceptId = null) {
  const codes = [sku, barcode].map(normalizeProductCode).filter(Boolean)
  return (
    products.find(
      (product) =>
        (exceptId === null || String(product.id) !== String(exceptId)) &&
        [product.sku, product.barcode].some(
          (value) => codes.includes(normalizeProductCode(value)) && normalizeProductCode(value),
        ),
    ) ?? null
  )
}

export function generateProductCode(products) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const uuid = globalThis.crypto?.randomUUID?.()
    if (!uuid)
      throw new Error(
        'Perangkat tidak mendukung pembuatan kode aman. Coba isi barcode secara manual.',
      )
    const code = `NXP-${uuid}`
    if (!findProductCodeConflict(products, { barcode: code })) return code
  }
  throw new Error('Kode unik belum dapat dibuat. Coba lagi.')
}

export function resolveProductCode(products, value) {
  if (!isValidProductCode(value)) return { success: false, error: 'Kode scan tidak valid.' }
  const code = normalizeProductCode(value)
  const matches = [
    ...new Map(
      products
        .filter((product) =>
          [product.barcode, product.sku].some((entry) => normalizeProductCode(entry) === code),
        )
        .map((product) => [String(product.id), product]),
    ).values(),
  ]
  if (!matches.length)
    return { success: false, error: `Produk dengan kode ${code} tidak ditemukan.` }
  if (matches.length > 1)
    return {
      success: false,
      error: 'Kode digunakan beberapa produk. Perbaiki kode produk terlebih dahulu.',
    }
  const product = matches[0]
  if (product.isActive === false)
    return { success: false, error: `${product.name} sedang tidak aktif.` }
  if (product.kind === 'service' || product.isSellable === false || product.is_sellable === false) {
    return { success: false, error: `${product.name} bukan produk yang dapat dijual.` }
  }
  if (!Number.isFinite(Number(product.stock)) || Number(product.stock) <= 0) {
    return { success: false, error: `Stok ${product.name} habis.` }
  }
  return { success: true, product }
}

export function canManageProductCodes(cloud) {
  if (!cloud) return true
  if (cloud.sessionInvalid === true) return false
  if (!cloud.isLinked) return true
  if (
    cloud.role === 'cashier' ||
    cloud.isCashierContext === true ||
    cloud.pushPolicy?.pushMode === 'cashier_safe' ||
    cloud.capabilityState === 'revoked'
  ) {
    return false
  }
  return true
}
