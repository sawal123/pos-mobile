import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  isPromoActive,
  evaluatePromoDiscount,
  usePromoStore,
} from '@/stores/promoStore'
import { useCartStore } from '@/stores/cartStore'
import { useProductStore } from '@/stores/productStore'
import { useTaxStore } from '@/stores/taxStore'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { createSyncIdentityRegistry } from '@/services/sync/syncIdentityRegistry'
import { mapOutboxEntries } from '@/services/sync/contractMapper'
import { SYNC_ENTITY_TYPES, SYNC_OPERATIONS } from '@/services/sync/syncConstants'
import { createReceiptCommands } from '@/services/printer/escposReceiptBuilder'

describe('Mobile Promo Engine & Feature Parity', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('isPromoActive helper', () => {
    it('returns false when status is not active', () => {
      const promo = { status: 'draft' }
      expect(isPromoActive(promo)).toBe(false)
    })

    it('validates start and end date boundaries', () => {
      const promo = {
        status: 'active',
        starts_at: '2026-11-01T00:00:00Z',
        ends_at: '2026-11-05T23:59:59Z',
      }
      expect(isPromoActive(promo, new Date('2026-11-03T12:00:00Z'))).toBe(true)
      expect(isPromoActive(promo, new Date('2026-10-31T23:59:59Z'))).toBe(false)
      expect(isPromoActive(promo, new Date('2026-11-06T00:00:00Z'))).toBe(false)
    })

    it('validates applicable weekdays', () => {
      // 2026-11-02 is Monday (day 1), 2026-11-08 is Sunday (day 7)
      const monday = new Date('2026-11-02T10:00:00')
      const sunday = new Date('2026-11-08T10:00:00')

      const weekdayPromo = {
        status: 'active',
        weekdays: [1, 2, 3, 4, 5], // Mon - Fri
      }

      expect(isPromoActive(weekdayPromo, monday)).toBe(true)
      expect(isPromoActive(weekdayPromo, sunday)).toBe(false)
    })

    it('validates happy hour time window', () => {
      const promo = {
        status: 'active',
        start_time: '14:00',
        end_time: '17:00',
      }

      const activeTime = new Date('2026-11-03T15:30:00')
      const earlyTime = new Date('2026-11-03T13:45:00')
      const lateTime = new Date('2026-11-03T17:15:00')

      expect(isPromoActive(promo, activeTime)).toBe(true)
      expect(isPromoActive(promo, earlyTime)).toBe(false)
      expect(isPromoActive(promo, lateTime)).toBe(false)
    })
  })

  describe('evaluatePromoDiscount helper', () => {
    const sampleItems = [
      { id: 'p1', name: 'Kopi Hitam', price: 20000, qty: 2, category: 'Minuman' }, // 40.000
      { id: 'p2', name: 'Roti Bakar', price: 15000, qty: 1, category: 'Makanan' }, // 15.000
    ] // Total 55.000

    it('calculates fixed discount on entire cart', () => {
      const promo = {
        type: 'fixed',
        scope: 'all',
        discount_value: 10000,
        min_purchase: 50000,
      }
      expect(evaluatePromoDiscount(promo, sampleItems)).toBe(10000)
    })

    it('returns 0 if minimum purchase is not met', () => {
      const promo = {
        type: 'fixed',
        scope: 'all',
        discount_value: 10000,
        min_purchase: 60000,
      }
      expect(evaluatePromoDiscount(promo, sampleItems)).toBe(0)
    })

    it('calculates percentage discount in basis points (1000 = 10%)', () => {
      const promo = {
        type: 'percent',
        scope: 'all',
        discount_value: 1000, // 10%
        min_purchase: 0,
      }
      // 10% of 55.000 = 5.500
      expect(evaluatePromoDiscount(promo, sampleItems)).toBe(5500)
    })

    it('caps percentage discount at max_discount', () => {
      const promo = {
        type: 'percent',
        scope: 'all',
        discount_value: 5000, // 50%
        max_discount: 15000,
      }
      // 50% of 55.000 = 27.500 -> capped at 15.000
      expect(evaluatePromoDiscount(promo, sampleItems)).toBe(15000)
    })

    it('restricts discount to scoped products', () => {
      const promo = {
        type: 'percent',
        scope: 'product',
        discount_value: 2000, // 20%
        targets: [{ target_type: 'product', target_sync_id: 'p1' }],
      }
      // Only Kopi Hitam (40.000) qualifies -> 20% of 40.000 = 8.000
      expect(evaluatePromoDiscount(promo, sampleItems)).toBe(8000)
    })

    it('restricts discount to scoped categories', () => {
      const promo = {
        type: 'percent',
        scope: 'category',
        discount_value: 1000, // 10%
        targets: [{ target_type: 'category', target_sync_id: 'Makanan' }],
      }
      // Only Roti Bakar (15.000) qualifies -> 10% of 15.000 = 1.500
      expect(evaluatePromoDiscount(promo, sampleItems)).toBe(1500)
    })

    it('calculates price_override correctly', () => {
      const promo = {
        type: 'price_override',
        scope: 'product',
        discount_value: 12000, // Override p1 price from 20.000 to 12.000 (saving 8.000 each)
        targets: [{ target_type: 'product', target_sync_id: 'p1' }],
      }
      // 2 qty * (20.000 - 12.000) = 16.000 savings
      expect(evaluatePromoDiscount(promo, sampleItems)).toBe(16000)
    })
  })

  describe('cartStore integration with promoStore', () => {
    it('applies promo to cart and updates discount, taxableSubtotal, tax, and total', () => {
      const cartStore = useCartStore()
      const promoStore = usePromoStore()
      const taxStore = useTaxStore()

      taxStore.setSettings({ enabled: true, rate: 10 })

      cartStore.addItem({ id: 'p1', name: 'Produk A', price: 100000 })

      const promo = {
        id: 'promo-1',
        sync_id: 'promo-sync-1',
        name: 'Diskon 10rb',
        type: 'fixed',
        scope: 'all',
        discount_value: 10000,
        status: 'active',
      }

      promoStore.setPromos([promo])
      cartStore.applyPromo(promo)

      expect(cartStore.subtotal).toBe(100000)
      expect(cartStore.discount).toBe(10000)
      expect(cartStore.taxableSubtotal).toBe(90000)
      expect(cartStore.tax).toBe(9000) // 10% of 90.000
      expect(cartStore.total).toBe(99000) // 90.000 + 9.000
    })

    it('resets applied promo on clearCart', () => {
      const cartStore = useCartStore()
      cartStore.addItem({ id: 'p1', name: 'Produk A', price: 50000 })
      cartStore.applyPromo({ id: 'p1', type: 'fixed', discount_value: 5000, status: 'active' })

      expect(cartStore.appliedPromo).not.toBeNull()
      cartStore.clearCart()
      expect(cartStore.appliedPromo).toBeNull()
      expect(cartStore.discount).toBe(0)
    })
  })

  describe('productStore isSellable filtering', () => {
    it('filters out non-sellable products (supplies/raw materials) from catalog', () => {
      const productStore = useProductStore()

      productStore.$patch({
        products: [
          { id: '1', name: 'Kopi Arabika Minuman', price: 25000, category: 'Minuman', isSellable: true, isActive: true },
          { id: '2', name: 'Biji Kopi Mentah 1kg (Bahan Baku)', price: 150000, category: 'Supplies', isSellable: false, isActive: true },
          { id: '3', name: 'Gula Pasir 1kg (Bahan Baku)', price: 18000, category: 'Supplies', is_sellable: 0, isActive: true },
        ],
        categories: ['Minuman', 'Supplies'],
      })

      const available = productStore.filteredProducts
      expect(available.length).toBe(1)
      expect(available[0].name).toBe('Kopi Arabika Minuman')
    })
  })

  describe('contractMapper sync push payload', () => {
    let adapter
    let registry

    beforeEach(async () => {
      adapter = createMemoryAdapter()
      await adapter.initialize()
      registry = createSyncIdentityRegistry({ adapter })
    })

    it('maps discount_amount and promo_sync_id in sale changes', async () => {
      const entries = [
        {
          id: 'q-sale-1',
          entityType: SYNC_ENTITY_TYPES.TRANSACTION,
          entityId: 'trx-100',
          operation: SYNC_OPERATIONS.UPSERT,
          payload: {
            id: 'trx-100',
            invoiceNumber: 'INV-100',
            createdAt: '2026-11-03T10:00:00Z',
            customer: 'Budi',
            paymentMethod: 'cash',
            subtotal: 100000,
            discount: 10000,
            promoSyncId: 'promo-sync-xyz',
            tax: 9000,
            total: 99000,
            items: [
              { id: 'p1', name: 'Kopi', price: 50000, qty: 2, subtotal: 100000 },
            ],
          },
        },
      ]

      const result = await mapOutboxEntries(entries, { registry, adapter })
      expect(result.changes.sales).toHaveLength(1)
      const sale = result.changes.sales[0]
      expect(sale.discount_amount).toBe(10000)
      expect(sale.promo_sync_id).toBe('promo-sync-xyz')
      expect(sale.total_amount).toBe(99000)
    })

    it('maps is_sellable in product changes', async () => {
      const entries = [
        {
          id: 'q-prod-1',
          entityType: SYNC_ENTITY_TYPES.PRODUCT,
          entityId: 'prod-1',
          operation: SYNC_OPERATIONS.UPSERT,
          payload: {
            id: 'prod-1',
            name: 'Kopi',
            category: 'Minuman',
            price: 20000,
            isSellable: true,
          },
        },
        {
          id: 'q-prod-2',
          entityType: SYNC_ENTITY_TYPES.PRODUCT,
          entityId: 'prod-2',
          operation: SYNC_OPERATIONS.UPSERT,
          payload: {
            id: 'prod-2',
            name: 'Gelas Cup',
            category: 'Supplies',
            price: 500,
            isSellable: false,
          },
        },
      ]

      const result = await mapOutboxEntries(entries, { registry, adapter })
      expect(result.changes.products).toHaveLength(2)
      expect(result.changes.products[0].is_sellable).toBe(true)
      expect(result.changes.products[1].is_sellable).toBe(false)
    })
  })

  describe('receipt builder with promo discount', () => {
    it('includes discount line when transaction has discount', () => {
      const transaction = {
        invoiceNumber: 'INV-TEST-001',
        createdAt: '2026-11-03T10:00:00Z',
        customer: 'Andi',
        paymentMethod: 'cash',
        items: [{ name: 'Kopi Hitam', price: 20000, qty: 2, subtotal: 40000 }],
        subtotal: 40000,
        discount: 5000,
        appliedPromo: { name: 'Kupon Hemat' },
        tax: 0,
        total: 35000,
        cashReceived: 50000,
        changeAmount: 15000,
      }

      const commands = createReceiptCommands({
        transaction,
        business: { name: 'Warung Kopi' },
        paperWidth: '58',
      })
      const textLines = commands.filter((cmd) => cmd.type === 'text').map((cmd) => cmd.value)

      const discountLine = textLines.find((line) => line.includes('Kupon Hemat') || line.includes('Diskon'))
      expect(discountLine).toBeDefined()
      expect(discountLine).toContain('-Rp 5.000')
    })
  })
})
