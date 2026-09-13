export const BUSINESS_TYPES = [
  'Cafe / UMKM',
  'Laundry',
  'Grosir / Toko Kelontong',
]

const BUSINESS_TYPE_ALIASES = {
  cafe: 'Cafe / UMKM',
  'cafe / umkm': 'Cafe / UMKM',
  umkm: 'Cafe / UMKM',
  restoran: 'Cafe / UMKM',
  restaurant: 'Cafe / UMKM',
  retail: 'Grosir / Toko Kelontong',
  grosir: 'Grosir / Toko Kelontong',
  'grosir / toko kelontong': 'Grosir / Toko Kelontong',
  'toko kelontong': 'Grosir / Toko Kelontong',
  laundry: 'Laundry',
}

const BUSINESS_TEMPLATES = {
  'Cafe / UMKM': {
    categories: ['Minuman', 'Makanan', 'Snack', 'Dessert', 'Lainnya'],
    products: [
      { id: 1, name: 'Es Kopi Susu', category: 'Minuman', sku: '', cost: 12000, price: 22000, stock: 18, unit: 'pcs', minStock: 5, isActive: true, kind: 'product' },
      { id: 2, name: 'Americano', category: 'Minuman', sku: '', cost: 9000, price: 18000, stock: 14, unit: 'pcs', minStock: 5, isActive: true, kind: 'product' },
      { id: 3, name: 'Croissant Butter', category: 'Makanan', sku: '', cost: 15000, price: 25000, stock: 9, unit: 'pcs', minStock: 3, isActive: true, kind: 'product' },
      { id: 4, name: 'Chicken Sandwich', category: 'Makanan', sku: '', cost: 20000, price: 32000, stock: 7, unit: 'pcs', minStock: 3, isActive: true, kind: 'product' },
    ],
  },
  Laundry: {
    categories: ['Kiloan', 'Satuan', 'Express', 'Sprei & Bed Cover', 'Lainnya'],
    products: [],
  },
  'Grosir / Toko Kelontong': {
    categories: ['Produk', 'Kebutuhan Harian', 'Minuman', 'Snack', 'Lainnya'],
    products: [],
  },
}

function cloneProduct(product) {
  return { ...product }
}

export function normalizeBusinessType(type) {
  const key = String(type ?? '').trim().toLowerCase()
  return BUSINESS_TYPE_ALIASES[key] ?? 'Cafe / UMKM'
}

export function getBusinessTemplate(type) {
  const template = BUSINESS_TEMPLATES[normalizeBusinessType(type)]

  return {
    categories: [...template.categories],
    products: template.products.map(cloneProduct),
  }
}
