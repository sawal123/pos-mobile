import { defineStore } from 'pinia'

import { transactions } from '@/data/transactions'
import { useCashStore } from '@/stores/cashStore'

export const ORDER_LIFECYCLE = ['Masuk', 'Diproses', 'Siap Diambil', 'Selesai']

export const NEXT_ORDER_STATUS = {
  Masuk: 'Diproses',
  Diproses: 'Siap Diambil',
  'Siap Diambil': 'Selesai',
}

export const ORDER_STATUS_ACTIONS = {
  Masuk: 'Mulai Proses',
  Diproses: 'Tandai Siap Diambil',
  'Siap Diambil': 'Tandai Selesai',
}

export function isPaidTransaction(transaction) {
  if (!transaction) return false
  if (transaction.paymentStatus) {
    return transaction.paymentStatus === 'paid'
  }
  return transaction.status === 'paid'
}

export function createLaundryOrderNumber(existingItems = [], date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const prefix = `LDR-${y}${m}${d}-`

  const existingNumbers = new Set(
    existingItems
      .map((item) => item.orderNumber || item.invoiceNumber || '')
      .filter((num) => typeof num === 'string' && num.startsWith(prefix)),
  )

  let counter = existingNumbers.size + 1
  let candidate = `${prefix}${String(counter).padStart(4, '0')}`

  while (existingNumbers.has(candidate)) {
    counter++
    candidate = `${prefix}${String(counter).padStart(4, '0')}`
  }

  return candidate
}

function createTransactionId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return `trx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function createInvoiceNumber() {
  const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  return `INV-${timestamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
}

function normalizeTransactionItem(item) {
  const qty = Number(item.qty ?? item.quantity) || 0
  const price = Number(item.price ?? item.unitPrice) || 0
  const hppSnapshot = Number(item.hppSnapshot ?? item.costSnapshot ?? item.cost) || 0
  const subtotal = item.subtotal != null ? Number(item.subtotal) : price * qty

  return {
    ...item,
    id: item.serviceId ?? item.id,
    serviceId: item.serviceId ?? item.id,
    name: item.name ?? item.serviceName ?? '',
    serviceName: item.serviceName ?? item.name ?? '',
    qty,
    quantity: qty,
    price,
    unitPrice: price,
    hppSnapshot,
    costSnapshot: hppSnapshot,
    unit: item.unit ?? item.pricingUnit ?? 'pcs',
    kind: item.kind ?? 'product',
    pricingUnit: item.pricingUnit ?? item.unit ?? 'pcs',
    subtotal,
    lineSubtotal: subtotal,
    lineCost: hppSnapshot * qty,
  }
}

function calculateGrossProfit(items) {
  return items.reduce((sum, item) => sum + ((item.price * item.qty) - (item.hppSnapshot * item.qty)), 0)
}

function normalizeCustomerSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return null
  }

  return {
    id: snapshot.id ?? null,
    name: snapshot.name ?? '',
    phone: snapshot.phone != null ? String(snapshot.phone) : '',
    email: snapshot.email != null ? String(snapshot.email) : '',
  }
}

export const useTransactionStore = defineStore('transaction', {
  state: () => ({
    items: transactions,
    lastTransaction: null,
  }),
  actions: {
    addTransaction(transaction) {
      this.items = [transaction, ...this.items]
      this.lastTransaction = transaction
      return transaction
    },
    createTransaction(payload) {
      const items = payload.items.map(normalizeTransactionItem)
      const createdAt = payload.createdAt ?? new Date().toISOString()
      const isPaid = payload.paymentStatus === 'paid'
        || (!payload.paymentStatus && (payload.status === 'paid' || payload.status === undefined))
      const transaction = {
        id: createTransactionId(),
        invoiceNumber: createInvoiceNumber(),
        customer: payload.customer ?? 'Walk-in Customer',
        customerId: payload.customerId ?? null,
        customerSnapshot: normalizeCustomerSnapshot(payload.customerSnapshot),
        businessSnapshot: payload.businessSnapshot ? { ...payload.businessSnapshot } : null,
        status: 'paid',
        orderStatus: payload.orderStatus ?? null,
        paymentStatus: payload.paymentStatus ?? 'paid',
        items,
        itemCount: items.reduce((count, item) => count + item.qty, 0),
        subtotal: payload.subtotal,
        tax: payload.tax,
        total: payload.total,
        grossProfit: calculateGrossProfit(items),
        paymentMethod: payload.paymentMethod,
        cashReceived: payload.cashReceived ?? null,
        changeAmount: payload.changeAmount ?? null,
        paidAt: payload.paidAt ?? (isPaid ? createdAt : null),
        createdAt,
        updatedAt: payload.updatedAt ?? createdAt,
      }

      return this.addTransaction(transaction)
    },
    createLaundryOrder(payload) {
      const items = payload.items.map(normalizeTransactionItem)
      const createdAt = payload.createdAt ?? new Date().toISOString()
      const orderNumber = payload.orderNumber ?? createLaundryOrderNumber(this.items, new Date(createdAt))
      const paymentStatus = payload.paymentStatus ?? (payload.status === 'paid' ? 'paid' : 'unpaid')
      const isPaid = paymentStatus === 'paid'
      const subtotal = payload.subtotal != null ? Number(payload.subtotal) : items.reduce((sum, item) => sum + item.subtotal, 0)
      const tax = payload.tax != null ? Number(payload.tax) : 0
      const total = payload.total != null ? Number(payload.total) : subtotal + tax

      const order = {
        id: payload.id ?? createTransactionId(),
        orderNumber,
        invoiceNumber: orderNumber,
        customer: payload.customer ?? payload.customerSnapshot?.name ?? 'Pelanggan Laundry',
        customerId: payload.customerId ?? null,
        customerSnapshot: normalizeCustomerSnapshot(payload.customerSnapshot),
        businessSnapshot: payload.businessSnapshot ? { ...payload.businessSnapshot } : null,
        status: paymentStatus,
        orderStatus: payload.orderStatus ?? 'Masuk',
        paymentStatus,
        items,
        itemCount: items.reduce((count, item) => count + item.qty, 0),
        subtotal,
        tax,
        total,
        grossProfit: calculateGrossProfit(items),
        paymentMethod: payload.paymentMethod ?? (paymentStatus === 'paid' ? 'cash' : ''),
        cashReceived: payload.cashReceived ?? null,
        changeAmount: payload.changeAmount ?? null,
        paidAt: payload.paidAt ?? (isPaid ? createdAt : null),
        estimatedCompletedAt: payload.estimatedCompletedAt ?? null,
        note: payload.note ?? '',
        createdAt,
        updatedAt: payload.updatedAt ?? createdAt,
      }

      return this.addTransaction(order)
    },
    updateOrderStatus(id, status) {
      const transaction = this.items.find((item) => item.id === id)

      if (!transaction || !ORDER_LIFECYCLE.includes(status)) {
        return false
      }

      const currentIndex = ORDER_LIFECYCLE.indexOf(transaction.orderStatus)
      const targetIndex = ORDER_LIFECYCLE.indexOf(status)

      if (currentIndex === -1 || targetIndex === -1) {
        return false
      }

      // Same status: allowed (idempotent / no-op), do NOT touch updatedAt
      if (currentIndex === targetIndex) {
        return true
      }

      // Strictly allow ONLY the next immediate step (currentIndex + 1)
      if (targetIndex !== currentIndex + 1) {
        return false
      }

      transaction.orderStatus = status
      transaction.updatedAt = new Date().toISOString()

      if (this.lastTransaction?.id === id) {
        this.lastTransaction = transaction
      }

      return true
    },
    advanceOrderStatus(id) {
      const transaction = this.items.find((item) => item.id === id)
      if (!transaction) {
        return false
      }

      const nextStatus = NEXT_ORDER_STATUS[transaction.orderStatus]
      if (!nextStatus) {
        return false
      }

      return this.updateOrderStatus(id, nextStatus)
    },
    settleLaundryOrderPayment({
      orderId,
      paymentMethod = 'cash',
      cashReceived = null,
      changeAmount = null,
      cashStore = null,
    }) {
      const order = this.items.find((item) => item.id === orderId)
      if (!order) {
        return { success: false, error: 'Order tidak ditemukan' }
      }

      // 2. Jika sudah paid: return success duplicated/idempotent, jangan buat cash entry lagi
      if (order.paymentStatus === 'paid') {
        return { success: true, order, transaction: order, duplicated: true }
      }

      const method = (paymentMethod || 'cash').toLowerCase()

      if (method === 'cash') {
        // 3. Validasi payment
        const received = cashReceived != null ? Number(cashReceived) : order.total
        if (Number.isNaN(received) || received < order.total) {
          return { success: false, error: 'Uang diterima kurang dari total pembayaran.' }
        }

        const calculatedChange = changeAmount != null
          ? Number(changeAmount)
          : Math.max(0, received - order.total)

        // 4 & 5. Pastikan cashStore.recordSalePayment berhasil
        const activeCashStore = cashStore || useCashStore()
        if (!activeCashStore || typeof activeCashStore.recordSalePayment !== 'function') {
          return { success: false, error: 'Cash store tidak tersedia untuk mencatat pembayaran tunai.' }
        }

        const cashResult = activeCashStore.recordSalePayment({
          id: order.id,
          total: order.total,
          paymentMethod: 'cash',
          invoiceNumber: order.orderNumber || order.invoiceNumber || order.id,
          createdAt: new Date().toISOString(),
        })

        if (!cashResult || cashResult.success === false) {
          // Jika pencatatan cash gagal:
          // - order WAJIB tetap unpaid
          // - jangan ubah paymentStatus
          // - jangan ubah paymentMethod menjadi cash final
          // - return success false + error
          return {
            success: false,
            error: cashResult?.error || 'Gagal mencatat kas masuk untuk pembayaran tunai.',
          }
        }

        // 6. HANYA setelah cash entry berhasil:
        const paymentTimestamp = new Date().toISOString()
        order.paymentStatus = 'paid'
        order.status = 'paid'
        order.paymentMethod = 'cash'
        order.cashReceived = received
        order.changeAmount = calculatedChange
        order.paidAt = order.paidAt ?? paymentTimestamp
        order.updatedAt = paymentTimestamp

        if (this.lastTransaction?.id === order.id) {
          this.lastTransaction = order
        }

        return { success: true, order, transaction: order, duplicated: false }
      }

      // NON-CASH (QRIS / Card)
      // - tidak membuat cash entry
      // - langsung mark paid setelah validation
      // - tetap idempotent
      const paymentTimestamp = new Date().toISOString()
      order.paymentStatus = 'paid'
      order.status = 'paid'
      order.paymentMethod = method
      order.cashReceived = null
      order.changeAmount = null
      order.paidAt = order.paidAt ?? paymentTimestamp
      order.updatedAt = paymentTimestamp

      if (this.lastTransaction?.id === order.id) {
        this.lastTransaction = order
      }

      return { success: true, order, transaction: order, duplicated: false }
    },
    payLaundryOrder(id, paymentPayload = {}) {
      return this.settleLaundryOrderPayment({
        orderId: id,
        paymentMethod: paymentPayload.paymentMethod ?? 'cash',
        cashReceived: paymentPayload.cashReceived ?? null,
        changeAmount: paymentPayload.changeAmount ?? null,
        cashStore: paymentPayload.cashStore ?? null,
      })
    },
    clearLastTransaction() {
      this.lastTransaction = null
    },
  },
})
